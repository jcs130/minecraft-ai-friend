import type { MobDeathReceipt } from './mob-death.ts';

/** Final damage attribution is optional on ordinary Minecraft servers. */
export interface AttackEvidence {
  schema: 'agent-mc-attack-evidence/v1';
  sampledAt: string;
  target: { entityId: number; uuid: string | null; name: string };
  targetState: 'death-observed' | 'explosion-observed' | 'untracked' | 'visible' | 'occluded' | 'unknown';
  deathObservedAt: string | null;
  ownKillCredit: boolean | null;
  fatalDamage?: MobDeathReceipt;
  attempts: { meleeSwings: number; arrowsReleased: number; tridentsThrown?: number };
  /** Main hand observed at the last melee dispatch. Null means empty, absent means no swing sampled. */
  lastSwingMainHand?: string | null;
  /** Existing target-hurt associations, separate from attempted dispatch and final kill credit. */
  observedHits: { melee: number; ranged: number };
  goalVerified: false;
}
