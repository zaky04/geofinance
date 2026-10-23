/* ==========================================================================
   GeoFinance System — Calendrier des récurrences (module pur)
   Source unique de « quelle est l'échéance suivante » : utilisée par la génération automatique des
   transactions dues (budgets.js) ET par la prévision de trésorerie (forecast.js) — les deux ne
   peuvent donc jamais diverger.
   ========================================================================== */

import { localISODate } from './utils.js';

export function advanceDate(dateStr, frequency, anchorDay) {
  const [y, m, day] = dateStr.split('-').map(Number);
  if (frequency === 'weekly') {
    const d = new Date(y, m - 1, day);
    d.setDate(d.getDate() + 7);
    return localISODate(d);
  }
  // Mensuel/annuel : on avance en mois/année calendaires, PAS en ajoutant à la date précédente
  // via setMonth/setFullYear (ces derniers débordent silencieusement sur le mois suivant quand
  // le jour d'origine — 29, 30, 31 — n'existe pas dans le mois cible, ex: 31 janvier + 1 mois
  // devient le 3 mars au lieu du 28/29 février : un mois entier de récurrence est alors sauté et
  // toutes les échéances suivantes restent décalées en permanence). `anchorDay` est le jour du
  // mois voulu par l'utilisateur (ex: loyer le 31) : on clampe seulement quand le mois cible est
  // trop court, et on revient à `anchorDay` dès que le mois suivant le permet à nouveau, comme
  // le ferait une vraie échéance de facturation.
  const targetDay = anchorDay ?? day;
  let targetYear = y;
  let targetMonth = m - 1;
  if (frequency === 'yearly') targetYear += 1;
  else targetMonth += 1;
  targetYear += Math.floor(targetMonth / 12);
  targetMonth = ((targetMonth % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const d = new Date(targetYear, targetMonth, Math.min(targetDay, lastDayOfTargetMonth));
  return localISODate(d);
}
