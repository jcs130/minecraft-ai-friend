/**
 * Core contracts for the resident-agent memory (Phase 1).
 *
 * Time model (bi-temporal, Graphiti compatible):
 * - validAt / invalidAt: reality ("valid") time — when the fact was true in the game world.
 * - createdAt / expiredAt: system ("transaction") time — when this memory version was written
 *   and when it stopped being the current belief. Rows are never deleted; a correction writes a
 *   new version and expires the old one.
 */

export const MEMORY_PROTOCOL = 'agent-mc-memory-graph/v1' as const;

/** Who remembers what, on which server. Mirrors agent-mc-world's GameMemoryScope (realm/account/agent). */
export interface MemoryScope {
  /** Server realm identity, e.g. agent-mc-world `experience.scope.realm`. */
  realm: string;
  /** Login account, e.g. `offline:CorMy`. */
  account: string;
  /** Agent persona / memory agent id. */
  agent: string;
}

/**
 * Native world identity for location isolation (agent-mc-world `agent-mc-world-identity/v1`).
 * `key: null` means unknown; such locations are bound to a connection-local namespace and never merge
 * with another world's coordinates.
 */
export interface WorldRef {
  key: string | null;
  dimensionType?: string | null;
  /** Connection-local discriminator used only when `key` is null. */
  connection?: string | null;
  revision?: number;
}

export type EpisodeKind =
  | 'chat' | 'whisper' | 'player_join' | 'player_leave' | 'death' | 'respawn' | 'inventory'
  | 'task' | 'location' | 'home' | 'skill' | 'note' | 'event';

export interface EpisodeSourceRef {
  /** Producer: `minecraft-event`, `agent`, `tool:memory_remember`, `synthetic` ... */
  type: string;
  /** Host event-store cursor or other opaque pointer back to the raw record. */
  ref?: string;
  eventType?: string;
}

/** The unit of input. Raw text is kept verbatim as provenance (cold layer). */
export interface Episode {
  id: string;
  scopeKey: string;
  kind: EpisodeKind;
  /** Reality time the event happened (ISO-8601). */
  occurredAt: string;
  /** System time the memory recorded it (ISO-8601). */
  recordedAt: string;
  text: string;
  actors: string[];
  world: WorldRef | null;
  data: Record<string, unknown>;
  /** 0..1 – used later for demotion to cold-only (Phase 2+). */
  importance: number;
  source: EpisodeSourceRef;
}

export type EntityType = 'Agent' | 'Player' | 'Location' | 'Building' | 'Skill' | 'Item' | 'Task' | 'Topic' | 'World';

export interface EntityRef { type: EntityType; name: string }

/** Extracted triple (plus optional scalar value) waiting to be merged into the graph. */
export interface FactInput {
  subject: EntityRef;
  relation: string;
  object: EntityRef | null;
  /** Scalar attribute of the edge: level, coordinates, count, status. */
  value?: string | number | boolean | null;
  /** Human-readable sentence (Graphiti `fact`). */
  text: string;
  validAt: string;
  invalidAt?: string | null;
  /** Negation ("no longer likes X"): invalidates matching active facts and writes nothing new. */
  negated?: boolean;
}

export interface Fact {
  /** Version id (unique row). */
  id: string;
  /** Lineage id shared by all versions of the same assertion. */
  factId: string;
  scopeKey: string;
  subject: EntityRef;
  relation: string;
  object: EntityRef | null;
  value: string | number | boolean | null;
  text: string;
  validAt: string;
  invalidAt: string | null;
  createdAt: string;
  expiredAt: string | null;
  episodes: string[];
  /** Lineage id of the fact that replaced this one, if superseded by a contradiction. */
  supersededBy: string | null;
  backend: 'local' | 'graphiti';
}

export interface FactQuery {
  /** Entity name, or `Type:name`. Matches subject or object. */
  entity?: string;
  relation?: string;
  /** Free-text search over fact sentences (lexical locally, hybrid in Graphiti). */
  text?: string;
  limit?: number;
}

export interface MergeResult {
  added: Fact[];
  /** Existing assertions that were confirmed again (episode appended). */
  confirmed: Fact[];
  /** Old versions closed (invalidAt set) by this episode. */
  invalidated: Fact[];
}

export interface GraphHealth { ok: boolean; backend: string; detail?: string }

/** Warm layer. Implemented in-process (LocalTemporalGraph) and by the Graphiti sidecar client. */
export interface MemoryGraph {
  readonly backend: 'local' | 'graphiti';
  /** Merge an episode. `facts` are pre-extracted triples; LLM backends may extract more. */
  addEpisode(episode: Episode, facts: readonly FactInput[]): Promise<MergeResult>;
  /** Facts currently believed true. */
  currentFacts(scopeKey: string, query: FactQuery): Promise<Fact[]>;
  /** Facts true at reality time `at`; optionally as the system believed them at `knownAt`. */
  factsAt(scopeKey: string, at: string, query: FactQuery, options?: { knownAt?: string }): Promise<Fact[]>;
  /** Every version for matching facts, oldest valid first. */
  history(scopeKey: string, query: FactQuery): Promise<Fact[]>;
  health(): Promise<GraphHealth>;
  close(): Promise<void>;
}

/** Cold layer: append-only raw episodes per scope. */
export interface EpisodeQuery { kinds?: readonly EpisodeKind[]; actor?: string; text?: string; since?: string; until?: string; limit?: number }
export interface ColdStore {
  append(episode: Episode): void;
  get(scopeKey: string, id: string): Episode | null;
  recent(scopeKey: string, query?: EpisodeQuery): Episode[];
  count(scopeKey: string): number;
  close(): void;
}
