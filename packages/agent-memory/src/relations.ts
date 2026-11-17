/**
 * Relation semantics used to decide when a new fact contradicts (supersedes) an old one.
 * - `exclusive: 'subject'`        one active object per subject       (LOCATED_AT)
 * - `exclusive: 'subject-object'`  one active value per subject+object (HOME_AT, HAS_LEVEL, OWNS count)
 * - `exclusive: false`             multi-valued; only explicit negation or `conflicts` invalidate
 * - `event: true`                  each occurrence is its own fact (DIED_AT) — never merged/superseded
 */
export interface RelationPolicy {
  exclusive: 'subject' | 'subject-object' | false;
  /** Relations that contradict this one for the same subject+object (LIKES vs DISLIKES). */
  conflicts?: readonly string[];
  event?: boolean;
  description: string;
}

export const RELATIONS: Readonly<Record<string, RelationPolicy>> = {
  KNOWS: { exclusive: false, description: 'Agent/Player has interacted with another Player' },
  FRIENDS_WITH: { exclusive: false, conflicts: ['HOSTILE_TO'], description: 'Declared or observed friendship' },
  HOSTILE_TO: { exclusive: false, conflicts: ['FRIENDS_WITH'], description: 'Declared hostility' },
  LIKES: { exclusive: false, conflicts: ['DISLIKES'], description: 'Stated preference' },
  DISLIKES: { exclusive: false, conflicts: ['LIKES'], description: 'Stated dislike' },
  IS_ONLINE: { exclusive: 'subject', description: 'Presence on the server (value true/false)' },
  LOCATED_AT: { exclusive: 'subject', description: 'Last observed location' },
  HOME_AT: { exclusive: 'subject-object', description: 'Named home → coordinates (value)' },
  BUILT_AT: { exclusive: 'subject-object', description: 'Building located at coordinates' },
  OWNS: { exclusive: 'subject-object', description: 'Holds a notable item (value = count)' },
  HAS_LEVEL: { exclusive: 'subject-object', description: 'Skill / RPG / XP level (value)' },
  LEARNED: { exclusive: false, description: 'Learned a skill or method' },
  PARTICIPATED_IN: { exclusive: false, description: 'Took part in a task / event' },
  HAS_STATUS: { exclusive: 'subject', description: 'Task status (value)' },
  DIED_AT: { exclusive: false, event: true, description: 'A death (value = cause)' },
};

export function relationPolicy(relation: string): RelationPolicy {
  return RELATIONS[relation] ?? { exclusive: false, description: 'custom relation' };
}

export function normalizeRelation(relation: string): string {
  const r = relation.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!r || r.length > 64) throw new Error(`Invalid relation: ${relation}`);
  return r;
}
