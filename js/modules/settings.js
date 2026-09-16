/* ==========================================================================
   GeoFinance System — Module Paramètres
   Sécurité (PIN/biométrie), devise de base, sauvegarde/restauration
   (JSON, JSON chiffré, CSV), remise à zéro complète.
   ========================================================================== */

import { STORES, dbGetAll, dbBulkPut, getSetting, setSetting, wipeAllData } from '../db.js';
import { changePin, isBiometricAvailable, isBiometricConfigured, registerBiometric, removeBiometric } from '../auth.js';
import {
  exportJsonBackup, importJsonBackup, exportEncryptedBackup, importEncryptedBackup,
  analyzeTransactionsCsv, importGeoFinanceCsvRows, importGenericCsvRows, exportTransactionsCsv,
  isFileSystemAccessSupported, chooseAutoBackupDirectory, getAutoBackupDirectory, clearAutoBackupDirectory,
} from '../backup.js';
import { isNotificationSupported, getNotificationPermission, requestNotificationPermission, checkAndNotify } from '../notifications.js';
import { renderCloudBackupSection } from '../firebase-sync.js';
import { isStandalone, isIOS, isSafari, isAndroid, hasDeferredPrompt, triggerInstall, resetInstallPromptSnooze } from '../install-prompt.js';
import { DASHBOARD_PANEL_DEFAULTS, BUDGET_ALERT_THRESHOLD_DEFAULTS } from './dashboard.js';
import { escapeHtml, formatDate, CURRENCIES, openModal, confirmDialog, showToast } from '../utils.js';
import { notifyDataChanged } from '../state.js';
import { t, getLanguage, setLanguage } from '../i18n.js';

function hiddenFileInput(accept, onFile) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.display = 'none';
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
  document.body.appendChild(input);
  return input;
}

function openCsvMappingModal(analysis) {
  const { headerCells, rows } = analysis;
  const colOptions = headerCells.map((h, i) => `<option value="${i}">${t('{col} (colonne {n})', { col: escapeHtml(h), n: i + 1 })}</option>`).join('');

  const modal = openModal(`
    <form id="csv-mapping-form">
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">${t("Ce fichier ne correspond pas au format d'export GeoFinance. Indiquez à quoi correspond chaque colonne pour l'importer quand même ({count} ligne(s) détectée(s)).", { count: rows.length })}</p>
      <div class="form-row"><label>${t('Portefeuille de destination')}</label><select name="walletId" id="csv-map-wallet" required></select></div>
      <div class="form-row"><label>${t('Colonne Date')}</label><select name="dateCol">${colOptions}</select></div>
      <div class="form-row"><label>${t('Colonne Description / libellé (optionnel)')}</label><select name="noteCol"><option value="">${t('Aucune')}</option>${colOptions}</select></div>
      <div class="form-row"><label>${t('Format du montant')}</label>
        <select name="amountMode" id="csv-map-amount-mode">
          <option value="single">${t('Une seule colonne (montant signé : + recette / − dépense)')}</option>
          <option value="debitCredit">${t('Deux colonnes séparées (Débit / Crédit)')}</option>
        </select>
      </div>
      <div id="csv-map-single-fields">
        <div class="form-row"><label>${t('Colonne Montant')}</label><select name="amountCol">${colOptions}</select></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px;"><input type="checkbox" name="invertSign"> ${t('Inverser le signe (si les dépenses sont positives dans ce fichier)')}</label>
      </div>
      <div id="csv-map-debit-credit-fields" hidden>
        <div class="form-row"><label>${t('Colonne Débit (dépenses)')}</label><select name="debitCol">${colOptions}</select></div>
        <div class="form-row"><label>${t('Colonne Crédit (recettes)')}</label><select name="creditCol">${colOptions}</select></div>
      </div>
      <button type="submit" class="btn btn-primary btn-block">${t('Importer')}</button>
    </form>`, { title: t('Associer les colonnes du CSV') });

  (async () => {
    const wallets = (await dbGetAll(STORES.WALLETS)).filter((w) => !w.archived);
    const walletSelect = modal.el.querySelector('#csv-map-wallet');
    walletSelect.innerHTML = wallets.length
      ? wallets.map((w) => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.currency)})</option>`).join('')
      : `<option value="">${t("Créez un portefeuille d'abord")}</option>`;
  })();

  const modeSelect = modal.el.querySelector('#csv-map-amount-mode');
  const singleFields = modal.el.querySelector('#csv-map-single-fields');
  const debitCreditFields = modal.el.querySelector('#csv-map-debit-credit-fields');
  modeSelect.addEventListener('change', () => {
    const isDebitCredit = modeSelect.value === 'debitCredit';
    singleFields.hidden = isDebitCredit;
    debitCreditFields.hidden = !isDebitCredit;
  });

  modal.el.querySelector('#csv-mapping-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get('walletId')) { showToast(t("Créez au moins un portefeuille avant d'importer.")); return; }
    const mapping = {
      walletId: fd.get('walletId'),
      dateCol: parseInt(fd.get('dateCol'), 10),
      noteCol: fd.get('noteCol') !== '' ? parseInt(fd.get('noteCol'), 10) : null,
      amountMode: fd.get('amountMode'),
      amountCol: parseInt(fd.get('amountCol'), 10),
      invertSign: fd.get('invertSign') === 'on',
      debitCol: parseInt(fd.get('debitCol'), 10),
      creditCol: parseInt(fd.get('creditCol'), 10),
    };
    try {
      const { imported, skipped, invalid } = await importGenericCsvRows(rows, mapping);
      modal.close();
      let message = t('{count} transaction(s) importée(s).', { count: imported });
      if (skipped) message += ' ' + t('{count} doublon(s) ignoré(s).', { count: skipped });
      if (invalid) message += ' ' + t('{count} ligne(s) invalide(s) ignorée(s) (date ou montant illisible — vérifiez le mapping des colonnes).', { count: invalid });
      showToast(message);
    } catch (err) {
      showToast(t('Erreur : {message}', { message: err.message || t('import impossible.') }));
    }
  });
}

function promptPassphrase(title) {
  return new Promise((resolve) => {
    const modal = openModal(`
      <form id="passphrase-form">
        <div class="form-row"><label>${t('Mot de passe de la sauvegarde')}</label><input type="password" name="passphrase" required minlength="6" autofocus></div>
        <button type="submit" class="btn btn-primary btn-block">${t('Continuer')}</button>
      </form>`, { title, onClose: () => resolve(null) });
    modal.el.querySelector('#passphrase-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new FormData(e.target).get('passphrase');
      // resolve() AVANT modal.close() : close() déclenche onClose() (=> resolve(null))
      // synchroniquement — appeler resolve(p) après serait un no-op (une promesse déjà
      // résolue ignore les résolutions suivantes), le mot de passe réel serait perdu. Bug
      // réel confirmé : l'export/import JSON chiffré ne fonctionnait jamais depuis ce menu.
      resolve(p);
      modal.close();
    });
  });
}

// Libellés traduits à l'usage via t(...) (voir renderSecuritySection ci-dessous et l'assistant de
// configuration dans app.js) — jamais ici, pour rester une simple table de données réutilisable.
export const AUTO_LOCK_OPTIONS = [[0, 'Jamais'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes']];

async function renderSecuritySection(container) {
  const bioSupported = await isBiometricAvailable();
  const bioConfigured = await isBiometricConfigured();
  const autoLockMinutes = await getSetting('autoLockMinutes', 0);

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Sécurité')}</h3></div>
      <form id="pin-change-form" style="margin-bottom:18px;">
        <div class="form-row"><label>${t('Code PIN actuel')}</label><input type="password" name="oldPin" required minlength="4" maxlength="6" inputmode="numeric" pattern="\\d{4,6}"></div>
        <div class="form-row"><label>${t('Nouveau code PIN (4-6 chiffres)')}</label><input type="password" name="newPin" required minlength="4" maxlength="6" inputmode="numeric" pattern="\\d{4,6}"></div>
        <div class="form-row"><label>${t('Confirmer le nouveau code')}</label><input type="password" name="newPinConfirm" required minlength="4" maxlength="6" inputmode="numeric" pattern="\\d{4,6}"></div>
        <button type="submit" class="btn btn-primary">${t('Changer le code PIN')}</button>
      </form>
      <div class="stat-row">
        <span class="stat-row-label">${t('Déverrouillage biométrique')}</span>
        <span>
          ${!bioSupported ? `<span class="badge">${t('Non disponible sur cet appareil')}</span>` : `
            <span class="badge ${bioConfigured ? 'badge-pos' : ''}">${bioConfigured ? t('Activée') : t('Désactivée')}</span>
            <button type="button" class="btn btn-ghost" id="bio-toggle-btn" style="margin-left:8px;">${bioConfigured ? t('Désactiver') : t('Activer')}</button>
          `}
        </span>
      </div>
      <div class="stat-row" style="margin-top:10px;">
        <span class="stat-row-label">${t("Verrouillage automatique après inactivité")}</span>
        <select id="auto-lock-select">${AUTO_LOCK_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === autoLockMinutes ? 'selected' : ''}>${t(l)}</option>`).join('')}</select>
      </div>
    </div>`;

  container.querySelector('#auto-lock-select').addEventListener('change', async (e) => {
    await setSetting('autoLockMinutes', parseInt(e.target.value, 10) || 0);
    showToast(t('Verrouillage automatique mis à jour.'));
  });

  container.querySelector('#pin-change-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('newPin') !== fd.get('newPinConfirm')) { showToast(t('Les nouveaux codes ne correspondent pas.')); return; }
    try {
      await changePin(fd.get('oldPin'), fd.get('newPin'));
      showToast(t('Code PIN modifié.'));
      e.target.reset();
    } catch (err) {
      showToast(err.message || t('Erreur lors du changement de PIN.'));
    }
  });

  container.querySelector('#bio-toggle-btn')?.addEventListener('click', async () => {
    if (bioConfigured) {
      const ok = await confirmDialog(t('Désactiver le déverrouillage biométrique ?'));
      if (ok) { await removeBiometric(); showToast(t('Biométrie désactivée.')); renderSecuritySection(container); }
    } else {
      try {
        await registerBiometric();
        showToast(t('Biométrie activée.'));
        renderSecuritySection(container);
      } catch (err) {
        showToast(err.message || t("Échec de l'activation biométrique."));
      }
    }
  });
}

// Libellés traduits à l'usage via t(...) (voir renderProfileSection ci-dessous), jamais ici — même
// convention que AUTO_LOCK_OPTIONS.
export const PROFILE_FIELDS = [
  { key: 'lastName', label: 'Nom de famille', type: 'text' },
  { key: 'firstName', label: 'Prénom', type: 'text' },
  { key: 'phone', label: 'Numéro de téléphone', type: 'tel' },
  { key: 'address', label: 'Adresse', type: 'text' },
  { key: 'jobTitle', label: 'Fonction', type: 'text' },
];

async function renderProfileSection(container) {
  const profile = await getSetting('userProfile', {});
  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Mon profil')}</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">${t("Informations personnelles utilisées pour personnaliser l'application (salutation sur le tableau de bord, en-tête des rapports PDF). Reste 100% local, jamais transmis.")}</p>
      <form id="profile-form">
        ${PROFILE_FIELDS.map((f) => `
          <div class="form-row">
            <label>${escapeHtml(t(f.label))}</label>
            <input type="${f.type}" name="${f.key}" maxlength="120" value="${escapeHtml(profile[f.key] || '')}">
          </div>`).join('')}
        <button type="submit" class="btn btn-primary">${t('Enregistrer le profil')}</button>
      </form>
    </div>`;

  container.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const updated = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, (fd.get(f.key) || '').trim()]));
    await setSetting('userProfile', updated);
    showToast(t('Profil mis à jour.'));
    notifyDataChanged('settings');
  });
}

/** Langue de l'interface (FR/EN). setLanguage() recharge la page pour appliquer la traduction
    partout d'un coup, plutôt que de rendre chaque écran individuellement réactif à ce changement
    rare. */
async function renderLanguageSection(container) {
  const lang = getLanguage();
  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>Langue / Language</h3></div>
      <div class="form-row" style="max-width:200px;">
        <select id="language-select">
          <option value="fr" ${lang === 'fr' ? 'selected' : ''}>Français</option>
          <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
        </select>
      </div>
    </div>`;

  container.querySelector('#language-select').addEventListener('change', async (e) => {
    await setLanguage(e.target.value);
  });
}

async function renderCurrencySection(container) {
  const baseCurrency = await getSetting('baseCurrency', 'EUR');
  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Devise de base')}</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">${t('Toutes les conversions (patrimoine net, rapports, outils) sont exprimées dans cette devise. La modifier réinitialise vos taux de change existants.')}</p>
      <div class="form-row" style="max-width:200px;">
        <select id="base-currency-select">${CURRENCIES.map((c) => `<option value="${c}" ${c === baseCurrency ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </div>
    </div>`;

  container.querySelector('#base-currency-select').addEventListener('change', async (e) => {
    const newCurrency = e.target.value;
    const ok = await confirmDialog(t('Passer la devise de base à {currency} ? Vos taux de change existants seront réinitialisés à 1 et devront être ressaisis.', { currency: newCurrency }), { confirmText: t('Confirmer') });
    if (!ok) { e.target.value = baseCurrency; return; }
    await setSetting('baseCurrency', newCurrency);
    const rates = await dbGetAll(STORES.EXCHANGE_RATES);
    const reset = rates.map((r) => ({ ...r, rateToBase: 1 }));
    await dbBulkPut(STORES.EXCHANGE_RATES, reset);
    showToast(t('Devise de base mise à jour.'));
    notifyDataChanged('all');
  });
}

async function renderBackupSection(container) {
  const lastBackupAt = await getSetting('lastBackupAt');
  const backupSnoozedUntil = await getSetting('backupSnoozedUntil');
  const lastBackupLabel = lastBackupAt ? formatDate(lastBackupAt) : t('jamais');
  const snoozedLabel = backupSnoozedUntil && Date.now() < new Date(backupSnoozedUntil).getTime()
    ? ' · ' + t("rappel mis en pause jusqu'au {date}", { date: formatDate(backupSnoozedUntil) })
    : '';
  const autoBackupDir = await getAutoBackupDirectory();

  let autoBackupHtml;
  if (!isFileSystemAccessSupported()) {
    autoBackupHtml = `<span class="badge">${t('Non disponible sur ce navigateur (Chrome/Edge sur ordinateur uniquement)')}</span>`;
  } else if (autoBackupDir) {
    autoBackupHtml = `
      <span class="badge badge-pos">${t('Dossier : {name}', { name: escapeHtml(autoBackupDir.name) })}</span>
      <button type="button" class="btn btn-ghost" id="auto-backup-disable-btn" style="margin-left:8px;">${t('Désactiver')}</button>`;
  } else {
    autoBackupHtml = `<button type="button" class="btn btn-ghost" id="auto-backup-choose-btn">${t('Choisir un dossier')}</button>`;
  }

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Sauvegarde &amp; restauration')}</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">${t("Toutes vos données restent locales. Exportez régulièrement une copie (JSON complet ou CSV) pour éviter toute perte. Un rappel s'affiche automatiquement si aucune sauvegarde n'a été faite depuis 7 jours.")}</p>
      <div class="stat-row"><span class="stat-row-label">${t('Dernière sauvegarde')}</span><span>${lastBackupLabel}${snoozedLabel}</span></div>
      <div class="stat-row" style="margin-top:6px;"><span class="stat-row-label">${t('Sauvegarde automatique hebdomadaire')}</span><span>${autoBackupHtml}</span></div>
      <p style="font-size:12px;color:var(--text-faint);margin:6px 0 0;">${t("Si un dossier est choisi, GeoFinance y écrit un export JSON automatiquement à chaque rappel hebdomadaire, sans action de votre part.")}</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
        <button type="button" class="btn btn-primary" id="export-json-btn">${t('Exporter (JSON)')}</button>
        <button type="button" class="btn btn-ghost" id="import-json-btn">${t('Importer (JSON)')}</button>
        <button type="button" class="btn btn-ghost" id="export-encrypted-btn">${t('Exporter (JSON chiffré)')}</button>
        <button type="button" class="btn btn-ghost" id="import-encrypted-btn">${t('Importer (JSON chiffré)')}</button>
        <button type="button" class="btn btn-ghost" id="export-csv-btn">${t('Exporter des transactions (CSV)')}</button>
        <button type="button" class="btn btn-ghost" id="import-csv-btn">${t('Importer des transactions (CSV)')}</button>
      </div>
    </div>
    <div class="panel" style="border-color:var(--neg);">
      <div class="panel-header"><h3 style="color:var(--neg);">${t('Zone dangereuse')}</h3></div>
      <button type="button" class="btn btn-danger" id="wipe-data-btn">${t('Réinitialiser toutes les données')}</button>
    </div>`;

  container.querySelector('#auto-backup-choose-btn')?.addEventListener('click', async () => {
    try {
      await chooseAutoBackupDirectory();
      showToast(t('Dossier de sauvegarde automatique configuré.'));
      renderBackupSection(container);
    } catch (err) {
      if (err.name !== 'AbortError') showToast(t('Erreur : {message}', { message: err.message || t('sélection impossible.') }));
    }
  });
  container.querySelector('#auto-backup-disable-btn')?.addEventListener('click', async () => {
    await clearAutoBackupDirectory();
    showToast(t('Sauvegarde automatique désactivée.'));
    renderBackupSection(container);
  });

  container.querySelector('#export-json-btn').addEventListener('click', async () => { await exportJsonBackup(); showToast(t('Sauvegarde JSON exportée.')); renderBackupSection(container); });

  container.querySelector('#import-json-btn').addEventListener('click', () => {
    hiddenFileInput('application/json', async (file) => {
      const merge = await confirmDialog(t('Fusionner avec les données existantes ? "Annuler" remplacera entièrement les données actuelles par celles du fichier.'), { confirmText: t('Fusionner'), cancelText: t('Remplacer tout') });
      try {
        await importJsonBackup(file, { merge });
        showToast(t('Import réussi.'));
      } catch (err) { showToast(t('Erreur : {message}', { message: err.message || t('fichier invalide.') })); }
    }).click();
  });

  container.querySelector('#export-encrypted-btn').addEventListener('click', async () => {
    const p1 = await promptPassphrase(t('Mot de passe de chiffrement'));
    if (!p1) return;
    await exportEncryptedBackup(p1);
    showToast(t('Sauvegarde chiffrée exportée.'));
    renderBackupSection(container);
  });

  container.querySelector('#import-encrypted-btn').addEventListener('click', () => {
    hiddenFileInput('application/json', async (file) => {
      const p = await promptPassphrase(t('Mot de passe de la sauvegarde'));
      if (!p) return;
      const merge = await confirmDialog(t('Fusionner avec les données existantes ?'), { confirmText: t('Fusionner'), cancelText: t('Remplacer tout') });
      try {
        await importEncryptedBackup(file, p, { merge });
        showToast(t('Import réussi.'));
      } catch (err) { showToast(t('Erreur : {message}', { message: err.message || t('fichier invalide.') })); }
    }).click();
  });

  container.querySelector('#export-csv-btn').addEventListener('click', async () => {
    await exportTransactionsCsv();
    showToast(t('Export CSV généré.'));
  });

  container.querySelector('#import-csv-btn').addEventListener('click', () => {
    hiddenFileInput('.csv,text/csv', async (file) => {
      try {
        const analysis = await analyzeTransactionsCsv(file);
        if (analysis.format === 'geofinance') {
          const { imported, skipped } = await importGeoFinanceCsvRows(analysis.rows);
          let message = t('{count} transaction(s) importée(s).', { count: imported });
          if (skipped) message += ' ' + t('{count} doublon(s) ignoré(s).', { count: skipped });
          showToast(message);
        } else {
          openCsvMappingModal(analysis);
        }
      } catch (err) { showToast(t('Erreur : {message}', { message: err.message || t('fichier invalide.') })); }
    }).click();
  });

  container.querySelector('#wipe-data-btn').addEventListener('click', async () => {
    const ok = await confirmDialog(t('Supprimer DÉFINITIVEMENT toutes les données de GeoFinance (portefeuilles, transactions, budgets, investissements, dettes…) ? Cette action est irréversible. Exportez une sauvegarde avant si besoin.'), { danger: true, confirmText: t('Tout supprimer') });
    if (!ok) return;
    const ok2 = await confirmDialog(t('Dernière confirmation : voulez-vous vraiment tout réinitialiser ?'), { danger: true, confirmText: t('Oui, réinitialiser') });
    if (!ok2) return;
    await wipeAllData();
    showToast(t('Toutes les données ont été réinitialisées.'));
    notifyDataChanged('all');
  });
}

async function renderNotificationsSection(container) {
  const supported = isNotificationSupported();
  const permission = getNotificationPermission();
  const thresholds = { ...BUDGET_ALERT_THRESHOLD_DEFAULTS, ...(await getSetting('budgetAlertThresholds', {})) };

  let statusHtml;
  if (!supported) {
    statusHtml = `<span class="badge">${t('Non supportées par ce navigateur')}</span>`;
  } else if (permission === 'granted') {
    statusHtml = `<span class="badge badge-pos">${t('Activées')}</span><button type="button" class="btn btn-ghost" id="notif-test-btn" style="margin-left:8px;">${t('Tester')}</button>`;
  } else if (permission === 'denied') {
    statusHtml = `<span class="badge badge-neg">${t('Bloquées par le navigateur')}</span>`;
  } else {
    statusHtml = `<span class="badge">${t('Désactivées')}</span><button type="button" class="btn btn-primary" id="notif-enable-btn" style="margin-left:8px;">${t('Activer')}</button>`;
  }

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Notifications')}</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">${t("Rappels locaux pour vos échéances récurrentes proches (3 jours), vos dettes/créances arrivant à échéance (3 jours), vos budgets qui approchent leur limite et vos portefeuilles passant sous leur seuil d'alerte (réglable sur chaque portefeuille). Ces rappels s'affichent quand l'application est ouverte ou récemment réactivée — un envoi en arrière-plan app totalement fermée nécessiterait un serveur distant, ce qui irait à l'encontre du principe 100% local de GeoFinance.")}</p>
      <div class="stat-row"><span class="stat-row-label">${t('Statut')}</span><span>${statusHtml}</span></div>
      ${permission === 'denied' ? `<p style="font-size:12px;color:var(--text-faint);margin-top:8px;">${t('Vous avez bloqué les notifications pour ce site. Autorisez-les dans les paramètres de votre navigateur pour les réactiver.')}</p>` : ''}
      <div class="stat-row" style="margin-top:10px;align-items:center;">
        <span class="stat-row-label">${t("Seuils d'alerte budget")}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <input type="number" min="1" max="100" id="threshold-warn" value="${thresholds.warn}" style="width:60px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);text-align:right;"> ${t('% avertissement')}
          <input type="number" min="1" max="100" id="threshold-danger" value="${thresholds.danger}" style="width:60px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);text-align:right;"> ${t('% dépassement')}
        </span>
      </div>
    </div>`;

  container.querySelector('#notif-enable-btn')?.addEventListener('click', async () => {
    const perm = await requestNotificationPermission();
    if (perm === 'granted') { showToast(t('Notifications activées.')); await checkAndNotify(); }
    else if (perm === 'denied') { showToast(t('Notifications refusées.')); }
    renderNotificationsSection(container);
  });

  container.querySelector('#notif-test-btn')?.addEventListener('click', async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: t('Voici à quoi ressemblera un rappel.'), icon: 'icons/icon-192.png' };
    if (reg?.showNotification) await reg.showNotification('GeoFinance', opts);
    else new Notification('GeoFinance', opts);
  });

  const saveThresholds = async () => {
    const warn = parseInt(container.querySelector('#threshold-warn').value, 10) || BUDGET_ALERT_THRESHOLD_DEFAULTS.warn;
    const danger = parseInt(container.querySelector('#threshold-danger').value, 10) || BUDGET_ALERT_THRESHOLD_DEFAULTS.danger;
    if (warn >= danger) { showToast(t("Le seuil d'avertissement doit être inférieur au seuil de dépassement.")); return; }
    await setSetting('budgetAlertThresholds', { warn, danger });
    showToast(t('Seuils mis à jour.'));
  };
  container.querySelector('#threshold-warn')?.addEventListener('change', saveThresholds);
  container.querySelector('#threshold-danger')?.addEventListener('change', saveThresholds);
}

async function renderInstallSection(container) {
  const standalone = isStandalone();
  const iosSafari = isIOS() && isSafari();
  const iosOther = isIOS() && !isSafari();
  const androidLike = isAndroid() && !isIOS();

  let statusHtml, extraHtml = '';
  if (standalone) {
    statusHtml = `<span class="badge badge-pos">${t('Déjà installée')}</span>`;
  } else if (hasDeferredPrompt()) {
    statusHtml = `<span class="badge badge-pos">${t('Disponible')}</span><button type="button" class="btn btn-primary" id="install-now-btn" style="margin-left:8px;">${t('Installer maintenant')}</button>`;
  } else if (iosSafari) {
    statusHtml = `<span class="badge">${t('Installation manuelle')}</span>`;
    extraHtml = `<p style="font-size:12.5px;color:var(--text-muted);margin-top:10px;">${t('Appuyez sur <strong>Partager</strong>, puis <strong>« Sur l\'écran d\'accueil »</strong>.')}</p>`;
  } else if (iosOther) {
    statusHtml = `<span class="badge">${t('Non disponible dans ce navigateur')}</span>`;
    extraHtml = `<p style="font-size:12.5px;color:var(--text-muted);margin-top:10px;">${t('Sur iPhone/iPad, l\'installation n\'est possible que depuis <strong>Safari</strong> (restriction Apple). Ouvrez ce site dans Safari, puis Partager → « Sur l\'écran d\'accueil ».')}</p>`;
  } else if (androidLike) {
    statusHtml = `<span class="badge">${t('Pas encore proposée')}</span>`;
    extraHtml = `<p style="font-size:12.5px;color:var(--text-muted);margin-top:10px;">${t('Ouvrez le menu ⋮ de votre navigateur et choisissez « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».')}</p>`;
  } else {
    statusHtml = `<span class="badge">${t('Pas encore proposée')}</span>`;
    extraHtml = `<p style="font-size:12.5px;color:var(--text-muted);margin-top:10px;">${t('Cherchez une icône d\'installation dans la barre d\'adresse, ou le menu du navigateur → « Installer GeoFinance ».')}</p>`;
  }

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Installation')}</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">${t("Installez GeoFinance sur cet appareil pour un accès direct depuis l'écran d'accueil, en plein écran et 100% hors-ligne.")}</p>
      <div class="stat-row"><span class="stat-row-label">${t('Statut')}</span><span>${statusHtml}</span></div>
      ${extraHtml}
      ${!standalone ? `<button type="button" class="btn btn-ghost" id="reset-install-snooze-btn" style="margin-top:12px;">${t('Réafficher le rappel automatique')}</button>` : ''}
    </div>`;

  container.querySelector('#install-now-btn')?.addEventListener('click', async () => {
    const outcome = await triggerInstall();
    if (outcome === 'accepted') showToast(t('Application installée !'));
    else if (outcome === 'dismissed') showToast(t('Installation annulée.'));
    renderInstallSection(container);
  });

  container.querySelector('#reset-install-snooze-btn')?.addEventListener('click', async () => {
    await resetInstallPromptSnooze();
    showToast(t("Le rappel d'installation réapparaîtra à la prochaine ouverture (si votre navigateur le propose)."));
  });
}

async function renderUpdateSection(container) {
  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Mise à jour')}</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">${t("GeoFinance fonctionne hors-ligne grâce à une copie locale de l'application. Vérifiez ici si une nouvelle version a été publiée : seul le code de l'application est remplacé, vos données (portefeuilles, transactions, budgets…) restent intactes.")}</p>
      <div class="stat-row"><span class="stat-row-label">${t('Statut')}</span><span id="update-status"><span class="badge">${t('Non vérifié')}</span></span></div>
      <button type="button" class="btn btn-primary" id="check-update-btn" style="margin-top:12px;">${t('Vérifier les mises à jour')}</button>
    </div>`;

  const statusEl = container.querySelector('#update-status');
  const btn = container.querySelector('#check-update-btn');

  btn.addEventListener('click', async () => {
    if (!('serviceWorker' in navigator)) {
      showToast(t('Mises à jour automatiques non supportées par ce navigateur.'));
      return;
    }
    btn.disabled = true;
    btn.textContent = t('Vérification…');
    statusEl.innerHTML = `<span class="badge">${t('Vérification…')}</span>`;

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        statusEl.innerHTML = `<span class="badge">${t('Aucune installation hors-ligne active')}</span>`;
        return;
      }

      // sw.js active toute nouvelle version dès son installation (self.skipWaiting()
      // inconditionnel) puis prend le contrôle de la page ouverte : "controllerchange"
      // est donc le signal fiable qu'une nouvelle version vient d'être installée.
      const updated = await new Promise((resolve) => {
        const onControllerChange = () => resolve(true);
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
        reg.update().catch(() => {});
        setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          resolve(false);
        }, 4000);
      });

      if (updated) {
        statusEl.innerHTML = `<span class="badge badge-pos">${t('Nouvelle version installée')}</span>`;
        showToast(t('Nouvelle version installée, rechargement…'));
        window.location.reload();
        return;
      }
      statusEl.innerHTML = `<span class="badge badge-pos">${t('Version à jour')}</span>`;
      showToast(t('Vous utilisez déjà la dernière version.'));
    } catch (err) {
      statusEl.innerHTML = `<span class="badge badge-neg">${t('Échec de la vérification')}</span>`;
      showToast(t('Erreur : {message}', { message: err.message || t('vérification impossible.') }));
    } finally {
      btn.disabled = false;
      btn.textContent = t('Vérifier les mises à jour');
    }
  });
}

// Libellés traduits à l'usage via t(...) (voir renderDashboardConfigSection ci-dessous et
// l'assistant de configuration dans app.js), jamais ici — même convention que AUTO_LOCK_OPTIONS.
export const DASHBOARD_PANEL_LABELS = {
  watchCategories: 'Catégories à surveiller',
  upcomingBills: 'Prochaines échéances',
  charts: 'Graphiques',
  recentTransactions: 'Transactions récentes',
  safeToSpend: 'Reste à vivre',
  netWorth: 'Patrimoine net global',
  debtsBalance: 'Solde créances & dettes',
};

/** Modules optionnels de l'app : masqués par défaut, activables ici ou pendant l'onboarding
    (app.js). Liste volontairement conçue pour grandir — ajouter un module futur ne demande
    qu'une entrée ici, ni renderFeaturesSection() ni le pas "modules" de l'onboarding n'ont à
    changer. navId est optionnel (bouton de nav à masquer/afficher quand le module n'en a pas). */
// label/description traduits à l'usage via t(...) (renderFeaturesSection ci-dessous et l'assistant
// de configuration dans app.js), jamais ici — même convention que AUTO_LOCK_OPTIONS.
export const OPTIONAL_MODULES = [
  {
    key: 'keptAccountsEnabled',
    label: 'Comptes gardés',
    description: "Ajoute un onglet dédié pour suivre l'argent d'un proche que vous gérez (petit frère, conjointe, mère…), totalement séparé de vos portefeuilles et de votre patrimoine net.",
    navId: 'nav-kept-accounts',
    view: 'keptAccounts',
  },
];

export async function applyOptionalModuleVisibility() {
  for (const mod of OPTIONAL_MODULES) {
    if (!mod.navId) continue;
    const navBtn = document.getElementById(mod.navId);
    if (navBtn) navBtn.hidden = !(await getSetting(mod.key, false));
  }
}

async function renderFeaturesSection(container) {
  const states = await Promise.all(OPTIONAL_MODULES.map((mod) => getSetting(mod.key, false)));
  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Fonctionnalités optionnelles')}</h3></div>
      ${OPTIONAL_MODULES.map((mod, i) => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 0;font-size:14px;cursor:pointer;">
          <input type="checkbox" data-module-key="${mod.key}" ${states[i] ? 'checked' : ''}>
          ${escapeHtml(t(mod.label))}
        </label>
        <p style="font-size:12.5px;color:var(--text-muted);margin:2px 0 10px;">${escapeHtml(t(mod.description))}</p>`).join('')}
    </div>`;

  container.querySelectorAll('[data-module-key]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      await setSetting(input.dataset.moduleKey, e.target.checked);
      await applyOptionalModuleVisibility();
      showToast(t('Fonctionnalité mise à jour.'));
    });
  });
}

async function renderDashboardConfigSection(container) {
  const panels = { ...DASHBOARD_PANEL_DEFAULTS, ...(await getSetting('dashboardPanels', {})) };

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><h3>${t('Tableau de bord')}</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">${t('Choisissez les panneaux affichés sur le tableau de bord (la carte « Budget mensuel alloué » et les 4 chiffres du mois restent toujours visibles).')}</p>
      ${Object.entries(DASHBOARD_PANEL_LABELS).map(([key, label]) => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 0;font-size:14px;cursor:pointer;">
          <input type="checkbox" data-panel-key="${key}" ${panels[key] ? 'checked' : ''}>
          ${escapeHtml(t(label))}
        </label>`).join('')}
    </div>`;

  container.querySelectorAll('[data-panel-key]').forEach((input) => {
    input.addEventListener('change', async () => {
      const current = { ...DASHBOARD_PANEL_DEFAULTS, ...(await getSetting('dashboardPanels', {})) };
      current[input.dataset.panelKey] = input.checked;
      await setSetting('dashboardPanels', current);
      showToast(t('Tableau de bord mis à jour.'));
    });
  });
}

// Coordonnées affichées dans « À propos du développeur » (Paramètres) et dans le crédit de la
// barre latérale (index.html, mis à jour séparément — statique, pas piloté par ce fichier).
// Téléphone volontairement absent pour l'instant (non fourni) : ajouter une ligne
// stat-row supplémentaire ici (Téléphone / DEVELOPER_PHONE, lien tel:) le jour où il l'est.
const DEVELOPER_NAME = 'Bibiê Adtcheko';
const DEVELOPER_EMAIL = 'ronywest01@gmail.com';

function renderDeveloperSection(container) {
  container.innerHTML = `
    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><h3>${t('À propos du développeur')}</h3></div>
      <div class="stat-row"><span class="stat-row-label">${t('Nom')}</span><span>${escapeHtml(DEVELOPER_NAME)}</span></div>
      <div class="stat-row"><span class="stat-row-label">${t('Email')}</span><a href="mailto:${DEVELOPER_EMAIL}" style="color:var(--accent);">${escapeHtml(DEVELOPER_EMAIL)}</a></div>
    </div>`;
}

export async function renderSettings() {
  const container = document.getElementById('settings-content');
  if (!container) return;
  container.innerHTML = '<div id="settings-profile"></div><div id="settings-security"></div><div id="settings-notifications"></div><div id="settings-install"></div><div id="settings-update"></div><div id="settings-dashboard"></div><div id="settings-features"></div><div id="settings-language"></div><div id="settings-currency"></div><div id="settings-backup"></div><div id="settings-cloud-backup"></div><div id="settings-developer"></div>';
  await renderProfileSection(document.getElementById('settings-profile'));
  await renderSecuritySection(document.getElementById('settings-security'));
  await renderNotificationsSection(document.getElementById('settings-notifications'));
  await renderInstallSection(document.getElementById('settings-install'));
  await renderUpdateSection(document.getElementById('settings-update'));
  await renderDashboardConfigSection(document.getElementById('settings-dashboard'));
  await renderFeaturesSection(document.getElementById('settings-features'));
  await renderLanguageSection(document.getElementById('settings-language'));
  await renderCurrencySection(document.getElementById('settings-currency'));
  await renderBackupSection(document.getElementById('settings-backup'));
  await renderCloudBackupSection(document.getElementById('settings-cloud-backup'));
  renderDeveloperSection(document.getElementById('settings-developer'));
}

export function initSettingsModule() {}
