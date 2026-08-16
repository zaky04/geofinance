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

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';
import { buildEncryptedPayload, decryptPayload, deserializeReceiptsForImport, markBackupDone } from './backup.js';
import { importAllData, getSetting, setSetting } from './db.js';
import { openModal, showToast, confirmDialog, formatDate } from './utils.js';
import { notifyDataChanged } from './state.js';
import { isStandalone } from './install-prompt.js';
import { t } from './i18n.js';

/* Signalé par l'auteur (16 août) : signInWithRedirect() échouait de façon systématique et
   reproductible sur mobile (iPhone icône + Safari + Chrome, Android) — la connexion Google
   réussissait bien côté serveur (confirmée via Firebase Console > Authentication > Users) mais
   getRedirectResult() ne retrouvait jamais le résultat côté client, alors que signInWithPopup
   fonctionnait de façon fiable sur PC. Cause la plus probable : la navigation complète vers Google
   et retour expose le round-trip à l'éviction mémoire du navigateur/OS en arrière-plan sur mobile
   (contrairement à une popup, où l'onglet d'origine ne quitte jamais le premier plan) — la
   persistance de l'état de redirection ne survit pas de façon fiable à ce cycle. Ancienne
   hypothèse ("popup carrément non fonctionnel sur mobile") : vraie UNIQUEMENT pour une PWA
   installée en plein écran (display-mode: standalone), où il n'existe littéralement aucune fenêtre
   de navigateur dans laquelle ouvrir une popup — mais PAS pour un onglet mobile normal (Safari/
   Chrome), où window.open() fonctionne comme sur desktop. On ne force donc plus la redirection que
   pour le cas standalone réellement bloquant ; partout ailleurs (y compris mobile en onglet normal),
   la popup est tentée en premier, avec repli automatique sur la redirection déjà en place
   ci-dessous si elle échoue vraiment (POPUP_FALLBACK_CODES). */
function shouldPreferRedirect() {
  return isStandalone();
}
const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request',
]);

// À ajuster si une version plus récente est disponible au moment du déploiement
// (voir firebase.google.com/docs/web/setup) — sans build, la version est figée ici.
// v10.14.1 -> v12.17.1 (16 août 2026) : signalé par l'auteur, une connexion Google RÉELLEMENT
// réussie côté serveur (confirmée via Firebase Console > Authentication > Users, horodatage de
// connexion à jour) n'était jamais retrouvée côté client par getRedirectResult() — l'app restait
// bloquée sur "Se connecter avec Google" malgré une connexion Google authentique et acceptée. Cause
// confirmée client-side (config/CSP/domaine autorisé tous vérifiés intacts, aucun rapport avec ça).
// Plusieurs versions majeures du SDK sont sorties depuis 10.14.1, avec des correctifs connus autour
// de la fiabilité de getRedirectResult()/de la persistance IndexedDB sur mobile — l'API modulaire
// utilisée ici (getAuth, signInWithRedirect, getRedirectResult, onAuthStateChanged, getFirestore...)
// est stable depuis v9, donc ce saut de version ne devrait rien casser côté appels utilisés.
const SDK_VERSION = '12.17.1';

let sdkPromise = null;
let firebaseAuth = null;
let firebaseDb = null;

/** Charge le SDK Firebase et initialise l'app — mémoïsé, un seul chargement réseau même si
    appelé plusieurs fois. Renvoie les sous-modules auth/firestore (les fonctions dont on a
    besoin, ex. signInWithPopup, doc, setDoc — l'API modulaire de Firebase les expose ainsi). */
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

/** Renvoie l'utilisateur connecté (flux popup, résolu tout de suite) ou `null` (flux redirection :
    la page navigue vers Google puis revient sur l'app — l'appelant n'a rien à faire d'autre,
    handlePendingRedirect() complète la connexion au rechargement, voir renderCloudBackupSection). */
export async function signInWithGoogle() {
  const { authMod } = await ensureFirebase();
  const provider = new authMod.GoogleAuthProvider();
  if (shouldPreferRedirect()) {
    await setSetting('cloudRedirectPending', true);
    await authMod.signInWithRedirect(firebaseAuth, provider);
    return null;
  }
  try {
    const result = await authMod.signInWithPopup(firebaseAuth, provider);
    return result.user;
  } catch (err) {
    if (!POPUP_FALLBACK_CODES.has(err.code)) throw err;
    await setSetting('cloudRedirectPending', true);
    await authMod.signInWithRedirect(firebaseAuth, provider);
    return null;
  }
}

/** À appeler après ensureFirebase() si un cloudRedirectPending est en cours : complète la
    connexion démarrée par signInWithRedirect() avant que la page ne navigue vers Google.
    Sans effet (retourne vite) s'il n'y a en fait aucune redirection en attente. */
async function handlePendingRedirect(authMod) {
  if (!(await getSetting('cloudRedirectPending', false))) return;
  try {
    const result = await authMod.getRedirectResult(firebaseAuth);
    if (result?.user) await setSetting('cloudBackupWasSignedIn', true);
  } finally {
    await setSetting('cloudRedirectPending', false);
  }
}

/** Précharge le SDK Firebase en arrière-plan, sans attendre ni faire échouer l'appelant en cas
    d'erreur (hors-ligne, etc.) — à appeler dès qu'un bouton "Se connecter avec Google" devient
    visible (pas à chaque démarrage de l'app, toujours dans le respect du chargement paresseux :
    seulement quand l'UI concernée est réellement affichée). Corrige un problème concret signalé
    par l'auteur sur mobile : signInWithGoogle() appelait jusqu'ici ensureFirebase() (chargement
    réseau du SDK depuis gstatic.com) APRÈS le clic de l'utilisateur, avant de tenter
    signInWithPopup() — sur un réseau mobile plus lent, ce délai suffit à faire perdre au navigateur
    la notion de "geste utilisateur direct" nécessaire pour autoriser window.open(), donc la popup
    se faisait bloquer (perçue comme une popup non sollicitée), déclenchant le repli vers
    signInWithRedirect() — qui échoue lui-même de façon distincte et confirmée
    (auth/missing-initial-state, cloisonnement du stockage tiers sur mobile, voir CLAUDE.md). En
    préchargeant le SDK dès l'affichage du bouton, le SDK est déjà prêt au moment du clic : la popup
    s'ouvre alors dans le même tick que le geste utilisateur, sans le délai qui la faisait échouer. */
export function warmUpFirebaseSdk() {
  ensureFirebase().catch(() => {});
}

export async function signOutGoogle() {
  const { authMod } = await ensureFirebase();
  await authMod.signOut(firebaseAuth);
}

/** Regroupe la séquence "compléter une redirection Google en attente puis attendre l'état de
    connexion réel" — utilisée par renderCloudBackupSection() (Paramètres), checkCloudStaleness() et
    checkPendingCloudRedirect() ci-dessous : les trois ont exactement le même besoin (savoir si un
    utilisateur est connecté, y compris juste après un retour de signInWithRedirect()). Renvoie
    l'utilisateur Firebase ou null. */
export async function resolveCloudUser() {
  const { authMod } = await ensureFirebase();
  await handlePendingRedirect(authMod);
  return waitForAuthReady(authMod);
}

/** À appeler dès que possible après le déverrouillage (onUnlocked(), app.js) : jusqu'ici, un retour
    de signInWithRedirect() (mobile/PWA installée) n'était traité que passivement, quand l'utilisateur
    pensait à rouvrir Paramètres — potentiellement bien après le retour réel, et l'éventuel échec de
    getRedirectResult() (result vide, erreur Firebase) était avalé sans aucun signal visible : la
    section Paramètres retombait juste sur "Se connecter avec Google" sans dire pourquoi. Ne charge le
    SDK Firebase que si une redirection est réellement en attente (cloudRedirectPending) — jamais pour
    un utilisateur qui n'a pas touché à cette fonctionnalité, même principe de chargement paresseux que
    le reste de ce fichier. Résultat toujours rendu visible (succès, échec silencieux, ou erreur avec
    son message réel) pour permettre un vrai diagnostic la prochaine fois que ça se reproduit. */
export async function checkPendingCloudRedirect() {
  if (!isFirebaseConfigured) return;
  if (!(await getSetting('cloudRedirectPending', false))) return;
  try {
    const user = await resolveCloudUser();
    if (user) {
      await setSetting('cloudBackupWasSignedIn', true);
      showToast(t('Connecté à Google ({email}).', { email: user.email || user.displayName || '' }));
    } else {
      showToast(t("La connexion à Google n'a pas abouti (aucun utilisateur retourné). Réessayez depuis Paramètres."));
    }
  } catch (err) {
    showToast(t('Échec de la connexion Google : {message}', { message: err.message || String(err) }));
  }
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
  // Ne charge le SDK au chargement des Paramètres que si une connexion précédente est connue, OU
  // qu'un retour de redirection Google est en attente (flux mobile/PWA installée, voir
  // shouldPreferRedirect()) — sinon un utilisateur qui n'a jamais touché à cette fonctionnalité
  // ne déclenche jamais le chargement réseau du SDK Firebase rien qu'en ouvrant ses Paramètres.
  if (await getSetting('cloudBackupWasSignedIn', false) || await getSetting('cloudRedirectPending', false)) {
    try {
      user = await resolveCloudUser();
      if (!user) await setSetting('cloudBackupWasSignedIn', false);
    } catch {
      // Hors-ligne ou service indisponible : reste affiché comme déconnecté, pas d'erreur bloquante.
    }
  } else {
    // Ce visiteur n'a jamais utilisé la fonctionnalité : le bouton "Se connecter avec Google" est
    // sur le point d'être affiché plus bas — précharge le SDK dès maintenant en arrière-plan pour
    // que le clic à venir déclenche signInWithPopup() sans délai réseau (voir warmUpFirebaseSdk()).
    warmUpFirebaseSdk();
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
      if (!user) return; // flux redirection : la page va naviguer vers Google, rien d'autre à faire ici
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
