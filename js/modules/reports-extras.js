/* ==========================================================================
   GeoFinance System — Extensions du module Rapports
   Score de santé financière + vue calendrier des dépenses (heatmap).
   Séparé de reports.js pour ne pas alourdir la génération PDF.
   ========================================================================== */

import { computeFinancialHealthScore, computeDailySpending, getEnrichedTransactions } from '../ledger.js';
import { formatCurrency, formatPercent, formatDate, escapeHtml, localISODate } from '../utils.js';
// Aliasé en tr (pas t) : ce fichier utilise `t` comme nom de variable pour une transaction dans
// wireCalendarPanel() — même piège documenté dans dashboard.js/transactions.js/debts.js/tools.js.
import { t as tr, getLanguage } from '../i18n.js';

function scoreTier(score) {
  if (score >= 70) return { cls: 'pos', label: tr('Bonne santé financière') };
  if (score >= 40) return { cls: 'warn', label: tr('À surveiller') };
  return { cls: 'neg', label: tr('Fragile') };
}

export async function healthScorePanelHtml(monthKey) {
  const health = await computeFinancialHealthScore(monthKey);
  const tier = scoreTier(health.score);
  return `
    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><h3>${tr('Score de santé financière')}</h3></div>
      <div style="display:flex;align-items:center;gap:18px;margin-bottom:14px;">
        <div style="width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:24px;font-weight:800;color:#fff;background:${tier.cls === 'pos' ? 'var(--pos)' : tier.cls === 'warn' ? '#f59e0b' : 'var(--neg)'};">${health.score}</div>
        <div>
          <div style="font-weight:700;font-size:15px;">${escapeHtml(tier.label)}</div>
          <div style="font-size:12.5px;color:var(--text-muted);">${tr('Indicateur composite indicatif, pas un conseil personnalisé.')}</div>
        </div>
      </div>
      <div class="stat-row"><span class="stat-row-label">${tr("Taux d'épargne (mois)")}</span><span>${formatPercent(health.savingsRate * 100, 0)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${tr("Ratio d'endettement")}</span><span>${formatPercent(health.debtRatio * 100, 0)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${tr('Respect du budget')}</span><span>${formatPercent(health.budgetAdherencePct, 0)}</span></div>
    </div>`;
}

// Initiales des jours de la semaine (lundi → dimanche) : un tableau complet par langue plutôt qu'un
// t() par lettre — le français a deux "M" (Mardi/Mercredi) à des positions différentes, une clé de
// traduction par lettre unique ne pourrait pas les distinguer.
const WEEKDAY_LABELS_FR = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const WEEKDAY_LABELS_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
function weekdayLabels() {
  return getLanguage() === 'en' ? WEEKDAY_LABELS_EN : WEEKDAY_LABELS_FR;
}

export async function calendarPanelHtml(monthKey) {
  const { totals, currency } = await computeDailySpending(monthKey);
  const max = Math.max(0, ...totals.values());
  const [y, m] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lundi = 0

  let cells = '';
  for (let i = 0; i < firstWeekday; i++) cells += '<div></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
    const amount = totals.get(dateStr) || 0;
    const intensity = max > 0 ? amount / max : 0;
    const bg = amount > 0 ? `color-mix(in srgb, var(--neg) ${Math.round(10 + intensity * 80)}%, var(--surface-alt))` : 'var(--surface-alt)';
    cells += `
      <button type="button" class="calendar-day" data-date="${dateStr}" style="background:${bg};" title="${tr('{date} : {amount}', { date: formatDate(dateStr), amount: formatCurrency(amount, currency) })}">
        <span class="calendar-day-num">${day}</span>
        ${amount > 0 ? `<span class="calendar-day-amount">${Math.round(amount)}</span>` : ''}
      </button>`;
  }

  return `
    <div class="panel" style="margin-top:16px;" id="calendar-panel">
      <div class="panel-header"><h3>${tr('Calendrier des dépenses')}</h3></div>
      <div class="calendar-grid calendar-grid-head">
        ${weekdayLabels().map((d) => `<div class="calendar-weekday">${d}</div>`).join('')}
      </div>
      <div class="calendar-grid">${cells}</div>
      <div id="calendar-day-detail" style="margin-top:12px;"></div>
    </div>`;
}

export function wireCalendarPanel(container, monthKey) {
  const panel = container.querySelector('#calendar-panel');
  if (!panel) return;
  const detail = panel.querySelector('#calendar-day-detail');
  panel.querySelectorAll('.calendar-day').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const date = btn.dataset.date;
      panel.querySelectorAll('.calendar-day').forEach((b) => b.classList.toggle('is-selected', b === btn));
      // Même filtre que computeDailySpending() (ledger.js), qui a produit le total/l'intensité de
      // cette case : sans ça, un remboursement de dette apparaissait dans le détail du jour comme
      // une dépense ordinaire, alors qu'il n'a jamais compté dans le total affiché sur la case
      // elle-même — la liste ne correspondait plus au chiffre du dessus.
      const rows = (await getEnrichedTransactions({ monthKey })).filter((t) => t.date === date && t.type === 'expense' && !t.debtId);
      detail.innerHTML = rows.length
        ? `<div class="tx-sub" style="margin-bottom:6px;">${formatDate(date)}</div>` + rows.map((t) => `
            <div class="tx-row">
              <div class="tx-main">
                <div class="tx-title">${escapeHtml(t.category?.name || tr('Sans catégorie'))}</div>
                <div class="tx-sub">${escapeHtml(t.wallet?.name || '')}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
              </div>
              <div class="tx-amount amount neg">−${formatCurrency(t.amount, t.wallet?.currency || 'EUR')}</div>
            </div>`).join('')
        : `<div class="tx-empty">${tr('Aucune dépense le {date}.', { date: formatDate(date) })}</div>`;
    });
  });
}
