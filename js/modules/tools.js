/* ==========================================================================
   GeoFinance System — Module Outils stratégiques
   Simulateur de trajectoire patrimoniale, calculateur d'inflation, fonds
   d'urgence, enveloppes 50/30/20, détection d'anomalies de dépenses,
   journal d'audit.
   ========================================================================== */

import { STORES, dbGetAll, getSetting } from '../db.js';
import { computeMonthSummary, computeLiquidBalance, computeNetWorth, detectRecurringCandidates } from '../ledger.js';
import { formatCurrency, formatPercent, escapeHtml, currentMonthKey, monthKeyOffset, convertAmount, localISODate, intlLocale } from '../utils.js';
// Aliasé en tr (pas t) : ce fichier utilise `t` comme nom de variable pour un outil (objet
// {html, wire}) dans renderTools() et pour une transaction dans renderAnomalyTool() — même piège
// documenté dans dashboard.js/transactions.js/debts.js.
import { t as tr } from '../i18n.js';

function panel(title, bodyHtml, id) {
  return `<div class="panel" style="grid-column:1/-1;margin-bottom:18px;" ${id ? `id="${id}"` : ''}>
    <div class="panel-header"><h3>${title}</h3></div>
    ${bodyHtml}
  </div>`;
}

/* ---------- 1. Simulateur de trajectoire patrimoniale ---------- */
async function renderWealthTrajectoryTool() {
  const { total, currency } = await computeNetWorth();
  const summary = await computeMonthSummary(currentMonthKey());
  const defaultMonthlySavings = Math.max(0, Math.round(summary.netSavings));

  const body = `
    <div class="filters-bar mb-14">
      <div class="form-row m-0"><label>${tr('Épargne mensuelle ({currency})', { currency: escapeHtml(currency) })}</label><input type="number" id="wt-savings" value="${defaultMonthlySavings}" step="10"></div>
      <div class="form-row m-0"><label>${tr('Rendement annuel attendu (%)')}</label><input type="number" id="wt-return" value="4" step="0.1"></div>
    </div>
    <div id="wt-results" class="grid-cards"></div>
    <p class="fs-12 c-faint mt-10">${tr('Projection à partir du patrimoine net actuel ({amount}), en supposant un rendement composé constant et une épargne mensuelle régulière.', { amount: formatCurrency(total, currency) })}</p>`;

  const html = panel(tr("Simulateur de trajectoire patrimoniale (1, 3, 5 ans)"), body, 'tool-wealth-trajectory');

  function compute() {
    const el = document.getElementById('tool-wealth-trajectory');
    if (!el) return;
    const pmt = parseFloat(el.querySelector('#wt-savings').value) || 0;
    const annualReturn = parseFloat(el.querySelector('#wt-return').value) || 0;
    const r = annualReturn / 100 / 12;
    const results = [1, 3, 5].map((years) => {
      const n = years * 12;
      const fvPrincipal = total * Math.pow(1 + r, n);
      const fvSavings = r === 0 ? pmt * n : pmt * ((Math.pow(1 + r, n) - 1) / r);
      return { years, value: fvPrincipal + fvSavings };
    });
    el.querySelector('#wt-results').innerHTML = results.map((r2) => `
      <div class="summary-card">
        <div class="summary-card-label">${r2.years > 1 ? tr('Dans {years} ans', { years: r2.years }) : tr('Dans {years} an', { years: r2.years })}</div>
        <div class="summary-card-value">${formatCurrency(r2.value, currency)}</div>
      </div>`).join('');
  }

  return { html, wire: () => { document.getElementById('tool-wealth-trajectory').addEventListener('input', compute); compute(); } };
}

/* ---------- 2. Calculateur d'inflation & pouvoir d'achat ---------- */
async function renderInflationTool() {
  const { baseCurrency } = await getExchangeRatesSafe();
  const body = `
    <div class="filters-bar mb-14">
      <div class="form-row m-0"><label>${tr('Montant ({currency})', { currency: escapeHtml(baseCurrency) })}</label><input type="number" id="inf-amount" value="1000" step="10"></div>
      <div class="form-row m-0"><label>${tr('Inflation annuelle (%)')}</label><input type="number" id="inf-rate" value="3" step="0.1"></div>
      <div class="form-row m-0"><label>${tr('Durée (années)')}</label><input type="number" id="inf-years" value="10" step="1"></div>
    </div>
    <div id="inf-results"></div>`;
  const html = panel(tr("Calculateur d'inflation & pouvoir d'achat"), body, 'tool-inflation');

  function compute() {
    const el = document.getElementById('tool-inflation');
    if (!el) return;
    const amount = parseFloat(el.querySelector('#inf-amount').value) || 0;
    const rate = parseFloat(el.querySelector('#inf-rate').value) || 0;
    const years = parseFloat(el.querySelector('#inf-years').value) || 0;
    const realValue = amount / Math.pow(1 + rate / 100, years);
    const loss = amount - realValue;
    const lossPct = amount ? (loss / amount) * 100 : 0;
    el.querySelector('#inf-results').innerHTML = `
      <div class="stat-row"><span class="stat-row-label">${tr("Pouvoir d'achat réel dans {years} an(s)", { years })}</span><span>${formatCurrency(realValue, baseCurrency)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${tr('Perte de valeur')}</span><span class="badge badge-neg">-${formatCurrency(loss, baseCurrency)} (${formatPercent(lossPct)})</span></div>`;
  }
  return { html, wire: () => { document.getElementById('tool-inflation').addEventListener('input', compute); compute(); } };
}

/* ---------- 3. Calculateur de fonds d'urgence ---------- */
async function averageMonthlyExpenses(months = 3) {
  let sum = 0;
  for (let i = 1; i <= months; i++) {
    const mk = monthKeyOffset(currentMonthKey(), -i);
    const s = await computeMonthSummary(mk);
    sum += s.expenses;
  }
  return sum / months;
}

async function renderEmergencyFundTool() {
  const avgExpenses = await averageMonthlyExpenses(3);
  const { total: liquid, currency } = await computeLiquidBalance();

  const body = `
    <div class="filters-bar mb-14">
      <div class="form-row m-0"><label>${tr('Dépenses mensuelles moyennes ({currency})', { currency: escapeHtml(currency) })}</label><input type="number" id="ef-expenses" value="${Math.round(avgExpenses)}" step="10"></div>
      <div class="form-row m-0"><label>${tr('Mois de couverture souhaités')}</label>
        <select id="ef-months"><option value="3">${tr('{n} mois', { n: 3 })}</option><option value="6" selected>${tr('{n} mois', { n: 6 })}</option><option value="12">${tr('{n} mois', { n: 12 })}</option></select>
      </div>
    </div>
    <div id="ef-results"></div>`;
  const html = panel(tr("Calculateur de fonds d'urgence"), body, 'tool-emergency-fund');

  function compute() {
    const el = document.getElementById('tool-emergency-fund');
    if (!el) return;
    const expenses = parseFloat(el.querySelector('#ef-expenses').value) || 0;
    const months = parseFloat(el.querySelector('#ef-months').value) || 0;
    const target = expenses * months;
    const autonomyMonths = expenses ? liquid / expenses : 0;
    const gap = Math.max(0, target - liquid);
    el.querySelector('#ef-results').innerHTML = `
      <div class="stat-row"><span class="stat-row-label">${tr('Liquidités actuelles (portefeuilles)')}</span><span>${formatCurrency(liquid, currency)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${tr('Objectif ({months} mois)', { months })}</span><span>${formatCurrency(target, currency)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${tr('Autonomie actuelle')}</span><span class="badge ${autonomyMonths >= months ? 'badge-pos' : 'badge-neg'}">${tr('{n} mois', { n: autonomyMonths.toFixed(1) })}</span></div>
      ${gap > 0 ? `<div class="stat-row"><span class="stat-row-label">${tr("Montant à épargner pour atteindre l'objectif")}</span><span>${formatCurrency(gap, currency)}</span></div>` : `<div class="alert alert-info mt-8">${tr("Objectif de fonds d'urgence atteint !")}</div>`}`;
  }
  return { html, wire: () => { document.getElementById('tool-emergency-fund').addEventListener('input', compute); compute(); } };
}

/* ---------- 3bis. Simulateur d'impact d'un achat important ---------- */
function monthlyPaymentFor(principal, months, annualRatePct) {
  if (months <= 0) return principal;
  const r = (annualRatePct || 0) / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

async function renderPurchaseImpactTool() {
  const avgExpenses = await averageMonthlyExpenses(3);
  const { total: liquid, currency } = await computeLiquidBalance();
  const summary = await computeMonthSummary(currentMonthKey());

  const body = `
    <div class="filters-bar mb-14">
      <div class="form-row m-0"><label>${tr("Montant de l'achat ({currency})", { currency: escapeHtml(currency) })}</label><input type="number" id="pi-amount" value="1000" step="10" min="0"></div>
      <div class="form-row m-0"><label>${tr('Mode de financement')}</label>
        <select id="pi-mode">
          <option value="cash">${tr('Comptant (sur liquidités)')}</option>
          <option value="credit">${tr('Crédit / paiement échelonné')}</option>
        </select>
      </div>
      <div class="form-row m-0" id="pi-duration-row" style="display:none;"><label>${tr('Durée (mois)')}</label><input type="number" id="pi-duration" value="12" min="1" step="1"></div>
      <div class="form-row m-0" id="pi-rate-row" style="display:none;"><label>${tr("Taux d'intérêt annuel % (optionnel)")}</label><input type="number" id="pi-rate" value="0" min="0" step="0.1"></div>
    </div>
    <div id="pi-results"></div>`;
  const html = panel(tr("Simulateur d'impact d'un achat important"), body, 'tool-purchase-impact');

  function compute() {
    const el = document.getElementById('tool-purchase-impact');
    if (!el) return;
    const amount = parseFloat(el.querySelector('#pi-amount').value) || 0;
    const mode = el.querySelector('#pi-mode').value;
    el.querySelector('#pi-duration-row').style.display = mode === 'credit' ? 'block' : 'none';
    el.querySelector('#pi-rate-row').style.display = mode === 'credit' ? 'block' : 'none';

    let resultsHtml;
    if (mode === 'cash') {
      const newLiquid = liquid - amount;
      const currentAutonomy = avgExpenses ? liquid / avgExpenses : 0;
      const newAutonomy = avgExpenses ? newLiquid / avgExpenses : 0;
      resultsHtml = `
        <div class="stat-row"><span class="stat-row-label">${tr('Liquidités actuelles')}</span><span>${formatCurrency(liquid, currency)}</span></div>
        <div class="stat-row"><span class="stat-row-label">${tr('Liquidités après achat')}</span><span class="badge ${newLiquid >= 0 ? 'badge-pos' : 'badge-neg'}">${formatCurrency(newLiquid, currency)}</span></div>
        <div class="stat-row"><span class="stat-row-label">${tr("Autonomie du fonds d'urgence")}</span><span>${tr('{n} mois', { n: currentAutonomy.toFixed(1) })} → <span class="badge ${newAutonomy >= 3 ? 'badge-pos' : 'badge-neg'}">${tr('{n} mois', { n: newAutonomy.toFixed(1) })}</span></span></div>
        ${newLiquid < 0
          ? `<div class="alert alert-danger mt-8">${tr('Cet achat dépasserait vos liquidités actuelles.')}</div>`
          : (newAutonomy < 3 ? `<div class="alert alert-warn mt-8">${tr("Votre fonds d'urgence passerait sous 3 mois de couverture.")}</div>` : '')}`;
    } else {
      const months = parseFloat(el.querySelector('#pi-duration').value) || 1;
      const rate = parseFloat(el.querySelector('#pi-rate').value) || 0;
      const payment = monthlyPaymentFor(amount, months, rate);
      const totalCost = payment * months;
      const totalInterest = totalCost - amount;
      const newNetSavings = summary.netSavings - payment;
      resultsHtml = `
        <div class="stat-row"><span class="stat-row-label">${tr('Mensualité')}</span><span>${formatCurrency(payment, currency)}</span></div>
        <div class="stat-row"><span class="stat-row-label">${tr('Coût total')}</span><span>${formatCurrency(totalCost, currency)}${totalInterest > 0.5 ? ` ${tr("(dont {amount} d'intérêts)", { amount: formatCurrency(totalInterest, currency) })}` : ''}</span></div>
        <div class="stat-row"><span class="stat-row-label">${tr('Épargne nette mensuelle actuelle')}</span><span>${formatCurrency(summary.netSavings, currency)}</span></div>
        <div class="stat-row"><span class="stat-row-label">${tr('Épargne nette mensuelle après mensualité')}</span><span class="badge ${newNetSavings >= 0 ? 'badge-pos' : 'badge-neg'}">${formatCurrency(newNetSavings, currency)}</span></div>
        ${newNetSavings < 0 ? `<div class="alert alert-danger mt-8">${tr('Cette mensualité dépasserait votre épargne nette actuelle : vos dépenses excéderaient vos revenus.')}</div>` : ''}`;
    }
    el.querySelector('#pi-results').innerHTML = resultsHtml;
  }
  return {
    html,
    wire: () => {
      const el = document.getElementById('tool-purchase-impact');
      el.addEventListener('input', compute);
      el.addEventListener('change', compute);
      compute();
    },
  };
}

/* ---------- 4. Budgets par enveloppes (50/30/20 personnalisable) ---------- */
async function renderEnvelopeTool() {
  const summary = await computeMonthSummary(currentMonthKey());
  const income = Math.round(summary.income) || 0;

  const body = `
    <div class="filters-bar mb-14">
      <div class="form-row m-0"><label>${tr('Revenu mensuel ({currency})', { currency: escapeHtml(summary.currency) })}</label><input type="number" id="env-income" value="${income}" step="10"></div>
      <div class="form-row m-0"><label>${tr('% Besoins essentiels')}</label><input type="number" id="env-needs" value="50" step="1"></div>
      <div class="form-row m-0"><label>${tr('% Envies / loisirs')}</label><input type="number" id="env-wants" value="30" step="1"></div>
      <div class="form-row m-0"><label>${tr('% Épargne / dettes')}</label><input type="number" id="env-savings" value="20" step="1"></div>
    </div>
    <div id="env-results" class="grid-cards"></div>
    <p id="env-warning" class="alert alert-warn mt-10" style="display:none;">${tr('Les pourcentages ne totalisent pas 100%.')}</p>`;
  const html = panel(tr('Système de budgets par enveloppes (méthode 50/30/20)'), body, 'tool-envelope');

  function compute() {
    const el = document.getElementById('tool-envelope');
    if (!el) return;
    const income2 = parseFloat(el.querySelector('#env-income').value) || 0;
    const needsPct = parseFloat(el.querySelector('#env-needs').value) || 0;
    const wantsPct = parseFloat(el.querySelector('#env-wants').value) || 0;
    const savingsPct = parseFloat(el.querySelector('#env-savings').value) || 0;
    const totalPct = needsPct + wantsPct + savingsPct;
    el.querySelector('#env-warning').style.display = Math.abs(totalPct - 100) > 0.5 ? 'block' : 'none';

    const rows = [
      { label: tr('Besoins essentiels'), pct: needsPct },
      { label: tr('Envies / loisirs'), pct: wantsPct },
      { label: tr('Épargne / remboursement dettes'), pct: savingsPct },
    ];
    el.querySelector('#env-results').innerHTML = rows.map((r) => `
      <div class="summary-card">
        <div class="summary-card-label">${r.label} (${r.pct}%)</div>
        <div class="summary-card-value">${formatCurrency(income2 * r.pct / 100, summary.currency)}</div>
      </div>`).join('');
  }
  return { html, wire: () => { document.getElementById('tool-envelope').addEventListener('input', compute); compute(); } };
}

/* ---------- 5. Détection des abonnements récurrents non déclarés ---------- */
async function renderSubscriptionsTool() {
  const { candidates, totalMonthly, currency } = await detectRecurringCandidates();
  const body = candidates.length
    ? `<p class="fs-13 c-muted mb-10">${tr('Détectés par similarité de note + montant sur au moins 2 mois distincts — vérifiez avant de les déclarer en Récurrences (Budgets &gt; Récurrences) pour un suivi précis.')}</p>
       ${candidates.map((c) => `<div class="stat-row"><span class="stat-row-label">${escapeHtml(c.note)} <span class="badge ml-6">${tr('{n} mois', { n: c.occurrences })}</span></span><span>${tr('{amount}/mois', { amount: formatCurrency(c.avgAmount, currency) })}</span></div>`).join('')}
       <div class="stat-row mt-6 fw-700" style="border-top:2px solid var(--border);padding-top:10px;"><span class="stat-row-label">${tr('Total mensuel estimé')}</span><span>${formatCurrency(totalMonthly, currency)}</span></div>`
    : `<div class="empty-state">${tr('Aucun abonnement non déclaré détecté pour le moment.')}</div>`;
  const html = panel(tr('Abonnements & paiements récurrents détectés'), body);
  return { html, wire: () => {} };
}

/* ---------- 6. Analyse des habitudes & détection d'anomalies ---------- */
async function renderAnomalyTool() {
  const [wallets, transactions] = await Promise.all([dbGetAll(STORES.WALLETS), dbGetAll(STORES.TRANSACTIONS)]);
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const { rates, baseCurrency } = await getExchangeRatesSafe();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = localISODate(cutoff);

  const dailyTotals = new Map();
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.date || t.date < cutoffStr) continue;
    const amt = convertAmount(t.amount, walletCurrency[t.walletId] || baseCurrency, baseCurrency, rates, baseCurrency);
    dailyTotals.set(t.date, (dailyTotals.get(t.date) || 0) + amt);
  }

  const values = [...dailyTotals.values()];
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const variance = values.length ? values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length : 0;
  const stdev = Math.sqrt(variance);
  const threshold = mean + 2 * stdev;

  const anomalies = [...dailyTotals.entries()]
    .filter(([, v]) => v > threshold && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const body = anomalies.length
    ? anomalies.map(([date, v]) => {
      const pctAbove = mean ? ((v - mean) / mean) * 100 : 0;
      return `<div class="stat-row"><span class="stat-row-label">${date}</span><span>${formatCurrency(v, baseCurrency)} <span class="badge badge-neg">${tr('+{pct}% vs moyenne', { pct: pctAbove.toFixed(0) })}</span></span></div>`;
    }).join('')
    : `<div class="empty-state">${tr('Aucune anomalie détectée sur les 90 derniers jours.')}</div>`;

  const html = panel(tr("Analyse des habitudes & détection d'anomalies (90 derniers jours)"),
    `<p class="fs-13 c-muted mb-10">${tr('Moyenne journalière : {mean} · Écart-type : {stdev}. Un jour est signalé si ses dépenses dépassent la moyenne + 2 écarts-types.', { mean: formatCurrency(mean, baseCurrency), stdev: formatCurrency(stdev, baseCurrency) })}</p>${body}`);
  return { html, wire: () => {} };
}

async function getExchangeRatesSafe() {
  const baseCurrency = await getSetting('baseCurrency', 'EUR');
  const rates = await dbGetAll(STORES.EXCHANGE_RATES);
  return { rates, baseCurrency };
}

/* ---------- 7. Journal d'audit ---------- */
function formatDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(d);
}
// Valeurs traduites à l'usage via tr(...), pas à la déclaration — mêmes conventions que
// ASSET_CLASSES/ENTRY_TYPE_LABELS (investments.js) : les clés (create/update/delete) sont les
// valeurs stockées en base (logAudit action), jamais traduites.
const ACTION_LABELS = { create: 'Création', update: 'Modification', delete: 'Suppression' };

async function renderAuditLogTool() {
  const rows = (await dbGetAll(STORES.AUDIT_LOG)).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 150);
  const body = rows.length
    ? `<div style="max-height:420px;overflow-y:auto;">${rows.map((r) => `
        <div class="stat-row">
          <span class="stat-row-label">${formatDateTime(r.timestamp)} · ${escapeHtml(r.entityType)}</span>
          <span class="badge ${r.action === 'delete' ? 'badge-neg' : r.action === 'create' ? 'badge-pos' : 'badge-accent'}">${tr(ACTION_LABELS[r.action] || r.action)}${r.note ? ' — ' + escapeHtml(r.note) : ''}</span>
        </div>`).join('')}</div>`
    : `<div class="empty-state">${tr('Aucune activité enregistrée pour le moment.')}</div>`;
  const html = panel(tr("Journal d'audit (150 dernières actions)"), body);
  return { html, wire: () => {} };
}

/* ---------- Point d'entrée ---------- */
export async function renderTools() {
  const container = document.getElementById('tools-content');
  if (!container) return;
  container.innerHTML = `<div class="empty-state">${tr('Chargement des outils…')}</div>`;

  const tools = await Promise.all([
    renderWealthTrajectoryTool(),
    renderInflationTool(),
    renderEmergencyFundTool(),
    renderPurchaseImpactTool(),
    renderEnvelopeTool(),
    renderSubscriptionsTool(),
    renderAnomalyTool(),
    renderAuditLogTool(),
  ]);

  container.innerHTML = tools.map((tool) => tool.html).join('');
  tools.forEach((tool) => tool.wire());
}

export function initToolsModule() {
  // Rien à câbler statiquement : chaque outil se recalcule via ses propres écouteurs "input".
}
