/* ==========================================================================
   GeoFinance System — Module Portefeuilles & Devises
   ========================================================================== */

import { STORES, dbGetAll, dbPut, dbAdd, dbDelete, dbGetAllByIndex, logAudit, getSetting, setSetting } from '../db.js';
import { getAllWalletBalances, computeNetWorth, computeNetWorthHistory, computeNetWorthComposition, computeMonthlyBudgetSummary, computeEndOfMonthForecast } from '../ledger.js';
import { uuid, formatCurrency, escapeHtml, todayISO, currentMonthKey, openModal, confirmDialog, showToast, currencySelectHtml, wireCurrencySelect, readCurrencyValue, safeNumber } from '../utils.js';
import { notifyDataChanged } from '../state.js';
import { renderExpensesByCategoryChart } from '../charts.js';
import { t } from '../i18n.js';
import { icon as svgIcon } from '../icons.js';

function setAmount(el, value, currency) {
  if (!el) return;
  el.dataset.value = value;
  el.textContent = formatCurrency(value, currency);
}

async function renderWealthHero() {
  const [{ total, currency }, netWorthHistory, monthlyBudget, forecast, composition] = await Promise.all([
    computeNetWorth(),
    computeNetWorthHistory(6),
    computeMonthlyBudgetSummary(currentMonthKey()),
    computeEndOfMonthForecast(),
    computeNetWorthComposition(),
  ]);

  const compositionRows = [
    { label: t('Liquidités'), value: composition.liquid },
    { label: t('Investissements'), value: composition.invested },
    { label: t('Créances'), value: composition.receivables },
    { label: t('Dettes'), value: composition.debts, neg: true },
  ].filter((r) => r.value > 0);
  renderExpensesByCategoryChart('chart-net-worth-composition', compositionRows, composition.currency);

  setAmount(document.getElementById('net-worth-value'), total, currency);
  const trendEl = document.getElementById('net-worth-trend');
  if (trendEl) {
    if (netWorthHistory.length >= 2) {
      const prev = netWorthHistory[netWorthHistory.length - 2].value;
      const diff = total - prev;
      const sign = diff >= 0 ? '+' : '';
      const pctLabel = prev !== 0 ? ` (${sign}${((diff / Math.abs(prev)) * 100).toFixed(1)}%)` : '';
      trendEl.textContent = t('{amount} vs mois dernier', { amount: `${sign}${formatCurrency(diff, currency)}${pctLabel}` });
    } else {
      trendEl.textContent = t("Pas encore assez d'historique");
    }
  }

  const upcomingBillsTotal = forecast.upcoming
    .filter((u) => u.type === 'expense')
    .reduce((sum, u) => sum + u.amountBase, 0);
  const reservedBudget = Math.max(0, monthlyBudget.remaining);
  const safeToSpend = forecast.current - upcomingBillsTotal - reservedBudget;
  setAmount(document.getElementById('safe-to-spend-value'), safeToSpend, forecast.currency);
  document.getElementById('hero-safe-to-spend')?.classList.toggle('is-negative', safeToSpend < 0);
  const safeTrendEl = document.getElementById('safe-to-spend-trend');
  if (safeTrendEl) {
    safeTrendEl.textContent = safeToSpend >= 0
      ? t('Après budgets réservés et échéances à venir')
      : t('Dépenses prévues supérieures aux liquidités disponibles');
  }
}

// Valeurs (label) traduites à l'usage via t(...) (voir walletFormHtml/walletCardHtml ci-dessous),
// jamais ici — mêmes conventions que ASSET_CLASSES (investments.js) : les clés sont les valeurs
// stockées en base (wallet.type), jamais traduites.
const WALLET_TYPES = {
  bank: { label: 'Compte bancaire', icon: svgIcon('bank', 20), color: '#1f5fa6' },
  mobile_money: { label: 'Mobile Money', icon: svgIcon('phone', 20), color: '#b9663a' },
  cash: { label: 'Espèces', icon: svgIcon('banknote', 20), color: '#4f8a3c' },
  investment: { label: "Portefeuille d'investissement", icon: svgIcon('chart', 20), color: '#6a5f9e' },
  savings: { label: 'Épargne spécifique', icon: svgIcon('jar', 20), color: '#2d8a7a' },
};

function walletFormHtml(wallet, defaultCurrency) {
  const isEdit = !!wallet;
  return `
    <form id="wallet-form">
      <div class="form-row">
        <label>${t('Nom du portefeuille')}</label>
        <input type="text" name="name" required maxlength="60" value="${escapeHtml(wallet?.name || '')}" placeholder="${t('Ex: BNP Paribas, Orange Money…')}">
      </div>
      <div class="form-row">
        <label>${t('Type')}</label>
        <select name="type">
          ${Object.entries(WALLET_TYPES).map(([key, meta]) => `<option value="${key}" ${wallet?.type === key ? 'selected' : ''}>${t(meta.label)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>${t('Devise')}</label>
        ${currencySelectHtml(wallet?.currency || defaultCurrency)}
      </div>
      <div class="form-row">
        <label>${isEdit ? t('Solde initial') : t('Solde de départ')}</label>
        <input type="number" step="0.01" name="initialBalance" value="${wallet?.initialBalance ?? 0}">
      </div>
      <div class="form-row">
        <label>${t("Seuil d'alerte de solde bas (optionnel)")}</label>
        <input type="number" min="0" step="0.01" name="lowBalanceThreshold" value="${wallet?.lowBalanceThreshold ?? ''}" placeholder="${t('Ex: 50')}">
      </div>
      <button type="submit" class="btn btn-primary btn-block">${isEdit ? t('Enregistrer') : t('Créer le portefeuille')}</button>
    </form>`;
}

async function openWalletModal(wallet = null, { onDone = null } = {}) {
  const defaultCurrency = wallet ? wallet.currency : await getSetting('baseCurrency', 'EUR');
  const modal = openModal(walletFormHtml(wallet, defaultCurrency), { title: wallet ? t('Modifier le portefeuille') : t('Nouveau portefeuille'), onClose: onDone });
  wireCurrencySelect(modal.el);
  modal.el.querySelector('#wallet-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const currency = readCurrencyValue(e.target);
    const before = wallet ? { ...wallet } : null;
    const record = {
      id: wallet?.id || uuid(),
      name: fd.get('name').trim(),
      type: fd.get('type'),
      currency,
      initialBalance: safeNumber(parseFloat(fd.get('initialBalance'))),
      lowBalanceThreshold: safeNumber(parseFloat(fd.get('lowBalanceThreshold'))),
      archived: wallet?.archived || false,
      createdAt: wallet?.createdAt || new Date().toISOString(),
    };
    await dbPut(STORES.WALLETS, record);
    await logAudit({ entityType: 'wallet', entityId: record.id, action: wallet ? 'update' : 'create', before, after: record });
    await ensureExchangeRateRow(currency);
    modal.close();
    showToast(wallet ? t('Portefeuille mis à jour.') : t('Portefeuille créé.'));
    notifyDataChanged('wallets');
  });
}

async function ensureExchangeRateRow(currency) {
  const base = await getSetting('baseCurrency', 'EUR');
  if (currency === base) return;
  const existing = await dbGetAll(STORES.EXCHANGE_RATES);
  if (!existing.some((r) => r.code === currency)) {
    // confirmed:false tant que l'utilisateur n'a pas explicitement saisi/validé ce taux —
    // 1:1 est presque toujours faux (ex: 1 XOF ≠ 1 EUR) et fausserait silencieusement le
    // patrimoine net si on ne le signalait pas (voir renderRatesPanel + dashboard.js).
    await dbPut(STORES.EXCHANGE_RATES, { code: currency, rateToBase: 1, confirmed: false });
  }
}

function walletCardHtml(w) {
  const meta = WALLET_TYPES[w.type] || WALLET_TYPES.bank;
  return `
    <div class="summary-card" data-wallet-id="${w.id}">
      <div class="card-title-row">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="tx-icon" style="color:${meta.color};background:${meta.color}22;">${meta.icon}</div>
          <div>
            <div class="summary-card-label">${escapeHtml(t(meta.label))} · ${escapeHtml(w.currency)}</div>
            <div class="fw-700 fs-15">${escapeHtml(w.name)}</div>
          </div>
        </div>
        <div class="card-actions">
          <button type="button" class="icon-btn" data-action="edit" aria-label="${t('Modifier')}" title="${t('Modifier')}">
            ${svgIcon('edit', 16)}
          </button>
          <button type="button" class="icon-btn" data-action="archive" aria-label="${w.archived ? t('Désarchiver') : t('Archiver')}" title="${w.archived ? t('Désarchiver') : t('Archiver')}">
            ${svgIcon('archive', 16)}
          </button>
        </div>
      </div>
      <div class="summary-card-value amount" data-value="${w.balance}">${formatCurrency(w.balance, w.currency)}</div>
    </div>`;
}

/** Récupère les taux du jour depuis un service public gratuit, sans clé d'API (open.er-api.com).
    Renvoie { code: unités de `code` pour 1 unité de `base` } — c'est l'inverse de notre
    convention rateToBase (voir convertAmount() dans utils.js), à inverser à l'usage. Best-effort :
    l'app doit rester 100% utilisable sans ça, donc tout échec (hors-ligne, service indisponible,
    devise absente de la réponse) se dégrade en simple message, jamais en blocage. */
async function fetchLiveRates(base) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
  if (!res.ok) throw new Error(t('Requête réseau échouée'));
  const data = await res.json();
  if (data.result !== 'success' || !data.rates) throw new Error(t('Réponse inattendue du service'));
  return data.rates;
}

async function renderRatesPanel() {
  const panel = document.getElementById('wallets-rates-panel');
  if (!panel) return;
  const base = await getSetting('baseCurrency', 'EUR');
  const rates = await dbGetAll(STORES.EXCHANGE_RATES);
  if (!rates.length) {
    panel.innerHTML = `<div class="panel"><h3 class="mb-6">${t('Taux de change')}</h3><p class="empty-state" style="padding:12px 0;">${t('Aucune devise étrangère utilisée. Devise de base : <strong>{base}</strong>.', { base: escapeHtml(base) })}</p></div>`;
    return;
  }
  const unconfirmedCount = rates.filter((r) => r.confirmed === false).length;
  panel.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h3>${t('Taux de change (devise de base : {base})', { base: escapeHtml(base) })}</h3>
        <button type="button" class="btn btn-ghost" id="rates-fetch-live-btn">${t('Actualiser via internet')}</button>
      </div>
      ${unconfirmedCount ? `<p class="alert alert-warn mb-10">${unconfirmedCount > 1 ? t('{count} taux ne sont pas encore confirmés (valeur 1:1 par défaut, presque certainement fausse). Corrigez-les ci-dessous pour un patrimoine net exact.', { count: unconfirmedCount }) : t("Un taux n'est pas encore confirmé (valeur 1:1 par défaut, presque certainement fausse). Corrigez-le ci-dessous pour un patrimoine net exact.")}</p>` : ''}
      <div class="filters-bar" style="flex-direction:column;align-items:stretch;gap:10px;">
        ${rates.map((r) => `
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="badge ${r.confirmed === false ? 'badge-neg' : 'badge-accent'}" style="min-width:56px;justify-content:center;">${escapeHtml(r.code)}</span>
            <span class="fs-13 c-muted">1 ${escapeHtml(r.code)} =</span>
            <input type="number" step="0.0001" min="0" data-rate-code="${escapeHtml(r.code)}" value="${r.rateToBase}" style="width:110px;padding:7px 9px;border-radius:8px;border:1px solid ${r.confirmed === false ? 'var(--neg)' : 'var(--border)'};background:var(--surface);">
            <span class="fs-13 c-muted">${escapeHtml(base)}</span>
            ${r.confirmed === false ? `<span class="fs-12 c-neg">${t('non confirmé')}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>`;

  panel.querySelector('#rates-fetch-live-btn').addEventListener('click', async () => {
    const btn = panel.querySelector('#rates-fetch-live-btn');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('Récupération…');
    try {
      const live = await fetchLiveRates(base);
      let updated = 0;
      const missing = [];
      for (const r of rates) {
        const unitsPerBase = Number(live[r.code]);
        if (!isFinite(unitsPerBase) || unitsPerBase <= 0) { missing.push(r.code); continue; }
        const rateToBase = 1 / unitsPerBase;
        await dbPut(STORES.EXCHANGE_RATES, { code: r.code, rateToBase, confirmed: true });
        await dbAdd(STORES.EXCHANGE_RATE_HISTORY, { id: uuid(), code: r.code, date: todayISO(), rateToBase });
        updated++;
      }
      const message = updated
        ? t('{count} taux mis à jour.', { count: updated }) + (missing.length ? ' ' + t('Introuvables : {codes} (à saisir manuellement).', { codes: missing.join(', ') }) : '')
        : t('Aucun taux trouvé pour vos devises ({codes}) — saisissez-les manuellement.', { codes: missing.join(', ') });
      showToast(message);
      notifyDataChanged('rates');
    } catch {
      showToast(t('Récupération impossible (hors-ligne ou service indisponible). Vous pouvez toujours saisir les taux manuellement.'));
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  panel.querySelectorAll('[data-rate-code]').forEach((input) => {
    input.addEventListener('change', async () => {
      const code = input.dataset.rateCode;
      // safeNumber, pas juste `|| 0` : un taux Infinity/NaN ici corromprait TOUTE conversion de
      // cette devise dans toute l'app (net worth, budgets, tout ce qui passe par convertAmount).
      const value = safeNumber(parseFloat(input.value));
      await dbPut(STORES.EXCHANGE_RATES, { code, rateToBase: value, confirmed: true });
      // On archive le taux du jour dans l'historique AVANT d'appliquer le nouveau,
      // pour que les calculs de patrimoine passés restent basés sur le taux qui
      // était réellement en vigueur à chaque date (voir ledger.js ratesAsOf()).
      await dbAdd(STORES.EXCHANGE_RATE_HISTORY, { id: uuid(), code, date: todayISO(), rateToBase: value });
      showToast(t('Taux de {code} mis à jour.', { code }));
      notifyDataChanged('rates');
    });
  });
}

export async function renderWallets() {
  const grid = document.getElementById('wallets-grid');
  if (!grid) return;
  await renderWealthHero();
  const wallets = await getAllWalletBalances();
  const active = wallets.filter((w) => !w.archived);
  const archived = wallets.filter((w) => w.archived);

  if (!active.length && !archived.length) {
    grid.innerHTML = `<div class="empty-state">${t('Aucun portefeuille pour le moment. Créez votre premier compte bancaire, mobile money ou espèces.')}</div>`;
  } else {
    grid.innerHTML = active.map(walletCardHtml).join('') +
      (archived.length ? `<div style="grid-column:1/-1;" class="fs-13 c-faint fw-700 mt-8">${t('ARCHIVÉS')}</div>${archived.map(walletCardHtml).join('')}` : '');
  }

  if (!document.getElementById('wallets-rates-panel')) {
    const panel = document.createElement('div');
    panel.id = 'wallets-rates-panel';
    grid.after(panel);
  }
  await renderRatesPanel();
}

export function initWalletsModule() {
  document.getElementById('wallet-add-btn')?.addEventListener('click', () => openWalletModal());

  document.getElementById('wallets-grid')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = e.target.closest('[data-wallet-id]');
    const walletId = card?.dataset.walletId;
    const wallets = await dbGetAll(STORES.WALLETS);
    const wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) return;

    if (btn.dataset.action === 'edit') {
      openWalletModal(wallet);
    } else if (btn.dataset.action === 'archive') {
      const txCount = (await dbGetAllByIndex(STORES.TRANSACTIONS, 'byWallet', walletId)).length;
      if (!wallet.archived && txCount === 0) {
        const ok = await confirmDialog(t('Supprimer définitivement "{name}" ? Ce portefeuille n\'a aucune transaction, la suppression est possible.', { name: wallet.name }), { danger: true, confirmText: t('Supprimer') });
        if (ok) {
          await dbDelete(STORES.WALLETS, walletId);
          await logAudit({ entityType: 'wallet', entityId: walletId, action: 'delete', before: wallet });
          showToast(t('Portefeuille supprimé.'));
          notifyDataChanged('wallets');
        }
        return;
      }
      const before = { ...wallet };
      wallet.archived = !wallet.archived;
      await dbPut(STORES.WALLETS, wallet);
      await logAudit({ entityType: 'wallet', entityId: walletId, action: 'update', before, after: wallet, note: wallet.archived ? t('Archivé') : t('Désarchivé') });
      showToast(wallet.archived ? t('Portefeuille archivé.') : t('Portefeuille désarchivé.'));
      notifyDataChanged('wallets');
    }
  });
}

export { WALLET_TYPES, openWalletModal };
