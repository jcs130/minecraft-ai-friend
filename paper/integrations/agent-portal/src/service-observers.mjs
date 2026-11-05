// The native goddess camera uses this fixed LoginGuard identity. Match the
// name too because lifecycle records and older projections may omit the UUID.
export const photoObserverName = 'ag_photolens';
const photoObserverUuid = 'ff58a81b-f033-3b74-a7cf-58ac4e798bb0';
export const isPhotoObserver = (name, uuid) => (typeof name === 'string' && name.toLowerCase() === photoObserverName)
  || (typeof uuid === 'string' && uuid.toLowerCase() === photoObserverUuid);

// Applies to playersOnline, rosterCount and agentCount. Carry the policy even
// when the count is unknown: a filtered roster cannot reconstruct the raw total.
export const publicPlayerCountPolicy = 'photo-observer-excluded-v1';
const countValid = value => Number.isSafeInteger(value) && value >= 0;
const countResult = (playersOnline, reason = null) => ({ playersOnline, playersOnlineUnavailableReason: reason });

export function publicOnlineCount(status, now = Date.now()) {
  const total = status.playersOnline, at = Date.parse(status.observedAt || '');
  if (status.online !== true || !countValid(total) || !Number.isFinite(at) || at > now + 1000 || now - at > 5000)
    return countResult(null, '在线人数来源暂不可用或已过期');
  const sample = Array.isArray(status.sample) ? status.sample : [];
  if (total === 0) return sample.length ? countResult(null, '在线人数与状态样本不一致') : countResult(0);
  // Only positive evidence from the same ping proves inclusion in its total.
  // LoginGuard.authorizedNames proves proxy authorization, not backend entry.
  if (sample.some(row => isPhotoObserver(row?.name, row?.uuid))) return countResult(total - 1);
  // A sample is complete only if it accounts for every connection with distinct
  // names and nonzero UUIDs. Missing/anonymous/duplicate entries prove nothing.
  const identified = sample.length === total && sample.every(row => /^\.?[A-Za-z0-9_]{1,16}$/.test(row?.name || '')
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row?.uuid || '')
    && row.uuid !== '00000000-0000-0000-0000-000000000000');
  if (identified && new Set(sample.map(row => row.uuid.toLowerCase())).size === total
    && new Set(sample.map(row => row.name.toLowerCase())).size === total) return countResult(total);
  return countResult(null, '状态样本不完整，在线人数待确认');
}

// Normalize before buildSnapshot removes the private camera row, and again on
// cloud reads for legacy publishers. Never mutate persisted payloads/hashes.
export function publicPlayerSummary(summary = {}, roster = []) {
  if (summary.playerCountPolicy === publicPlayerCountPolicy) return { ...summary };
  const cameras = roster.filter(row => isPhotoObserver(row.name, row.playerUuid));
  const result = { ...summary, playerCountPolicy: publicPlayerCountPolicy };
  if (Number.isFinite(summary.rosterCount)) result.rosterCount = Math.max(0, summary.rosterCount - cameras.length);
  if (Number.isFinite(summary.agentCount)) result.agentCount = Math.max(0, summary.agentCount - cameras.filter(row => row.kind === 'agent').length);
  // Only an identity sampled by the ping that supplied the raw total can
  // justify a deduction. Legacy roster online can also mean proxy auth.
  const cameraSampled = Number.isFinite(Date.parse(summary.observedAt || '')) && cameras.some(row => row.online === true
    && ['minecraft.server-list-ping.uuid', 'minecraft.server-list-ping.sample'].includes(row.statusSource)
    && row.statusObservedAt === summary.observedAt);
  if (countValid(summary.playersOnline) && summary.playersOnline > 0 && cameraSampled)
    return { ...result, ...countResult(summary.playersOnline - 1) };
  if (summary.playersOnline === 0 && !cameraSampled) return { ...result, ...countResult(0) };
  // PR #68 filtered the roster without recording whether subtraction happened.
  // Absence (or online:false from a partial sample) cannot repair that history.
  return { ...result, ...countResult(null, '旧快照缺少可靠的计数依据，在线人数待确认') };
}
