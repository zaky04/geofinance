/* ==========================================================================
   GeoFinance — Mode « application »
   Quand l'app est lancée depuis un raccourci écran d'accueil (PWA installée) ou depuis un APK/EXE
   embarqué, elle doit se comporter comme une application et non comme une page web : pas de zoom
   au pincement ni au double-tap, pas de sélection de texte ni de menu contextuel au toucher long,
   pas de « tirer pour rafraîchir » ni de rebond de défilement. Dans un navigateur normal, RIEN ne
   change : le zoom reste disponible (accessibilité) pour qui consulte l'app comme un site.
   Importé en tout premier par app.js, avant tout rendu, pour éviter un flash du comportement « web ».
   Les règles CSS associées vivent sous la classe .is-app (voir styles.css, fin de fichier).
   ========================================================================== */

function detectAppMode() {
  const mq = (q) => { try { return window.matchMedia(q).matches; } catch { return false; } };
  const installedPwa = mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || mq('(display-mode: minimal-ui)')
    || window.navigator.standalone === true; // iOS Safari (« Ajouter à l'écran d'accueil »)
  // Builds natifs : Capacitor (APK) et Tauri (Windows) chargent les fichiers embarqués dans une WebView.
  const nativeShell = !!(window.Capacitor?.isNativePlatform?.() || window.__TAURI__);
  return installedPwa || nativeShell;
}

if (detectAppMode()) {
  document.documentElement.classList.add('is-app');

  // Zoom : Android/Chrome respecte le viewport ; iOS l'ignore, d'où les événements gesture* ci-dessous.
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  });

  // Toucher long = menu « copier / ouvrir dans un nouvel onglet… » : typique d'une page web. On le
  // supprime au toucher (jamais à la souris : sur ordinateur, le clic droit reste utile) sauf dans
  // un champ de saisie, où il sert à coller.
  document.addEventListener('contextmenu', (e) => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"], .selectable')) return;
    e.preventDefault();
  });
}
