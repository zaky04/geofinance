# GeoFinance System — Notes de suivi du projet

> Ce fichier sert de mémoire du projet pour toute personne (ou IA) qui reprend le développement.
> À tenir à jour à chaque session de travail significative : ce qui a été fait, pourquoi, et ce qui reste ouvert.
> Dernière mise à jour : **15 août 2026**.

## 1. C'est quoi ce projet

**GeoFinance System** — une PWA de gestion financière personnelle, tout-en-un : portefeuilles multi-devises,
transactions, budgets (mode enveloppe façon YNAB), épargne, investissements (financiers + biens physiques),
dettes/créances, partage de dépenses, rapports, outils de simulation (achat important, fonds d'urgence,
remboursement de dette), OCR de justificatifs.

**Dépôt** : https://github.com/zaky04/geofinance (déployé sur GitHub Pages).
**Auteur** : Adtcheko 5T/ · contact : ronywest01@gmail.com (voir signature dans Paramètres).

### Vision produit (déduite du code — non documentée ailleurs, à confirmer avec l'auteur si besoin)

- **Local-first et privé** : toutes les données vivent exclusivement dans l'IndexedDB du navigateur, jamais
  sur un serveur. Pas de compte, pas de backend, pas de télémétrie.
- **Hors-ligne d'abord** : Service Worker en cache-first, l'app doit rester 100% utilisable sans réseau.
- **Cible internationale, accent Afrique de l'Ouest/Centrale** : devises XOF/XAF natives, type de portefeuille
  "Mobile Money" dédié, autres devises courantes de la zone (MAD, NGN, GHS) en plus des devises classiques
  (EUR, USD, GBP...).
- Positionnement donc clairement **différent d'un SaaS cloud classique** (type YNAB/Mint) : pas de sync
  multi-appareil, en échange d'une confidentialité totale.

## 2. Architecture technique

**Aucun framework, aucun build step.** JS vanilla en modules ES (`<script type="module">`), chargés
directement par le navigateur. Pas de `package.json`, pas de bundler, pas de TypeScript.

```
index.html              — SPA à vues multiples (une <div class="view"> par onglet, affichée/masquée en JS)
sw.js                    — Service Worker : precache complet de l'app shell, cache-first + purge à l'activation
manifest.json            — Manifest PWA (installable)
css/styles.css           — Tout le style, un seul fichier
js/
  app.js                 — Bootstrap + routeur SPA (navigateTo), verrouillage auto, bus d'événements global
  state.js                — Store applicatif minimal : EventBus (pub/sub) + appState partagé
  db.js                    — Couche IndexedDB : CRUD génériques, STORES, export/import complet
  ledger.js                — Moteur de calcul financier partagé (soldes, patrimoine net, agrégats mensuels...)
                              → TOUTE la logique de calcul vit ici, les modules de vue ne font qu'afficher
  auth.js                  — PIN (PBKDF2-SHA256) + biométrie WebAuthn + écran de verrouillage (machine à états)
  backup.js                — Export/import JSON (clair + chiffré AES-GCM), import CSV (GeoFinance + générique
                              avec mapping de colonnes), rappel hebdomadaire de sauvegarde
  utils.js                 — Formatage devises/dates, conversion multi-devises, helpers UI (modal, toast...)
  charts.js                — Wrapper autour de Chart.js (vendorisé)
  ocr.js                    — Wrapper autour de Tesseract.js (vendorisé) pour scanner les justificatifs
  notifications.js         — Notifications proactives (budgets dépassés, échéances...)
  install-prompt.js        — Invite d'installation PWA (beforeinstallprompt + fallback iOS)
  modules/                 — Un fichier par onglet de navigation : dashboard, wallets, transactions, budgets,
                              savings, investments, debts, tools, reports (+reports-extras), shared,
                              kept-accounts (optionnel, activable dans Paramètres), search, settings.
                              Chaque module exporte render*() et init*Module().
vendor/                    — Chart.js, jsPDF, Tesseract.js vendorisés (pas de CDN, tout doit marcher hors-ligne)
```

**Stockage** : IndexedDB (`geofinance-db`, version actuelle `4`), 19 object stores (voir `STORES` dans `db.js`).
Identifiants applicatifs en UUID (pas d'auto-increment) pour permettre l'import/merge sans collision.
`keptAccounts`/`keptAccountEntries` sont volontairement isolés : aucune fonction de `ledger.js` ne doit
jamais les lire (argent de tiers, pas de l'utilisateur — ne doit jamais entrer dans le patrimoine net).

**Communication entre modules** : bus d'événements (`state.js`). Toute écriture en base doit être suivie d'un
`notifyDataChanged(scope)` pour que la vue active se re-rende.

## 3. Conventions à respecter impérativement

1. **⚠️ Bump `CACHE_VERSION` dans `sw.js` à CHAQUE modification d'un fichier JS/CSS/HTML.** Le Service Worker
   est cache-first strict : sans bump, les utilisateurs déjà installés ne verront JAMAIS les changements
   (même après refresh). C'est la source de bug la plus facile à oublier sur ce projet.
2. **Tout texte utilisateur inséré via `innerHTML` doit passer par `escapeHtml()`** (`utils.js`). Le projet est
   rigoureux là-dessus (audité, aucune faille XSS trouvée) — à maintenir.
3. **Dates** : toujours `localISODate()` / `todayISO()` (`utils.js`), jamais `.toISOString()` directement sur
   une date locale — `.toISOString()` convertit en UTC et peut faire dériver la date d'un jour selon le fuseau.
4. **Argent** : `Number` JS classique, pas de représentation en centimes entiers (voir dette technique §5).
   Toujours passer par les fonctions de `ledger.js` pour les agrégats — ne pas resommer des transactions
   à la main dans un module de vue.
5. **UI entièrement en français**, y compris les commentaires de code. Rester cohérent.
6. **Commits** : messages en français, descriptifs, un commit = un lot de fonctionnalités/correctifs cohérent
   (voir `git log` pour le style). Toujours terminer par le bump de `CACHE_VERSION` si du JS a changé.

## 4. Lancer le projet en local

Pas de build. Servir les fichiers statiques (les modules ES ne fonctionnent pas en `file://`) :

```bash
powershell -ExecutionPolicy Bypass -File geofinance/serve.ps1 -Port 8123
```

Ou via `.claude/launch.json` (config `geofinance`, port 8123) avec les outils de preview.

**Aucun test automatisé, aucun lint, aucune CI configurée** (voir dette technique).

## 5. Dette technique connue (identifiée par audit, 12 août 2026)

| # | Sujet | Détail | Sévérité |
|---|---|---|---|
| 1 | ~~Pas de tests automatisés~~ | **Résolu le 14 août 2026** — voir §11 (`test/ledger.test.html`). | — |
| 2 | Arithmétique flottante | Les montants sont des `Number` JS sommés directement, pas de représentation en centimes entiers. L'affichage arrondit (masque la plupart des cas). **Comparaisons de seuil corrigées le 14 août 2026** (tolérance 0.005, voir §6) — reste vrai pour toute future comparaison exacte à ajouter : y penser. | Faible |
| 3 | PIN : limite inhérente au 100% client-side | PBKDF2 150k itérations protège contre un accès "casual", pas contre une extraction forensique de l'IndexedDB brute (pas de coffre matériel disponible sans backend). Ce n'est pas un bug corrigible facilement, juste une limite du modèle à garder en tête. | Info (pas actionnable) |
| 4 | ~~Import CSV générique silencieux sur montant invalide~~ | **Résolu le 14 août 2026** — voir §6. | — |
| 5 | Pas de doc de vision/roadmap versionnée | Avant ce fichier, aucun README/CLAUDE.md n'existait — la vision produit ne se lisait que dans les messages de commit. | Résolu par ce fichier (à maintenir) |

**Trouvé lors de la revue de bugs du 15 août 2026 (au-delà du diff du jour, voir §6) — corrigé sur-le-champ :**

| # | Sujet | Détail | Sévérité |
|---|---|---|---|
| 6 | ~~XSS via `currencySelectHtml()`~~ | **Corrigé** — `utils.js` interpolait un code devise non échappé dans un attribut HTML ; un import CSV/JSON pouvait y injecter du HTML/JS arbitraire (contournait la limite de 3 caractères que la saisie normale impose). | Résolu |
| 7 | ~~`formatCurrency()` affichait des décimales pour XOF/XAF~~ | **Corrigé** — `"1 234,5 F CFA"` au lieu de `"1 235 F CFA"` sur tout montant non entier, alors que ce sont des devises sans sous-unité usuelle (marché cible de l'app). | Résolu |
| 8 | ~~Export CSV : double échappement~~ | **Corrigé** — `exportTransactionsCsv` appelait `csvEscape` deux fois sur 4 colonnes ; un nom contenant `;` ressortait avec des guillemets quadruplés, cassant le ré-import. | Résolu |
| 9 | ~~`detectRecurringCandidates` n'excluait jamais les récurrences actives~~ | **Corrigé** — comparait la note brute (`"Récurrence : Loyer"`) au nom de la récurrence (`"loyer"`), qui ne correspondent jamais ; re-proposait en boucle des récurrences déjà déclarées. | Résolu |
| 10 | ~~`computeEnvelopeCarryover` incluait les mouvements de dette/créance~~ | **Corrigé** — seul agrégat mensuel du fichier sans le filtre `!t.debtId` que tous ses voisins appliquent ; divergeait de l'"actual" réellement affiché. | Résolu |
| 11 | ~~Course critique sur le compteur d'échecs PIN~~ | **Corrigé** (`auth.js`) — deux `verifyPin()` concurrents (backspace + nouveau chiffre pendant qu'un calcul PBKDF2 est en cours) pouvaient sous-compter `failedAttempts`, retardant le blocage anti-brute-force. Verrou `verifying` ajouté. | Résolu |
| 12 | ~~Déverrouillage biométrique ne levait pas le blocage PIN~~ | **Corrigé** (`auth.js`) — un utilisateur throttlé après 5 échecs de PIN qui se déverrouillait par empreinte restait bloqué au PIN au verrouillage suivant. | Résolu |
| 13 | ~~Rappel de sauvegarde (local ET cloud) : 3e report annulé par lui-même~~ | **Corrigé** (`backup.js`, `firebase-sync.js`) — `>=` au lieu de `>` faisait passer le mode "urgent" avant que le répit de 24h du 3e clic "Plus tard" n'ait eu la moindre chance de s'écouler. | Résolu |

**Trouvé mais volontairement pas corrigé cette session — à prioriser avec l'auteur :**

| # | Sujet | Détail | Sévérité |
|---|---|---|---|
| 14 | `parseFlexibleNumber` (import CSV générique) mélit un séparateur de milliers pour une décimale | `"1,234,567"` (US, sans point) devient `1.234` — perte de magnitude silencieuse. Nécessite une vraie heuristique (ou un choix explicite du format par l'utilisateur), pas un correctif d'une ligne. | Moyenne-Haute |
| 15 | `dbBulkPut`/`importAllData` non atomiques entre stores | Une ligne malformée en cours d'import (backup forgé/corrompu) peut laisser la base dans un état "moitié ancien, moitié nouveau" jamais voulu, sans indiquer à l'utilisateur quels stores ont réussi. | Moyenne |
| 16 | `isDuplicateTransaction` (dédoublonnage import) : clé = portefeuille+date+type+montant | Deux dépenses identiques et légitimes le même jour (ex: deux cafés à 3,50€) sont silencieusement fusionnées à l'import ; les virements ne comparent pas `targetWalletId`. | Moyenne |
| 17 | `upgrade()` (`db.js`) n'ajoute jamais un index à un store déjà existant | Si une future version ajoute un index sur un store existant, les utilisateurs déjà installés ne l'obtiendront jamais (`createIndex` n'est appelé que dans la branche "store tout neuf") — bombe à retardement, pas un bug actif aujourd'hui. | Info (à surveiller) |
| 18 | `computeEnvelopeCarryover` casse la chaîne sur un mois intermédiaire sans budget | Si janvier a un budget mais février non (bien que dépensé), le report de mars ignore complètement les dépenses de février. | Faible-Moyenne |
| 19 | Réception d'un justificatif corrompu abandonne tout l'import | `deserializeReceiptsForImport` (`backup.js`) n'a pas de `try/catch` par ligne — une seule photo corrompue fait échouer toute la restauration au lieu de sauter ce justificatif. | Faible-Moyenne |
| 20 | Échec de sauvegarde automatique (File System Access) jamais signalé | `runAutoBackupIfConfigured` avale les erreurs d'écriture (dossier supprimé, quota) avec un simple `console.warn` — l'utilisateur peut croire être protégé alors que rien n'est écrit depuis longtemps. | Moyenne |
| 21 | `openModal()` : une touche Échap ferme TOUTES les modales empilées, pas juste la dernière | Chaque modale enregistre son propre listener sans notion de pile — deux `confirmDialog` accidentellement superposées se ferment ensemble sur un seul Échap. | Faible |
| 22 | `parseFlexibleDate` suppose toujours JJ/MM/AAAA | Un relevé au format US (MM/DD/YYYY) est mal interprété silencieusement pour toute date où jour et mois sont tous deux ≤ 12 — limite documentée dans le code, mais aucun signalement si un fichier non européen est importé. | Faible |
| 23 | `verifyPin()` n'a pas de limite anti-brute-force intégrée | Le blocage de 30s n'existe que côté clavier de l'écran de verrouillage (`auth.js`, UI) — `changePin()` (Paramètres → Changer le code PIN) appelle `verifyPin()` directement, sans aucune limite sur les tentatives d'"ancien code". | Faible-Moyenne |


## 6. Journal des correctifs

### 12 août 2026 — 3 correctifs de fiabilité (commit à venir)

Suite à un audit complet (statique + tests en conditions réelles dans le navigateur), 3 problèmes concrets
ont été identifiés et corrigés :

1. **Taux de change à 1:1 silencieusement faux** (`wallets.js`, `ledger.js`, `dashboard.js`)
   Un nouveau taux de change (créé automatiquement au 1er portefeuille/investissement/dette dans une devise
   étrangère) était enregistré à `rateToBase: 1` sans que l'utilisateur en soit informé — ce qui fausse
   silencieusement le patrimoine net (grave pour la cible XOF/XAF où 1 EUR ≈ 656 XOF, pas 1).
   → Ajout d'un champ `confirmed: false` sur les taux non validés par l'utilisateur, avec alerte visible sur
   le tableau de bord (`#dashboard-alerts`) et mise en évidence dans le panneau Portefeuilles tant que le
   taux n'a pas été corrigé manuellement (passe à `confirmed: true` à la saisie).

2. **Rappel de sauvegarde hebdomadaire repoussable indéfiniment** (`backup.js`, `index.html` template)
   Le bouton "Plus tard" permettait de repousser le rappel par tranches de 24h sans limite, ce qui va à
   l'encontre de l'unique protection contre la perte de données (tout vit en local, sans sync cloud).
   → Ajout d'un compteur `backupSnoozeCount`. Au-delà de 3 reports, le rappel passe en mode "urgent" :
   le bouton "Plus tard" est retiré (seul "Exporter maintenant" reste), et le compteur n'est remis à zéro
   qu'après un export réellement effectué (`markBackupDone()`, appelé par les 3 chemins d'export/backup auto).

3. **Blocage anti-brute-force du PIN annulé par un simple rechargement de page** (`auth.js`)
   Après 5 échecs, un délai de 30s (`throttledUntil`) était prévu mais stocké uniquement en variable JS
   locale — recharger la page l'annulait instantanément alors que le compteur d'échecs, lui, était persisté.
   → `pinThrottledUntil` est maintenant persisté en base et relu à l'entrée en mode déverrouillage ; un
   message de décompte s'affiche pendant le blocage au lieu d'ignorer silencieusement les frappes.

`CACHE_VERSION` : `v25` → `v26`.

Les 3 correctifs ont été testés en conditions réelles dans le navigateur (création de portefeuille en devise
étrangère, simulation de 5 échecs de PIN + reload, simulation de 3 reports de sauvegarde + export) — voir
détails de session si besoin de les rejouer.

### 13 août 2026 — 3 fonctionnalités demandées par l'utilisateur après usage réel (commit à venir)

1. **Dettes & créances liées aux portefeuilles** (`debts.js`, `ledger.js`, `db.js`)
   Créer/rembourser une dette ne touchait aucun portefeuille (aucun `walletId` dans le schéma).
   → À la création (uniquement, pas en édition) : case "Cet argent bouge aujourd'hui" cochée par défaut +
   portefeuille (filtré à la devise de la dette) ; si cochée, crée une transaction liée (`debtId`) sur ce
   portefeuille. Le remboursement exige toujours un portefeuille. Les transactions liées à une dette sont
   **exclues** des agrégats mensuels de `ledger.js` (`computeMonthSummary` et 6 autres fonctions filtrent
   `if (t.debtId) continue`) — emprunter/rembourser n'est pas une dépense/recette discrétionnaire, seul le
   solde du portefeuille doit bouger. Vérifié : emprunter 200€ ne change pas le patrimoine net (portefeuille
   +200, dette −200) et n'apparaît pas dans "Entrées (mois)".
   Suppression d'une dette supprime aussi ses transactions liées (ouverture + remboursements), restaurées si
   "Annuler".

2. **Partage de dépenses → transaction "ma part"** (`shared.js`)
   Le module était totalement isolé des portefeuilles/transactions (par design initial, pour ne pas fausser
   le patrimoine net). L'utilisateur voulait que sa part réelle apparaisse dans son budget.
   → `PARTICIPANTS` gagne un flag `isMe` (un seul participant à la fois, bouton "Définir comme moi"). Si le
   participant "Moi" fait partie du partage, `montant ÷ nb participants` (sa part, PAS le montant total, quel
   que soit le payeur) devient une vraie transaction dépense (`sharedExpenseId` sur la transaction, catégorie
   + portefeuille choisis dans le formulaire, portefeuille filtré à la devise de la dépense). Contrairement
   aux dettes, cette transaction compte normalement dans les agrégats (c'est une vraie dépense personnelle).
   Suppression de la dépense partagée supprime aussi la transaction liée.

3. **Comptes gardés** (nouveau, `js/modules/kept-accounts.js`)
   Nouvelle fonctionnalité : suivre l'argent de tiers (petit frère, conjointe, mère...) que l'utilisateur
   garde/gère, avec ses propres entrées/sorties. Activable/désactivable dans Paramètres (`keptAccountsEnabled`,
   décoché par défaut) — masque/affiche le bouton de nav `#nav-kept-accounts`.
   → 2 nouveaux stores IndexedDB (`KEPT_ACCOUNTS`, `KEPT_ACCOUNT_ENTRIES`, DB_VERSION `3` → `4`), module calqué
   sur `wallets.js` mais **totalement autonome** : `ledger.js` ne les lit jamais, aucun impact sur le
   patrimoine net (vérifié : créer un compte gardé + mouvements ne change pas "Patrimoine net global").

`CACHE_VERSION` : `v26` → `v27`. Nouveau fichier `js/modules/kept-accounts.js` ajouté au précache de `sw.js`.

Les 3 fonctionnalités ont été testées de bout en bout dans le navigateur (dette avec/sans mouvement de
portefeuille + remboursement, dépense partagée avec transaction liée + suppression en cascade, activation/
usage/désactivation des comptes gardés) — aucune erreur console à aucune étape.

### 13 août 2026 (suite) — 4 améliorations issues d'une analyse concurrentielle (commit à venir)

1. **Raccourcis PWA cassés, corrigés** (`app.js`) — `manifest.json` déclare `?action=quick-add` et
   `?view=X` (appui long sur l'icône) depuis le début, mais rien ne lisait jamais `location.search`. Ajout de
   `applyShortcutParams()`, appelée après déverrouillage, qui nettoie l'URL ensuite (`history.replaceState`)
   pour ne pas rejouer l'action à chaque re-déverrouillage.
2. **`navigator.storage.persist()`** (`app.js`, au boot) — réduit le risque d'éviction de l'IndexedDB par le
   navigateur sous pression de stockage (best-effort, silencieux si refusé — dépend de l'heuristique du
   navigateur, ex: PWA installée + usage engagé favorisent l'octroi).
3. **Taux de change en un clic, optionnel** (`wallets.js`) — bouton "Actualiser via internet" dans le panneau
   Portefeuilles, `open.er-api.com` (gratuit, sans clé). Best-effort explicite : tout échec (hors-ligne,
   devise absente de la réponse) se dégrade en toast, jamais en blocage — la saisie manuelle reste toujours
   possible. Marque les taux `confirmed: true` à la récupération (résout l'alerte §6.1).
4. **Onboarding au premier lancement** (`app.js`, `openWalletModal` exporté de `wallets.js`) — juste après la
   création du PIN sur une installation neuve : choix de la devise principale (à faire AVANT tout taux de
   change existant, la changer plus tard les réinitialise) puis enchaîne directement sur la création du
   premier portefeuille. Garde double (`onboardingCompleted` ET aucun portefeuille existant) pour ne jamais
   se déclencher sur une install déjà en usage qui met à jour vers cette version.

`CACHE_VERSION` : `v27` → `v28`.

Testé en conditions réelles : raccourcis `?view=` et `?action=quick-add` fonctionnels, taux USD/XOF récupéré
en ligne (568,83, cohérent avec un vrai taux de marché) et alerte "non confirmé" levée automatiquement,
onboarding déclenché sur base de données neuve et absent sur une base existante avec portefeuilles.

**Note** : la piste "capture SMS mobile money via Web Share Target" (évoquée dans la même analyse) a été
volontairement laissée de côté à la demande de l'auteur — elle reste une bonne idée mais nécessite son
propre cadrage (`manifest.json` share_target, nouveau parseur, `sw.js`) avant d'être attaquée.

### 13 août 2026 (suite) — Audit de sécurité (commit à venir)

**Faille corrigée — la sauvegarde JSON exportait le hash et le sel du PIN.** `exportAllData()` (`db.js`)
itérait tous les stores sans exception, y compris `SETTINGS`, qui contient `pinHash`/`pinSalt`
(PBKDF2), `biometricPublicKeySpki`/`biometricCredentialId`. Concrètement : exporter une sauvegarde JSON
**en clair** (bouton "Exporter (JSON)", pas la variante chiffrée) faisait sortir de l'appareil, sans
aucune protection supplémentaire, exactement le matériel nécessaire pour attaquer le PIN hors-ligne — un
PIN à 4-6 chiffres tombe en quelques secondes/minutes une fois le hash+sel en main, malgré les 150k
itérations PBKDF2 (l'espace de recherche est trop petit, pas la fonction de hachage qui est en cause).
→ Nouvelle liste `DEVICE_LOCAL_SETTING_KEYS` dans `db.js`, filtrée hors de `exportAllData()` — donc hors
des DEUX variantes d'export (chiffré compris, par défense en profondeur) et de la sauvegarde auto. Effet de
bord assumé : restaurer une sauvegarde en mode "remplacer tout" oblige désormais à recréer un code PIN sur
l'appareil de destination au lieu d'hériter silencieusement de celui de la sauvegarde — c'est le comportement
correct (comparable à n'importe quel gestionnaire de mots de passe). Le mode "fusionner" n'est pas affecté
(le PIN actuel de l'appareil n'est jamais touché). Au passage, `autoBackupDirHandle` (un
`FileSystemDirectoryHandle`, objet natif non sérialisable) est exclu aussi — il produisait une entrée cassée
sans intérêt dans l'export.

Autres correctifs, plus mineurs, trouvés en creusant :
- **Injection de formule CSV (OWASP CSV Injection)** — `csvEscape()` dans `backup.js` ne neutralisait pas un
  champ commençant par `=`, `+`, `-` ou `@`, qu'Excel/Sheets peut interpréter comme une formule à
  l'ouverture. Risque réel via l'import de relevé bancaire générique (note/libellé venant d'un tiers) puis
  ré-export. Préfixe désormais ces champs d'une apostrophe.
- **Robustesse du fetch de taux en ligne** (§6.3 ci-dessus) — une réponse malformée du service externe
  pouvait produire `NaN`/`Infinity` stocké comme taux. Validation `isFinite(...) && > 0` ajoutée avant
  écriture.

Zones vérifiées et jugées saines (déjà auditées le 12 août, revérifiées avec le code ajouté depuis) :
échappement HTML systématique (`escapeHtml`) sur tout le nouveau code (dettes/partage/comptes gardés),
WebAuthn (challenge aléatoire, vérification ECDSA locale correcte), pas d'`eval`/`Function`/`document.write`
dans le code propre à l'app (seulement dans les libs vendorisées, attendu), pas de `target="_blank"` non
protégé.

`CACHE_VERSION` : `v28` → `v29`.

### 13 août 2026 (suite) — Audit de sécurité avancé, 2e passe (commit à venir)

**Faille la plus sérieuse trouvée cette passe — l'import pouvait injecter un PIN choisi par un
attaquant.** Le filtre `DEVICE_LOCAL_SETTING_KEYS` posé lors du premier audit (§ précédente) protégeait
l'EXPORT, mais pas l'IMPORT : `importAllData()` faisait un `dbBulkPut` direct des lignes du fichier fourni,
sans filtre. Un fichier de "sauvegarde" forgé contenant `{key:'pinHash', value: <hash choisi par
l'attaquant>}` (+ `pinSalt` assorti), importé via "Importer (JSON) → Fusionner", **remplaçait
silencieusement le PIN de l'appareil** — l'utilisateur légitime se retrouve verrouillé dehors, ou pire,
l'attaquant connaît déjà le PIN correspondant au hash qu'il a fourni et peut déverrouiller l'app plus tard.
Vecteur réaliste : ingénierie sociale ("voici un budget partagé, importe ce fichier"). → Le même filtre
`DEVICE_LOCAL_SETTING_KEYS` s'applique maintenant aussi côté import (`db.js`), donc ces clés ne peuvent
JAMAIS être posées autrement que par les flux internes d'`auth.js` (`setupPin`, `changePin`,
`registerBiometric`). Vérifié par une attaque simulée : import d'un `pinHash` forgé → hash réel inchangé,
PIN d'origine toujours fonctionnel après reload.

**Autres correctifs de cette passe :**
- **`Number(x) || 0` ne filtre pas `Infinity`** (il est "truthy", contrairement à `NaN`/`0`/`undefined`) —
  idiome utilisé partout dans `ledger.js`. Une valeur `"Infinity"` dans un CSV/JSON importé s'y propageait
  donc telle quelle. Ajoute `safeNumber()` dans `utils.js` (rejette aussi Infinity/-Infinity), utilisée à
  l'import CSV format GeoFinance ; ajoute un sanitizer générique dans `importAllData()` qui ramène à 0 tout
  champ `number` non fini sur les lignes importées, tous stores confondus. Vérifié par attaque simulée
  (portefeuille importé avec `initialBalance: Infinity` → stocké à `0`).
- **Content-Security-Policy ajoutée** (`index.html`) — défense en profondeur : aucune faille XSS connue,
  mais si une apparaissait, `script-src 'self'` bloque tout script distant/injecté. A nécessité de sortir le
  `<script>` inline d'enregistrement du Service Worker vers un fichier externe (`js/sw-register.js`), sinon
  incompatible avec `script-src` sans `'unsafe-inline'`. `style-src` garde `'unsafe-inline'` (le CSS de
  l'app repose largement sur des attributs `style=""` — un refactor en classes CSS est un chantier séparé,
  pas une urgence sécurité vu que XSS-via-CSS est un vecteur bien plus faible que XSS-via-JS, déjà bloqué
  par `script-src`). `connect-src` autorise `open.er-api.com` (taux de change en ligne) ; `worker-src 'self'
  blob:` nécessaire pour le Worker Tesseract (OCR). Testé : PDF (jsPDF), OCR (Worker Tesseract, blob PNG de
  test), fetch de taux en ligne, et les 11 vues de l'app — tout fonctionne sous la nouvelle politique.
  `frame-ancestors` volontairement absent (n'a aucun effet via `<meta>`, exige un en-tête HTTP — hors de
  portée d'un hébergement statique GitHub Pages).

`CACHE_VERSION` : `v29` → `v30`. Nouveau fichier `js/sw-register.js` ajouté au précache de `sw.js`.

### 13 août 2026 (suite) — Assistant de configuration multi-étapes (commit à venir)

À la demande de l'utilisateur : après le code PIN, avant le tableau de bord, un assistant en **7 étapes**
guide la première configuration au lieu du mini-flow à 2 étapes précédent (devise + portefeuille). Chaque
étape a un bouton "Passer cette étape" — rien n'est obligatoire au-delà du PIN lui-même (validé avec
l'utilisateur : décourager un premier lancement trop long serait pire que l'inverse), tout reste modifiable
ensuite dans Paramètres. Étapes, dans l'ordre : devise principale → premier portefeuille → profil → panneaux
du tableau de bord → modules optionnels → sécurité (verrouillage auto + biométrie) → notifications.

**Réutilisation plutôt que duplication** (`app.js` importe directement de `settings.js`/`dashboard.js`/
`auth.js`/`notifications.js`, aucune logique redéfinie) :
- `PROFILE_FIELDS`, `AUTO_LOCK_OPTIONS`, `DASHBOARD_PANEL_LABELS` exportés depuis `settings.js` (n'étaient
  que des consts locales avant).
- **`OPTIONAL_MODULES`** (`settings.js`) : la case "Comptes gardés" isolée est devenue une liste
  `[{key, label, description, navId, view}]` — actuellement un seul élément, mais l'ajout d'un futur module
  optionnel ne demandera qu'une entrée ici (ni `renderFeaturesSection()`, ni l'étape "Modules" de
  l'onboarding, ni `openMoreSheet()` dans `app.js` n'ont à changer). `applyOptionalModuleVisibility()`
  (exportée, remplace l'ancienne `applyKeptAccountsVisibility()` propre aux comptes gardés) boucle sur cette
  liste pour afficher/masquer les boutons de nav correspondants.
- `openWalletModal()` (`wallets.js`) accepte désormais `{ onDone }`, threadé vers le `onClose` déjà supporté
  par `openModal()` — l'étape "portefeuille" masque la modale de l'assistant (`style.display='none'`) pendant
  que la modale de création de portefeuille (réutilisée telle quelle) est ouverte par-dessus, puis la
  réaffiche et avance à l'étape suivante quand celle-ci se ferme (créée ou annulée, peu importe).

Testé en conditions réelles, deux fois : parcours complet en remplissant chaque étape (devise XOF, portefeuille
créé avec la bonne devise pré-sélectionnée, profil, panneaux dashboard, module Comptes gardés activé — nav
visible immédiatement en cours de parcours —, verrouillage auto, notifications) puis vérification en base que
tout est bien enregistré ; et parcours complet en appuyant sur "Passer" à chaque étape (aucune erreur, aucun
portefeuille créé, fermeture propre). La page Paramètres elle-même re-testée après le refactor des exports —
toujours fonctionnelle. Le rappel de sauvegarde hebdomadaire (modal indépendant, 4s après déverrouillage) peut
apparaître par-dessus l'assistant sur un tout premier lancement — comportement de pile de modales déjà toléré
ailleurs dans l'app, pas une régression.

### 13 août 2026 (suite) — Tentative de sync cloud Firebase, ajoutée puis annulée (hors session Claude)

Deux commits sont apparus entre deux sessions, faits en dehors de cette conversation (probablement une autre
session/outil sur ce même dossier local) : `feat: ajout synchronisation cloud Firebase (Firestore + Google
Auth)` puis son revert complet juste après (35 min plus tard). Résultat net : **aucun changement de code**
(diff vide entre avant/après les deux commits). Personne n'a expliqué le pourquoi de l'annulation dans cette
conversation — si la sync multi-appareil est reprise un jour (voir §7), redemander le contexte de cette
tentative avant de relancer, plutôt que de repartir de zéro à l'aveugle.

### 13 août 2026 (suite) — Historique de commits réécrit pour corriger l'identité auteur

Les commits faits sur ce projet depuis `7f5943b` (toute cette série de sessions, y compris la tentative
Firebase ci-dessus) portaient l'identité `GeoFinance <karidja810@gmail.com>` (config git locale à ce dépôt,
distincte de la config globale de la machine) au lieu de `zaky04` (auteur de tous les commits précédents et
propriétaire du dépôt GitHub). Réécrit via `git filter-branch --env-filter` sur la plage `3ae34a2..HEAD` (7
commits, contenu strictement identique — seuls auteur/committer/hash ont changé) vers
`zaky04 <zaky04@users.noreply.github.com>` (même format que l'historique existant), puis
`git push --force-with-lease`. **Tous les hash de commits ont donc changé** — un `git log` gardé d'avant
cette date ne correspondra plus. La config git locale du dépôt n'a PAS été touchée (hors de portée d'une
session Claude) : sans correction manuelle par l'utilisateur (`git config user.name/user.email` dans ce
dossier), le PROCHAIN commit repartira avec la mauvaise identité.

### 13 août 2026 (suite) — Recherche globale + catégorisation automatique (commit à venir)

1. **Recherche globale n'indexait pas Comptes gardés ni Partage de dépenses** (`search.js`) — oubli mécanique,
   ces deux modules sont arrivés après l'écriture du module de recherche. Ajouté (comptes gardés seulement si
   `keptAccountsEnabled`, cohérent avec le fait que la nav elle-même reste masquée sinon).

2. **Catégorisation automatique unifiée et améliorée** — deux implémentations quasi-identiques dupliquées
   existaient : `suggestCategoryFromNote()` (`transactions.js`, Saisie express) et `guessCategory()`
   (`backup.js`, import CSV générique). Cette dernière **ne consultait jamais** `STORES.CATEGORIZATION_RULES`
   (les règles définies dans Budgets > Règles) — un import CSV de plusieurs dizaines de lignes de relevé
   bancaire ignorait donc silencieusement les règles que l'utilisateur avait pourtant configurées, alors que
   c'est exactement le scénario où l'auto-catégorisation compte le plus.
   → Nouvelle fonction partagée `guessCategoryId(note, type)` dans `ledger.js` (précédent explicite d'un tel
   partage : `detectRecurringCandidates()` dans le même fichier). Garde le même prédicat de correspondance
   qu'avant (égalité ou inclusion dans un sens ou l'autre — pas de régression sur ce qui matchait déjà), mais
   **choisit la catégorie la plus fréquente parmi les correspondances plutôt que celle de la transaction la
   plus récente** — une catégorisation ponctuellement erronée sur un achat récurrent ne fausse plus toutes
   les suggestions suivantes. Étend aussi la vérification des règles aux notes de type `income` (limitée à
   `expense` auparavant, sans raison technique).
   Vérifié par test réaliste : 2 transactions "Boulangerie du coin" catégorisées Alimentation + 1 plus
   récente catégorisée par erreur Autres dépenses → la suggestion renvoie bien Alimentation (majorité), pas
   la plus récente. Règle explicite "essence" → Transport testée sur l'import CSV générique → catégorie
   correctement appliquée (ne l'aurait jamais été avant ce fix).

`CACHE_VERSION` : `v31` → `v32`.

### 13 août 2026 (suite) — Les transactions de dette/créance n'étaient jamais catégorisées (commit à venir)

Signalé par l'utilisateur avec une capture de l'app déployée : les transactions créées par le lien
dettes↔portefeuilles (§ "13 août 2026 (suite) — 3 fonctionnalités...") avaient `categoryId: null` en dur,
volontaire à l'époque (pas de catégorie dédiée prévue) mais affichant "Sans catégorie" dans la liste des
transactions — repéré en prod (`zaky04.github.io/geofinance`) sur deux vraies transactions ("Prêt reçu de
gouv", "Prêt accordé à Sali").
→ `debts.js` : nouvelle `ensureDebtCategoryId(type)` (exportée), retrouve ou crée une catégorie "Prêt et
créance" — une par type (`income`/`expense`, les catégories sont scindées par type dans ce store) — utilisée
à la fois pour la transaction d'ouverture et celle de remboursement. Reste exclue des agrégats budgétaires
comme avant : ce fix ne touche que l'affichage (categoryId), pas le filtre `debtId` de `ledger.js`.
**Migration au boot** (`app.js`, `migrateDebtTransactionCategories()`, appelée à chaque démarrage — coût nul
une fois les lignes historiques corrigées) : rattrape automatiquement les transactions déjà en base avec
`debtId` mais sans `categoryId`, donc les transactions de l'utilisateur visibles sur la capture se corrigent
au prochain chargement de l'app, sans action de sa part.
Vérifié : transaction "cassée" (categoryId null) injectée manuellement → réapparaît "Prêt et créance" après
reload ; nouvelle dette créée → catégorisée immédiatement ; "Entrées (mois)" du dashboard reste à 0 malgré
2150€ de transactions "Prêt et créance" (l'exclusion budgétaire n'a pas été affectée par ce changement).

`CACHE_VERSION` : `v32` → `v33`.

### 13 août 2026 (suite) — "Prêt et créance" scindé en "Prêt" et "Créance" (commit à venir)

Retour utilisateur juste après le fix précédent : catégorie unique pas assez précise, voulait "Prêt" pour les
dettes et "Créance" pour les créances, distincts.
→ `debts.js` : `DEBT_CATEGORY_NAMES = { debt: 'Prêt', receivable: 'Créance' }` (exporté), `LEGACY_DEBT_CATEGORY_NAME
= 'Prêt et créance'` (exporté, gardé pour la migration). `ensureDebtCategoryId(debtType, txType)` prend
maintenant le type de la DETTE (`debt`/`receivable`) en plus du type de transaction (`income`/`expense`) — le
nom dépend du sens de la dette, pas du sens du mouvement d'argent, donc une dette (Prêt) garde "Prêt" aussi
bien à l'ouverture (income) qu'au remboursement (expense).
`app.js` `migrateDebtTransactionCategories()` étendue pour rattraper aussi les transactions déjà catégorisées
"Prêt et créance" (pas seulement `categoryId` null) en retrouvant la dette liée via `debtId` pour déterminer
Prêt vs Créance, **puis supprime les catégories "Prêt et créance" orphelines** (plus référencées ni par une
transaction ni par un budget) pour ne pas laisser de catégorie morte dans Budgets > Catégories.
Vérifié en conditions réelles : dette (Sali) + son remboursement → "Prêt" dans les deux cas ; créance (Awa) +
son remboursement → "Créance" dans les deux cas ; exclusion budgétaire toujours intacte ("Entrées/Sorties du
mois" à 0 malgré ~650€ de mouvements catégorisés) ; une transaction orpheline (debtId sans dette réelle
correspondante, artefact d'un test précédent) correctement laissée de côté par la migration plutôt que de
deviner — comportement défensif voulu, pas un bug.

`CACHE_VERSION` : `v33` → `v34`.

### 13 août 2026 (suite) — Sauvegarde cloud optionnelle via Google (Firebase Auth + Firestore)

Reprise cadrée de la tentative Firebase annulée plus tôt (§ "Tentative de sync cloud Firebase, ajoutée puis
annulée"). **Diagnostic confirmé** (horodatages git) : la CSP a été ajoutée à 12h34, Firebase à 15h51 —
`script-src`/`connect-src` bloquaient tous les domaines Google/Firebase, personne ne les avait ajoutés en
même temps. Reconstruit proprement cette fois, avec deux choix validés avec l'utilisateur avant de coder :

1. **Chiffré, pas en clair** — réutilise `buildEncryptedPayload`/`decryptPayload` (voir ci-dessous), le même
   chiffrement AES-GCM/PBKDF2 que l'export chiffré local, déjà éprouvé. Le mot de passe ne quitte jamais
   l'appareil ; même une mauvaise configuration des règles Firestore ne rendrait rien lisible.
2. **Sauvegarder/Restaurer à la demande, pas de synchro continue** — un seul document Firestore par
   utilisateur (clé = UID Google), contenant le blob chiffré. Aucun moteur de résolution de conflits à
   construire.

**Fichiers** :
- `backup.js` — extrait `buildEncryptedPayload(passphrase)`/`decryptPayload(payload, passphrase)` (exportées)
  du cœur d'`exportEncryptedBackup`/`importEncryptedBackup`, qui les appellent maintenant au lieu de dupliquer
  le chiffrement. `deserializeReceiptsForImport` et `markBackupDone` exportées aussi (réutilisées côté cloud).
- `js/firebase-config.js` (nouveau) — objet `firebaseConfig`, valeurs `'REPLACE_ME'` tant que l'utilisateur
  n'a pas créé son projet Firebase et fourni les vraies clés (pas secrètes — la sécurité vient des règles
  Firestore, pas de la confidentialité de l'apiKey). `isFirebaseConfigured` détecte l'état non configuré.
- `js/firebase-sync.js` (nouveau) — SDK Firebase (modular, CDN ESM, pas de build/npm) chargé **paresseusement**
  via `import()` dynamique, uniquement si une connexion précédente est connue (setting
  `cloudBackupWasSignedIn`) ou au clic sur "Se connecter" — jamais sur le chemin par défaut. `waitForAuthReady()`
  attend la première notification `onAuthStateChanged` plutôt que de lire `auth.currentUser` immédiatement
  après `getAuth()` (la restauration de session est asynchrone, lire trop tôt peut renvoyer null à tort).
  `signInWithGoogle`, `signOutGoogle`, `pushBackupToCloud`, `pullBackupFromCloud`, `renderCloudBackupSection`
  (UI montée dans Paramètres, nouveau conteneur `#settings-cloud-backup`).
- `index.html` — CSP étendue : `script-src` += gstatic/apis.google/googleapis, `connect-src` +=
  firestore/identitytoolkit/securetoken/firebaseio (+ `wss://`), nouvelle directive `frame-src` pour la
  fenêtre de connexion Google. Domaines confirmés par recherche externe avant d'écrire le code.

**Testé sans les vraies clés Firebase** (limite assumée — voir plan) : app fonctionnelle sans jamais charger
le SDK tant que non sollicité (zéro requête réseau gstatic/googleapis vérifiée) ; le SDK réel (les 3 sous-
modules) se charge sans violation CSP via `import()` direct de l'URL gstatic — **le point exact qui cassait
tout la dernière fois est confirmé corrigé** ; `buildEncryptedPayload`/`decryptPayload` : aller-retour
chiffrement/déchiffrement correct, mauvais mot de passe correctement rejeté (non-régression du refactor).

`CACHE_VERSION` : `v34` → `v35`.

### 13 août 2026 (suite) — Projet Firebase réel créé et branché

L'utilisateur a suivi le guide pas à pas (console.firebase.google.com : projet `geofinance-backup`, connexion
Google activée, Firestore créé en mode production avec les règles de sécurité restreignant chaque utilisateur
à son propre document, domaine `zaky04.github.io` autorisé) et fourni la config réelle → `js/firebase-config.js`
mis à jour (`REPLACE_ME` remplacés par les vraies valeurs — pas secrètes, sécurité assurée par les règles
Firestore, pas par la confidentialité de l'apiKey).

**Test supplémentaire avec la vraie config** (toujours sans pouvoir compléter une vraie connexion Google —
ça nécessite l'interaction humaine de l'utilisateur dans son propre navigateur) : `signInWithGoogle()` appelé
directement → échoue avec `auth/popup-blocked`, **pas** une erreur de config (`auth/invalid-api-key` etc.) ni
une violation CSP. Ça confirme que Firebase accepte la config réelle et atteint l'étape d'ouverture de la
fenêtre de connexion — seul le bloqueur de popup du navigateur automatisé (sans geste utilisateur "de
confiance") arrête le flux à ce stade précis, ce qui n'arrivera pas pour l'utilisateur cliquant normalement.

**Reste à faire par l'utilisateur** : tester réellement "Se connecter avec Google" dans son navigateur (popup
devrait s'ouvrir normalement), "Sauvegarder maintenant" (vérifier dans la console Firebase → Firestore
Database qu'un document apparaît sous `backups/{son-UID}`), puis simuler une réinstallation (vider les
données de site ou utiliser un autre appareil/profil) → se reconnecter → "Restaurer depuis le cloud" → vérifier
que les données reviennent.

Petite lacune connue, non bloquante : les messages d'erreur Firebase remontés dans les toasts (ex.
`Firebase: Error (auth/popup-blocked).`) sont les codes techniques bruts du SDK, pas traduits en français
convivial. À améliorer si ça se révèle confus en usage réel, pas une urgence.

### 13 août 2026 (suite) — Connexion Google cassée sur mobile, corrigée (repli sur signInWithRedirect)

Signalé par l'utilisateur en testant sur mobile : le bouton "Se connecter avec Google" reste bloqué sur
"Connexion…" sans rien faire. Cause connue et bien documentée de l'écosystème Firebase : `signInWithPopup`
est peu fiable sur mobile et **ne fonctionne carrément pas** dans une PWA installée en plein écran
(`display-mode: standalone`) — il n'y a pas de fenêtre de navigateur où ouvrir la popup.

→ `firebase-sync.js` : `shouldPreferRedirect()` (réutilise `isStandalone`/`isIOS`/`isAndroid` déjà exportées
par `install-prompt.js`, pas de détection dupliquée) — sur mobile/PWA installée, `signInWithGoogle()` appelle
directement `signInWithRedirect()` (navigation de page complète vers Google puis retour) au lieu de
`signInWithPopup()` ; sur desktop, popup tentée en premier, avec repli automatique sur la redirection si elle
échoue (`auth/popup-blocked`, `auth/popup-closed-by-user`, `auth/operation-not-supported-in-this-environment`,
`auth/cancelled-popup-request`). Un flag `cloudRedirectPending` (settings) est posé juste avant la navigation
(elle interrompt toute exécution JS en cours, donc rien après `signInWithRedirect()` ne s'exécute) et lu au
retour par `handlePendingRedirect()`, appelée dans `renderCloudBackupSection()` avant `waitForAuthReady()`.
Conséquence acceptée : le retour de redirection recharge toute la page, donc l'utilisateur retombe sur l'écran
de code PIN (comportement normal de l'app à chaque chargement) avant de pouvoir revoir son état de connexion
dans Paramètres — pas un bug, effet secondaire attendu d'un flux de connexion par redirection.

Testé en émulant un contexte mobile (user-agent Android) : `shouldPreferRedirect()` détecte correctement
`isAndroid: true`, le clic sur "Se connecter" déclenche directement une vraie navigation vers
`accounts.google.com` (titre d'onglet vérifié) sans jamais tenter la popup cassée ; `cloudRedirectPending`
correctement posé à `true` avant la navigation, persiste après retour sur l'app, et se remet à `false`
proprement même sans connexion réellement complétée (annulée volontairement — compléter une vraie connexion
Google nécessite les identifiants de l'utilisateur, hors de portée d'une session Claude). Avertissement
console bénin et connu de l'écosystème Firebase+Chrome (`Cross-Origin-Opener-Policy policy would block the
window.closed call`) observé lors du test popup sur desktop — n'affecte pas le flux réel, disparaît de toute
façon sur mobile/PWA installée puisque la popup n'y est plus jamais tentée.

`CACHE_VERSION` : `v35` → `v36`.

### 13 août 2026 (suite) — Bug réel trouvé : le mot de passe de chiffrement était toujours perdu

Signalé par l'utilisateur : connecté avec succès, clique "Sauvegarder maintenant", saisit le mot de passe de
chiffrement, puis... rien. Cause : dans `promptPassphrase()` (dupliquée à l'identique dans `firebase-sync.js`
et **déjà présente avant, dans `settings.js`**), l'ordre des deux appels était `modal.close(); resolve(p);`.
Or `openModal()`'s `close()` (`utils.js`) déclenche `onClose()` **synchroniquement**, et l'`onClose` fourni ici
est `() => resolve(null)` — donc `resolve(null)` s'exécutait avant `resolve(p)`, et comme une Promise ignore
toute résolution après la première, le mot de passe réel était **systématiquement perdu**, silencieusement
(`if (!p) return;` côté appelant). Reproduit et confirmé en isolant exactement ce motif dans le navigateur.

**Portée du bug** : pas nouveau avec Firebase — `promptPassphrase()` dans `settings.js` (export/import "JSON
chiffré" en local, boutons présents depuis longtemps) avait exactement le même défaut. Autrement dit
l'export/import chiffré local ne fonctionnait probablement jamais non plus depuis ce menu, bug pré-existant
non lié à cette session, découvert par ricochet en développant la sauvegarde cloud.
`confirmDialog()` (`utils.js`), qui suit un motif similaire, n'est PAS concerné : son auteur original avait
mis le bon ordre (`resolve(true); modal.close();`) — seul `promptPassphrase` (écrit séparément) avait
l'ordre inversé. Recherché dans tout le projet (`grep`) : aucune autre occurrence du motif fautif.

→ Corrigé aux deux endroits (`settings.js` et `firebase-sync.js`) : `resolve(p)` avant `modal.close()`.
Testé : export JSON chiffré local (`settings.js`) → `lastBackupAt` correctement mis à jour immédiatement
après soumission du mot de passe (avant le fix, il ne l'était jamais, confirmé par comparaison avant/après).

`CACHE_VERSION` : `v36` → `v37`.

### 13 août 2026 (suite) — Dépassement de la limite de taille Firestore (1 Mo/document)

Signalé par l'utilisateur, mot de passe cette fois correctement transmis (fix précédent) : erreur
`the value property payload is longer than 1048487 bytes`. Cause : Firestore refuse tout document de plus de
~1 Mo — la sauvegarde complète (historique de transactions + justificatifs photo convertis en data URL
base64 dans le payload, voir `serializeReceiptsForExport()` dans `backup.js`) dépasse vite cette limite en
usage réel, stockée jusqu'ici dans un seul champ d'un seul document.

→ `firebase-sync.js` : le JSON chiffré est découpé en morceaux de 900 000 caractères (`CHUNK_SIZE`, marge
sous la limite exacte), stockés dans une sous-collection `backups/{uid}/chunks/{i}` plutôt qu'un seul champ.
Le document `backups/{uid}` lui-même ne garde qu'un `chunkCount` + `updatedAt`. `pushBackupToCloud()` supprime
d'abord les anciens morceaux (leur nombre varie d'une sauvegarde à l'autre) avant d'écrire les nouveaux, le
tout dans un seul `writeBatch` (atomique — soit tout s'écrit, soit rien). `pullBackupFromCloud()` lit
`chunkCount`, récupère tous les morceaux en parallèle, les concatène, puis déchiffre comme avant.
**Nécessite une mise à jour des règles de sécurité Firestore** (nouvelle sous-collection à couvrir) :
```
match /backups/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
  match /chunks/{chunkId} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
  }
}
```
Testé : découpage/réassemblage d'une chaîne de 2,3 Mo simulée (proche d'une sauvegarde avec plusieurs
justificatifs photo) → 3 morceaux, tous sous la limite, réassemblage strictement identique à l'original.
Écriture/lecture Firestore réelles à confirmer par l'utilisateur (règles mises à jour requises côté console).

`CACHE_VERSION` : `v37` → `v38`.

### 14 août 2026 — Restauration cassée par la CSP : `fetch(data:...)` bloqué (commit à venir)

Signalé par l'utilisateur après avoir franchi les étapes précédentes (connexion, mot de passe, découpage) :
`Failed to fetch` en cliquant "Restaurer depuis le cloud". Reproduit directement dans le navigateur pour
confirmer la cause exacte avant de corriger : `fetch('data:text/plain;base64,...')` échouait avec
`TypeError: Failed to fetch`, et la console révélait le vrai coupable — la CSP (`connect-src`), pas un bug
réseau ou Firestore.

Cause : `dataUrlToBlob()` (`backup.js`), utilisée par `deserializeReceiptsForImport()` pour reconstituer les
photos de justificatifs (`receiptBlob`) à partir de leur forme sérialisée en data URL base64, appelle
`fetch(dataUrl)` — un usage détourné mais standard de `fetch()` pour convertir une data URL en `Blob`. La CSP
`connect-src` ajoutée pour Firebase (§13 août, Firebase) n'incluait pas `data:`, donc tout navigateur qui
respecte la CSP pour les data URLs (Chrome le fait) bloquait cette conversion.

**Portée plus large que la restauration cloud seule** : `deserializeReceiptsForImport()` est aussi le chemin
utilisé par l'import local de sauvegarde chiffrée (`importEncryptedBackup()` dans `backup.js`, bouton
"Importer (JSON chiffré)" des Paramètres) — toute sauvegarde locale ou cloud contenant au moins un
justificatif photo échouait à l'import, silencieusement liée à ce même bug, pas seulement au cloud.

→ `index.html` : ajout de `data:` à `connect-src` dans la CSP. Commentaire explicatif mis à jour pour
documenter pourquoi (éviter qu'un futur audit sécurité le retire en pensant à une faille).

Testé : `fetch('data:text/plain;base64,aGVsbG8=')` échouait avant le correctif (`Failed to fetch`, erreur CSP
visible dans la console), réussit après (reload complet + vidage du cache SW pour prendre en compte la
nouvelle CSP du `index.html`).

`CACHE_VERSION` : `v38` → `v39`.

### 14 août 2026 (suite) — Après restauration, "Comptes gardés" restait invisible dans le menu desktop

Signalé par l'utilisateur juste après avoir restauré sa sauvegarde cloud sur un second appareil
(desktop) : les transactions étaient bien revenues, mais l'onglet "Comptes gardés" — activé côté
mobile avant la sauvegarde — n'apparaissait pas dans le menu latéral, alors que le réglage aurait
dû suivre.

Cause : le réglage `keptAccountsEnabled` (comme tout `STORES.SETTINGS`) est bien inclus dans
`exportAllData()`/`importAllData()` et revient donc correctement en base après import/restauration.
Mais la visibilité du bouton de nav (`#nav-kept-accounts`, `hidden` géré par
`applyOptionalModuleVisibility()` dans `settings.js`) n'était recalculée qu'au démarrage de l'app
(`app.js`) et quand l'utilisateur cochait la case lui-même dans Paramètres — jamais après un import
JSON local, un import chiffré local, ou une restauration cloud, qui écrivent pourtant ce même
réglage. Le bouton restait figé dans l'état d'avant l'import jusqu'au prochain rechargement complet
de la page.

→ `app.js` : le listener déjà abonné à `EVENTS.DATA_CHANGED` (qui re-rend la vue courante) appelle
maintenant aussi `applyOptionalModuleVisibility()` quand le scope est `'all'` — le scope utilisé par
les 3 chemins d'import/restauration (`importJsonBackup`, `importEncryptedBackup`,
`pullBackupFromCloud`), sans avoir à modifier ces 3 fonctions individuellement.

Testé : réglage `keptAccountsEnabled` remis à `false` puis bouton de nav forcé `hidden` (simulant
l'état au boot avant import) → réglage remis à `true` en base + `notifyDataChanged('all')` (ce que
fait exactement un import) → bouton passe à `hidden = false` immédiatement, sans rechargement.

`CACHE_VERSION` : `v39` → `v40`.

### 14 août 2026 (suite) — Selects/inputs restaient blancs en thème sombre en dehors de `.form-row`

Signalé par l'utilisateur (capture d'écran) : en thème sombre, le `<select>` "Verrouillage
automatique après inactivité" (Paramètres) restait rendu en clair (fond blanc natif du navigateur),
détonnant visuellement au milieu d'une page sombre.

Cause : seule la règle `.form-row input, .form-row select, .form-row textarea` (styles.css)
applique un fond/bordure suivant les variables de thème. Or de nombreux `<select>`/`<input>` de
l'app sont rendus hors d'un `.form-row` (listes déroulantes courtes dans des lignes `stat-row`,
filtres, sélecteurs inline) — pour ceux-là, seule la règle de reset minimal `input, select, textarea
{ font: inherit; color: inherit; }` s'appliquait, qui ne touche ni au fond ni à la bordure : le
navigateur retombe alors sur son rendu natif (fond blanc), quel que soit le thème de la page. Un
audit du reste de l'app a montré que ce n'était pas un cas isolé : `#base-currency-select`,
`#ef-months`/`#pi-mode` (Outils), `#tx-filter-*` (Transactions, bien que déjà couverts par
`.filters-bar` dans ce cas précis), les selects de type de transaction fractionnée, etc. — tous
potentiellement concernés selon leur emplacement dans le markup.

→ `styles.css` : la règle de reset globale `input, select, textarea` porte maintenant elle-même
`background: var(--surface-alt)`, `border`, `border-radius` et le focus outline — donc tout
select/input texte respecte le thème quel que soit son wrapper, sans dépendre de `.form-row`.
Explicitement exclu de cette règle : `checkbox`/`radio`/`range`/`color`/`file`/`image`, dont le
rendu natif (case à cocher, etc.) n'a pas besoin de fond/bordure custom et serait déformé par ces
propriétés. Les règles plus spécifiques déjà en place (`.form-row select`, `.filters-bar select`,
`.search-input-row input`) restent inchangées et continuent de gagner par spécificité CSS — pas de
régression sur leurs styles existants (padding/fond légèrement différents, intentionnels).

Testé : fond calculé (`getComputedStyle`) de plusieurs selects pris dans des vues différentes
(Paramètres, Transactions, Outils) en thème sombre → tous sombres (`rgb(23,28,51)` / `rgb(18,22,43)`
selon la variable utilisée) ; repassé en thème clair → tous clairs à nouveau, sans changement pour
les cases à cocher (fond transparent inchangé).

`CACHE_VERSION` : `v40` → `v41`.

### 14 août 2026 (suite) — Import CSV générique : les lignes invalides disparaissaient sans avertissement

Dette technique identifiée depuis l'audit du 12 août (§5.4, §7.3) : dans `importGenericCsvRows`
(`backup.js`, import d'un relevé bancaire générique via mapping de colonnes), une ligne dont la date
ou le montant ne pouvait pas être lu (colonne vide, format inattendu, mauvaise colonne choisie dans
le mapping) était silencieusement ignorée (`continue`) — sans incrémenter le moindre compteur.
L'utilisateur voyait juste "X transaction(s) importée(s)" sans jamais savoir qu'il manquait des
lignes de son relevé, ni pourquoi.

→ Ajout d'un troisième compteur `invalid` (aux côtés de `imported`/`skipped`), incrémenté à chaque
ligne ignorée pour date ou montant illisible. Toast mis à jour dans `settings.js` pour afficher ce
décompte : *"X transaction(s) importée(s). Y doublon(s) ignoré(s). Z ligne(s) invalide(s)
ignorée(s) (date ou montant illisible — vérifiez le mapping des colonnes)."*

`importGeoFinanceCsvRows` (ré-import du propre format d'export CSV de GeoFinance) n'a volontairement
pas été touché : c'est un format fixe et fiable généré par l'app elle-même, contrairement au CSV
générique dont le mapping est manuel et sujet à erreur — le risque de ligne mal formée y est
structurellement bien plus faible.

Testé : import de 5 lignes fictives (1 date invalide, 1 montant vide, 1 montant non numérique, 2
valides) → `{ imported: 2, skipped: 0, invalid: 3 }`, conforme.

`CACHE_VERSION` : `v42` → `v43`.

### 14 août 2026 (suite) — Tolérance de dérive flottante sur les comparaisons de seuil exact

Dette technique §5.2 : les montants sont des `Number` JS sommés directement (pas de centimes
entiers), donc une somme peut ponctuellement dériver de quelques millièmes de centime (classique :
`0.1 + 0.2 === 0.30000000000000004` en JS). Deux endroits comparaient un total à un seuil de façon
**exacte**, sans marge : un budget respecté "pile" au centime près pouvait donc apparaître, à tort,
comme dépassé.

→ Appliqué la même convention de tolérance qu'utilise déjà `debts.js` ailleurs dans le code (marge de
`0.005`, soit un demi-centime) aux deux points identifiés :
- `ledger.js` (`computeFinancialHealthScore`) : `r.actual <= r.budget` → `r.actual <= r.budget + 0.005`
  pour le calcul du taux de respect du budget (composante du score de santé financière).
- `dashboard.js` : `monthlyBudget.remaining >= 0` → `monthlyBudget.remaining >= -0.005` pour choisir
  entre l'affichage "Reste X €" et "Dépassé de X €" sur le tableau de bord.

Une vraie migration vers des centimes entiers en stockage reste volontairement hors scope — voir
§7.4 pour le raisonnement (chantier disproportionné pour un problème jamais rapporté en pratique).

Testé : ajout d'un scénario dédié dans `test/ledger.test.html` (§11) — un budget de 0.3 € consommé
par deux dépenses de 0.1 € et 0.2 € (qui dérive réellement à `0.30000000000000004` en JS, vérifié
explicitement) reste compté comme respecté (`budgetAdherencePct === 100`) grâce à la tolérance.

`CACHE_VERSION` : `v43` → `v44`.

### 14 août 2026 (suite) — Rappel périodique pour la sauvegarde cloud

La sauvegarde cloud (§6, 13 août) n'existait qu'à la demande — rien ne rappelait à l'utilisateur de
l'utiliser, contrairement à l'export local qui a son propre rappel hebdomadaire avec escalade
(`checkWeeklyBackupReminder`, §6.2). Proposé par l'auteur, implémenté à sa demande.

→ `firebase-sync.js` : `checkWeeklyCloudBackupReminder()`, même principe que le rappel local — report
par tranches de 24h (`cloudBackupSnoozedUntil`), mode "urgent" au-delà de 3 reports
(`cloudBackupSnoozeCount`, bouton "Plus tard" retiré), remis à 0 après toute sauvegarde cloud réussie
(déplacé dans `pushBackupToCloud()` elle-même — pas seulement le chemin du rappel — pour qu'une
sauvegarde manuelle depuis Paramètres compte aussi). Ne s'affiche que si `cloudBackupWasSignedIn`
(réglage local) est vrai : un utilisateur qui n'a jamais connecté son compte Google ne voit jamais ce
rappel, et surtout **ne déclenche jamais le chargement du SDK Firebase** rien que pour la vérification
— seul un clic sur "Sauvegarder maintenant" dans le rappel charge le SDK, même principe de paresse que
le reste du fichier. Appelé au boot (`app.js`) via `setTimeout` à 6s, décalé après le rappel local (4s)
pour ne pas empiler les deux invites si les deux tombent le même jour.

Testé dans le navigateur (base IndexedDB isolée) : aucune modale ni appel réseau pour un utilisateur
jamais connecté ; modale correcte après 7 jours pour un utilisateur connecté ; clic "Plus tard" pose
bien le report et le rappel ne se réaffiche pas immédiatement après ; 3 reports + snooze expiré →
mode urgent (pas de bouton "Plus tard", message adapté) ; clic "Sauvegarder maintenant" ferme le
rappel et ouvre bien l'invite de mot de passe de chiffrement.

`CACHE_VERSION` : `v44` → `v45`.

### 14 août 2026 (suite) — Audit accessibilité : boutons icône sans nom accessible

Jamais fait à ce jour sur l'app (§7.6, demandé par l'auteur). Constat principal : la quasi-totalité
des boutons "icône seule" (modifier, supprimer, archiver, pointer une transaction, etc. — présents
dans presque tous les modules) utilisaient uniquement `title="..."` pour indiquer leur fonction.
`title` s'affiche en infobulle à la souris, mais n'est fiable ni au clavier (pas de tooltip visible
au focus dans la plupart des navigateurs) ni pour un lecteur d'écran (support inégal, certains
l'ignorent complètement pour le nom accessible d'un `<button>` sans texte) — un bouton "icône seule"
sans `aria-label` est essentiellement un bouton sans nom pour ces utilisateurs.

→ Ajouté `aria-label` (même texte que le `title` existant, y compris pour les libellés dynamiques
comme "Archiver"/"Désarchiver") à tous les boutons `icon-btn` qui n'en avaient pas : `debts.js`,
`kept-accounts.js`, `budgets.js`, `investments.js`, `savings.js`, `shared.js`, `transactions.js`,
`wallets.js` (~25 boutons). Ceux qui avaient déjà `aria-label` (navigation mois/année, fermeture de
modale, filtres de recherche) n'ont pas été touchés.

**Trouvé mais volontairement pas corrigé, à valider avec l'auteur** : `--text-faint` (utilisé pour
les états vides, les libellés du calendrier, les tendances des cartes résumé — pas juste décoratif)
a un contraste insuffisant contre son fond dans les deux thèmes : ≈2.6:1 en clair (`#9aa0b4` sur
`#ffffff`), ≈3.7:1 en sombre (`#6b7096` sur `#12162b`) — sous le seuil WCAG AA de 4.5:1 pour du texte
normal. Non corrigé ici car resserrer ce contraste implique de foncer la teinte, ce qui la
rapprocherait visuellement de `--text-muted` (déjà à la limite, ≈4.9:1) et réduirait la hiérarchie
visuelle à 2 niveaux au lieu de 3 — un choix de design, pas un simple bug, à trancher avec l'auteur
avant de toucher une variable utilisée dans une dizaine d'endroits.

`CACHE_VERSION` : `v45` → `v46`.

### 14 août 2026 (suite) — Mesuré et corrigé : computeNetWorthHistory 7x plus lent que ses jumelles

Suite de l'audit demandé par l'auteur (§7.7 listait le risque comme "non mesuré, à profiler si un
jour rapporté" — mesuré tout de suite plutôt que de laisser la piste ouverte sans données). Généré un
jeu de données synthétique réaliste (14 600 transactions, 5 ans, ~8/jour) dans une base IndexedDB de
test isolée, puis chronométré chaque agrégat de `ledger.js` utilisé par le tableau de bord.

Résultat : la plupart des calculs prennent 200-700ms sur ce volume (pas instantané, mais pas
gênant — le tableau de bord les exécute en parallèle via `Promise.all`, voir `dashboard.js`).
`computeNetWorthHistory(6)` sortait du lot à **1555ms**, contre ~215-235ms pour
`computeInvestmentValueHistory`/`computeDebtHistory` qui calculent pourtant un historique similaire
sur la même période. Cause : ces deux dernières appellent `ctx()` (10 lectures IndexedDB) **une
seule fois** puis bouclent en mémoire sur les données déjà chargées — `computeNetWorthHistory`,
elle, délègue à `computeNetWorth(cutoff)` à chaque itération, qui rappelle `ctx()` à chaque fois : un
historique sur 6 mois relit donc l'intégralité des portefeuilles/transactions/investissements/dettes
6 fois de suite pour un résultat identique à chaque relecture (seule la date de coupure change).

→ Extrait le cœur pur de `computeNetWorth` dans `netWorthAt(cutoffDate, data)` (aucun accès DB) ;
`computeNetWorth()` et `computeNetWorthHistory()` appellent chacune `ctx()` une seule fois puis
l'utilisent — même principe que `computeInvestmentValueHistory`/`computeDebtHistory`, qui n'avaient
jamais eu ce problème.

Testé : les 24 assertions de `test/ledger.test.html` (§11) passent toujours après le refactor (le
comportement observable est strictement identique, seul le nombre de lectures DB change) ;
rechronométré sur le même jeu de données de 14 600 transactions → **1555ms → 473ms** (≈3,3x).

Piste plus large volontairement pas traitée ici (§7.7 mise à jour) : `ctx()` lui-même charge tout un
store en mémoire à chaque appel (`dbGetAll`, pas de requête IndexedDB bornée par date/index) — les
~300-500ms restants sur ce jeu de données synthétique viennent de là. Non touché : chantier plus
large (requêtes indexées par date, éventuellement un cache de session) disproportionné tant qu'aucun
utilisateur réel n'a signalé de lenteur perceptible.

`CACHE_VERSION` : `v46` → `v47`.

### 14 août 2026 (suite) — Vérification de fraîcheur cloud au démarrage (multi-appareils)

Proposé par l'auteur : avec plusieurs appareils partageant le même compte cloud, rien n'empêchait
un appareil resté sur une version ancienne de commencer à y saisir de nouvelles transactions sans
savoir qu'un autre appareil avait déjà avancé le cloud pendant ce temps — risque de doublons, ou de
données écrasées à la prochaine sauvegarde de l'appareil en retard. Question explicitement posée
par l'auteur et traitée avant l'implémentation : que se passe-t-il hors-ligne au démarrage ? Réponse
donnée puis honorée dans le code : l'app démarre normalement, la vérification échoue silencieusement
et sans bloquer si le réseau n'est pas là, comme le fait déjà `renderCloudBackupSection`.

→ `firebase-sync.js` : `checkCloudStaleness()`, appelée au boot (`app.js`, 2s après déverrouillage —
avant les rappels de sauvegarde, cette alerte étant plus urgente). Ne charge le SDK Firebase que
pour un utilisateur déjà connecté au cloud (`cloudBackupWasSignedIn`) — jamais par défaut. Compare
l'horodatage serveur de la dernière sauvegarde cloud (`updatedAt` du document `backups/{uid}`, une
seule petite lecture, pas les morceaux chiffrés) à `cloudLastKnownSyncAt` (nouveau réglage local, mis
à jour par `pushBackupToCloud()` ET `pullBackupFromCloud()` — contrairement à `lastCloudBackupAt` qui
ne compte que les envois, affiché tel quel en Paramètres). Si le cloud est plus récent, une modale
propose de restaurer maintenant (réutilise `promptPassphrase`/`confirmDialog`/`pullBackupFromCloud`,
mêmes briques que le bouton "Restaurer" existant) ou de continuer quand même.
Timeout défensif de 8s (variable `cancelled`, pas d'annulation réseau réelle mais empêche la modale
de surgir tardivement sur une connexion très lente) ; toute erreur (hors-ligne, service indisponible)
est avalée silencieusement — jamais de blocage ni de message d'erreur au démarrage.

Ne résout pas le cas où les deux appareils ont chacun des changements non synchronisés EN MÊME
TEMPS (vrai conflit bidirectionnel) — nécessiterait le moteur de résolution de conflits
délibérément évité dès la conception de la sauvegarde cloud (13 août). Couvre le cas courant :
un appareil simplement en retard, prévenu avant de commencer à diverger.

Testé : aucune requête réseau ni modale pour un utilisateur jamais connecté au cloud (règle du
chargement paresseux respectée) ; aucun plantage pour un utilisateur "connu connecté"
(`cloudBackupWasSignedIn`) mais sans session Firebase active réelle (retombe proprement sur "pas
d'utilisateur", ne montre rien) — le round-trip complet avec un vrai compte cloud (comparaison
réelle des horodatages, restauration déclenchée) reste à confirmer par l'auteur avec son compte
réel, comme pour le reste des fonctionnalités Firebase de cette session.

### 14 août 2026 (suite) — Détection de dépense inhabituelle

Proposé par l'auteur : signaler une dépense nettement plus élevée que l'habitude pour sa catégorie,
utile surtout pour rattraper une erreur de saisie (ex: 45 000 tapé au lieu de 4 500).

→ `ledger.js` : `checkUnusualExpense(categoryId, amount, walletId, excludeId)` — compare le montant
(converti en devise de base, une catégorie pouvant recevoir des dépenses de portefeuilles en devises
différentes) à la moyenne des dépenses passées de cette catégorie. Renvoie `null` si la catégorie a
moins de 3 dépenses passées (pas assez d'historique pour qu'une moyenne veuille dire quelque chose)
ou si le montant ne dépasse pas 2,5x cette moyenne. `excludeId` ignore la transaction elle-même lors
d'une modification. Appelée dans `transactions.js` après l'enregistrement d'une dépense (création ET
modification) ; purement informatif via un second toast empilé sur celui de confirmation
(`showToast` empile déjà, pas de conflit) — n'empêche jamais l'enregistrement. Pas branché sur le
chemin des transactions scindées (`splitMode`) : plusieurs lignes de petits montants dans des
catégories peu utilisées auraient pu déclencher plusieurs avertissements empilés pour une seule
action utilisateur — hors scope volontairement, pas demandé.

Testé : historique de 5 dépenses ~50€ (moyenne 50) → un montant proche (55€) ne déclenche rien, un
montant à 300€ (6x) déclenche l'avertissement avec la bonne moyenne/ratio, une catégorie neuve sans
historique ne déclenche jamais rien (garde-fou anti-faux-positifs respecté).

### 14 août 2026 (suite) — Mode démo pour l'onboarding

Proposé par l'auteur : permettre d'explorer l'app avec des données réalistes avant d'y entrer ses
propres finances.

→ Nouveau `js/demo-data.js` : `seedDemoData()` crée un jeu de données XOF cohérent sur ~2 mois
(3 portefeuilles — mobile money/banque/espèces —, ~19 transactions revenus/dépenses variées,
3 budgets du mois, un objectif d'épargne, un investissement avec historique de valorisation, une
créance) ; `clearDemoData()` efface tout et remet l'app dans l'état "jamais utilisée" (l'onboarding
se réaffichera au prochain démarrage). Piège rencontré : `seedDemoData()` appelle `wipeAllData()` en
premier, qui vide AUSSI `STORES.CATEGORIES` — impossible de compter sur les catégories par défaut
déjà créées par `seedDefaultsIfNeeded()` au premier boot (elles n'existent plus après le wipe), donc
`seedDemoData()` recrée elle-même le même jeu de catégories par défaut plutôt que d'en dépendre.

Bouton "Découvrir avec des données d'exemple" ajouté à la toute première étape de l'onboarding
(`app.js`) : ferme l'assistant entièrement (pas juste l'étape) plutôt que de l'enchaîner — créer SON
portefeuille/profil n'a plus de sens une fois des données fictives en place. Un bandeau permanent
(`#demo-mode-banner`, nouveau conteneur dans `index.html` juste sous la barre du haut, visible sur
toutes les vues) reste affiché tant que `isDemoModeActive` est vrai, avec un bouton pour tout effacer
et repartir de zéro — pour qu'il soit impossible de mélanger sans s'en rendre compte des données
fictives avec de vraies finances.

Testé : `seedDemoData()` crée bien 3 portefeuilles / 19 transactions / 9 catégories / 3 budgets / 1
objectif d'épargne / 1 investissement (2 valorisations) / 1 créance, aucune transaction avec
`categoryId` non résolu (bug initial corrigé — voir piège ci-dessus) ; `renderDashboard()` appelée
directement après le seed s'exécute sans erreur et affiche les vrais montants XOF calculés
(120 000 / 471 000 / 823 500 F CFA sur les cartes du tableau de bord) ; `clearDemoData()` remet bien
`isDemoModeActive`/`onboardingCompleted` à `false`. Le clic UI de bout en bout (bouton → bandeau →
effacer) n'a pas pu être rejoué au clavier virtuel dans cette session (le clavier PIN de l'app,
préalable obligatoire même en mode démo, s'est montré capricieux aux clics synthétiques du
navigateur de test) — vérifié à la place via les fonctions réelles directement, mêmes chemins de
code que ceux que l'UI appelle.

`CACHE_VERSION` : `v47` → `v48` (nouveau fichier `js/demo-data.js` ajouté à `APP_SHELL`).

### 15 août 2026 — Revue de sécurité + bugs sur les 3 fonctionnalités ci-dessus, avant push

Demandé par l'auteur avant de pousser : vérifier tout le diff en attente (les 3 fonctionnalités
ci-dessus) pour bugs, incohérences, failles de sécurité. Revue de sécurité (aucune faille trouvée —
l'app est 100% client-side, pas de surface d'injection classique ; le seul point réseau est
Firestore, déjà borné par les règles de sécurité existantes par `uid`) puis revue de correction
multi-angles (scan ligne à ligne, comportement supprimé, traçage inter-fichiers, réutilisation,
simplification, efficacité, altitude, conventions CLAUDE.md), avec vérification indépendante de
chaque piste retenue. **10 bugs/incohérences confirmés, tous corrigés avant push** :

1. **[Le plus grave] `seedDemoData()`/`clearDemoData()` effaçaient le PIN que l'utilisateur venait
   de créer.** `wipeAllData()` (`db.js`) vide `STORES.SETTINGS` sans le filtre `DEVICE_LOCAL_SETTING_KEYS`
   qu'`exportAllData()`/`importAllData()` appliquent pourtant scrupuleusement (voir §6, 13 août). Le
   bouton "Découvrir avec des données d'exemple" est sur la toute première étape de l'onboarding,
   juste après la création du PIN — un clic dessus effaçait `pinHash`/`pinSalt`/identifiants
   biométriques. Recharger la page réparait la situation (redétecte l'absence de PIN, repasse en
   mode création), mais verrouiller sans recharger ("Verrouiller maintenant" ou verrouillage
   automatique) enfermait l'utilisateur dans un écran de déverrouillage qu'aucun PIN ne pouvait
   jamais satisfaire (`verifyPin()` renvoie `false` dès que `pinSalt`/`pinHash` sont absents).
   → Nouvelle fonction `wipeUserData()` (`db.js`) : identique à `wipeAllData()` mais préserve les
   réglages propres à l'appareil (même `DEVICE_LOCAL_SETTING_KEYS`). `demo-data.js` l'utilise
   maintenant à la place de `wipeAllData()`. `wipeAllData()` elle-même reste inchangée et continue
   d'être le bon outil pour le vrai "Tout supprimer" de `settings.js` (réinitialisation complète
   explicitement voulue par l'utilisateur, PIN compris).
2. **Aucune confirmation avant ce wipe** (contrairement au "Tout supprimer" de `settings.js`, gardé
   par deux `confirmDialog(danger:true)`) — **pas de changement nécessaire une fois #1 corrigé** :
   le bouton n'apparaît que sur un premier lancement sans aucune donnée (garde `hasWallets` dans
   `maybeShowOnboarding()`), et le PIN est maintenant préservé — il n'y a plus rien à perdre.
3. **`checkCloudStaleness()` avertissait à tort tout utilisateur cloud mono-appareil déjà existant**,
   au premier démarrage suivant cette mise à jour : `cloudLastKnownSyncAt` (nouveau réglage) n'était
   jamais renseigné pour qui avait utilisé la sauvegarde cloud avant l'ajout de ce réglage,
   l'absence était traitée comme "en retard par défaut" (`localMs = 0`).
   → Absence de repère traitée comme "pas d'historique fiable" : établit silencieusement un repère
   sur l'état actuel du cloud sans alarmer, plutôt que de considérer par défaut que le cloud a
   avancé.
4. **La modale de fraîcheur cloud n'avait aucun répit** : "Continuer quand même" ne posait aucun
   réglage, donc la modale identique réapparaissait à chaque démarrage tant que le cloud ne bougeait
   pas.
   → Le clic avance `cloudLastKnownSyncAt` jusqu'à l'état du cloud déjà vu — la modale ne revient
   que si le cloud avance ENCORE après ce constat.
5. **Décalage d'horloge possible** : `pushBackupToCloud()` posait l'horodatage cloud via
   `serverTimestamp()` (horloge serveur) mais le repère local via `new Date().toISOString()`
   (horloge de l'appareil) pour le même instant — un appareil dont l'horloge retarde aurait pu voir
   son PROPRE push relu comme "plus récent que son propre repère" au prochain démarrage.
   → Relit le document juste après l'écriture pour récupérer l'horodatage réellement résolu côté
   serveur, comme le fait déjà `pullBackupFromCloud()` — horloge serveur comparée à horloge serveur,
   jamais mélangée à l'horloge locale.
6. **Aucune coordination entre la modale de fraîcheur (2s) et le rappel hebdomadaire cloud (6s)** :
   restaurer via la première ne mettait à jour ni `lastCloudBackupAt` ni `cloudBackupSnoozeCount`,
   donc le second pouvait se déclencher 4 secondes plus tard pour réclamer une sauvegarde juste
   après une restauration.
   → `pullBackupFromCloud()` pose maintenant un répit de 24h (`cloudBackupSnoozedUntil`) après toute
   restauration réussie — sans toucher `lastCloudBackupAt`, qui reste honnête sur la dernière fois
   qu'on a réellement *poussé* une sauvegarde (affiché tel quel en Paramètres).
7. **Liste de catégories par défaut dupliquée** entre `seedDefaultsIfNeeded()` (`app.js`) et
   `seedDemoData()` (`demo-data.js`) — risque de dérive silencieuse (une catégorie renommée d'un
   côté sans l'autre aurait reproduit le bug `categoryId: null` déjà rencontré une fois).
   → Extraite en `DEFAULT_CATEGORIES` (nouvelle constante exportée de `db.js`), utilisée par les
   deux.
8. **`checkUnusualExpense()` ignorait les taux de change non confirmés** (valeur 1:1 par défaut,
   documentée ailleurs comme "presque certainement fausse", voir §12 août) — pouvait produire un
   avertissement trompeur (déclenché à tort ou manqué) sur une catégorie mêlant des devises dont
   l'une a un taux jamais confirmé.
   → Renvoie `null` si une devise impliquée dans la comparaison a un taux non confirmé, plutôt que
   de comparer avec un taux probablement faux sans le signaler.
9. **`checkUnusualExpense()` appelait `ctx()`** (10 lectures IndexedDB) alors qu'elle n'utilise que
   4 des stores chargées — payé à *chaque* enregistrement de dépense (création ET modification), pas
   occasionnellement.
   → Chargement ciblé (`wallets`, `transactions`, `rates`, `baseCurrency` seulement) au lieu de
   `ctx()`.
10. **`investment.createdAt` (mode démo) construit via `daysAgo(58) + 'T00:00:00.000Z'`** — une
    date calendaire locale étiquetée comme minuit UTC, exactement le type de dérive que la
    convention §3 de ce fichier existe pour éviter (`localISODate()`/`todayISO()`, jamais
    `.toISOString()` bricolé sur une date locale). Latent (aucun consommateur actuel n'en souffrait
    réellement), mais aurait pu décaler la date d'un jour pour un futur code lisant ce champ avec
    `new Date(...)` dans un fuseau à l'ouest de l'UTC.
    → Nouvelle fonction `daysAgoTimestamp()` : construit un vrai `Date`, puis appelle `.toISOString()`
    dessus (usage correct de la fonction, qui produit un instant réel — contrairement à la
    concaténation de chaîne qu'elle remplace).

Bonus (pas un bug, une simplification en passant) : les ~30 `dbAdd()` séquentiels de
`seedDemoData()` remplacés par `dbBulkPut()` (une transaction par store au lieu d'une par ligne),
déjà utilisé ailleurs dans le codebase mais pas exploité par ce nouveau fichier.

Testé : les 24 assertions de `test/ledger.test.html` passent toujours après tous ces changements ;
`wipeUserData()` vérifié isolément (préserve `pinHash`/`pinSalt`/`biometricCredentialId`, efface le
reste) ; `seedDemoData()` rejoué avec un PIN factice préexistant → PIN intact après le seed, jeu de
données identique à avant (3/19/9/3/1/1/2/1, aucun `categoryId` non résolu) ;
`checkUnusualExpense()` avec un taux USD non confirmé → `null`, puis confirmé → avertissement
correct (moyenne 45, montant 270, ratio 6). Le round-trip complet de `checkCloudStaleness()`/
`pushBackupToCloud()` avec un vrai compte cloud reste à confirmer par l'auteur (limite déjà connue
de cette session pour tout ce qui touche Firebase).

`CACHE_VERSION` : `v48` → `v49`.

### 15 août 2026 (suite) — Revue de bugs étendue au reste de l'app (au-delà du diff du jour)

Demandé par l'auteur après la revue précédente (limitée au diff du jour) : "ya til des choses encore
à ce niveau" → étendre la chasse aux bugs aux fichiers les plus critiques jamais passés par une revue
multi-agents comme celle qui vient d'avoir lieu — `auth.js` (PIN/biométrie), `db.js` (couche de
données), `backup.js` (chiffrement/import/export/CSV), `ledger.js` (calculs financiers), `utils.js`
(helpers partagés par presque tout le reste de l'app). Un agent dédié par fichier, chacun lisant le
fichier en entier + ses appelants, sans filtrer par confiance (recall maximal). **9 bugs réels
corrigés** (détail technique ci-dessous), **10 autres identifiés et documentés en dette technique
§5** (voir tableau ci-dessus) pour arbitrage avec l'auteur plutôt que corrigés à l'aveugle — certains
nécessitent un vrai choix de conception (ex: heuristique de séparateur de milliers), d'autres sont
des correctifs plus risqués à appliquer sans plus de contexte (atomicité `importAllData`).

**Corrigés :**

1. **XSS via `currencySelectHtml()`** (`utils.js`) — le code devise sélectionné était interpolé sans
   `escapeHtml()` dans un attribut HTML. La saisie normale est bornée à 3 caractères
   (`readCurrencyValue`), mais un import CSV/JSON contourne cette contrainte entièrement
   (`findOrCreateWallet`, `backup.js`, stockait la colonne devise telle quelle). → `escapeHtml()`
   ajouté sur chaque valeur interpolée dans `currencySelectHtml()` ; `findOrCreateWallet` borne
   maintenant aussi la devise importée à 3 caractères majuscules (même contrainte que la saisie
   normale, défense en profondeur).
2. **`formatCurrency()` affichait des décimales pour XOF/XAF** — `maximumFractionDigits: 2` fixé pour
   toutes les devises sans distinction ; un montant non entier (conversion, partage entre
   participants) affichait `"1 234,5 F CFA"` au lieu de `"1 235 F CFA"`, la convention pour des
   devises sans sous-unité usuelle — direct pour le marché cible de l'app. → `ZERO_DECIMAL_CURRENCIES`
   (XOF, XAF, JPY) : `minimumFractionDigits`/`maximumFractionDigits` fixés à 0 pour ces devises.
3. **Export CSV : double échappement** — `exportTransactionsCsv` appelait `csvEscape` individuellement
   sur 4 colonnes PUIS sur la ligne entière via `.map(csvEscape)`. Un nom de catégorie contenant `;`
   ressortait entouré de guillemets quadruplés (`""""nom""""`), et se ré-important avec des guillemets
   littéraux au lieu du nom d'origine. → Un seul passage par `.map(csvEscape)`, les appels individuels
   retirés.
4. **`detectRecurringCandidates` n'excluait jamais les récurrences déjà déclarées** — comparait la
   note brute d'une transaction générée automatiquement (`"Récurrence : Loyer"`) au nom de la
   récurrence (`"loyer"`), qui ne correspondent jamais avec un `===`/`.has()` exact — la fonction
   re-proposait en permanence des récurrences déjà actives comme si elles ne l'étaient pas,
   contredisant directement son propre docstring ("Exclut ce qui correspond déjà à une récurrence
   active"). → Le préfixe `"récurrence : "` est retiré avant comparaison.
5. **`computeEnvelopeCarryover` incluait les mouvements de dette/créance** — seul agrégat mensuel du
   fichier sans le filtre `!t.debtId` que `computeMonthSummary`/`computeBudgetVsActual`/
   `computeCategoryActuals` appliquent tous. Un remboursement de dette catégorisé "Prêt"/"Créance"
   avec `envelopeMode` activé faisait diverger le report d'enveloppe de l'"actual" réellement affiché
   à l'écran pour ce même mois/catégorie. → Filtre `!t.debtId` ajouté, cohérent avec ses voisins.
6. **Course critique sur le compteur d'échecs PIN** (`auth.js`) — `verifyPin()` est un calcul PBKDF2
   de plusieurs dizaines/centaines de ms ; rien n'empêchait un second appel concurrent (backspace +
   nouveau chiffre pendant que le premier calcul tourne encore) de lire le même `failedAttempts`
   avant que l'un ou l'autre n'écrive sa mise à jour — l'incrément se perdait, sous-comptant les
   échecs réels et retardant le blocage anti-brute-force. → Verrou `verifying` (variable locale à
   `initLockScreen`) empêchant tout second appel à `verifyPin()`/`verifyBiometric()` tant qu'un
   premier est en cours.
7. **Déverrouillage biométrique ne levait jamais le blocage PIN** (`auth.js`) — un utilisateur
   throttlé après 5 échecs de PIN (`pinThrottledUntil` posé) qui se déverrouillait ensuite avec succès
   par empreinte restait bloqué au PIN dès le verrouillage suivant : seul le chemin PIN réinitialisait
   `pinThrottledUntil`/`failedAttempts`, jamais le chemin biométrique. → Le succès biométrique
   réinitialise maintenant les deux, au même titre qu'un PIN correct.
8. **Rappel de sauvegarde (local ET cloud) : le 3e report s'annulait lui-même** (`backup.js`,
   `firebase-sync.js`) — `snoozeCount >= BACKUP_SNOOZE_LIMIT` (3) faisait passer le rappel en mode
   "urgent" (sans bouton "Plus tard") dès que le compteur atteignait 3 — c'est-à-dire immédiatement
   après le clic "Plus tard" qui vient justement de poser un répit de 24h. Le répit n'avait donc
   jamais la moindre chance de s'écouler : le rappel réapparaissait en mode urgent au tout prochain
   démarrage. Bug copié à l'identique dans les deux fichiers (le rappel cloud a été construit sur le
   modèle du rappel local, voir §6 du 14 août). → `>` au lieu de `>=` dans les deux fichiers — "au-delà
   de 3 reports" (le docstring du code) laisse maintenant le 3e lui-même bénéficier de son répit.

Testé : les 24 assertions de `test/ledger.test.html` passent toujours ; `formatCurrency` vérifié pour
XOF/XAF (entier et non entier) et EUR (décimales inchangées) ; `currencySelectHtml` vérifié avec une
charge XSS explicite (`"><img src=x onerror=alert(1)>`) → correctement échappée ; `detectRecurringCandidates`
vérifié avec une récurrence "Loyer" ayant généré 2 transactions → n'apparaît plus dans les candidats ;
`computeEnvelopeCarryover` vérifié avec une transaction liée à une dette dans la catégorie testée →
exclue du calcul (report `-300` au lieu de `-350` sans le fix, cohérent avec le montant attendu).

Non re-testé en conditions réelles faute d'environnement adapté : le verrou `verifying` (nécessite de
déclencher une vraie course sur le clavier PIN de l'app, le clavier virtuel s'étant déjà montré
capricieux aux clics synthétiques cette session — voir §6 du 14 août) et la levée du blocage PIN par
biométrie (nécessite un appareil avec capteur biométrique réel). Les deux corrections sont ciblées et
de faible risque (ajout d'un verrou/reset, pas de changement de logique existante) ; à confirmer par
l'auteur en usage réel.

`CACHE_VERSION` : `v49` → `v50`.

### 15 août 2026 (suite) — Recherche globale : plafond silencieux + filtres avancés incomplets

Signalé par l'utilisateur : "la recherche ne fonctionne pas comme je veux." Presque tout ce qu'il
listait était déjà cherché (notes, tags, descriptions, portefeuilles, dettes/créances, comptes
gardés — voir `search.js` déjà en place depuis le §6 du 13 août), donc le vrai problème n'était pas
"quoi" chercher mais deux limites concrètes non documentées :

1. **`collectSearchIndex()` plafonnait à 500 transactions** (`getEnrichedTransactions({ limit: 500 })`)
   — au-delà, les transactions les plus anciennes (et leurs notes) devenaient introuvables sans
   aucun signal à l'utilisateur. Silencieux et facile à atteindre pour un usage de plusieurs années
   (voir le jeu de test de 14 600 transactions déjà utilisé cette session, CLAUDE.md §6, 14 août).
   → Retiré (`getEnrichedTransactions()` sans limite). Coût mesuré : un seul chargement à l'ouverture
   de la modale de recherche, pas un chemin chaud — acceptable même à grande échelle.
2. **Aucun filtre par portefeuille, catégorie ou type**, alors que "montant/dates" existaient déjà
   (§6, 13 août) — c'est précisément ce que l'auteur demandait explicitement en plus.
   → Trois `<select>` ajoutés à la barre de filtres avancés (`#search-filter-wallet`,
   `#search-filter-category`, `#search-filter-type`), peuplés depuis `STORES.WALLETS`/
   `STORES.CATEGORIES` à l'ouverture de la modale, même logique "ne s'applique qu'aux transactions"
   que les filtres montant/date existants. Les éléments d'index transaction portent maintenant
   `walletId`/`categoryId`/`txType` (pas seulement leurs noms dans le texte cherché) pour permettre
   ce filtrage exact.

Testé : jeu de données de 520 transactions (dont une note unique à la position 520, au-delà de
l'ancien plafond de 500) → trouvée après le retrait de la limite ; filtre type=transfer sur une
recherche large → ne garde que le virement ; filtre portefeuille croisé avec le même virement →
disparaît/réapparaît selon le bon/mauvais portefeuille ; filtre catégorie testé de la même façon.
Les 24 assertions de `test/ledger.test.html` passent toujours (non concerné, mais vérifié par
habitude après tout changement touchant `ledger.js`/`db.js` indirectement via les imports partagés).

`CACHE_VERSION` : `v50` → `v51`.

### 15 août 2026 (suite) — Le message d'accueil disait toujours "Bonjour", même le soir

Signalé par l'utilisateur (capture d'écran, tableau de bord consulté en soirée). `renderDashboard()`
(`dashboard.js`) écrivait `Bonjour, ${prénom}` en dur, sans jamais regarder l'heure.

→ Nouvelle fonction `greetingWord()` : "Bonjour" de 5h à 18h, "Bonsoir" de 18h à 5h (convention
française usuelle), basée sur l'heure locale de l'appareil (`new Date().getHours()`, jamais UTC —
un salut affiché au mauvais moment de la journée n'aurait aucun sens).

Testé : à l'heure réelle actuelle (17h) → "Bonjour" (correct, sous le seuil) ; bornes vérifiées pour
0h/4h/5h/6h/9h/12h/17h/18h/19h/22h/23h → bascule exactement à 5h et 18h comme prévu. Les 24
assertions de `test/ledger.test.html` passent toujours (non concerné, vérifié par habitude).

`CACHE_VERSION` : `v51` → `v52`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 1/N : infrastructure + châssis + tableau de bord)

Demandé par l'auteur : rendre l'app bilingue français/anglais. Chantier accepté **par étapes,
écran par écran, sur plusieurs sessions** (décision explicite de l'auteur face à l'ampleur — ~8600
lignes de JS avec le français en dur partout, pas un système de traduction centralisé à activer).
Ce lot pose l'infrastructure et convertit le châssis de l'app + le tableau de bord ; le reste des
écrans (Transactions, Budgets, Épargne, Investissements, Dettes, Outils, Rapports, Partage, Comptes
gardés, Paramètres hors sélecteur de langue) **reste en français pour l'instant** — pas un bug, un
chantier pas encore fait à ces endroits (voir "État d'avancement" ci-dessous).

**Conception (`js/i18n.js`, nouveau fichier)** :
- Pas de framework i18n, pas de clés artificielles à inventer/maintenir : **la clé de traduction EST
  le texte français lui-même**. `t(fr)` (aliasé `tr` dans les fichiers qui utilisent déjà `t` comme
  nom de variable, voir piège ci-dessous) renvoie la traduction anglaise si la langue courante est
  `'en'` ET qu'une entrée existe dans le dictionnaire `EN`, sinon renvoie le français tel quel. Une
  chaîne pas encore ajoutée au dictionnaire ne casse jamais rien — elle reste juste en français, ce
  qui est exactement le comportement voulu pour un chantier "par étapes".
- Substitution de variables façon gabarit (`{clé}` dans la chaîne, ex: `t('Budget "{label}" à {pct}%
  de la limite', { label, pct })`) plutôt que concaténer des fragments traduits séparément : le
  français et l'anglais n'ordonnent pas toujours leurs mots pareil, un gabarit entier par langue est
  la seule façon de le garantir en général (même si dans les cas traités ici l'ordre coïncidait).
- Deux mécanismes de traduction :
  - JS dynamique (contenu construit dans les modules) : envelopper chaque chaîne dans `t('...')`.
  - HTML statique (`index.html` : menu, barre du haut, écran de verrouillage, tableau de bord) :
    attributs `data-i18n="texte français"` (contenu texte), `data-i18n-aria-label`/`data-i18n-title`/
    `data-i18n-placeholder` (attributs) — appliqués par `applyStaticTranslations()`.
- **Changer de langue recharge la page** (`setLanguage()`) plutôt que de rendre chaque écran
  réactif à la volée : chaque vue reconstruit déjà tout son HTML depuis zéro à chaque rendu, un
  rechargement complet garantit une traduction cohérente partout d'un coup pour un gain de réactivité
  quasi nul (changer de langue est rare). `initI18n()` s'exécute tout au début du boot (`app.js`,
  avant même `seedDefaultsIfNeeded()`) pour traduire le châssis statique avant le premier rendu —
  évite un flash de français pour un utilisateur en anglais.
- **Formatage des nombres/dates rendu dépendant de la langue, pas seulement les libellés** :
  `formatCurrency()`/`formatDate()`/`formatMonthLabel()` (`utils.js`) utilisaient `Intl` figé sur
  `'fr-FR'` — un montant en mode anglais se serait quand même affiché `"300,00 €"` (virgule
  décimale) au lieu de `"€300.00"`. Passés à une locale dépendante de `getLanguage()`
  (`'en-US'`/`'fr-FR'`), avec le cache de formatters de devise reclé par locale+devise (pas
  seulement devise) pour ne jamais mélanger un formatter français et un formatter anglais. `utils.js`
  importe `getLanguage` depuis `i18n.js`, qui n'importe rien de `utils.js` en retour — pas de cycle.

**Piège rencontré** : `dashboard.js` utilise déjà `t` comme nom de paramètre pour une transaction
(`function txRowHtml(t) {...}`). Importer la fonction de traduction sous le même nom l'aurait
silencieusement masquée à l'intérieur de cette fonction précise — `t('Sans catégorie')` aurait
tenté d'appeler la transaction comme une fonction (`TypeError` immédiat au premier rendu avec des
transactions). Import aliasé `import { t as tr } from '../i18n.js';` dans ce fichier ; à vérifier
au cas par cas dans les prochains fichiers convertis (`grep` le nom `t` utilisé comme variable
avant d'importer tel quel).

**Sélecteur de langue** : nouvelle section dans Paramètres (`renderLanguageSection`, `settings.js`),
entre "Fonctionnalités optionnelles" et "Devise de base" — un simple `<select>` FR/EN, prévient déjà
que certains écrans resteront en français le temps du reste du chantier.

**État d'avancement** (à tenir à jour à chaque lot suivant) :
- ✅ Infrastructure (`i18n.js`), châssis de l'app (menu, barre du haut, bas de page mobile, écran de
  verrouillage), tableau de bord complet, formatage devises/dates/mois.
- ✅ Transactions (lot 2, voir entrée du 15 août 2026 ci-dessous) : modale Saisie express (y compris
  mode scindé, scan de justificatif), rapprochement bancaire, liste + filtres, sélection multiple.
- ✅ Budgets (lot 3, voir entrée ci-dessous) : les 5 onglets (Budgets du mois, Budgets annuels,
  Catégories, Récurrences, Règles) et leurs modales.
- ✅ Épargne (lot 4, voir entrée ci-dessous) : objectifs, contributions, archivage.
- ✅ Investissements (lot 5, voir entrée ci-dessous) : cartes, historique, comparatif de rendement.
- ✅ Dettes & créances (lot 6, voir entrée ci-dessous) : cartes, formulaires, simulateur
  Avalanche/Boule de neige.
- ✅ Outils (lot 7, voir entrée ci-dessous) : les 8 outils stratégiques.
- ✅ Rapports (lot 8, voir entrée ci-dessous) : bilans PDF (mensuel + annuel), export CSV, score de
  santé financière, calendrier des dépenses.
- ✅ Partage de dépenses (lot 9, voir entrée ci-dessous) : participants, dépenses partagées, soldes.
- ✅ Comptes gardés (lot 10, voir entrée ci-dessous) : comptes, mouvements, archivage.
- ✅ Paramètres (lot 11, voir entrée ci-dessous) : profil, sécurité, notifications, installation,
  mise à jour, tableau de bord, fonctionnalités optionnelles, devise de base, sauvegarde/restauration
  (hors sauvegarde cloud, voir `firebase-sync.js` — pas encore traduit, section distincte).
- ✅ Sauvegarde cloud (lot 12, voir entrée ci-dessous) : `firebase-sync.js` complet (connexion,
  push/pull, rappels, vérification de fraîcheur).
- ✅ Recherche globale (lot 13, voir entrée ci-dessous) : `search.js` complet (index, filtres
  avancés, résultats).
- ✅ Mode démo et assistant de configuration (lot 14, voir entrée ci-dessous) : bandeau, contenu du
  jeu de données de démonstration, assistant d'onboarding complet (7 étapes).

**⚠️ Le lot 14 avait été annoncé à tort comme la fin du chantier.** L'auteur a demandé une
vérification directe ("tu es sûr que l'app est totalement bilingue jusque là?") — un audit
systématique (recherche de `import.*i18n` manquant + recherche de chaînes accentuées hors
commentaires) a révélé plusieurs trous réels, corrigés dans les lots 15-18 ci-dessous :
- **`wallets.js` (écran Portefeuilles) n'avait jamais été touché** — absent de la checklist depuis le
  début du chantier, alors que c'est un des écrans les plus utilisés de l'app. Corrigé au lot 15.
- `notifications.js` (notifications système OS), `backup.js` (erreurs d'import/export), le
  `cancelText` par défaut de `confirmDialog()` (`utils.js` — affectait TOUTES les boîtes de
  confirmation de l'app), et deux labels de graphiques (`ledger.js`, `charts.js`) — corrigés aux
  lots 16-18.

Cette mésaventure est documentée ici volontairement : la bonne méthode pour vérifier qu'un chantier
de traduction est complet n'est pas de se fier à une checklist construite au fil de l'eau (celle du
lot 1, écrite de mémoire en listant les éléments du menu, avait simplement omis Portefeuilles), mais
de lister tous les fichiers du projet et vérifier lesquels importent (ou devraient importer)
`i18n.js` — c'est exactement l'audit (`grep` sur chaque fichier `js/**/*.js`) qui a débusqué
`wallets.js` ainsi que les autres trous listés ci-dessus, en quelques minutes.

Testé : bascule FR→EN puis EN→FR (aller-retour complet) — menu latéral, titre de la barre du haut,
navigation mobile, écran de verrouillage (titre/sous-titre/aria-labels) et tableau de bord entier
(salutation, alertes de budget dépassé, tendances, montants, dates) vérifiés traduits correctement
dans les deux sens ; formatage confirmé : `"300,00 €"`/`"05 août 2026"` en français devient
`"€300.00"`/`"Aug 05, 2026"` en anglais pour les mêmes données. Sélecteur de langue dans Paramètres
rendu et vérifié (options FR/EN, la bonne présélectionnée). Les 24 assertions de
`test/ledger.test.html` passent toujours.

`CACHE_VERSION` : `v52` → `v53` (nouveau fichier `js/i18n.js` ajouté à `APP_SHELL`).

**Deux clarifications tranchées avec l'auteur avant ce lot** (question posée, réponse explicite) :
- « Comptes gardés » → traduit **« Managed accounts »** (pas de traduction littérale plus
  maladroite envisagée un temps).
- Les catégories par défaut doivent-elles se créer en anglais pour une toute nouvelle installation
  déjà en anglais ? → **Oui, uniquement à la création, jamais rétroactivement** pour une catégorie
  déjà existante (confirme le choix déjà fait par construction dans `t(c.name)` à l'insertion).

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 2/N : Transactions)

Suite du chantier « par étapes, écran par écran » (l'auteur a explicitement demandé de continuer la
traduction avant de pousser le lot 1, avec invitation à poser des questions de clarification en cours
de route). Écran converti cette fois : **Transactions**, dans son ensemble — modale Saisie express
(y compris mode scindé et scan de justificatif), rapprochement bancaire, liste filtrée, sélection
multiple, journal d'audit associé.

**Piège `t`/variable déjà connu, reproduit à l'identique** (voir lot 1) : `transactions.js` utilise
`t` comme nom de paramètre pour une transaction dans plusieurs fonctions (`txRowHtml(t)`,
`reconTxRowHtml(t, currency)`, une `const t` locale dans le handler de clic de
`initTransactionsModule`). Vérifié par `grep` avant d'écrire l'import, import aliasé directement
`import { t as tr, applyStaticTranslations } from '../i18n.js';` — pas eu besoin de repasser derrière
cette fois (contrairement au lot 1 sur `dashboard.js`, où l'erreur avait été commise puis corrigée).

**`<template>` et traduction statique** : `tpl-modal-quick-add` (`index.html`) a reçu ses attributs
`data-i18n`/`data-i18n-aria-label`/`data-i18n-placeholder` comme n'importe quel HTML statique — mais
le contenu d'un `<template>` n'existe pas dans le `document` avant clonage, donc le passage unique
d'`applyStaticTranslations()` au boot ne les touche jamais. `openQuickAdd()` (déjà correct depuis
avant ce lot) rappelle `applyStaticTranslations()` juste après avoir inséré le clone dans le DOM.

**Nouveau : `data-i18n-alt`** — le justificatif photo prévisualisé (`<img id="qa-receipt-preview-img"
alt="...">`) est le premier cas de texte statique traduisible porté par un attribut `alt`, que les
trois mécanismes existants (`data-i18n`, `-aria-label`, `-title`, `-placeholder`) ne couvraient pas.
Ajouté `data-i18n-alt` à `applyStaticTranslations()` (`i18n.js`), même principe que les autres.

**Décision de traduction notable : le mot « Annuler » sert à deux rôles distincts dans l'app** — le
bouton Annuler par défaut de `confirmDialog()` (`utils.js`, pas encore traduit à ce stade du chantier)
ET le libellé d'action « annuler » sur les toasts de restauration après suppression (ce fichier, et au
moins `kept-accounts.js`/`debts.js` à convertir plus tard). Comme la clé de traduction est le texte
français lui-même, les deux usages partagent inévitablement la même entrée de dictionnaire. Choix fait
ici : `'Annuler': 'Undo'` (le rôle activement câblé dans ce lot). **Piège posé pour la suite** : si
`confirmDialog()` est traduit un jour, ne PAS le faire passer par cette même clé `'Annuler'` (il lui
faudrait `'Cancel'`) — prévoir un mécanisme séparé pour son `cancelText` par défaut. Commentaire laissé
en place dans `i18n.js` à côté de l'entrée pour ne pas se faire piéger.

**Notes d'audit traduites à la création, comme les catégories par défaut** — les chaînes passées à
`logAudit({..., note: ...})` dans ce fichier (« Transaction scindée », « Catégorisation groupée »,
« Pointée (groupé) », etc.) sont lues et affichées telles quelles par l'écran Outils > Journal d'audit
(`tools.js`, pas encore converti). Enveloppées dans `tr(...)` au même titre que le reste : une note
créée en anglais reste en anglais dans le journal même après un retour au français, exactement le même
principe que les catégories par défaut (traduction au moment de l'écriture, jamais de ré-traduction
rétroactive d'une donnée déjà en base).

**Nouvelles entrées de dictionnaire** : ~95 nouvelles clés (`i18n.js`), section « Transactions »
— vérifié par script qu'aucune ne duplique une clé existante (`js/i18n.js`, dictionnaire à plat,
188 clés au total après ce lot).

Testé dans le navigateur, bascule FR→EN→FR complète : modale Saisie express (labels, segmented
Dépense/Recette/Transfert, mode scindé, placeholders, bouton Enregistrer), rapprochement bancaire
(formulaire, résultat calculé avec écart réel, liste de transactions non pointées, action « Pointer »),
liste + filtres (mois au format anglais « August 2026 », sélecteurs, état vide), sélection multiple
(barre d'actions, modale de recatégorisation groupée, suppression groupée avec confirmation + toast
« Undo »), et le journal d'audit (`STORES.AUDIT_LOG` lu directement) confirmant que les notes créées en
anglais (« Bulk deletion », « Reconciled (assisted reconciliation)) y restent affichées telles quelles.
Retour en français vérifié à la fois par re-vérouillage (écran de PIN redevenu « Déverrouiller
GeoFinance ») et par rendu direct des fonctions du module (`renderTransactions()`, `openQuickAdd()`) :
tout le texte français d'origine, y compris le formatage de date (« Août 2026 »), identique à avant le
chantier — aucune régression sur le chemin non traduit.

`CACHE_VERSION` : `v53` → `v54`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 3/N : Budgets)

Suite du chantier (l'auteur a explicitement demandé de continuer sans s'arrêter pour pousser :
« non je veux qu'on continues la traduction. je veux faire le push une fois le translate fini pour
tous les modules »). Écran converti : **Budgets**, dans son ensemble — les 5 onglets (Budgets du
mois, Budgets annuels, Catégories, Récurrences, Règles de catégorisation automatique) et leurs
modales (formulaire de catégorie avec sélecteur d'icône/couleur/mode enveloppe, formulaire de
récurrence). Aucun `t`/variable en collision dans ce fichier (vérifié par `grep` avant d'importer) —
import direct `import { t } from '../i18n.js';`, pas d'alias nécessaire cette fois.

**Bug latent trouvé et corrigé en cours de route, avant qu'il ne devienne réel** : la note posée sur
chaque transaction générée automatiquement par une récurrence (`generateDueRecurring()`, budgets.js)
suit le gabarit `"Récurrence : {nom}"`. `detectRecurringCandidates()` (`ledger.js`, corrigée le 15
août plus tôt cette session — voir le bug #4 de la revue étendue) compare ce préfixe **en dur** pour
exclure ces transactions de ses suggestions. Traduire naïvement cette note via `t()` aurait produit
`"Recurrence: {nom}"` en mode anglais — un préfixe que `ledger.js` n'aurait plus reconnu, réintroduisant
exactement le bug déjà corrigé une fois (les récurrences déjà déclarées auraient été re-proposées en
boucle comme si elles ne l'étaient pas, mais seulement pour les utilisateurs en anglais, un régression
silencieuse et difficile à repérer). → `RECURRING_NOTE_PREFIX` (`ledger.js`) devient
`RECURRING_NOTE_PREFIXES` (tableau des deux variantes FR/EN), les deux vérifiées à la lecture — une
note existante ne se retraduit jamais rétroactivement, donc les deux formes doivent rester reconnues
indéfiniment, pas seulement pendant une période de transition.

**Nouvelles entrées de dictionnaire** : ~85 nouvelles clés (section « Budgets »), 0 doublon (vérifié
par script, 264 clés au total après ce lot). `+ Catégorie de budget` (en-tête `index.html`) inclus.

Testé dans le navigateur, bascule FR→EN→FR complète (rendu direct des fonctions du module, le clavier
PIN restant peu fiable aux clics synthétiques — même limite que les lots précédents) : les 5 onglets
et leurs libellés (dont l'entité `&amp;` de « Recurring expenses &amp; income », vérifiée décodée
correctement en `&` à l'affichage), le formulaire Nouvelle catégorie (nom/icône/couleur/mode
enveloppe/type/catégorie parente), le formulaire Nouvelle récurrence, et surtout **le point sensible
du lot** : une récurrence créée en anglais génère bien une transaction notée « Recurrence: {nom} »,
ET `detectRecurringCandidates()` l'exclut correctement de ses suggestions (vérifié explicitement,
avant et après le fix de `ledger.js` — reproduisait le problème puis confirmé résolu). Catégories par
défaut affichées en anglais (`Housing`, `Food`...) confirmant une fois de plus que la traduction à la
création (lot 1) reste cohérente ici aussi.

`CACHE_VERSION` : `v54` → `v55`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 4/N : Épargne)

Écran converti : **Épargne** (`savings.js`) — cartes d'objectif avec jauge circulaire, formulaire
objectif (création/édition), modale de contribution, archivage/désarchivage, suppression. Petit
module (157 lignes), aucun piège `t`/variable, converti en un seul passage. Confirmation de
suppression (`confirmDialog`) vérifiée : message et bouton "Delete" traduits, bouton "Annuler" par
défaut de `confirmDialog()` toujours en français comme prévu (`utils.js` pas encore converti — même
limite déjà notée aux lots précédents).

~30 nouvelles entrées de dictionnaire, 0 doublon (290 clés au total).

Testé FR→EN→FR : cartes d'objectif (jauge, échéance formatée en anglais « Jan 01, 2027 »), modale
Nouvel objectif d'épargne (tous les champs, le sélecteur de devise partagé restant en français comme
attendu), modale de contribution (titre interpolé avec le nom de l'objectif), confirmation +
suppression réelle testée de bout en bout (toast "Goal deleted." confirmé), retour en français vérifié
sans régression.

`CACHE_VERSION` : `v55` → `v56`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 5/N : Investissements)

Écran converti : **Investissements** (`investments.js`) — cartes (capital net, valeur actuelle,
dividendes, ROI, rendement annualisé), formulaire investissement, modale historique
(apports/retraits/dividendes/valorisations), comparatif de rendement par classe d'actif, filtre
Tous/Actifs financiers/Biens physiques. `ASSET_CLASSES`/`ENTRY_TYPE_LABELS` : les **clés** de ces
deux objets sont des valeurs stockées en base (`inv.assetClass`, `entry.type`), jamais traduites —
seules leurs **valeurs** (libellés affichés) passent par `t(...)`, à l'usage, jamais à la déclaration
de l'objet (même distinction que `DEFAULT_CATEGORIES`/`FREQ_LABELS` des lots précédents).

**Oubli du lot 1 corrigé au passage** : `renderNetWorthTrendChart()` (`charts.js`) prend un libellé de
jeu de données Chart.js (visible en infobulle) avec un défaut `'Valeur nette'` codé en dur — jamais
traduit, y compris depuis `dashboard.js` (déjà converti au lot 1). Le tableau de bord passait par ce
défaut sans jamais le surcharger. → `dashboard.js` passe maintenant explicitement `tr('Valeur nette')`
au lieu de compter sur le défaut de `charts.js` (qui reste en français par défaut — `charts.js`
lui-même n'est pas encore dans le périmètre du chantier, mais chaque appelant peut déjà passer un
libellé traduit).

~50 nouvelles entrées de dictionnaire, 0 doublon (335 clés au total).

Testé FR→EN→FR : cartes d'investissement (classe d'actif traduite en badge, ex. "Stocks", montants),
modale Nouvel investissement (toutes les classes d'actif), modale Historique (titre interpolé avec le
nom de l'investissement, types d'entrée traduits dans la liste et le formulaire), tableau de
comparatif de rendement, filtres, aucune erreur console.

`CACHE_VERSION` : `v56` → `v57`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 6/N : Dettes & créances)

Écran converti : **Dettes & créances** (`debts.js`) — cartes, formulaire dette/créance (avec le
mouvement de portefeuille optionnel à la création), modale de remboursement, simulateur stratégique
Avalanche/Boule de neige, historique du désendettement. Piège `t`/variable reproduit à l'identique
(voir lots précédents) : `t` utilisé comme nom de variable pour une transaction dans le handler de
suppression de `initDebtsModule()` — import aliasé `tr` dès le départ.

**Bug potentiel identifié et corrigé avant qu'il ne se produise, le plus important de ce lot** :
`ensureDebtCategoryId()` retrouve-ou-crée la catégorie "Prêt"/"Créance" réservée aux mouvements de
dette (voir §6, 13 août — ces catégories existaient déjà avant l'i18n) par **égalité exacte de nom**.
Traduire naïvement le nom passé à la création (`t('Prêt')` = `'Loan'` en anglais) aurait cassé cette
recherche : un utilisateur ayant déjà une catégorie "Prêt" (créée en français) qui passe l'app en
anglais et enregistre une nouvelle dette se serait retrouvé avec une **catégorie "Loan" dupliquée**
créée à côté de son "Prêt" existant, au lieu de le réutiliser — fragmentant silencieusement ses
dettes entre deux catégories selon la langue active à chaque création. Exactement le même type de
piège que `RECURRING_NOTE_PREFIX` (lot 3), mais sur une clé de recherche par nom plutôt qu'un préfixe.
→ `DEBT_CATEGORY_NAME_VARIANTS` (nouveau, `debts.js`) : toutes les traductions connues (FR + EN) des
deux noms canoniques, vérifiées à la recherche ; seule la création choisit la traduction courante via
`tr(...)`. Vérifié explicitement par test : une catégorie "Prêt" injectée avant le passage en anglais
est bien retrouvée par `ensureDebtCategoryId('debt', 'income')` en mode anglais (aucune catégorie
"Loan" dupliquée créée).

~55 nouvelles entrées de dictionnaire, 1 doublon détecté et corrigé (`'Créer'`, déjà présent depuis le
lot Budgets — réutilisé au lieu d'être redéclaré), 384 clés au total après ce lot.

Testé FR→EN→FR : cartes (badge Dette/Créance, montants, échéance), formulaire Nouvelle dette/créance
(bascule Dette/Créance, case "argent bouge aujourd'hui", sélection de portefeuille), modale de
remboursement, simulateur (résultat normal avec ordre de remboursement traduit y compris le "(month
{n})" imbriqué, et message d'alerte quand le budget mensuel ne couvre pas les intérêts), et surtout le
test explicite de non-régression sur `ensureDebtCategoryId` décrit ci-dessus. Aucune erreur console.

`CACHE_VERSION` : `v57` → `v58`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 7/N : Outils)

Écran converti : **Outils** (`tools.js`) — les 8 outils stratégiques (simulateur de trajectoire
patrimoniale, calculateur d'inflation, fonds d'urgence, impact d'un achat important, enveloppes
50/30/20, abonnements non déclarés, détection d'anomalies, journal d'audit). Piège `t`/variable
reproduit à l'identique : `t` utilisé comme nom de variable pour un outil (`{html, wire}`) dans
`renderTools()` et pour une transaction dans `renderAnomalyTool()` — import aliasé `tr` dès le début.
`ACTION_LABELS`/`ENTRY_TYPE_LABELS`-style : mêmes conventions que les lots précédents (clés
non traduites, valeurs traduites à l'usage).

**Oubli distinct trouvé et corrigé au passage** : `formatDateTime()` (journal d'audit) appelait
`new Intl.DateTimeFormat('fr-FR', ...)` en dur — jamais passé par `getLanguage()`, contrairement à
`formatDate()`/`formatCurrency()`/`formatMonthLabel()` (`utils.js`, déjà corrigés au lot 1). Les
horodatages du journal d'audit restaient donc au format français même en mode anglais.
→ `intlLocale()` (`utils.js`) — jusqu'ici une fonction privée non exportée — est maintenant exportée
et réutilisée ici plutôt que de dupliquer sa logique. Vérifié : horodatage affiché en `8/15/26, 10:22
PM` (anglais) puis `15/08/2026 22:22` (français) pour la même entrée, aller-retour correct.

~65 nouvelles entrées de dictionnaire, 0 doublon (447 clés au total).

Testé FR→EN→FR : les 8 panneaux (titres, labels, résultats calculés en direct pour chacun — dont le
mode crédit du simulateur d'achat avec taux d'intérêt non nul, vérifiant l'interpolation imbriquée
« (including {amount} in interest) »), le journal d'audit (libellés d'action + horodatages
bilingues), aucune erreur console.

`CACHE_VERSION` : `v58` → `v59`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 8/N : Rapports)

Écran converti : **Rapports** (`reports.js` + `reports-extras.js`) — bilan PDF mensuel et annuel
(génération jsPDF), export CSV, score de santé financière, calendrier des dépenses (heatmap). Piège
`t`/variable reproduit à l'identique dans `reports-extras.js` (`wireCalendarPanel` utilise `t` comme
nom de transaction) — import aliasé `tr` dès le départ ; `reports.js` lui-même n'a aucune collision
(import direct `t`).

**Décision de ce lot, différente des précédents : le contenu généré du PDF est traduit aussi**, pas
seulement l'écran qui le déclenche — cohérent avec l'objectif « toute l'app bilingue » de l'auteur.
Chaque `doc.text(...)` passe maintenant par `t(...)`, y compris les titres de section, les libellés
de synthèse et le texte des états vides.

**Piège distinct rencontré, propre à ce fichier** : `WEEKDAY_LABELS` (initiales des jours de la
semaine dans le calendrier) était un tableau à une seule lettre par jour (`['L','M','M','J','V','S',
'D']`) — le français a deux "M" (Mardi/Mercredi) à des positions différentes. Un simple `t('M')` par
lettre n'aurait pas pu distinguer ces deux usages ni produire les bonnes initiales anglaises
(`M,T,W,T,F,S,S`, qui a son propre doublon de "T" à des positions différentes). → Deux tableaux
complets (`WEEKDAY_LABELS_FR`/`WEEKDAY_LABELS_EN`), sélectionnés via `getLanguage()` plutôt que
traduits lettre par lettre.

**Deux oublis trouvés et corrigés pendant les tests de ce lot, avant le commit** (le titre du panneau
"Score de santé financière" et la ponctuation "{date} : {montant}" de l'infobulle du calendrier
restaient en français en mode anglais — clés manquantes au premier passage) : preuve que le test
bidirectionnel systématique après chaque lot vaut la peine, pas juste une formalité.

~50 nouvelles entrées de dictionnaire, 2 doublons détectés et corrigés (`'Dépenses par catégorie'`,
`'Budget vs réel'`, déjà présents depuis le lot Tableau de bord — réutilisés), 492 clés au total.

Testé FR→EN→FR : les deux panneaux de bilan (labels, boutons), score de santé financière (jauge +
3 indicateurs), calendrier (initiales de semaine, infobulles, détail d'un jour cliqué avec une
transaction injectée), export CSV (toast), et les chaînes exactes injectées dans le PDF vérifiées
directement via `t(...)` (titre, période, résumé, patrimoine net, bilan annuel, détail mensuel) —
aucune erreur console à aucune étape.

`CACHE_VERSION` : `v59` → `v60`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 9/N : Partage de dépenses)

Écran converti : **Partage de dépenses** (`shared.js`) — participants (dont le marquage "Moi"),
dépenses partagées avec répartition à parts égales, soldes nets par devise, part personnelle
automatique dans les transactions quand "Moi" fait partie du partage. Aucune collision `t`/variable
dans ce fichier (vérifié par `grep`) — import direct.

~40 nouvelles entrées de dictionnaire, 0 doublon (526 clés au total).

Testé FR→EN→FR de bout en bout avec un scénario réaliste : deux participants créés (Bob, Alice),
Alice marquée "Moi" (badge traduit), modale Nouvelle dépense partagée (tous les champs, y compris les
sections conditionnelles "ma part"), dépense enregistrée avec toast, panneau Soldes recalculé et
affiché ("Settled up" pour les deux participants — résultat mathématiquement correct pour le scénario
testé), ligne de dépense partagée avec le gabarit "Paid by {payer} · {date} · Split among {names}",
nettoyage des données de test puis retour en français vérifié identique à l'original. Aucune erreur
console.

`CACHE_VERSION` : `v60` → `v61`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 10/N : Comptes gardés)

Écran converti : **Comptes gardés** (`kept-accounts.js`) — comptes (avec solde initial et devise),
mouvements (entrées/sorties), archivage, suppression avec restauration. Aucune collision `t`/variable
(vérifié par `grep`) — import direct. Module optionnel (activable dans Paramètres,
`keptAccountsEnabled`) : testé directement via les fonctions du module (même limite déjà notée aux
lots précédents pour tout ce qui nécessite de naviguer via le clavier PIN), la visibilité du bouton de
nav lui-même n'étant pas concernée par ce chantier de traduction.

~28 nouvelles entrées de dictionnaire, 0 doublon (553 clés au total).

Testé FR→EN→FR de bout en bout : création d'un compte (via injection directe, formulaire vérifié
séparément), carte de compte (devise + badge "archived"), modale de détail avec ajout d'un mouvement
("In"/"Out", montant, note), archivage, confirmation de suppression + suppression réelle avec toast
"Undo", nettoyage des données de test, retour en français vérifié (état vide correctement affiché).
Aucune erreur console.

`CACHE_VERSION` : `v61` → `v62`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 11/N : Paramètres)

Écran converti : **Paramètres** (`settings.js`, 643 lignes — le plus gros fichier converti jusqu'ici),
hors sauvegarde cloud (`firebase-sync.js`, fichier distinct, prévu en lot séparé juste après). Onze
sections : profil, sécurité (PIN + biométrie + verrouillage auto), notifications, installation PWA,
mise à jour, configuration du tableau de bord, fonctionnalités optionnelles, langue (déjà fait au lot
1, non retouché), devise de base, sauvegarde/restauration (JSON/JSON chiffré/CSV + import générique
avec mapping de colonnes), zone dangereuse. Aucune collision `t`/variable dans `settings.js` — import
direct.

**`auth.js` retouché dans ce lot** (déjà converti partiellement au lot 1 pour l'écran de
verrouillage) : les messages d'erreur renvoyés par `changePin()`/`registerBiometric()`/
`verifyBiometric()` remontent tels quels jusqu'à l'écran Paramètres (`err.message`) — jamais traduits
jusqu'ici alors qu'ils s'affichent bien à l'utilisateur. Traduits au passage, ainsi que les notes
d'audit associées (« Code PIN configuré », « Biométrie activée/désactivée »), cohérent avec le
principe déjà appliqué ailleurs (notes traduites à la création).

**Deux collisions de clé réelles détectées et corrigées avant duplication** (sur 6 doublons au total,
les 4 autres de simples réutilisations légitimes de clés déjà correctes) :
- `'Nom'` existait déjà (« Name », formulaire de catégorie Budgets) mais le champ profil `Nom` désigne
  ici précisément le nom de famille (à côté de `Prénom`) — réutiliser la traduction générique aurait
  affiché « Name » / « First name », une asymétrie confuse. → Texte source changé en **`Nom de
  famille`** (`PROFILE_FIELDS`, `settings.js` — constante partagée avec l'assistant de configuration
  dans `app.js`, toujours pas converti mais qui héritera de ce libellé plus précis quand son tour
  viendra), nouvelle clé dédiée « Last name ».
- `'À jour'` existait déjà (« Settled up », soldes de Partage de dépenses) mais le badge de statut de
  mise à jour logicielle utilise le même mot français pour un sens totalement différent. → Texte
  source changé en **`Version à jour`** (`renderUpdateSection`), plus précis de toute façon hors
  contexte, nouvelle clé dédiée « Up to date ».

**Oubli trouvé et corrigé pendant les tests** : la description du module optionnel "Comptes gardés"
(`OPTIONAL_MODULES[0].description`) était bien passée à `tr(...)` à l'usage, mais aucune entrée
correspondante n'avait été ajoutée au dictionnaire — restait donc en français en mode anglais malgré
l'appel `tr()` en place (le mécanisme de repli silencieux de `t()` masque ce genre d'oubli sans
erreur, d'où l'importance du test bidirectionnel systématique).

**Constantes partagées avec l'assistant de configuration (`app.js`, onboarding — toujours pas
converti)** : `AUTO_LOCK_OPTIONS`, `PROFILE_FIELDS`, `DASHBOARD_PANEL_LABELS`, `OPTIONAL_MODULES`
gardent leurs libellés bruts en français à la déclaration (jamais traduits sur place), traduits
uniquement à l'usage dans `settings.js` — `app.js` continuera de les afficher en français jusqu'à son
propre lot, sans aucune régression entre-temps (comportement "pas encore traduit" normal).

~150 nouvelles entrées de dictionnaire (le plus gros lot), 6 doublons détectés et résolus (4 réutilisés,
2 corrigés en source comme détaillé ci-dessus), 705 clés au total.

Testé FR→EN→FR : les 11 panneaux traduits, formulaire profil (labels désambiguïsés), section sécurité
(changement de PIN avec message d'erreur réel testé — "Incorrect old PIN code." confirmé via une
tentative avec un ancien PIN volontairement faux), confirmation de réinitialisation complète
**annulée volontairement sans jamais confirmer** (pour ne pas effacer les données de test), section
notifications/installation/mise à jour, configuration du tableau de bord, fonctionnalités optionnelles
(description corrigée), et les chaînes de la modale de mapping CSV vérifiées directement via `t(...)`.
Aucune erreur console.

`CACHE_VERSION` : `v62` → `v63`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 12/N : Sauvegarde cloud)

Écran/fichier converti : **Sauvegarde cloud** (`firebase-sync.js`) — section restée hors du lot 11
(fichier distinct du reste de Paramètres). Connexion/déconnexion Google, sauvegarde/restauration à la
demande, rappel hebdomadaire (mode normal + urgent), modale de fraîcheur multi-appareils, tous les
messages d'erreur remontés depuis Firestore/Firebase Auth (`err.message` non traduit lui-même, comme
pour les autres SDK tiers déjà rencontrés — seul le texte autour est traduit). Aucune collision
`t`/variable — import direct.

~30 nouvelles entrées de dictionnaire, 0 doublon (735 clés au total). Avec ce lot, **toutes les vues
listées dans le menu de navigation ainsi que la totalité de l'écran Paramètres sont converties** —
reste : recherche globale, mode démo, assistant de configuration (onboarding).

Testé FR→EN→FR : état "non connecté" (bouton "Sign in with Google" avec le texte de confidentialité
du mot de passe), **déclenchement réel du flux de connexion Google testé** (le clic a effectivement
navigué vers `accounts.google.com` avec les bons paramètres OAuth — confirme que `signInWithRedirect`
se déclenche correctement en environnement automatisé où la popup est bloquée, exactement le
comportement documenté à la conception de cette fonctionnalité le 13 août) — **aucune tentative de
connexion réelle n'a été faite** (hors de portée d'une session automatisée, et interdit par les
règles de sécurité de cette session), retour immédiat à l'app puis nettoyage du réglage
`cloudRedirectPending` resté à `true` suite à la navigation. Messages des modales de rappel et de
fraîcheur cloud vérifiés directement via `t(...)` (ces flux nécessitent un compte connecté pour se
déclencher normalement). Aucune erreur console.

`CACHE_VERSION` : `v63` → `v64`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 13/N : Recherche globale)

Écran converti : **Recherche globale** (`search.js`) — modale de recherche (Ctrl/Cmd+K), index en
mémoire (transactions, portefeuilles, dettes/créances, épargne, investissements, comptes gardés,
dépenses partagées), filtres avancés (portefeuille/catégorie/type/montant/dates). Piège `t`/variable
reproduit à l'identique (`for (const t of transactions)` dans `collectSearchIndex()`) — import aliasé
`tr` dès le départ. `TYPE_LABELS` : mêmes conventions que `ASSET_CLASSES`/`ENTRY_TYPE_LABELS`
(investments.js) — clés (identifiants de type internes) jamais traduites, valeurs traduites à l'usage.

~18 nouvelles entrées de dictionnaire, 1 doublon détecté et corrigé (`'Portefeuille'`, déjà présent
depuis transactions.js — réutilisé), 750 clés au total.

Testé FR→EN→FR : filtres avancés (portefeuilles/catégories peuplés dynamiquement, types), placeholder
et aria-labels, recherche avec résultats (badges de type vérifiés pour Transaction/Wallet/Receivable/
Investment), recherche sans résultat ("No results."), état vide initial, gabarit "Paid by {payer} ·
{date}" vérifié directement via `t(...)`. Aucune erreur console.

`CACHE_VERSION` : `v64` → `v65`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 14/N, dernier lot : mode démo + onboarding)

Dernier lot du chantier. Fusionné volontairement en un seul lot les deux derniers éléments de la
checklist (« mode démo » et « onboarding ») car ils sont imbriqués dans le code : le bouton
"Découvrir avec des données d'exemple" qui déclenche le mode démo vit à l'intérieur de la toute
première étape de l'assistant de configuration (`maybeShowOnboarding()`, `app.js`), les séparer
proprement aurait été artificiel.

**Convertis** :
- `renderDemoModeBanner()` (`app.js`) — bandeau permanent affiché tant que `isDemoModeActive` est vrai.
- `maybeShowOnboarding()` (`app.js`, ~205 lignes) — les 7 étapes de l'assistant (devise + bouton démo,
  premier portefeuille, profil, tableau de bord, modules optionnels, sécurité, notifications), le
  compteur "Étape X / Y", tous les libellés des constantes partagées (`PROFILE_FIELDS`,
  `AUTO_LOCK_OPTIONS`, `DASHBOARD_PANEL_LABELS`, `OPTIONAL_MODULES`) désormais traduits à l'usage ici
  aussi (elles l'étaient déjà côté `settings.js` depuis le lot 11, `app.js` était le seul appelant
  encore en attente).
- **`demo-data.js` — décision de ce lot** : le contenu généré (pas seulement l'écran qui le
  déclenche) est traduit aussi, cohérent avec la décision prise pour le contenu des PDF au lot 8. Noms
  de portefeuilles génériques (« Compte courant » → « Checking account », « Espèces » → « Cash »),
  toutes les notes de transaction (loyer, marché, essence, etc.), le nom de l'objectif d'épargne, le
  nom de l'investissement, la note de la créance. **Volontairement PAS traduits** : « Orange Money »
  (vraie marque, pas un libellé générique) et « Cousin Amadou » (nom de personne) — même principe que
  les noms propres jamais traduits ailleurs dans l'app.

Aucune collision `t`/variable dans `demo-data.js` (le seul `t` local, un paramètre de callback
`.map((t) => ...)`, n'appelle jamais la fonction de traduction dans son propre corps — vérifié).

~50 nouvelles entrées de dictionnaire, 0 doublon (plusieurs réutilisations vérifiées et confirmées
correctes : `'Continuer'`, `'Sécurité'`, `'Verrouillage automatique après inactivité'`, `'Biométrie
activée.'`, `"Échec de l'activation biométrique."`, `'Notifications'`, `'Notifications activées.'`,
`'Effacer'` — tous déjà justes dans ce nouveau contexte), 794 clés au total.

Testé FR→EN→FR : toutes les chaînes de l'assistant vérifiées directement via `t(...)` (le clavier PIN
rendant la navigation UI complète peu fiable, comme documenté depuis le tout premier lot — même limite
constante sur toute la session) ; **`seedDemoData()`/`clearDemoData()` testées de bout en bout en
conditions réelles** (pas seulement via `t()`) : jeu de données généré en anglais puis vérifié
(portefeuilles, notes de transaction, objectif d'épargne, investissement, créance — noms propres
« Orange Money »/« Cousin Amadou » confirmés intacts), bandeau et confirmation de suppression
vérifiés, `clearDemoData()` confirmée (réinitialise bien `isDemoModeActive`/`onboardingCompleted`),
puis même parcours complet rejoué en français pour confirmer l'absence de régression. Aucune erreur
console.

`CACHE_VERSION` : `v65` → `v66`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 15/N : Portefeuilles, trou comblé)

Écran converti : **Portefeuilles** (`wallets.js`) — cartes patrimoine (reste à vivre, patrimoine net,
composition), cartes de portefeuille, formulaire, panneau des taux de change (récupération en ligne
incluse). Ce module avait été **complètement oublié** de la checklist depuis le lot 1 — voir la note
d'avertissement plus haut dans ce fichier pour le contexte de sa découverte. Aucune collision
`t`/variable (vérifié par `grep`) — import direct. `WALLET_TYPES` : mêmes conventions que
`ASSET_CLASSES` (investments.js) — clés jamais traduites, valeurs traduites à l'usage. Beaucoup de
réutilisation de clés déjà posées par les lots précédents (Reste à vivre, Patrimoine net global,
Composition du patrimoine, Créances, Dettes, Investissements, Portefeuilles, tous depuis le lot 1 ou
les lots Budgets/Dettes/Comptes gardés).

~40 nouvelles entrées de dictionnaire, 0 doublon (828 clés au total).

Testé FR→EN→FR de bout en bout avec des données réelles (mode démo re-semé) : cartes patrimoine et
portefeuille, formulaire (tous les types de portefeuille traduits, « Mobile Money » gardé tel quel —
marque, pas un libellé générique), panneau des taux avec un portefeuille EUR ajouté pour forcer
l'affichage du panneau (badge "unconfirmed", saisie manuelle testée avec toast "EUR rate updated."
confirmé), suppression réelle d'un portefeuille de test (confirmation + toast "Wallet deleted."
vérifiés), nettoyage puis retour en français confirmé sans régression. Aucune erreur console.

`CACHE_VERSION` : `v66` → `v67`.

### 15 août 2026 (suite) — Internationalisation FR/EN (lot 16/N : notifications système, trou comblé)

Deuxième trou comblé de l'audit : `notifications.js` — titres et corps de **toutes** les notifications
système proactives (échéances récurrentes proches, dettes/créances à échéance, solde de portefeuille
bas, budget bientôt atteint, résumé hebdomadaire). Ces notifications s'affichent via l'API
Notification native du navigateur (pas de serveur, voir le commentaire d'en-tête du fichier) —
totalement invisibles depuis l'écran Paramètres où j'avais pourtant déjà traduit le bouton "Activer
les notifications" (lot 11) sans jamais ouvrir ce fichier. Aucune collision `t`/variable — import
direct.

~14 nouvelles entrées de dictionnaire, 0 doublon (841 clés au total).

Testé : **limite connue** — `Notification.permission` est `denied` par défaut dans le navigateur
automatisé de cette session (pas d'octroi possible sans geste utilisateur réel), donc `checkAndNotify()`
ne peut pas être déclenché de bout en bout ici (même limite déjà rencontrée pour la connexion Google
réelle). Chaque gabarit vérifié directement via `t(...)` avec des valeurs réalistes à la place, dans
les deux langues (aller-retour FR→EN→FR confirmé après un appel explicite à `initI18n()` pour
recharger le réglage — `setLanguage()` déclenchant un vrai rechargement de page que `javascript_exec`
ne peut pas attendre de façon fiable). Round-trip complet à confirmer par l'auteur en usage réel, sur
un appareil où les notifications sont autorisées.

`CACHE_VERSION` : `v67` → `v68`.

### 16 août 2026 — Internationalisation FR/EN (lot 17/N : sauvegarde, trou comblé)

Troisième trou comblé de l'audit : `backup.js` — messages d'erreur (sauvegarde chiffrée invalide, mot
de passe incorrect, CSV vide, portefeuille introuvable, navigateur non compatible), export CSV (en-tête
+ valeurs "Oui"/"Non" + suffixe de nom de fichier), toast de sauvegarde automatique, et surtout la
**modale de rappel hebdomadaire** (`tpl-modal-backup-reminder` dans `index.html`) qui n'avait jamais
reçu d'attributs `data-i18n` — mode normal et mode urgent (au-delà de 3 reports), plus le formulaire
d'export chiffré inline (mot de passe / confirmation / bouton) qu'elle affiche. Collision `t`/variable
trouvée (transactions nommées `t` dans plusieurs fonctions) — import aliasé `t as tr`, comme
dashboard.js/transactions.js/debts.js/tools.js/reports-extras.js/search.js.

Détection de format CSV rendue bilingue : `GEOFINANCE_CSV_HEADER_FR` (renommé depuis
`GEOFINANCE_CSV_HEADER`) sert toujours de clé i18n pour l'en-tête exporté, mais `analyzeTransactionsCsv`
compare désormais l'en-tête lu aux deux variantes (FR canonique et EN traduite) au lieu d'une seule —
même principe que `RECURRING_NOTE_PREFIXES` (ledger.js, lot 3) et `DEBT_CATEGORY_NAME_VARIANTS`
(debts.js, lot 6) : un CSV exporté par cette app en anglais doit se réimporter correctement. Idem pour
la colonne "Pointée/Reconciled" : `importGeoFinanceCsvRows` accepte désormais `['oui', 'yes']` au lieu
de `.startsWith('oui')` seul. Le gabarit `tpl-modal-backup-reminder` étant un `<template>` (donc inerte
tant que non cloné), `showBackupReminderModal()` relance `applyStaticTranslations()` juste après
l'insertion du clone — même pattern que `openQuickAdd()` (transactions.js, lot 2).

**Bug pré-existant trouvé et corrigé en cours de route** (pas un bug d'i18n, effet de bord de la
réécriture de la détection de format) : `analyzeTransactionsCsv()` retournait `rows` sans que cette
variable soit définie — `const rows = lines.slice(1).map(...)` avait été perdue pendant la réécriture.
Repéré immédiatement au test (import CSV plantait avec `ReferenceError: rows is not defined`), corrigé
avant commit.

~24 nouvelles entrées de dictionnaire, 0 doublon (862 clés au total). Réutilise `'Pointée'` →
`'Reconciled'` et `'Sauvegarde chiffrée exportée.'` → `'Encrypted backup exported.'`, déjà posées par
des lots précédents.

Testé FR→EN→FR de bout en bout via appels directs aux fonctions exportées de `backup.js` (SW/caches
vidés avant chaque test) : `analyzeTransactionsCsv` avec un CSV d'en-tête français et un CSV d'en-tête
anglais, tous deux correctement détectés comme format `geofinance` ; message d'erreur CSV vide ;
message d'erreur `decryptPayload` sur un payload invalide ; modale de rappel en mode normal et en mode
urgent (bouton "Plus tard" bien absent, titre et message d'alerte traduits) ; formulaire d'export
chiffré inline (paragraphe, libellés, bouton) et son toast de mots de passe non correspondants. Aucune
erreur console sur l'ensemble du test.

`CACHE_VERSION` : `v68` → `v69`.

### 16 août 2026 (suite) — Internationalisation FR/EN (lot 18/N, dernier lot : corrections transverses)

Dernière passe : au lieu de traiter un écran, un audit **systématique** de tout le dépôt pour vérifier
l'affirmation « l'app est totalement bilingue » avant de la refaire au auteur — méthode : `grep`
combiné (import i18n manquant par fichier + recherche de tout texte accentué français non enveloppé
dans `t(`/`tr(` à travers **tous** les fichiers, pas seulement ceux touchés récemment) plutôt que de se
fier à la liste des lots déjà faits. Trouvés et corrigés :

- **`utils.js`** (`confirmDialog`) : les valeurs par défaut `title`/`confirmText`/`cancelText` n'étaient
  jamais traduites — impacte QUASIMENT toutes les boîtes de confirmation de l'app (suppression d'une
  transaction, d'un portefeuille, d'un objectif, etc.), la plupart ne passant pas `cancelText`
  explicitement. Piège évité : la clé `'Annuler'` existe déjà dans le dictionnaire mais mappée à
  `'Undo'` (toasts d'annulation après suppression, lot 2) — un commentaire posé à l'époque avertissait
  justement de ne pas la réutiliser ici. Solution : contournement direct par `getLanguage()` (comme
  `intlLocale()` dans le même fichier) plutôt que par le dictionnaire, pour ce cas précis. `'Confirmer'`
  déjà traduit, `'Confirmation'` ajouté. `currencySelectHtml()` : l'option "Autre devise…" et son
  placeholder n'étaient pas non plus traduits — présents sur quasiment tous les formulaires impliquant
  une devise.
- **`ledger.js`** : les deux libellés de repli `'Sans catégorie'` (donut de dépenses par catégorie,
  budget vs réel) n'étaient pas enveloppés — clé déjà existante, juste manquait le `tr()`.
- **`charts.js`** : le libellé `'Réel'` du graphique Budget vs réel n'était pas traduit ; le diagramme
  de flux des revenus (`renderIncomeFlowSankey`, page Tableau de bord) était **entièrement oublié** —
  état vide, libellé "Revenus" du nœud source, et légende "Revenus du mois : {montant}".
- **`install-prompt.js`** — module **complètement oublié**, comme `wallets.js` au lot 15 : la bannière
  d'invitation à l'installation PWA (bouton Chrome/Edge natif, instructions iOS Safari "Partager > Sur
  l'écran d'accueil"), affichée après chaque déverrouillage tant que l'app n'est pas installée. Aucune
  collision `t` (import direct).
- **`app.js`** : le toast affiché en basculant le thème ("Thème : Automatique/Clair/Sombre") n'était pas
  traduit ; l'écran d'erreur affiché en cas d'échec critique au démarrage non plus — vérifié que `t()`
  reste utilisable même si `initI18n()` lui-même a échoué (`currentLang` vaut `'fr'` par défaut au
  chargement du module, donc pas de risque d'erreur en cascade dans ce chemin d'erreur).
- **`settings.js`** : suppression d'un avertissement bilingue devenu obsolète dans la section
  Langue/Language ("Certains écrans pas encore traduits resteront en français. / Some screens not yet
  translated will stay in French.") — posé au tout début du chantier (lot 1) quand c'était encore vrai,
  jamais retiré depuis. Laissé en place aurait été un mensonge actif envers l'utilisateur final une fois
  ce lot terminé.

~30 nouvelles entrées de dictionnaire, 0 doublon (880 clés au total).

Testé FR→EN→FR de bout en bout (SW/caches vidés avant chaque test) : `confirmDialog()` par défaut
("Confirmation" / "Annuler"↔"Cancel" / "Confirmer"↔"Confirm", `'Annuler'`→`'Undo'` du toast d'annulation
vérifié inchangé en parallèle) ; `currencySelectHtml()` (option "Autre devise…" + placeholder) ;
`renderBudgetVsActualChart` (libellés des deux séries) ; `renderIncomeFlowSankey` (état vide + nœud +
légende, avec des données réalistes) ; bannière d'installation simulée via un faux événement
`beforeinstallprompt` (branche Chrome/Edge testée en direct dans les deux langues ; branche iOS Safari
vérifiée via `t()` direct, même limite que la connexion Google réelle — UA non simulable de façon fiable
dans ce navigateur automatisé) ; toast de changement de thème (3 valeurs) ; écran d'erreur de démarrage ;
section Langue/Language de Paramètres rendue en direct pour confirmer la disparition de l'avertissement
obsolète. Aucune erreur console sur l'ensemble du test.

**Bug pré-existant trouvé et corrigé en cours de route (lot 17, avant son commit)** : voir l'entrée du
lot 17 ci-dessus — `analyzeTransactionsCsv()` retournait une variable `rows` jamais définie.

`CACHE_VERSION` : `v69` → `v70`.

**Bilan de l'audit final (lots 15-18)** : après cette passe, tous les fichiers `.js` du dépôt contenant
du texte destiné à l'utilisateur importent `i18n.js`, à l'exception de `db.js` (définit
`DEFAULT_CATEGORIES`, traduit à l'usage lors de la création, jamais rétroactivement — voir le principe
documenté plus haut), `firebase-config.js` (config technique, pas de texte affiché), `ocr.js`/`state.js`
(aucun texte utilisateur), et `sw-register.js` (un seul `console.error` de diagnostic). Recherche
supplémentaire de tout texte français non enveloppé (accents non suivis de `t(`/`tr(`) à travers
l'ensemble du dépôt (JS + `index.html`) : aucun résultat restant en dehors de commentaires, de données
utilisateur (noms de catégories/portefeuilles/transactions, volontairement non retraduites) et de
dictionnaires clé/valeur déjà traduits à l'usage.

### 16 août 2026 (suite) — 3 bugs signalés par l'auteur après relecture visuelle

L'auteur a testé l'app en direct (mode anglais + export PDF) et remonté deux captures d'écran montrant
des problèmes réels, non liés au fond du chantier i18n mais découverts grâce à lui :

1. **Bouton natif de sélection de fichier bloqué en français** (Ajout rapide → Justificatif photo),
   même en mode anglais. Diagnostic : le libellé natif du navigateur pour `<input type="file">`
   ("Choisir un fichier"/"Aucun fichier choisi") suit la langue d'AFFICHAGE du navigateur lui-même
   (`chrome://settings/languages`), **pas** l'attribut `lang` de la page ni notre i18n — contrairement
   aux autres textes générés par le navigateur (validation de formulaire, sélecteur de date), ce bouton
   précis ignore `document.documentElement.lang`. Confirmé par recherche externe (comportement Chromium
   documenté, ex. Firefox bug 1538027). Aucun changement de `lang`/i18n ne peut le corriger. **Fix** :
   remplacement par un bouton stylé traduisible (`#qa-receipt-trigger`, `data-i18n="Choisir un
   fichier"`) qui déclenche `input.click()` sur le vrai `<input type="file">`, désormais rendu
   visuellement invisible (`clip:rect(0,0,0,0)`) mais fonctionnellement intact (capture photo mobile,
   accessibilité, `capture="environment"` préservés). `index.html` (template Ajout rapide) +
   `js/modules/transactions.js` (câblage du clic).
2. **Export PDF ("Bilan financier") : séparateur de milliers affiché en "/"** au lieu d'un espace
   (ex: "823/500 F/CFA" au lieu de "823 500 F CFA"). Diagnostic : `formatCurrency()` (utils.js), en
   locale `fr-FR`, produit des espaces Unicode fines/insécables (U+202F, U+00A0) comme séparateur —
   correct à l'écran (police web normale), mais la police intégrée de jsPDF (Helvetica, encodage
   WinAnsi 1 octet) n'a pas ces glyphes et affiche un caractère de repli qui ressemble à "/". Aucune
   sanitisation n'existait pour le contexte PDF. **Fix** : nouvelle fonction `pdfAmount(amount,
   currency)` dans `js/modules/reports.js`, qui appelle `formatCurrency()` puis remplace ces espaces
   Unicode par un espace normal — utilisée à la place de `formatCurrency()` dans TOUS les appels
   `doc.text(...)` des deux générateurs PDF (mensuel et annuel). L'affichage à l'écran (hors PDF) garde
   le formatage Intl d'origine, inchangé.
3. **Bug non lié, trouvé pendant les tests de vérification** (pas dans le diff de session, remonte au
   commit `6e6db5a`, bien avant le chantier i18n) : le flux "Découvrir avec des données d'exemple" de
   l'assistant d'onboarding (`app.js`, étape 1) appelait `notifyDataChanged('all')` sans jamais
   l'importer — `ReferenceError` silencieuse en pleine navigation, empêchant le rafraîchissement de
   l'UI après le chargement des données de démo. **Fix** : ajout de `notifyDataChanged` à l'import
   groupé depuis `./state.js` en tête de `app.js`.

Testé : bouton fichier vérifié dans les deux langues (FR "Choisir un fichier" / EN "Choose file"),
clic confirmé déclenchant bien le vrai `<input type="file">` sous-jacent ; PDF vérifié en interceptant
tous les appels `doc.text(...)` d'un vrai `generatePdfReport()` (jsPDF patché pour capturer le texte au
lieu de télécharger) — confirmé par code de caractère (`charCodeAt`) que le texte envoyé au PDF ne
contient plus ni U+202F ni U+00A0, alors que `formatCurrency()` brut les contient toujours (l'affichage
écran n'est pas dégradé) ; `notifyDataChanged` vérifié résolu et fonctionnel via le bus d'événements
réel. Un `console.error` `notifyDataChanged is not defined` avait été observé une fois en cours de
test — confirmé stale (onglet précédent, avant le fix) via un onglet neuf sans historique. Aucune
nouvelle entrée de dictionnaire pour ce lot hormis `'Choisir un fichier'` → `'Choose file'`.

`CACHE_VERSION` : `v70` → `v71`.

### 16 août 2026 (suite) — Vérification post-push : demo-data.js perdait la catégorie en anglais

Après le push, l'auteur a demandé une vérification explicite de la traduction et du thème sombre/clair.
Méthode (le rendu visuel du panneau Browser n'était pas affiché dans cette session, donc pas de
captures d'écran possibles) : rendu direct de chaque module (`renderDashboard`, `renderWallets`,
`renderTransactions`, `renderBudgets`, `renderSavings`, `renderInvestments`, `renderDebts`,
`renderTools`, `renderReports`, `renderShared`, `renderKeptAccounts`, `renderSettings`) avec de
vraies données de démo, extraction du texte réel de chaque section via `textContent`, en français
d'abord puis en anglais après re-semis des données de démo en anglais — plus une vérification
programmatique des variables CSS de thème (contraste WCAG) et du bouton de bascule de thème.

**Bug trouvé, invisible à l'audit statique précédent** (celui-ci cherchait du texte français non
traduit dans le code source — ce bug-ci est une erreur de LOGIQUE, pas de texte manquant) :
`demo-data.js`, fonction `cat(name)` (ligne ~56) — comparait le nom français canonique passé en
argument (ex: `cat('Alimentation')`) directement à `categories[i].name`, qui contient en réalité le nom
DÉJÀ TRADUIT (`t(c.name)`, donc `"Food"` en anglais). Résultat : en anglais, **toutes** les transactions
et tous les budgets de démonstration perdaient leur catégorie (`categoryId: null` → affiché "No
category" partout : tableau de bord, transactions, budgets, "Categories to watch"), alors que les
catégories elles-mêmes ÉTAIENT correctement nommées en anglais. Repéré en comparant le texte rendu :
"Transport" restait correctement assigné (le seul nom identique en FR/EN) tandis que "Alimentation"/
"Loisirs"/etc. donnaient tous "No category". **Fix** : `cat()` retraduit maintenant aussi son argument
avant comparaison (`categories.find((c) => c.name === t(name))`), pour matcher la même transformation
appliquée aux catégories à leur création. Comportement inchangé en français (`t()` renvoie l'entrée telle
quelle quand `currentLang !== 'en'`).

Reste du bilan de vérification, **rien d'autre trouvé** :
- Tout le texte des 12 écrans testés (Dashboard, Portefeuilles, Transactions, Budgets, Épargne,
  Investissements, Dettes & créances, Outils, Rapports, Partage de dépenses, Comptes gardés,
  Paramètres) s'affiche intégralement en anglais après le correctif ci-dessus — plus aucune occurrence
  de "No category"/"Sans catégorie" injustifiée, plus aucun texte français résiduel repéré dans le
  texte extrait.
- Thème sombre/clair : architecture CSS saine (`:root` = palette claire par défaut, `[data-theme="dark"]`
  = surcharge explicite, `body[data-theme="auto"]` sous `@media (prefers-color-scheme: dark)` = détection
  système, cohérent avec les conventions Artifact). Contrastes WCAG calculés sur les vraies valeurs de
  variables CSS : texte principal sur fond 16.5:1 (clair) / 16.9:1 (sombre), texte atténué 4.5:1 / 7.5:1,
  couleurs de statut (accent/positif/négatif) 3.3–5.4:1 — cohérent avec un usage sur éléments larges/
  icônes/boutons, pas de texte de contenu. Bouton de bascule (`#theme-toggle`) testé sur 4 clics
  consécutifs : `appState.theme` et `document.body.dataset.theme` restent parfaitement synchronisés à
  chaque clic, cycle correct `auto → dark → light → auto → ...`, persistance en base confirmée
  (`getSetting('theme')` reflète chaque changement).

`CACHE_VERSION` : `v71` → `v72`.

### 16 août 2026 (suite) — Choix de la langue en tout premier, avant même la création du code PIN

Demande explicite de l'auteur : la langue devait pouvoir être choisie dès l'installation, pas
seulement découverte plus tard dans Paramètres. Avant ce lot, l'appli démarrait toujours en français
par défaut (`getSetting('language', 'fr')`, aucune détection de la langue du navigateur) — un
utilisateur anglophone voyait tout le premier lancement (écran de création du PIN inclus) en français
sans le savoir, jusqu'à trouver lui-même le sélecteur dans Paramètres.

**Nouveau : écran de choix de langue affiché avant l'écran de création du PIN**, sur une toute première
installation uniquement (même garde que `maybeShowOnboarding()` : `!isPinConfigured()` — un PIN déjà
configuré signifie que ce n'est pas une première installation ; jamais réaffiché à un utilisateur
existant après coup).

- `index.html` : nouveau `<div id="language-screen" class="lock-screen" hidden>` juste avant
  `#lock-screen`, réutilisant les classes `.lock-screen`/`.lock-card`/`.lock-logo` pour un rendu visuel
  identique. Deux boutons `#language-choice-fr` ("Français") / `#language-choice-en` ("English").
  Volontairement **sans** `data-i18n` sur ce libellé ni sur les boutons : chaque langue s'auto-désigne
  dans sa propre écriture, choisir l'une des deux langues pour traduire l'écran de CHOIX de la langue
  n'aurait pas de sens.
- `js/app.js` : nouvelle fonction `showLanguageChoiceScreen()`, appelée dans `boot()` juste après
  `initI18n()` et avant `seedDefaultsIfNeeded()` (l'ordre est important : les catégories par défaut
  doivent être créées APRÈS que la langue soit connue, sinon elles seraient semées dans la mauvaise
  langue). Masque `#lock-screen`, affiche `#language-screen`, attend un clic sur l'un des deux boutons,
  enregistre la langue (`setSetting('language', lang)`), rappelle `initI18n()` (retraduit tout le
  châssis statique déjà présent dans le DOM, y compris l'écran de PIN caché en dessous) — **sans
  recharger la page**, contrairement à `setLanguage()` (Paramètres) qui fait un rechargement complet.

Testé de bout en bout, base de données entièrement vidée avant chaque scénario (simulateur
d'installation neuve) :
- Écran de langue bien affiché en tout premier (avant le PIN), les deux seuls boutons interactifs à ce
  stade sont "Français"/"English" (confirmé via l'arbre d'accessibilité).
- Clic "English" → écran de langue disparaît, écran de PIN apparaît directement en anglais ("Create
  your PIN code" / "Choose a 4-6 digit code..."), châssis latéral (menu) confirmé entièrement en
  anglais (Dashboard, Wallets, Transactions, Budgets, Savings, Investments, Debts & receivables, Tools,
  Reports, Shared expenses, Managed accounts) sans recharger la page.
- Rejoué en français ("Français") : écran de PIN bien en français, catégories par défaut vérifiées
  semées en français (Transport, Logement, Alimentation, Salaire…).
- Rejoué en anglais avec les catégories par défaut vérifiées semées directement en anglais (Housing,
  Food, Salary, Leisure…) — confirme que `seedDefaultsIfNeeded()` s'exécute bien après la résolution du
  choix de langue.
- **Non-régression** : un PIN configuré au préalable (simulateur d'installation existante) fait
  sauter entièrement l'écran de choix de langue, passage direct à l'écran de déverrouillage — un
  utilisateur existant n'est jamais interrompu par ce nouvel écran.
- Aucune erreur console sur l'ensemble des scénarios.

`CACHE_VERSION` : `v72` → `v73`.

### 16 août 2026 (suite) — Graphique "Répartition des revenus du mois" illisible en production

Signalé par l'auteur avec une capture d'écran du site en production (`zaky04.github.io/geofinance`) :
le graphique en bas du tableau de bord ("Répartition des revenus du mois") s'affichait comme un
amas de bandes colorées illisibles, sans rapport avec un diagramme de flux lisible. Pas un bug
d'internationalisation — un défaut de conception préexistant dans `renderIncomeFlowSankey`
(`charts.js`), révélé par des données réelles avec beaucoup de catégories de dépenses de valeurs très
disparates (14 catégories visibles sur la capture de l'auteur).

**Diagnostic confirmé par reproduction exacte** : ce graphique construit en réalité la répartition du
revenu du mois entre chaque catégorie de DÉPENSE (pas les sources de revenus) plus l'épargne nette
(`dashboard.js` : `flows = expensesByCategory.map(...)`, puis `flows.push({label: 'Épargne nette', ...})`).
La hauteur de chaque bande était calculée strictement proportionnelle à sa valeur, sans plancher. Avec
un jeu de test reproduisant fidèlement la capture (13 petites catégories + une "Épargne nette"
dominante représentant ~88% du revenu), les bandes des 13 catégories se retrouvaient compressées dans
23 px de hauteur cumulée — avec une police de 12 px, 8 étiquettes de texte se chevauchaient
intégralement, exactement le résultat vu par l'auteur. `computeExpensesByCategory` (`ledger.js`)
limite déjà à 7 catégories + "Autres" au-delà de 8, mais ça ne protège pas contre ce cas précis : une
poignée de petites catégories à côté d'une valeur dominante (l'épargne nette, ou une grosse dépense
isolée) suffit à réduire les autres bandes à quelques pixels.

**Fix** : hauteur minimale (`MIN_ROW_H = 20`) imposée à chaque flux avant le calcul proportionnel — un
flux ne descend jamais en dessous de cette hauteur, même si ça dépasse la hauteur "naturelle"
(nombre de flux × 30px) ; les flux réellement dominants gardent leur proportion normale au-dessus de
ce plancher. Le graphique grandit plutôt que de sacrifier la lisibilité — cohérent avec le `viewBox`
+ `height:auto` déjà en place, qui absorbe une hauteur variable sans rien casser côté mise en page.

Testé : reproduction exacte du scénario de la capture (13 catégories disparates + épargne nette
dominante) — tous les écarts verticaux entre étiquettes consécutives valent maintenant 20px minimum
(vérifié par le calcul des positions `y` réelles du SVG rendu), plus aucun chevauchement possible.
Hauteur totale du graphique passée de 420 px à ~631 px pour ce jeu de données — attendu et acceptable,
le conteneur suit via `height:auto`.

`CACHE_VERSION` : `v73` → `v74`.

### 16 août 2026 (suite) — Suppression du graphique de flux, ajout de 2 courbes de variation mensuelle

Suite à la discussion sur le graphique "Répartition des revenus du mois" (voir entrée ci-dessus) :
l'auteur, après explication, a jugé le graphique redondant avec le donut "Dépenses par catégorie"
juste à côté (même source de données, `computeExpensesByCategory`) et a demandé sa suppression pure
et simple, remplacé par deux nouvelles courbes plus utiles : variation mensuelle des dépenses et des
entrées, chacune filtrable par année et par catégorie.

**Suppression** : `renderIncomeFlowSankey()` (dernière fonction SVG-à-la-main du fichier,
`charts.js`), son appel dans `dashboard.js`, son conteneur `#dashboard-income-flow` (`index.html`),
et les 3 entrées de dictionnaire devenues orphelines (`'Pas assez de données...'`, `'Revenus'`,
`'Revenus du mois : {amount}'`) — plus aucun graphique de ce module n'est fait main, tous passent
maintenant par Chart.js.

**Ajout** : deux nouveaux panneaux sur le tableau de bord, à la place de l'ancien, chacun avec un
sélecteur d'année (‹ › comme le "Bilan annuel" de Rapports) et un filtre de catégorie
("Toutes catégories" ou une catégorie précise) :
- `ledger.js` : nouvelle fonction `computeMonthlyTypeHistory(year, type, categoryId)` — total par mois
  (12 points) d'un type de transaction (income/expense) sur une année donnée, filtré à une catégorie
  si fournie. Contrairement aux fonctions d'historique existantes (`computeNetWorthHistory` etc.), les
  libellés de mois utilisent `intlLocale()` (déjà exporté depuis `utils.js`) au lieu d'un `'fr-FR'`
  câblé en dur — pas de nouveau trou i18n introduit. Nouvelle fonction `getCategoriesByType(type)`
  pour peupler les filtres.
- `js/modules/dashboard.js` : `renderNetWorthTrendChart()` (déjà générique, `charts.js`) réutilisée
  telle quelle pour les deux courbes — aucun nouveau code de rendu Chart.js nécessaire. État des
  filtres (année/catégorie) au niveau module, comme `reportYear`/`reportMonthKey` dans `reports.js`,
  pour persister entre les re-rendus du tableau de bord. Nouveau `initDashboardModule()` (jusqu'ici
  absent, dashboard.js n'avait aucun câblage à faire une seule fois) pour les boutons année précédente/
  suivante et le `<select>` de catégorie — appelé une fois depuis `boot()` (`app.js`), comme les autres
  modules.

~2 nouvelles entrées de dictionnaire (`'Variation mensuelle des dépenses'`, `'Variation mensuelle des
entrées'`) — `'Toutes catégories'`, `'Dépenses'`, `'Entrées'` déjà existantes, réutilisées telles
quelles.

Testé FR→EN de bout en bout avec des transactions réparties sur plusieurs mois de l'année (ajoutées
manuellement pour valider la variation, les données de démo ne couvrant que les ~2 derniers mois) :
- Total "Toutes catégories" vs filtré à "Alimentation" : les deux courbes affichent des valeurs
  différentes et correctes mois par mois.
- Navigation année précédente/suivante : le label d'année et les données du graphique se mettent à
  jour ensemble, testé sur une instance de module propre (un premier test avec des instances mélangées
  — import direct vs import avec `?v=` de cache-busting — a donné un résultat trompeur : chaque import
  différemment paramétré crée sa PROPRE instance de module avec son PROPRE état, alors que les
  écouteurs réels ne sont attachés qu'à l'instance chargée par `app.js` au démarrage ; reproduit
  proprement avec un seul import cohérent, comportement confirmé correct).
- Anglais : titres des deux panneaux, première option du filtre ("All categories"), libellés de mois
  ("Jan 26" au lieu de "janv. 26") et libellé de la série ("Expenses") tous corrects.
- Aucune erreur console.

`CACHE_VERSION` : `v74` → `v75`.

### 16 août 2026 (suite) — Analyse des graphiques + nouvelle section "Graphiques" sur Rapports

Suite à une demande de l'auteur d'analyser l'utilité de tous les graphiques du tableau de bord et de
proposer des améliorations. Constat : aucune vraie redondance entre les 5 graphiques existants
(chacun répond à une question différente — composition du mois / trajectoire du patrimoine /
discipline budgétaire du mois / tendance annuelle dépenses / tendance annuelle revenus), mais un vrai
trou : rien ne combine visuellement revenus et dépenses dans le temps pour montrer l'épargne
résultante. Proposé et validé avec l'auteur : garder le tableau de bord tel quel (seule exception :
étendre "Évolution de la valeur nette" de 6 à 12 mois glissants) et construire une section
"Graphiques" complète sur la page **Rapports**, réunissant tous les graphiques déjà présents (recalculés
sur `reportMonthKey`/`reportYear` plutôt que dupliqués visuellement) **plus** 4 nouveautés.

**Dashboard (changement minimal)** : `computeNetWorthHistory(6)` → `computeNetWorthHistory(12)`
(`dashboard.js`) — un seul appel changé, pas de nouvelle navigation ajoutée sur cette page.

**Nouvelles fonctions `ledger.js`** :
- `computeNetWorthHistoryForYear(year)` — variante calendaire (Jan-Déc) de `computeNetWorthHistory()`
  (qui est glissante), pour partager le sélecteur d'année de Rapports plutôt que d'avoir sa propre
  navigation.
- `computeMonthlyNetSavingsHistory(year)` — épargne nette (revenus - dépenses) ET taux d'épargne (%)
  associé, mois par mois, en un seul appel (les deux vues du même graphique, bascule côté UI).
- `computeMonthlyBudgetVsActualHistory(year, categoryId)` — équivalent annuel de
  `computeBudgetVsActual()` (qui ne couvre qu'un mois) ; même convention que
  `computeMonthlyBudgetSummary()` pour "toutes catégories" (seules les catégories budgétées ce
  mois-là entrent dans le total agrégé).

**Nouvelles fonctions `charts.js`** :
- `renderMultiTrendChart(canvasId, series, currency)` — généralise `renderNetWorthTrendChart()` à
  plusieurs séries (ex: année courante en trait plein + année précédente en pointillé). Laissée
  comme fonction séparée exprès : ne touche à aucun appel existant (dashboard, dettes,
  investissements) qui n'a besoin que d'une seule série. Le remplissage sous la courbe ne s'active
  que si une seule série est affichée — avec 2 séries, une zone remplie sous une seule des deux
  suggérerait à tort une signification.
- `renderNetSavingsBarChart(canvasId, points, currency, asPercent)` — barres vertes si le mois est
  positif, rouges sinon ; `asPercent` bascule l'affichage entre montant et taux d'épargne.

**Section "Graphiques" (`reports.js`, nouvelle, sous "Bilan annuel")** — 7 graphiques : les 3 déjà
présents sur le tableau de bord (dépenses par catégorie, valeur nette, budget vs réel) + 2 courbes de
variation mensuelle (dépenses/entrées, réutilisant `computeMonthlyTypeHistory()` du lot précédent,
chacune avec une case "Comparer à l'année précédente" qui superpose l'année N-1 en pointillé) + 2
nouvelles (épargne nette mensuelle avec bascule €/%, budget vs réel en tendance annuelle avec filtre
catégorie). Tous les graphiques annuels partagent le sélecteur d'année déjà présent pour le "Bilan
annuel" (`reportYear`, boutons `#rep-prev-year`/`#rep-next-year`) plutôt que d'avoir chacun leur
propre navigation — un seul réglage d'année cohérent sur toute la page. Filtres de catégorie/cases à
cocher en état module (comme `reportYear`), re-générés à chaque `renderReports()` (le conteneur est
entièrement reconstruit à chaque navigation mois/année, donc pas de risque de doublons
d'écouteurs — même convention que le reste du fichier).

~4 nouvelles entrées de dictionnaire (`"Comparer à l'année précédente"`, `'Épargne nette
mensuelle'`, `'Afficher en %'`, `'Budget vs réel — tendance annuelle'`) ; `'Graphiques'`, `'Budget'`,
`'Réel'`, `'Toutes catégories'` déjà existantes, réutilisées.

Testé FR→EN de bout en bout avec des transactions et budgets répartis sur 2 années (année courante +
année précédente à 60% des montants, pour valider la comparaison) : les 7 graphiques s'affichent avec
les bons titres et les bonnes données ; comparaison année sur année vérifiée par inspection directe
des datasets Chart.js (série pleine vs pointillée, valeurs N-1 correctement à 60% de N) ; filtre de
catégorie vérifié à la fois seul et combiné à la comparaison année sur année ; bascule €/% de l'épargne
nette vérifiée sur des valeurs positives (ratio cohérent avant/après changement d'année, confirmant le
calcul) et sur un cas synthétique négatif (barre rouge confirmée) ; navigation d'année confirmée
propager le changement à TOUS les graphiques annuels simultanément (dépenses, entrées, épargne nette),
y compris le filtre de catégorie déjà sélectionné qui persiste correctement à travers le changement
d'année ; extension du tableau de bord à 12 mois glissants confirmée (`sept. 25` → `août 26`) ; anglais
vérifié sur les 7 titres, les 2 cases à cocher et la première option des filtres de catégorie. Aucune
erreur console sur l'ensemble du test.

`CACHE_VERSION` : `v75` → `v76`.

### 16 août 2026 (suite) — Barre du haut inutilisable sur iPhone à encoche/île dynamique

Signalé par l'auteur : sur iPhone 14, les boutons de la barre du haut (recherche, masquer les
montants, thème, "Saisie express") ne sont pas cliquables sans zoomer.

**Diagnostic** : `index.html` a bien `viewport-fit=cover` (nécessaire pour que `env(safe-area-inset-*)`
prenne effet), mais **seule** la barre du bas (`.bottom-nav`) et certains éléments (modales, écran de
PIN) compensaient l'encoche/l'île dynamique/la barre d'accueil via `env(safe-area-inset-bottom)`. La
barre du HAUT (`.topbar`) n'avait aucun `padding-top` de ce type — pire, elle utilisait `height:
var(--topbar-h)` (64px, fixe) au lieu de `min-height`. Avec `box-sizing:border-box` (règle globale du
projet), ajouter un `padding-top` à une hauteur FIXE aurait mangé cette hauteur au lieu d'en ajouter —
sur un iPhone 14 (îlot dynamique ≈ 59px d'insécable), les boutons (cercles 38px de diamètre) se
seraient retrouvés compressés dans les ~5px restants de la boîte de 64px, débordant hors de leur
conteneur et devenant impossibles à taper au bon endroit. Le même défaut existait en double sur
`.bottom-nav` (qui AVAIT déjà le `padding-bottom`, mais toujours avec `height` fixe au lieu de
`min-height` — bug latent moins visible côté bas car la barre d'accueil, ≈34px, est plus petite que
l'îlot dynamique du haut, ≈59px, donc moins susceptible d'écraser complètement les icônes, mais
potentiellement déjà compressées).

**Fix** (`css/styles.css`) :
- `.topbar` : `height` → `min-height`, `padding: 0 28px` → `padding: env(safe-area-inset-top) 28px
  0` (+ même correction dans la surcharge mobile `@media (max-width:900px)` qui écrasait
  complètement ce padding).
- `.bottom-nav` : `height` → `min-height` (le `padding-bottom: env(safe-area-inset-bottom)` existait
  déjà, il lui manquait juste une boîte capable de grandir).
- `.view-root` (mobile) : le padding bas fixe (`100px`, pour dégager le contenu défilant de la barre
  du bas) devient `calc(100px + env(safe-area-inset-bottom))` — sinon le dernier contenu resterait
  caché derrière la barre du bas désormais plus haute sur un écran à barre d'accueil.
- `.toast-container` / `.install-banner` : leur position (`bottom: calc(var(--bottom-nav-h) + 16px)`)
  intègre maintenant `+ env(safe-area-inset-bottom)`, sinon ils se seraient superposés au sommet de
  la barre du bas désormais plus haute.
- `.lock-screen` (écran de PIN) vérifié SANS changement nécessaire : contenu centré verticalement
  (`align-items:center`), rien d'actionnable ne se trouve physiquement sous l'encoche.

Testé : ce dépôt de test n'a pas d'appareil réellement encoché disponible, donc `env(safe-area-inset-*)`
s'y résout systématiquement à `0px` — confirmé que ça ne change RIEN au rendu sur un écran normal (pas
de régression). Pour prouver que le correctif fonctionne réellement avec une encoche non nulle, valeur
forcée manuellement en `padding-top: 59px` (îlot dynamique iPhone 14 Pro) sur `.topbar` en direct dans
le navigateur : la barre grandit de 64px à ~98px (au lieu de rester bloquée à 64px), et le bouton
recherche se retrouve entièrement sous la zone simulée (y=59 à y=97, hauteur 38px intacte) au lieu
d'être compressé/débordant — comportement AVANT/APRÈS comparé directement, confirme le mécanisme.
Vérification plus large de l'adaptation mobile demandée par l'auteur : aucun débordement horizontal
détecté (scan automatique de tous les éléments de Dashboard/Transactions/Budgets/Rapports à 375px de
large, y compris la nouvelle section Graphiques du lot précédent — 0 élément dépassant le viewport) ;
contrôles de la section Graphiques (sélecteurs, cases à cocher) confirmés lisibles et correctement
repliés sur leur propre ligne à cette largeur. Aucune erreur console.

`CACHE_VERSION` : `v76` → `v77`.

### 16 août 2026 (suite) — Bandeau de migration : boutons débordant hors écran sur mobile

Signalé par l'utilisateur avec deux captures (Android et iPhone) : le lien "J'ai déjà une
sauvegarde" du bandeau de migration apparaissait tronqué au bord droit de l'écran.

Cause (`renderMigrationBanner()`, `app.js`) : le `<span>` regroupant le bouton "Sauvegarder puis
découvrir Djignan", le lien "J'ai déjà une sauvegarde" et le bouton ✕ était un flex-row sans
`flex-wrap` et avec `flex-shrink:0` — le `<p class="alert">` parent (lui, en `flex-wrap:wrap`)
faisait bien passer ce groupe entier à la ligne, mais À L'INTÉRIEUR de ce groupe, les 3 éléments
restaient forcés sur une seule ligne. Sur un écran étroit (~375px), leur largeur cumulée dépasse
le viewport — le débordement horizontal tronque silencieusement le contenu en trop (ou le rend
inaccessible), sans jamais wrapper.

→ `flex-wrap:wrap` ajouté à ce `<span>` interne (+ `flex-shrink:0` déplacé sur le bouton ✕ seul,
pour qu'il ne s'écrase jamais). Le groupe peut désormais s'étaler sur 2-3 lignes si besoin.

Testé en conditions réelles à 375px de large (parcours complet : choix de langue → création de
PIN → tableau de bord) : bouton, lien et ✕ passent chacun à la ligne proprement, plus aucun
élément ne dépasse la largeur du viewport (vérifié par mesure `getBoundingClientRect()` de
chaque élément + capture d'écran).

`CACHE_VERSION` : `v86` → `v87`.

## 7. Pistes prioritaires non traitées

Par ordre d'impact estimé, à valider avec l'auteur avant de s'y attaquer :

1. ~~**Rendre la sauvegarde vraiment robuste**~~ — **fait, voir §6** (sauvegarde cloud Google + rappel
   périodique dédié, entrées du 14 août 2026).
2. ~~**Tests de non-régression légers pour `ledger.js`**~~ — **fait, voir §11** (`test/ledger.test.html`).
3. ~~**Avertir l'utilisateur sur les imports CSV avec montants invalides**~~ — **fait, voir §6** (entrée
   du 14 août 2026).
4. ~~**Arrondi en centimes entiers dans `ledger.js`**~~ — **tolérance appliquée aux 2 comparaisons de
   seuil exact identifiées, voir §6** (14 août 2026). Une vraie migration vers des centimes entiers en
   stockage (au lieu de `Number` en unités monétaires) reste délibérément **hors scope** : chantier de
   grande ampleur touchant tout le modèle de données existant (migration IndexedDB pour tous les
   utilisateurs déjà installés) pour un problème qui n'a jamais été rapporté en pratique — à ne
   reconsidérer que si un écart réel et visible remonte un jour.
5. **Digital Asset Links pour l'APK** (§9) — plein écran natif sans barre d'adresse Chrome. Nécessite
   d'héberger `.well-known/assetlinks.json` à la racine de `zaky04.github.io`, donc dans le dépôt
   `zaky04.github.io` (page utilisateur GitHub) — **pas ce dépôt-ci**, qui ne sert que `/geofinance/`.
6. ~~**Audit accessibilité**~~ — **fait pour les boutons icône, voir §6** (14 août 2026). Reste ouvert,
   **décision de design à prendre avec l'auteur** : contraste de `--text-faint` sous le seuil WCAG AA
   dans les deux thèmes (détails §6) — corriger impliquerait de resserrer la hiérarchie visuelle à 2
   niveaux de gris au lieu de 3.
7. **Comportement à grande échelle** — *mesuré et partiellement corrigé le 14 août 2026, voir §6*
   (jeu de données synthétique de 14 600 transactions/5 ans ; `computeNetWorthHistory` était le point
   noir isolé, corrigé, 1555ms → 473ms). Reste ouvert, non traité volontairement : `ctx()`
   (`ledger.js`) charge un store entier en mémoire à chaque calcul (`dbGetAll()`, pas de requête
   IndexedDB bornée par date/index) — sur ce même jeu de données, ~300-500ms résiduels par calcul en
   viennent. Des requêtes indexées par date réduiraient ça, mais c'est un chantier plus large,
   disproportionné tant qu'aucun utilisateur réel n'a signalé de lenteur perceptible.

## 8. Comment reprendre le travail

- Lire ce fichier en premier.
- `git log --oneline` pour l'historique complet (messages en français, très descriptifs).
- Le code est commenté en français aux endroits non-évidents (le *pourquoi*, pas le *quoi*) — les lire avant
  de modifier une fonction, ils expliquent souvent une décision non intuitive (ex: pourquoi `fetch({cache:
  'reload'})` plutôt que `cache.add()` dans `sw.js`, pourquoi les dates locales et pas `.toISOString()`...).
- Avant tout commit touchant du JS/CSS/HTML : penser au bump de `CACHE_VERSION` (§3.1).

## 9. Empaquetage Android (APK / TWA)

### 14 août 2026 — Première génération d'un APK (Trusted Web Activity)

Demandé par l'utilisateur : une version APK installable sur Android. Généré via **TWA (Trusted Web
Activity)**, la méthode standard pour empaqueter une PWA — pas une copie figée du code : l'APK est
une coquille native qui affiche l'app en plein écran en pointant vers l'URL déployée
(`https://zaky04.github.io/geofinance/`).

**Important — la logique de mise à jour ne change pas.** L'APK charge le contenu réel depuis
GitHub Pages à chaque lancement ; le Service Worker (`sw.js`, `CACHE_VERSION`) continue de gérer le
cache et les mises à jour exactement comme pour la PWA web. Déployer sur `main` met à jour l'app pour
tout le monde (web ET APK) sans avoir à régénérer l'APK. Seul un changement natif (icône, nom,
format d'empaquetage) nécessiterait un nouvel APK — jamais une évolution normale du code.

**Générée localement** (pas de compte développeur externe requis, contrairement à Firebase) via
`@bubblewrap/cli` (Google), avec :
- `packageId` : `com.zaky04.geofinance` (quasi permanent si publié un jour — choisi avec l'utilisateur).
- Usage prévu : sideload / partage direct pour l'instant (pas de Play Store).

**Détails techniques pour reproduire/mettre à jour l'APK plus tard :**
- Le projet TWA (`twa-manifest.json`, projet Gradle généré, keystore) vit **hors du dépôt Git**, dans
  un répertoire de travail local temporaire — à recréer si besoin (voir ci-dessous), il n'est pas
  versionné.
- Bubblewrap exige un JDK **exactement 17.x** (vérifie littéralement `JAVA_VERSION="17.0` dans le
  fichier `release` du JDK) — un JDK 21 (ex: celui livré avec Android Studio) est explicitement
  rejeté, malgré la doc qui suggère juste "17+". Téléchargé Temurin 17 (adoptium.net) séparément pour
  contourner ça.
- Le SDK Android local (`%LOCALAPPDATA%\Android\Sdk`, installé via Android Studio/Flutter) utilise la
  structure moderne (`cmdline-tools/latest/`) — la validation de Bubblewrap cherche un dossier
  `tools/` ou `bin/` directement à la racine du SDK (structure historique). Contourné en créant une
  jonction NTFS `Sdk\tools` → `Sdk\cmdline-tools\latest` (`New-Item -ItemType Junction`), sans toucher
  au SDK réel.
- Mots de passe du keystore passés via les variables d'environnement
  `BUBBLEWRAP_KEYSTORE_PASSWORD`/`BUBBLEWRAP_KEY_PASSWORD` (évite les prompts interactifs, qui plantent
  dans un terminal non-interactif).
- `bubblewrap build` échouait systématiquement sur `gradlew.bat` ("n'est pas reconnu") à cause d'un
  souci d'interopérabilité entre le sous-processus lancé par Node (npx via Git Bash/MSYS) et
  `cmd.exe` sur Windows. Contourné en lançant `gradlew.bat assembleRelease` directement depuis
  PowerShell (hors de l'orchestration de Bubblewrap), puis en signant l'APK manuellement avec
  `zipalign`/`apksigner` (build-tools `36.1.0`) et le keystore généré par `keytool`.
- Certificat de signature (empreinte SHA-256, à connaître si un jour Digital Asset Links ou Play
  Console sont configurés) :
  `BA:BC:56:75:B6:02:57:24:C3:3F:64:F3:C7:9F:A5:F9:CC:65:97:4F:5A:5A:F3:33:7D:86:11:F4:50:A2:9D:FE`

**Le fichier `android.keystore` et son mot de passe ont été remis directement à l'utilisateur** (pas
committés dans ce dépôt — un keystore est un secret, sa perte empêcherait de republier une mise à jour
signée de la même app). **À sauvegarder par l'utilisateur dans un endroit sûr, durablement** —
nécessaire pour toute regénération future de l'APK sous le même `packageId`.

## 10. Exécutables installables multi-plateformes (pistes pour plus tard)

### 16 août 2026 — Objectif : pouvoir installer l'app sans dépendre de GitHub

Discuté avec l'auteur suite à une question sur la résilience du projet en cas de disparition du
dépôt GitHub : que se passerait-il pour les utilisateurs déjà actifs ? Réponse détaillée dans le
journal de conversation, résumé ici pour référence future. Cette section est **une piste à
implémenter plus tard**, rien n'a encore été construit — l'auteur compilera lui-même les
installables quand il sera prêt.

**Point de départ important — l'APK actuel ne résout PAS ce besoin.** L'APK généré via TWA/Bubblewrap
(§9 ci-dessus) est une coquille native qui charge le contenu en direct depuis
`https://zaky04.github.io/geofinance/` à chaque lancement. Si l'hébergement GitHub Pages disparaît,
cet APK casse aussi (sauf ce qui était déjà en cache localement sur l'appareil via le Service Worker).
Un vrai exécutable "autonome" doit embarquer TOUS les fichiers de l'app à l'intérieur de l'installeur
lui-même, sans jamais dépendre d'une URL réseau au runtime.

**Par plateforme :**

| Plateforme | Faisable ? | Outil recommandé | Notes |
|---|---|---|---|
| Windows | Oui | **Tauri** (léger, utilise WebView2 déjà présent sur Win10/11) ou Electron (plus lourd ~150-200 Mo, mais plus mature/documenté) | Produit un `.exe` autonome, tout embarqué, zéro dépendance réseau |
| macOS | Oui | **Tauri** (utilise WebKit natif) ou Electron | Produit un `.app`/`.dmg`, distribuable hors App Store (notarisation Apple recommandée pour éviter l'avertissement Gatekeeper, pas strictement obligatoire pour une distribution directe/personnelle) |
| Android | Oui, mais **changement d'approche nécessaire** | Capacitor (Ionic) ou Tauri 2.0 | Remplace la TWA actuelle : les fichiers sont embarqués dans l'APK et chargés en `file://` (ou équivalent), plus jamais en `https://` vers GitHub Pages |
| iOS | **Non, pas de vrai équivalent** — limite de plateforme Apple, pas technique | — | Impossible de distribuer un simple fichier à installer comme sur Android sans passer par l'App Store (compte développeur Apple, 99 $/an, review) ou du sideloading qui expire périodiquement (AltStore, TestFlight — nécessite un Apple ID et une re-signature régulière). La seule option sans compte payant reste "Ajouter à l'écran d'accueil" depuis Safari (déjà disponible aujourd'hui) — mais ça nécessite d'atteindre l'URL au moins une fois pour l'installation initiale, contrairement à un vrai exécutable |

**Compromis à garder en tête avant de se lancer :** Tauri/Electron/Capacitor sont tous de **nouveaux
outils de build** — le projet n'en a aujourd'hui aucun (JS vanilla pur, zéro étape de build, voir §3).
Passer à l'un de ces outils est un changement d'architecture pour la distribution (pas pour le code
applicatif lui-même, qui reste le même HTML/CSS/JS servi tel quel), pas juste une commande à lancer.

**Ordre suggéré si l'auteur se lance** : commencer par **Windows avec Tauri** — la demande initiale la
plus concrète, l'outil le plus léger, et ça valide l'approche avant de dupliquer l'effort sur macOS et
Android (dont la config Tauri se réutilise en grande partie une fois la première plateforme en place).

## 11. Tests automatisés

### 14 août 2026 — Tests de non-régression pour `ledger.js`

Dette technique identifiée depuis l'audit du 12 août (§7.2) : le cœur des calculs financiers
(`ledger.js`) n'avait aucune protection contre une régression de calcul lors d'un futur refactor.

`test/ledger.test.html` — page HTML autonome (pas de framework, pas de build, conforme à la
philosophie du projet) qui :
- pose `window.__GEOFINANCE_TEST_DB_NAME__ = 'geofinance-ledger-test-db'` **avant** d'importer
  `db.js`, ce qui redirige toutes les opérations vers une base IndexedDB isolée — jamais celle de
  l'utilisateur. Nécessite un changement d'une ligne dans `db.js` (`DB_NAME` lit ce global s'il
  existe, sinon comportement inchangé — voir commentaire sur place) : le seul point d'extension
  ajouté pour permettre ce test.
- vide cette base et y insère des données connues (portefeuilles multi-devises, transactions
  revenu/dépense/virement, budget, dette + créance + paiement, investissement + historique de
  valorisations, règle de catégorisation) via les vraies fonctions de `db.js`.
- appelle les vraies fonctions de `ledger.js` (`walletBalancesAsOf`, `investmentValueAsOf`,
  `computeNetWorth`, `computeMonthSummary`, `computeBudgetVsActual`, `computeExpensesByCategory`,
  `computeFinancialHealthScore`, `guessCategoryId`) et compare au résultat attendu, calculé à la main.
- affiche un résumé pass/fail directement sur la page (titre de l'onglet inclus, pour un coup d'œil
  rapide) — pas de dépendance à la console.

**Pour l'utiliser** : ouvrir `test/ledger.test.html` dans un navigateur (ex: servi par `serve.ps1`
comme le reste de l'app) après tout changement dans `ledger.js`. 24 assertions, toutes vertes
actuellement (2 ajoutées le 14 août pour couvrir la tolérance de dérive flottante, voir §6).

**Piège rencontré en l'écrivant, à connaître pour la suite** : le Service Worker met en cache
n'importe quelle requête GET same-origin après une première visite — y compris `test/*`, qui n'est
pourtant pas dans `APP_SHELL`. Un premier run a montré 3 échecs (résultat contaminé par des
transactions de fixture mal isolées, corrigé), puis après correction du fichier de test, le
*second* run affichait encore les anciens résultats : le Service Worker servait la version du
fichier HTML mise en cache lors du premier chargement, pas la version corrigée sur disque. Il faut
vider `caches`/désinscrire le Service Worker (comme d'habitude en local, §3.1) avant de rejouer les
tests après une modification de `test/ledger.test.html` lui-même.

`CACHE_VERSION` : `v41` → `v42` (changement dans `db.js`, précaché dans `APP_SHELL`, même si sans
effet pour un utilisateur réel — `window.__GEOFINANCE_TEST_DB_NAME__` n'est jamais posé en dehors de
cette page de test).

**Non fait à ce stade (pas demandé, pertinent seulement pour Play Store ou expérience 100% sans
barre d'adresse)** : `.well-known/assetlinks.json` (Digital Asset Links) — doit être hébergé à la
racine du domaine `zaky04.github.io`, donc dans le dépôt spécial `zaky04.github.io` (page utilisateur
GitHub), **pas dans ce dépôt `geofinance`** qui ne sert que le sous-chemin `/geofinance/`. Sans ce
fichier, l'APK fonctionne normalement mais affiche une fine barre d'adresse Chrome (Custom Tabs) au
lieu d'un plein écran natif — cosmétique, pas bloquant pour un usage sideload.
