/* ==========================================================================
   GeoFinance System — Panneaux repliables et états vides actionnables
   1. Paramètres (≈ 4 800 px sur mobile), Outils (≈ 3 300 px) et deux panneaux secondaires du tableau de bord
      deviennent des sections repliables : un clic sur le titre déplie ou replie. Sur écran étroit elles
      démarrent repliées (on voit la liste des sections d'un coup d'œil), sur grand écran dépliées. L'état
      choisi est retenu le temps de la session (ces vues se redessinent après chaque réglage).
   2. Un message « Aucun… » sur un écran qui a un bouton « + Nouveau… » en tête reçoit ce même bouton : plus
      d'impasse devant un écran vide. Le bouton d'en-tête est déclenché tel quel, aucune logique dupliquée.
   Un observateur applique les deux aux vues au fur et à mesure qu'elles se redessinent.
   ========================================================================== */

import { icon } from './icons.js';

/** Vues dont les panneaux se replient ; `only` restreint à certains panneaux. */
const COLLAPSIBLE = [
  { view: 'settings' },
  { view: 'tools' },
  { view: 'dashboard', only: ['panel-forecast', 'panel-recap'] },
];
/** Écrans où un état vide propose l'action principale de l'en-tête. */
const EMPTY_ACTION_VIEWS = new Set(['wallets', 'transactions', 'savings', 'investments', 'debts', 'shared', 'keptAccounts', 'tontines']);

const memory = new Map(); // « vue:titre » -> replié ?
const narrow = () => window.matchMedia('(max-width: 900px)').matches;

function makeCollapsible(panel, viewName) {
  if (panel.dataset.collapsible) return;
  const header = panel.querySelector(':scope > .panel-header');
  const title = header?.querySelector('h3');
  if (!header || !title) return;
  panel.dataset.collapsible = '1';
  const key = `${viewName}:${title.textContent.trim()}`;
  const collapsed = memory.has(key) ? memory.get(key) : narrow();
  panel.dataset.collapsed = String(collapsed);

  const chevron = document.createElement('span');
  chevron.className = 'panel-chevron';
  chevron.innerHTML = icon('chevron', 18);
  header.append(chevron);
  header.tabIndex = 0;
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', String(!collapsed));

  const toggle = () => {
    const next = panel.dataset.collapsed !== 'true';
    panel.dataset.collapsed = String(next);
    header.setAttribute('aria-expanded', String(!next));
    memory.set(key, next);
  };
  header.addEventListener('click', (e) => { if (!e.target.closest('button, select, input, a, .segmented')) toggle(); });
  header.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === header) { e.preventDefault(); toggle(); }
  });
}

function addEmptyAction(el) {
  if (el.dataset.actionReady || el.closest('.panel, .modal-card, .chart-card')) return;
  const view = el.closest('.view');
  if (!view || !EMPTY_ACTION_VIEWS.has(view.dataset.view)) return;
  if (!/^\s*(Aucun|Aucune|No )/.test(el.textContent)) return;
  const source = view.querySelector('.view-header .btn-primary');
  if (!source) return;
  el.dataset.actionReady = '1';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary empty-action';
  button.textContent = source.textContent.replace(/^\s*\+\s*/, '').trim();
  button.addEventListener('click', () => source.click());
  el.append(document.createElement('br'), button);
}

function scan(root) {
  if (root.nodeType !== 1) return;
  for (const { view, only } of COLLAPSIBLE) {
    const host = document.getElementById(`view-${view}`);
    if (!host || !(host.contains(root) || root.contains(host))) continue;
    const panels = [...host.querySelectorAll('.panel')].filter((p) => !only || only.includes(p.id));
    panels.forEach((p) => makeCollapsible(p, view));
  }
  const empties = root.matches?.('.empty-state, .tx-empty') ? [root] : [];
  root.querySelectorAll?.('.empty-state, .tx-empty').forEach((e) => empties.push(e));
  empties.forEach(addEmptyAction);
}

export function initPanels() {
  const host = document.getElementById('view-root') || document.body;
  scan(host);
  new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach(scan);
  }).observe(host, { childList: true, subtree: true });
}
