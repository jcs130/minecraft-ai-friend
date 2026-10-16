import type { JavaClientState } from '../contracts/java-client.ts';
/** Consumes only the bridge's scoped evidence port, never chat text or historical success. */
export function nativeAuthorization(state: JavaClientState | null, required = false) {
  const raw = state?.serverAuthorization as Record<string, unknown> | undefined;
  const needs = required || raw?.required === true;
  if (!needs) return { required: false, ready: true, phase: 'not-required' };
  const address = (v: unknown) => typeof v === 'string' ? v.toLowerCase().replace(/:25565$/, '') : null;
  const scoped = !!state?.connected && raw?.protocol === 'agent-mc-server-authorization/v1'
    && raw.generation === state.generation && raw.username === state.username && address(raw.server) === address(state.server)
    && raw.connectionMatched === true;
  const ready = scoped && raw!.authorized === true && raw!.phase === 'confirmed';
  return { required: true, ready, phase: ready ? 'confirmed' : scoped && raw?.phase === 'blocked' ? 'blocked'
    : scoped && raw?.phase === 'required' ? 'required' : 'pending' };
}
