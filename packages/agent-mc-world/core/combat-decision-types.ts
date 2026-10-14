import type { Battlefield } from './battlefield.ts';
import type { CombatProgram } from './combat-program.ts';
export type CombatCandidate = { id: string; intent: string } & (
  { kind: 'cast'; spell: string; manaCost: number; ruleId: string }
  | { kind: 'engage'; targetId: number; uuid: string | null }
  | { kind: 'step'; destination: [number, number, number] }
  | { kind: 'retreat' }
);
export interface CombatDecisionFrame {
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
export const COMBAT_EXECUTION_DEFAULTS: CombatExecutionPolicy = {maxEntities:12,maxCandidates:2,
  allowMovement:false,allowEngage:false,engageScope:'party',movementStallMs:1500};
