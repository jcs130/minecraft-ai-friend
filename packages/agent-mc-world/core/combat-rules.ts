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
  description: 'Ordered conditional rules re-evaluated against current facts while fighting. With allowEngage enabled, a rule with intent may also be offered to the fast selector before melee begins, subject to the same engagement scope, free body, health, observed ability, mana and cooldown checks. First matching, ready rule wins during automatic combat; no match means no automatic offensive cast. [] restores spells/default priority. This is not a timed sequence; use mc_do for a bounded movement/action group.',
  items: {
    type: 'object', additionalProperties: false, required: ['id', 'spell', 'when'],
    properties: {
      id: { type: 'string', pattern: ID.source, description: 'Unique rule ID, retained in cast observations.' },
      spell: { type: 'string', pattern: ID.source, description: 'Observed ability ID from an explicitly installed server capability provider.' },
      intent: { type: 'string', minLength: 1, maxLength: 160,
        description: 'Optional concise effect and tactical purpose from the skill documentation. Required to offer this rule to the asynchronous fast selector; does not prove the spell is learned.' },
      when: { type: 'object', additionalProperties: false, properties: {
        within: { type: 'number', minimum: 1, description: 'Agent-chosen 3D distance for counting currently observed enemies; default 12. Does not load more terrain, reveal unobserved entities or change spell range/line of sight.' },
        enemyTypes: { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true, items: { type: 'string', pattern: ID.source }, description: 'Optional exact entity type IDs to count; bare IDs use the minecraft namespace (zombie = minecraft:zombie). Other namespaces remain distinct. Omitted counts all observed hostiles.' },
        hostilesAtLeast: { type: 'integer', minimum: 1, description: 'Minimum matching enemy count; default 1.' },
        hostilesAtMost: { type: 'integer', minimum: 1 },
        healthAtOrBelow: { type: 'number', minimum: 1, description: 'Absolute current health points; RPG health is not normalized to 20.' },
        healthAtOrAbove: { type: 'number', minimum: 1, description: 'Absolute current health points; RPG health is not normalized to 20.' },
        manaAtLeast: { type: 'number', minimum: 0 },
        reserveMana: { type: 'number', minimum: 0, description: 'Require at least this much mana after the observed spell cost. Unknown mana/cost fails the predicate.' },
        dimension: { type: 'string', minLength: 1, maxLength: 100, description: 'Exact current dimension identifier.' },
        onGround: { type: 'boolean' },
      } },
    },
  },
};

export function validCombatRules(value: unknown): value is CombatRule[] {
  return combatRulesError(value) === null;
}

export interface CombatRulesError { path: string; message: string }

/** First actionable validation error, shared by persisted tactics and public tool admission. */
export function combatRulesError(value: unknown): CombatRulesError | null {
  const fail = (path: string, message: string): CombatRulesError => ({ path, message });
  if (!Array.isArray(value)) return fail('rules', '须为数组。');
  if (value.length > COMBAT_RULES_SCHEMA.maxItems)
    return fail('rules', `最多 ${COMBAT_RULES_SCHEMA.maxItems} 项；这是每次快速评估的规则预算。`);
  const ids = new Set<string>();
  for (const [index, rule] of value.entries()) {
    const path = `rules[${index}]`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return fail(path, '须为对象。');
    const extra = Object.keys(rule).find(k => !Object.hasOwn(COMBAT_RULES_SCHEMA.items.properties, k));
    if (extra !== undefined) return fail(`${path}.${extra}`, '未知字段；可用 id、spell、intent、when。');
    for (const key of ['id', 'spell'] as const)
      if (typeof rule[key] !== 'string' || !ID.test(rule[key])) return fail(`${path}.${key}`, `须符合 ${ID.source}。`);
    if (ids.has(rule.id)) return fail(`${path}.id`, '规则 id 重复；每项须唯一。');
    if (rule.intent !== undefined && (typeof rule.intent !== 'string' || !rule.intent.trim().length || rule.intent.length > 160))
      return fail(`${path}.intent`, '须为 1–160 字符的非空说明。');
    if (!rule.when || typeof rule.when !== 'object' || Array.isArray(rule.when)) return fail(`${path}.when`, '须为条件对象。');
    ids.add(rule.id);
    const w = rule.when;
    for (const [key, v] of Object.entries(w)) {
      const schema = COMBAT_RULES_SCHEMA.items.properties.when.properties;
      const field = `${path}.when.${key}`;
      if (!Object.hasOwn(schema, key)) return fail(field, `未知条件；可用 ${Object.keys(schema).join('、')}。`);
      if (key === 'enemyTypes') {
        if (!Array.isArray(v) || !v.length || v.length > 16
          || v.some(t => typeof t !== 'string' || !ID.test(t)) || new Set(v).size !== v.length)
          return fail(field, '须为 1–16 个不重复的实体类型 ID。');
      } else if (key === 'dimension') {
        if (typeof v !== 'string' || !v.length || v.length > 100) return fail(field, '须为 1–100 字符的当前维度 ID。');
      } else if (key === 'onGround') {
        if (typeof v !== 'boolean') return fail(field, '须为 boolean。');
      } else {
        const limits = schema[key as Exclude<keyof typeof schema, 'enemyTypes' | 'dimension' | 'onGround'>];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < limits.minimum
          || (limits.type === 'integer' && !Number.isSafeInteger(v)))
          return fail(field, `须为${limits.type === 'integer' ? '安全整数' : '有限数值'}且 >= ${limits.minimum}。`);
      }
    }
    if (w.hostilesAtMost !== undefined && w.hostilesAtMost < (w.hostilesAtLeast ?? 1))
      return fail(`${path}.when.hostilesAtMost`, '须 >= hostilesAtLeast（省略时为 1）。');
    if (w.healthAtOrAbove !== undefined && w.healthAtOrBelow !== undefined && w.healthAtOrAbove > w.healthAtOrBelow)
      return fail(`${path}.when.healthAtOrAbove`, '须 <= healthAtOrBelow。');
  }
  return null;
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
