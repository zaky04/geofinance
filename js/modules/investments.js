/* ==========================================================================
   GeoFinance System — Module Investissements
   Capital investi vs valeur actuelle, ROI %, dividendes, et tableau
   comparatif du rendement annualisé (yield) par classe d'actif.
   ========================================================================== */

import { STORES, dbGetAll, dbPut, dbDelete, dbAdd, logAudit, getSetting } from '../db.js';
import { investmentValueAsOf, getExchangeRates, computeInvestmentValueHistory } from '../ledger.js';
import { uuid, formatCurrency, formatDate, formatPercent, escapeHtml, todayISO, convertAmount, openModal, confirmDialog, showToast, currencySelectHtml, wireCurrencySelect, readCurrencyValue, safeNumber } from '../utils.js';
import { notifyDataChanged } from '../state.js';
import { renderNetWorthTrendChart } from '../charts.js';
import { t } from '../i18n.js';

// Les valeurs (libellés affichés) sont traduites à l'usage via t(...), jamais les clés
// (immobilier/actions/...) : ces clés sont les valeurs stockées en base (inv.assetClass), pas du
// texte d'interface.
const ASSET_CLASSES = {
  immobilier: 'Immobilier',
  actions: 'Actions',
  flotte: 'Flotte / Transport',
  business: 'Business',
  obligations: 'Obligations',
  crypto: 'Cryptomonnaies',
  autre: 'Autre',
};

// Immobilier et véhicules sont des biens physiques valorisés périodiquement (pas de
// marché liquide), à distinguer visuellement des actifs financiers dans la liste —
// mais ils restent suivis avec exactement le même mécanisme (mêmes stores/calculs),
// pas de duplication de données.
const PHYSICAL_ASSET_CLASSES = ['immobilier', 'flotte'];
let assetFilter = 'all'; // 'all' | 'physical' | 'financial'

// Mêmes conventions que ASSET_CLASSES ci-dessus : les clés sont stockées en base (entry.type), les
// valeurs (libellés) sont traduites à l'usage via t(...).
const ENTRY_TYPE_LABELS = { contribution: 'Apport', withdrawal: 'Retrait', dividend: 'Dividende', valuation: 'Valorisation' };
const EDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H2V5h4l1-2Z"/></svg>';
const HISTORY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M13 3a9 9 0 1 0 8.94 10H19.9A7 7 0 1 1 13 5v4l5-4-5-4v2Z"/></svg>';

function computeMetrics(inv, entries) {
  const own = entries.filter((e) => e.investmentId === inv.id);
  const contributions = own.filter((e) => e.type === 'contribution').reduce((s, e) => s + e.amount, 0);
  const withdrawals = own.filter((e) => e.type === 'withdrawal').reduce((s, e) => s + e.amount, 0);
  const dividends = own.filter((e) => e.type === 'dividend').reduce((s, e) => s + e.amount, 0);
  const netInvested = (inv.capitalInvested || 0) + contributions - withdrawals;
  const currentValue = investmentValueAsOf(inv, entries, null);
  const gain = currentValue - netInvested + dividends;
  const roiPct = netInvested ? (gain / netInvested) * 100 : 0;
  const yearsHeld = Math.max((Date.now() - new Date(inv.createdAt).getTime()) / (365.25 * 24 * 3600 * 1000), 1 / 12);
  const annualizedYieldPct = roiPct / yearsHeld;
  return { netInvested, currentValue, dividends, gain, roiPct, annualizedYieldPct };
}

function investmentCardHtml(inv, metrics) {
  const positive = metrics.gain >= 0;
  return `
    <div class="summary-card" data-investment-id="${inv.id}">
      <div class="card-title-row">
        <div>
          <span class="badge badge-accent">${escapeHtml(t(ASSET_CLASSES[inv.assetClass] || inv.assetClass))}</span>
          <div style="font-weight:700;font-size:14.5px;margin-top:6px;">${escapeHtml(inv.name)}</div>
        </div>
        <div class="card-actions">
          <button type="button" class="icon-btn" data-action="history" aria-label="${t('Historique / Ajouter')}" title="${t('Historique / Ajouter')}">${HISTORY_ICON}</button>
          <button type="button" class="icon-btn" data-action="edit" aria-label="${t('Modifier')}" title="${t('Modifier')}">${EDIT_ICON}</button>
          <button type="button" class="icon-btn" data-action="delete" aria-label="${t('Supprimer')}" title="${t('Supprimer')}">${DELETE_ICON}</button>
        </div>
      </div>
      <div class="stat-row"><span class="stat-row-label">${t('Capital net investi')}</span><span class="amount" data-value="${metrics.netInvested}">${formatCurrency(metrics.netInvested, inv.currency)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${t('Valeur actuelle')}</span><span class="amount" data-value="${metrics.currentValue}">${formatCurrency(metrics.currentValue, inv.currency)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${t('Dividendes perçus')}</span><span class="amount" data-value="${metrics.dividends}">${formatCurrency(metrics.dividends, inv.currency)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${t('Plus/moins-value + revenus')}</span><span class="badge ${positive ? 'badge-pos' : 'badge-neg'}">${positive ? '+' : ''}${formatCurrency(metrics.gain, inv.currency)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${t('ROI global')}</span><span class="badge ${metrics.roiPct >= 0 ? 'badge-pos' : 'badge-neg'}">${formatPercent(metrics.roiPct)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${t('Rendement annualisé')}</span><span class="badge ${metrics.annualizedYieldPct >= 0 ? 'badge-pos' : 'badge-neg'}">${formatPercent(metrics.annualizedYieldPct)}</span></div>
    </div>`;
}

function investmentFormHtml(inv, defaultCurrency) {
  return `
    <form id="investment-form">
      <div class="form-row"><label>${t('Nom')}</label><input type="text" name="name" required maxlength="60" value="${escapeHtml(inv?.name || '')}" placeholder="${t('Ex: Appartement Cocody, Actions Total…')}"></div>
      <div class="form-row"><label>${t("Classe d'actif")}</label>
        <select name="assetClass">${Object.entries(ASSET_CLASSES).map(([k, l]) => `<option value="${k}" ${inv?.assetClass === k ? 'selected' : ''}>${t(l)}</option>`).join('')}</select>
      </div>
      <div class="form-row"><label>${t('Devise')}</label>${currencySelectHtml(inv?.currency || defaultCurrency)}</div>
      <div class="form-row"><label>${t('Capital investi initial')}</label><input type="number" step="0.01" min="0" name="capitalInvested" required value="${inv?.capitalInvested ?? ''}"></div>
      <button type="submit" class="btn btn-primary btn-block">${inv ? t('Enregistrer') : t("Créer l'investissement")}</button>
    </form>`;
}

async function openInvestmentModal(inv = null) {
  const defaultCurrency = inv ? inv.currency : await getSetting('baseCurrency', 'EUR');
  const modal = openModal(investmentFormHtml(inv, defaultCurrency), { title: inv ? t("Modifier l'investissement") : t('Nouvel investissement') });
  wireCurrencySelect(modal.el);
  modal.el.querySelector('#investment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const before = inv ? { ...inv } : null;
    const record = {
      id: inv?.id || uuid(),
      name: fd.get('name').trim(),
      assetClass: fd.get('assetClass'),
      currency: readCurrencyValue(e.target),
      capitalInvested: safeNumber(parseFloat(fd.get('capitalInvested'))),
      createdAt: inv?.createdAt || new Date().toISOString(),
    };
    await dbPut(STORES.INVESTMENTS, record);
    await logAudit({ entityType: 'investment', entityId: record.id, action: inv ? 'update' : 'create', before, after: record });
    modal.close();
    showToast(inv ? t('Investissement mis à jour.') : t('Investissement créé.'));
    notifyDataChanged('investments');
  });
}

async function openHistoryModal(inv) {
  const entries = (await dbGetAll(STORES.INVESTMENT_ENTRIES)).filter((e) => e.investmentId === inv.id).sort((a, b) => b.date.localeCompare(a.date));

  const modal = openModal(`
    <form id="entry-form" style="margin-bottom:16px;">
      <div class="form-row"><label>${t('Type')}</label>
        <select name="type">${Object.entries(ENTRY_TYPE_LABELS).map(([k, l]) => `<option value="${k}">${t(l)}</option>`).join('')}</select>
      </div>
      <div class="form-row"><label>${t('Montant')}</label><input type="number" step="0.01" min="0" name="amount" required></div>
      <div class="form-row"><label>${t('Date')}</label><input type="date" name="date" value="${todayISO()}" required></div>
      <div class="form-row"><label>${t('Note (optionnel)')}</label><input type="text" name="note" maxlength="140"></div>
      <button type="submit" class="btn btn-primary btn-block">${t('Ajouter')}</button>
    </form>
    <div id="entry-list">
      ${entries.length ? entries.map((e) => `
        <div class="tx-row" data-entry-id="${e.id}">
          <div class="tx-main">
            <div class="tx-title">${t(ENTRY_TYPE_LABELS[e.type])}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
            <div class="tx-sub">${formatDate(e.date)}</div>
          </div>
          <div class="tx-amount">${formatCurrency(e.amount, inv.currency)}</div>
          <div class="card-actions"><button type="button" class="icon-btn" data-action="delete-entry" aria-label="${t('Supprimer')}" title="${t('Supprimer')}">${DELETE_ICON}</button></div>
        </div>`).join('') : `<div class="empty-state">${t('Aucun historique pour le moment.')}</div>`}
    </div>
  `, { title: t('Historique — {name}', { name: inv.name }) });

  modal.el.querySelector('#entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const entry = {
      id: uuid(),
      investmentId: inv.id,
      type: fd.get('type'),
      amount: safeNumber(parseFloat(fd.get('amount'))),
      date: fd.get('date'),
      note: (fd.get('note') || '').trim().slice(0, 140),
    };
    await dbAdd(STORES.INVESTMENT_ENTRIES, entry);
    await logAudit({ entityType: 'investmentEntry', entityId: entry.id, action: 'create', after: entry });
    modal.close();
    showToast(t('Entrée ajoutée.'));
    notifyDataChanged('investments');
  });

  modal.el.querySelector('#entry-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete-entry"]');
    if (!btn) return;
    const entryId = e.target.closest('[data-entry-id]').dataset.entryId;
    const ok = await confirmDialog(t("Supprimer cette entrée d'historique ?"), { danger: true, confirmText: t('Supprimer') });
    if (ok) {
      await dbDelete(STORES.INVESTMENT_ENTRIES, entryId);
      await logAudit({ entityType: 'investmentEntry', entityId, action: 'delete' });
      modal.close();
      showToast(t('Entrée supprimée.'));
      notifyDataChanged('investments');
    }
  });
}

function renderYieldTable(rows, baseCurrency, rates) {
  const byClass = new Map();
  for (const r of rows) {
    const key = r.inv.assetClass;
    const netInvestedBase = convertAmount(r.metrics.netInvested, r.inv.currency, baseCurrency, rates, baseCurrency);
    const currentValueBase = convertAmount(r.metrics.currentValue, r.inv.currency, baseCurrency, rates, baseCurrency);
    if (!byClass.has(key)) byClass.set(key, { netInvested: 0, currentValue: 0, weightedYield: 0 });
    const acc = byClass.get(key);
    acc.netInvested += netInvestedBase;
    acc.currentValue += currentValueBase;
    acc.weightedYield += r.metrics.annualizedYieldPct * Math.max(netInvestedBase, 0);
  }
  const lines = [...byClass.entries()].map(([key, acc]) => ({
    label: t(ASSET_CLASSES[key] || key),
    netInvested: acc.netInvested,
    currentValue: acc.currentValue,
    yieldPct: acc.netInvested ? acc.weightedYield / acc.netInvested : 0,
  }));
  if (!lines.length) return `<div class="empty-state">${t('Ajoutez des investissements pour voir le comparatif de rendement.')}</div>`;

  return `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;">
        <thead><tr style="text-align:left;color:var(--text-muted);">
          <th style="padding:8px 6px;">${t("Classe d'actif")}</th><th style="padding:8px 6px;">${t('Capital net')}</th><th style="padding:8px 6px;">${t('Valeur actuelle')}</th><th style="padding:8px 6px;">${t('Rendement annualisé')}</th>
        </tr></thead>
        <tbody>
          ${lines.map((l) => `
            <tr style="border-top:1px solid var(--border);">
              <td style="padding:8px 6px;font-weight:600;">${escapeHtml(l.label)}</td>
              <td style="padding:8px 6px;">${formatCurrency(l.netInvested, baseCurrency)}</td>
              <td style="padding:8px 6px;">${formatCurrency(l.currentValue, baseCurrency)}</td>
              <td style="padding:8px 6px;"><span class="badge ${l.yieldPct >= 0 ? 'badge-pos' : 'badge-neg'}">${formatPercent(l.yieldPct)}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

export async function renderInvestments() {
  const container = document.getElementById('investments-content');
  if (!container) return;
  const [investments, entries, { rates, baseCurrency }] = await Promise.all([dbGetAll(STORES.INVESTMENTS), dbGetAll(STORES.INVESTMENT_ENTRIES), getExchangeRates()]);

  if (!investments.length) {
    container.innerHTML = `<div class="empty-state">${t('Aucun investissement suivi. Ajoutez votre premier actif (immobilier, actions, business…).')}</div>`;
    return;
  }

  const allRows = investments.map((inv) => ({ inv, metrics: computeMetrics(inv, entries) }));
  const rows = allRows.filter((r) => {
    if (assetFilter === 'physical') return PHYSICAL_ASSET_CLASSES.includes(r.inv.assetClass);
    if (assetFilter === 'financial') return !PHYSICAL_ASSET_CLASSES.includes(r.inv.assetClass);
    return true;
  });

  container.innerHTML = `
    <div class="tabs-bar" style="margin-bottom:16px;">
      <button type="button" class="tab-btn ${assetFilter === 'all' ? 'is-active' : ''}" data-asset-filter="all">${t('Tous')}</button>
      <button type="button" class="tab-btn ${assetFilter === 'financial' ? 'is-active' : ''}" data-asset-filter="financial">${t('Actifs financiers')}</button>
      <button type="button" class="tab-btn ${assetFilter === 'physical' ? 'is-active' : ''}" data-asset-filter="physical">${t('Biens physiques')}</button>
    </div>
    <div class="grid-cards" style="margin-bottom:18px;">${rows.length ? rows.map((r) => investmentCardHtml(r.inv, r.metrics)).join('') : `<div class="empty-state">${t('Aucun actif dans cette catégorie.')}</div>`}</div>
    <div class="chart-card" style="margin-bottom:18px;">
      <h3>${t('Évolution de la valeur du portefeuille')}</h3>
      <div class="chart-canvas-wrap"><canvas id="chart-investments-trend"></canvas></div>
    </div>
    <div class="panel">
      <div class="panel-header"><h3>${t("Comparatif de rendement par classe d'actif")}</h3></div>
      ${renderYieldTable(rows, baseCurrency, rates)}
    </div>`;

  container.querySelectorAll('[data-asset-filter]').forEach((btn) => {
    btn.addEventListener('click', () => { assetFilter = btn.dataset.assetFilter; renderInvestments(); });
  });

  const history = await computeInvestmentValueHistory(6);
  renderNetWorthTrendChart('chart-investments-trend', history, baseCurrency, t('Valeur du portefeuille'));
}

export function initInvestmentsModule() {
  document.getElementById('investment-add-btn')?.addEventListener('click', () => openInvestmentModal());

  document.getElementById('investments-content')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = e.target.closest('[data-investment-id]');
    if (!card) return;
    const investments = await dbGetAll(STORES.INVESTMENTS);
    const inv = investments.find((x) => x.id === card.dataset.investmentId);
    if (!inv) return;

    if (btn.dataset.action === 'history') {
      openHistoryModal(inv);
    } else if (btn.dataset.action === 'edit') {
      openInvestmentModal(inv);
    } else if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog(t('Supprimer l\'investissement "{name}" et tout son historique ?', { name: inv.name }), { danger: true, confirmText: t('Supprimer') });
      if (ok) {
        const entries = (await dbGetAll(STORES.INVESTMENT_ENTRIES)).filter((en) => en.investmentId === inv.id);
        for (const en of entries) await dbDelete(STORES.INVESTMENT_ENTRIES, en.id);
        await dbDelete(STORES.INVESTMENTS, inv.id);
        await logAudit({ entityType: 'investment', entityId: inv.id, action: 'delete', before: inv });
        showToast(t('Investissement supprimé.'));
        notifyDataChanged('investments');
      }
    }
  });
}
