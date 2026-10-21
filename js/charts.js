/* ==========================================================================
   GeoFinance System — Wrappers Chart.js
   Chart.js est chargé en global (vendor/chart.min.js, <script defer>) avant
   ce module. Les instances sont mises en registre pour être détruites avant
   chaque re-rendu (évite les fuites mémoire lors des changements de vue).

   Parti pris graphique : une couleur d'accent (le bleu du logo) + du gris, et la couleur
   n'apparaît ailleurs que pour dire quelque chose (rouge = dépassement / perte). Courbes
   droites (pas de lissage qui invente des valeurs entre deux mois), sans aire remplie ni points
   sauf le dernier, axes en notation compacte (120 k), valeurs écrites au bout des barres plutôt
   que dans une légende à décoder.
   ========================================================================== */

import { formatCurrency, intlLocale } from './utils.js';
import { t } from './i18n.js';

const registry = new Map();

// Palette sobre pour les choix de couleur de catégories, tirée du logo (bleu, vert cauri, or) + terres.
export const PALETTE = ['#1f5fa6', '#2d8a7a', '#c9a24a', '#b3382c', '#6a5f9e', '#7b8794', '#4f8a3c', '#b9663a'];

// Le thème sombre est posé sur <body> (data-theme), pas sur <html> : lire <body> d'abord, sinon on retombe
// sur les valeurs claires de :root même en sombre (grilles et rails trop clairs).
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function baseColors() {
  return {
    text: cssVar('--text') || '#1a1b24',
    muted: cssVar('--text-muted') || '#5d5c66',
    faint: cssVar('--text-faint') || '#75737c',
    border: cssVar('--border') || '#dfdbcf',
    track: cssVar('--surface-alt') || '#efece3',
    bg: cssVar('--bg') || '#f4f2ec',
    accent: cssVar('--accent') || '#1f5fa6',
    onAccent: cssVar('--on-accent') || '#ffffff',
    pos: cssVar('--pos') || '#1b7f4d',
    neg: cssVar('--neg') || '#b3382c',
  };
}

function destroy(canvasId) {
  const existing = registry.get(canvasId);
  if (existing) { existing.destroy(); registry.delete(canvasId); }
}

function ensureChartLib() {
  if (typeof window.Chart === 'undefined') {
    console.error('[charts] Chart.js non chargé (vendor/chart.min.js manquant ?)');
    return false;
  }
  return true;
}

/** Réglages communs, relus à chaque rendu : le thème (clair/sombre) peut avoir changé entre-temps. */
function applyDefaults(colors) {
  const d = window.Chart.defaults;
  d.font.family = getComputedStyle(document.body).fontFamily;
  d.font.size = 11;
  d.color = colors.faint;
  d.animation = { duration: 300 };
  const tip = d.plugins.tooltip;
  tip.backgroundColor = colors.text;
  tip.titleColor = colors.bg;
  tip.bodyColor = colors.bg;
  tip.cornerRadius = 4;
  tip.padding = 8;
  tip.displayColors = false;
}

/** 120 000 → « 120 k », 1 200 000 → « 1,2 M » (selon la langue) : lisible sur un axe, sans répéter la devise. */
function compact(v) {
  return new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

function xAxis(colors) {
  return { border: { color: colors.border }, grid: { display: false }, ticks: { color: colors.faint, maxRotation: 0, autoSkip: true } };
}

function yAxis(colors, format, extra = {}) {
  return {
    border: { display: false },
    grid: { color: colors.border, drawTicks: false },
    ticks: { color: colors.faint, padding: 8, maxTicksLimit: 5, callback: format },
    ...extra,
  };
}

/** Hauteur du cadre ajustée au nombre de lignes pour les graphiques à barres horizontales. */
function sizeWrap(canvas, rows, rowHeight) {
  const wrap = canvas.parentElement;
  if (wrap) wrap.style.height = `${Math.max(120, rows * rowHeight + 24)}px`;
}

/** Écrit une valeur au bout de chaque barre horizontale ; si elle ne tient pas à droite, elle passe à
    l'intérieur de la barre (option inside), à défaut collée au bord du cadre. */
const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.format) return;
    const { ctx, chartArea } = chart;
    const metas = chart.data.datasets.map((_, i) => chart.getDatasetMeta(i)).filter((m) => !m.hidden);
    if (!metas.length) return;
    ctx.save();
    ctx.font = `600 11px ${window.Chart.defaults.font.family}`;
    ctx.fillStyle = opts.color;
    ctx.textBaseline = 'middle';
    metas[0].data.forEach((bar, i) => {
      const text = opts.format(i);
      const anchor = Math.max(...metas.map((m) => (m.data[i] ? m.data[i].x : 0)));
      const w = ctx.measureText(text).width;
      if (anchor + 8 + w <= chartArea.right) { ctx.textAlign = 'left'; ctx.fillText(text, anchor + 8, bar.y); }
      else if (opts.inside && anchor - chartArea.left >= w + 16) {
        ctx.fillStyle = opts.insideColor; ctx.textAlign = 'right'; ctx.fillText(text, anchor - 8, bar.y); ctx.fillStyle = opts.color;
      } else { ctx.textAlign = 'right'; ctx.fillText(text, chartArea.right, bar.y); }
    });
    ctx.restore();
  },
};

/** Barres horizontales triées : répartition des dépenses par catégorie. rows = [{label, value, neg?}] */
export function renderExpensesByCategoryChart(canvasId, rows, currency = 'EUR') {
  if (!ensureChartLib()) return;
  destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const colors = baseColors();
  applyDefaults(colors);

  if (!rows || !rows.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const sorted = [...rows].sort((a, b) => b.value - a.value);
  sizeWrap(canvas, sorted.length, 30);
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map((r) => r.label),
      datasets: [{
        data: sorted.map((r) => r.value),
        backgroundColor: sorted.map((r) => (r.neg ? colors.neg : colors.accent)),
        borderRadius: 2,
        barPercentage: 0.62,
        categoryPercentage: 1,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${formatCurrency(ctx.parsed.x, currency)}` } },
        valueLabels: { color: colors.muted, inside: true, insideColor: colors.onAccent, format: (i) => formatCurrency(sorted[i].value, currency) },
      },
      scales: {
        x: { display: false, beginAtZero: true, grace: '42%' },
        y: { border: { display: false }, grid: { display: false }, ticks: { color: colors.text, font: { size: 12 }, padding: 6 } },
      },
    },
    plugins: [valueLabels],
  });
  registry.set(canvasId, chart);
}

/** Dernier point seul marqué : on lit la valeur actuelle, pas une guirlande de points. */
function lastPointRadius(data) {
  return data.map((_, i) => (i === data.length - 1 ? 3.5 : 0));
}

/** Courbe : évolution d'une valeur dans le temps. points = [{label, value}]. opts.beginAtZero : pour les
    totaux mensuels (dépenses, entrées), où un axe qui ne part pas de zéro exagérerait les écarts. */
export function renderNetWorthTrendChart(canvasId, points, currency = 'EUR', label = 'Valeur nette', opts = {}) {
  if (!ensureChartLib()) return;
  destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const colors = baseColors();
  applyDefaults(colors);
  const values = (points || []).map((p) => p.value);

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: (points || []).map((p) => p.label),
      datasets: [{
        label,
        data: values,
        borderColor: colors.accent,
        borderWidth: 2,
        tension: 0,
        fill: false,
        pointRadius: lastPointRadius(values),
        pointHoverRadius: 4,
        pointBackgroundColor: colors.accent,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${formatCurrency(ctx.parsed.y, currency)}` } },
      },
      scales: {
        x: xAxis(colors),
        y: yAxis(colors, (v) => compact(v), { beginAtZero: !!opts.beginAtZero }),
      },
    },
  });
  registry.set(canvasId, chart);
}

/** Courbe multi-séries (ex: comparaison année N vs N-1, ou réel vs budget).
    series = [{label, points: [{label, value}], dashed}] — toutes les séries partagent le même axe
    x (labels pris sur la première série). La première série est la principale (accent, trait plein) ;
    les suivantes passent en gris, en pointillés si `dashed`. */
export function renderMultiTrendChart(canvasId, series, currency = 'EUR') {
  if (!ensureChartLib()) return;
  destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const colors = baseColors();
  applyDefaults(colors);
  const palette = [colors.accent, colors.faint, ...PALETTE];

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: (series[0]?.points || []).map((p) => p.label),
      datasets: (series || []).map((s, i) => {
        const data = s.points.map((p) => p.value);
        return {
          label: s.label,
          data,
          borderColor: palette[i % palette.length],
          borderWidth: i === 0 ? 2 : 1.5,
          borderDash: s.dashed ? [5, 4] : [],
          tension: 0,
          fill: false,
          pointRadius: i === 0 ? lastPointRadius(data) : 0,
          pointHoverRadius: 4,
          pointBackgroundColor: palette[i % palette.length],
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: series.length > 1, position: 'top', align: 'end',
          labels: { color: colors.muted, boxWidth: 18, boxHeight: 2, usePointStyle: false, padding: 10, font: { size: 11 } },
        },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y, currency)}` } },
      },
      scales: {
        x: xAxis(colors),
        y: yAxis(colors, (v) => compact(v), { beginAtZero: true }),
      },
    },
  });
  registry.set(canvasId, chart);
}

/** Barres épargne nette mensuelle : vert si positif, rouge si négatif. points = [{label, value}].
    asPercent : les valeurs sont déjà des pourcentages (pas de formatCurrency, suffixe "%"). */
export function renderNetSavingsBarChart(canvasId, points, currency = 'EUR', asPercent = false) {
  if (!ensureChartLib()) return;
  destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const colors = baseColors();
  applyDefaults(colors);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: (points || []).map((p) => p.label),
      datasets: [{
        data: (points || []).map((p) => p.value),
        backgroundColor: (points || []).map((p) => (p.value >= 0 ? colors.pos : colors.neg)),
        borderRadius: 2,
        barPercentage: 0.7,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${asPercent ? ctx.parsed.y + '%' : formatCurrency(ctx.parsed.y, currency)}` } },
      },
      scales: {
        x: xAxis(colors),
        y: yAxis(colors, (v) => (asPercent ? `${v}%` : compact(v))),
      },
    },
  });
  registry.set(canvasId, chart);
}

/** Budget vs réel par catégorie, en « jauges » horizontales : le budget est le rail gris, le réel la barre
    pleine — rouge dès qu'elle dépasse le rail. rows = [{label, budget, actual}] */
export function renderBudgetVsActualChart(canvasId, rows, currency = 'EUR') {
  if (!ensureChartLib()) return;
  destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const colors = baseColors();
  applyDefaults(colors);
  const data = rows || [];
  sizeWrap(canvas, data.length, 38);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.map((r) => r.label),
      datasets: [
        {
          label: t('Budget'), data: data.map((r) => r.budget), backgroundColor: colors.border,
          borderRadius: 2, grouped: false, order: 2, barPercentage: 0.9, categoryPercentage: 0.8,
        },
        {
          label: t('Réel'), data: data.map((r) => r.actual),
          backgroundColor: data.map((r) => (r.actual > r.budget ? colors.neg : colors.accent)),
          borderRadius: 2, grouped: false, order: 1, barPercentage: 0.4, categoryPercentage: 0.8,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', align: 'end', labels: { color: colors.muted, boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.x, currency)}` } },
        valueLabels: { color: colors.muted, format: (i) => `${compact(data[i].actual)} / ${compact(data[i].budget)}` },
      },
      scales: {
        x: { display: false, beginAtZero: true, grace: '30%' },
        y: { border: { display: false }, grid: { display: false }, ticks: { color: colors.text, font: { size: 12 }, padding: 6 } },
      },
    },
    plugins: [valueLabels],
  });
  registry.set(canvasId, chart);
}

/** Détruit tous les graphiques enregistrés (ex: avant changement de thème global). */
export function destroyAllCharts() {
  registry.forEach((c) => c.destroy());
  registry.clear();
}
