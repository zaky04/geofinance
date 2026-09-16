/* ==========================================================================
   GeoFinance System — Couche IndexedDB
   Toutes les données de l'application vivent exclusivement dans IndexedDB.
   Les identifiants sont des UUID applicatifs (pas d'autoIncrement) afin que
   l'import/export JSON puisse fusionner ou restaurer sans collision.
   ========================================================================== */

// Le nom de la base est normalement fixe ; le seul point d'extension est un test dédié
// (test/ledger.test.html) qui pose ce global AVANT d'importer ce module pour rediriger toutes
// les opérations vers une base IndexedDB isolée, jamais celle de l'utilisateur. Sur une page
// normale de l'app, ce global n'existe jamais : comportement inchangé.
export const DB_NAME = (typeof window !== 'undefined' && window.__GEOFINANCE_TEST_DB_NAME__) || 'geofinance-db';
export const DB_VERSION = 4;

export const STORES = {
  WALLETS: 'wallets',
  TRANSACTIONS: 'transactions',
  CATEGORIES: 'categories',
  BUDGETS: 'budgets',
  RECURRING: 'recurring',
  SAVINGS_GOALS: 'savingsGoals',
  INVESTMENTS: 'investments',
  INVESTMENT_ENTRIES: 'investmentEntries',
  DEBTS: 'debts',
  DEBT_PAYMENTS: 'debtPayments',
  EXCHANGE_RATES: 'exchangeRates',
  EXCHANGE_RATE_HISTORY: 'exchangeRateHistory',
  AUDIT_LOG: 'auditLog',
  SETTINGS: 'settings',
  PARTICIPANTS: 'participants',
  SHARED_EXPENSES: 'sharedExpenses',
  CATEGORIZATION_RULES: 'categorizationRules',
  KEPT_ACCOUNTS: 'keptAccounts',
  KEPT_ACCOUNT_ENTRIES: 'keptAccountEntries',
};

/** Catégories créées au tout premier boot (seedDefaultsIfNeeded(), app.js) et réutilisées telles
    quelles par le mode démo (demo-data.js, qui doit les recréer lui-même car il vide STORES.
    CATEGORIES via wipeAllData()/wipeUserData() avant de semer ses données) — un seul jeu de
    référence pour éviter que les deux listes dérivent l'une de l'autre en silence (une catégorie
    renommée d'un côté seulement casserait les correspondances par nom du mode démo). */
export const DEFAULT_CATEGORIES = [
  { name: 'Salaire', type: 'income' },
  { name: 'Autres revenus', type: 'income' },
  { name: 'Alimentation', type: 'expense' },
  { name: 'Logement', type: 'expense' },
  { name: 'Transport', type: 'expense' },
  { name: 'Loisirs', type: 'expense' },
  { name: 'Santé', type: 'expense' },
  { name: 'Abonnements', type: 'expense' },
  { name: 'Autres dépenses', type: 'expense' },
];

let dbPromise = null;

function upgrade(db) {
  if (!db.objectStoreNames.contains(STORES.WALLETS)) {
    const s = db.createObjectStore(STORES.WALLETS, { keyPath: 'id' });
    s.createIndex('byArchived', 'archived');
  }
  if (!db.objectStoreNames.contains(STORES.TRANSACTIONS)) {
    const s = db.createObjectStore(STORES.TRANSACTIONS, { keyPath: 'id' });
    s.createIndex('byWallet', 'walletId');
    s.createIndex('byDate', 'date');
    s.createIndex('byCategory', 'categoryId');
    s.createIndex('byType', 'type');
    s.createIndex('byReconciled', 'reconciled');
  }
  if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
    const s = db.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
    s.createIndex('byParent', 'parentId');
    s.createIndex('byType', 'type');
  }
  if (!db.objectStoreNames.contains(STORES.BUDGETS)) {
    const s = db.createObjectStore(STORES.BUDGETS, { keyPath: 'id' });
    s.createIndex('byMonth', 'month');
    s.createIndex('byCategory', 'categoryId');
  }
  if (!db.objectStoreNames.contains(STORES.RECURRING)) {
    const s = db.createObjectStore(STORES.RECURRING, { keyPath: 'id' });
    s.createIndex('byActive', 'active');
    s.createIndex('byNextDate', 'nextDate');
  }
  if (!db.objectStoreNames.contains(STORES.SAVINGS_GOALS)) {
    const s = db.createObjectStore(STORES.SAVINGS_GOALS, { keyPath: 'id' });
    s.createIndex('byArchived', 'archived');
  }
  if (!db.objectStoreNames.contains(STORES.INVESTMENTS)) {
    const s = db.createObjectStore(STORES.INVESTMENTS, { keyPath: 'id' });
    s.createIndex('byAssetClass', 'assetClass');
  }
  if (!db.objectStoreNames.contains(STORES.INVESTMENT_ENTRIES)) {
    const s = db.createObjectStore(STORES.INVESTMENT_ENTRIES, { keyPath: 'id' });
    s.createIndex('byInvestment', 'investmentId');
    s.createIndex('byDate', 'date');
  }
  if (!db.objectStoreNames.contains(STORES.DEBTS)) {
    const s = db.createObjectStore(STORES.DEBTS, { keyPath: 'id' });
    s.createIndex('byType', 'type');
    s.createIndex('byStatus', 'status');
  }
  if (!db.objectStoreNames.contains(STORES.DEBT_PAYMENTS)) {
    const s = db.createObjectStore(STORES.DEBT_PAYMENTS, { keyPath: 'id' });
    s.createIndex('byDebt', 'debtId');
  }
  if (!db.objectStoreNames.contains(STORES.EXCHANGE_RATES)) {
    db.createObjectStore(STORES.EXCHANGE_RATES, { keyPath: 'code' });
  }
  if (!db.objectStoreNames.contains(STORES.EXCHANGE_RATE_HISTORY)) {
    const s = db.createObjectStore(STORES.EXCHANGE_RATE_HISTORY, { keyPath: 'id' });
    s.createIndex('byCode', 'code');
    s.createIndex('byDate', 'date');
  }
  if (!db.objectStoreNames.contains(STORES.AUDIT_LOG)) {
    const s = db.createObjectStore(STORES.AUDIT_LOG, { keyPath: 'id' });
    s.createIndex('byTimestamp', 'timestamp');
    s.createIndex('byEntity', 'entityType');
  }
  if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains(STORES.PARTICIPANTS)) {
    db.createObjectStore(STORES.PARTICIPANTS, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(STORES.SHARED_EXPENSES)) {
    const s = db.createObjectStore(STORES.SHARED_EXPENSES, { keyPath: 'id' });
    s.createIndex('byDate', 'date');
  }
  if (!db.objectStoreNames.contains(STORES.CATEGORIZATION_RULES)) {
    const s = db.createObjectStore(STORES.CATEGORIZATION_RULES, { keyPath: 'id' });
    s.createIndex('byCategory', 'categoryId');
  }
  // Comptes gardés : argent de tiers (famille, proches) que l'utilisateur garde/gère. Stores
  // volontairement séparés des portefeuilles/transactions personnels — aucune fonction de
  // ledger.js ne doit jamais les lire, pour ne jamais les compter dans le patrimoine net.
  if (!db.objectStoreNames.contains(STORES.KEPT_ACCOUNTS)) {
    const s = db.createObjectStore(STORES.KEPT_ACCOUNTS, { keyPath: 'id' });
    s.createIndex('byArchived', 'archived');
  }
  if (!db.objectStoreNames.contains(STORES.KEPT_ACCOUNT_ENTRIES)) {
    const s = db.createObjectStore(STORES.KEPT_ACCOUNT_ENTRIES, { keyPath: 'id' });
    s.createIndex('byAccount', 'accountId');
  }
}

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(e.target.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('[DB] Mise à niveau bloquée par un autre onglet ouvert.');
  });
  return dbPromise;
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- CRUD génériques ---------- */
export async function dbGet(store, id) {
  const db = await openDatabase();
  return reqToPromise(tx(db, store, 'readonly').objectStore(store).get(id));
}

export async function dbGetAll(store) {
  const db = await openDatabase();
  return reqToPromise(tx(db, store, 'readonly').objectStore(store).getAll());
}

export async function dbGetAllByIndex(store, indexName, query) {
  const db = await openDatabase();
  const idx = tx(db, store, 'readonly').objectStore(store).index(indexName);
  return reqToPromise(idx.getAll(query));
}

export async function dbPut(store, value) {
  const db = await openDatabase();
  await reqToPromise(tx(db, store, 'readwrite').objectStore(store).put(value));
  return value;
}

export async function dbAdd(store, value) {
  const db = await openDatabase();
  await reqToPromise(tx(db, store, 'readwrite').objectStore(store).add(value));
  return value;
}

export async function dbDelete(store, id) {
  const db = await openDatabase();
  await reqToPromise(tx(db, store, 'readwrite').objectStore(store).delete(id));
}

export async function dbClear(store) {
  const db = await openDatabase();
  await reqToPromise(tx(db, store, 'readwrite').objectStore(store).clear());
}

export async function dbBulkPut(store, values) {
  if (!values || !values.length) return;
  const db = await openDatabase();
  const t = tx(db, store, 'readwrite');
  const os = t.objectStore(store);
  values.forEach((v) => os.put(v));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

/** Exécute plusieurs écritures (add/put/delete, sur un ou plusieurs stores) dans UNE SEULE
    transaction IndexedDB : soit toutes appliquées, soit aucune. Chaque dbAdd/dbPut/dbDelete
    "isolé" ouvre SA PROPRE transaction — un enchaînement de plusieurs appels séparés pour une même
    opération logique (ex: enregistrer un remboursement = une ligne DEBT_PAYMENTS + une transaction
    de portefeuille + parfois passer la dette à "soldée") peut donc laisser un état partiellement
    écrit si l'onglet/l'appareil meurt exactement entre deux appels (fermeture forcée, coupure de
    courant, l'OS qui tue l'onglet en arrière-plan sur mobile) — improbable par occurrence, mais
    jamais acceptable pour un solde financier. `operations` est un tableau de
    { store, type: 'add'|'put'|'delete', value } (value = l'id pour 'delete'). À utiliser pour tout
    groupe d'écritures qui doivent réussir ou échouer ensemble. */
export async function dbWriteBatch(operations) {
  if (!operations || !operations.length) return;
  const storeNames = [...new Set(operations.map((op) => op.store))];
  const db = await openDatabase();
  const t = tx(db, storeNames, 'readwrite');
  for (const op of operations) {
    const os = t.objectStore(op.store);
    if (op.type === 'delete') os.delete(op.value);
    else os[op.type](op.value);
  }
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction abandonnée'));
  });
}

/* ---------- Journal d'audit ---------- */
export async function logAudit({ entityType, entityId, action, before = null, after = null, note = '' }) {
  await dbAdd(STORES.AUDIT_LOG, {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    entityType,
    entityId,
    action,
    before,
    after,
    note,
  });
}

/* ---------- Paramètres (clé/valeur) ---------- */
export async function getSetting(key, fallback = null) {
  const row = await dbGet(STORES.SETTINGS, key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await dbPut(STORES.SETTINGS, { key, value });
}

/* ---------- Export / Import complet (utilisé par backup.js) ---------- */
/** Clés de STORES.SETTINGS propres à CET appareil, jamais exportées dans une sauvegarde — ni en
    clair, ni même dans la variante "chiffrée" (défense en profondeur : le hash/sel du PIN et les
    identifiants biométriques ne doivent jamais quitter l'appareil, quelle que soit la protection
    autour du fichier). Restaurer une sauvegarde doit toujours redemander un PIN sur l'appareil de
    destination, jamais hériter silencieusement de celui de l'appareil d'origine.
    autoBackupDirHandle est en plus un FileSystemDirectoryHandle (objet natif non sérialisable en
    JSON, comme un Blob) : l'exporter produirait une entrée cassée sans intérêt. */
const DEVICE_LOCAL_SETTING_KEYS = new Set([
  'pinSalt', 'pinHash', 'pinIterations', 'pinLength', 'failedAttempts', 'pinThrottledUntil',
  'biometricCredentialId', 'biometricPublicKeySpki',
  'autoBackupDirHandle',
]);

export async function exportAllData() {
  const data = { exportedAt: new Date().toISOString(), version: DB_VERSION, stores: {} };
  for (const store of Object.values(STORES)) {
    const rows = await dbGetAll(store);
    data.stores[store] = store === STORES.SETTINGS
      ? rows.filter((r) => !DEVICE_LOCAL_SETTING_KEYS.has(r.key))
      : rows;
  }
  return data;
}

/** Corrige typeof number non finis (NaN/Infinity) sur les champs de premier niveau d'une ligne
    importée — un fichier de sauvegarde n'est pas une entrée fiable (corruption, édition manuelle,
    fichier forgé) ; sans ça, une valeur comme "Infinity" se propagerait telle quelle dans les
    calculs de ledger.js (l'idiome `Number(x) || 0` utilisé ailleurs ne filtre PAS Infinity, qui
    est "truthy" — voir safeNumber() dans utils.js). */
function sanitizeImportedRow(row) {
  if (!row || typeof row !== 'object') return row;
  for (const key of Object.keys(row)) {
    if (typeof row[key] === 'number' && !Number.isFinite(row[key])) row[key] = 0;
  }
  return row;
}

export async function importAllData(data, { merge = false } = {}) {
  if (!data || !data.stores) throw new Error('Fichier de sauvegarde invalide.');
  for (const store of Object.values(STORES)) {
    let rows = data.stores[store];
    if (!rows) continue;
    // Symétrique à exportAllData() : un fichier de sauvegarde (potentiellement forgé) ne doit
    // JAMAIS pouvoir poser/écraser le PIN ou les identifiants biométriques de CET appareil — la
    // seule voie légitime pour ça reste les flux internes d'auth.js (setupPin, registerBiometric).
    if (store === STORES.SETTINGS) rows = rows.filter((r) => !DEVICE_LOCAL_SETTING_KEYS.has(r?.key));
    rows = rows.map(sanitizeImportedRow);
    if (!merge) await dbClear(store);
    await dbBulkPut(store, rows);
  }
}

export async function wipeAllData() {
  for (const store of Object.values(STORES)) {
    await dbClear(store);
  }
}

/** Comme wipeAllData(), mais préserve les réglages propres à CET appareil (PIN, identifiants
    biométriques, dossier de sauvegarde auto — voir DEVICE_LOCAL_SETTING_KEYS) au lieu de tout
    effacer sans distinction. Pour tout effacement déclenché par l'app elle-même sans intention de
    "réinitialisation complète de l'appareil" (ex: charger/effacer les données de démonstration,
    voir demo-data.js) — contrairement à wipeAllData(), qui reste le bon outil pour un vrai "Tout
    supprimer" explicite côté utilisateur (settings.js), où détruire aussi le PIN est acceptable
    puisque l'utilisateur en a été prévenu. Sans cette distinction, wipeAllData() effacerait le PIN
    qu'un utilisateur vient tout juste de créer s'il est appelé pendant l'onboarding (juste après la
    création du PIN) — le laissant sans code valide pour déverrouiller après le prochain
    verrouillage, sans même un message d'erreur avant un rechargement complet de page. */
export async function wipeUserData() {
  const settingsRows = await dbGetAll(STORES.SETTINGS);
  const preserved = settingsRows.filter((r) => DEVICE_LOCAL_SETTING_KEYS.has(r.key));
  await wipeAllData();
  for (const row of preserved) await dbPut(STORES.SETTINGS, row);
}
