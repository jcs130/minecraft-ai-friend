import type { CombatDecisionFrame } from '../../core/combat-decision-types.ts';
import type { EventEnvelope } from '../contracts/index.ts';
import { executionFeedbackContext } from '../client/execution-context.ts';

export interface CombatDecisionAttention {
  schema: 'combat-decision-attention/v1';
  decisionId: string;
  firstDecisionId: string;
  observedAtMs: number;
  sinceMs: number;
  count: number;
  reason: 'repeated-ambiguous-ranking';
  connectionGeneration: number;
  world: string | null;
  tacticRevision: number;
  program: { name: string; sourceHash: string } | null;
  position: [number, number, number];
  bodyIdle: true;
  dispatched: false;
  threats: Array<{ entityId: number | null; type: string | null; distance: number | null; nativeReference?: string }>;
  alternatives: Array<{ id: string; kind: string; targetId?: number }>;
}

/** Report failed selection to the owning agent; never convert uncertainty into an attack. */
export class CombatAbstention {
  private episode: { key: string; firstDecisionId: string; sinceMs: number; lastAtMs: number; count: number;
    notified: boolean; pending: CombatDecisionAttention | null; origin: number[] } | null = null;
  clear() { this.episode = null; }
  private key(frame: CombatDecisionFrame): string | null {
    const b = frame.battlefield, a = b.action;
    if (a.emergency || a.fighting || a.tracking || a.taskId != null || a.followTarget
      || !b.actors.some(e => e.relation === 'hostile' && e.lineOfSight === true && (e.health.current === null || e.health.current > 0))) return null;
    return JSON.stringify([b.connectionGeneration, b.dimension, b.world?.key, b.world?.revision,
      frame.tacticRevision, frame.policy?.sourceHash, b.self.entityId,
      b.actors.filter(e => e.relation !== 'neutral').map(e => [e.entityId, e.uuid, e.relation, e.lineOfSight, e.health.current === 0, e.targetEntityId]).sort(),
      frame.candidates.map(c => { const { intent: _intent, ...identity } = c; return identity; })]);
  }
  context(frame: CombatDecisionFrame, now: number, observed = false) {
    const e = this.episode;
    if (!e) return null;
    if (e.key !== this.key(frame) || now < e.lastAtMs || now - (e.pending?.observedAtMs ?? e.lastAtMs) > 10_000
      || Math.hypot(...frame.battlefield.self.position.map((v, i) => v - e.origin[i]!)) > 1.5) { this.clear(); return null; }
    if (observed && e.notified) e.lastAtMs = now;
    return { reason: 'ambiguous-ranking', count: e.count, elapsedMs: now - e.sinceMs, dispatched: false, bodyIdle: true,
      ownerReviewRequested: e.notified };
  }
  pendingAttention(frame: CombatDecisionFrame, now: number): CombatDecisionAttention | null {
    return this.context(frame, now) ? this.episode?.pending ?? null : null;
  }
  delivered(attention: CombatDecisionAttention) {
    if (this.episode?.pending !== attention) return;
    this.episode.pending = null;
    this.episode.notified = true;
  }
  record(frame: CombatDecisionFrame, decisionId: string, now: number): CombatDecisionAttention | null {
    const key = this.key(frame);
    if (!key) { this.clear(); return null; }
    this.context(frame, now);
    const e = this.episode ??= { key, firstDecisionId: decisionId, sinceMs: now, lastAtMs: now, count: 0,
      notified: false, pending: null, origin: [...frame.battlefield.self.position] };
    e.lastAtMs = now; e.count++;
    // A single abstention is normal. A repeated idle episode requires an owner decision.
    if (e.notified || e.pending || e.count < 3 || now - e.sinceMs < 1500) return null;
    const b = frame.battlefield;
    return e.pending = { schema: 'combat-decision-attention/v1', decisionId, firstDecisionId: e.firstDecisionId,
      observedAtMs: now, sinceMs: e.sinceMs, count: e.count, reason: 'repeated-ambiguous-ranking',
      connectionGeneration: b.connectionGeneration, world: b.world?.key ?? b.dimension, tacticRevision: frame.tacticRevision,
      program: frame.policy ? { name: frame.policy.name, sourceHash: frame.policy.sourceHash } : null,
      position: [...b.self.position], bodyIdle: true, dispatched: false,
      threats: b.actors.filter(e => e.relation === 'hostile' && e.lineOfSight === true && (e.health.current === null || e.health.current > 0))
        .slice(0, 6).map(({ entityId, type, distance, nativeReference }) =>
          ({ entityId, type, distance, ...(nativeReference ? { nativeReference } : {}) })),
      alternatives: frame.candidates.slice(0, 8).map(c => ({ id: c.id, kind: c.kind, ...('targetId' in c ? { targetId: c.targetId } : {}) })) };
  }
}

/** Compact evidence for host event streams, not a new command or a goal completion. */
export function combatAttentionText(a: CombatDecisionAttention): string {
  return `[战斗决策未执行] ${a.count} 次快决策因选项排序接近未下发动作；身体空闲，不能解释为自动战斗正在推进。`
    + `当前可见敌对：${a.threats.map(e => `${e.nativeReference ?? `${e.type ?? '未知种类'}#${e.entityId}`} 距离${e.distance ?? '未知'}格`).join('、')}。`
    + `候选：${a.alternatives.map(c => c.kind).join('/')}；战术版本 ${a.tacticRevision}。`
    + '执行者请核对当前现场与战术，明确选择攻击、观察、避险或修订方法；观察不会造成伤害。不要只重复等待快决策。'
    + `证据 ${a.firstDecisionId} → ${a.decisionId}，采样 ${new Date(a.observedAtMs).toISOString()}；不证明行动或目标完成。`;
}

/** Native decision feedback belongs in the World event stream and the active execution inbox. */
export function combatAttentionEvent(evidence: CombatDecisionAttention, source = 'minecraft'): Omit<EventEnvelope, 'cursor'> {
  const text = combatAttentionText(evidence);
  return { ts: new Date(evidence.observedAtMs).toISOString(), source, type: `${source}.tactic`,
    senderKey: `${source}.combat-decision`, origin: 'external', text,
    meta: { combatAttention: evidence, executionFeedback: executionFeedbackContext(text, 'host-decision') } };
}
