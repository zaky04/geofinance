/* ==========================================================================
   GeoFinance System — Jeu d'icônes
   Toutes les icônes de l'app, dessinées à la main dans une même grille (24 px, trait de 1,7 px, bouts
   arrondis, aucun aplat). Une icône par section (le bouclier ne sert plus à la fois à l'Épargne et aux
   Dettes) et une icône propre à chaque catégorie. `icon(nom, taille)` renvoie le <svg> prêt à insérer ;
   la couleur suit `currentColor`, donc le thème et l'état actif du menu.
   ========================================================================== */

import { t } from './i18n.js';

export const ICON_PATHS = {
  // ---------- Sections (menu latéral, barre du bas) ----------
  dashboard: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/>',
  wallet: '<rect x="3.5" y="7" width="17" height="12.5" rx="2.5"/><path d="M6.5 7V6a2 2 0 0 1 2-2H17"/><path d="M20.5 12h-4a2 2 0 0 0 0 4h4"/><circle cx="16.8" cy="14" r=".7" fill="currentColor"/>',
  swap: '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/>',
  pie: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>',
  jar: '<path d="M8 3.5h8M7 6.5h10"/><path d="M7.5 6.5C5.5 8 5 10 5 12.5 5 17 7.5 20.5 12 20.5s7-3.5 7-8c0-2.5-.5-4.5-2.5-6"/><circle cx="12" cy="13.5" r="2.6"/>',
  chart: '<path d="M3.5 19.5h17"/><path d="M5 15l4.5-4.5 3.5 3.5L19 8"/><path d="M15 8h4v4"/>',
  ledger: '<path d="M6 3.5h12.5v14H6.5A1.5 1.5 0 0 0 5 19V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M5 19a1.5 1.5 0 0 0 1.5 1.5h12v-3"/><path d="M9 8h6.5M9 11.5h6.5"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z"/>',
  report: '<path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5Z"/><path d="M14 3.5V8h4"/><path d="M9 17v-3M12 17v-5M15 17v-2"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.5-3 2.7-5 5.5-5s5 2 5.5 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16 14.2c2.5-.3 4.3 1.3 4.8 4.3"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M18 12v3M15 12v2"/>',
  circle: '<circle cx="12" cy="5" r="2"/><circle cx="5.5" cy="16.5" r="2"/><circle cx="18.5" cy="16.5" r="2"/><path d="M10.9 6.8 6.6 14.7M13.1 6.8l4.3 7.9M8 17.5h8"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',

  // ---------- Barre du haut et commandes ----------
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M3.5 3.5l17 17"/><path d="M10.2 5.7c.6-.1 1.2-.2 1.8-.2 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.6M6.6 7.5C4 9.3 2.5 12 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.3 4-.9"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  backspace: '<path d="M20 5H9.5L3.5 12l6 7H20a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m12.5 9.5 5 5m0-5-5 5"/>',
  fingerprint: '<path d="M6 10a6 6 0 0 1 12 0v1"/><path d="M12 7.5A2.5 2.5 0 0 0 9.5 10c0 3-.5 5.5-1.8 8M12 10v1.5c0 3-.6 5.6-2 8"/><path d="M14.5 10v1c0 2.6-.4 5-1.4 7.2M17.5 12.5c0 2.2-.3 4.2-1 6M6.5 13c0 1.6-.2 3-.6 4.2"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  message: '<path d="M4.5 5h15a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H9l-4.5 3.5V6a1 1 0 0 1 1-1Z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  share: '<path d="M12 15V4M8 7.5 12 3.5l4 4"/><path d="M5.5 11.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7.5"/>',
  print: '<path d="M7 9V4h10v5"/><path d="M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2"/><rect x="7" y="14" width="10" height="6"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
  emptyCircle: '<circle cx="12" cy="12" r="8.5"/>',

  // ---------- Actions sur les cartes et les lignes ----------
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3Z"/><path d="m14.5 7.5 3 3"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 13h4"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7.5 5v14l11-7-11-7Z"/>',
  receipt: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17Z"/><path d="M9 8.5h6M9 12h6"/>',
  repay: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4.5l3 2"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.6 3.4-5.5 7-5.5s6.3 1.9 7 5.5"/>',
  pay: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M3 10.5h18M7 14.5h3"/>',

  // ---------- Types de portefeuille ----------
  bank: '<path d="M3.5 9.5 12 4l8.5 5.5"/><path d="M5 20h14M6.5 10.5V17M10 10.5V17M14 10.5V17M17.5 10.5V17"/>',
  phone: '<rect x="6.5" y="3" width="11" height="18" rx="2"/><path d="M11 18h2"/>',
  banknote: '<rect x="3" y="6.5" width="18" height="11" rx="1.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>',

  // ---------- Catégories ----------
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.3 7.3a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0L3.8 12.9a1 1 0 0 1-.3-.7Z"/><circle cx="8.2" cy="8.2" r="1.3"/>',
  cart: '<path d="M3 4h2.4l2.1 11h10.2l2-8H6.3"/><circle cx="9" cy="19.2" r="1.3"/><circle cx="17" cy="19.2" r="1.3"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  car: '<path d="M5.5 13l1.4-4.6a1.5 1.5 0 0 1 1.4-1.1h7.4a1.5 1.5 0 0 1 1.4 1.1l1.4 4.6"/><rect x="3.5" y="13" width="17" height="4.5" rx="1.2"/><circle cx="7.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="17.5" r="1.4"/>',
  health: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
  food: '<path d="M5 3.5v5a2 2 0 0 0 4 0v-5M7 10.5v10"/><path d="M16.5 20.5v-17c-2 1-3.5 3.8-3.5 7 0 1.5 1 2.5 3.5 2.5"/>',
  travel: '<path d="M20.5 4 3.5 10.5l6.5 2.5 3 6.5L20.5 4Z"/><path d="m10 13 4.5-4.5"/>',
  education: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z"/><path d="M6.5 11.2v4.3c0 1.2 2.5 2.8 5.5 2.8s5.5-1.6 5.5-2.8v-4.3"/><path d="M21.5 9v5"/>',
  fun: '<path d="M3.5 7.5h17V10a2 2 0 0 0 0 4v2.5h-17V14a2 2 0 0 0 0-4V7.5Z"/><path d="M14.5 7.5v9" stroke-dasharray="1.5 2"/>',
  salary: '<rect x="3" y="6.5" width="18" height="11" rx="1.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>',
  coins: '<circle cx="9" cy="9" r="5.5"/><path d="M14 14.5a5.5 5.5 0 1 0 5.4-5.5"/>',
  gift: '<rect x="3.5" y="9" width="17" height="4" rx="1"/><path d="M5 13v7h14v-7M12 9v11"/><path d="M12 9c-2.7 0-4.5-1-4.5-2.7S9 3.8 10.4 5C11.3 5.8 12 7.5 12 9Zm0 0c2.7 0 4.5-1 4.5-2.7S15 3.8 13.6 5C12.7 5.8 12 7.5 12 9Z"/>',
  repeat: '<path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H19M16 4l3 3-3 3"/><path d="M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5M8 20l-3-3 3-3"/>',
  bolt: '<path d="M13 3 5.5 13.5H11L10 21l8.5-11H13V3Z"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.8Z"/>',
};

/** <svg> d'une icône du jeu (inconnue : étiquette). Trait en `currentColor`, pas d'aplat. */
export function icon(name, size = 20) {
  const inner = ICON_PATHS[name] || ICON_PATHS.tag;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Icônes proposées dans le formulaire de catégorie (ordre d'affichage). */
export const CATEGORY_ICON_KEYS = ['tag', 'cart', 'food', 'home', 'bolt', 'car', 'health', 'travel', 'education', 'fun', 'repeat', 'phone', 'gift', 'salary', 'coins'];

/** Apparence des catégories par défaut (nom français canonique → icône + couleur). Sert à la création et,
    pour les catégories déjà en base sans icône, d'apparence de repli à l'affichage (rien n'est réécrit). */
export const DEFAULT_CATEGORY_LOOK = {
  'Salaire': { icon: 'salary', color: '#2d8a7a' },
  'Autres revenus': { icon: 'coins', color: '#4f8a3c' },
  'Alimentation': { icon: 'food', color: '#b9663a' },
  'Logement': { icon: 'home', color: '#1f5fa6' },
  'Transport': { icon: 'car', color: '#6a5f9e' },
  'Loisirs': { icon: 'fun', color: '#c9a24a' },
  'Santé': { icon: 'health', color: '#b3382c' },
  'Abonnements': { icon: 'repeat', color: '#6a5f9e' },
  'Autres dépenses': { icon: 'tag', color: '#7b8794' },
};

const DEFAULT_ACCENT = '#1f5fa6';

/** Icône et couleur d'une catégorie SI elle en a une (choisie à la main, ou catégorie par défaut reconnue par son nom,
    en français ou traduit) ; sinon null — l'appelant garde alors son repli (ex. la flèche entrée/sortie d'une ligne). */
export function knownCategoryLook(cat) {
  if (!cat) return null;
  const byName = Object.entries(DEFAULT_CATEGORY_LOOK).find(([fr]) => cat.name === fr || cat.name === t(fr));
  const hasIcon = CATEGORY_ICON_KEYS.includes(cat.icon);
  if (!hasIcon && !byName) return null;
  return { icon: hasIcon ? cat.icon : byName[1].icon, color: cat.color || (byName ? byName[1].color : DEFAULT_ACCENT) };
}

/** Comme knownCategoryLook, avec l'étiquette bleue en repli. */
export function categoryLook(cat) {
  return knownCategoryLook(cat) || { icon: 'tag', color: (cat && cat.color) || DEFAULT_ACCENT };
}
