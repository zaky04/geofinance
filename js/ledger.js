/* ==========================================================================
   GeoFinance System — Moteur de calcul financier partagé
   Centralise tous les calculs (soldes, agrégats mensuels, historique du
   patrimoine) pour que dashboard/wallets/budgets/investissements/dettes/
   outils/rapports affichent des chiffres strictement cohérents entre eux.

   Convention patrimoine net = soldes portefeuilles + valeur investissements
   + créances - dettes. Les objectifs d'épargne ne sont PAS additionnés en
   plus : ce sont des enveloppes visuelles sur de l'argent déjà présent dans
   un portefeuille (pas un actif séparé), donc les compter à part créerait
   un double comptage.
   ========================================================================== */

import { STORES, dbGetAll, getSetting } from './db.js';
import { convertAmount, currentMonthKey, localISODate, intlLocale } from './utils.js';
// Aliasé en tr (pas t) : ce fichier utilise `t` comme nom de variable pour une transaction dans
// plusieurs fonctions — même piège documenté dans dashboard.js/transactions.js/debts.js/tools.js/
// reports-extras.js/search.js/backup.js.
import { t as tr } from './i18n.js';

async function ctx() {
  const [wallets, transactions, categories, budgets, investments, investmentEntries, debts, debtPayments, rates, rateHistory, baseCurrency] = await Promise.all([
    dbGetAll(STORES.WALLETS),
    dbGetAll(STORES.TRANSACTIONS),
    dbGetAll(STORES.CATEGORIES),
    dbGetAll(STORES.BUDGETS),
    dbGetAll(STORES.INVESTMENTS),
    dbGetAll(STORES.INVESTMENT_ENTRIES),
    dbGetAll(STORES.DEBTS),
    dbGetAll(STORES.DEBT_PAYMENTS),
    dbGetAll(STORES.EXCHANGE_RATES),
    dbGetAll(STORES.EXCHANGE_RATE_HISTORY),
    getSetting('baseCurrency', 'EUR'),
  ]);
  return { wallets, transactions, categories, budgets, investments, investmentEntries, debts, debtPayments, rates, rateHistory, baseCurrency };
}

function toBase(amount, currency, rates, baseCurrency) {
  return convertAmount(amount, currency, baseCurrency, rates, baseCurrency);
}

/** Reconstruit les taux tels qu'ils étaient à une date donnée : pour chaque devise, on prend
    l'entrée d'historique la plus récente à/avant cutoffDate, ou le taux actuel si aucun
    historique n'existe encore pour cette devise (compatibilité avec les données existantes). */
function ratesAsOf(cutoffDate, rates, rateHistory) {
  if (!cutoffDate) return rates;
  return rates.map((r) => {
    const past = rateHistory
      .filter((h) => h.code === r.code && h.date <= cutoffDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return past.length ? { ...r, rateToBase: past[0].rateToBase } : r;
  });
}

/** Solde de chaque portefeuille (dans SA propre devise), jusqu'à une date optionnelle incluse. */
export function walletBalancesAsOf(wallets, transactions, cutoffDate = null) {
  const balances = new Map(wallets.map((w) => [w.id, w.initialBalance || 0]));
  for (const t of transactions) {
    if (cutoffDate && t.date > cutoffDate) continue;
    const amt = Number(t.amount) || 0;
    if (t.type === 'income') {
      balances.set(t.walletId, (balances.get(t.walletId) || 0) + amt);
    } else if (t.type === 'expense') {
      balances.set(t.walletId, (balances.get(t.walletId) || 0) - amt);
    } else if (t.type === 'transfer') {
      balances.set(t.walletId, (balances.get(t.walletId) || 0) - amt);
      balances.set(t.targetWalletId, (balances.get(t.targetWalletId) || 0) + amt);
    }
  }
  return balances;
}

export async function getAllWalletBalances() {
  const { wallets, transactions } = await ctx();
  const balances = walletBalancesAsOf(wallets, transactions);
  return wallets.map((w) => ({ ...w, balance: balances.get(w.id) || 0 }));
}

export async function getWalletBalance(walletId) {
  const { wallets, transactions } = await ctx();
  return walletBalancesAsOf(wallets, transactions).get(walletId) || 0;
}

/** Valeur d'un investissement à une date donnée (dernière valorisation connue avant/à cette date). */
/** Valeur d'un investissement à une date donnée (dernière valorisation connue avant/à cette date).
    Si aucune valorisation n'a encore été saisie (avant cutoffDate), on reconstruit le capital NET
    investi à cette date (capital initial + apports - retraits, voir computeMetrics()/investments.js
    pour le même calcul en "temps réel") au lieu de renvoyer seulement le capital initial figé — sans
    ça, un apport ultérieur sans valorisation immédiate après (cas normal : on ne revalorise pas à
    chaque apport) faisait paraître l'investissement en perte immédiate (valeur < capital investi). */
export function investmentValueAsOf(investment, entries, cutoffDate) {
  const relevant = entries
    .filter((e) => e.investmentId === investment.id && e.type === 'valuation' && (!cutoffDate || e.date <= cutoffDate))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (relevant.length) return relevant[0].amount;
  if (cutoffDate && investment.createdAt && investment.createdAt.slice(0, 10) > cutoffDate) return 0;
  const own = entries.filter((e) => e.investmentId === investment.id && (!cutoffDate || e.date <= cutoffDate));
  const contributions = own.filter((e) => e.type === 'contribution').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const withdrawals = own.filter((e) => e.type === 'withdrawal').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return (investment.capitalInvested || 0) + contributions - withdrawals;
}

/** Montant restant dû d'une dette/créance à une date donnée. */
function debtRemainingAsOf(debt, payments, cutoffDate) {
  if (cutoffDate && debt.startDate && debt.startDate > cutoffDate) return 0;
  const paid = payments
    .filter((p) => p.debtId === debt.id && (!cutoffDate || p.date <= cutoffDate))
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return Math.max(0, (debt.principal || 0) - paid);
}

/** Cœur pur (aucun accès DB) de computeNetWorth, séparé pour que computeNetWorthHistory puisse
    l'appeler en boucle sur des données déjà chargées une seule fois — voir cette fonction pour le
    contexte (elle rechargeait ctx() à chaque mois, ~7x plus lent sur un historique de plusieurs
    années, mesuré à ~1,5s pour 6 mois avec 14 600 transactions contre ~200ms une fois corrigé). */
function netWorthAt(cutoffDate, { wallets, transactions, investments, investmentEntries, debts, debtPayments, rates, rateHistory, baseCurrency }) {
  const balances = walletBalancesAsOf(wallets, transactions, cutoffDate);
  const ratesForDate = ratesAsOf(cutoffDate, rates, rateHistory);

  let total = 0;
  for (const w of wallets) {
    if (cutoffDate && w.createdAt && w.createdAt.slice(0, 10) > cutoffDate) continue;
    total += toBase(balances.get(w.id) || 0, w.currency, ratesForDate, baseCurrency);
  }
  for (const inv of investments) {
    total += toBase(investmentValueAsOf(inv, investmentEntries, cutoffDate), inv.currency, ratesForDate, baseCurrency);
  }
  for (const d of debts) {
    const remaining = debtRemainingAsOf(d, debtPayments, cutoffDate);
    total += (d.type === 'receivable' ? 1 : -1) * toBase(remaining, d.currency, ratesForDate, baseCurrency);
  }
  return { total, currency: baseCurrency };
}

export async function computeNetWorth(cutoffDate = null) {
  return netWorthAt(cutoffDate, await ctx());
}

/** Répartition du patrimoine net (liquidités / investissements / dettes) à une date donnée, pour le donut de composition. */
export async function computeNetWorthComposition(cutoffDate = null) {
  const { wallets, transactions, investments, investmentEntries, debts, debtPayments, rates, rateHistory, baseCurrency } = await ctx();
  const balances = walletBalancesAsOf(wallets, transactions, cutoffDate);
  const ratesForDate = ratesAsOf(cutoffDate, rates, rateHistory);

  let liquid = 0, invested = 0, receivables = 0, debtTotal = 0;
  for (const w of wallets) {
    if (cutoffDate && w.createdAt && w.createdAt.slice(0, 10) > cutoffDate) continue;
    liquid += toBase(balances.get(w.id) || 0, w.currency, ratesForDate, baseCurrency);
  }
  for (const inv of investments) {
    invested += toBase(investmentValueAsOf(inv, investmentEntries, cutoffDate), inv.currency, ratesForDate, baseCurrency);
  }
  for (const d of debts) {
    const remaining = toBase(debtRemainingAsOf(d, debtPayments, cutoffDate), d.currency, ratesForDate, baseCurrency);
    if (d.type === 'receivable') receivables += remaining;
    else debtTotal += remaining;
  }
  return { liquid, invested, receivables, debts: debtTotal, currency: baseCurrency };
}

/** Historique du patrimoine net sur N mois (fin de chaque mois), pour le graphique de tendance.
    ctx() n'est chargé qu'une fois (voir netWorthAt) — même principe que computeInvestmentValueHistory/
    computeDebtHistory ci-dessous, qui elles n'avaient jamais eu ce problème. */
export async function computeNetWorthHistory(months = 6) {
  const data = await ctx();
  const points = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // dernier jour du mois
    const cutoff = localISODate(d);
    const { total } = netWorthAt(cutoff, data);
    points.push({ label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), value: Math.round(total * 100) / 100 });
  }
  return points;
}

/** Historique du patrimoine net, fin de chaque mois de l'ANNÉE donnée (Jan-Déc) — variante
    calendaire de computeNetWorthHistory() (qui est glissante sur les N derniers mois), pour
    partager le même sélecteur d'année que les autres courbes de la page Rapports. Pour l'année en
    cours, les mois futurs affichent simplement le patrimoine actuel (aucune transaction future ne
    peut exister) plutôt qu'une valeur artificiellement nulle. */
export async function computeNetWorthHistoryForYear(year) {
  const data = await ctx();
  const points = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(year, m + 1, 0); // dernier jour du mois
    const cutoff = localISODate(d);
    const { total } = netWorthAt(cutoff, data);
    points.push({ label: new Intl.DateTimeFormat(intlLocale(), { month: 'short', year: '2-digit' }).format(d), value: Math.round(total * 100) / 100 });
  }
  return points;
}

/** Historique de la valeur totale des investissements sur N mois (fin de chaque mois). */
export async function computeInvestmentValueHistory(months = 6) {
  const { investments, investmentEntries, rates, rateHistory, baseCurrency } = await ctx();
  const points = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const cutoff = localISODate(d);
    const ratesForDate = ratesAsOf(cutoff, rates, rateHistory);
    let total = 0;
    for (const inv of investments) {
      if (inv.createdAt && inv.createdAt.slice(0, 10) > cutoff) continue;
      total += toBase(investmentValueAsOf(inv, investmentEntries, cutoff), inv.currency, ratesForDate, baseCurrency);
    }
    points.push({ label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), value: Math.round(total * 100) / 100 });
  }
  return points;
}

/** Historique du total des dettes restant dues sur N mois (fin de chaque mois) — tendance de désendettement. */
export async function computeDebtHistory(months = 6) {
  const { debts, debtPayments, rates, rateHistory, baseCurrency } = await ctx();
  const activeDebts = debts.filter((d) => d.type === 'debt');
  const points = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const cutoff = localISODate(d);
    const ratesForDate = ratesAsOf(cutoff, rates, rateHistory);
    let total = 0;
    for (const debt of activeDebts) {
      total += toBase(debtRemainingAsOf(debt, debtPayments, cutoff), debt.currency, ratesForDate, baseCurrency);
    }
    points.push({ label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), value: Math.round(total * 100) / 100 });
  }
  return points;
}

/** Résumé du mois : entrées, sorties, épargne nette, cash-flow (converti en devise de base). */
export async function computeMonthSummary(monthKey = currentMonthKey()) {
  const { wallets, transactions, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  let income = 0, expenses = 0;
  for (const t of transactions) {
    if (!t.date || !t.date.startsWith(monthKey)) continue;
    if (t.debtId) continue; // mouvement de dette/créance : pas une dépense/recette discrétionnaire
    const cur = walletCurrency[t.walletId] || baseCurrency;
    const amt = toBase(Number(t.amount) || 0, cur, rates, baseCurrency);
    if (t.type === 'income') income += amt;
    else if (t.type === 'expense') expenses += amt;
  }
  const netSavings = income - expenses;
  return { income, expenses, netSavings, cashFlow: netSavings, currency: baseCurrency };
}

/** Entrées/sorties sur une plage de dates [startDate, endDate] incluses (YYYY-MM-DD), pour les
    résumés qui ne s'alignent pas sur un mois calendaire (ex : résumé hebdomadaire). */
export async function computeSpendingBetween(startDate, endDate) {
  const { wallets, transactions, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  let income = 0, expenses = 0;
  for (const t of transactions) {
    if (!t.date || t.date < startDate || t.date > endDate) continue;
    if (t.debtId) continue;
    const amt = toBase(Number(t.amount) || 0, walletCurrency[t.walletId] || baseCurrency, rates, baseCurrency);
    if (t.type === 'income') income += amt;
    else if (t.type === 'expense') expenses += amt;
  }
  return { income, expenses, netSavings: income - expenses, currency: baseCurrency };
}

/** Dépenses du mois groupées par catégorie (top 7 + "Autres"). Chaque ligne porte la couleur
    personnalisée de la catégorie (color, si définie) pour que le graphique et la liste utilisent
    la même teinte — null pour "Sans catégorie"/"Autres" (couleur de repli côté graphique). */
export async function computeExpensesByCategory(monthKey = currentMonthKey()) {
  const { wallets, transactions, categories, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const totals = new Map();
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.date || !t.date.startsWith(monthKey)) continue;
    if (t.debtId) continue;
    const cur = walletCurrency[t.walletId] || baseCurrency;
    const amt = toBase(Number(t.amount) || 0, cur, rates, baseCurrency);
    const cat = catById[t.categoryId];
    const key = cat?.id || 'none';
    const existing = totals.get(key);
    if (existing) existing.value += amt;
    else totals.set(key, { label: cat?.name || tr('Sans catégorie'), value: amt, color: cat?.color || null });
  }
  const sorted = [...totals.values()].sort((a, b) => b.value - a.value);
  if (sorted.length <= 8) return sorted;
  const top = sorted.slice(0, 7);
  const autres = sorted.slice(7).reduce((s, r) => s + r.value, 0);
  top.push({ label: 'Autres', value: autres, color: null });
  return top;
}

/** Historique mensuel (12 mois d'une année donnée) du total des transactions d'un type
    (income/expense), optionnellement filtré à une seule catégorie (categoryId null -> toutes
    catégories confondues). Alimente les courbes de variation mensuelle du tableau de bord,
    filtrables par année et par catégorie. */
export async function computeMonthlyTypeHistory(year, type = 'expense', categoryId = null) {
  const { wallets, transactions, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const totals = new Array(12).fill(0);
  for (const t of transactions) {
    if (t.type !== type || !t.date || !t.date.startsWith(String(year))) continue;
    if (t.debtId) continue;
    if (categoryId && t.categoryId !== categoryId) continue;
    const cur = walletCurrency[t.walletId] || baseCurrency;
    const amt = toBase(Number(t.amount) || 0, cur, rates, baseCurrency);
    const monthIdx = parseInt(t.date.slice(5, 7), 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) totals[monthIdx] += amt;
  }
  const points = totals.map((value, i) => ({
    label: new Intl.DateTimeFormat(intlLocale(), { month: 'short', year: '2-digit' }).format(new Date(year, i, 1)),
    value: Math.round(value * 100) / 100,
  }));
  return { points, currency: baseCurrency };
}

/** Catégories d'un type donné, triées par nom — pour peupler le filtre des courbes de variation. */
export async function getCategoriesByType(type) {
  const { categories } = await ctx();
  return categories.filter((c) => c.type === type).sort((a, b) => a.name.localeCompare(b.name));
}

/** Épargne nette mensuelle (revenus - dépenses) sur une année, avec le taux d'épargne (%) associé
    à chaque mois (0% si aucun revenu ce mois-là, plutôt qu'une division par zéro). */
export async function computeMonthlyNetSavingsHistory(year) {
  const [{ points: incomePoints, currency }, { points: expensePoints }] = await Promise.all([
    computeMonthlyTypeHistory(year, 'income', null),
    computeMonthlyTypeHistory(year, 'expense', null),
  ]);
  const points = incomePoints.map((p, i) => {
    const income = p.value;
    const expenses = expensePoints[i].value;
    const net = Math.round((income - expenses) * 100) / 100;
    const rate = income > 0 ? Math.round((net / income) * 1000) / 10 : 0;
    return { label: p.label, net, rate };
  });
  return { points, currency };
}

/** Historique mensuel (12 mois d'une année) budget vs réel — total sur les catégories budgétées ce
    mois-là, ou une seule catégorie si categoryId est fourni. Complément annuel à
    computeBudgetVsActual() qui ne couvre qu'un seul mois à la fois. Même convention que
    computeMonthlyBudgetSummary() pour "toutes catégories" : seules les catégories ayant un budget
    posé ce mois-là entrent dans le total (comparer à des dépenses hors budget n'aurait pas de sens). */
export async function computeMonthlyBudgetVsActualHistory(year, categoryId = null) {
  const { wallets, transactions, budgets, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const budgetTotals = new Array(12).fill(0);
  const actualTotals = new Array(12).fill(0);

  for (let m = 0; m < 12; m++) {
    const monthKey = `${year}-${String(m + 1).padStart(2, '0')}`;
    const monthBudgets = budgets.filter((b) => b.month === monthKey && (!categoryId || b.categoryId === categoryId));
    budgetTotals[m] = monthBudgets.reduce((s, b) => s + (b.limit || 0), 0);
    const budgetedCategoryIds = new Set(monthBudgets.map((b) => b.categoryId));
    for (const t of transactions) {
      if (t.type !== 'expense' || !t.date || !t.date.startsWith(monthKey)) continue;
      if (t.debtId) continue;
      if (categoryId) { if (t.categoryId !== categoryId) continue; }
      else if (!budgetedCategoryIds.has(t.categoryId)) continue;
      const cur = walletCurrency[t.walletId] || baseCurrency;
      actualTotals[m] += toBase(Number(t.amount) || 0, cur, rates, baseCurrency);
    }
  }

  const points = Array.from({ length: 12 }, (_, i) => ({
    label: new Intl.DateTimeFormat(intlLocale(), { month: 'short', year: '2-digit' }).format(new Date(year, i, 1)),
    budget: Math.round(budgetTotals[i] * 100) / 100,
    actual: Math.round(actualTotals[i] * 100) / 100,
  }));
  return { points, currency: baseCurrency };
}

/** Budget vs réel du mois, par catégorie budgétée. */
export async function computeBudgetVsActual(monthKey = currentMonthKey()) {
  const { wallets, transactions, categories, budgets, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const monthBudgets = budgets.filter((b) => b.month === monthKey);

  const actualByCategory = new Map();
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.date || !t.date.startsWith(monthKey)) continue;
    if (t.debtId) continue;
    const cur = walletCurrency[t.walletId] || baseCurrency;
    const amt = toBase(Number(t.amount) || 0, cur, rates, baseCurrency);
    actualByCategory.set(t.categoryId, (actualByCategory.get(t.categoryId) || 0) + amt);
  }

  return monthBudgets.map((b) => ({
    categoryId: b.categoryId,
    label: catName[b.categoryId] || tr('Sans catégorie'),
    budget: b.limit,
    actual: actualByCategory.get(b.categoryId) || 0,
  }));
}

/** Budget mensuel total : somme des plafonds attribués à chaque catégorie ce mois-ci,
    dépensé sur ces catégories budgétées, et ce qu'il reste à dépenser. */
export async function computeMonthlyBudgetSummary(monthKey = currentMonthKey()) {
  const rows = await computeBudgetVsActual(monthKey);
  const { baseCurrency } = await ctx();
  const totalBudget = rows.reduce((sum, r) => sum + (r.budget || 0), 0);
  const totalSpent = rows.reduce((sum, r) => sum + (r.actual || 0), 0);
  return { totalBudget, totalSpent, remaining: totalBudget - totalSpent, currency: baseCurrency };
}

export async function getExchangeRates() {
  const { rates, baseCurrency } = await ctx();
  return { rates, baseCurrency };
}

/** Devises dont le taux n'a jamais été confirmé par l'utilisateur (créé à 1:1 par défaut lors
    du premier portefeuille/investissement/dette dans cette devise). Tant qu'il reste à 1:1 sans
    confirmation, le patrimoine net et tous les totaux convertis dans cette devise sont trompeurs. */
export async function getUnconfirmedRates() {
  const { rates } = await ctx();
  return rates.filter((r) => r.confirmed === false);
}

/** Somme des soldes de portefeuilles actifs (liquidités), hors investissements/dettes. */
export async function computeLiquidBalance(cutoffDate = null) {
  const { wallets, transactions, rates, baseCurrency } = await ctx();
  const balances = walletBalancesAsOf(wallets, transactions, cutoffDate);
  let total = 0;
  for (const w of wallets) {
    if (w.archived) continue;
    total += toBase(balances.get(w.id) || 0, w.currency, rates, baseCurrency);
  }
  return { total, currency: baseCurrency };
}

/** Dépenses/recettes réelles du mois pour CHAQUE catégorie d'un type donné (y compris à 0). */
export async function computeCategoryActuals(monthKey = currentMonthKey(), type = 'expense') {
  const { wallets, transactions, categories, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const cats = categories.filter((c) => c.type === type);
  const totals = new Map(cats.map((c) => [c.id, 0]));
  for (const t of transactions) {
    if (t.type !== type || !t.date || !t.date.startsWith(monthKey)) continue;
    if (t.debtId) continue;
    const cur = walletCurrency[t.walletId] || baseCurrency;
    const amt = toBase(Number(t.amount) || 0, cur, rates, baseCurrency);
    totals.set(t.categoryId, (totals.get(t.categoryId) || 0) + amt);
  }
  return cats.map((c) => ({ categoryId: c.id, label: c.name, parentId: c.parentId, actual: totals.get(c.id) || 0 }));
}

/** Dépenses/recettes réelles de l'ANNÉE pour CHAQUE catégorie d'un type donné (y compris à 0). */
export async function computeAnnualCategoryActuals(year, type = 'expense') {
  const { wallets, transactions, categories, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const cats = categories.filter((c) => c.type === type);
  const totals = new Map(cats.map((c) => [c.id, 0]));
  for (const t of transactions) {
    if (t.type !== type || !t.date || !t.date.startsWith(String(year))) continue;
    if (t.debtId) continue;
    const cur = walletCurrency[t.walletId] || baseCurrency;
    const amt = toBase(Number(t.amount) || 0, cur, rates, baseCurrency);
    totals.set(t.categoryId, (totals.get(t.categoryId) || 0) + amt);
  }
  return cats.map((c) => ({ categoryId: c.id, label: c.name, parentId: c.parentId, actual: totals.get(c.id) || 0 }));
}

/** Solde prévisionnel de fin de mois = liquidités actuelles + récurrences actives restant à échoir ce mois-ci. */
export async function computeEndOfMonthForecast() {
  const { wallets, transactions, rates, baseCurrency } = await ctx();
  const recurring = await dbGetAll(STORES.RECURRING);
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const balances = walletBalancesAsOf(wallets, transactions);

  let current = 0;
  for (const w of wallets) {
    if (w.archived) continue;
    current += toBase(balances.get(w.id) || 0, w.currency, rates, baseCurrency);
  }

  const today = new Date();
  const todayStr = localISODate(today);
  const endOfMonthStr = localISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  let projected = current;
  const upcoming = [];
  for (const r of recurring) {
    if (!r.active || !r.nextDate) continue;
    if (r.nextDate >= todayStr && r.nextDate <= endOfMonthStr) {
      const cur = walletCurrency[r.walletId] || baseCurrency;
      const amt = toBase(Number(r.amount) || 0, cur, rates, baseCurrency);
      projected += (r.type === 'income' ? 1 : -1) * amt;
      upcoming.push({ ...r, amountBase: amt });
    }
  }
  upcoming.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  return { current, projected, currency: baseCurrency, upcoming };
}

/** Transactions jointes (portefeuille/catégorie), triées récentes d'abord, avec filtres optionnels. */
export async function getEnrichedTransactions({ limit = null, monthKey = null, walletId = null, categoryId = null, type = null } = {}) {
  const { wallets, transactions, categories } = await ctx();
  const walletById = Object.fromEntries(wallets.map((w) => [w.id, w]));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  let rows = transactions.filter((t) => {
    if (monthKey && !(t.date || '').startsWith(monthKey)) return false;
    if (walletId && t.walletId !== walletId && t.targetWalletId !== walletId) return false;
    if (categoryId && t.categoryId !== categoryId) return false;
    if (type && t.type !== type) return false;
    return true;
  });

  rows.sort((a, b) => (a.date === b.date ? (b.createdAt || '').localeCompare(a.createdAt || '') : b.date.localeCompare(a.date)));
  if (limit) rows = rows.slice(0, limit);

  return rows.map((t) => ({
    ...t,
    wallet: walletById[t.walletId] || null,
    targetWallet: t.targetWalletId ? walletById[t.targetWalletId] || null : null,
    category: catById[t.categoryId] || null,
  }));
}

/** Report d'enveloppe : cumul (budget - dépensé) de tous les mois BUDGÉTÉS avant monthKey pour
    cette catégorie. Utilisé quand la catégorie a envelopeMode activé, pour que le solde non
    dépensé (ou le dépassement) d'un mois se reporte sur le suivant, façon YNAB. */
export async function computeEnvelopeCarryover(categoryId, monthKey) {
  const { wallets, transactions, budgets, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const priorBudgets = budgets.filter((b) => b.categoryId === categoryId && b.month < monthKey && !b.period);
  let carry = 0;
  for (const b of priorBudgets) {
    // debtId exclu, comme dans tous les autres agrégats mensuels de ce fichier (computeMonthSummary,
    // computeBudgetVsActual, computeCategoryActuals...) : un mouvement de dette/créance catégorisé
    // "Prêt"/"Créance" n'est pas une dépense discrétionnaire. Cet oubli faisait diverger le report
    // d'enveloppe (qui l'incluait) de l'"actual" réellement affiché à l'écran (qui l'exclut déjà).
    const actual = transactions
      .filter((t) => t.type === 'expense' && t.categoryId === categoryId && !t.debtId && (t.date || '').startsWith(b.month))
      .reduce((sum, t) => sum + toBase(Number(t.amount) || 0, walletCurrency[t.walletId] || baseCurrency, rates, baseCurrency), 0);
    carry += (b.limit || 0) - actual;
  }
  return carry;
}

// Préfixes exacts posés par generateDueRecurring() (budgets.js) sur chaque transaction qu'elle
// génère automatiquement — voir plus bas pourquoi il faut les retirer avant de comparer à
// recurringNames. Deux variantes (le texte passe par t(), voir i18n.js) : une transaction générée
// pendant que l'app était en anglais porte "Recurrence: {nom}", pas "Récurrence : {nom}" — les deux
// doivent être reconnues quelle que soit la langue active au moment de la lecture, une transaction
// existante ne se retraduit jamais rétroactivement.
const RECURRING_NOTE_PREFIXES = ['récurrence : ', 'recurrence: '];

/** Détecte les paiements récurrents non déclarés en Récurrences : même note + montant similaire
    apparaissant sur au moins 2 mois distincts. Exclut ce qui correspond déjà à une récurrence active. */
export async function detectRecurringCandidates() {
  const { wallets, transactions, rates, baseCurrency } = await ctx();
  const recurring = await dbGetAll(STORES.RECURRING);
  const recurringNames = new Set(recurring.map((r) => (r.name || '').trim().toLowerCase()));
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));

  const groups = new Map();
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.note || !t.note.trim()) continue;
    const noteKey = t.note.trim().toLowerCase();
    // Les transactions générées automatiquement par une récurrence active portent la note
    // "Récurrence : {nom}" (budgets.js), pas juste "{nom}" — comparer noteKey tel quel à
    // recurringNames ne matchait donc JAMAIS ces transactions, et cette fonction re-proposait en
    // permanence les récurrences déjà déclarées comme si elles ne l'étaient pas.
    const matchedPrefix = RECURRING_NOTE_PREFIXES.find((p) => noteKey.startsWith(p));
    const strippedKey = matchedPrefix ? noteKey.slice(matchedPrefix.length) : noteKey;
    if (recurringNames.has(noteKey) || recurringNames.has(strippedKey)) continue;
    const amtBase = toBase(Number(t.amount) || 0, walletCurrency[t.walletId] || baseCurrency, rates, baseCurrency);
    const key = `${noteKey}::${Math.round(amtBase)}`;
    if (!groups.has(key)) groups.set(key, { note: t.note.trim(), amounts: [], months: new Set() });
    const g = groups.get(key);
    g.amounts.push(amtBase);
    g.months.add((t.date || '').slice(0, 7));
  }

  const candidates = [...groups.values()]
    .filter((g) => g.months.size >= 2)
    .map((g) => ({
      note: g.note,
      occurrences: g.months.size,
      avgAmount: g.amounts.reduce((a, b) => a + b, 0) / g.amounts.length,
    }))
    .sort((a, b) => b.avgAmount - a.avgAmount);

  const totalMonthly = candidates.reduce((s, c) => s + c.avgAmount, 0);
  return { candidates, totalMonthly, currency: baseCurrency };
}

/** Dépenses quotidiennes du mois (en devise de base), pour la vue calendrier. */
export async function computeDailySpending(monthKey) {
  const { wallets, transactions, rates, baseCurrency } = await ctx();
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const totals = new Map();
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.date || !t.date.startsWith(monthKey)) continue;
    if (t.debtId) continue;
    const amt = toBase(Number(t.amount) || 0, walletCurrency[t.walletId] || baseCurrency, rates, baseCurrency);
    totals.set(t.date, (totals.get(t.date) || 0) + amt);
  }
  return { totals, currency: baseCurrency };
}

/** Score de santé financière (0-100) : taux d'épargne (40%), ratio d'endettement (30%),
    respect du budget du mois (30%). Composite indicatif, pas un conseil financier personnalisé. */
export async function computeFinancialHealthScore(monthKey = currentMonthKey()) {
  const [summary, composition, budgetRows] = await Promise.all([
    computeMonthSummary(monthKey),
    computeNetWorthComposition(),
    computeBudgetVsActual(monthKey),
  ]);

  const savingsRate = summary.income > 0 ? summary.netSavings / summary.income : 0;
  const savingsScore = Math.max(0, Math.min(100, (savingsRate / 0.2) * 100));

  const grossAssets = composition.liquid + composition.invested + composition.receivables;
  const debtRatio = grossAssets > 0 ? composition.debts / grossAssets : (composition.debts > 0 ? 1 : 0);
  const debtScore = Math.max(0, Math.min(100, 100 - debtRatio * 100));

  const budgeted = budgetRows.filter((r) => r.budget > 0);
  // Tolérance d'un demi-centime : les montants sont des Number sommés directement (pas de
  // représentation en centimes entiers), donc une somme peut ponctuellement déraper de quelques
  // millièmes d'un centime — sans ça, un budget respecté "pile" pourrait apparaître dépassé par
  // erreur d'arrondi flottant. Même convention que debts.js (comparaisons de soldes à 0.005 près).
  const withinBudget = budgeted.filter((r) => r.actual <= r.budget + 0.005).length;
  const budgetAdherencePct = budgeted.length ? (withinBudget / budgeted.length) * 100 : 70;
  const budgetScore = budgetAdherencePct;

  const score = Math.round(savingsScore * 0.4 + debtScore * 0.3 + budgetScore * 0.3);
  return { score, savingsRate, debtRatio, budgetAdherencePct, currency: summary.currency };
}

/** Devine la catégorie la plus probable pour une note libre de transaction (Saisie express,
    import CSV générique). Priorité aux règles explicites de l'utilisateur (Budgets > Règles,
    STORES.CATEGORIZATION_RULES) ; à défaut, ressemblance textuelle (même prédicat de
    correspondance qu'avant : égalité ou inclusion dans un sens ou l'autre) avec les transactions
    déjà catégorisées du même type — mais on retient la catégorie la plus FRÉQUENTE parmi les
    correspondances plutôt que celle de la transaction correspondante la plus récente, pour qu'une
    catégorisation ponctuellement erronée sur un achat récurrent ne fausse pas toutes les
    suggestions suivantes. Renvoie null si rien de probant.
    Partagée entre transactions.js et backup.js, qui dupliquaient chacun une version de cette
    logique — celle de backup.js (import CSV générique) ne consultait jamais les règles. */
export async function guessCategoryId(note, type) {
  const norm = (s) => (s || '').trim().toLowerCase();
  const n = norm(note);
  if (n.length < 3) return null;

  if (type === 'expense' || type === 'income') {
    const rules = await dbGetAll(STORES.CATEGORIZATION_RULES);
    const ruleMatch = rules.find((r) => r.pattern && n.includes(r.pattern.toLowerCase()));
    if (ruleMatch) return ruleMatch.categoryId;
  }

  const transactions = await dbGetAll(STORES.TRANSACTIONS);
  const scores = new Map(); // categoryId -> nombre de correspondances
  for (const t of transactions) {
    if (t.type !== type || !t.categoryId || !t.note) continue;
    const tn = norm(t.note);
    if (tn !== n && !tn.includes(n) && !n.includes(tn)) continue;
    scores.set(t.categoryId, (scores.get(t.categoryId) || 0) + 1);
  }
  if (!scores.size) return null;
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const UNUSUAL_EXPENSE_MIN_SAMPLES = 3;
const UNUSUAL_EXPENSE_RATIO = 2.5;

/** Signale une dépense nettement plus élevée que l'habitude pour sa catégorie — purement
    informatif, n'empêche jamais l'enregistrement. Sert surtout à rattraper une erreur de saisie
    (ex: 45 000 tapé au lieu de 4 500). Comparaison faite en devise de base (une catégorie peut
    recevoir des dépenses de portefeuilles en devises différentes). Renvoie null si la catégorie a
    moins de UNUSUAL_EXPENSE_MIN_SAMPLES dépenses passées (pas assez d'historique pour que "la
    moyenne" veuille dire quoi que ce soit), si le montant ne dépasse pas UNUSUAL_EXPENSE_RATIO fois
    cette moyenne, ou si une devise impliquée dans la comparaison a un taux non confirmé (par défaut
    1:1, "presque certainement faux" — voir getUnconfirmedRates() — la comparaison serait trompeuse).
    excludeId sert à ignorer la transaction elle-même lors d'une modification.
    Fait son propre chargement ciblé plutôt que ctx() (qui charge aussi catégories/budgets/
    investissements/dettes, inutiles ici) : appelée à chaque enregistrement de dépense, pas
    seulement pour un rendu de vue. */
export async function checkUnusualExpense(categoryId, amount, walletId, excludeId = null) {
  if (!categoryId || !amount) return null;
  const [wallets, transactions, rates, baseCurrency] = await Promise.all([
    dbGetAll(STORES.WALLETS), dbGetAll(STORES.TRANSACTIONS), dbGetAll(STORES.EXCHANGE_RATES), getSetting('baseCurrency', 'EUR'),
  ]);
  const walletCurrency = Object.fromEntries(wallets.map((w) => [w.id, w.currency]));
  const past = transactions.filter((t) => t.type === 'expense' && t.categoryId === categoryId && t.id !== excludeId);
  if (past.length < UNUSUAL_EXPENSE_MIN_SAMPLES) return null;

  const currenciesInvolved = new Set([walletCurrency[walletId], ...past.map((t) => walletCurrency[t.walletId])]);
  const unconfirmed = rates.some((r) => currenciesInvolved.has(r.code) && r.code !== baseCurrency && r.confirmed === false);
  if (unconfirmed) return null;

  const pastBase = past.map((t) => toBase(Number(t.amount) || 0, walletCurrency[t.walletId] || baseCurrency, rates, baseCurrency));
  const average = pastBase.reduce((s, v) => s + v, 0) / pastBase.length;
  const amountBase = toBase(amount, walletCurrency[walletId] || baseCurrency, rates, baseCurrency);
  if (average <= 0 || amountBase < average * UNUSUAL_EXPENSE_RATIO) return null;

  return { average, amount: amountBase, ratio: amountBase / average, currency: baseCurrency };
}
