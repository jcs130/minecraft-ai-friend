/** Compact inference input; the decision loop retains the complete frame for execution checks. */
import type { CombatDecisionFrame } from '../../core/combat-decision-types.ts';

export function combatRequest(frame: CombatDecisionFrame) {
  const b = frame.battlefield;
  // Four significant digits keep tiny positive health positive; execution retains the original precision.
  const approximate = (value: number | null) => value === null ? null : Number(value.toPrecision(4));
  const health = (value: typeof b.self.health) => [approximate(value.current), approximate(value.max), value.source,
    value.updatedAtMs === null ? null : b.sampledAtMs - value.updatedAtMs];
  const criteria: Record<string, string> = { keep: b.action.fighting
    ? 'Preserve the current attack and movement.' : b.action.tracking
      ? 'Preserve tracking until its lease expires; track renews it.' : 'Remain idle; no body controller is running.' };
  const options: Record<string, unknown> = {};
  frame.candidates.forEach((candidate, index) => {
    const { id: _id, intent, ...parameters } = candidate;
    // UUID is checked locally against the fresh entity; the model chooses an option, not an identity.
    const { uuid: _uuid, ...primitive } = parameters as typeof parameters & { uuid?: string | null };
    const action = candidate.kind === 'method' ? { kind: 'method', method: candidate.id } : primitive;
    // The scorer must distinguish targets, directions, spells and authored methods.
    // Replacing every same-kind intent with one sentence made distinct choices indistinguishable.
    const binding = candidate.kind === 'engage' || candidate.kind === 'track' ? ` Target entityId:${candidate.targetId}.`
      : candidate.kind === 'cast' ? ` Spell:${candidate.spell}.`
        : candidate.kind === 'method' ? ` Method:${candidate.id}.`
          : candidate.kind === 'step' ? ` Step:${candidate.id}.` : '';
    criteria[`option_${index}`] = intent + binding;
    options[`option_${index}`] = action;
  });
  return { state: {
    battlefield: { dimension: b.dimension,
      self: { entityId: b.self.entityId, health: health(b.self.health), food: b.self.food,
        ...(frame.candidates.some(candidate => candidate.kind === 'step')
          ? { position: b.self.position.map(value => Math.round(value * 10) / 10) } : {}), equipment: b.self.equipment ?? null },
      action: b.action,
      actors: b.actors.map(actor => ({ entityId: actor.entityId, type: actor.type,
        relation: actor.relation, relationSource: actor.relationSource, health: health(actor.health),
        distance: actor.distance, height: actor.position ? Math.round((actor.position[1] - b.self.position[1]) * 10) / 10 : null,
        lineOfSight: actor.lineOfSight, targetEntityId: actor.targetEntityId })),
      omitted: b.omitted,
    },
    mana: approximate(frame.mana), skills: frame.skills.map(({ block, ...skill }) => ({ ...skill, blocked: block !== null })),
    options, omittedCandidates: frame.omittedCandidates,
  }, questions: { tactic: { type: 'choice' as const,
    instructions: 'Choose for survival or confirmed allies; keep an effective action. Health≈[current,max,source,ageMs]; null=unknown; blocked=cannot execute. Proximity does not establish allies.'
      + (frame.policy ? '\nAgent tactic: ' + frame.policy.instructions : ''), criteria,
  } } };
}
