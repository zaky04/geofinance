/* ==========================================================================
   GeoFinance System — Module Dettes & Créances
   Suivi des remboursements + simulateur stratégique Avalanche / Boule de neige.
   ========================================================================== */

import { STORES, dbGetAll, dbPut, dbDelete, dbAdd, dbWriteBatch, logAudit, getSetting } from '../db.js';
import { getExchangeRates, computeDebtHistory } from '../ledger.js';
import { uuid, formatCurrency, formatDate, formatPercent, escapeHtml, todayISO, percentage, convertAmount, openModal, confirmDialog, showToast, currencySelectHtml, wireCurrencySelect, readCurrencyValue, safeNumber } from '../utils.js';
import { notifyDataChanged } from '../state.js';
import { renderNetWorthTrendChart } from '../charts.js';
// Aliasé en tr (pas t) : ce fichier utilise `t` comme nom de variable pour une transaction dans
// initDebtsModule() (handler de suppression) — voir le même piège documenté dans dashboard.js/
// transactions.js.
import { t as tr } from '../i18n.js';

const EDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H2V5h4l1-2Z"/></svg>';
const PAY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>';

function remaining(debt, payments) {
  const paid = payments.filter((p) => p.debtId === debt.id).reduce((s, p) => s + p.amount, 0);
  return Math.max(0, (debt.principal || 0) - paid);
}

export const DEBT_CATEGORY_NAMES = { debt: 'Prêt', receivable: 'Créance' };
/** Ancien nom unique (avant que "Prêt" et "Créance" soient distingués) — gardé pour que la
    migration dans app.js puisse repérer et corriger les transactions déjà catégorisées avec. */
export const LEGACY_DEBT_CATEGORY_NAME = 'Prêt et créance';
// Toutes les traductions connues des deux noms canoniques ci-dessus (FR + EN), utilisées UNIQUEMENT
// pour retrouver une catégorie déjà créée quelle que soit la langue active au moment de sa création
// (ensureDebtCategoryId ci-dessous) — jamais pour choisir le nom à la création, qui passe par tr()
// comme d'habitude. Sans ça, un utilisateur changeant de langue se retrouverait avec une nouvelle
// catégorie "Loan" créée à côté de son "Prêt" existant au lieu de le réutiliser.
const DEBT_CATEGORY_NAME_VARIANTS = {
  debt: ['Prêt', 'Loan'],
  receivable: ['Créance', 'Receivable'],
};

/** Retrouve (ou crée) la catégorie "Prêt" (dette) ou "Créance" selon debtType, pour le type de
    transaction donné (income/expense — les catégories sont scindées par type dans ce store, donc
    il existe potentiellement une catégorie "Prêt" ET une "Créance" par type, jusqu'à 4 au total).
    Utilisée pour que les mouvements de dette/créance (ouverture + remboursement) n'apparaissent
    jamais "Sans catégorie" dans la liste des transactions, tout en restant exclus des agrégats
    budgétaires (voir ledger.js, filtré via le champ debtId, pas via la catégorie). */
export async function ensureDebtCategoryId(debtType, txType) {
  const canonicalName = DEBT_CATEGORY_NAMES[debtType] || DEBT_CATEGORY_NAMES.debt;
  const variants = DEBT_CATEGORY_NAME_VARIANTS[debtType] || DEBT_CATEGORY_NAME_VARIANTS.debt;
  const categories = await dbGetAll(STORES.CATEGORIES);
  const existing = categories.find((c) => c.type === txType && variants.includes(c.name));
  if (existing) return existing.id;
  const category = { id: uuid(), name: tr(canonicalName), type: txType, parentId: null, createdAt: new Date().toISOString() };
  await dbAdd(STORES.CATEGORIES, category);
  return category.id;
}

function debtCardHtml(d, payments) {
  const paid = (debt_paid_of(d, payments));
  const rem = Math.max(0, (d.principal || 0) - paid);
  const pct = percentage(paid, d.principal);
  const isDebt = d.type === 'debt';
  return `
    <div class="summary-card" data-debt-id="${d.id}">
      <div class="card-title-row">
        <div>
          <span class="badge ${isDebt ? 'badge-neg' : 'badge-pos'}">${isDebt ? tr('Dette') : tr('Créance')}</span>
          <div style="font-weight:700;font-size:14.5px;margin-top:6px;">${escapeHtml(d.personName)}</div>
          ${d.note ? `<div class="tx-sub">${escapeHtml(d.note)}</div>` : ''}
        </div>
        <div class="card-actions">
          <button type="button" class="icon-btn" data-action="pay" aria-label="${tr('Enregistrer un remboursement')}" title="${tr('Enregistrer un remboursement')}">${PAY_ICON}</button>
          <button type="button" class="icon-btn" data-action="edit" aria-label="${tr('Modifier')}" title="${tr('Modifier')}">${EDIT_ICON}</button>
          <button type="button" class="icon-btn" data-action="delete" aria-label="${tr('Supprimer')}" title="${tr('Supprimer')}">${DELETE_ICON}</button>
        </div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${Math.min(pct, 100)}%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-muted);margin:6px 0 10px;">
        <span>${tr('Remboursé : {amount}', { amount: formatCurrency(paid, d.currency) })}</span>
        <span>${formatPercent(pct, 0)}</span>
      </div>
      <div class="stat-row"><span class="stat-row-label">${tr('Montant initial')}</span><span>${formatCurrency(d.principal, d.currency)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${tr('Restant dû')}</span><span class="amount" data-value="${rem}">${formatCurrency(rem, d.currency)}</span></div>
      ${d.interestRate ? `<div class="stat-row"><span class="stat-row-label">${tr("Taux d'intérêt annuel")}</span><span>${formatPercent(d.interestRate, 1)}</span></div>` : ''}
      ${d.dueDate ? `<div class="stat-row"><span class="stat-row-label">${tr('Échéance')}</span><span>${formatDate(d.dueDate)}</span></div>` : ''}
    </div>`;
}
function debt_paid_of(d, payments) {
  return payments.filter((p) => p.debtId === d.id).reduce((s, p) => s + p.amount, 0);
}

function latestPaymentDate(d, payments) {
  const own = payments.filter((p) => p.debtId === d.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return own[0]?.date || d.startDate;
}

function paidDebtRowHtml(d, paidDate) {
  const isDebt = d.type === 'debt';
  return `
    <div class="tx-row" data-debt-id="${d.id}">
      <div class="tx-main">
        <div class="tx-title">${escapeHtml(d.personName)}</div>
        <div class="tx-sub">${formatDate(paidDate)}${d.note ? ' · ' + escapeHtml(d.note) : ''}</div>
      </div>
      <div class="tx-amount amount ${isDebt ? 'neg' : 'pos'}">${formatCurrency(d.principal, d.currency)}</div>
      <div class="card-actions">
        <button type="button" class="icon-btn" data-action="delete" aria-label="${tr('Supprimer')}" title="${tr('Supprimer')}">${DELETE_ICON}</button>
      </div>
    </div>`;
}

function walletOptionsHtml(wallets, currency) {
  const matching = wallets.filter((w) => w.currency === currency);
  if (!matching.length) return `<option value="">${tr('Aucun portefeuille en {currency}', { currency: escapeHtml(currency) })}</option>`;
  return matching.map((w) => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.currency)})</option>`).join('');
}

function debtFormHtml(d, defaultCurrency) {
  const isEdit = !!d;
  return `
    <form id="debt-form">
      <div class="segmented" data-field="type">
        <button type="button" class="segmented-btn ${(!d || d.type === 'debt') ? 'is-active' : ''}" data-value="debt">${tr('Dette (je dois)')}</button>
        <button type="button" class="segmented-btn ${d?.type === 'receivable' ? 'is-active' : ''}" data-value="receivable">${tr('Créance (on me doit)')}</button>
      </div>
      <input type="hidden" name="type" value="${d?.type || 'debt'}">
      <div class="form-row"><label>${tr('Nom de la personne / organisme')}</label><input type="text" name="personName" required maxlength="60" value="${escapeHtml(d?.personName || '')}"></div>
      <div class="form-row"><label>${tr('Montant')}</label><input type="number" step="0.01" min="0" name="principal" required value="${d?.principal ?? ''}"></div>
      <div class="form-row"><label>${tr('Devise')}</label>${currencySelectHtml(d?.currency || defaultCurrency)}</div>
      ${!isEdit ? `
      <div class="form-row">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" name="movesMoneyNow" checked> ${tr('Cet argent bouge aujourd\'hui')}
        </label>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0;">${tr('Décochez si c\'est une dette déjà existante avant d\'utiliser l\'app (aucun mouvement de portefeuille ne sera créé).')}</p>
      </div>
      <div class="form-row" data-field="movesMoneyWallet">
        <label>${tr('Portefeuille')}</label>
        <select name="walletId"></select>
      </div>` : ''}
      <div class="form-row"><label>${tr("Taux d'intérêt annuel % (optionnel)")}</label><input type="number" step="0.01" min="0" name="interestRate" value="${d?.interestRate ?? ''}"></div>
      <div class="form-row"><label>${tr('Date de départ')}</label><input type="date" name="startDate" value="${d?.startDate || todayISO()}"></div>
      <div class="form-row"><label>${tr('Échéance (optionnel)')}</label><input type="date" name="dueDate" value="${d?.dueDate || ''}"></div>
      <div class="form-row"><label>${tr('Note (optionnel)')}</label><input type="text" name="note" maxlength="140" value="${escapeHtml(d?.note || '')}"></div>
      <button type="submit" class="btn btn-primary btn-block">${d ? tr('Enregistrer') : tr('Créer')}</button>
    </form>`;
}

async function openDebtModal(d = null) {
  const defaultCurrency = d ? d.currency : await getSetting('baseCurrency', 'EUR');
  const modal = openModal(debtFormHtml(d, defaultCurrency), { title: d ? tr('Modifier') : tr('Nouvelle dette / créance') });
  wireCurrencySelect(modal.el);
  let currentType = d?.type || 'debt';
  modal.el.querySelectorAll('.segmented-btn').forEach((b) => b.addEventListener('click', () => {
    currentType = b.dataset.value;
    modal.el.querySelector('[name="type"]').value = currentType;
    modal.el.querySelectorAll('.segmented-btn').forEach((x) => x.classList.toggle('is-active', x === b));
  }));

  const form = modal.el.querySelector('#debt-form');
  const movesCheckbox = form.elements.movesMoneyNow;
  const walletRow = modal.el.querySelector('[data-field="movesMoneyWallet"]');
  const walletSelect = form.elements.walletId;

  if (movesCheckbox) {
    let allWallets = [];
    const refreshWalletOptions = async () => {
      if (!allWallets.length) allWallets = (await dbGetAll(STORES.WALLETS)).filter((w) => !w.archived);
      walletSelect.innerHTML = walletOptionsHtml(allWallets, readCurrencyValue(form));
    };
    const syncWalletVisibility = () => { walletRow.hidden = !movesCheckbox.checked; };
    movesCheckbox.addEventListener('change', syncWalletVisibility);
    modal.el.querySelectorAll('[data-currency-select], [data-currency-other]').forEach((el) => {
      el.addEventListener('change', refreshWalletOptions);
      el.addEventListener('input', refreshWalletOptions);
    });
    await refreshWalletOptions();
    syncWalletVisibility();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const before = d ? { ...d } : null;
    const currency = readCurrencyValue(e.target);
    const movesMoneyNow = !d && movesCheckbox?.checked;
    if (movesMoneyNow && !walletSelect.value) { showToast(tr('Choisissez un portefeuille, ou décochez "Cet argent bouge aujourd\'hui".')); return; }

    const record = {
      id: d?.id || uuid(),
      type: currentType,
      personName: fd.get('personName').trim(),
      principal: safeNumber(parseFloat(fd.get('principal'))),
      currency,
      interestRate: safeNumber(parseFloat(fd.get('interestRate'))),
      startDate: fd.get('startDate') || todayISO(),
      dueDate: fd.get('dueDate') || null,
      status: d?.status || 'active',
      note: (fd.get('note') || '').trim().slice(0, 140),
      openingTransactionId: d?.openingTransactionId || null,
    };

    if (movesMoneyNow) {
      const txType = currentType === 'debt' ? 'income' : 'expense';
      const openingTx = {
        id: uuid(),
        type: txType,
        walletId: walletSelect.value,
        targetWalletId: null,
        categoryId: await ensureDebtCategoryId(currentType, txType),
        amount: record.principal,
        date: record.startDate,
        note: currentType === 'debt' ? tr('Prêt reçu de {name}', { name: record.personName }) : tr('Prêt accordé à {name}', { name: record.personName }),
        tags: [],
        reconciled: false,
        debtId: record.id,
        createdAt: new Date().toISOString(),
      };
      await dbAdd(STORES.TRANSACTIONS, openingTx);
      await logAudit({ entityType: 'transaction', entityId: openingTx.id, action: 'create', after: openingTx, note: tr('Mouvement de dette/créance') });
      record.openingTransactionId = openingTx.id;
    }

    await dbPut(STORES.DEBTS, record);
    await logAudit({ entityType: 'debt', entityId: record.id, action: d ? 'update' : 'create', before, after: record });
    modal.close();
    showToast(d ? tr('Mis à jour.') : tr('Créé.'));
    notifyDataChanged(movesMoneyNow ? 'all' : 'debts');
  });
}

async function openPaymentModal(d) {
  const wallets = (await dbGetAll(STORES.WALLETS)).filter((w) => !w.archived);
  const modal = openModal(`
    <form id="payment-form">
      <div class="form-row"><label>${tr('Montant remboursé')}</label><input type="number" step="0.01" min="0" name="amount" required autofocus></div>
      <div class="form-row"><label>${tr('Portefeuille')}</label><select name="walletId" required>${walletOptionsHtml(wallets, d.currency)}</select></div>
      <div class="form-row"><label>${tr('Date')}</label><input type="date" name="date" value="${todayISO()}"></div>
      <div class="form-row"><label>${tr('Note (optionnel)')}</label><input type="text" name="note" maxlength="140"></div>
      <button type="submit" class="btn btn-primary btn-block">${tr('Enregistrer')}</button>
    </form>`, { title: tr('Remboursement — {name}', { name: d.personName }) });

  modal.el.querySelector('#payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const walletId = fd.get('walletId');
    if (!walletId) { showToast(tr("Créez d'abord un portefeuille en {currency}.", { currency: d.currency })); return; }
    const payment = { id: uuid(), debtId: d.id, amount: safeNumber(parseFloat(fd.get('amount'))), date: fd.get('date'), note: (fd.get('note') || '').trim().slice(0, 140) };

    const paymentTxType = d.type === 'debt' ? 'expense' : 'income';
    const paymentTx = {
      id: uuid(),
      type: paymentTxType,
      walletId,
      targetWalletId: null,
      categoryId: await ensureDebtCategoryId(d.type, paymentTxType),
      amount: payment.amount,
      date: payment.date,
      note: tr('Remboursement — {name}', { name: d.personName }),
      tags: [],
      reconciled: false,
      debtId: d.id,
      debtPaymentId: payment.id,
      createdAt: new Date().toISOString(),
    };

    const existingPayments = (await dbGetAll(STORES.DEBT_PAYMENTS)).filter((p) => p.debtId === d.id);
    const rem = remaining(d, [...existingPayments, payment]);
    const willBePaid = rem <= 0.005 && d.status !== 'paid';
    const debtBefore = willBePaid ? { ...d } : null;
    if (willBePaid) d.status = 'paid';

    // Une seule transaction IndexedDB pour les trois écritures : soit toutes appliquées, soit
    // aucune — sans ça, une interruption pile entre deux `await dbAdd` séparés pouvait laisser une
    // ligne DEBT_PAYMENTS enregistrée sans sa transaction de portefeuille correspondante (la dette
    // paraîtrait remboursée alors que l'argent n'aurait jamais bougé), voir dbWriteBatch (db.js).
    const operations = [
      { store: STORES.DEBT_PAYMENTS, type: 'add', value: payment },
      { store: STORES.TRANSACTIONS, type: 'add', value: paymentTx },
    ];
    if (willBePaid) operations.push({ store: STORES.DEBTS, type: 'put', value: d });
    await dbWriteBatch(operations);

    await logAudit({ entityType: 'debtPayment', entityId: payment.id, action: 'create', after: payment });
    await logAudit({ entityType: 'transaction', entityId: paymentTx.id, action: 'create', after: paymentTx, note: tr('Remboursement de dette/créance') });
    if (willBePaid) await logAudit({ entityType: 'debt', entityId: d.id, action: 'update', before: debtBefore, after: d, note: tr('Soldée') });

    modal.close();
    showToast(tr('Remboursement enregistré.'));
    notifyDataChanged('debts');
  });
}

/* ---------- Simulateur Avalanche / Boule de neige ---------- */
function simulateRepayment(debts, payments, monthlyBudget, method, rates, baseCurrency) {
  const list = debts
    .filter((d) => d.type === 'debt' && d.status === 'active')
    .map((d) => ({
      id: d.id,
      name: d.personName,
      balance: convertAmount(remaining(d, payments), d.currency, baseCurrency, rates, baseCurrency),
      rate: (d.interestRate || 0) / 100 / 12,
    }))
    .filter((d) => d.balance > 0.005);

  if (method === 'avalanche') list.sort((a, b) => b.rate - a.rate);
  else list.sort((a, b) => a.balance - b.balance);

  let month = 0, totalInterest = 0;
  const payoffMonth = {};
  while (list.some((d) => d.balance > 0.005) && month < 600) {
    month++;
    for (const d of list) {
      if (d.balance > 0) { const interest = d.balance * d.rate; d.balance += interest; totalInterest += interest; }
    }
    let budget = monthlyBudget;
    for (const d of list) {
      if (d.balance <= 0 || budget <= 0) continue;
      const pay = Math.min(budget, d.balance);
      d.balance -= pay;
      budget -= pay;
      if (d.balance <= 0.005 && !payoffMonth[d.id]) payoffMonth[d.id] = month;
    }
  }
  return {
    months: month,
    maxedOut: month >= 600,
    totalInterest,
    order: list.map((d) => ({ name: d.name, payoffMonth: payoffMonth[d.id] || null })).sort((a, b) => (a.payoffMonth || 999) - (b.payoffMonth || 999)),
  };
}

function renderSimulatorResult(result, method, currency) {
  if (result.maxedOut) {
    return `<div class="alert alert-danger">${tr('Avec ce budget mensuel, les intérêts dépassent votre capacité de remboursement ({method}). Augmentez le montant mensuel.', { method })}</div>`;
  }
  const years = (result.months / 12).toFixed(1);
  return `
    <div class="panel" style="margin-bottom:12px;">
      <div class="panel-header"><h3>${method === 'avalanche' ? tr("Avalanche (taux le plus élevé d'abord)") : tr("Boule de neige (plus petit montant d'abord)")}</h3></div>
      <div class="stat-row"><span class="stat-row-label">${tr('Durée totale estimée')}</span><span>${tr('{months} mois (~{years} ans)', { months: result.months, years })}</span></div>
      <div class="stat-row"><span class="stat-row-label">${tr('Intérêts totaux payés')}</span><span>${formatCurrency(result.totalInterest, currency)}</span></div>
      <div style="margin-top:8px;font-size:12.5px;color:var(--text-muted);">
        ${tr('Ordre de remboursement : {list}', { list: result.order.map((o, i) => `${i + 1}. ${escapeHtml(o.name)} (${tr('mois {n}', { n: o.payoffMonth || '—' })})`).join(' · ') })}
      </div>
    </div>`;
}

async function renderSimulator(container) {
  const { baseCurrency } = await getExchangeRates();
  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${tr('Simulateur de remboursement stratégique')}</h3></div>
      <div class="form-row" style="max-width:260px;">
        <label>${tr('Budget mensuel disponible (en {currency}) pour rembourser vos dettes', { currency: escapeHtml(baseCurrency) })}</label>
        <input type="number" min="0" step="10" id="sim-budget" value="200">
      </div>
      <button type="button" class="btn btn-primary" id="sim-run-btn">${tr('Comparer Avalanche vs Boule de neige')}</button>
    </div>
    <div id="sim-results"></div>`;

  container.querySelector('#sim-run-btn').addEventListener('click', async () => {
    const budget = parseFloat(container.querySelector('#sim-budget').value) || 0;
    const [debts, payments, { rates, baseCurrency: base }] = await Promise.all([dbGetAll(STORES.DEBTS), dbGetAll(STORES.DEBT_PAYMENTS), getExchangeRates()]);
    const avalanche = simulateRepayment(debts, payments, budget, 'avalanche', rates, base);
    const snowball = simulateRepayment(debts, payments, budget, 'snowball', rates, base);
    const results = document.getElementById('sim-results');
    results.innerHTML = renderSimulatorResult(avalanche, 'avalanche', base) + renderSimulatorResult(snowball, 'snowball', base);
  });
}

export async function renderDebts() {
  const container = document.getElementById('debts-content');
  if (!container) return;
  const [debts, payments] = await Promise.all([dbGetAll(STORES.DEBTS), dbGetAll(STORES.DEBT_PAYMENTS)]);

  const activeDebts = debts.filter((d) => d.status !== 'paid');
  const paidDebts = debts.filter((d) => d.status === 'paid');

  const cardsHtml = activeDebts.length
    ? `<div class="grid-cards" style="margin-bottom:20px;">${activeDebts.map((d) => debtCardHtml(d, payments)).join('')}</div>`
    : `<div class="empty-state">${tr('Aucune dette ni créance active.')}</div>`;

  const hasDebts = debts.some((d) => d.type === 'debt');
  const chartHtml = hasDebts
    ? `<div class="chart-card" style="margin-bottom:20px;"><h3>${tr('Évolution du désendettement')}</h3><div class="chart-canvas-wrap"><canvas id="chart-debts-trend"></canvas></div></div>`
    : '';

  const paidHtml = paidDebts.length
    ? `<div class="panel" style="margin-top:20px;">
        <div class="panel-header"><h3>${tr('Soldées')}</h3></div>
        ${paidDebts
          .map((d) => ({ d, paidDate: latestPaymentDate(d, payments) }))
          .sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || ''))
          .map(({ d, paidDate }) => paidDebtRowHtml(d, paidDate))
          .join('')}
      </div>`
    : '';

  container.innerHTML = `${cardsHtml}${chartHtml}<div id="debts-simulator"></div>${paidHtml}`;

  if (hasDebts) {
    const { baseCurrency } = await getExchangeRates();
    const history = await computeDebtHistory(6);
    renderNetWorthTrendChart('chart-debts-trend', history, baseCurrency, tr('Dette restante'));
  }

  await renderSimulator(document.getElementById('debts-simulator'));
}

export function initDebtsModule() {
  document.getElementById('debt-add-btn')?.addEventListener('click', () => openDebtModal());

  document.getElementById('debts-content')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = e.target.closest('[data-debt-id]');
    if (!card) return;
    const debts = await dbGetAll(STORES.DEBTS);
    const d = debts.find((x) => x.id === card.dataset.debtId);
    if (!d) return;

    if (btn.dataset.action === 'pay') {
      openPaymentModal(d);
    } else if (btn.dataset.action === 'edit') {
      openDebtModal(d);
    } else if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog(tr('Supprimer "{name}" et tout son historique de remboursement (et les mouvements de portefeuille associés) ?', { name: d.personName }), { danger: true, confirmText: tr('Supprimer') });
      if (ok) {
        const payments = (await dbGetAll(STORES.DEBT_PAYMENTS)).filter((p) => p.debtId === d.id);
        const linkedTx = (await dbGetAll(STORES.TRANSACTIONS)).filter((t) => t.debtId === d.id);
        // Une seule transaction IndexedDB pour toutes ces suppressions (voir dbWriteBatch, db.js) :
        // sans ça, une interruption en cours de route pouvait laisser des remboursements/
        // transactions orphelins (la dette supprimée mais ses mouvements de portefeuille toujours
        // là, ou l'inverse).
        await dbWriteBatch([
          ...payments.map((p) => ({ store: STORES.DEBT_PAYMENTS, type: 'delete', value: p.id })),
          ...linkedTx.map((t) => ({ store: STORES.TRANSACTIONS, type: 'delete', value: t.id })),
          { store: STORES.DEBTS, type: 'delete', value: d.id },
        ]);
        await logAudit({ entityType: 'debt', entityId: d.id, action: 'delete', before: d });
        notifyDataChanged('debts');
        showToast(tr('Supprimé.'), {
          actionLabel: tr('Annuler'),
          onAction: async () => {
            await dbAdd(STORES.DEBTS, d);
            for (const p of payments) await dbAdd(STORES.DEBT_PAYMENTS, p);
            for (const t of linkedTx) await dbAdd(STORES.TRANSACTIONS, t);
            await logAudit({ entityType: 'debt', entityId: d.id, action: 'create', after: d, note: tr('Restaurée (annulation)') });
            showToast(tr('Restauré.'));
            notifyDataChanged('debts');
          },
        });
      }
    }
  });
}
