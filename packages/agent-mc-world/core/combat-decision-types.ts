import type { Battlefield } from './battlefield.ts';
import type { CombatProgram } from './combat-program.ts';
import type { CombatRoutine } from './combat-routines.ts';
export type CombatCandidate = { id: string; intent: string } & (
  { kind: 'cast'; spell: string; manaCost: number; ruleId: string }
  | { kind: 'engage'; targetId: number; uuid: string | null }
  | { kind: 'step'; destination: [number, number, number] }
  | { kind: 'track'; targetId: number; uuid: string | null; minDistance: number; maxDistance: number; leaseMs: number }
  | { kind: 'retreat' }
  | ({ kind: 'method' } & CombatRoutine)
);
export interface CombatDecisionFrame {
  loadout?: import('./combat-loadout.ts').CombatLoadout;
  battlefield: Battlefield;
  tacticRevision: number;
  mana: number | null;
  skills: Array<{ spell: string; available: boolean; manaCost: number | null;
    cooldownRemainingMs: number | null; block: string | null }>;
  candidates: CombatCandidate[];
  omittedCandidates: number;
  program?: CombatProgram;
  actionPool?: CombatCandidate[];
  policy?: { name: string; sourceHash: string; instructions: string };
}
export interface CombatExecutionPolicy {
  maxEntities: number; maxCandidates: number;
  allowMovement: boolean; allowEngage: boolean; engageScope: 'party' | 'hostile'; movementStallMs: number;
}
export const COMBAT_EXECUTION_DEFAULTS: CombatExecutionPolicy = {maxEntities:12,maxCandidates:6,
  allowMovement:false,allowEngage:false,engageScope:'party',movementStallMs:1500};
