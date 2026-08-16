/* ==========================================================================
   GeoFinance System — Sauvegarde cloud optionnelle (Firebase Auth + Firestore)
   Connexion Google + sauvegarde/restauration À LA DEMANDE d'un blob chiffré
   AES-GCM (buildEncryptedPayload/decryptPayload, backup.js — même chiffrement
   que l'export chiffré local, déjà testé). Volontairement PAS de synchro
   continue/bidirectionnelle : pas de moteur de résolution de conflits à
   construire, juste "envoyer la dernière sauvegarde" / "récupérer la
   dernière sauvegarde", au choix de l'utilisateur.

   Le SDK Firebase (modular, CDN ESM — pas de build/npm, cohérent avec le
   reste du projet) n'est chargé qu'au premier besoin réel (connexion, ou
   ouverture des Paramètres si une connexion précédente est connue) — jamais
   sur le chemin par défaut de l'app. Même principe que le chargement
   paresseux de Tesseract dans ocr.js.

   Le blob chiffré est découpé en morceaux (backups/{uid}/chunks/{i}, voir
   CHUNK_SIZE) plutôt que stocké dans un seul document backups/{uid} : Firestore
   refuse tout document de plus de ~1 Mo, et l'historique de transactions +
   les justificatifs photo en base64 dépassent vite cette limite en usage réel.
   ========================================================================== */

import { firebaseConfig, isFirebaseConfigured, googleClientId } from './firebase-config.js';
import { buildEncryptedPayload, decryptPayload, deserializeReceiptsForImport, markBackupDone } from './backup.js';
import { importAllData, getSetting, setSetting } from './db.js';
import { openModal, showToast, confirmDialog, formatDate } from './utils.js';
import { notifyDataChanged } from './state.js';
import { t } from './i18n.js';

/* ==========================================================================
   16 août 2026 — Connexion Google réécrite : Google Identity Services au lieu
   de signInWithPopup/signInWithRedirect de Firebase.

   Diagnostic complet mené avec l'auteur : signInWithRedirect() échouait de façon
   systématique sur mobile (iPhone icône + Safari + Chrome, Android) — la connexion
   Google réussissait bien côté serveur (Firebase Console > Authentication > Users
   montrait un horodatage de connexion à jour) mais getRedirectResult() ne retrouvait
   jamais le résultat côté client. Firebase a fini par renvoyer l'erreur explicite
   "auth/missing-initial-state" : "signInWithRedirect in a storage-partitioned browser
   environment". Cause racine confirmée : le mécanisme popup/redirect de Firebase
   dépend d'un pont de stockage tiers entre ce site (zaky04.github.io) et le domaine
   d'authentification (geofinance-backup.firebaseapp.com), via une iframe intégrée.
   Les navigateurs mobiles modernes (Safari depuis longtemps, Chrome/Android de plus
   en plus) cloisonnent le stockage tiers par site — cette iframe ne voit donc pas le
   même stockage selon qu'elle est chargée en tant qu'iframe intégrée (avant le départ
   vers Google) ou en page complète (au retour) : l'état initial est introuvable. Ce
   pont casse AUSSI signInWithPopup dès qu'il doit y recourir en interne, pas
   seulement signInWithRedirect — donc aucun réglage popup/redirect de Firebase seul
   ne pouvait définitivement corriger le problème.

   Solution retenue : contourner entièrement ce pont. Google Identity Services (la
   bibliothèque moderne de Google, accounts.google.com/gsi/client) récupère un jeton
   d'accès Google directement via son propre mécanisme OAuth (compatible FedCM,
   conçu précisément pour fonctionner sans dépendre du stockage tiers), puis ce jeton
   est échangé contre une session Firebase via signInWithCredential() — sans jamais
   passer par le pont iframe/storage de Firebase. Popup ouverte par Google Identity
   Services elle-même (pas par Firebase), toujours dans le même clic utilisateur
   (voir warmUpGoogleSignIn()) pour éviter le blocage de popup déjà rencontré.

   Limite restante, non résolue par ce changement (aucune solution JS ne le peut) :
   une PWA installée en plein écran (icône sur l'écran d'accueil, display-mode:
   standalone) ne peut littéralement ouvrir AUCUNE fenêtre de navigateur — ni popup
   Firebase, ni popup Google Identity Services. Dans ce contexte précis, la sauvegarde
   locale chiffrée (import/export) reste le seul chemin de migration fiable — voir la
   bannière de migration (renderMigrationBanner(), app.js sur cette branche). Mais
   cette limite ne concernait qu'une minorité des échecs rapportés : la plupart avaient
   lieu dans un onglet Safari/Chrome normal, où ce nouveau mécanisme fonctionne comme
   sur desktop. */

let gsiPromise = null;
function ensureGoogleIdentityServices() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(t("Échec du chargement du service de connexion Google.")));
    document.head.appendChild(script);
  });
  return gsiPromise;
}

let tokenClient = null;
// { resolve, reject } de l'appel signInWithGoogle() en cours — le callback du tokenClient (créé une
// seule fois, voir ensureTokenClient()) est partagé entre tous les appels futurs, donc il ne peut pas
// fermer directement sur les resolve/reject d'un appel précis : il lit ce pointeur mutable à chaque
// déclenchement, mis à jour par signInWithGoogle() juste avant de démarrer le flux.
let pendingSignIn = null;

async function ensureTokenClient() {
  await ensureGoogleIdentityServices();
  if (tokenClient) return tokenClient;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: googleClientId,
    scope: 'email profile',
    callback: async (tokenResponse) => {
      const pending = pendingSignIn;
      pendingSignIn = null;
      if (!pending) return; // pas d'appel signInWithGoogle() en cours (ne devrait pas arriver)
      if (tokenResponse.error) { pending.reject(new Error(tokenResponse.error)); return; }
      try {
        const { authMod } = await ensureFirebase();
        const credential = authMod.GoogleAuthProvider.credential(null, tokenResponse.access_token);
        const result = await authMod.signInWithCredential(firebaseAuth, credential);
        pending.resolve(result.user);
      } catch (err) {
        pending.reject(err);
      }
    },
    error_callback: (err) => {
      const pending = pendingSignIn;
      pendingSignIn = null;
      if (pending) pending.reject(new Error(err?.type || 'popup_failed_to_open'));
    },
  });
  return tokenClient;
}

// À ajuster si une version plus récente est disponible au moment du déploiement
// (voir firebase.google.com/docs/web/setup) — sans build, la version est figée ici.
const SDK_VERSION = '12.17.1';

let sdkPromise = null;
let firebaseAuth = null;
let firebaseDb = null;

/** Charge le SDK Firebase et initialise l'app — mémoïsé, un seul chargement réseau même si
    appelé plusieurs fois. Renvoie les sous-modules auth/firestore (les fonctions dont on a
    besoin, ex. GoogleAuthProvider, signInWithCredential, doc, setDoc — l'API modulaire de Firebase
    les expose ainsi). */
function ensureFirebase() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    const [{ initializeApp }, authMod, firestoreMod] = await Promise.all([
      import(/* @vite-ignore */ `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
      import(/* @vite-ignore */ `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
      import(/* @vite-ignore */ `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
    ]);
    const app = initializeApp(firebaseConfig);
    firebaseAuth = authMod.getAuth(app);
    firebaseDb = firestoreMod.getFirestore(app);
    return { authMod, firestoreMod };
  })();
  return sdkPromise;
}

/** L'état de connexion de Firebase Auth se restaure de façon ASYNCHRONE après initialisation
    (lecture d'une session persistée) — lire authInstance.currentUser immédiatement après getAuth()
    peut donc renvoyer null même pour un utilisateur déjà connecté. onAuthStateChanged() est le
    seul moyen fiable de savoir l'état réel, sa première notification arrivant une fois la
    restauration terminée (avec l'utilisateur, ou null si vraiment déconnecté). */
function waitForAuthReady(authMod) {
  return new Promise((resolve) => {
    const unsubscribe = authMod.onAuthStateChanged(firebaseAuth, (user) => { unsubscribe(); resolve(user); });
  });
}

/** Déclenche le flux de connexion Google via Google Identity Services (voir le commentaire d'en-tête
    du fichier) : ouvre la popup OAuth de Google elle-même (pas celle de Firebase), récupère un jeton
    d'accès, l'échange contre une session Firebase. Résout avec l'utilisateur Firebase, ou rejette
    (jamais de retour `null` façon "flux redirection" — il n'y a plus de redirection du tout). Doit
    être appelée directement depuis un handler de clic (pas après un premier `await` non préchargé) :
    voir warmUpGoogleSignIn(), qui prépare tokenClient à l'avance pour que requestAccessToken() reste
    dans le même geste utilisateur que le clic. */
export async function signInWithGoogle() {
  const client = await ensureTokenClient(); // déjà mémoïsé si warmUpGoogleSignIn() a tourné avant
  return new Promise((resolve, reject) => {
    pendingSignIn = { resolve, reject };
    client.requestAccessToken();
  });
}

/** Précharge Google Identity Services + le SDK Firebase en arrière-plan, sans attendre ni faire
    échouer l'appelant en cas d'erreur (hors-ligne, etc.) — à appeler dès qu'un bouton "Se connecter
    avec Google" devient visible (pas à chaque démarrage de l'app, toujours dans le respect du
    chargement paresseux : seulement quand l'UI concernée est réellement affichée). Sans ce
    préchargement, signInWithGoogle() devrait attendre le chargement réseau du script GSI avant de
    pouvoir appeler requestAccessToken() — sur mobile, ce délai suffit à faire perdre au navigateur la
    notion de "geste utilisateur direct" nécessaire pour autoriser l'ouverture d'une fenêtre, donc la
    popup se ferait bloquer (déjà rencontré avec l'ancien mécanisme signInWithPopup de Firebase). */
export function warmUpGoogleSignIn() {
  ensureFirebase().catch(() => {});
  ensureTokenClient().catch(() => {});
}

export async function signOutGoogle() {
  const { authMod } = await ensureFirebase();
  await authMod.signOut(firebaseAuth);
}

/** Renvoie l'utilisateur Firebase actuellement connecté, ou `null`. Utilisée par
    renderCloudBackupSection() (Paramètres) et checkCloudStaleness() ci-dessous. */
export async function resolveCloudUser() {
  const { authMod } = await ensureFirebase();
  return waitForAuthReady(authMod);
}

// Firestore refuse un document de plus de ~1 048 487 octets. Avec l'historique de transactions
// et les justificatifs photo (convertis en data URL base64 dans le payload — voir
// serializeReceiptsForExport() dans backup.js), la sauvegarde complète dépasse vite cette limite
// pour un usage réel. On découpe donc le JSON chiffré en morceaux stockés dans une sous-collection
// plutôt que dans un seul champ — marge confortable sous la limite exacte.
const CHUNK_SIZE = 900000;

export async function pushBackupToCloud(passphrase) {
  const { firestoreMod } = await ensureFirebase();
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error(t('Non connecté.'));
  const payloadStr = JSON.stringify(await buildEncryptedPayload(passphrase));
  const chunks = [];
  for (let i = 0; i < payloadStr.length; i += CHUNK_SIZE) chunks.push(payloadStr.slice(i, i + CHUNK_SIZE));

  const chunksRef = firestoreMod.collection(firebaseDb, 'backups', user.uid, 'chunks');
  const existing = await firestoreMod.getDocs(chunksRef);
  const batch = firestoreMod.writeBatch(firebaseDb);
  // Supprime d'abord les anciens morceaux : leur nombre peut varier d'une sauvegarde à l'autre
  // (données en plus ou en moins) — sans ça, d'anciens morceaux en trop resteraient et
  // corrompraient la sauvegarde suivante à la lecture (concaténation avec des restes obsolètes).
  existing.forEach((d) => batch.delete(d.ref));
  chunks.forEach((chunk, i) => batch.set(firestoreMod.doc(chunksRef, String(i)), { data: chunk }));
  const backupDocRef = firestoreMod.doc(firebaseDb, 'backups', user.uid);
  batch.set(backupDocRef, { chunkCount: chunks.length, updatedAt: firestoreMod.serverTimestamp() });
  await batch.commit();

  await markBackupDone();
  await setSetting('lastCloudBackupAt', new Date().toISOString());
  // Repart "poli" (snooze 24h de nouveau autorisé) quel que soit le chemin ayant déclenché cette
  // sauvegarde — bouton des Paramètres ou rappel périodique — même logique que markBackupDone()
  // pour le rappel local.
  await setSetting('cloudBackupSnoozeCount', 0);
  // Marque CET appareil comme à jour avec le cloud (voir checkCloudStaleness) — distinct de
  // lastCloudBackupAt (qui ne veut dire "j'ai poussé depuis ici", affiché en Paramètres) : celui-ci
  // sert uniquement à savoir si cet appareil est en retard sur le cloud, mis à jour par push ET pull.
  // Relit le document pour récupérer l'horodatage réellement résolu côté serveur (serverTimestamp()
  // dans le batch ci-dessus ne renvoie pas sa valeur résolue au client) : comparer une horloge
  // serveur à une horloge serveur, jamais une horloge serveur à l'horloge locale de cet appareil —
  // sans ça, un appareil dont l'horloge retarde même légèrement verrait son PROPRE push relu comme
  // "plus récent" que ce qu'il vient d'enregistrer localement, et checkCloudStaleness() afficherait
  // à tort "une sauvegarde plus récente existe sur un autre appareil" pour sa propre sauvegarde.
  try {
    const freshSnap = await firestoreMod.getDoc(backupDocRef);
    const resolvedUpdatedAt = freshSnap.data()?.updatedAt;
    await setSetting('cloudLastKnownSyncAt', resolvedUpdatedAt?.toDate ? resolvedUpdatedAt.toDate().toISOString() : new Date().toISOString());
  } catch {
    await setSetting('cloudLastKnownSyncAt', new Date().toISOString());
  }
}

/* ---------- Rappel périodique de sauvegarde cloud ----------
   Même principe que le rappel hebdomadaire d'export local (backup.js, checkWeeklyBackupReminder) :
   report par tranches de 24h, mode "urgent" (bouton "Plus tard" retiré) au-delà de 3 reports.
   Ne s'affiche QUE pour un utilisateur qui s'est déjà connecté une fois (cloudBackupWasSignedIn) —
   ce réglage est purement local, donc cette vérification ne charge JAMAIS le SDK Firebase pour un
   utilisateur qui n'utilise pas cette fonctionnalité (même principe de chargement paresseux que le
   reste de ce fichier). Le SDK n'est chargé qu'une fois que l'utilisateur clique "Sauvegarder
   maintenant" dans le rappel — jamais pour décider si le rappel doit s'afficher. */
const CLOUD_BACKUP_SNOOZE_LIMIT = 3;

export async function checkWeeklyCloudBackupReminder() {
  if (!isFirebaseConfigured) return;
  if (!(await getSetting('cloudBackupWasSignedIn', false))) return;

  const snoozedUntil = await getSetting('cloudBackupSnoozedUntil');
  const snoozeCount = await getSetting('cloudBackupSnoozeCount', 0);
  const now = Date.now();
  // > (pas >=) : même correctif que checkWeeklyBackupReminder() (backup.js) — sinon le 3e clic
  // "Plus tard" (qui pose le répit de 24h) se voit annulé immédiatement par le passage en mode
  // urgent avant que ce répit n'ait eu la moindre chance de s'écouler.
  const urgent = snoozeCount > CLOUD_BACKUP_SNOOZE_LIMIT;
  if (!urgent && snoozedUntil && now < new Date(snoozedUntil).getTime()) return;

  const last = await getSetting('lastCloudBackupAt');
  const lastMs = last ? new Date(last).getTime() : 0;
  const sevenDaysMs = 7 * 24 * 3600 * 1000;
  if (now - lastMs < sevenDaysMs) return;

  showCloudBackupReminderModal(urgent);
}

function showCloudBackupReminderModal(urgent = false) {
  const message = urgent
    ? t("Vous avez repoussé ce rappel plusieurs fois. Sans sauvegarde cloud récente, une réinstallation ou un changement d'appareil vous ferait perdre les données saisies depuis votre dernière sauvegarde. Sauvegardez maintenant.")
    : t("Ça fait plus de 7 jours que vos données n'ont pas été sauvegardées dans le cloud. Voulez-vous le faire maintenant ?");
  const modal = openModal(`
    <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${message}</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;">
      <button type="button" class="btn btn-primary" id="cloud-reminder-backup-btn">${t('Sauvegarder maintenant')}</button>
      ${urgent ? '' : `<button type="button" class="btn btn-ghost" id="cloud-reminder-later-btn">${t('Plus tard')}</button>`}
    </div>`, { title: t('Sauvegarde cloud') });

  modal.el.querySelector('#cloud-reminder-later-btn')?.addEventListener('click', async () => {
    await setSetting('cloudBackupSnoozedUntil', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
    await setSetting('cloudBackupSnoozeCount', (await getSetting('cloudBackupSnoozeCount', 0)) + 1);
    modal.close();
  });

  modal.el.querySelector('#cloud-reminder-backup-btn').addEventListener('click', async () => {
    modal.close();
    const p = await promptPassphrase(t('Chiffrer la sauvegarde cloud'));
    if (!p) return;
    try {
      await pushBackupToCloud(p);
      showToast(t('Sauvegarde envoyée dans le cloud.'));
    } catch (err) {
      showToast(t('Erreur : {message}', { message: err.message || t('envoi impossible.') }));
    }
  });
}

export async function pullBackupFromCloud(passphrase, { merge = false } = {}) {
  const { firestoreMod } = await ensureFirebase();
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error(t('Non connecté.'));
  const snap = await firestoreMod.getDoc(firestoreMod.doc(firebaseDb, 'backups', user.uid));
  if (!snap.exists()) throw new Error(t('Aucune sauvegarde cloud trouvée pour ce compte.'));
  const { chunkCount, updatedAt } = snap.data();
  const chunksRef = firestoreMod.collection(firebaseDb, 'backups', user.uid, 'chunks');
  const chunkDocs = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) => firestoreMod.getDoc(firestoreMod.doc(chunksRef, String(i))))
  );
  const payloadStr = chunkDocs.map((d) => d.data().data).join('');
  const payload = JSON.parse(payloadStr);
  const data = await decryptPayload(payload, passphrase);
  await deserializeReceiptsForImport(data);
  await importAllData(data, { merge });
  notifyDataChanged('all');
  // Cet appareil est maintenant à jour avec le cloud tel qu'il était à updatedAt (l'horodatage
  // serveur de LA sauvegarde qu'on vient de récupérer, pas l'heure locale de fin de restauration —
  // plus précis, évite tout décalage d'horloge appareil/serveur). Voir checkCloudStaleness().
  if (updatedAt?.toDate) await setSetting('cloudLastKnownSyncAt', updatedAt.toDate().toISOString());
  // Laisse un répit de 24h avant le prochain rappel de sauvegarde cloud (checkWeeklyCloudBackupReminder)
  // : sans ça, un appareil qui vient de recevoir les données du cloud (via ce pull, éventuellement
  // déclenché par la modale de fraîcheur ci-dessous) pouvait se voir aussitôt réclamer "sauvegardez
  // maintenant" alors qu'il vient littéralement de se synchroniser — déroutant. Ne touche PAS
  // lastCloudBackupAt (qui reste honnête sur la dernière fois qu'on a réellement poussé une
  // sauvegarde depuis cet appareil, affiché tel quel en Paramètres).
  await setSetting('cloudBackupSnoozedUntil', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
}

/* ---------- Vérification de fraîcheur au démarrage ----------
   Scénario visé : plusieurs appareils partagent le même compte cloud. L'appareil A sauvegarde de
   nouvelles transactions ; l'appareil B, resté sur une version plus ancienne, se rouvre et
   l'utilisateur commence à y saisir SES propres nouvelles transactions sans savoir que le cloud a
   avancé pendant ce temps — B pousserait alors une sauvegarde qui écraserait les transactions de A
   (ou B raterait les transactions de A jusqu'à sa prochaine restauration manuelle). En comparant
   l'horodatage serveur de la dernière sauvegarde cloud à la dernière fois que CET appareil a été
   synchronisé (push OU pull, cloudLastKnownSyncAt), on peut prévenir AVANT que B ne commence à
   diverger, plutôt que de découvrir le problème après coup.
   Ne résout pas le cas où les deux appareils ont chacun des changements non synchronisés en même
   temps (vrai conflit des deux côtés) — ça nécessiterait le moteur de résolution de conflits qu'on
   a délibérément évité de construire (voir plan de conception). Mais ça couvre le cas courant :
   un appareil simplement en retard, averti avant de commencer à taper dessus. */
export async function checkCloudStaleness() {
  if (!isFirebaseConfigured) return;
  if (!(await getSetting('cloudBackupWasSignedIn', false))) return;

  // Timeout défensif : ne doit jamais laisser une modale surgir bien après que l'utilisateur a déjà
  // commencé à travailler (connexion lente/capricieuse). Pas un blocage du démarrage de l'app —
  // cette fonction est déjà appelée en tâche de fond via setTimeout (app.js), jamais attendue par le
  // boot lui-même.
  let cancelled = false;
  const timeout = setTimeout(() => { cancelled = true; }, 8000);

  try {
    const { firestoreMod } = await ensureFirebase();
    const user = await resolveCloudUser();
    if (!user || cancelled) return;

    const snap = await firestoreMod.getDoc(firestoreMod.doc(firebaseDb, 'backups', user.uid));
    if (!snap.exists() || cancelled) return;
    const cloudUpdatedAt = snap.data().updatedAt?.toDate?.();
    if (!cloudUpdatedAt || cancelled) return;

    const localSyncAt = await getSetting('cloudLastKnownSyncAt');
    if (!localSyncAt) {
      // Aucun repère connu pour cet appareil — soit il n'a jamais synchronisé depuis l'ajout de ce
      // réglage (utilisateur déjà connecté au cloud AVANT cette fonctionnalité, cloudLastKnownSyncAt
      // n'existait pas encore), soit c'est un cas limite déjà couvert ailleurs. Traiter l'absence de
      // repère comme "en retard par défaut" avertirait à tort tout utilisateur mono-appareil de sa
      // propre sauvegarde, la toute première fois qu'il démarre après cette mise à jour. On établit
      // silencieusement un repère sur l'état actuel du cloud, sans alarmer — les prochains démarrages
      // compareront correctement contre un vrai changement.
      if (!cancelled) await setSetting('cloudLastKnownSyncAt', cloudUpdatedAt.toISOString());
      return;
    }
    const localMs = new Date(localSyncAt).getTime();
    if (!cancelled && cloudUpdatedAt.getTime() > localMs) {
      showCloudStalenessModal(cloudUpdatedAt);
    }
  } catch {
    // Hors-ligne ou service indisponible : l'app continue de fonctionner normalement, sans
    // message d'erreur — la vérification sera retentée au prochain démarrage.
  } finally {
    clearTimeout(timeout);
  }
}

function showCloudStalenessModal(cloudUpdatedAt) {
  const modal = openModal(`
    <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${t('Une sauvegarde plus récente existe dans le cloud, faite le {date} — probablement depuis un autre appareil. Pour éviter des doublons ou de remplacer des données par erreur, il est recommandé de la récupérer avant de continuer sur cet appareil.', { date: formatDate(cloudUpdatedAt.toISOString()) })}</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;">
      <button type="button" class="btn btn-primary" id="cloud-stale-restore-btn">${t('Restaurer maintenant')}</button>
      <button type="button" class="btn btn-ghost" id="cloud-stale-dismiss-btn">${t('Continuer quand même')}</button>
    </div>`, { title: t('Sauvegarde cloud plus récente') });

  modal.el.querySelector('#cloud-stale-dismiss-btn').addEventListener('click', async () => {
    // Avance le repère local jusqu'à l'état du cloud qu'on vient de voir (sans le récupérer) : sans
    // ça, la modale identique réapparaîtrait à chaque démarrage tant que le cloud ne bouge pas — ici
    // elle ne reviendra que si le cloud avance ENCORE après ce constat, pas pour le même état déjà vu.
    await setSetting('cloudLastKnownSyncAt', cloudUpdatedAt.toISOString());
    modal.close();
  });

  modal.el.querySelector('#cloud-stale-restore-btn').addEventListener('click', async () => {
    modal.close();
    const p = await promptPassphrase(t('Mot de passe de la sauvegarde cloud'));
    if (!p) return;
    const merge = await confirmDialog(t('Fusionner avec les données existantes ? "Annuler" remplacera entièrement les données actuelles par celles du cloud.'), { confirmText: t('Fusionner'), cancelText: t('Remplacer tout') });
    try {
      await pullBackupFromCloud(p, { merge });
      showToast(t('Données restaurées depuis le cloud.'));
    } catch (err) {
      showToast(t('Erreur : {message}', { message: err.message || t('restauration impossible.') }));
    }
  });
}

/* ---------- UI (Paramètres) ---------- */
function promptPassphrase(title) {
  return new Promise((resolve) => {
    const modal = openModal(`
      <form id="cloud-passphrase-form">
        <div class="form-row"><label>${t('Mot de passe de chiffrement')}</label><input type="password" name="passphrase" required minlength="6" autofocus></div>
        <button type="submit" class="btn btn-primary btn-block">${t('Continuer')}</button>
      </form>`, { title, onClose: () => resolve(null) });
    modal.el.querySelector('#cloud-passphrase-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new FormData(e.target).get('passphrase');
      // resolve() AVANT modal.close() : close() déclenche onClose() (=> resolve(null))
      // synchroniquement — appeler resolve(p) après serait un no-op (une promesse déjà
      // résolue ignore les résolutions suivantes), le mot de passe réel serait perdu.
      resolve(p);
      modal.close();
    });
  });
}

export async function renderCloudBackupSection(container) {
  if (!isFirebaseConfigured) {
    container.innerHTML = `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-header"><h3>${t('Sauvegarde cloud (optionnelle)')}</h3></div>
        <p class="empty-state" style="padding:12px 0;">${t("Fonctionnalité pas encore configurée par l'auteur de l'app.")}</p>
      </div>`;
    return;
  }

  const lastCloudBackupAt = await getSetting('lastCloudBackupAt');
  let user = null;
  // Ne charge le SDK au chargement des Paramètres que si une connexion précédente est connue —
  // sinon un utilisateur qui n'a jamais touché à cette fonctionnalité ne déclenche jamais le
  // chargement réseau du SDK Firebase rien qu'en ouvrant ses Paramètres.
  if (await getSetting('cloudBackupWasSignedIn', false)) {
    try {
      user = await resolveCloudUser();
      if (!user) await setSetting('cloudBackupWasSignedIn', false);
    } catch {
      // Hors-ligne ou service indisponible : reste affiché comme déconnecté, pas d'erreur bloquante.
    }
  } else {
    // Ce visiteur n'a jamais utilisé la fonctionnalité : le bouton "Se connecter avec Google" est
    // sur le point d'être affiché plus bas — précharge Google Identity Services + le SDK Firebase
    // dès maintenant en arrière-plan pour que le clic à venir ouvre la popup sans délai réseau
    // (voir warmUpGoogleSignIn()).
    warmUpGoogleSignIn();
  }

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Sauvegarde cloud (optionnelle)')}</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">${t("Sauvegarde chiffrée sur votre compte Google, pour la récupérer après une réinstallation. Le mot de passe de chiffrement n'est jamais transmis — sans lui, personne (y compris Google) ne peut lire vos données.")}</p>
      ${user ? `
        <div class="stat-row"><span class="stat-row-label">${t('Connecté')}</span><span>${user.email || user.displayName || ''}</span></div>
        <div class="stat-row" style="margin-top:6px;"><span class="stat-row-label">${t('Dernière sauvegarde cloud')}</span><span>${lastCloudBackupAt ? formatDate(lastCloudBackupAt) : t('jamais')}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
          <button type="button" class="btn btn-primary" id="cloud-push-btn">${t('Sauvegarder maintenant')}</button>
          <button type="button" class="btn btn-ghost" id="cloud-pull-btn">${t('Restaurer depuis le cloud')}</button>
          <button type="button" class="btn btn-ghost" id="cloud-signout-btn">${t('Se déconnecter')}</button>
        </div>` : `
        <button type="button" class="btn btn-primary" id="cloud-signin-btn">${t('Se connecter avec Google')}</button>`}
    </div>`;

  container.querySelector('#cloud-signin-btn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = t('Connexion…');
    try {
      const user = await signInWithGoogle();
      await setSetting('cloudBackupWasSignedIn', true);
      showToast(t('Connecté.'));
      await renderCloudBackupSection(container);
    } catch (err) {
      showToast(t('Erreur : {message}', { message: err.message || t('connexion impossible.') }));
      btn.disabled = false;
      btn.textContent = t('Se connecter avec Google');
    }
  });

  container.querySelector('#cloud-signout-btn')?.addEventListener('click', async () => {
    await signOutGoogle();
    await setSetting('cloudBackupWasSignedIn', false);
    showToast(t('Déconnecté.'));
    await renderCloudBackupSection(container);
  });

  container.querySelector('#cloud-push-btn')?.addEventListener('click', async () => {
    const p = await promptPassphrase(t('Chiffrer la sauvegarde cloud'));
    if (!p) return;
    try {
      await pushBackupToCloud(p);
      showToast(t('Sauvegarde envoyée dans le cloud.'));
      await renderCloudBackupSection(container);
    } catch (err) {
      showToast(t('Erreur : {message}', { message: err.message || t('envoi impossible.') }));
    }
  });

  container.querySelector('#cloud-pull-btn')?.addEventListener('click', async () => {
    const p = await promptPassphrase(t('Mot de passe de la sauvegarde cloud'));
    if (!p) return;
    const merge = await confirmDialog(t('Fusionner avec les données existantes ? "Annuler" remplacera entièrement les données actuelles par celles du cloud.'), { confirmText: t('Fusionner'), cancelText: t('Remplacer tout') });
    try {
      await pullBackupFromCloud(p, { merge });
      showToast(t('Données restaurées depuis le cloud.'));
    } catch (err) {
      showToast(t('Erreur : {message}', { message: err.message || t('restauration impossible.') }));
    }
  });
}
