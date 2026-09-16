/* ==========================================================================
   GeoFinance System — Module Transactions
   Contient : la modale "Saisie express" (création + édition, réutilisée
   dans toute l'app), la liste filtrée des transactions, et le
   rapprochement bancaire ("check-in").
   ========================================================================== */

import { STORES, dbGetAll, dbAdd, dbPut, dbDelete, logAudit } from '../db.js';
import { getEnrichedTransactions, guessCategoryId, checkUnusualExpense } from '../ledger.js';
import { uuid, formatCurrency, formatDate, formatMonthLabel, escapeHtml, todayISO, currentMonthKey, monthKeyOffset, openModal, confirmDialog, showToast, safeNumber } from '../utils.js';
import { notifyDataChanged } from '../state.js';
import { extractAmountFromImage } from '../ocr.js';
// Aliasé en tr (pas t) : ce fichier utilise `t` comme nom de variable pour une transaction dans
// plusieurs fonctions (txRowHtml(t), reconTxRowHtml(t), et une const t locale dans le handler de
// clic de initTransactionsModule) — voir le même piège documenté dans dashboard.js.
import { t as tr, applyStaticTranslations } from '../i18n.js';

const TX_ICONS = {
  income: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 20V6M6 12l6-6 6 6"/></svg>',
  expense: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v14M6 12l6 6 6-6"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
};
function parseTags(raw) {
  return [...new Set((raw || '').split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 10);
}

const CHECK_CIRCLE = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.5-4.3-4.3 1.4-1.4 2.9 2.9 6.1-6.1 1.4 1.4-7.5 7.5Z"/></svg>';
const EMPTY_CIRCLE = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/></svg>';
const EDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H2V5h4l1-2Z"/></svg>';
const RECEIPT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Zm2 5h8V5H8v2Zm0 4h8V9H8v2Zm0 4h5v-2H8v2Z"/></svg>';

/* ==========================================================================
   Modale Saisie express (création + édition)
   ========================================================================== */
export function openQuickAdd({ editTransaction = null } = {}) {
  document.querySelectorAll('#modal-root .modal-backdrop[data-modal="quick-add"]').forEach((el) => el.remove());
  const tpl = document.getElementById('tpl-modal-quick-add');
  const root = document.getElementById('modal-root');
  root.appendChild(tpl.content.cloneNode(true));
  const backdrop = root.querySelector('.modal-backdrop[data-modal="quick-add"]');
  // Le contenu d'un <template> n'est pas dans le document tant qu'il n'est pas cloné — les
  // attributs data-i18n dessus n'ont donc jamais été traduits par le passage unique
  // d'applyStaticTranslations() au démarrage (auth.js). On le relance ici, sur le clone qui vient
  // d'être inséré dans le vrai document.
  applyStaticTranslations();

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const form = backdrop.querySelector('#quick-add-form');
  const segButtons = backdrop.querySelectorAll('.segmented-btn');
  const targetWalletRow = backdrop.querySelector('[data-field="targetWalletRow"]');
  const categoryRow = backdrop.querySelector('[data-field="categoryRow"]');
  const amountRow = backdrop.querySelector('[data-field="amountRow"]');
  const splitToggleRow = backdrop.querySelector('[data-field="splitToggleRow"]');
  const splitToggleBtn = backdrop.querySelector('#qa-split-toggle');
  const splitRowsWrap = backdrop.querySelector('[data-field="splitRows"]');
  const splitList = backdrop.querySelector('#qa-split-list');
  const splitAddBtn = backdrop.querySelector('#qa-split-add');
  const splitTotalEl = backdrop.querySelector('#qa-split-total');
  const titleEl = backdrop.querySelector('#qa-title');
  const walletSelect = form.elements.walletId;
  const targetWalletSelect = form.elements.targetWalletId;
  const categorySelect = form.elements.categoryId;
  const receiptInput = form.elements.receipt;
  const receiptTriggerBtn = backdrop.querySelector('#qa-receipt-trigger');
  const receiptPreviewWrap = backdrop.querySelector('#qa-receipt-preview');
  const receiptPreviewImg = backdrop.querySelector('#qa-receipt-preview-img');
  const receiptRemoveBtn = backdrop.querySelector('#qa-receipt-remove');
  const receiptScanBtn = backdrop.querySelector('#qa-receipt-scan');

  let currentType = editTransaction?.type || 'expense';
  let splitMode = false;
  let allWallets = [];
  let receiptRemoved = false;

  function showReceiptPreview(blob) {
    receiptPreviewImg.src = URL.createObjectURL(blob);
    receiptPreviewWrap.hidden = false;
  }
  if (editTransaction?.receiptBlob) showReceiptPreview(editTransaction.receiptBlob);

  // Bouton stylé à la place du bouton natif de <input type="file"> : son libellé ("Choisir un
  // fichier"/"Aucun fichier choisi") suit la langue du NAVIGATEUR (pas celle de la page), donc
  // notre i18n ne peut jamais le traduire — voir data-i18n="Choisir un fichier" sur ce bouton.
  receiptTriggerBtn.addEventListener('click', () => receiptInput.click());
  receiptInput.addEventListener('change', () => {
    receiptRemoved = false;
    if (receiptInput.files[0]) showReceiptPreview(receiptInput.files[0]);
  });
  receiptRemoveBtn.addEventListener('click', () => {
    receiptInput.value = '';
    receiptRemoved = true;
    receiptPreviewWrap.hidden = true;
  });

  receiptScanBtn.addEventListener('click', async () => {
    const source = receiptInput.files[0] || (!receiptRemoved && editTransaction?.receiptBlob) || null;
    if (!source) return;
    const originalLabel = receiptScanBtn.textContent;
    receiptScanBtn.textContent = tr('Analyse en cours…');
    receiptScanBtn.disabled = true;
    try {
      const amount = await extractAmountFromImage(source);
      if (amount != null && !splitMode) {
        form.elements.amount.value = amount.toFixed(2);
        showToast(tr("Montant détecté : {amount} — vérifiez avant d'enregistrer.", { amount: amount.toFixed(2) }));
      } else if (amount != null) {
        showToast(tr('Montant détecté : {amount} — ajoutez-le manuellement à une ligne (mode scindé).', { amount: amount.toFixed(2) }));
      } else {
        showToast(tr('Aucun montant détecté sur cette photo, saisissez-le manuellement.'));
      }
    } catch (err) {
      console.warn('[OCR]', err);
      showToast(tr('Échec de la lecture automatique. Saisissez le montant manuellement.'));
    } finally {
      receiptScanBtn.textContent = originalLabel;
      receiptScanBtn.disabled = false;
    }
  });

  function updateSplitTotal() {
    const rows = [...splitList.querySelectorAll('[data-split-row]')];
    const sum = rows.reduce((s, row) => s + (parseFloat(row.querySelector('.split-amount').value) || 0), 0);
    splitTotalEl.textContent = tr('Total : {sum}', { sum: sum.toFixed(2) });
  }

  function addSplitRow(categoryId = '') {
    const row = document.createElement('div');
    row.dataset.splitRow = '1';
    row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';
    row.innerHTML = `
      <select class="split-category" style="flex:2;"></select>
      <input type="number" step="0.01" min="0" class="split-amount" placeholder="0.00" style="flex:1;">
      <button type="button" class="icon-btn split-remove" aria-label="${tr('Retirer')}">${DELETE_ICON}</button>`;
    splitList.appendChild(row);
    row.querySelector('.split-category').innerHTML = categorySelect.innerHTML;
    if (categoryId) row.querySelector('.split-category').value = categoryId;
    row.querySelector('.split-amount').addEventListener('input', updateSplitTotal);
    row.querySelector('.split-remove').addEventListener('click', () => { row.remove(); updateSplitTotal(); });
  }

  function setSplitMode(on) {
    splitMode = on && currentType !== 'transfer';
    amountRow.hidden = splitMode;
    categoryRow.hidden = splitMode || currentType === 'transfer';
    splitRowsWrap.hidden = !splitMode;
    splitToggleBtn.textContent = splitMode ? tr('Revenir à une seule catégorie') : tr('Diviser en plusieurs catégories');
    form.elements.amount.required = !splitMode;
    categorySelect.required = !splitMode && currentType !== 'transfer';
    if (splitMode && !splitList.children.length) {
      addSplitRow();
      addSplitRow();
      updateSplitTotal();
    }
  }

  splitToggleBtn.addEventListener('click', () => setSplitMode(!splitMode));
  splitAddBtn.addEventListener('click', () => { addSplitRow(); updateSplitTotal(); });

  async function populateWallets() {
    allWallets = (await dbGetAll(STORES.WALLETS)).filter((w) => !w.archived);
    const opts = allWallets.map((w) => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.currency)})</option>`).join('');
    walletSelect.innerHTML = opts || `<option value="">${tr("Créez un portefeuille d'abord")}</option>`;
    refreshTargetWalletOptions();
  }

  // Un "transfert" applique le même montant brut aux deux portefeuilles (voir ledger.js,
  // walletBalancesAsOf : -amt sur la source, +amt sur la cible, sans conversion). Autoriser un
  // portefeuille cible dans une AUTRE devise créerait donc silencieusement de l'argent (100 EUR
  // devenant 100 USD) — une dérive invisible qui ne se découvre qu'au rapprochement. On restreint
  // la liste des cibles à la devise du portefeuille source ; un déplacement entre devises
  // différentes doit être saisi comme deux transactions (dépense + recette) avec le vrai montant
  // converti de chaque côté.
  function refreshTargetWalletOptions() {
    const source = allWallets.find((w) => w.id === walletSelect.value);
    const prevTarget = targetWalletSelect.value;
    const eligible = source ? allWallets.filter((w) => w.id !== source.id && w.currency === source.currency) : allWallets;
    targetWalletSelect.innerHTML = eligible.map((w) => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.currency)})</option>`).join('')
      || `<option value="">${tr('Aucun autre portefeuille dans cette devise')}</option>`;
    if (eligible.some((w) => w.id === prevTarget)) targetWalletSelect.value = prevTarget;
  }
  walletSelect.addEventListener('change', refreshTargetWalletOptions);

  async function populateCategories() {
    const all = await dbGetAll(STORES.CATEGORIES);
    const roots = all.filter((c) => c.type === currentType && !c.parentId);
    let html = '';
    for (const r of roots) {
      html += `<option value="${r.id}">${escapeHtml(r.name)}</option>`;
      for (const child of all.filter((c) => c.parentId === r.id)) {
        html += `<option value="${child.id}">— ${escapeHtml(child.name)}</option>`;
      }
    }
    categorySelect.innerHTML = html || `<option value="">${tr('Aucune catégorie (créez-en dans Budgets)')}</option>`;
  }

  function setType(type) {
    currentType = type;
    if (type === 'transfer' && splitMode) setSplitMode(false);
    segButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.value === type));
    targetWalletRow.hidden = type !== 'transfer';
    categoryRow.hidden = type === 'transfer' || splitMode;
    splitToggleRow.hidden = type === 'transfer';
    targetWalletSelect.required = type === 'transfer';
    categorySelect.required = type !== 'transfer' && !splitMode;
    titleEl.textContent = editTransaction ? tr('Modifier la transaction') : (type === 'transfer' ? tr('Transfert entre portefeuilles') : tr('Saisie express'));
    if (type !== 'transfer') {
      populateCategories().then(() => {
        splitList.querySelectorAll('.split-category').forEach((sel) => {
          const prevVal = sel.value;
          sel.innerHTML = categorySelect.innerHTML;
          sel.value = prevVal;
        });
      });
    }
  }

  segButtons.forEach((b) => b.addEventListener('click', () => setType(b.dataset.value)));

  /* Auto-catégorisation : si la note ressemble à une transaction déjà catégorisée,
     pré-sélectionne sa catégorie (tant que l'utilisateur n'a pas choisi la sienne). */
  let categoryTouchedByUser = !!editTransaction;
  categorySelect.addEventListener('change', () => { categoryTouchedByUser = true; });

  async function suggestCategoryFromNote() {
    if (categoryTouchedByUser || currentType === 'transfer') return;
    const note = form.elements.note.value;
    const categoryId = await guessCategoryId(note, currentType);
    if (categoryId && categorySelect.querySelector(`option[value="${categoryId}"]`)) {
      categorySelect.value = categoryId;
    }
  }
  let suggestDebounce = null;
  form.elements.note.addEventListener('input', () => {
    clearTimeout(suggestDebounce);
    suggestDebounce = setTimeout(suggestCategoryFromNote, 250);
  });

  (async () => {
    await populateWallets();
    setType(currentType);
    form.elements.date.value = editTransaction?.date || todayISO();
    form.elements.amount.value = editTransaction?.amount ?? '';
    form.elements.note.value = editTransaction?.note || '';
    form.elements.tags.value = (editTransaction?.tags || []).join(', ');
    if (editTransaction) {
      walletSelect.value = editTransaction.walletId;
      refreshTargetWalletOptions();
      if (editTransaction.type === 'transfer') {
        // Un transfert existant entre devises différentes (saisi avant ce correctif, ou dont un
        // portefeuille a changé de devise depuis) doit rester éditable — on l'ajoute explicitement
        // à la liste au lieu de le masquer silencieusement, ce qui viderait la sélection.
        if (![...targetWalletSelect.options].some((o) => o.value === editTransaction.targetWalletId)) {
          const w = allWallets.find((x) => x.id === editTransaction.targetWalletId);
          if (w) targetWalletSelect.insertAdjacentHTML('beforeend', `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.currency)})</option>`);
        }
        targetWalletSelect.value = editTransaction.targetWalletId;
      }
      else categorySelect.value = editTransaction.categoryId || '';
      splitToggleRow.hidden = true;
    }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const type = currentType;
    const walletId = fd.get('walletId');
    const targetWalletId = type === 'transfer' ? fd.get('targetWalletId') : null;

    if (!walletId) { showToast(tr('Créez au moins un portefeuille avant de saisir une transaction.')); return; }
    if (type === 'transfer' && walletId === targetWalletId) { showToast(tr('Choisissez deux portefeuilles différents.')); return; }

    const receiptBlob = receiptInput.files[0] || (receiptRemoved ? null : editTransaction?.receiptBlob || null);

    if (splitMode && type !== 'transfer') {
      const rows = [...splitList.querySelectorAll('[data-split-row]')]
        .map((row) => ({
          categoryId: row.querySelector('.split-category').value,
          amount: safeNumber(parseFloat(row.querySelector('.split-amount').value)),
        }))
        .filter((r) => r.amount > 0);
      if (rows.length < 2) { showToast(tr('Ajoutez au moins deux lignes avec un montant.')); return; }

      const splitGroupId = uuid();
      const date = fd.get('date');
      const note = (fd.get('note') || '').trim().slice(0, 140);
      const tags = parseTags(fd.get('tags'));
      for (const r of rows) {
        const splitRecord = {
          id: uuid(), type, walletId, targetWalletId: null,
          categoryId: r.categoryId || null, amount: r.amount, date, note, tags, receiptBlob,
          reconciled: false, splitGroupId, createdAt: new Date().toISOString(),
        };
        await dbAdd(STORES.TRANSACTIONS, splitRecord);
        await logAudit({ entityType: 'transaction', entityId: splitRecord.id, action: 'create', after: splitRecord, note: tr('Transaction scindée') });
      }
      close();
      showToast(tr('{count} transactions créées (scindées).', { count: rows.length }));
      notifyDataChanged('transactions');
      return;
    }

    const record = {
      id: editTransaction?.id || uuid(),
      type,
      walletId,
      targetWalletId,
      categoryId: type !== 'transfer' ? (fd.get('categoryId') || null) : null,
      amount: safeNumber(parseFloat(fd.get('amount'))),
      date: fd.get('date'),
      note: (fd.get('note') || '').trim().slice(0, 140),
      tags: parseTags(fd.get('tags')),
      receiptBlob,
      // Préserve le lien vers ses lignes sœurs : ce record remplace intégralement l'ancien
      // (dbPut), donc omettre splitGroupId ici détacherait silencieusement une ligne scindée de
      // son groupe dès qu'on modifie ne serait-ce que sa note ou sa date.
      splitGroupId: editTransaction?.splitGroupId || undefined,
      reconciled: editTransaction?.reconciled || false,
      createdAt: editTransaction?.createdAt || new Date().toISOString(),
    };
    const before = editTransaction ? { ...editTransaction } : null;
    await dbPut(STORES.TRANSACTIONS, record);
    await logAudit({ entityType: 'transaction', entityId: record.id, action: editTransaction ? 'update' : 'create', before, after: record });
    close();
    showToast(editTransaction ? tr('Transaction modifiée.') : tr('Transaction enregistrée.'));
    notifyDataChanged('transactions');

    if (record.type === 'expense' && record.categoryId) {
      const warning = await checkUnusualExpense(record.categoryId, record.amount, record.walletId, record.id);
      if (warning) {
        const catName = (categorySelect.selectedOptions[0]?.textContent || '').replace(/^—\s*/, '').trim();
        const ratio = Math.round(warning.ratio * 10) / 10;
        const average = formatCurrency(warning.average, warning.currency);
        const message = catName
          ? tr('Dépense {ratio}x plus élevée que votre moyenne habituelle pour {catName} (~{average}).', { ratio, catName, average })
          : tr('Dépense {ratio}x plus élevée que votre moyenne habituelle (~{average}).', { ratio, average });
        showToast(message, { duration: 6000 });
      }
    }
  });
}

/* ==========================================================================
   Rapprochement bancaire assisté
   L'utilisateur saisit le solde de clôture de son relevé ; l'app compare ce
   solde au solde des transactions déjà pointées et met en évidence les
   transactions non pointées de la période pour aider à résorber l'écart,
   plutôt que de pointer une par une sans repère.
   ========================================================================== */
async function reconciledBalanceAsOf(walletId, cutoffDate) {
  const [wallets, allTx] = await Promise.all([dbGetAll(STORES.WALLETS), dbGetAll(STORES.TRANSACTIONS)]);
  const wallet = wallets.find((w) => w.id === walletId);
  let balance = wallet?.initialBalance || 0;
  for (const t of allTx) {
    if (!t.reconciled) continue;
    if (cutoffDate && t.date > cutoffDate) continue;
    const amt = Number(t.amount) || 0;
    if (t.walletId === walletId) {
      if (t.type === 'income') balance += amt;
      else if (t.type === 'expense' || t.type === 'transfer') balance -= amt;
    }
    if (t.type === 'transfer' && t.targetWalletId === walletId) balance += amt;
  }
  return balance;
}

function reconTxRowHtml(t, currency) {
  const isTransfer = t.type === 'transfer';
  const title = isTransfer ? `${t.wallet?.name || '—'} → ${t.targetWallet?.name || '—'}` : (t.category?.name || tr('Sans catégorie'));
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '';
  return `
    <div class="tx-row" data-tx-id="${t.id}">
      <div class="tx-main">
        <div class="tx-title">${escapeHtml(title)}</div>
        <div class="tx-sub">${formatDate(t.date)}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
      </div>
      <div class="tx-amount amount ${cls}">${sign}${formatCurrency(t.amount, currency)}</div>
      <button type="button" class="btn btn-ghost" data-recon-tx="${t.id}" style="padding:4px 10px;font-size:12.5px;">${tr('Pointer')}</button>
    </div>`;
}

function openReconciliationModal() {
  const modal = openModal(`
    <div class="form-row">
      <label>${tr('Portefeuille')}</label>
      <select id="recon-wallet"></select>
    </div>
    <div class="form-row">
      <label>${tr('Date du relevé')}</label>
      <input type="date" id="recon-date" value="${todayISO()}">
    </div>
    <div class="form-row">
      <label>${tr('Solde de clôture du relevé')}</label>
      <input type="number" step="0.01" id="recon-balance" inputmode="decimal" placeholder="0.00">
    </div>
    <button type="button" class="btn btn-primary btn-block" id="recon-calc">${tr("Calculer l'écart")}</button>
    <div id="recon-result" style="margin-top:16px;"></div>
  `, { title: tr('Rapprochement bancaire') });

  const walletSelect = modal.el.querySelector('#recon-wallet');
  const dateInput = modal.el.querySelector('#recon-date');
  const balanceInput = modal.el.querySelector('#recon-balance');
  const resultEl = modal.el.querySelector('#recon-result');

  async function renderResult() {
    const walletId = walletSelect.value;
    const cutoff = dateInput.value;
    const statementBalance = parseFloat(balanceInput.value);
    if (!walletId || !cutoff || Number.isNaN(statementBalance)) { resultEl.innerHTML = ''; return; }

    const wallets = await dbGetAll(STORES.WALLETS);
    const wallet = wallets.find((w) => w.id === walletId);
    const reconciled = await reconciledBalanceAsOf(walletId, cutoff);
    const diff = Math.round((statementBalance - reconciled) * 100) / 100;
    const isBalanced = Math.abs(diff) < 0.005;
    const unreconciled = (await getEnrichedTransactions({ walletId })).filter((t) => !t.reconciled && t.date <= cutoff);

    resultEl.innerHTML = `
      <div class="panel" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;"><span>${tr('Solde pointé (app)')}</span><strong>${formatCurrency(reconciled, wallet.currency)}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;"><span>${tr('Solde du relevé')}</span><strong>${formatCurrency(statementBalance, wallet.currency)}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:${isBalanced ? 'var(--pos)' : 'var(--neg)'};"><span>${tr('Écart')}</span><strong>${formatCurrency(diff, wallet.currency)}</strong></div>
      </div>
      ${isBalanced
        ? `<p class="empty-state" style="padding:8px 0;">✓ ${tr('Rapprochement exact, aucun écart.')}</p>`
        : unreconciled.length
          ? `<p style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">${tr('{count} transaction(s) non pointée(s) jusqu\'à cette date — pointez celles qui apparaissent sur le relevé pour résorber l\'écart :', { count: unreconciled.length })}</p>
             <div id="recon-tx-list">${unreconciled.map((t) => reconTxRowHtml(t, wallet.currency)).join('')}</div>`
          : `<p class="empty-state" style="padding:8px 0;">${tr("Aucune transaction non pointée sur cette période — l'écart provient peut-être d'une transaction manquante ou d'une date de relevé incorrecte.")}</p>`
      }`;

    resultEl.querySelectorAll('[data-recon-tx]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const txId = btn.dataset.reconTx;
        const all = await dbGetAll(STORES.TRANSACTIONS);
        const t = all.find((x) => x.id === txId);
        if (!t) return;
        const before = { ...t };
        t.reconciled = true;
        await dbPut(STORES.TRANSACTIONS, t);
        await logAudit({ entityType: 'transaction', entityId: t.id, action: 'update', before, after: t, note: tr('Pointée (rapprochement assisté)') });
        notifyDataChanged('transactions');
        renderResult();
      });
    });
  }

  (async () => {
    const wallets = (await dbGetAll(STORES.WALLETS)).filter((w) => !w.archived);
    walletSelect.innerHTML = wallets.map((w) => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.currency)})</option>`).join('');
  })();

  modal.el.querySelector('#recon-calc').addEventListener('click', renderResult);
}

/* ==========================================================================
   Liste des transactions (vue complète, filtrable)
   ========================================================================== */
const filters = { monthKey: currentMonthKey(), walletId: '', categoryId: '', type: '', reconciled: '' };
let bulkMode = false;
const selectedIds = new Set();
let visibleIds = [];

function txRowHtml(t) {
  const isTransfer = t.type === 'transfer';
  const title = isTransfer ? `${t.wallet?.name || '—'} → ${t.targetWallet?.name || '—'}` : (t.category?.name || tr('Sans catégorie'));
  const sub = `${escapeHtml(t.wallet?.name || '')} · ${formatDate(t.date)}${t.note ? ' · ' + escapeHtml(t.note) : ''}${t.splitGroupId ? ' · ' + tr('Scindée') : ''}`;
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '';
  const currency = t.wallet?.currency || 'EUR';
  const tagsHtml = t.tags?.length ? `<div class="tx-tags">${t.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  const checkboxHtml = bulkMode
    ? `<input type="checkbox" class="tx-select" data-tx-select="${t.id}" ${selectedIds.has(t.id) ? 'checked' : ''} style="width:18px;height:18px;flex-shrink:0;">`
    : '';

  return `
    <div class="tx-row" data-tx-id="${t.id}">
      ${checkboxHtml}
      <div class="tx-icon">${TX_ICONS[t.type] || ''}</div>
      <div class="tx-main">
        <div class="tx-title">${escapeHtml(title)}</div>
        <div class="tx-sub">${sub}</div>
        ${tagsHtml}
      </div>
      <div class="tx-amount amount ${cls}" data-value="${t.amount}">${sign}${formatCurrency(t.amount, currency)}</div>
      <div class="card-actions">
        ${t.receiptBlob ? `<button type="button" class="icon-btn" data-action="view-receipt" aria-label="${tr('Voir le justificatif')}" title="${tr('Voir le justificatif')}">${RECEIPT_ICON}</button>` : ''}
        <button type="button" class="icon-btn" data-action="reconcile" aria-label="${t.reconciled ? tr('Pointée (cliquer pour annuler)') : tr('Marquer comme pointée')}" title="${t.reconciled ? tr('Pointée (cliquer pour annuler)') : tr('Marquer comme pointée')}" style="color:${t.reconciled ? 'var(--pos)' : 'var(--text-faint)'}">
          ${t.reconciled ? CHECK_CIRCLE : EMPTY_CIRCLE}
        </button>
        <button type="button" class="icon-btn" data-action="edit" aria-label="${tr('Modifier')}" title="${tr('Modifier')}">${EDIT_ICON}</button>
        <button type="button" class="icon-btn" data-action="delete" aria-label="${tr('Supprimer')}" title="${tr('Supprimer')}">${DELETE_ICON}</button>
      </div>
    </div>`;
}

async function renderList() {
  const container = document.getElementById('transactions-list');
  if (!container) return;
  let rows = await getEnrichedTransactions({
    monthKey: filters.monthKey,
    walletId: filters.walletId || null,
    categoryId: filters.categoryId || null,
    type: filters.type || null,
  });
  if (filters.reconciled === 'yes') rows = rows.filter((r) => r.reconciled);
  if (filters.reconciled === 'no') rows = rows.filter((r) => !r.reconciled);
  visibleIds = rows.map((r) => r.id);
  for (const id of [...selectedIds]) { if (!visibleIds.includes(id)) selectedIds.delete(id); }

  container.innerHTML = rows.length ? rows.map(txRowHtml).join('') : `<div class="tx-empty">${tr('Aucune transaction pour ces filtres.')}</div>`;

  if (bulkMode) {
    container.querySelectorAll('[data-tx-select]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.dataset.txSelect);
        else selectedIds.delete(cb.dataset.txSelect);
        renderBulkBar();
      });
    });
  }
  renderBulkBar();
}

/* ---------- Sélection multiple / édition groupée ---------- */
function toggleBulkMode(on) {
  bulkMode = on;
  selectedIds.clear();
  document.getElementById('transaction-bulk-toggle-btn')?.classList.toggle('is-active', on);
  renderList();
}

async function openBulkCategorizeModal() {
  const categories = await dbGetAll(STORES.CATEGORIES);
  const roots = categories.filter((c) => !c.parentId);
  const optionsHtml = roots.map((r) => {
    const children = categories.filter((c) => c.parentId === r.id).map((ch) => `<option value="${ch.id}">— ${escapeHtml(ch.name)}</option>`).join('');
    return `<option value="${r.id}">${escapeHtml(r.name)}</option>${children}`;
  }).join('');
  const modal = openModal(`
    <div class="form-row"><label>${tr('Nouvelle catégorie pour {count} transaction(s)', { count: selectedIds.size })}</label><select id="bulk-category-select">${optionsHtml}</select></div>
    <button type="button" class="btn btn-primary btn-block" id="bulk-category-confirm">${tr('Appliquer')}</button>
  `, { title: tr('Changer la catégorie') });

  modal.el.querySelector('#bulk-category-confirm').addEventListener('click', async () => {
    const categoryId = modal.el.querySelector('#bulk-category-select').value;
    const all = await dbGetAll(STORES.TRANSACTIONS);
    for (const id of selectedIds) {
      const t = all.find((x) => x.id === id);
      if (!t) continue;
      const before = { ...t };
      t.categoryId = categoryId;
      await dbPut(STORES.TRANSACTIONS, t);
      await logAudit({ entityType: 'transaction', entityId: t.id, action: 'update', before, after: t, note: tr('Catégorisation groupée') });
    }
    modal.close();
    showToast(tr('{count} transaction(s) recatégorisée(s).', { count: selectedIds.size }));
    notifyDataChanged('transactions');
  });
}

async function bulkSetReconciled(reconciled) {
  const all = await dbGetAll(STORES.TRANSACTIONS);
  for (const id of selectedIds) {
    const t = all.find((x) => x.id === id);
    if (!t || t.reconciled === reconciled) continue;
    const before = { ...t };
    t.reconciled = reconciled;
    await dbPut(STORES.TRANSACTIONS, t);
    await logAudit({ entityType: 'transaction', entityId: t.id, action: 'update', before, after: t, note: reconciled ? tr('Pointée (groupé)') : tr('Dépointée (groupé)') });
  }
  showToast(tr('{count} transaction(s) mise(s) à jour.', { count: selectedIds.size }));
  notifyDataChanged('transactions');
}

async function bulkDelete() {
  const count = selectedIds.size;
  const ok = await confirmDialog(tr('Supprimer {count} transaction(s) sélectionnée(s) ?', { count }), { danger: true, confirmText: tr('Supprimer') });
  if (!ok) return;
  const all = await dbGetAll(STORES.TRANSACTIONS);
  const deleted = [];
  for (const id of selectedIds) {
    const t = all.find((x) => x.id === id);
    if (!t) continue;
    deleted.push(t);
    await dbDelete(STORES.TRANSACTIONS, id);
    await logAudit({ entityType: 'transaction', entityId: id, action: 'delete', before: t, note: tr('Suppression groupée') });
  }
  selectedIds.clear();
  notifyDataChanged('transactions');
  showToast(tr('{count} transaction(s) supprimée(s).', { count: deleted.length }), {
    actionLabel: tr('Annuler'),
    onAction: async () => {
      for (const t of deleted) {
        await dbAdd(STORES.TRANSACTIONS, t);
        await logAudit({ entityType: 'transaction', entityId: t.id, action: 'create', after: t, note: tr('Restaurée (annulation groupée)') });
      }
      showToast(tr('{count} transaction(s) restaurée(s).', { count: deleted.length }));
      notifyDataChanged('transactions');
    },
  });
}

async function renderBulkBar() {
  const bar = document.getElementById('transactions-bulk-bar');
  if (!bar) return;
  if (!bulkMode) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  const count = selectedIds.size;
  const allSelected = visibleIds.length > 0 && count === visibleIds.length;
  bar.innerHTML = `
    <div class="filters-bar" style="align-items:center;background:var(--surface-alt);border-radius:10px;padding:8px 12px;">
      <span style="font-size:13px;font-weight:700;">${tr('{count} sélectionnée(s)', { count })}</span>
      <button type="button" class="btn btn-ghost" id="bulk-select-all">${allSelected ? tr('Tout désélectionner') : tr('Tout sélectionner')}</button>
      ${count ? `
        <button type="button" class="btn btn-ghost" id="bulk-categorize">${tr('Changer la catégorie')}</button>
        <button type="button" class="btn btn-ghost" id="bulk-reconcile">${tr('Marquer pointées')}</button>
        <button type="button" class="btn btn-ghost" id="bulk-unreconcile">${tr('Marquer non pointées')}</button>
        <button type="button" class="btn btn-danger" id="bulk-delete">${tr('Supprimer')}</button>
      ` : ''}
    </div>`;

  bar.querySelector('#bulk-select-all').addEventListener('click', () => {
    if (allSelected) selectedIds.clear();
    else visibleIds.forEach((id) => selectedIds.add(id));
    renderList();
  });
  bar.querySelector('#bulk-categorize')?.addEventListener('click', () => openBulkCategorizeModal());
  bar.querySelector('#bulk-reconcile')?.addEventListener('click', () => bulkSetReconciled(true));
  bar.querySelector('#bulk-unreconcile')?.addEventListener('click', () => bulkSetReconciled(false));
  bar.querySelector('#bulk-delete')?.addEventListener('click', () => bulkDelete());
}

async function renderFiltersBar() {
  const bar = document.getElementById('transactions-filters');
  if (!bar) return;
  const [wallets, categories] = await Promise.all([dbGetAll(STORES.WALLETS), dbGetAll(STORES.CATEGORIES)]);

  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:4px;">
      <button type="button" class="icon-btn" id="tx-prev-month" aria-label="${tr('Mois précédent')}">‹</button>
      <strong style="min-width:130px;text-align:center;display:inline-block;">${formatMonthLabel(filters.monthKey)}</strong>
      <button type="button" class="icon-btn" id="tx-next-month" aria-label="${tr('Mois suivant')}">›</button>
    </div>
    <select id="tx-filter-wallet"><option value="">${tr('Tous les portefeuilles')}</option>${wallets.map((w) => `<option value="${w.id}" ${filters.walletId === w.id ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}</select>
    <select id="tx-filter-category"><option value="">${tr('Toutes catégories')}</option>${categories.map((c) => `<option value="${c.id}" ${filters.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
    <select id="tx-filter-type">
      <option value="">${tr('Tous types')}</option>
      <option value="income" ${filters.type === 'income' ? 'selected' : ''}>${tr('Recettes')}</option>
      <option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>${tr('Dépenses')}</option>
      <option value="transfer" ${filters.type === 'transfer' ? 'selected' : ''}>${tr('Transferts')}</option>
    </select>
    <select id="tx-filter-reconciled">
      <option value="">${tr('Rapprochement : toutes')}</option>
      <option value="yes" ${filters.reconciled === 'yes' ? 'selected' : ''}>${tr('Pointées')}</option>
      <option value="no" ${filters.reconciled === 'no' ? 'selected' : ''}>${tr('Non pointées')}</option>
    </select>`;

  bar.querySelector('#tx-prev-month').onclick = () => { filters.monthKey = monthKeyOffset(filters.monthKey, -1); renderTransactions(); };
  bar.querySelector('#tx-next-month').onclick = () => { filters.monthKey = monthKeyOffset(filters.monthKey, 1); renderTransactions(); };
  bar.querySelector('#tx-filter-wallet').onchange = (e) => { filters.walletId = e.target.value; renderList(); };
  bar.querySelector('#tx-filter-category').onchange = (e) => { filters.categoryId = e.target.value; renderList(); };
  bar.querySelector('#tx-filter-type').onchange = (e) => { filters.type = e.target.value; renderList(); };
  bar.querySelector('#tx-filter-reconciled').onchange = (e) => { filters.reconciled = e.target.value; renderList(); };
}

export async function renderTransactions() {
  await renderFiltersBar();
  await renderList();
}

export function initTransactionsModule() {
  document.getElementById('transaction-add-btn')?.addEventListener('click', () => openQuickAdd());
  document.getElementById('transaction-reconcile-btn')?.addEventListener('click', () => openReconciliationModal());
  document.getElementById('transaction-bulk-toggle-btn')?.addEventListener('click', () => toggleBulkMode(!bulkMode));

  document.getElementById('transactions-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = e.target.closest('[data-tx-id]');
    const txId = row?.dataset.txId;
    const all = await dbGetAll(STORES.TRANSACTIONS);
    const t = all.find((x) => x.id === txId);
    if (!t) return;

    if (btn.dataset.action === 'view-receipt') {
      if (t.receiptBlob) openModal(`<img src="${URL.createObjectURL(t.receiptBlob)}" alt="${tr('Justificatif')}" style="max-width:100%;border-radius:8px;display:block;">`, { title: tr('Justificatif') });
    } else if (btn.dataset.action === 'reconcile') {
      const before = { ...t };
      t.reconciled = !t.reconciled;
      await dbPut(STORES.TRANSACTIONS, t);
      await logAudit({ entityType: 'transaction', entityId: t.id, action: 'update', before, after: t, note: t.reconciled ? tr('Pointée') : tr('Dépointée') });
      renderList();
    } else if (btn.dataset.action === 'edit') {
      openQuickAdd({ editTransaction: t });
    } else if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog(tr('Supprimer cette transaction ?'), { danger: true, confirmText: tr('Supprimer') });
      if (ok) {
        await dbDelete(STORES.TRANSACTIONS, txId);
        await logAudit({ entityType: 'transaction', entityId: txId, action: 'delete', before: t });
        notifyDataChanged('transactions');
        showToast(tr('Transaction supprimée.'), {
          actionLabel: tr('Annuler'),
          onAction: async () => {
            await dbAdd(STORES.TRANSACTIONS, t);
            await logAudit({ entityType: 'transaction', entityId: t.id, action: 'create', after: t, note: tr('Restaurée (annulation)') });
            showToast(tr('Transaction restaurée.'));
            notifyDataChanged('transactions');
          },
        });
      }
    }
  });
}
