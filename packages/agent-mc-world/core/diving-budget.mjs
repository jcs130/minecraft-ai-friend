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
  healthSeconds: null, airPerSec: null, healthLossPerSec: null, returnBudgetSeconds: null,
  samplesUsed: 0, sampleAgeMs: null, airUpdateAgeMs: null };
if (!last || !finite(last.oxygen) || last.oxygen < 0 || last.oxygen > 20
    || !finite(last.health) || last.headWet !== true)
  return { ...result, reason: 'No current, verified submerged oxygen/health sample.' };
if (![params.returnSeconds, params.reserveSeconds, params.minHealth].every(finite)
    || params.returnSeconds < 0 || params.reserveSeconds < 0 || params.minHealth < 0)
  return { ...result, reason: 'Return route/time and explicit reserves are required; depth alone is insufficient.' };
const now = finite(params.nowMs) ? params.nowMs : Date.now();
const maxAge = params.sampleMaxAgeMs;
const latestAt = Date.parse(last.sampledAt), airAt = Date.parse(last.oxygenUpdatedAt);
result.sampleAgeMs = finite(latestAt) ? now - latestAt : null;
result.airUpdateAgeMs = finite(airAt) ? now - airAt : null;
if (!finite(maxAge) || maxAge < 0 || !finite(latestAt) || !finite(airAt)
    || latestAt > now || airAt > latestAt || now - latestAt > maxAge || now - airAt > maxAge)
  return { ...result, reason: 'Explicit sampleMaxAgeMs and fresh observation/oxygen timestamps are required.' };
if (typeof last.observationId !== 'string' || !last.observationId
    || typeof last.dimension !== 'string' || !last.dimension || last.dimension === 'unknown'
    || !Number.isSafeInteger(last.entityId) || !Number.isSafeInteger(last.observationEpoch))
  return { ...result, reason: 'Connection/entity/dimension sampling identity is unverified.' };
// Only the latest uninterrupted dive segment may inform this decision. A prior
// dry/refill segment or another entity/epoch is not evidence about this dive.
const recent = [last];
for (let i = samples.length - 2; i >= 0; i--) {
  const a = samples[i], b = recent[0];
  if (!a) break;
  const at = Date.parse(a.sampledAt);
  if (a.headWet !== true || a.observationId !== last.observationId || a.dimension !== last.dimension || a.entityId !== last.entityId
      || a.observationEpoch !== last.observationEpoch || !finite(at) || at >= Date.parse(b.sampledAt)
      || now - at > maxAge || !finite(a.oxygen) || a.oxygen < 0 || a.oxygen > 20
      || a.oxygen < b.oxygen || (finite(a.healthLoss) && finite(b.healthLoss) && a.healthLoss > b.healthLoss)) break;
  recent.unshift(a);
}
result.samplesUsed = recent.length;
const rates = [], hurtRates = [];
for (let i = 1; i < recent.length; i++) {
  const a = recent[i-1], b = recent[i];
  const seconds = (Date.parse(b.sampledAt) - Date.parse(a.sampledAt)) / 1000;
  const airSeconds = (Date.parse(b.oxygenUpdatedAt) - Date.parse(a.oxygenUpdatedAt)) / 1000;
  if (seconds > 0 && airSeconds > 0 && Date.parse(b.oxygenUpdatedAt) <= Date.parse(b.sampledAt)
      && Date.parse(a.oxygenUpdatedAt) <= Date.parse(a.sampledAt)
      && Date.parse(a.oxygenUpdatedAt) >= now - maxAge && a.oxygen > b.oxygen)
    rates.push((a.oxygen - b.oxygen) / airSeconds);
  if (seconds > 0 && finite(a.healthLoss) && finite(b.healthLoss) && b.healthLoss > a.healthLoss)
    hurtRates.push((b.healthLoss - a.healthLoss) / seconds);
}
result.returnBudgetSeconds = params.returnSeconds + params.reserveSeconds;
result.airPerSec = rates.length ? Math.max(...rates) : null;
result.healthLossPerSec = hurtRates.length ? Math.max(...hurtRates) : null;
result.airSeconds = result.airPerSec ? Math.max(0,last.oxygen / result.airPerSec - result.airUpdateAgeMs / 1000) : null;
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
