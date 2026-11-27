export type MovementRejection = 'unknown_cell' | 'collision' | 'no_support' | 'hazard' | 'unsafe_footing' | 'blocked_heading' | 'no_direction';
export interface CombatControlSummary {
  schemaVersion: 1;
  finalMode: 'fighting' | 'retreating' | 'tracking';
  enteredDesperate: boolean;
  retreat: null | {
    startedAt: string;
    waterAtStart: boolean | null;
    bankCandidate: { x: number; y: number; z: number } | null;
    routeStatus: 'unverified';
    movement: { samples: number; horizontalActiveSamples: number; horizontalIntentSamples: number; jumpOnlySamples: number;
      observedHorizontalDistance: number; progressBasis: 'sampled_position_delta'; lastRejection: MovementRejection | null };
  };
}

const keys = (value: unknown, expected: string[]) => value !== null && typeof value === 'object'
  && Object.keys(value).length === expected.length && expected.every(k => k in value);
const counts = (v: unknown): v is Record<string, number> => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.values(v).every(n => Number.isSafeInteger(n) && n >= 0);

/** Invalid additive diagnostics never invalidate the original combat observation. */
export function validControlSummary(value: unknown): value is CombatControlSummary {
  if (!value || typeof value !== 'object' || Buffer.byteLength(JSON.stringify(value), 'utf8') > 2048) return false;
  const s = value as CombatControlSummary;
  if (!keys(s, ['schemaVersion', 'finalMode', 'enteredDesperate', 'retreat']) || s.schemaVersion !== 1 || !['fighting', 'retreating', 'tracking'].includes(s.finalMode)
    || typeof s.enteredDesperate !== 'boolean') return false;
  if (s.retreat === null) return true;
  const r = s.retreat, m = r?.movement;
  return !!r && keys(r, ['startedAt', 'waterAtStart', 'bankCandidate', 'routeStatus', 'movement']) && typeof r.startedAt === 'string' && r.startedAt.length <= 40 && Number.isFinite(Date.parse(r.startedAt))
    && (r.waterAtStart === null || typeof r.waterAtStart === 'boolean') && r.routeStatus === 'unverified'
    && (r.bankCandidate === null || !!r.bankCandidate && keys(r.bankCandidate, ['x', 'y', 'z']) && ['x', 'y', 'z'].every(k => Number.isFinite(r.bankCandidate![k as 'x' | 'y' | 'z'])))
    && !!m && keys(m, ['samples', 'horizontalActiveSamples', 'horizontalIntentSamples', 'jumpOnlySamples', 'observedHorizontalDistance', 'progressBasis', 'lastRejection']) && Number.isSafeInteger(m.samples) && m.samples >= 0
    && [m.horizontalActiveSamples, m.horizontalIntentSamples, m.jumpOnlySamples].every(n => Number.isSafeInteger(n) && n >= 0 && n <= m.samples)
    && Number.isFinite(m.observedHorizontalDistance) && m.observedHorizontalDistance >= 0 && m.progressBasis === 'sampled_position_delta'
    && (m.lastRejection === null || ['unknown_cell', 'collision', 'no_support', 'hazard', 'unsafe_footing', 'blocked_heading', 'no_direction'].includes(m.lastRejection));
}

export function sanitizeCombatResult<T extends CombatResult>(result: T): T {
  const clean = structuredClone(result);
  if (!['unavailable', 'legacy-unverified', 'server-confirmed', 'partial'].includes(clean.killAttribution ?? ''))
    clean.killAttribution = clean.kills === null ? 'unavailable' : 'legacy-unverified';
  if (clean.targetDeaths !== undefined && !counts(clean.targetDeaths)) delete clean.targetDeaths;
  if (clean.tridentsThrown !== undefined && (!Number.isSafeInteger(clean.tridentsThrown) || clean.tridentsThrown < 0)) delete clean.tridentsThrown;
  if (clean.killAttribution === 'server-confirmed' || clean.killAttribution === 'partial') {
    const observed = clean.targetDeaths ?? {};
    const total = Object.values(observed).reduce((a, b) => a + b, 0);
    const verified = clean.attributedDeaths;
    if (counts(clean.confirmedOwnKills) && typeof verified === 'number' && Number.isSafeInteger(verified) && verified > 0 && verified <= total
      && Object.entries(clean.confirmedOwnKills).every(([name,n]) => n <= (observed[name] ?? 0))
      && Object.values(clean.confirmedOwnKills).reduce((a,b) => a+b, 0) <= verified
      && (clean.killAttribution === 'server-confirmed') === (verified === total)) {
      clean.kills = verified === total ? { ...clean.confirmedOwnKills } : null;
    } else {
      clean.killAttribution = 'unavailable'; clean.kills = null;
      delete clean.confirmedOwnKills; delete clean.attributedDeaths;
    }
  }
  if (!validControlSummary(clean.controlSummary)) delete clean.controlSummary;
  if (clean.reason !== 'death' || typeof clean.deathEpisodeId !== 'string' || !clean.deathEpisodeId.length || clean.deathEpisodeId.length > 80) delete clean.deathEpisodeId;
  if (!clean.scope || Object.keys(clean.scope).length !== 3 || !['realm', 'account', 'agent'].every(k => {
    const value = clean.scope![k as 'realm' | 'account' | 'agent'];
    return typeof value === 'string' && value.length > 0 && value.length <= 500;
  })) delete clean.scope;
  return clean;
}

export interface CombatScene {
  loadout?: import('./combat-loadout.ts').CombatLoadout;
  dimension: string | null;
  position: { x: number; y: number; z: number };
  hostileRadius: number;
  nearbyHostiles: Record<string, number>;
  equipment: Record<string, string | null>;
}

export interface CombatResult {
  controlSummary?: CombatControlSummary;
  deathEpisodeId?: string;
  scope?: { realm: string; account: string; agent: string };
  startedAt: string;
  endedAt: string;
  reason: string;
  healthBefore: number | null;
  healthAfter: number | null;
  /** Own kill credit; null when native entityDead supplies no killer. Historical maps need attribution. */
  kills: Record<string, number> | null;
  killAttribution?: 'unavailable' | 'legacy-unverified' | 'server-confirmed' | 'partial';
  confirmedOwnKills?: Record<string, number>;
  attributedDeaths?: number;
  /** Observed deaths of engaged targets; neither damage nor final kill ownership. */
  targetDeaths?: Record<string, number>;
  swings: number;
  meleeLanded: number;
  arrows: number;
  tridentsThrown?: number;
  rangedLanded: number;
  sceneBefore?: CombatScene;
}

