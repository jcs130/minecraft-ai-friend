/** Bounded, Agent-authored predicates over observed combat facts; no activity scripts. */
export interface CombatRule {
  id: string;
  spell: string;
  /** Meaning of this choice, authored after reading the server's skill contract. */
  intent?: string;
  when: {
    within?: number;
    enemyTypes?: string[];
    hostilesAtLeast?: number;
    hostilesAtMost?: number;
    healthAtOrBelow?: number;
    healthAtOrAbove?: number;
    manaAtLeast?: number;
    reserveMana?: number;
    dimension?: string;
    onGround?: boolean;
  };
}

export interface CombatRuleFacts {
  health: number;
  mana: number | null;
  manaLoading: boolean;
  cost: number | null;
  dimension: string | null;
  onGround: boolean | null;
  enemies: readonly { type: string; distance: number }[];
}

const ID = /^[a-z][a-z0-9_:-]{0,63}$/;
export const COMBAT_RULES_SCHEMA = {
  type: 'array', maxItems: 16,
  description: 'Ordered conditional rules re-evaluated against current facts while fighting. First matching, ready rule wins; no match means no automatic offensive cast. [] restores spells/default priority. This is not a timed sequence; use mc_do for a bounded movement/action group.',
  items: {
    type: 'object', additionalProperties: false, required: ['id', 'spell', 'when'],
    properties: {
      id: { type: 'string', pattern: ID.source, description: 'Unique rule ID, retained in cast observations.' },
      spell: { type: 'string', pattern: ID.source, description: 'Observed ability ID from an explicitly installed server capability provider.' },
      intent: { type: 'string', minLength: 1, maxLength: 160,
        description: 'Optional concise effect and tactical purpose from the skill documentation. Required to offer this rule to the asynchronous fast selector; does not prove the spell is learned.' },
      when: { type: 'object', additionalProperties: false, properties: {
        within: { type: 'number', minimum: 1, maximum: 16, description: 'Count matching enemies within this 3D distance; default 12. Not a claim about spell range or line of sight.' },
        enemyTypes: { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true, items: { type: 'string', pattern: ID.source }, description: 'Optional exact entity type IDs to count; bare IDs use the minecraft namespace (zombie = minecraft:zombie). Other namespaces remain distinct. Omitted counts all observed hostiles.' },
        hostilesAtLeast: { type: 'integer', minimum: 1, maximum: 64, description: 'Minimum matching enemy count; default 1.' },
        hostilesAtMost: { type: 'integer', minimum: 1, maximum: 64 },
        healthAtOrBelow: { type: 'number', minimum: 1, maximum: 20 },
        healthAtOrAbove: { type: 'number', minimum: 1, maximum: 20 },
        manaAtLeast: { type: 'number', minimum: 0, maximum: 10000 },
        reserveMana: { type: 'number', minimum: 0, maximum: 10000, description: 'Require at least this much mana after the observed spell cost. Unknown mana/cost fails the predicate.' },
        dimension: { type: 'string', minLength: 1, maxLength: 100, description: 'Exact current dimension identifier.' },
        onGround: { type: 'boolean' },
      } },
    },
  },
};

export function validCombatRules(value: unknown): value is CombatRule[] {
  if (!Array.isArray(value) || value.length > 16) return false;
  const ids = new Set<string>();
  for (const rule of value) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)
      || Object.keys(rule).some(k => !['id', 'spell', 'intent', 'when'].includes(k))
      || typeof rule.id !== 'string' || !ID.test(rule.id) || ids.has(rule.id)
      || typeof rule.spell !== 'string' || !ID.test(rule.spell)
      || (rule.intent !== undefined && (typeof rule.intent !== 'string' || !rule.intent.trim().length || rule.intent.length > 160))
      || !rule.when || typeof rule.when !== 'object' || Array.isArray(rule.when)) return false;
    ids.add(rule.id);
    const w = rule.when;
    for (const [key, v] of Object.entries(w)) {
      const schema = COMBAT_RULES_SCHEMA.items.properties.when.properties;
      if (!(key in schema)) return false;
      if (key === 'enemyTypes') {
        if (!Array.isArray(v) || !v.length || v.length > 16
          || v.some(t => typeof t !== 'string' || !ID.test(t)) || new Set(v).size !== v.length) return false;
      } else if (key === 'dimension') {
        if (typeof v !== 'string' || !v.length || v.length > 100) return false;
      } else if (key === 'onGround') {
        if (typeof v !== 'boolean') return false;
      } else {
        const limits = schema[key as Exclude<keyof typeof schema, 'enemyTypes' | 'dimension' | 'onGround'>];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < limits.minimum || v > limits.maximum
          || (limits.type === 'integer' && !Number.isInteger(v))) return false;
      }
    }
    if ((w.hostilesAtMost !== undefined && w.hostilesAtMost < (w.hostilesAtLeast ?? 1))
      || (w.healthAtOrAbove !== undefined && w.healthAtOrBelow !== undefined
        && w.healthAtOrAbove > w.healthAtOrBelow)) return false;
  }
  return true;
}

/** Compare registry IDs without treating another namespace as a vanilla type. Empty observations remain unknown. */
export function combatEntityTypeMatches(observed: string | null | undefined, expected: string): boolean {
  if (!observed || !expected) return false;
  const qualified = (type: string) => type.includes(':') ? type : `minecraft:${type}`;
  return qualified(observed) === qualified(expected);
}

/** Unknown required facts block the branch rather than silently satisfying it. */
export function combatRuleBlock(rule: CombatRule, facts: CombatRuleFacts): string | null {
  const w = rule.when;
  const count = facts.enemies.filter(e => e.distance <= (w.within ?? 12)
    && (!w.enemyTypes || w.enemyTypes.some(type => combatEntityTypeMatches(e.type, type)))).length;
  if (count < (w.hostilesAtLeast ?? 1)) return '范围内目标数量不足';
  if (w.hostilesAtMost !== undefined && count > w.hostilesAtMost) return '范围内目标数量超过此分支';
  if (w.healthAtOrBelow !== undefined && facts.health > w.healthAtOrBelow) return '未到此分支血线';
  if (w.healthAtOrAbove !== undefined && facts.health < w.healthAtOrAbove) return '低于此分支血线';
  if (w.dimension !== undefined && facts.dimension !== w.dimension) return '维度不符或未知';
  if (w.onGround !== undefined && facts.onGround !== w.onGround) return '落地状态不符或未知';
  if (w.manaAtLeast !== undefined && (facts.manaLoading || facts.mana === null
    || facts.mana < w.manaAtLeast)) return '魔力条件不满足或读数未知';
  if (w.reserveMana !== undefined && (facts.manaLoading || facts.mana === null || facts.cost === null
    || facts.mana - facts.cost < w.reserveMana)) return '施法后保留魔力不足或读数未知';
  return null;
}
