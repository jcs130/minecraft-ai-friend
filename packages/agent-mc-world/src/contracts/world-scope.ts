/** World/level identity is distinct from its dimension type and server address. */
export interface WorldIdentityObservation {
  schema: 'agent-mc-world-identity/v1';
  /** Exact vanilla level key, e.g. minecraft:aincrad; never inferred from its type. */
  key: string | null;
  /** Bukkit UUID and dungeon run identity are not supplied by vanilla login packets. */
  uuid: string | null;
  instanceId: string | null;
  dimensionType: string | null;
  source: 'vanilla-login' | 'vanilla-respawn' | 'unknown';
  /** Connection-local identity revision, stable for same-world respawns. */
  revision: number;
  /** Last identity packet observation, not the time of every facts read. */
  observedAt: string | null;
}
