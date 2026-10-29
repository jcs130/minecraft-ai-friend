/** Native attack observations. A target's death event does not identify its killer. */
export interface AttackEvidence {
  schema: 'agent-mc-attack-evidence/v1';
  sampledAt: string;
  target: { entityId: number; uuid: string | null; name: string };
  targetState: 'death-observed' | 'explosion-observed' | 'untracked' | 'visible' | 'occluded' | 'unknown';
  deathObservedAt: string | null;
  /** The standard entityDead event has no killer identity; never infer credit from timing or hits. */
  ownKillCredit: null;
  attempts: { meleeSwings: number; arrowsReleased: number };
  /** Existing target-hurt associations, separate from attempted dispatch and final kill credit. */
  observedHits: { melee: number; ranged: number };
  goalVerified: false;
}
