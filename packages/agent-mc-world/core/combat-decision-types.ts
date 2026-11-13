import type { Battlefield } from './battlefield.ts';
import type { CombatProgram } from './combat-program.ts';
import type { CombatRoutine } from './combat-routines.ts';
export type CombatCandidate = { id: string; intent: string } & (
  { kind: 'cast'; spell: string; manaCost: number; ruleId: string }
  | { kind: 'engage'; targetId: number; uuid: string | null }
  | { kind: 'step'; destination: [number, number, number] }
  | { kind: 'track'; targetId: number; uuid: string | null; minDistance: number; maxDistance: number; leaseMs: number }
  | { kind: 'retreat' }
  | { kind:'search';clueKey:string;source:'sound-packet'|'last-seen'|'objective';destination:[number,number,number] }
  | { kind: 'idle'; action: 'wander'; destination: [number, number, number] }
  | ({ kind: 'method' } & CombatRoutine)
);
export interface CombatDecisionFrame {
  /** A desired heal is not a body lease or a promise that healing can execute. */
  survival?: { fleeAtOrBelow: number; healingDesired: boolean };
  loadout?: import('./combat-loadout.ts').CombatLoadout;
  battlefield: Battlefield;
  tacticRevision: number;
  mana: number | null;
  skillsOmitted?: number;
  skills: Array<{ spell: string; available: boolean; configured?: boolean; manaCost: number | null;
    cooldownRemainingMs: number | null; block: string | null }>;
  candidates: CombatCandidate[];
  omittedCandidates: number;
  program?: CombatProgram;
  actionPool?: CombatCandidate[];
  policy?: { name: string; sourceHash: string; instructions: string;
    selection?: { native: Partial<Record<CombatCandidate['kind'], number>>;
      offered: Partial<Record<CombatCandidate['kind'], number>>; excludedKinds: CombatCandidate['kind'][] } };
  /** A transient sample rejection does not disable the authored program. */
  programDeferred?: { reason: 'evaluation-in-progress' | 'scene-changed'; sourceHash: string };
}
/** Fresh collision checks may update a short step for sub-block drift, not change its intent. */
export function sameCombatSearch(a:Extract<CombatCandidate,{kind:'search'}>,b:Extract<CombatCandidate,{kind:'search'}>):boolean{
  return a.id===b.id&&a.source===b.source&&a.clueKey===b.clueKey
    &&Math.hypot(...a.destination.map((v,i)=>v-b.destination[i]))<=.5;
}
export interface CombatExecutionPolicy {
  maxEntities: number; maxCandidates: number;
  allowMovement: boolean; allowEngage: boolean; engageScope: 'party' | 'hostile'; movementStallMs: number;
}
export const COMBAT_EXECUTION_DEFAULTS: CombatExecutionPolicy = {maxEntities:12,maxCandidates:6,
  allowMovement:false,allowEngage:false,engageScope:'party',movementStallMs:1500};
