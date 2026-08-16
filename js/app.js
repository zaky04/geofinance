/* ==========================================================================
   GeoFinance System — Bootstrap & routeur SPA
   Point d'entrée : câble l'écran de verrouillage, initialise tous les
   modules, gère la navigation entre vues et la réaction aux changements
   de données (bus d'événements).
   ========================================================================== */

import { STORES, dbAdd, dbPut, dbDelete, dbGetAll, getSetting, setSetting, DEFAULT_CATEGORIES } from './db.js';
import { initLockScreen, isBiometricAvailable, registerBiometric, isPinConfigured } from './auth.js';
import { bus, EVENTS, appState, notifyDataChanged } from './state.js';
import { uuid, escapeHtml, openModal, showToast, confirmDialog, CURRENCIES } from './utils.js';
import { checkWeeklyBackupReminder, exportEncryptedBackup } from './backup.js';
import { checkWeeklyCloudBackupReminder, checkCloudStaleness } from './firebase-sync.js';
import { seedDemoData, clearDemoData } from './demo-data.js';
import { maybeShowInstallPrompt } from './install-prompt.js';
import { checkAndNotify, isNotificationSupported, requestNotificationPermission } from './notifications.js';
import { initI18n, t } from './i18n.js';

import { renderDashboard, initDashboardModule, DASHBOARD_PANEL_DEFAULTS } from './modules/dashboard.js';
import { renderWallets, initWalletsModule, openWalletModal } from './modules/wallets.js';
import { renderTransactions, initTransactionsModule, openQuickAdd } from './modules/transactions.js';
import { renderBudgets, initBudgetsModule, generateDueRecurring } from './modules/budgets.js';
import { renderSavings, initSavingsModule } from './modules/savings.js';
import { renderInvestments, initInvestmentsModule } from './modules/investments.js';
import { renderDebts, initDebtsModule, ensureDebtCategoryId, LEGACY_DEBT_CATEGORY_NAME } from './modules/debts.js';
import { renderTools, initToolsModule } from './modules/tools.js';
import { renderReports, initReportsModule } from './modules/reports.js';
import { renderShared, initSharedModule } from './modules/shared.js';
import { renderKeptAccounts, initKeptAccountsModule } from './modules/kept-accounts.js';
import {
  renderSettings, initSettingsModule, PROFILE_FIELDS, AUTO_LOCK_OPTIONS,
  OPTIONAL_MODULES, applyOptionalModuleVisibility, DASHBOARD_PANEL_LABELS,
} from './modules/settings.js';
import { initSearchModule } from './modules/search.js';

const VIEW_RENDERERS = {
  dashboard: renderDashboard,
  wallets: renderWallets,
  transactions: renderTransactions,
  budgets: renderBudgets,
  savings: renderSavings,
  investments: renderInvestments,
  debts: renderDebts,
  tools: renderTools,
  reports: renderReports,
  shared: renderShared,
  keptAccounts: renderKeptAccounts,
  settings: renderSettings,
};

const VIEW_TITLES = {
  dashboard: 'Tableau de bord', wallets: 'Portefeuilles', transactions: 'Transactions', budgets: 'Budgets',
  savings: 'Épargne', investments: 'Investissements', debts: 'Dettes & créances', tools: 'Outils',
  reports: 'Rapports', shared: 'Partage de dépenses', keptAccounts: 'Comptes gardés', settings: 'Paramètres',
};

const MORE_VIEWS = ['wallets', 'savings', 'investments', 'debts', 'tools', 'reports', 'shared', 'keptAccounts', 'settings'];

let lockScreenApi = null;
let lastActivityAt = Date.now();

function markActivity() { lastActivityAt = Date.now(); }

async function lockNow() {
  document.getElementById('app').hidden = true;
  if (lockScreenApi) {
    await lockScreenApi.lock();
    lockScreenApi.show();
  }
}

async function checkAutoLock() {
  const appEl = document.getElementById('app');
  if (!appEl || appEl.hidden) return; // déjà verrouillé
  const minutes = await getSetting('autoLockMinutes', 0);
  if (!minutes) return;
  if (Date.now() - lastActivityAt >= minutes * 60 * 1000) {
    await lockNow();
  }
}

function navigateTo(view) {
  if (!VIEW_RENDERERS[view]) return;
  appState.currentView = view;

  document.querySelectorAll('.view').forEach((el) => {
    const active = el.dataset.view === view;
    el.hidden = !active;
    el.classList.toggle('is-active', active);
  });
  document.querySelectorAll('[data-view-target]').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.viewTarget === view);
  });
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = t(VIEW_TITLES[view] || '');

  VIEW_RENDERERS[view]();
  bus.emit(EVENTS.VIEW_CHANGED, view);
}

async function openMoreSheet() {
  const moduleStates = await Promise.all(OPTIONAL_MODULES.map(async (m) => [m.view, await getSetting(m.key, false)]));
  const disabledViews = new Set(moduleStates.filter(([, enabled]) => !enabled).map(([view]) => view));
  const views = MORE_VIEWS.filter((v) => !disabledViews.has(v));
  const modal = openModal(
    views.map((v) => `<button type="button" class="nav-item" style="width:100%;" data-view-target="${v}">${escapeHtml(t(VIEW_TITLES[v]))}</button>`).join(''),
    { title: 'Plus' }
  );
  modal.el.querySelectorAll('[data-view-target]').forEach((btn) => {
    btn.addEventListener('click', () => { navigateTo(btn.dataset.viewTarget); modal.close(); });
  });
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
}

function applyPrivacy(hidden) {
  document.body.dataset.privacy = hidden ? 'hidden' : 'visible';
  document.getElementById('privacy-toggle')?.setAttribute('aria-pressed', String(hidden));
}

function wireGlobalChrome() {
  document.querySelectorAll('[data-view-target]').forEach((el) => {
    el.addEventListener('click', () => navigateTo(el.dataset.viewTarget));
  });

  document.getElementById('bottom-nav-more')?.addEventListener('click', openMoreSheet);

  document.getElementById('quick-add-btn')?.addEventListener('click', () => openQuickAdd());
  document.getElementById('bottom-nav-add')?.addEventListener('click', () => openQuickAdd());

  document.getElementById('privacy-toggle')?.addEventListener('click', async () => {
    appState.privacyHidden = !appState.privacyHidden;
    applyPrivacy(appState.privacyHidden);
    await setSetting('privacyHidden', appState.privacyHidden);
  });

  document.getElementById('theme-toggle')?.addEventListener('click', async () => {
    const order = ['auto', 'light', 'dark'];
    const idx = order.indexOf(appState.theme);
    appState.theme = order[(idx + 1) % order.length];
    applyTheme(appState.theme);
    await setSetting('theme', appState.theme);
    showToast(t('Thème : {mode}', { mode: t({ auto: 'Automatique', light: 'Clair', dark: 'Sombre' }[appState.theme]) }));
    VIEW_RENDERERS[appState.currentView]?.();
  });

  document.getElementById('lock-now-btn')?.addEventListener('click', lockNow);

  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach((ev) => {
    document.addEventListener(ev, markActivity, { passive: true });
  });
  setInterval(checkAutoLock, 15000);

  bus.on(EVENTS.DATA_CHANGED, (scope) => {
    VIEW_RENDERERS[appState.currentView]?.();
    // scope 'all' = import/restauration (locale ou cloud) : peut avoir changé des réglages de
    // modules optionnels (ex: keptAccountsEnabled) sans passer par settings.js, qui applique déjà
    // la visibilité lui-même — sans ça le bouton de nav reste dans l'état d'avant l'import jusqu'au
    // prochain rechargement de page.
    if (scope === 'all') applyOptionalModuleVisibility();
  });
}

async function seedDefaultsIfNeeded() {
  const categories = await dbGetAll(STORES.CATEGORIES);
  if (categories.length === 0) {
    // t(c.name) : traduit le nom dans la langue courante SEULEMENT au moment de la création (un
    // nouvel utilisateur anglophone démarre avec "Food"/"Housing"...) — jamais après coup, une
    // catégorie déjà créée (par défaut ou renommée) ne doit jamais changer toute seule si la langue
    // change ensuite, voir i18n.js.
    for (const c of DEFAULT_CATEGORIES) {
      await dbAdd(STORES.CATEGORIES, { id: uuid(), parentId: null, createdAt: new Date().toISOString(), ...c, name: t(c.name) });
    }
  }
  const base = await getSetting('baseCurrency');
  if (!base) await setSetting('baseCurrency', 'EUR');
}

/** Rattrape les transactions de dette/créance dont la catégorie n'est pas (ou plus) à jour :
    - debtId sans categoryId (créées avant l'introduction de la catégorie dédiée) ;
    - categoryId pointant vers l'ancienne catégorie unique "Prêt et créance" (avant qu'elle soit
      scindée en "Prêt"/"Créance" selon le sens — voir debts.js DEBT_CATEGORY_NAMES).
    Nettoie ensuite les catégories "Prêt et créance" orphelines (plus aucune transaction NI budget
    ne les référence) pour ne pas laisser de catégories mortes dans Budgets > Catégories.
    Coût négligeable une fois la migration faite, donc appelée à chaque boot plutôt que gardée par
    un flag one-shot : plus robuste si de nouvelles transactions mal catégorisées apparaissaient
    pour une autre raison. Pas besoin de notifier/re-render ici : ceci tourne avant le
    déverrouillage, et onUnlocked() fait de toute façon un rendu complet et frais juste après. */
async function migrateDebtTransactionCategories() {
  const [transactions, categories, debts] = await Promise.all([
    dbGetAll(STORES.TRANSACTIONS),
    dbGetAll(STORES.CATEGORIES),
    dbGetAll(STORES.DEBTS),
  ]);
  const legacyCategoryIds = new Set(categories.filter((c) => c.name === LEGACY_DEBT_CATEGORY_NAME).map((c) => c.id));
  const toFix = transactions.filter((t) => t.debtId && (!t.categoryId || legacyCategoryIds.has(t.categoryId)));

  if (toFix.length) {
    const debtById = Object.fromEntries(debts.map((d) => [d.id, d]));
    for (const t of toFix) {
      const debt = debtById[t.debtId];
      if (!debt) continue; // dette supprimée entre-temps (ses transactions auraient dû l'être aussi) : rien de fiable à déduire, on laisse tel quel
      t.categoryId = await ensureDebtCategoryId(debt.type, t.type);
      await dbPut(STORES.TRANSACTIONS, t);
    }
  }

  if (legacyCategoryIds.size) {
    const [freshTransactions, budgets] = await Promise.all([dbGetAll(STORES.TRANSACTIONS), dbGetAll(STORES.BUDGETS)]);
    const stillReferenced = new Set([...freshTransactions.map((t) => t.categoryId), ...budgets.map((b) => b.categoryId)]);
    for (const id of legacyCategoryIds) {
      if (!stillReferenced.has(id)) await dbDelete(STORES.CATEGORIES, id);
    }
  }
}

/** Applique ?view=X ou ?action=quick-add (raccourcis PWA déclarés dans manifest.json — appui
    long sur l'icône de l'app) une fois déverrouillé, puis nettoie l'URL pour ne pas rejouer
    l'action à chaque re-déverrouillage dans la même session. */
function applyShortcutParams() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const action = params.get('action');
  if (view && VIEW_RENDERERS[view]) navigateTo(view);
  if (action === 'quick-add') openQuickAdd();
  if (view || action) window.history.replaceState({}, '', window.location.pathname);
}

/** Bouton "Passer cette étape" commun à (presque) toutes les étapes de l'onboarding : avance
    sans rien enregistrer, laissant les valeurs par défaut déjà seedées (seedDefaultsIfNeeded)
    ou les réglages par défaut de chaque module en place. */
function skipStepButtonHtml() {
  return `<button type="button" class="btn btn-ghost btn-block" id="ob-skip" style="margin-top:8px;">${t('Passer cette étape')}</button>`;
}

/** Assistant de configuration multi-étapes affiché une seule fois, à la toute première
    utilisation (flag onboardingCompleted), juste après la création du code PIN. Chaque étape
    est individuellement passable ("Passer cette étape") — rien n'est obligatoire au-delà de la
    création du PIN lui-même, pour ne pas décourager un premier lancement trop long ; tout reste
    modifiable ensuite dans Paramètres. */
async function maybeShowOnboarding() {
  if (await getSetting('onboardingCompleted', false)) return;
  // Garde supplémentaire au-delà du flag : une install existante qui met à jour vers cette
  // version a déjà des portefeuilles, donc n'est pas "nouvelle" même sans le flag posé —
  // ne jamais lui montrer l'onboarding a posteriori, seulement le marquer fait silencieusement.
  const hasWallets = (await dbGetAll(STORES.WALLETS)).length > 0;
  await setSetting('onboardingCompleted', true); // marqué avant affichage : fermer sans agir ne doit pas re-harceler à chaque déverrouillage
  if (hasWallets) return;

  const steps = [
    {
      title: t('Bienvenue sur GeoFinance'),
      async render(el, { next }) {
        el.innerHTML = `
          <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${t("Choisissez d'abord la devise dans laquelle suivre votre argent au quotidien — vous pourrez quand même créer des portefeuilles dans d'autres devises ensuite.")}</p>
          <form id="ob-currency-form">
            <div class="form-row">
              <label>${t('Devise principale')}</label>
              <select name="baseCurrency">${CURRENCIES.map((c) => `<option value="${c}" ${c === 'EUR' ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </div>
            <button type="submit" class="btn btn-primary btn-block">${t('Continuer')}</button>
          </form>
          ${skipStepButtonHtml()}
          <button type="button" class="btn btn-ghost btn-block" id="ob-demo" style="margin-top:8px;">${t("Découvrir avec des données d'exemple")}</button>`;
        el.querySelector('#ob-currency-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          await setSetting('baseCurrency', new FormData(e.target).get('baseCurrency'));
          next();
        });
        el.querySelector('#ob-skip').addEventListener('click', () => next());
        // Quitte tout l'assistant (pas juste cette étape) : un jeu de données fictif rend le
        // reste du parcours (créer SON portefeuille, SON profil...) sans objet. isDemoModeActive
        // fait apparaître un bandeau permanent pour repartir de zéro avant d'entrer de vraies
        // données — voir renderDemoModeBanner() et demo-data.js.
        el.querySelector('#ob-demo').addEventListener('click', async () => {
          await seedDemoData();
          modal.close();
          notifyDataChanged('all');
          renderDemoModeBanner();
          showToast(t('Données de démonstration chargées.'));
        });
      },
    },
    {
      title: t('Votre premier portefeuille'),
      async render(el, { next }) {
        el.innerHTML = `
          <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${t('Créez votre premier portefeuille (compte bancaire, mobile money, espèces…) pour commencer à suivre vos finances.')}</p>
          <button type="button" class="btn btn-primary btn-block" id="ob-wallet-create">${t('Créer un portefeuille')}</button>
          ${skipStepButtonHtml()}`;
        el.querySelector('#ob-wallet-create').addEventListener('click', () => {
          // Le formulaire de portefeuille est une modale à part entière (réutilisée telle
          // quelle depuis wallets.js) : on masque celle de l'assistant pendant ce temps plutôt
          // que de la fermer, pour pouvoir la ré-afficher et enchaîner sur l'étape suivante
          // une fois celle-ci refermée (créée ou annulée, peu importe — voir "tout passable").
          modal.el.style.display = 'none';
          openWalletModal(null, { onDone: () => { modal.el.style.display = ''; next(); } });
        });
        el.querySelector('#ob-skip').addEventListener('click', () => next());
      },
    },
    {
      title: t('Votre profil'),
      async render(el, { next }) {
        el.innerHTML = `
          <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${t("Utilisé pour la salutation sur le tableau de bord et l'en-tête des rapports PDF. Reste 100% local, jamais transmis.")}</p>
          <form id="ob-profile-form">
            ${PROFILE_FIELDS.map((f) => `
              <div class="form-row">
                <label>${escapeHtml(t(f.label))}</label>
                <input type="${f.type}" name="${f.key}" maxlength="120">
              </div>`).join('')}
            <button type="submit" class="btn btn-primary btn-block">${t('Continuer')}</button>
          </form>
          ${skipStepButtonHtml()}`;
        el.querySelector('#ob-profile-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          await setSetting('userProfile', Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, (fd.get(f.key) || '').trim()])));
          next();
        });
        el.querySelector('#ob-skip').addEventListener('click', () => next());
      },
    },
    {
      title: t('Personnalisez votre tableau de bord'),
      async render(el, { next }) {
        el.innerHTML = `
          <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${t('Choisissez les panneaux affichés sur le tableau de bord (modifiable à tout moment dans Paramètres).')}</p>
          <form id="ob-dashboard-form">
            ${Object.entries(DASHBOARD_PANEL_LABELS).map(([key, label]) => `
              <label style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:14px;cursor:pointer;">
                <input type="checkbox" name="${key}" ${DASHBOARD_PANEL_DEFAULTS[key] ? 'checked' : ''}>
                ${escapeHtml(t(label))}
              </label>`).join('')}
            <button type="submit" class="btn btn-primary btn-block" style="margin-top:10px;">${t('Continuer')}</button>
          </form>
          ${skipStepButtonHtml()}`;
        el.querySelector('#ob-dashboard-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const panels = Object.fromEntries(Object.keys(DASHBOARD_PANEL_LABELS).map((key) => [key, fd.get(key) === 'on']));
          await setSetting('dashboardPanels', { ...DASHBOARD_PANEL_DEFAULTS, ...panels });
          next();
        });
        el.querySelector('#ob-skip').addEventListener('click', () => next());
      },
    },
    {
      title: t('Modules optionnels'),
      async render(el, { next }) {
        el.innerHTML = `
          <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${t("Activez ce qui s'applique à votre usage (modifiable à tout moment dans Paramètres).")}</p>
          <form id="ob-modules-form">
            ${OPTIONAL_MODULES.map((mod) => `
              <label style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:14px;cursor:pointer;">
                <input type="checkbox" name="${mod.key}">
                ${escapeHtml(t(mod.label))}
              </label>
              <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px;">${escapeHtml(t(mod.description))}</p>`).join('')}
            <button type="submit" class="btn btn-primary btn-block">${t('Continuer')}</button>
          </form>
          ${skipStepButtonHtml()}`;
        el.querySelector('#ob-modules-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          for (const mod of OPTIONAL_MODULES) await setSetting(mod.key, fd.get(mod.key) === 'on');
          await applyOptionalModuleVisibility();
          next();
        });
        el.querySelector('#ob-skip').addEventListener('click', () => next());
      },
    },
    {
      title: t('Sécurité'),
      async render(el, { next }) {
        const bioAvailable = await isBiometricAvailable();
        el.innerHTML = `
          <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${bioAvailable ? t('Réglez le verrouillage automatique après inactivité et activez le déverrouillage biométrique.') : t('Réglez le verrouillage automatique après inactivité.')}</p>
          <div class="form-row">
            <label>${t('Verrouillage automatique après inactivité')}</label>
            <select id="ob-auto-lock">${AUTO_LOCK_OPTIONS.map(([v, l]) => `<option value="${v}">${escapeHtml(t(l))}</option>`).join('')}</select>
          </div>
          ${bioAvailable ? `<button type="button" class="btn btn-ghost btn-block" id="ob-bio-enable" style="margin-bottom:10px;">${t('Activer le déverrouillage biométrique')}</button>` : ''}
          <button type="button" class="btn btn-primary btn-block" id="ob-continue">${t('Continuer')}</button>
          ${skipStepButtonHtml()}`;
        el.querySelector('#ob-bio-enable')?.addEventListener('click', async (e) => {
          try {
            await registerBiometric();
            showToast(t('Biométrie activée.'));
            e.target.textContent = t('Biométrie activée ✓');
            e.target.disabled = true;
          } catch (err) {
            showToast(err.message || t("Échec de l'activation biométrique."));
          }
        });
        el.querySelector('#ob-continue').addEventListener('click', async () => {
          await setSetting('autoLockMinutes', parseInt(el.querySelector('#ob-auto-lock').value, 10) || 0);
          next();
        });
        el.querySelector('#ob-skip').addEventListener('click', () => next());
      },
    },
    {
      title: t('Notifications'),
      async render(el, { next }) {
        const supported = isNotificationSupported();
        el.innerHTML = `
          <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);">${t('Rappels locaux pour vos budgets qui approchent leur limite, vos échéances proches et vos soldes bas.')}</p>
          ${supported
            ? `<button type="button" class="btn btn-primary btn-block" id="ob-notif-enable">${t('Activer les notifications')}</button>`
            : `<p class="empty-state" style="padding:8px 0;">${t('Non supportées par ce navigateur.')}</p>`}
          <button type="button" class="btn btn-ghost btn-block" id="ob-finish" style="margin-top:10px;">${supported ? t('Passer, terminer') : t('Terminer')}</button>`;
        el.querySelector('#ob-notif-enable')?.addEventListener('click', async () => {
          const perm = await requestNotificationPermission();
          if (perm === 'granted') { showToast(t('Notifications activées.')); await checkAndNotify(); }
          next();
        });
        el.querySelector('#ob-finish').addEventListener('click', () => next());
      },
    },
  ];

  let index = 0;
  const modal = openModal('<div id="ob-step-content"></div>', { title: steps[0].title });
  const titleEl = modal.el.querySelector('.modal-header h3');

  async function renderStep() {
    const step = steps[index];
    if (titleEl) titleEl.textContent = step.title;
    const body = modal.el.querySelector('.modal-body');
    body.innerHTML = `<p style="font-size:11px;color:var(--text-faint);margin:0 0 12px;text-transform:uppercase;letter-spacing:.04em;">${t('Étape {n} / {total}', { n: index + 1, total: steps.length })}</p><div id="ob-step-content"></div>`;
    await step.render(body.querySelector('#ob-step-content'), { next });
  }
  async function next() {
    index++;
    if (index >= steps.length) { modal.close(); return; }
    await renderStep();
  }

  await renderStep();
}

/** Bandeau permanent affiché tant que isDemoModeActive est vrai (voir demo-data.js) — visible sur
    toutes les vues, pas seulement le tableau de bord, pour qu'il soit impossible de manquer qu'on
    explore des données fictives et pas ses propres finances. */
/** Bannière d'annonce : ce dépôt (geofinance, gratuit) continue de fonctionner tel quel, mais une
    nouvelle version (Djignan Financial System, djignan-finance) existe désormais avec de nouvelles
    fonctionnalités. Fermeture mémorisée via setSetting pour ne plus jamais la réafficher une fois
    lue — pas une bannière qui revient nous harceler à chaque déverrouillage. */
const DJIGNAN_URL = 'https://zaky04.github.io/djignan-finance/';

/** Ouvre une petite modale demandant un mot de passe de chiffrement, exporte une sauvegarde locale
    (exportEncryptedBackup, backup.js — même fichier que le rappel hebdomadaire existant), puis
    ouvre Djignan dans un nouvel onglet une fois l'export réellement terminé. Le lien n'est donc
    jamais ouvert "à vide" : sur PC, GeoFinance et Djignan partagent déjà la même IndexedDB (même
    origine zaky04.github.io) donc rien de plus n'est nécessaire là — mais sur iOS, chaque PWA
    "Ajoutée à l'écran d'accueil" a un bac à sable de stockage isolé (voir CLAUDE.md du dépôt pro) :
    cette sauvegarde est ce que l'utilisateur importera sur Djignan (écran de restauration au
    premier lancement) pour retrouver ses données sans tout ressaisir à la main. Si l'utilisateur
    utilise déjà la sauvegarde cloud (Google), il peut l'ignorer et se reconnecter directement avec
    le même compte sur Djignan — ce bouton n'est qu'un raccourci pour qui n'a jamais activé le cloud.*/
function startMigrationBackupThenOpen() {
  const modal = openModal(`
    <p style="margin:0 0 12px;font-size:13px;color:var(--text-muted);">${t('Choisissez un mot de passe pour chiffrer votre sauvegarde. Conservez-le : vous en aurez besoin pour importer cette sauvegarde dans Djignan.')}</p>
    <form id="migration-export-form">
      <div class="form-row"><label>${t('Mot de passe')}</label><input type="password" name="passphrase" required minlength="6" autofocus></div>
      <div class="form-row"><label>${t('Confirmer le mot de passe')}</label><input type="password" name="passphraseConfirm" required minlength="6"></div>
      <button type="submit" class="btn btn-primary btn-block">${t('Chiffrer, exporter et ouvrir Djignan')}</button>
    </form>`, { title: t('Sauvegarder avant de basculer vers Djignan') });
  modal.el.querySelector('#migration-export-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('passphrase') !== fd.get('passphraseConfirm')) { showToast(t('Les mots de passe ne correspondent pas.')); return; }
    // Ouvert ICI, synchroniquement, AVANT le moindre await : exportEncryptedBackup() enchaîne des
    // dizaines de lectures IndexedDB (une par store, voir exportAllData()), largement assez long
    // pour que Safari/iOS révoque le geste utilisateur nécessaire à window.open() — cet onglet
    // resterait alors bloqué en silence, précisément sur la plateforme visée par cette bannière.
    // On garde une référence à l'onglet vide et on ne le navigue qu'une fois l'export terminé,
    // plutôt que d'appeler window.open() après l'await. opener mis à null manuellement (au lieu de
    // 'noopener' sur window.open) pour pouvoir quand même garder cette référence.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    await exportEncryptedBackup(fd.get('passphrase'));
    showToast(t('Sauvegarde chiffrée exportée.'));
    modal.close();
    if (tab) tab.location.href = DJIGNAN_URL;
    else window.open(DJIGNAN_URL, '_blank', 'noopener'); // tentative de repli si même l'onglet vide a été bloqué
  });
}

async function renderMigrationBanner() {
  const container = document.getElementById('migration-banner');
  if (!container) return;
  const dismissed = await getSetting('migrationBannerDismissed', false);
  if (dismissed) { container.hidden = true; container.innerHTML = ''; return; }
  container.hidden = false;
  container.innerHTML = `
    <p class="alert alert-info" style="margin:0;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;">
      <span>${t('Une nouvelle version de cette application existe : {name}. Sur mobile, vos données ne se transfèrent pas automatiquement — faites une sauvegarde pour les retrouver sans tout ressaisir.', { name: '<strong>Djignan Financial System</strong>' })}</span>
      <span style="display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;">
        <button type="button" class="btn btn-primary" id="migration-banner-backup" style="padding:6px 14px;">${t('Sauvegarder puis découvrir Djignan')}</button>
        <a href="${DJIGNAN_URL}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;font-size:12.5px;">${t("J'ai déjà une sauvegarde")}</a>
        <button type="button" class="icon-btn" id="migration-banner-close" aria-label="${t('Fermer')}" style="flex-shrink:0;">✕</button>
      </span>
    </p>`;
  container.querySelector('#migration-banner-backup').addEventListener('click', startMigrationBackupThenOpen);
  container.querySelector('#migration-banner-close').addEventListener('click', async () => {
    await setSetting('migrationBannerDismissed', true);
    container.hidden = true;
    container.innerHTML = '';
  });
}

async function renderDemoModeBanner() {
  const container = document.getElementById('demo-mode-banner');
  if (!container) return;
  const active = await getSetting('isDemoModeActive', false);
  if (!active) { container.hidden = true; container.innerHTML = ''; return; }
  container.hidden = false;
  container.innerHTML = `
    <p class="alert alert-info" style="margin:0;">
      ${t('Vous explorez des données de démonstration.')}
      <button type="button" class="btn btn-ghost" id="demo-clear-btn" style="margin-left:8px;padding:4px 10px;">${t('Effacer et commencer avec mes données')}</button>
    </p>`;
  container.querySelector('#demo-clear-btn').addEventListener('click', async () => {
    const ok = await confirmDialog(t('Effacer les données de démonstration et repartir de zéro ?'), { confirmText: t('Effacer'), danger: false });
    if (!ok) return;
    await clearDemoData();
    window.location.reload();
  });
}

/** Affiché une seule fois, avant même l'écran de création du code PIN, sur une toute première
    installation uniquement (même garde que maybeShowOnboarding() : un PIN déjà configuré signifie
    que ce n'est pas une première installation, on ne redemande jamais après coup à un utilisateur
    existant). Résout une fois la langue choisie ; initI18n() est rappelé immédiatement pour que
    seedDefaultsIfNeeded() (juste après, dans boot()) crée les catégories par défaut dans la bonne
    langue — pas de rechargement de page, contrairement à setLanguage() (Paramètres). */
function showLanguageChoiceScreen() {
  return new Promise((resolve) => {
    const screen = document.getElementById('language-screen');
    const lockScreen = document.getElementById('lock-screen');
    lockScreen.hidden = true;
    screen.hidden = false;
    async function choose(lang) {
      await setSetting('language', lang);
      await initI18n();
      screen.hidden = true;
      lockScreen.hidden = false;
      resolve();
    }
    document.getElementById('language-choice-fr').addEventListener('click', () => choose('fr'), { once: true });
    document.getElementById('language-choice-en').addEventListener('click', () => choose('en'), { once: true });
  });
}

async function onUnlocked() {
  document.getElementById('lock-screen').hidden = true;
  document.getElementById('app').hidden = false;
  markActivity();
  await generateDueRecurring();
  navigateTo('dashboard');
  applyShortcutParams();
  await renderMigrationBanner();
  await renderDemoModeBanner();
  await maybeShowOnboarding();
  maybeShowInstallPrompt();
  checkAndNotify();
  // En premier parmi les invites au démarrage : avertir d'une sauvegarde cloud plus récente (risque
  // de doublons/données écrasées si l'utilisateur commence à saisir sur cet appareil) prime sur les
  // simples rappels de sauvegarde ci-dessous. checkCloudStaleness() ne charge le SDK Firebase que
  // pour un utilisateur déjà connecté au cloud (cloudBackupWasSignedIn) — jamais par défaut.
  setTimeout(() => checkCloudStaleness(), 2000);
  setTimeout(() => checkWeeklyBackupReminder(), 4000); // décalé pour ne pas superposer les deux invites
  // Encore décalé par rapport au rappel local : si les deux sont dus le même jour, on ne veut pas
  // les empiler l'un sur l'autre. checkWeeklyCloudBackupReminder() ne charge le SDK Firebase que si
  // l'utilisateur clique "Sauvegarder maintenant" dans le rappel, jamais pour décider s'il s'affiche.
  setTimeout(() => checkWeeklyCloudBackupReminder(), 6000);
}

(async function boot() {
  try {
    // Réduit le risque que le navigateur évince l'IndexedDB sous pression de stockage
    // (silencieux sinon : la demande peut être refusée sans avertissement, mais ça ne
    // coûte rien de la faire — c'est le principal facteur de perte de données sur mobile).
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

    // Avant tout le reste : traduit immédiatement le châssis statique de l'app (menu, barre du
    // haut, bas de page mobile) et prépare t() pour tous les rendus JS qui suivent — sans ça, un
    // utilisateur en anglais verrait un flash de français le temps que le reste du boot s'exécute.
    await initI18n();

    // Choix de la langue, avant même la création du code PIN, sur une toute première installation
    // (jamais pour une install existante — voir la garde dans showLanguageChoiceScreen()).
    if (!(await isPinConfigured())) await showLanguageChoiceScreen();

    await seedDefaultsIfNeeded();
    await migrateDebtTransactionCategories();

    initDashboardModule();
    initWalletsModule();
    initTransactionsModule();
    initBudgetsModule();
    initSavingsModule();
    initInvestmentsModule();
    initDebtsModule();
    initToolsModule();
    initReportsModule();
    initSharedModule();
    initKeptAccountsModule();
    initSettingsModule();
    initSearchModule();
    wireGlobalChrome();

    appState.theme = await getSetting('theme', 'auto');
    applyTheme(appState.theme);
    appState.privacyHidden = await getSetting('privacyHidden', false);
    applyPrivacy(appState.privacyHidden);
    await applyOptionalModuleVisibility();

    lockScreenApi = initLockScreen({ onUnlock: onUnlocked });
  } catch (err) {
    console.error('[GeoFinance] Échec critique au démarrage :', err);
    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen) {
      lockScreen.innerHTML = `
        <div class="lock-card">
          <p class="lock-error">${t("Une erreur a empêché le démarrage de l'application. Rechargez la page ; si le problème persiste, essayez de vider le cache du navigateur pour ce site.")}</p>
        </div>`;
      lockScreen.hidden = false;
    }
  }
})();
