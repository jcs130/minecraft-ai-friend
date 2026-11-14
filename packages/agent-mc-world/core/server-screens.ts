import type { EventEmitter } from 'node:events';
import { isAuthMeLoginDialog, minecraftTextComponent, unwrapNbt } from './nbt-text.mjs';
import { readOpenedBook } from './window-protocol.ts';

/**
 * Screens the server opens that are not container windows: 26.1 dialogs (show_dialog /
 * clear_dialog), written books (open_book) and the death screen. Mineflayer models none of
 * them, so without this the agent cannot see why the server says "an interface is open".
 * Read-only bookkeeping; closing/acknowledging is done by dismissScreen() the vanilla way.
 */
export interface ScreenButton { index: number; label: string; tooltip: string | null; action: { type: string; command?: string; id?: string; url?: string } | null }
export interface ServerScreen {
  kind: 'dialog' | 'book' | 'death';
  openedAt: number;
  title: string;
  body: string[];
  buttons: ScreenButton[];
  dialogType: string | null;
  canCloseWithEscape: boolean | null;
  exitAction: ScreenButton | null;
  inputs: string[];
  /** Dialog is a registry reference the client cannot resolve (id only). */
  reference: string | null;
}

interface ScreenBot extends EventEmitter {
  _client: EventEmitter & { write: (name: string, params: unknown) => unknown };
  heldItem?: { name?: string; components?: unknown; nbt?: unknown } | null;
}

const STATES = new WeakMap<object, { current: ServerScreen | null; listeners: Set<(s: ServerScreen | null) => void> }>();
const text = (v: unknown) => { try { return minecraftTextComponent(v).replace(/\s+$/g, ''); } catch { return ''; } };
const str = (v: unknown) => typeof v === 'string' ? v : null;

function button(raw: any, index: number): ScreenButton | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw.action && typeof raw.action === 'object' ? raw.action : null;
  const action = a ? { type: String(a.type ?? 'unknown').replace(/^minecraft:/, ''),
    ...(str(a.command) ? { command: a.command } : {}), ...(str(a.id) ? { id: a.id } : {}), ...(str(a.url) ? { url: a.url } : {}),
    ...(a.template && str(a.template) ? { command: a.template } : {}) } : null;
  return { index, label: text(raw.label) || (action?.type ?? '按钮'), tooltip: raw.tooltip ? text(raw.tooltip) : null, action };
}

/** Parse the show_dialog payload (inline NBT or a registry id) into plain data. */
export function parseDialog(packet: any, now = Date.now()): ServerScreen {
  const holder = packet?.dialog ?? packet;
  const raw = holder && typeof holder === 'object' && 'data' in holder ? holder.data : holder;
  const reference = typeof holder === 'number' || typeof holder === 'string' ? String(holder)
    : typeof holder?.id === 'number' || typeof holder?.id === 'string' ? String(holder.id) : null;
  const d: any = raw && typeof raw === 'object' ? unwrapNbt(raw) : {};
  const bodyParts = Array.isArray(d.body) ? d.body : d.body ? [d.body] : [];
  const body = bodyParts.map((b: any) => b && typeof b === 'object' && ('contents' in b || 'type' in b)
    ? (b.contents !== undefined ? text(b.contents) : b.item ? `[物品] ${String(b.item?.id ?? b.item)}` : text(b))
    : text(b)).filter(Boolean);
  const buttons: ScreenButton[] = [];
  const push = (raw: any) => { const b = button(raw, buttons.length); if (b) buttons.push(b); };
  if (Array.isArray(d.actions)) d.actions.forEach(push);
  if (d.action) push(d.action);
  if (d.yes) push(d.yes);
  if (d.no) push(d.no);
  if (Array.isArray(d.dialogs)) for (const x of d.dialogs) buttons.push({ index: buttons.length, label: typeof x === 'string' ? x : text(x?.title) || '对话', tooltip: null, action: { type: 'show_dialog' } });
  const exitAction = d.exit_action ? button(d.exit_action, -1) : d.no ? button(d.no, -1) : null;
  const inputs = Array.isArray(d.inputs) ? d.inputs.map((i: any) => `${String(i?.type ?? 'input').replace(/^minecraft:/, '')}:${String(i?.key ?? '')}${i?.label ? ' ' + text(i.label) : ''}`) : [];
  return { kind: 'dialog', openedAt: now, title: text(d.title) || (reference ? `对话 ${reference}` : '对话框'), body, buttons,
    dialogType: d.type ? String(d.type).replace(/^minecraft:/, '') : null,
    canCloseWithEscape: typeof d.can_close_with_escape === 'boolean' ? d.can_close_with_escape : d.can_close_with_escape === 1 ? true : d.can_close_with_escape === 0 ? false : null,
    exitAction, inputs, reference: Object.keys(d).length ? null : reference };
}

export function serverScreen(bot: object | null | undefined): ServerScreen | null { return bot ? STATES.get(bot)?.current ?? null : null; }
export function onServerScreen(bot: object, fn: (s: ServerScreen | null) => void): () => void {
  const st = STATES.get(bot); if (!st) return () => {};
  st.listeners.add(fn); return () => st.listeners.delete(fn);
}

export function installServerScreens(bot: ScreenBot): () => void {
  const st = { current: null as ServerScreen | null, listeners: new Set<(s: ServerScreen | null) => void>() };
  STATES.set(bot, st);
  const set = (s: ServerScreen | null) => { st.current = s; for (const fn of st.listeners) { try { fn(s); } catch { /* listener */ } } };
  const onDialog = (packet: unknown) => {
    try { if (isAuthMeLoginDialog((packet as any)?.dialog ?? packet)) return; } catch { /* not auth */ }
    set(parseDialog(packet));
  };
  const onClear = () => { if (st.current?.kind === 'dialog') set(null); };
  const onBook = (packet: Record<string, unknown> = {}) => {
    const book = readOpenedBook(bot, packet);
    const title = book.title || '书本';
    const body: string[] = [];
    if (book.author) body.push(`作者 ${book.author}`);
    body.push(...book.pages);
    if (!book.pages.length) body.push('未能读出正文。');
    set({ kind: 'book', openedAt: Date.now(), title, body, buttons: [], dialogType: null,
      canCloseWithEscape: true, exitAction: null, inputs: [], reference: null });
  };
  const onDeath = () => set({ kind: 'death', openedAt: Date.now(), title: '你死了', body: [], buttons: [{ index: 0, label: '重生', tooltip: null, action: { type: 'respawn' } }],
    dialogType: null, canCloseWithEscape: false, exitAction: null, inputs: [], reference: null });
  const onRespawn = () => { if (st.current?.kind === 'death' || st.current?.kind === 'dialog') set(null); };
  const onEnd = () => dispose();
  bot._client.on('show_dialog', onDialog); bot._client.on('clear_dialog', onClear); bot._client.on('open_book', onBook);
  bot.on('death', onDeath); bot.on('respawn', onRespawn); bot.on('spawn', onRespawn); bot.once('end', onEnd);
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    bot._client.off('show_dialog', onDialog); bot._client.off('clear_dialog', onClear); bot._client.off('open_book', onBook);
    bot.off('death', onDeath); bot.off('respawn', onRespawn); bot.off('spawn', onRespawn); bot.off('end', onEnd);
    st.listeners.clear();
  };
  return dispose;
}

/** Forget a book screen (the vanilla client sends nothing when a book closes). */
export function closeLocalScreen(bot: object, kinds: ServerScreen['kind'][] = ['book']): boolean {
  const st = STATES.get(bot); if (!st?.current || !kinds.includes(st.current.kind)) return false;
  st.current = null; for (const fn of st.listeners) { try { fn(null); } catch { /* */ } }
  return true;
}

export function renderScreen(s: ServerScreen): string {
  const lines = [`[界面] ${s.kind === 'dialog' ? '服务端对话框' : s.kind === 'book' ? '书本' : '死亡界面'}「${s.title}」${s.dialogType ? `（${s.dialogType}）` : ''}`];
  for (const b of s.body.slice(0, 12)) lines.push('  ' + b.slice(0, 300));
  for (const b of s.buttons) lines.push(`  按钮 #${b.index}「${b.label}」${b.action ? ` → ${b.action.type}${b.action.command ? ' ' + b.action.command : ''}` : ''}`);
  if (s.inputs.length) lines.push(`  输入框：${s.inputs.join('、')}`);
  if (s.exitAction) lines.push(`  关闭时动作：${s.exitAction.label}`);
  return lines.join('\n');
}
