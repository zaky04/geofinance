/* ==========================================================================
   GeoFinance System — Fonctions utilitaires partagées
   Formatage devises/dates, conversion multi-devises, helpers UI génériques.
   ========================================================================== */

// Aliasé en tr (pas t) : ce fichier utilise `t` comme nom de variable pour un timer dans debounce().
import { t as tr, getLanguage } from './i18n.js';
import { icon as svgIcon } from './icons.js';

export function uuid() {
  return crypto.randomUUID();
}

/** Locale Intl à utiliser pour les nombres/dates : dépend de la langue choisie (Paramètres), pas
    figée sur le français — un montant/une date doivent suivre la langue de l'interface, pas
    seulement les libellés autour. i18n.js ne réimporte rien de ce fichier (pas de cycle). */
export function intlLocale() {
  return getLanguage() === 'en' ? 'en-US' : 'fr-FR';
}

export const CURRENCIES = ['XOF', 'XAF', 'EUR', 'USD', 'GBP', 'CAD', 'CHF', 'MAD', 'NGN', 'GHS', 'CNY', 'JPY'];

/**
 * Sélecteur de devise fiable sur PC/Android/iOS. Un <input list="datalist">
 * a été utilisé initialement mais Safari iOS ignore largement <datalist>,
 * ce qui rendait le champ non modifiable dans les faits. Un <select> natif
 * fonctionne partout, avec une option "Autre" en repli pour un code libre.
 */
export function currencySelectHtml(selected = 'EUR', name = 'currency') {
  const codes = CURRENCIES.includes(selected) || !selected ? CURRENCIES : [selected, ...CURRENCIES];
  // escapeHtml() sur `c` : `selected` (donc potentiellement le code ajouté à `codes` ci-dessus) peut
  // venir d'une donnée stockée (wallet.currency, etc.) plutôt que de la saisie normale (bornée à 3
  // caractères par readCurrencyValue) — un import CSV/JSON ne passe PAS par cette contrainte et peut
  // injecter une valeur arbitraire dans currency. Sans échappement ici, cette valeur atterrirait telle
  // quelle dans un attribut HTML (value="...") la prochaine fois que ce portefeuille est modifié.
  return `
    <select name="${escapeHtml(name)}" data-currency-select>
      ${codes.map((c) => `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      <option value="__other__">${tr('Autre devise…')}</option>
    </select>
    <input type="text" name="${escapeHtml(name)}Other" maxlength="3" placeholder="${escapeHtml(tr('Code devise (ex: BRL)'))}" data-currency-other
      style="display:none;margin-top:8px;text-transform:uppercase;">`;
}

/** À appeler une fois le formulaire inséré dans le DOM pour activer le repli "Autre". */
export function wireCurrencySelect(root) {
  root.querySelectorAll('[data-currency-select]').forEach((select) => {
    const other = select.nextElementSibling;
    const sync = () => {
      const isOther = select.value === '__other__';
      other.style.display = isOther ? 'block' : 'none';
      other.required = isOther;
    };
    select.addEventListener('change', sync);
    sync();
  });
}

/** Lit la devise choisie dans un formulaire construit avec currencySelectHtml(). */
export function readCurrencyValue(form, name = 'currency') {
  const select = form.elements[name];
  if (select.value === '__other__') {
    return (form.elements[`${name}Other`]?.value || '').toUpperCase().slice(0, 3);
  }
  return select.value;
}

/** Convertit une Date en "YYYY-MM-DD" à partir de ses composantes LOCALES
 *  (jamais .toISOString(), qui convertit en UTC et peut faire dériver la
 *  date d'un jour selon le fuseau horaire de l'utilisateur). */
export function localISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO() {
  return localISODate();
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthKeyOffset(monthKey, offset) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return currentMonthKey(d);
}

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const months = getLanguage() === 'en' ? MONTHS_EN : MONTHS_FR;
  return `${months[m - 1]} ${y}`;
}

export function formatDate(dateStr, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!dateStr) return '';
  let d;
  if (typeof dateStr === 'string') {
    // "YYYY-MM-DD" doit être lu comme une date locale, pas minuit UTC
    // (sinon Intl peut afficher la veille selon le fuseau de l'utilisateur).
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);
  } else {
    d = dateStr;
  }
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(), options).format(d);
}

// Devises sans sous-unité usuelle (XOF/XAF : pas de centime en usage courant, JPY : pas de sen) —
// sans forcer 0 décimale explicitement, un montant non entier (ex: conversion de devise, partage
// entre participants) s'affichait avec des décimales ("1 234,5 F CFA") au lieu de la convention
// habituelle ("1 235 F CFA"). maximumFractionDigits seul ne suffit pas : Intl choisit le nombre MINIMUM
// de décimales à partir des sous-unités propres à la devise, qui vaut déjà 0 pour XOF/XAF/JPY —
// le problème n'est donc pas le minimum par défaut mais le maximum fixé à 2 pour toutes les devises
// sans distinction, qui laisse passer jusqu'à 2 décimales même quand la devise n'en a normalement pas.
const ZERO_DECIMAL_CURRENCIES = new Set(['XOF', 'XAF', 'JPY']);
const currencyFormatters = new Map();
export function formatCurrency(amount, currency = 'EUR') {
  const locale = intlLocale();
  const key = `${locale}:${currency}`; // la locale fait partie de la clé de cache, pas seulement la devise
  if (!currencyFormatters.has(key)) {
    const fractionDigits = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
    try {
      currencyFormatters.set(key, new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }));
    } catch {
      currencyFormatters.set(key, new Intl.NumberFormat(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }));
    }
  }
  const n = Number(amount) || 0;
  return currencyFormatters.get(key).format(n);
}

export function formatPercent(value, digits = 1) {
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Convertit en nombre fini, sinon `fallback`. Contrairement à l'idiome `Number(x) || 0` utilisé
    ailleurs dans le code, ceci rejette aussi Infinity/-Infinity (qui sont "truthy" et passent donc
    au travers de `|| 0` sans y être ramenés à 0) — utile aux frontières d'entrée non fiables
    (import CSV/JSON) où une valeur comme la chaîne "Infinity" doit être neutralisée plutôt que de
    se propager dans les calculs de ledger.js. */
export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function percentage(part, total) {
  if (!total) return 0;
  return clamp((part / total) * 100, 0, 999);
}

/** Classe CSS de progression budgétaire selon seuils 70% / 90%. */
export function budgetProgressClass(pct) {
  if (pct >= 90) return 'is-danger';
  if (pct >= 70) return 'is-warn';
  return '';
}

/**
 * Convertit un montant d'une devise à une autre.
 * `rates` est un tableau de lignes { code, rateToBase } où rateToBase = valeur
 * d'une unité de `code` exprimée dans la devise de base (ex: base=EUR,
 * USD.rateToBase=0.92 signifie 1 USD = 0.92 EUR).
 */
export function convertAmount(amount, fromCode, toCode, rates, baseCode = 'EUR') {
  if (fromCode === toCode) return amount;
  const rateMap = Object.fromEntries((rates || []).map((r) => [r.code, r.rateToBase]));
  const toBase = fromCode === baseCode ? amount : amount * (rateMap[fromCode] ?? 1);
  if (toCode === baseCode) return toBase;
  const rate = rateMap[toCode] ?? 1;
  return rate ? toBase / rate : toBase;
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Échappe le texte utilisateur avant insertion dans du innerHTML (protection XSS). */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Toast simple, auto-disparaissant. */
/** Toast simple, ou avec une action (ex: "Annuler") si actionLabel/onAction sont fournis. */
export function showToast(message, { duration = 3000, actionLabel = null, onAction = null } = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const textEl = document.createElement('span');
  textEl.textContent = message;
  el.appendChild(textEl);

  let timer;
  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      clearTimeout(timer);
      el.remove();
      onAction();
    });
    el.appendChild(btn);
    duration = Math.max(duration, 5000);
  }
  container.appendChild(el);
  timer = setTimeout(() => el.remove(), duration);
}

/** Déclenche le téléchargement d'un fichier texte/JSON/CSV généré côté client. */
export function downloadFile(filename, content, mimeType = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Réduit une photo (justificatif) : côté max `maxDim` px, JPEG qualité `quality`. Une photo
 * d'appareil fait 2 à 6 Mo ; un justificatif reste parfaitement lisible à ~150-300 Ko. Sans ça,
 * chaque photo gonfle la base ET toutes les sauvegardes (et jusqu'à 1,8× de plus à l'export, à
 * cause du double base64), jusqu'à bloquer la sauvegarde cloud.
 * Ne renvoie JAMAIS plus gros que l'original, et renvoie l'original tel quel au moindre doute
 * (pas une image, SVG, déjà petit, décodage ou canvas indisponible) — compresser ne doit jamais
 * faire perdre un justificatif.
 */
export async function compressImageBlob(blob, { maxDim = 1600, quality = 0.72, skipBelow = 250 * 1024 } = {}) {
  try {
    if (!(blob instanceof Blob) || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(blob.type) || blob.size <= skipBelow) return blob;
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG n'a pas de transparence
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    canvas.width = canvas.height = 0; // libère la mémoire du canvas tout de suite
    return out && out.size > 0 && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

/** Lit un fichier <input type="file"> comme texte. */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

const CLOSE_SVG = svgIcon('close', 18);

/**
 * Ouvre une modale générique dans #modal-root. Retourne { el, close }.
 * Fermeture via clic sur le fond, bouton "×" ou touche Échap.
 */
export function openModal(bodyHtml, { title = '', onClose = null } = {}) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      ${title ? `<div class="modal-header"><h3>${escapeHtml(title)}</h3><button type="button" class="icon-btn modal-close" aria-label="Fermer">${CLOSE_SVG}</button></div>` : ''}
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  root.appendChild(wrap);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.modal-close')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  return { el: wrap, close };
}

/** Boîte de confirmation stylée (remplace window.confirm). Résout un booléen. */
export function confirmDialog(message, { title, confirmText, cancelText, danger = false } = {}) {
  title = title ?? tr('Confirmation');
  confirmText = confirmText ?? tr('Confirmer');
  // Pas de tr('Annuler') ici : ce mot français sert déjà de clé pour le bouton "Annuler" des toasts
  // d'annulation (i18n.js), qui se traduit par 'Undo' — un sens différent de "Cancel" attendu ici.
  // Voir le commentaire sur la clé 'Annuler' dans i18n.js. Contournement direct par langue plutôt
  // que par une clé dictionnaire, même pattern que intlLocale() ci-dessus dans ce fichier.
  cancelText = cancelText ?? (getLanguage() === 'en' ? 'Cancel' : 'Annuler');
  return new Promise((resolve) => {
    let decided = false;
    const modal = openModal(`
      <p style="margin:0 0 18px;">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm">${escapeHtml(confirmText)}</button>
      </div>
    `, { title, onClose: () => { if (!decided) { decided = true; resolve(false); } } });
    modal.el.querySelector('[data-act="cancel"]').addEventListener('click', () => { decided = true; resolve(false); modal.close(); });
    modal.el.querySelector('[data-act="confirm"]').addEventListener('click', () => { decided = true; resolve(true); modal.close(); });
  });
}
