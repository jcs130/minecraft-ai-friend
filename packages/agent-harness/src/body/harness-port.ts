/**
 * Harness ↔ unified body glue: the executor's BodyPort, planner step checks and memory/key-event feeding all go through a
 * BodyAdapter, so the harness/gateway/planner never talk to a concrete body directly.
 */
import type { McEventLike, ObservedFacts } from 'agent-mc-memory';
import type { BodyOutcome, BodyPort } from '../planner.ts';
import type { ActionVerb, BodyAdapter, BodyCapabilities, BodyEvent } from './types.ts';
import { ACTION_VERBS } from './types.ts';

/** Step tool names: `body:<verb>` for unified verbs, `body:native:<name>` for body-specific operations. */
export const BODY_STEP = /^body:(?:native:[A-Za-z0-9_:.-]{1,64}|[a-z_]{2,16})$/;
export const LEGACY_STOP = /^(mc|mymc)_stop$/;

export function parseBodyStep(tool: string): { verb: ActionVerb; name?: string } | null {
  if (!BODY_STEP.test(tool)) return null;
  const rest = tool.slice(5);
  if (rest.startsWith('native:')) return { verb: 'native', name: rest.slice(7) };
  return (ACTION_VERBS as readonly string[]).includes(rest) && rest !== 'native' ? { verb: rest as ActionVerb } : null;
}

/** Is this step executable by a body with these capabilities? Returns a reason when not (planner degrades to needsHost). */
export function stepSupport(tool: string, caps: BodyCapabilities | null): string | null {
  const s = parseBodyStep(tool);
  if (s) {
    if (!caps) return null;
    if (s.verb === 'native') return caps.nativeActions.some(n => n.name === s.name) ? null
      : `body ${caps.kind} has no native action "${s.name}"`;
    return caps.actions[s.verb] ? null : `body ${caps.kind} does not support "${s.verb}" (supported: ${Object.keys(caps.actions).join(', ')})`;
  }
  // legacy agent-mc-world tool steps (mc_do …) only make sense on the mineflayer body
  if (caps && caps.kind !== 'mineflayer') return `step tool ${tool} is a Mineflayer (agent-mc-world) tool; use body:<verb> steps for a ${caps.kind} body`;
  return null;
}

/**
 * BodyPort over a unified adapter. Accepts `body:<verb>` / `body:native:<name>` steps for every body and legacy agent-mc-world tool
 * steps (`mc_do` …) for the mineflayer body (routed as native `tool:` actions so they keep the exclusive bodyKey).
 */
export function bodyAdapterPort(body: BodyAdapter): BodyPort {
  return {
    async call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<BodyOutcome> {
      if (LEGACY_STOP.test(tool) || tool === 'body:stop') {
        const r = await body.stop('harness stop');
        return { text: r.text, ...(r.status === 'completed' ? {} : { failed: true }) };
      }
      const s = parseBodyStep(tool);
      const action = s ? { verb: s.verb, ...(s.name ? { name: s.name } : {}), args }
        : body.kind === 'mineflayer' ? { verb: 'native' as const, name: `tool:${tool}`, args } : null;
      if (!action) return { text: `step ${tool} is not supported by the ${body.kind} body`, failed: true };
      const r = await body.act(action, signal);
      if (r.status === 'accepted') return { text: r.text, execution: { kind: 'task', id: r.executionId ?? r.requestId, phase: 'accepted', terminal: false } };
      if (r.status === 'completed') return { text: r.text, execution: { kind: 'task', id: r.executionId ?? r.requestId, phase: 'completed', terminal: true } };
      return { text: `[${r.status}] ${r.text}`, failed: true };
    },
  };
}

/**
 * Convert a unified body event to the agent-mc-world envelope shape memory and classifyBodyEvent understand.
 * Mineflayer events keep their original envelope + lazy facts; other bodies get an equivalent envelope with identity-derived facts.
 */
export function toMcEvent(e: BodyEvent, body: BodyAdapter): { event: McEventLike; facts: () => ObservedFacts | null } {
  if (e.bodyKind === 'mineflayer' && e.raw && typeof e.raw === 'object' && 'type' in (e.raw as object))
    return { event: e.raw as McEventLike, facts: (e.facts as (() => ObservedFacts | null) | undefined) ?? (() => null) };
  const id = body.identity();
  const facts = (): ObservedFacts | null => id ? { world: { key: id.world.worldKey ?? `${id.kind}:${id.world.serverId ?? 'unknown'}`, dimensionType: id.world.dimension },
    experience: { scope: id.scope } } : null;
  const meta: Record<string, unknown> = { body: e.bodyKind, bodyEvent: e.kind, ...e.data };
  const player = typeof e.data.player === 'string' ? e.data.player : typeof e.data.speaker === 'string' ? e.data.speaker : null;
  let type = `${e.bodyKind}.${e.kind}`;
  if (e.kind === 'death') { type = 'minecraft.event'; meta.death = { position: posOf(e.data), cause: e.data.cause ? { text: String(e.data.cause) } : null }; }
  else if (e.kind === 'level') type = 'minecraft.event';
  else if (e.kind === 'chat' || e.kind === 'whisper' || e.kind === 'dialogue') { type = 'minecraft.chat'; if (player) meta.uname = player; }
  else if (e.kind === 'system_message') { type = 'minecraft.chat'; meta.channel = 'system'; }
  else if (e.kind === 'player_join') { type = 'minecraft.enter'; if (player) meta.uname = player; }
  else if (e.kind === 'player_leave') { type = 'minecraft.leave'; if (player) meta.uname = player; }
  else if (e.kind === 'action_result' || e.kind === 'action_progress') type = 'minecraft.task';
  const text = e.kind === 'whisper' && !/^\[MC 私聊\]/.test(e.text) ? `[MC 私聊] ${e.text}` : e.kind === 'level' && !/升到/.test(e.text) ? `升到 ${e.data.level} 级` : e.text;
  return { event: { type, ts: e.at, text, source: e.bodyKind, meta, ...(e.execution ? { execution: e.execution } : {}) }, facts };
}

function posOf(d: Record<string, unknown>): { x: number; y: number; z: number } | null {
  const p = (d.position ?? (d.death as { position?: unknown } | undefined)?.position) as unknown;
  if (Array.isArray(p) && p.length === 3) return { x: Number(p[0]), y: Number(p[1]), z: Number(p[2]) };
  if (p && typeof p === 'object' && 'x' in p) { const q = p as { x: number; y: number; z: number }; return { x: q.x, y: q.y, z: q.z }; }
  return null;
}
