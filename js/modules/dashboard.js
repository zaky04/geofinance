/* ==========================================================================
   GeoFinance System — Module Tableau de bord
   ========================================================================== */

import { formatCurrency, formatDate, formatPercent, escapeHtml, currentMonthKey, monthKeyOffset, percentage, budgetProgressClass } from '../utils.js';
import { computeNetWorth, computeNetWorthHistory, computeNetWorthComposition, computeMonthSummary, computeExpensesByCategory, computeBudgetVsActual, computeMonthlyBudgetSummary, computeSafeToSpend, computeEndOfMonthForecast, getEnrichedTransactions, getUnconfirmedRates } from '../ledger.js';
import { renderExpensesByCategoryChart, renderNetWorthTrendChart, renderBudgetVsActualChart, trimLeadingZeros } from '../charts.js';
import { getSetting } from '../db.js';
// Aliasé en tr (pas t) : ce fichier utilise déjà `t` comme nom de paramètre pour une transaction
// (voir txRowHtml(t)) — importer la fonction de traduction sous le même nom la masquerait
// silencieusement à l'intérieur de cette fonction (t('Sans catégorie') appellerait alors la
// transaction comme une fonction au lieu de traduire, TypeError immédiat).
import { t as tr } from '../i18n.js';
import { icon as svgIcon, knownCategoryLook } from '../icons.js';

export const DASHBOARD_PANEL_DEFAULTS = { watchCategories: true, upcomingBills: true, charts: true, recentTransactions: true, safeToSpend: true, netWorth: true, debtsBalance: true };
export const BUDGET_ALERT_THRESHOLD_DEFAULTS = { warn: 70, danger: 90 };

const TX_ICONS = {
  income: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 20V6M6 12l6-6 6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  expense: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v14M6 12l6 6 6-6"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
};

function renderMonthTrend(elId, current, previous, currency, invert = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  const diff = current - previous;
  const favorable = invert ? diff <= 0 : diff >= 0;
  const sign = diff >= 0 ? '+' : '';
  el.textContent = tr('{amount} vs mois dernier', { amount: `${sign}${formatCurrency(diff, currency)}` });
  el.classList.remove('pos', 'neg');
  el.classList.add(favorable ? 'pos' : 'neg');
}

function setAmount(el, value, currency) {
  if (!el) return;
  el.dataset.value = value;
  el.textContent = formatCurrency(value, currency);
}

function renderAlerts(budgetRows, thresholds, unconfirmedRates) {
  const stack = document.getElementById('dashboard-alerts');
  if (!stack) return;
  stack.innerHTML = '';

  if (unconfirmedRates.length) {
    const div = document.createElement('div');
    div.className = 'alert alert-danger';
    const codes = unconfirmedRates.map((r) => r.code).join(', ');
    div.textContent = tr('Taux de change non confirmé pour {codes} (valeur 1:1 par défaut) — le patrimoine net affiché est probablement faux. À corriger dans Portefeuilles.', { codes });
    stack.appendChild(div);
  }

  const overBudget = budgetRows
    .map((r) => ({ ...r, pct: percentage(r.actual, r.budget) }))
    .filter((r) => r.pct >= thresholds.warn)
    .sort((a, b) => b.pct - a.pct);

  for (const r of overBudget.slice(0, 4)) {
    const level = r.pct >= thresholds.danger ? 'danger' : 'warn';
    const div = document.createElement('div');
    div.className = `alert alert-${level}`;
    div.textContent = r.pct >= 100
      ? tr('Budget "{label}" dépassé ({pct}% utilisé)', { label: r.label, pct: r.pct.toFixed(0) })
      : tr('Budget "{label}" à {pct}% de la limite', { label: r.label, pct: r.pct.toFixed(0) });
    stack.appendChild(div);
  }
}

/** Pastille de la ligne : icône et couleur de la catégorie quand elle en a une, sinon la flèche entrée/sortie/virement. */
function txIconHtml(t) {
  const look = t.type !== 'transfer' ? knownCategoryLook(t.category) : null;
  if (!look) return `<div class="tx-icon">${TX_ICONS[t.type] || ''}</div>`;
  const color = escapeHtml(look.color);
  return `<div class="tx-icon" style="color:${color};background:${color}22;">${svgIcon(look.icon, 18)}</div>`;
}

function txRowHtml(t) {
  const isTransfer = t.type === 'transfer';
  const title = isTransfer
    ? `${t.wallet?.name || '—'} → ${t.targetWallet?.name || '—'}`
    : (t.category?.name || tr('Sans catégorie'));
  const sub = `${escapeHtml(t.wallet?.name || '')} · ${formatDate(t.date)}${t.note ? ' · ' + escapeHtml(t.note) : ''}${t.splitGroupId ? ' · ' + tr('Scindée') : ''}`;
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '';
  const currency = t.wallet?.currency || 'EUR';
  const tagsHtml = t.tags?.length ? `<div class="tx-tags">${t.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')}</div>` : '';

  return `
    <div class="tx-row">
      ${txIconHtml(t)}
      <div class="tx-main">
        <div class="tx-title">${escapeHtml(title)}</div>
        <div class="tx-sub">${sub}</div>
        ${tagsHtml}
      </div>
      <div class="tx-amount amount ${cls}" data-value="${t.amount}">${sign}${formatCurrency(t.amount, currency)}</div>
    </div>`;
}

function renderRecentTransactions(rows) {
  const container = document.getElementById('dashboard-recent-transactions');
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="tx-empty">${tr('Aucune transaction pour le moment. Utilisez « Saisie express » pour commencer.')}</div>`;
    return;
  }
  container.innerHTML = rows.map(txRowHtml).join('');
}

function watchCategoryRowHtml(r) {
  const pct = percentage(r.actual, r.budget);
  const cls = budgetProgressClass(pct);
  return `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;" class="fs-14 fw-600 mb-6">
        <span>${escapeHtml(r.label)}</span>
        <span>${formatPercent(pct, 0)}</span>
      </div>
      <div class="progress-track"><div class="progress-fill ${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
    </div>`;
}

function renderWatchCategories(budgetRows) {
  const container = document.getElementById('dashboard-watch-categories');
  if (!container) return;
  const top = budgetRows
    .filter((r) => r.budget > 0)
    .map((r) => ({ ...r, pct: percentage(r.actual, r.budget) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  container.innerHTML = top.length
    ? top.map(watchCategoryRowHtml).join('')
    : `<div class="tx-empty">${tr("Aucun budget défini pour l'instant.")}</div>`;
}

function upcomingBillRowHtml(u, currency) {
  const sign = u.type === 'income' ? '+' : '−';
  const cls = u.type === 'income' ? 'pos' : 'neg';
  return `
    <div class="tx-row">
      <div class="tx-main">
        <div class="tx-title">${escapeHtml(u.name)}</div>
        <div class="tx-sub">${formatDate(u.nextDate)}</div>
      </div>
      <div class="tx-amount amount ${cls}">${sign}${formatCurrency(u.amountBase, currency)}</div>
    </div>`;
}

function renderUpcomingBills(upcoming, currency) {
  const container = document.getElementById('dashboard-upcoming-bills');
  if (!container) return;
  container.innerHTML = upcoming.length
    ? upcoming.slice(0, 5).map((u) => upcomingBillRowHtml(u, currency)).join('')
    : `<div class="tx-empty">${tr('Aucune échéance à venir ce mois-ci.')}</div>`;
}

/** "Bonjour" en journée, "Bonsoir" le soir/la nuit — convention française usuelle (bascule à 18h,
    reste sur "Bonsoir" jusqu'à l'aube). Heure locale de l'appareil, pas UTC : un salut affiché au
    mauvais moment de la journée n'a pas de sens. */
function greetingWord() {
  const hour = new Date().getHours();
  return tr(hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour');
}

/** Rien à câbler une seule fois sur ce tableau de bord (les courbes de variation sont dans Rapports). */
export function initDashboardModule() {}

export async function renderDashboard() {
  const monthKey = currentMonthKey();
  const panels = { ...DASHBOARD_PANEL_DEFAULTS, ...(await getSetting('dashboardPanels', {})) };
  const thresholds = { ...BUDGET_ALERT_THRESHOLD_DEFAULTS, ...(await getSetting('budgetAlertThresholds', {})) };

  const profile = await getSetting('userProfile', {});
  const greetingEl = document.getElementById('dashboard-greeting');
  if (greetingEl) greetingEl.textContent = profile.firstName ? `${greetingWord()}, ${profile.firstName}` : '';

  const watchEl = document.getElementById('panel-watch-categories');
  const billsEl = document.getElementById('panel-upcoming-bills');
  if (watchEl) watchEl.hidden = !panels.watchCategories;
  if (billsEl) billsEl.hidden = !panels.upcomingBills;
  const panelsGridEl = document.getElementById('dashboard-panels-grid');
  if (panelsGridEl) panelsGridEl.hidden = !panels.watchCategories && !panels.upcomingBills;
  const chartsEl = document.getElementById('dashboard-charts-grid');
  if (chartsEl) chartsEl.hidden = !panels.charts;
  const recentEl = document.getElementById('panel-recent-transactions');
  if (recentEl) recentEl.hidden = !panels.recentTransactions;
  const safeToSpendEl = document.getElementById('panel-safe-to-spend-dash');
  if (safeToSpendEl) safeToSpendEl.hidden = !panels.safeToSpend;
  const netWorthEl = document.getElementById('panel-net-worth-dash');
  if (netWorthEl) netWorthEl.hidden = !panels.netWorth;
  const debtsBalanceEl = document.getElementById('panel-debts-balance-dash');
  if (debtsBalanceEl) debtsBalanceEl.hidden = !panels.debtsBalance;
  const positionEl = document.getElementById('panel-position-dash');
  if (positionEl) positionEl.hidden = !panels.netWorth && !panels.debtsBalance;

  const [summary, prevSummary, expensesByCategory, netWorthHistory, budgetVsActual, monthlyBudget, forecast, recentTx, netWorth, composition, unconfirmedRates] = await Promise.all([
    computeMonthSummary(monthKey),
    computeMonthSummary(monthKeyOffset(monthKey, -1)),
    computeExpensesByCategory(monthKey),
    computeNetWorthHistory(12),
    computeBudgetVsActual(monthKey),
    computeMonthlyBudgetSummary(monthKey),
    computeEndOfMonthForecast(),
    getEnrichedTransactions({ limit: 8 }),
    computeNetWorth(),
    computeNetWorthComposition(),
    getUnconfirmedRates(),
  ]);
  const currency = summary.currency;

  if (panels.safeToSpend) {
    const { safeToSpend } = computeSafeToSpend(forecast, budgetVsActual);
    setAmount(document.getElementById('dash-safe-to-spend-value'), safeToSpend, forecast.currency);
    safeToSpendEl?.classList.toggle('is-negative', safeToSpend < 0);
    const safeTrendEl = document.getElementById('dash-safe-to-spend-trend');
    if (safeTrendEl) {
      safeTrendEl.textContent = safeToSpend >= 0
        ? tr('Après budgets réservés et échéances à venir')
        : tr('Dépenses prévues supérieures aux liquidités disponibles');
    }
  }

  if (panels.netWorth) {
    setAmount(document.getElementById('dash-net-worth-value'), netWorth.total, netWorth.currency);
    const netWorthTrendEl = document.getElementById('dash-net-worth-trend');
    if (netWorthTrendEl) {
      if (netWorthHistory.length >= 2) {
        const prev = netWorthHistory[netWorthHistory.length - 2].value;
        const diff = netWorth.total - prev;
        const sign = diff >= 0 ? '+' : '';
        const pctLabel = prev !== 0 ? ` (${sign}${((diff / Math.abs(prev)) * 100).toFixed(1)}%)` : '';
        netWorthTrendEl.textContent = tr('{amount} vs mois dernier', { amount: `${sign}${formatCurrency(diff, netWorth.currency)}${pctLabel}` });
      } else {
        netWorthTrendEl.textContent = tr("Pas encore assez d'historique");
      }
    }
  }

  if (panels.debtsBalance) {
    setAmount(document.getElementById('dash-receivables-value'), composition.receivables, composition.currency);
    setAmount(document.getElementById('dash-debts-value'), composition.debts, composition.currency);
    setAmount(document.getElementById('dash-debts-net-value'), composition.receivables - composition.debts, composition.currency);
  }

  renderMonthTrend('summary-trend-income', summary.income, prevSummary.income, currency);
  renderMonthTrend('summary-trend-expenses', summary.expenses, prevSummary.expenses, currency, true);
  renderMonthTrend('summary-trend-netSavings', summary.netSavings, prevSummary.netSavings, currency);
  renderMonthTrend('summary-trend-cashFlow', summary.cashFlow, prevSummary.cashFlow, currency);

  setAmount(document.getElementById('budget-month-value'), monthlyBudget.totalBudget, monthlyBudget.currency);
  const budgetTrendEl = document.getElementById('budget-month-trend');
  if (monthlyBudget.totalBudget > 0) {
    // Tolérance d'un demi-centime (même convention que ledger.js/debts.js) : évite qu'un budget
    // respecté "pile" affiche "Dépassé de 0,00 €" à cause d'un résidu flottant infime.
    const remainingLabel = monthlyBudget.remaining >= -0.005
      ? tr('Reste {amount} ce mois-ci', { amount: formatCurrency(monthlyBudget.remaining, monthlyBudget.currency) })
      : tr('Dépassé de {amount}', { amount: formatCurrency(Math.abs(monthlyBudget.remaining), monthlyBudget.currency) });
    budgetTrendEl.textContent = tr('{spent} dépensé sur catégories budgétées · {remainingLabel}', {
      spent: formatCurrency(monthlyBudget.totalSpent, monthlyBudget.currency), remainingLabel,
    });
  } else {
    budgetTrendEl.textContent = tr('Aucun budget défini pour ce mois — allez dans Budgets pour en attribuer');
  }

  const unallocatedBadge = document.getElementById('budget-unallocated-badge');
  if (summary.income > 0) {
    const unallocated = summary.income - monthlyBudget.totalBudget;
    unallocatedBadge.hidden = false;
    unallocatedBadge.textContent = unallocated >= 0
      ? tr('{amount} non affecté', { amount: formatCurrency(unallocated, monthlyBudget.currency) })
      : tr('Budgets > revenu de {amount}', { amount: formatCurrency(Math.abs(unallocated), monthlyBudget.currency) });
  } else {
    unallocatedBadge.hidden = true;
  }

  setAmount(document.getElementById('dash-income-value'), summary.income, summary.currency);
  setAmount(document.getElementById('dash-expenses-value'), summary.expenses, summary.currency);
  setAmount(document.getElementById('dash-netsavings-value'), summary.netSavings, summary.currency);
  setAmount(document.getElementById('dash-cashflow-value'), summary.cashFlow, summary.currency);

  if (panels.charts) {
    renderExpensesByCategoryChart('chart-expenses-category', expensesByCategory, currency);
    renderNetWorthTrendChart('chart-net-worth-trend', trimLeadingZeros(netWorthHistory), currency, tr('Valeur nette'));
    renderBudgetVsActualChart('chart-budget-vs-actual', budgetVsActual, currency);
  }

  renderAlerts(budgetVsActual, thresholds, unconfirmedRates);
  if (panels.recentTransactions) renderRecentTransactions(recentTx);
  if (panels.watchCategories) renderWatchCategories(budgetVsActual);
  if (panels.upcomingBills) renderUpcomingBills(forecast.upcoming, forecast.currency);
}
