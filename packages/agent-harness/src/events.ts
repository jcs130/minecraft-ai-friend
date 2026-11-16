import type { McEventLike } from 'agent-mc-memory';
import type { HarnessEvent, HarnessEventKind } from './types.ts';

type Draft = Omit<HarnessEvent, 'seq' | 'at'> & { at?: string };
interface Subscriber { listener: (e: HarnessEvent) => void; minSeverity: number }

/** Bounded key-event stream for the host: push (subscribe) and pull (cursor) over the same ring buffer. */
export class EventHub {
  private buffer: HarnessEvent[] = [];
  private seq = 0;
  private readonly subscribers = new Set<Subscriber>();
  constructor(private readonly capacity = 500, private readonly now: () => Date = () => new Date()) {}

  emit(draft: Draft): HarnessEvent {
    const event: HarnessEvent = { ...draft, seq: ++this.seq, at: draft.at ?? this.now().toISOString() };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
    for (const s of this.subscribers) {
      if (event.severity < s.minSeverity) continue;
      // Never let a host callback block or break the harness.
      queueMicrotask(() => { try { s.listener(event); } catch { /* isolated */ } });
    }
    return event;
  }

  subscribe(listener: (e: HarnessEvent) => void, minSeverity: 1 | 2 | 3 = 1): () => void {
    const s = { listener, minSeverity }; this.subscribers.add(s);
    return () => { this.subscribers.delete(s); };
  }

  pull(after = 0, limit = 20, minSeverity: 1 | 2 | 3 = 1): { events: HarnessEvent[]; latest: number; dropped: boolean } {
    const oldest = this.buffer[0]?.seq ?? this.seq + 1;
    const events = this.buffer.filter(e => e.seq > after && e.severity >= minSeverity).slice(0, Math.max(1, Math.min(100, limit)));
    return { events, latest: this.seq, dropped: after < oldest - 1 };
  }

  recent(limit: number, minSeverity: 1 | 2 | 3 = 2): HarnessEvent[] {
    return this.buffer.filter(e => e.severity >= minSeverity).slice(-limit);
  }
  latest(): number { return this.seq; }
}

const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Map a body event to a key event, or null if it is not worth telling the host. */
export function classifyBodyEvent(event: McEventLike, self: string): Draft | null {
  const meta = event.meta ?? {};
  const uname = typeof meta.uname === 'string' ? meta.uname : null;
  const base = { at: event.ts, data: { bodyType: event.type, ...(event.cursor !== undefined ? { cursor: event.cursor } : {}) } };
  const mk = (kind: HarnessEventKind, severity: 1 | 2 | 3, text: string, data: Record<string, unknown> = {}): Draft =>
    ({ ...base, kind, severity, text: short(text), data: { ...base.data, ...data } });

  const death = meta.death as { position?: { x: number; y: number; z: number } | null; cause?: { text?: string } | null } | undefined;
  if (event.type === 'minecraft.event' && death && typeof death === 'object') {
    const p = death.position;
    return mk('death', 3, `死亡${death.cause?.text ? `：${death.cause.text}` : ''}${p ? ` @ ${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` : ''}`,
      { position: p ?? null, cause: death.cause?.text ?? null });
  }
  const exec = event.execution;
  if (exec?.kind === 'task' && exec.terminal) {
    const ok = exec.phase === 'completed';
    return mk(ok ? 'task_completed' : 'task_failed', ok ? 2 : 3, `任务 ${exec.id} ${exec.phase}：${event.text}`,
      { executionId: exec.id, phase: exec.phase });
  }
  if (event.type === 'minecraft.event') {
    const level = /升到\s*(\d{1,5})\s*级/.exec(event.text);
    if (level) return mk('skill', 2, `等级提升到 ${level[1]}`, { level: Number(level[1]) });
  }
  if (event.type === 'minecraft.chat' && uname && uname !== self && meta.channel !== 'system') {
    const whisper = /^\[MC 私聊\]/.test(event.text);
    const mention = event.text.toLowerCase().includes(self.toLowerCase());
    if (whisper || mention) return mk('interaction', 3, event.text, { player: uname, whisper });
  }
  if ((event.type === 'minecraft.enter' || event.type === 'minecraft.leave') && uname)
    return mk('player_presence', 1, `${uname} ${event.type === 'minecraft.enter' ? '进服' : '离开'}`, { player: uname });
  return null;
}
