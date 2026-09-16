/* ==========================================================================
   GeoFinance System — OCR local des justificatifs (Tesseract.js)
   100% local : le moteur, le cœur WASM et le modèle de reconnaissance
   français sont vendorisés dans vendor/ et précachés par le service worker.
   Aucun appel réseau externe n'est jamais effectué, y compris hors-ligne.
   ========================================================================== */

import { localISODate } from './utils.js';

let scriptLoadPromise = null;

function ensureTesseractScript() {
  if (window.Tesseract) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/tesseract.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Impossible de charger le moteur OCR (vendor/tesseract.min.js manquant)."));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

/** Repère le montant le plus probable dans un texte OCR de reçu : priorité aux
    nombres proches d'un mot-clé ("total", "montant"…), sinon le plus grand
    trouvé (le total est en général la plus grosse ligne d'un ticket). */
function parseAmountFromText(text) {
  const numberPattern = /(\d[\d ]{0,7}\d|\d)[.,](\d{2})(?!\d)/g;
  const candidates = [];
  let match;
  while ((match = numberPattern.exec(text))) {
    const value = parseFloat(`${match[1].replace(/\s/g, '')}.${match[2]}`);
    if (!(value > 0 && value < 1000000)) continue;
    const context = text.slice(Math.max(0, match.index - 20), match.index).toLowerCase();
    const isTotalContext = /total|montant|payer|somme|d[uû]/.test(context);
    candidates.push({ value, isTotalContext });
  }
  if (!candidates.length) return null;
  const pool = candidates.some((c) => c.isTotalContext) ? candidates.filter((c) => c.isTotalContext) : candidates;
  return pool.reduce((max, c) => (c.value > max.value ? c : max), pool[0]).value;
}

/** Repère le nom du commerçant : en général la toute première ligne exploitable d'un ticket
    (en-tête, souvent en majuscules) — on prend la première ligne parmi les 5 premières qui
    ressemble à un nom (majorité de lettres, pas juste des chiffres/symboles de mise en page)
    plutôt qu'à du bruit OCR. */
function parseMerchantFromText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    const letters = (line.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
    if (letters < 3 || line.length > 40) continue;
    if (letters / line.length < 0.5) continue;
    return line;
  }
  return null;
}

/** Repère une date JJ/MM/AAAA (ou JJ-MM-AAAA, JJ.MM.AAAA, année sur 2 chiffres) dans le texte —
    même convention JJ/MM que parseFlexibleDate (backup.js), pas MM/JJ. Rejette toute date hors
    d'une fenêtre plausible pour un ticket de caisse (futur, ou plus de 2 ans dans le passé) : un
    faux positif OCR (numéro de ticket/téléphone mal lu comme une date) tombe presque toujours
    hors de cette fenêtre, un vrai ticket est daté du jour même ou de très peu avant. */
function parseDateFromText(text) {
  const pattern = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
  const now = new Date();
  const earliest = new Date(now);
  earliest.setFullYear(now.getFullYear() - 2);
  let match;
  while ((match = pattern.exec(text))) {
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    let y = parseInt(match[3], 10);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (m < 1 || m > 12 || d < 1 || d > 31) continue;
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) continue;
    if (date > now || date < earliest) continue;
    return localISODate(date);
  }
  return null;
}

/** Extrait les infos probables d'une photo de justificatif (montant, commerçant, date) pour
    préremplir la saisie — chaque champ est null si rien de fiable n'est détecté, l'utilisateur
    reste toujours libre de corriger avant d'enregistrer. */
export async function extractReceiptDataFromImage(blob) {
  await ensureTesseractScript();
  // Résolus en URL absolues nous-mêmes : dans certaines versions bundlées de
  // Tesseract.js, la résolution interne des chemins relatifs ne s'applique
  // pas correctement à workerPath une fois passé au Worker (blob-wrapped),
  // ce qui fait échouer importScripts() avec une URL encore relative.
  const abs = (path) => new URL(path, window.location.href).href;
  const worker = await window.Tesseract.createWorker('fra', 1, {
    workerPath: abs('./vendor/tesseract-worker.min.js'),
    corePath: abs('./vendor/tesseract-core-lstm.js'),
    langPath: abs('./vendor/'),
    cacheMethod: 'none',
    gzip: true,
    // Un worker "blob-wrapped" (comportement par défaut) a pour self.location.href une URL
    // blob:, ce qui casse la résolution relative interne du fichier .wasm jumeau par le
    // glue Emscripten (corePath lui-même). En désactivant workerBlobURL, le Worker est créé
    // directement sur workerPath (même origine, donc pas de restriction cross-origin), et
    // self.location.href redevient l'URL réelle sous /vendor/.
    workerBlobURL: false,
  });
  try {
    const { data: { text } } = await worker.recognize(blob);
    return {
      amount: parseAmountFromText(text),
      merchant: parseMerchantFromText(text),
      date: parseDateFromText(text),
    };
  } finally {
    await worker.terminate();
  }
}
