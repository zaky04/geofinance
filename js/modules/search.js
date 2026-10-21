/* ==========================================================================
   GeoFinance System — Recherche globale
   Cherche en mémoire (jeu de données personnel, donc petit) parmi
   transactions, portefeuilles, dettes/créances, objectifs d'épargne,
   investissements, comptes gardés et dépenses partagées. Ouverture via
   l'icône loupe ou Ctrl/Cmd+K.
   ========================================================================== */

import { STORES, dbGetAll, getSetting } from '../db.js';
import { getEnrichedTransactions } from '../ledger.js';
import { formatCurrency, formatDate, escapeHtml, debounce } from '../utils.js';
// Aliasé en tr (pas t) : ce fichier utilise `t` comme nom de variable pour une transaction dans
// collectSearchIndex() — même piège documenté dans dashboard.js/transactions.js/debts.js/tools.js/
// reports-extras.js.
import { t as tr } from '../i18n.js';
import { bus, EVENTS } from '../state.js';
// Un résultat s'ouvre directement dans le formulaire de modification de son module (la modale de
// recherche reste ouverte dessous et se rafraîchit après l'enregistrement).
import { openQuickAdd } from './transactions.js';
import { openWalletModal } from './wallets.js';
import { openDebtModal } from './debts.js';
import { openGoalModal } from './savings.js';
import { openInvestmentModal } from './investments.js';
import { openAccountModal } from './kept-accounts.js';
import { icon as svgIcon } from '../icons.js';

// Valeurs traduites à l'usage via tr(...) (voir resultRowHtml ci-dessous), jamais ici — mêmes
// conventions que ASSET_CLASSES (investments.js) : les clés sont des identifiants internes de type,
// jamais du texte d'interface.
const TYPE_LABELS = {
  transaction: 'Transaction',
  wallet: 'Portefeuille',
  debt: 'Dette',
  receivable: 'Créance',
  savings: 'Épargne',
  investment: 'Investissement',
  keptAccount: 'Compte gardé',
  sharedExpense: 'Dépense partagée',
};

function goToView(view) {
  document.querySelector(`[data-view-target="${view}"]`)?.click();
}

function norm(s) {
  return (s || '').toString().toLowerCase();
}

async function collectSearchIndex() {
  const keptAccountsEnabled = await getSetting('keptAccountsEnabled', false);
  const [transactions, wallets, debts, savingsGoals, investments, sharedExpenses, participants, keptAccounts] = await Promise.all([
    // Pas de limit : un plafond silencieux (500 auparavant) rendait les transactions plus
    // anciennes introuvables sans que rien ne le signale — un utilisateur de plusieurs années
    // (des milliers de transactions, voir le jeu de test de performance dans CLAUDE.md §6, 14 août)
    // ne pouvait tout simplement pas retrouver une note ancienne par la recherche.
    getEnrichedTransactions(),
    dbGetAll(STORES.WALLETS),
    dbGetAll(STORES.DEBTS),
    dbGetAll(STORES.SAVINGS_GOALS),
    dbGetAll(STORES.INVESTMENTS),
    dbGetAll(STORES.SHARED_EXPENSES),
    dbGetAll(STORES.PARTICIPANTS),
    keptAccountsEnabled ? dbGetAll(STORES.KEPT_ACCOUNTS) : Promise.resolve([]),
  ]);

  const items = [];

  for (const t of transactions) {
    items.push({
      type: 'transaction', store: STORES.TRANSACTIONS, id: t.id,
      haystack: `${t.note || ''} ${t.category?.name || ''} ${t.wallet?.name || ''} ${(t.tags || []).join(' ')}`,
      title: t.category?.name || t.note || tr('Transaction'),
      sub: `${t.wallet?.name || ''} · ${formatDate(t.date)}${t.note ? ' · ' + t.note : ''}${t.tags?.length ? ' · #' + t.tags.join(' #') : ''}`,
      amount: formatCurrency(t.amount, t.wallet?.currency || 'EUR'),
      amountValue: Number(t.amount) || 0,
      dateValue: t.date || '',
      walletId: t.walletId || null,
      categoryId: t.categoryId || null,
      txType: t.type,
      view: 'transactions',
    });
  }
  for (const w of wallets.filter((w) => !w.archived)) {
    items.push({
      type: 'wallet', store: STORES.WALLETS, id: w.id,
      haystack: w.name,
      title: w.name,
      sub: w.currency,
      view: 'wallets',
    });
  }
  for (const d of debts) {
    items.push({
      type: d.type === 'debt' ? 'debt' : 'receivable', store: STORES.DEBTS, id: d.id,
      haystack: `${d.personName} ${d.note || ''}`,
      title: d.personName,
      sub: formatCurrency(d.principal, d.currency),
      view: 'debts',
    });
  }
  for (const g of savingsGoals.filter((g) => !g.archived)) {
    items.push({
      type: 'savings', store: STORES.SAVINGS_GOALS, id: g.id,
      haystack: g.name,
      title: g.name,
      sub: `${formatCurrency(g.currentAmount, g.currency)} / ${formatCurrency(g.targetAmount, g.currency)}`,
      view: 'savings',
    });
  }
  for (const inv of investments) {
    items.push({
      type: 'investment', store: STORES.INVESTMENTS, id: inv.id,
      haystack: inv.name,
      title: inv.name,
      sub: formatCurrency(inv.capitalInvested, inv.currency),
      view: 'investments',
    });
  }
  for (const acc of keptAccounts.filter((a) => !a.archived)) {
    items.push({
      type: 'keptAccount', store: STORES.KEPT_ACCOUNTS, id: acc.id,
      haystack: `${acc.ownerName} ${acc.note || ''}`,
      title: acc.ownerName,
      sub: acc.currency,
      view: 'keptAccounts',
    });
  }
  for (const exp of sharedExpenses) {
    const payer = participants.find((p) => p.id === exp.paidBy);
    items.push({
      type: 'sharedExpense', store: STORES.SHARED_EXPENSES, id: exp.id,
      haystack: `${exp.description} ${payer?.name || ''}`,
      title: exp.description,
      sub: tr('Payé par {payer} · {date}', { payer: payer?.name || '?', date: formatDate(exp.date) }),
      amount: formatCurrency(exp.amount, exp.currency),
      view: 'shared',
    });
  }

  return items;
}

/** Formulaires de modification, par type de résultat (l'élément est relu en base au clic, donc toujours
    à jour). Les dépenses partagées n'ont pas de formulaire de modification : on ouvre leur écran. */
const EDITORS = {
  transaction: (rec) => openQuickAdd({ editTransaction: rec }),
  wallet: (rec) => openWalletModal(rec),
  debt: (rec) => openDebtModal(rec),
  receivable: (rec) => openDebtModal(rec),
  savings: (rec) => openGoalModal(rec),
  investment: (rec) => openInvestmentModal(rec),
  keptAccount: (rec) => openAccountModal(rec),
};

function resultRowHtml(item, i) {
  return `
    <div class="search-result-row">
      <button type="button" class="search-result" data-index="${i}" title="${escapeHtml(tr(EDITORS[item.type] ? 'Modifier' : 'Ouvrir dans son écran'))}">
        <span class="badge badge-accent search-result-badge">${tr(TYPE_LABELS[item.type])}</span>
        <span class="search-result-body">
          <span class="search-result-title">${escapeHtml(item.title)}</span>
          <span class="search-result-sub">${escapeHtml(item.sub)}</span>
        </span>
        ${item.amount ? `<span class="search-result-amount">${escapeHtml(item.amount)}</span>` : ''}
      </button>
      ${EDITORS[item.type] ? `<button type="button" class="icon-btn search-result-go" data-go-index="${i}" aria-label="${tr('Ouvrir dans son écran')}" title="${tr('Ouvrir dans son écran')}">
        ${svgIcon('external', 16)}
      </button>` : ''}
    </div>`;
}

export function openGlobalSearch() {
  document.querySelectorAll('.modal-backdrop[data-modal="search"]').forEach((el) => el.remove());

  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.dataset.modal = 'search';
  backdrop.innerHTML = `
    <div class="modal-card search-modal" role="dialog" aria-modal="true" aria-label="${tr('Rechercher')}">
      <div class="search-input-row">
        ${svgIcon('search', 18)}
        <input type="text" id="search-input" placeholder="${tr('Rechercher une transaction, un portefeuille, une dette…')}" autocomplete="off">
        <button type="button" class="icon-btn" id="search-filters-toggle" aria-label="${tr('Filtres avancés')}" title="${tr('Filtres avancés (montant, dates)')}">
          ${svgIcon('filter', 18)}
        </button>
        <button type="button" class="icon-btn modal-close" aria-label="${tr('Fermer')}">
          ${svgIcon('close', 18)}
        </button>
      </div>
      <div id="search-advanced-filters" class="filters-bar" hidden style="padding:10px 20px;border-bottom:1px solid var(--border);">
        <select id="search-filter-wallet"><option value="">${tr('Tous les portefeuilles')}</option></select>
        <select id="search-filter-category"><option value="">${tr('Toutes catégories')}</option></select>
        <select id="search-filter-type">
          <option value="">${tr('Tous types')}</option>
          <option value="income">${tr('Recettes')}</option>
          <option value="expense">${tr('Dépenses')}</option>
          <option value="transfer">${tr('Transferts')}</option>
        </select>
        <input type="number" step="0.01" id="search-amount-min" placeholder="${tr('Montant min')}">
        <input type="number" step="0.01" id="search-amount-max" placeholder="${tr('Montant max')}">
        <input type="date" id="search-date-from" title="${tr('Du')}">
        <input type="date" id="search-date-to" title="${tr('Au')}">
        <span style="font-size:11.5px;color:var(--text-faint);">${tr("S'applique aux transactions uniquement")}</span>
      </div>
      <div id="search-results" class="search-results">
        <div class="empty-state">${tr("Tapez pour rechercher parmi vos transactions, portefeuilles, dettes, objectifs d'épargne, investissements, comptes gardés et dépenses partagées.")}</div>
      </div>
    </div>`;
  root.appendChild(backdrop);

  let offDataChanged = () => {};
  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    offDataChanged();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const input = backdrop.querySelector('#search-input');
  const resultsEl = backdrop.querySelector('#search-results');
  const filtersBar = backdrop.querySelector('#search-advanced-filters');
  const walletEl = backdrop.querySelector('#search-filter-wallet');
  const categoryEl = backdrop.querySelector('#search-filter-category');
  const typeEl = backdrop.querySelector('#search-filter-type');
  const amountMinEl = backdrop.querySelector('#search-amount-min');
  const amountMaxEl = backdrop.querySelector('#search-amount-max');
  const dateFromEl = backdrop.querySelector('#search-date-from');
  const dateToEl = backdrop.querySelector('#search-date-to');
  let index = null;
  let shown = []; // résultats actuellement affichés (l'attribut data-index y renvoie)

  backdrop.querySelector('#search-filters-toggle').addEventListener('click', () => {
    filtersBar.hidden = !filtersBar.hidden;
  });

  Promise.all([dbGetAll(STORES.WALLETS), dbGetAll(STORES.CATEGORIES)]).then(([wallets, categories]) => {
    walletEl.innerHTML = `<option value="">${tr('Tous les portefeuilles')}</option>`
      + wallets.filter((w) => !w.archived).map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
    categoryEl.innerHTML = `<option value="">${tr('Toutes catégories')}</option>`
      + categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  });

  function passesAdvancedFilters(item) {
    const walletId = walletEl.value || null;
    const categoryId = categoryEl.value || null;
    const txType = typeEl.value || null;
    const amountMin = amountMinEl.value !== '' ? parseFloat(amountMinEl.value) : null;
    const amountMax = amountMaxEl.value !== '' ? parseFloat(amountMaxEl.value) : null;
    const dateFrom = dateFromEl.value || null;
    const dateTo = dateToEl.value || null;
    if (!walletId && !categoryId && !txType && amountMin == null && amountMax == null && !dateFrom && !dateTo) return true;
    // Ces filtres n'ont de sens que pour une transaction (portefeuille/catégorie/type/montant/date) —
    // dès qu'un seul est actif, les autres types de résultats (portefeuille, dette, épargne...) sont
    // exclus, comme déjà indiqué à l'utilisateur ("S'applique aux transactions uniquement").
    if (item.type !== 'transaction') return false;
    if (walletId && item.walletId !== walletId) return false;
    if (categoryId && item.categoryId !== categoryId) return false;
    if (txType && item.txType !== txType) return false;
    if (amountMin != null && item.amountValue < amountMin) return false;
    if (amountMax != null && item.amountValue > amountMax) return false;
    if (dateFrom && item.dateValue < dateFrom) return false;
    if (dateTo && item.dateValue > dateTo) return false;
    return true;
  }

  const runSearch = debounce(() => {
    const q = norm(input.value).trim();
    if (!q) {
      resultsEl.innerHTML = `<div class="empty-state">${tr("Tapez pour rechercher parmi vos transactions, portefeuilles, dettes, objectifs d'épargne, investissements, comptes gardés et dépenses partagées.")}</div>`;
      return;
    }
    // L'index (collectSearchIndex(), plusieurs lectures IndexedDB) peut encore être en cours de
    // chargement si l'utilisateur tape très vite juste après l'ouverture (Ctrl/Cmd+K) — sans cette
    // garde, index.filter() plantait avec un TypeError (index encore null). Le .then() qui peuple
    // index relance runSearch() une fois prêt, donc la requête déjà tapée n'est pas perdue.
    if (!index) return;
    shown = index.filter((it) => norm(it.haystack).includes(q) && passesAdvancedFilters(it)).slice(0, 40);
    resultsEl.innerHTML = shown.length
      ? shown.map(resultRowHtml).join('')
      : `<div class="empty-state">${tr('Aucun résultat.')}</div>`;
  }, 120);

  input.addEventListener('input', runSearch);
  [walletEl, categoryEl, typeEl].forEach((el) => el.addEventListener('change', runSearch));
  [amountMinEl, amountMaxEl, dateFromEl, dateToEl].forEach((el) => el.addEventListener('input', runSearch));
  resultsEl.addEventListener('click', async (e) => {
    const go = e.target.closest('.search-result-go');
    if (go) {
      const item = shown[Number(go.dataset.goIndex)];
      if (!item) return;
      close();
      goToView(item.view);
      return;
    }
    const btn = e.target.closest('.search-result');
    if (!btn) return;
    const item = shown[Number(btn.dataset.index)];
    if (!item) return;
    const edit = EDITORS[item.type];
    if (!edit) { close(); goToView(item.view); return; }
    const record = (await dbGetAll(item.store)).find((r) => r.id === item.id);
    if (!record) {
      // Supprimé entre-temps : on rafraîchit la liste plutôt que d'ouvrir un formulaire vide.
      index = await collectSearchIndex();
      runSearch();
      return;
    }
    edit(record);
  });

  // Après une modification (ou suppression) faite depuis un résultat, la liste se met à jour toute seule.
  let refreshSeq = 0;
  offDataChanged = bus.on(EVENTS.DATA_CHANGED, async () => {
    // La modale peut avoir été retirée sans passer par close() (Ctrl+K pressé à nouveau).
    if (!backdrop.isConnected) { offDataChanged(); return; }
    const seq = ++refreshSeq;
    const items = await collectSearchIndex();
    if (seq !== refreshSeq || !backdrop.isConnected) return;
    index = items;
    runSearch();
  });

  collectSearchIndex().then((items) => { index = items; runSearch(); });

  setTimeout(() => input.focus(), 50);
}

export function initSearchModule() {
  document.getElementById('search-btn')?.addEventListener('click', () => openGlobalSearch());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openGlobalSearch();
    }
  });
}
