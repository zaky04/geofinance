/* ==========================================================================
   GeoFinance System — Actions des cartes : une action principale + un menu « ⋯ »
   Une carte (dette, investissement, compte gardé, objectif d'épargne…) pouvait aligner cinq petites icônes
   de 32 px, cryptiques et sous la taille tactile recommandée. Toute `.summary-card .card-actions` qui compte
   au moins trois icônes garde ici une seule action visible (la plus fréquente) ; les autres passent dans un
   menu avec leur libellé. Les boutons sont DÉPLACÉS, pas recréés : leurs écouteurs et leurs `data-action`
   continuent donc de marcher tels quels, quel que soit le module qui les a dessinés. Un observateur traite
   les cartes au fur et à mesure que les vues se redessinent.
   ========================================================================== */

import { icon } from './icons.js';
import { t } from './i18n.js';

/** Ordre de préférence de l'action restée visible, et son libellé court (une icône seule ne dit pas ce qu'elle fait). */
const PRIMARY_ACTIONS = ['pay', 'history', 'edit'];
const PRIMARY_LABELS = { pay: 'Rembourser', history: 'Historique', edit: 'Modifier' };

function closeAllMenus(except) {
  document.querySelectorAll('.card-menu:not([hidden])').forEach((m) => {
    if (m === except) return;
    m.hidden = true;
    m.parentElement?.querySelector('.card-menu-toggle')?.setAttribute('aria-expanded', 'false');
  });
}

function enhance(box) {
  if (box.dataset.menuReady || !box.closest('.summary-card')) return;
  const buttons = [...box.querySelectorAll(':scope > .icon-btn')];
  if (buttons.length < 3) return;
  box.dataset.menuReady = '1';

  const primary = PRIMARY_ACTIONS.map((a) => buttons.find((b) => b.dataset.action === a)).find(Boolean) || buttons[0];
  const rest = buttons.filter((b) => b !== primary);
  if (PRIMARY_LABELS[primary.dataset.action]) {
    primary.classList.add('card-primary');
    const label = document.createElement('span');
    label.textContent = t(PRIMARY_LABELS[primary.dataset.action]);
    primary.append(label);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'icon-btn card-menu-toggle';
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', t("Plus d'actions"));
  toggle.title = t("Plus d'actions");
  toggle.innerHTML = icon('more', 18);

  const menu = document.createElement('div');
  menu.className = 'card-menu';
  menu.hidden = true;
  for (const b of rest) {
    b.classList.add('card-menu-item');
    const label = document.createElement('span');
    label.textContent = b.getAttribute('aria-label') || b.title || '';
    b.append(label);
    if (b.dataset.action === 'delete') b.classList.add('is-danger');
    menu.append(b);
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllMenus(menu);
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  });
  // Un choix dans le menu le referme (le clic continue ensuite vers le gestionnaire du module).
  menu.addEventListener('click', () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); });
  box.append(toggle, menu);
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.('.card-actions')) enhance(root);
  root.querySelectorAll?.('.card-actions').forEach(enhance);
}

export function initCardActions() {
  const host = document.getElementById('view-root') || document.body;
  scan(host);
  new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach(scan);
  }).observe(host, { childList: true, subtree: true });
  document.addEventListener('click', () => closeAllMenus());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllMenus(); });
}
