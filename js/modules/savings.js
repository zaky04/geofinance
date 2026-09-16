/* ==========================================================================
   GeoFinance System — Module Épargne
   Objectifs personnalisés avec jauge de progression circulaire. Les
   objectifs sont des enveloppes de suivi manuel (indépendantes des
   portefeuilles) pour rester simples et éviter tout double comptage dans
   le patrimoine net (voir js/ledger.js).
   ========================================================================== */

import { STORES, dbGetAll, dbPut, dbDelete, logAudit, getSetting } from '../db.js';
import { uuid, formatCurrency, formatDate, escapeHtml, todayISO, percentage, openModal, confirmDialog, showToast, currencySelectHtml, wireCurrencySelect, readCurrencyValue, safeNumber } from '../utils.js';
import { notifyDataChanged } from '../state.js';
import { t } from '../i18n.js';

const EDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H2V5h4l1-2Z"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>';
const ARCHIVE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 4h18v4H3V4Zm1 6h16v10H4V10Zm4 3v2h8v-2H8Z"/></svg>';

function gaugeSvg(pct, color) {
  const r = 32, c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  return `
    <svg viewBox="0 0 80 80" width="72" height="72" style="transform:rotate(-90deg)">
      <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--border)" stroke-width="8"/>
      <circle cx="40" cy="40" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
    </svg>`;
}

function goalCardHtml(g) {
  const pct = percentage(g.currentAmount, g.targetAmount);
  const color = pct >= 100 ? 'var(--pos)' : 'var(--accent)';
  return `
    <div class="summary-card" data-goal-id="${g.id}">
      <div style="display:flex;gap:14px;align-items:center;">
        <div style="position:relative;width:72px;height:72px;flex-shrink:0;">
          ${gaugeSvg(pct, color)}
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;">${pct.toFixed(0)}%</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14.5px;">${escapeHtml(g.name)}</div>
          <div class="tx-sub amount" data-value="${g.currentAmount}">${formatCurrency(g.currentAmount, g.currency)} / ${formatCurrency(g.targetAmount, g.currency)}</div>
          ${g.targetDate ? `<div class="tx-sub">${t('Échéance : {date}', { date: formatDate(g.targetDate) })}</div>` : ''}
        </div>
      </div>
      <div class="card-actions" style="justify-content:flex-end;margin-top:10px;">
        <button type="button" class="icon-btn" data-action="contribute" aria-label="${t('Ajouter une contribution')}" title="${t('Ajouter une contribution')}">${ADD_ICON}</button>
        <button type="button" class="icon-btn" data-action="edit" aria-label="${t('Modifier')}" title="${t('Modifier')}">${EDIT_ICON}</button>
        <button type="button" class="icon-btn" data-action="archive" aria-label="${g.archived ? t('Désarchiver') : t('Archiver')}" title="${g.archived ? t('Désarchiver') : t('Archiver')}">${ARCHIVE_ICON}</button>
        <button type="button" class="icon-btn" data-action="delete" aria-label="${t('Supprimer')}" title="${t('Supprimer')}">${DELETE_ICON}</button>
      </div>
    </div>`;
}

function goalFormHtml(g, defaultCurrency) {
  return `
    <form id="goal-form">
      <div class="form-row"><label>${t("Nom de l'objectif")}</label><input type="text" name="name" required maxlength="60" value="${escapeHtml(g?.name || '')}" placeholder="${t("Ex: Fonds d'urgence, Voyage, Apport immobilier…")}"></div>
      <div class="form-row"><label>${t('Montant cible')}</label><input type="number" step="0.01" min="0" name="targetAmount" required value="${g?.targetAmount ?? ''}"></div>
      <div class="form-row"><label>${t('Montant déjà épargné')}</label><input type="number" step="0.01" min="0" name="currentAmount" value="${g?.currentAmount ?? 0}"></div>
      <div class="form-row"><label>${t('Devise')}</label>${currencySelectHtml(g?.currency || defaultCurrency)}</div>
      <div class="form-row"><label>${t('Date cible (optionnel)')}</label><input type="date" name="targetDate" value="${g?.targetDate || ''}"></div>
      <button type="submit" class="btn btn-primary btn-block">${g ? t('Enregistrer') : t("Créer l'objectif")}</button>
    </form>`;
}

async function openGoalModal(g = null) {
  const defaultCurrency = g ? g.currency : await getSetting('baseCurrency', 'EUR');
  const modal = openModal(goalFormHtml(g, defaultCurrency), { title: g ? t("Modifier l'objectif") : t("Nouvel objectif d'épargne") });
  wireCurrencySelect(modal.el);
  modal.el.querySelector('#goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const before = g ? { ...g } : null;
    const record = {
      id: g?.id || uuid(),
      name: fd.get('name').trim(),
      targetAmount: safeNumber(parseFloat(fd.get('targetAmount'))),
      currentAmount: safeNumber(parseFloat(fd.get('currentAmount'))),
      currency: readCurrencyValue(e.target),
      targetDate: fd.get('targetDate') || null,
      archived: g?.archived || false,
      createdAt: g?.createdAt || new Date().toISOString(),
    };
    await dbPut(STORES.SAVINGS_GOALS, record);
    await logAudit({ entityType: 'savingsGoal', entityId: record.id, action: g ? 'update' : 'create', before, after: record });
    modal.close();
    showToast(g ? t('Objectif mis à jour.') : t('Objectif créé.'));
    notifyDataChanged('savings');
  });
}

function openContributeModal(g) {
  const modal = openModal(`
    <form id="contribute-form">
      <div class="form-row"><label>${t('Montant à ajouter')}</label><input type="number" step="0.01" name="amount" required autofocus></div>
      <div class="form-row"><label>${t('Date')}</label><input type="date" name="date" value="${todayISO()}"></div>
      <button type="submit" class="btn btn-primary btn-block">${t('Ajouter')}</button>
    </form>`, { title: t('Contribution — {name}', { name: g.name }) });
  modal.el.querySelector('#contribute-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = safeNumber(parseFloat(new FormData(e.target).get('amount')));
    const before = { ...g };
    g.currentAmount = (g.currentAmount || 0) + amount;
    await dbPut(STORES.SAVINGS_GOALS, g);
    await logAudit({ entityType: 'savingsGoal', entityId: g.id, action: 'update', before, after: g, note: t('Contribution de {amount}', { amount }) });
    modal.close();
    showToast(t('Contribution ajoutée.'));
    notifyDataChanged('savings');
  });
}

export async function renderSavings() {
  const container = document.getElementById('savings-content');
  if (!container) return;
  const goals = await dbGetAll(STORES.SAVINGS_GOALS);
  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);

  container.innerHTML = active.length || archived.length
    ? active.map(goalCardHtml).join('') + (archived.length ? `<div style="grid-column:1/-1;font-size:12.5px;color:var(--text-faint);font-weight:700;margin-top:8px;">${t('ARCHIVÉS')}</div>${archived.map(goalCardHtml).join('')}` : '')
    : `<div class="empty-state">${t("Aucun objectif d'épargne. Créez-en un pour visualiser votre progression.")}</div>`;
}

export function initSavingsModule() {
  document.getElementById('savings-add-btn')?.addEventListener('click', () => openGoalModal());

  document.getElementById('savings-content')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = e.target.closest('[data-goal-id]');
    const goals = await dbGetAll(STORES.SAVINGS_GOALS);
    const g = goals.find((x) => x.id === card?.dataset.goalId);
    if (!g) return;

    if (btn.dataset.action === 'contribute') {
      openContributeModal(g);
    } else if (btn.dataset.action === 'edit') {
      openGoalModal(g);
    } else if (btn.dataset.action === 'archive') {
      const before = { ...g };
      g.archived = !g.archived;
      await dbPut(STORES.SAVINGS_GOALS, g);
      await logAudit({ entityType: 'savingsGoal', entityId: g.id, action: 'update', before, after: g });
      showToast(g.archived ? t('Objectif archivé.') : t('Objectif désarchivé.'));
      notifyDataChanged('savings');
    } else if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog(t('Supprimer définitivement l\'objectif "{name}" ?', { name: g.name }), { danger: true, confirmText: t('Supprimer') });
      if (ok) {
        await dbDelete(STORES.SAVINGS_GOALS, g.id);
        await logAudit({ entityType: 'savingsGoal', entityId: g.id, action: 'delete', before: g });
        showToast(t('Objectif supprimé.'));
        notifyDataChanged('savings');
      }
    }
  });
}
