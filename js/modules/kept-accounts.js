/* ==========================================================================
   GeoFinance System — Module Comptes gardés
   Argent de tiers (famille, proches) que l'utilisateur garde/gère pour eux
   (petit frère, conjointe, mère…). Totalement autonome des portefeuilles
   personnels : stores dédiés (KEPT_ACCOUNTS/KEPT_ACCOUNT_ENTRIES), jamais lus
   par ledger.js, jamais comptés dans le patrimoine net. Activable/désactivable
   depuis Paramètres (voir settings.js applyOptionalModuleVisibility()).
   ========================================================================== */

import { STORES, dbGetAll, dbPut, dbAdd, dbDelete, logAudit } from '../db.js';
import { uuid, formatCurrency, formatDate, escapeHtml, todayISO, openModal, confirmDialog, showToast, currencySelectHtml, wireCurrencySelect, readCurrencyValue, safeNumber } from '../utils.js';
import { notifyDataChanged } from '../state.js';
import { t } from '../i18n.js';

const EDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H2V5h4l1-2Z"/></svg>';
const ARCHIVE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 4h18v4H3V4Zm1 6h16v10H4V10Zm4 3v2h8v-2H8Z"/></svg>';

function accountBalance(account, entries) {
  const total = entries
    .filter((e) => e.accountId === account.id)
    .reduce((sum, e) => sum + (e.type === 'in' ? (e.amount || 0) : -(e.amount || 0)), 0);
  return (account.initialBalance || 0) + total;
}

function accountCardHtml(account, balance) {
  return `
    <div class="summary-card" data-account-id="${account.id}">
      <div class="card-title-row">
        <div>
          <div class="summary-card-label">${escapeHtml(account.currency)}${account.archived ? ` · ${t('archivé')}` : ''}</div>
          <div style="font-weight:700;font-size:14.5px;">${escapeHtml(account.ownerName)}</div>
        </div>
        <div class="card-actions">
          <button type="button" class="icon-btn" data-action="edit" aria-label="${t('Modifier')}" title="${t('Modifier')}">${EDIT_ICON}</button>
          <button type="button" class="icon-btn" data-action="archive" aria-label="${account.archived ? t('Désarchiver') : t('Archiver')}" title="${account.archived ? t('Désarchiver') : t('Archiver')}">${ARCHIVE_ICON}</button>
          <button type="button" class="icon-btn" data-action="delete" aria-label="${t('Supprimer')}" title="${t('Supprimer')}">${DELETE_ICON}</button>
        </div>
      </div>
      <div class="summary-card-value amount" data-value="${balance}">${formatCurrency(balance, account.currency)}</div>
      <button type="button" class="btn btn-ghost btn-block" data-action="open" style="margin-top:10px;">${t('Voir les mouvements')}</button>
    </div>`;
}

function accountFormHtml(account) {
  return `
    <form id="kept-account-form">
      <div class="form-row"><label>${t("Nom du propriétaire de l'argent")}</label><input type="text" name="ownerName" required maxlength="60" value="${escapeHtml(account?.ownerName || '')}" placeholder="${t('Ex: Petit frère, Maman…')}"></div>
      <div class="form-row"><label>${t('Devise')}</label>${currencySelectHtml(account?.currency || 'EUR')}</div>
      <div class="form-row"><label>${account ? t('Solde initial') : t('Solde de départ')}</label><input type="number" step="0.01" name="initialBalance" value="${account?.initialBalance ?? 0}"></div>
      <div class="form-row"><label>${t('Note (optionnel)')}</label><input type="text" name="note" maxlength="140" value="${escapeHtml(account?.note || '')}"></div>
      <button type="submit" class="btn btn-primary btn-block">${account ? t('Enregistrer') : t('Créer le compte')}</button>
    </form>`;
}

function openAccountModal(account = null) {
  const modal = openModal(accountFormHtml(account), { title: account ? t('Modifier le compte gardé') : t('Nouveau compte gardé') });
  wireCurrencySelect(modal.el);
  modal.el.querySelector('#kept-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const before = account ? { ...account } : null;
    const record = {
      id: account?.id || uuid(),
      ownerName: fd.get('ownerName').trim(),
      currency: readCurrencyValue(e.target),
      initialBalance: safeNumber(parseFloat(fd.get('initialBalance'))),
      note: (fd.get('note') || '').trim().slice(0, 140),
      archived: account?.archived || false,
      createdAt: account?.createdAt || new Date().toISOString(),
    };
    await dbPut(STORES.KEPT_ACCOUNTS, record);
    await logAudit({ entityType: 'keptAccount', entityId: record.id, action: account ? 'update' : 'create', before, after: record });
    modal.close();
    showToast(account ? t('Compte mis à jour.') : t('Compte créé.'));
    notifyDataChanged('keptAccounts');
  });
}

/* ---------- Détail d'un compte : mouvements (entrées/sorties) ---------- */
function entryRowHtml(entry, currency) {
  const sign = entry.type === 'in' ? '+' : '−';
  const cls = entry.type === 'in' ? 'pos' : 'neg';
  return `
    <div class="tx-row" data-entry-id="${entry.id}">
      <div class="tx-main">
        <div class="tx-title">${entry.type === 'in' ? t('Entrée') : t('Sortie')}</div>
        <div class="tx-sub">${formatDate(entry.date)}${entry.note ? ' · ' + escapeHtml(entry.note) : ''}</div>
      </div>
      <div class="tx-amount amount ${cls}">${sign}${formatCurrency(entry.amount, currency)}</div>
      <button type="button" class="icon-btn" data-action="delete-entry" aria-label="${t('Supprimer')}" title="${t('Supprimer')}">${DELETE_ICON}</button>
    </div>`;
}

async function renderAccountDetail(container, account) {
  const entries = (await dbGetAll(STORES.KEPT_ACCOUNT_ENTRIES))
    .filter((e) => e.accountId === account.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const balance = accountBalance(account, entries);

  container.innerHTML = `
    <div class="stat-row" style="margin-bottom:14px;"><span class="stat-row-label">${t('Solde actuel')}</span><strong class="amount">${formatCurrency(balance, account.currency)}</strong></div>
    <form id="kept-entry-form" class="filters-bar" style="align-items:flex-end;margin-bottom:14px;">
      <div class="segmented" data-field="entry-type" style="flex-basis:100%;">
        <button type="button" class="segmented-btn is-active" data-value="in">${t('Entrée')}</button>
        <button type="button" class="segmented-btn" data-value="out">${t('Sortie')}</button>
      </div>
      <input type="hidden" name="type" value="in">
      <div class="form-row" style="margin:0;flex:1;min-width:100px;"><label>${t('Montant')}</label><input type="number" step="0.01" min="0" name="amount" required></div>
      <div class="form-row" style="margin:0;flex:1;min-width:130px;"><label>${t('Date')}</label><input type="date" name="date" value="${todayISO()}"></div>
      <div class="form-row" style="margin:0;flex:2;min-width:160px;"><label>${t('Note (optionnel)')}</label><input type="text" name="note" maxlength="140"></div>
      <button type="submit" class="btn btn-primary">${t('Ajouter')}</button>
    </form>
    <div id="kept-entries-list">${entries.length ? entries.map((e) => entryRowHtml(e, account.currency)).join('') : `<div class="empty-state">${t('Aucun mouvement pour le moment.')}</div>`}</div>`;

  const form = container.querySelector('#kept-entry-form');
  let entryType = 'in';
  form.querySelectorAll('.segmented-btn').forEach((b) => b.addEventListener('click', () => {
    entryType = b.dataset.value;
    form.elements.type.value = entryType;
    form.querySelectorAll('.segmented-btn').forEach((x) => x.classList.toggle('is-active', x === b));
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const entry = {
      id: uuid(),
      accountId: account.id,
      type: entryType,
      amount: safeNumber(parseFloat(fd.get('amount'))),
      date: fd.get('date') || todayISO(),
      note: (fd.get('note') || '').trim().slice(0, 140),
      createdAt: new Date().toISOString(),
    };
    await dbAdd(STORES.KEPT_ACCOUNT_ENTRIES, entry);
    await logAudit({ entityType: 'keptAccountEntry', entityId: entry.id, action: 'create', after: entry });
    showToast(t('Mouvement enregistré.'));
    notifyDataChanged('keptAccounts');
    await renderAccountDetail(container, account);
  });

  container.querySelectorAll('[data-action="delete-entry"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entryId = btn.closest('[data-entry-id]').dataset.entryId;
      const target = entries.find((e) => e.id === entryId);
      const ok = await confirmDialog(t('Supprimer ce mouvement ?'), { danger: true, confirmText: t('Supprimer') });
      if (!ok) return;
      await dbDelete(STORES.KEPT_ACCOUNT_ENTRIES, entryId);
      await logAudit({ entityType: 'keptAccountEntry', entityId, action: 'delete', before: target });
      showToast(t('Mouvement supprimé.'));
      notifyDataChanged('keptAccounts');
      await renderAccountDetail(container, account);
    });
  });
}

function openAccountDetailModal(account) {
  const modal = openModal('<div id="kept-account-detail"></div>', { title: t('{name} — mouvements', { name: account.ownerName }) });
  renderAccountDetail(modal.el.querySelector('#kept-account-detail'), account);
}

/* ---------- Point d'entrée du module ---------- */
export async function renderKeptAccounts() {
  const container = document.getElementById('kept-accounts-content');
  if (!container) return;
  const [accounts, entries] = await Promise.all([dbGetAll(STORES.KEPT_ACCOUNTS), dbGetAll(STORES.KEPT_ACCOUNT_ENTRIES)]);
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  if (!active.length && !archived.length) {
    container.innerHTML = `<div class="empty-state">${t("Aucun compte gardé pour le moment. Créez-en un pour suivre l'argent d'un proche que vous gérez.")}</div>`;
    return;
  }
  container.innerHTML = `<div class="grid-cards">${active.map((a) => accountCardHtml(a, accountBalance(a, entries))).join('')}</div>` +
    (archived.length ? `<div style="font-size:12.5px;color:var(--text-faint);font-weight:700;margin:16px 0 8px;">${t('ARCHIVÉS')}</div><div class="grid-cards">${archived.map((a) => accountCardHtml(a, accountBalance(a, entries))).join('')}</div>` : '');
}

export function initKeptAccountsModule() {
  document.getElementById('kept-account-add-btn')?.addEventListener('click', () => openAccountModal());

  document.getElementById('kept-accounts-content')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = e.target.closest('[data-account-id]');
    if (!card) return;
    const accounts = await dbGetAll(STORES.KEPT_ACCOUNTS);
    const account = accounts.find((a) => a.id === card.dataset.accountId);
    if (!account) return;

    if (btn.dataset.action === 'open') {
      openAccountDetailModal(account);
    } else if (btn.dataset.action === 'edit') {
      openAccountModal(account);
    } else if (btn.dataset.action === 'archive') {
      const before = { ...account };
      account.archived = !account.archived;
      await dbPut(STORES.KEPT_ACCOUNTS, account);
      await logAudit({ entityType: 'keptAccount', entityId: account.id, action: 'update', before, after: account, note: account.archived ? t('Archivé') : t('Désarchivé') });
      showToast(account.archived ? t('Compte archivé.') : t('Compte désarchivé.'));
      notifyDataChanged('keptAccounts');
    } else if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog(t('Supprimer le compte gardé de "{name}" et tout son historique de mouvements ?', { name: account.ownerName }), { danger: true, confirmText: t('Supprimer') });
      if (!ok) return;
      const entries = (await dbGetAll(STORES.KEPT_ACCOUNT_ENTRIES)).filter((en) => en.accountId === account.id);
      for (const en of entries) await dbDelete(STORES.KEPT_ACCOUNT_ENTRIES, en.id);
      await dbDelete(STORES.KEPT_ACCOUNTS, account.id);
      await logAudit({ entityType: 'keptAccount', entityId: account.id, action: 'delete', before: account });
      showToast(t('Compte supprimé.'), {
        actionLabel: t('Annuler'),
        onAction: async () => {
          await dbAdd(STORES.KEPT_ACCOUNTS, account);
          for (const en of entries) await dbAdd(STORES.KEPT_ACCOUNT_ENTRIES, en);
          await logAudit({ entityType: 'keptAccount', entityId: account.id, action: 'create', after: account, note: t('Restauré (annulation)') });
          showToast(t('Restauré.'));
          notifyDataChanged('keptAccounts');
        },
      });
      notifyDataChanged('keptAccounts');
    }
  });
}
