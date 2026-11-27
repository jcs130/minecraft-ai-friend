/** Read-only presentation of a verified book read or an operation in progress. */
export type ViewerInteractionDetail =
  | { kind: 'book-read'; title: string; text: string; author?: string; page: number | null; pageCount: number | null }
  | { kind: 'book-write'; title: string; text: string; pageCount: number }
  | { kind: 'sign-write'; title: string; lines: readonly string[]; side: 'front' | 'back' }
  | { kind: 'craft'; title: string; gridSize: 2 | 3; grid: readonly (string | null)[]; shaped: boolean }
  | { kind: 'rename'; title: string; item: string; name: string };

type Outcome = 'confirmed' | 'unconfirmed';
type Position = { x: number; y: number; z: number };
type Subject = object;
type Frame = ViewerInteractionDetail & {
  id: number;
  phase: 'active' | Outcome;
  result: string | null;
};
type Display = Frame & { remainingMs: number };
type Current = { display: Frame; expires: number; origin: Position | null };
type Channel = { nextId: number; current: Current | null; listeners: Set<() => void> };
const channels = new WeakMap<Subject, Channel>();
const positionOf = (subject: Subject) => (subject as { entity?: { position?: Position } }).entity?.position;

function channel(subject: Subject): Channel {
  const existing = channels.get(subject);
  if (existing) return existing;
  const state = { nextId: 0, current: null, listeners: new Set<() => void>() };
  channels.set(subject, state);
  return state;
}

function notify(state: Channel): void {
  for (const listener of state.listeners) {
    try { listener(); } catch { /* Presentation cannot interrupt gameplay. */ }
  }
}

export function viewerInteraction(subject: Subject, now = Date.now()): Display | null {
  const state = channels.get(subject);
  const current = state?.current;
  if (!state || !current) return null;
  const here = positionOf(subject);
  const origin = current.origin;
  if (now >= current.expires || (here && origin && Math.hypot(here.x - origin.x, here.y - origin.y, here.z - origin.z) > 1.75)) {
    state.current = null;
    return null;
  }
  return { ...current.display, remainingMs: current.expires - now };
}

export function onViewerInteraction(subject: Subject, listener: () => void): () => void {
  const state = channel(subject);
  state.listeners.add(listener);
  return () => { state.listeners.delete(listener); };
}

function limitDetail(detail: ViewerInteractionDetail): ViewerInteractionDetail {
  const title = detail.title.slice(0, 160);
  switch (detail.kind) {
    case 'book-read':
      return { ...detail, title, author: detail.author?.slice(0, 80), text: detail.text.slice(0, 1500) };
    case 'book-write':
      return { ...detail, title, text: detail.text.slice(0, 1500) };
    case 'sign-write':
      return { ...detail, title, lines: detail.lines.slice(0, 4).map(line => line.slice(0, 384)) };
    case 'craft':
      return { ...detail, title, grid: detail.grid.slice(0, detail.gridSize ** 2).map(item => item?.slice(0, 96) ?? null) };
    case 'rename':
      return { ...detail, title, item: detail.item.slice(0, 128), name: detail.name.slice(0, 128) };
  }
}

export function beginViewerInteraction(subject: Subject, detail: ViewerInteractionDetail): number {
  const state = channel(subject);
  const id = ++state.nextId;
  const point = positionOf(subject);
  state.current = {
    display: { ...limitDetail(detail), id, phase: 'active', result: null },
    expires: Date.now() + (detail.kind === 'book-read' ? 9000 : 10000),
    origin: point ? { x: point.x, y: point.y, z: point.z } : null,
  };
  notify(state);
  return id;
}

export function finishViewerInteraction(subject: Subject, id: number, phase: Outcome, result?: string): void {
  const state = channels.get(subject);
  const current = state?.current;
  if (!state || !current || current.display.id !== id || current.display.phase !== 'active') return;
  current.display = { ...current.display, phase, result: result?.slice(0, 200) ?? null };
  current.expires = Date.now() + (phase === 'confirmed' ? 2300 : 1200);
  notify(state);
}

export function clearViewerInteraction(subject: Subject, kind?: ViewerInteractionDetail['kind']): void {
  const state = channels.get(subject);
  if (!state?.current || (kind && state.current.display.kind !== kind)) return;
  state.current = null;
  notify(state);
}
