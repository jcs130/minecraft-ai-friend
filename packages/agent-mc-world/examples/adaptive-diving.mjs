/** Maintainer-authored decision example, not an installed skill or proof of agent learning.
 * Feed samples from bot.read('breathing') in one connection/dimension, plus a
 * measured return route/time and explicit uncertainty/health reserves.
 * The result is a proposal. It does not move, choose a target or certify a route.
 * An Agent may revise, validate and version its own method from this example.
 */
export const adaptiveDivingDecision = `
const samples = Array.isArray(params.samples) ? params.samples : [];
const last = samples[samples.length - 1];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const result = { recommendation: 'observe', goalCompleted: false, airSeconds: null,
  healthSeconds: null, airPerSec: null, healthLossPerSec: null, returnBudgetSeconds: null };
if (!last || !finite(last.oxygen) || !finite(last.health) || last.headWet !== true)
  return { ...result, reason: 'No current, verified submerged oxygen/health sample.' };
if (![params.returnSeconds, params.reserveSeconds, params.minHealth].every(finite)
    || params.returnSeconds < 0 || params.reserveSeconds < 0 || params.minHealth < 0)
  return { ...result, reason: 'Return route/time and explicit reserves are required; depth alone is insufficient.' };
const rates = [], hurtRates = [];
for (let i = 1; i < samples.length; i++) {
  const a = samples[i-1], b = samples[i];
  if (a.headWet !== true || b.headWet !== true || a.dimension !== b.dimension || a.entityId !== b.entityId
      || a.observationEpoch !== b.observationEpoch) continue;
  const seconds = (Date.parse(b.sampledAt) - Date.parse(a.sampledAt)) / 1000;
  const airSeconds = (Date.parse(b.oxygenUpdatedAt) - Date.parse(a.oxygenUpdatedAt)) / 1000;
  if (seconds > 0 && airSeconds > 0 && finite(a.oxygen) && finite(b.oxygen) && a.oxygen > b.oxygen)
    rates.push((a.oxygen - b.oxygen) / airSeconds);
  if (seconds > 0 && finite(a.healthLoss) && finite(b.healthLoss) && b.healthLoss > a.healthLoss)
    hurtRates.push((b.healthLoss - a.healthLoss) / seconds);
}
result.returnBudgetSeconds = params.returnSeconds + params.reserveSeconds;
result.airPerSec = rates.length ? Math.max(...rates) : null;
result.healthLossPerSec = hurtRates.length ? Math.max(...hurtRates) : null;
result.airSeconds = result.airPerSec ? last.oxygen / result.airPerSec : null;
result.healthSeconds = result.healthLossPerSec ? Math.max(0,last.health-params.minHealth) / result.healthLossPerSec : null;
if (last.health <= params.minHealth || last.oxygen <= 0
    || (result.airSeconds !== null && result.airSeconds <= result.returnBudgetSeconds)
    || (result.healthSeconds !== null && result.healthSeconds <= result.returnBudgetSeconds))
  return { ...result, recommendation: 'surface', reason: 'Measured return budget consumes the remaining air or health margin.' };
if (rates.length < 2)
  return { ...result, reason: 'Need multiple fresh oxygen decreases; a flat/missing reading never means unlimited air.' };
return { ...result, recommendation: 'continue',
  reason: 'Current measured margin exceeds return budget; recheck after the next bounded segment.' };
`;
