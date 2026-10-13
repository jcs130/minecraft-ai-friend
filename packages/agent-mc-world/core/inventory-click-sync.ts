/** Inventory clicks complete only after a server snapshot includes their slots and cursor. */
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import type { MinecraftLog } from './log.ts';

// A complete container round trip can include several server ticks and plugin hooks.
export const INVENTORY_CLICK_CONFIRM_MS = 3_000;

type Packet = Record<string, unknown>;
type Window = NonNullable<Bot['currentWindow']>;
type Phase = 'ready' | 'pending' | 'quarantined';
interface PendingClick {
  window: Window;
  sent: boolean;
  sentSeq: number;
  slot: number;
  button: number;
  mode: number;
  nativeSettled: boolean;
  createdSeq: number;
  expectedSlots: Map<number, string>;
  expectedCursor: string;
  complete(error?: Error): void;
}
interface SyncState {
  phase: Phase;
  reason?: string;
  packetSeq: number;
  windows: WeakMap<object, number>;
  windowSerial: number;
  transportSeq: number;
  authority: WeakMap<Window, { seq: number; fullSeq: number; items: unknown[]; cursor: unknown }>;
  pending: PendingClick | null;
  click(slot: number, button: number, mode: number): Promise<void>;
  diag?: MinecraftLog;
  decode?: (value: unknown) => Window['selectedItem'];
}
const states = new WeakMap<Bot, SyncState>();
const require = createRequire(import.meta.url);

export class InventoryClickSyncError extends Error {
  readonly code = 'inventory-click-sync';
  readonly reason: 'pending' | 'quarantined' | 'rollback' | 'window-replaced';
  constructor(message: string, reason: InventoryClickSyncError['reason']) {
    super(message);
    this.name = 'InventoryClickSyncError';
    this.reason = reason;
  }
}

export function isInventoryClickError(error: unknown): boolean {
  return error instanceof InventoryClickSyncError || (error !== null && typeof error === 'object'
    && 'code' in error && error.code === 'inventory-click-sync');
}

export function inventoryClickState(bot: Bot): { phase: Phase; reason?: string; packetSeq: number } {
  const state = states.get(bot);
  return { phase: state?.phase ?? 'ready', reason: state?.reason, packetSeq: state?.packetSeq ?? 0 };
}

export function assertInventoryClicksReady(bot: Bot): void {
  const state = states.get(bot);
  if (state && state.phase !== 'ready') {
    throw new InventoryClickSyncError(`库存点击暂缓：${state.reason ?? '上一笔点击仍在等待服务端完整同步'}，保留窗口和游标`,
      state.phase === 'pending' ? 'pending' : 'quarantined');
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

/** Stack compatibility includes component patches; count and slot do not identify the item. */
export function sameInventoryStack(a: unknown, b: unknown): boolean {
  const kind = (value: unknown): string => {
    const item = value as { type: number; metadata?: number | null; nbt?: unknown;
      components?: unknown[]; removedComponents?: unknown[] };
    return JSON.stringify(canonical({ type: item.type, metadata: item.metadata ?? null, nbt: item.nbt ?? null,
      components: [...(item.components ?? [])].map(canonical).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
      removedComponents: [...(item.removedComponents ?? [])].sort() }));
  };
  return kind(a) === kind(b);
}

function stackKey(value: unknown): string {
  const item = value as { present?: boolean; blockId?: number; itemCount?: number; itemId?: number;
    itemDamage?: number; nbtData?: unknown; components?: unknown[]; removeComponents?: unknown[] } | null;
  if (!item || item.present === false || item.blockId === -1 || !item.itemCount) return 'null';
  return JSON.stringify(canonical({ id: item.itemId ?? item.blockId, count: item.itemCount,
    damage: item.itemDamage ?? 0, nbt: item.nbtData ?? null,
    components: [...(item.components ?? [])].map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    removed: [...(item.removeComponents ?? [])].sort() }));
}

function windowSerial(state: SyncState, window: object): number {
  let serial = state.windows.get(window);
  if (serial === undefined) { serial = ++state.windowSerial; state.windows.set(window, serial); }
  return serial;
}

function record(state: SyncState, event: string, data: Record<string, unknown>): void {
  state.diag?.write({ lane: 'inventory', event, msg: '库存点击服务端同步', data });
}

function activeWindow(bot: Bot): Window { return bot.currentWindow ?? bot.inventory; }

/** Cursor-only packets use signed -1 or unsigned 255 in the 1.20.6 protocol. */
export function isInventoryCursorPacket(packet: { windowId?: number; slot?: number }): boolean {
  return (packet.windowId === -1 || packet.windowId === 255) && packet.slot === -1;
}

export function installInventoryClickSync(bot: Bot, diag?: MinecraftLog): void {
  const installed = states.get(bot);
  if (installed) { installed.diag ??= diag; return; }
  if (bot.supportFeature?.('stateIdUsed') !== true) return;
  const state: SyncState = { phase: 'ready', packetSeq: 0, windows: new WeakMap(), windowSerial: 0,
    transportSeq: 0, authority: new WeakMap(), pending: null, click: bot.clickWindow.bind(bot), diag };
  states.set(bot, state);
  const decode = (raw: unknown): Window['selectedItem'] => {
    if (!state.decode) {
      const factory = require(require.resolve('prismarine-item', { paths: [require.resolve('mineflayer')] })) as
        (registry: Bot['registry']) => { fromNotch(value: unknown): Window['selectedItem'] };
      state.decode = factory(bot.registry).fromNotch;
    }
    return state.decode(raw);
  };
  bot.clickWindow = (async (slot, button, mode) => {
    assertInventoryClicksReady(bot);
    await state.click(slot, button, mode);
  }) as Bot['clickWindow'];
  const client = bot._client as unknown as {
    write(name: string, packet: Packet): void;
    on(name: string, listener: (packet: Packet, meta?: { name?: string }) => void): void;
  };
  const write = client.write.bind(client);
  client.write = (name, packet): void => {
    const seq = ++state.packetSeq;
    const pending = state.pending;
    if (name === 'window_click' && state.phase === 'quarantined') assertInventoryClicksReady(bot);
    if (name === 'window_click' && pending) {
      if (pending.sent || activeWindow(bot) !== pending.window || packet.windowId !== pending.window.id
        || packet.slot !== pending.slot || packet.mouseButton !== pending.button || packet.mode !== pending.mode) {
        state.phase = 'quarantined'; state.reason = '窗口变化或有并发库存点击';
        const error = new InventoryClickSyncError(state.reason, 'window-replaced');
        pending.complete(error);
        throw error;
      }
      pending.sent = true; pending.sentSeq = seq;
      const slots = packet.changedSlots as Array<{ location: number; item: unknown }>;
      pending.expectedSlots = new Map(slots.map((slot) => [slot.location, stackKey(slot.item)]));
      pending.expectedCursor = stackKey(packet.cursorItem);
      const previousStateId = packet.stateId;
      // A state mismatch executes the click and asks Vanilla/Paper for the complete result.
      // This is the same click, with no retry or additional inventory operation.
      packet.stateId = -1;
      record(state, 'click-barrier', { packetSeq: seq, windowId: pending.window.id,
        windowSerial: windowSerial(state, pending.window), slot: pending.slot, previousStateId,
        touchedSlots: [...pending.expectedSlots.keys()] });
    }
    write(name, packet);
  };
  client.on('set_slot', (packet) => {
    const seq = ++state.packetSeq;
    const window = activeWindow(bot);
    if (isInventoryCursorPacket(packet) && packet.item !== undefined) {
      window.selectedItem = decode(packet.item);
      const frame = state.authority.get(window);
      if (frame) { frame.cursor = structuredClone(packet.item); frame.seq = seq; }
    } else {
      const target = packet.windowId === 0 ? bot.inventory : packet.windowId === window.id ? window : null;
      const frame = target ? state.authority.get(target) : undefined;
      if (frame && typeof packet.slot === 'number' && packet.slot >= 0 && packet.item !== undefined) {
        frame.items[packet.slot] = structuredClone(packet.item); frame.seq = seq;
      }
    }
  });
  client.on('window_items', (packet) => {
    const seq = ++state.packetSeq;
    const window = activeWindow(bot);
    const target = packet.windowId === 0 ? bot.inventory : window.id === packet.windowId ? window : null;
    if (!target) return;
    if (packet.carriedItem !== undefined) target.selectedItem = decode(packet.carriedItem);
    const items = packet.items as unknown[];
    const previousFrame = state.authority.get(target);
    if (previousFrame && items) {
      items.forEach((item, slot) => { previousFrame.items[slot] = structuredClone(item); });
      if (packet.carriedItem !== undefined) previousFrame.cursor = structuredClone(packet.carriedItem);
      previousFrame.seq = seq;
    }
    if (!items || items.length < target.slots.length || packet.carriedItem === undefined || target !== window) return;
    state.authority.set(target, { seq, fullSeq: seq, items: structuredClone(items), cursor: structuredClone(packet.carriedItem) });
    const pending = state.pending;
    if (pending && !pending.sent) {
      if (state.phase === 'quarantined' && pending.nativeSettled) restoreUnsentInventoryClick(bot, state, pending);
      return;
    }
    if (pending && seq <= pending.sentSeq) return;
    // The failed operation has already returned. A later complete server view
    // can restore inventory access without claiming that the click succeeded.
    if (state.phase === 'quarantined' && pending?.sent && pending.nativeSettled) {
      state.phase = 'ready'; state.reason = undefined; state.pending = null;
      record(state, 'click-recovered', { packetSeq: seq, windowId: window.id,
        windowSerial: windowSerial(state, window), failedSentSeq: pending.sentSeq });
      return;
    }
    if (pending && target === pending.window) {
      const mismatchedSlots = [...pending.expectedSlots].filter(([slot, key]) => stackKey(items[slot]) !== key)
        .map(([slot]) => slot);
      const cursorMatches = stackKey(packet.carriedItem) === pending.expectedCursor;
      if (mismatchedSlots.length > 0 || !cursorMatches) {
        // A previous click can send more than one full snapshot. Arrival after
        // this click was sent does not identify which click produced the frame.
        record(state, 'click-snapshot-mismatch', { packetSeq: seq, sentSeq: pending.sentSeq,
          windowId: window.id, windowSerial: windowSerial(state, window), slot: pending.slot,
          stateId: packet.stateId, mismatchedSlots, cursorMatches });
        return;
      }
      state.phase = 'ready'; state.reason = undefined; state.pending = null;
      record(state, 'click-confirmed', {
        packetSeq: seq, sentSeq: pending.sentSeq, windowId: window.id,
        windowSerial: windowSerial(state, window), slot: pending.slot, stateId: packet.stateId });
      pending.complete();
    } else if (state.phase === 'quarantined') {
      state.phase = 'ready'; state.reason = undefined; state.pending = null;
      record(state, 'click-recovered', { packetSeq: seq, windowId: window.id, windowSerial: windowSerial(state, window) });
    }
  });
  const onOpen = (packet: Packet): void => {
    const seq = ++state.packetSeq;
    const window = bot.currentWindow;
    record(state, 'window-open-event', { packetSeq: seq, windowId: packet.windowId,
      inventoryType: packet.inventoryType, windowTitle: typeof packet.windowTitle === 'string' ? packet.windowTitle.slice(0, 160) : undefined,
      windowSerial: window ? windowSerial(state, window) : null });
    if (state.pending && window !== state.pending.window) {
      state.phase = 'quarantined'; state.reason = '未决点击期间窗口被替换';
      state.pending.complete(new InventoryClickSyncError(state.reason, 'window-replaced'));
    }
  };
  client.on('open_window', onOpen);
  client.on('open_horse_window', onOpen);
  client.on('close_window', (packet) => {
    ++state.packetSeq;
    record(state, 'window-close-event', { packetSeq: state.packetSeq, windowId: packet.windowId });
    if (state.pending) {
      state.phase = 'quarantined'; state.reason = '未决点击期间窗口被服务端关闭';
      state.pending.complete(new InventoryClickSyncError(state.reason, 'window-replaced'));
    }
  });
  client.on('packet', (packet, meta) => {
    const seq = ++state.transportSeq;
    if (!['open_window', 'open_horse_window', 'close_window'].includes(meta?.name ?? '')) return;
    const window = bot.currentWindow;
    record(state, 'window-packet-raw', { transportSeq: seq, packetName: meta?.name, windowId: packet.windowId,
      windowSerial: window ? windowSerial(state, window) : null });
  });
  bot.on('end', () => {
    if (!state.pending) return;
    state.phase = 'quarantined'; state.reason = '连接结束，库存点击未完成';
    state.pending.complete(new InventoryClickSyncError(state.reason, 'quarantined'));
  });
}

/** A delayed native click must settle before a newer window snapshot can release its reservation. */
function restoreUnsentInventoryClick(bot: Bot, state: SyncState, pending: PendingClick): void {
  if (pending.sent || !pending.nativeSettled || state.pending !== pending || state.phase !== 'quarantined') return;
  const window = activeWindow(bot);
  const frame = state.authority.get(window);
  if (!frame || frame.fullSeq <= pending.createdSeq || !state.decode) return;
  // A blocked native closure may already have changed the local window optimistically.
  // Reapply the complete server view and every subsequent server slot/cursor update.
  const writable = window as unknown as { updateSlot(slot: number, item: Window['selectedItem']): void };
  frame.items.forEach((item, slot) => writable.updateSlot(slot, state.decode!(item)));
  window.selectedItem = state.decode(frame.cursor);
  state.phase = 'ready'; state.reason = undefined; state.pending = null;
  record(state, 'click-unsent-recovered', { packetSeq: state.packetSeq, snapshotSeq: frame.seq,
    windowId: window.id, windowSerial: windowSerial(state, window) });
}

export async function clickInventoryConfirmed(bot: Bot, slot: number, button: number, mode: number,
  expectedWindow?: Window): Promise<void> {
  installInventoryClickSync(bot);
  const state = states.get(bot);
  if (!state) { await bot.clickWindow(slot, button, mode); return; }
  assertInventoryClicksReady(bot);
  const window = activeWindow(bot);
  if (expectedWindow && expectedWindow !== window) throw new InventoryClickSyncError('合成期间窗口实例被替换，停止后续点击', 'window-replaced');
  let complete!: (error?: Error) => void;
  const confirmation = new Promise<void>((resolve, reject) => {
    complete = (error): void => { if (error) reject(error); else resolve(); };
  });
  const pending: PendingClick = { window, sent: false, sentSeq: 0, slot, button, mode,
    nativeSettled: false, createdSeq: state.packetSeq, expectedSlots: new Map(),
    expectedCursor: 'null', complete };
  state.phase = 'pending'; state.pending = pending;
  const timer = setTimeout(() => {
    if (state.pending !== pending) return;
    state.phase = 'quarantined'; state.reason = `点击窗口${window.id}槽${slot}后服务端未在 ${INVENTORY_CLICK_CONFIRM_MS}ms 内完整同步`;
    record(state, 'click-quarantined', { packetSeq: state.packetSeq, sentSeq: pending.sentSeq, slot, windowId: window.id });
    complete(new InventoryClickSyncError(`${state.reason}，暂停库存点击并保留材料游标`, 'quarantined'));
  }, INVENTORY_CLICK_CONFIRM_MS);
  // Mineflayer can resolve optimistically or keep waiting for an unchanged result slot.
  // Neither determines the result of this server snapshot barrier.
  void state.click(slot, button, mode).then(() => {
    pending.nativeSettled = true;
    if (!pending.sent) {
      state.phase = 'quarantined'; state.reason = '原生点击尚未发出，保留库存同步屏障';
      complete(new InventoryClickSyncError(state.reason, 'quarantined'));
      restoreUnsentInventoryClick(bot, state, pending);
    }
  }).catch((error: unknown) => {
    pending.nativeSettled = true;
    if (state.pending !== pending) return;
    state.phase = 'quarantined'; state.reason = String(error);
    complete(error instanceof Error ? error : new Error(String(error)));
    restoreUnsentInventoryClick(bot, state, pending);
  });
  try { await confirmation; } finally { clearTimeout(timer); }
}

/** Restore a server-confirmed cursor before recipe admission counts the player inventory. */
export async function resumeInventoryCursor(bot: Bot): Promise<void> {
  assertInventoryClicksReady(bot);
  const window = activeWindow(bot);
  for (let attempt = 0; window.selectedItem && attempt <= window.inventoryEnd - window.inventoryStart; attempt++) {
    const cursor = window.selectedItem;
    let dest: number | null = null;
    for (let slot = window.inventoryStart; slot < window.inventoryEnd; slot++) {
      const item = window.slots[slot];
      if (item && item.count < item.stackSize && sameInventoryStack(item, cursor)) { dest = slot; break; }
      if (!item && dest === null) dest = slot;
    }
    if (dest === null) throw new InventoryClickSyncError('背包没有位置归还服务端游标物品，材料保留在游标上', 'rollback');
    await clickInventoryConfirmed(bot, dest, 0, 0, window);
  }
  if (window.selectedItem) throw new InventoryClickSyncError('服务端游标仍未归位，暂停配方预检', 'rollback');
}
