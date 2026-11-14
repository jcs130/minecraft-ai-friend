/**
 * Server-side window bookkeeping that does not depend on mineflayer tracking.
 *
 * Some plugin GUIs (/rtp, /ss log on AuthMe 26.1 servers) send `window_items`
 * without `open_window`, and an `open_window` mineflayer cannot model leaves
 * `bot.currentWindow` null. Mineflayer then never closes it, and later
 * commands fail with a server "window already open" rejection.
 *
 * - Every non-player window id the server opens or fills is recorded until the
 *   server or this client closes it, so close() can always release it.
 * - A window that appears within `commandHoldMs` of a player command (/rtp,
 *   /menu, /linggen) is a GUI the player asked for: it is adopted as a normal
 *   mineflayer window (synthetic open_window from the recorded packets) so it
 *   can be read and clicked, instead of being closed. Adopted windows the
 *   player never touches are released after `adoptedIdleMs`.
 * - Any other unexplained window_items is closed after a short grace period
 *   (villagers and some chests send items slightly before open_window).
 */
export interface OrphanWindowCloseOptions {
  graceMs?: number;
  commandHoldMs?: number;
  adoptedIdleMs?: number;
  onClose?: (info: { windowId: number }) => void;
  onAdopt?: (info: { windowId: number }) => void;
}

export interface ServerWindowRecord {
  id: number;
  /** open_window packet seen for this id (title/type are the server's). */
  opened: boolean;
  title: unknown;
  inventoryType: unknown;
  /** Total slots from window_items, including the 36 player slots. */
  itemCount: number | null;
  at: number;
  adopted: boolean;
}

export interface ServerWindowApi {
  /** The window the server believes is open, tracked or not. */
  current(): ServerWindowRecord | null;
  lastCommandAt(): number;
  /** Close the open server window (mineflayer window first). Returns the id released, or null. */
  close(): number | null;
  /**
   * Vanilla Escape when nothing is tracked: send close_window for the last container id the
   * server used (0 if none). The server closes whatever menu it thinks is open regardless of id.
   */
  escape(): number;
}

type PacketClient = {
  state?: string;
  on(event: string, handler: (packet: any) => void): void;
  off(event: string, handler: (packet: any) => void): void;
  emit?(event: string, packet: unknown): boolean;
  write(name: string, packet: any): void;
};

type BotLike = {
  currentWindow?: { id?: number } | null;
  closeWindow?: (window: any) => void;
  _client?: PacketClient | any;
};

const APIS = new WeakMap<object, ServerWindowApi>();

/** The server-window view installed on this bot, if any. */
export function serverWindows(bot: object | null | undefined): ServerWindowApi | null {
  return bot ? APIS.get(bot) ?? null : null;
}

const COMMAND_PACKETS = new Set(['chat_command', 'chat_command_signed']);

export function installOrphanWindowClose(bot: BotLike, options: OrphanWindowCloseOptions = {}): () => void {
  const client = bot._client as PacketClient | undefined;
  if (!client || typeof client.on !== 'function' || typeof client.write !== 'function') return () => {};
  const graceMs = Number.isInteger(options.graceMs) ? Math.max(0, options.graceMs!) : 200;
  const commandHoldMs = Number.isInteger(options.commandHoldMs) ? Math.max(0, options.commandHoldMs!) : 5_000;
  const adoptedIdleMs = Number.isInteger(options.adoptedIdleMs) ? Math.max(1_000, options.adoptedIdleMs!) : 120_000;
  const pending = new Map<number, ReturnType<typeof setTimeout>>();
  const opens = new Map<number, { windowTitle?: unknown; inventoryType?: unknown }>();
  const itemsById = new Map<number, { windowId: number; items: unknown[] }>();
  let open: ServerWindowRecord | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let commandAt = 0;
  let lastClickAt = 0;

  const cancel = (windowId: number | undefined): void => {
    if (!Number.isInteger(windowId)) return;
    const timer = pending.get(windowId!);
    if (timer) { clearTimeout(timer); pending.delete(windowId!); }
  };
  const forget = (windowId: number): void => {
    cancel(windowId);
    opens.delete(windowId);
    itemsById.delete(windowId);
    if (open?.id === windowId) {
      open = null;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    }
  };

  // Observe outgoing packets: player commands, clicks and closes. Wrapping keeps
  // the original write semantics; it is restored on dispose.
  const originalWrite = client.write;
  client.write = function (this: unknown, name: string, packet: any) {
    if (COMMAND_PACKETS.has(name)
      || (name === 'chat_message' && typeof packet?.message === 'string' && packet.message.startsWith('/'))) {
      commandAt = Date.now();
    }
    if (name === 'window_click') lastClickAt = Date.now();
    if (name === 'close_window' && Number.isInteger(packet?.windowId)) forget(packet.windowId);
    return originalWrite.call(client, name, packet);
  };

  const release = (id: number): void => {
    if (client.state && client.state !== 'play') return;
    client.write('close_window', { windowId: id });
    options.onClose?.({ windowId: id });
  };

  const rowsType = (count: number | null): number | null => {
    if (count === null) return null;
    const rows = (count - 36) / 9;
    return Number.isInteger(rows) && rows >= 1 && rows <= 6 ? rows - 1 : null;
  };

  const adopt = (id: number): boolean => {
    if (typeof client.emit !== 'function' || bot.currentWindow?.id === id) return bot.currentWindow?.id === id;
    const items = itemsById.get(id);
    const seen = opens.get(id);
    const count = items ? items.items.length : null;
    const types = [seen?.inventoryType, rowsType(count)].filter((t, i, all) => t !== undefined && t !== null && all.indexOf(t) === i);
    for (const inventoryType of types) {
      try {
        client.emit('open_window', { windowId: id, inventoryType,
          windowTitle: seen?.windowTitle ?? '服务器菜单', ...(count !== null ? { slotCount: count - 36 } : {}) });
      } catch { continue; }
      if (bot.currentWindow?.id === id) {
        if (items) client.emit('window_items', items);
        if (open?.id === id) open.adopted = true;
        options.onAdopt?.({ windowId: id });
        const adoptedAt = Date.now();
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function check() {
          idleTimer = null;
          if (open?.id !== id) return;
          if (lastClickAt > adoptedAt) return; // the player is using it
          if (bot.currentWindow?.id === id && typeof bot.closeWindow === 'function') bot.closeWindow(bot.currentWindow);
          else release(id);
          forget(id);
        }, adoptedIdleMs);
        (idleTimer as { unref?: () => void }).unref?.();
        return true;
      }
    }
    return false;
  };

  const settle = (id: number): void => {
    pending.delete(id);
    if (bot.currentWindow?.id === id) return;
    if (client.state && client.state !== 'play') return;
    const requested = commandAt > 0 && (open?.at ?? Date.now()) - commandAt <= commandHoldMs;
    if (requested && adopt(id)) return;
    if (requested) return; // keep it recorded; close() can still release it
    release(id);
    forget(id);
  };

  const schedule = (id: number): void => {
    if (pending.has(id)) return;
    const timer = setTimeout(() => settle(id), graceMs);
    (timer as { unref?: () => void }).unref?.();
    pending.set(id, timer);
  };

  const record = (id: number, opened: boolean): void => {
    if (open?.id !== id) {
      open = { id, opened, title: opens.get(id)?.windowTitle ?? null, inventoryType: opens.get(id)?.inventoryType ?? null,
        itemCount: itemsById.get(id)?.items.length ?? null, at: Date.now(), adopted: false };
    } else {
      open.opened ||= opened;
      open.title = opens.get(id)?.windowTitle ?? open.title;
      open.inventoryType = opens.get(id)?.inventoryType ?? open.inventoryType;
      open.itemCount = itemsById.get(id)?.items.length ?? open.itemCount;
    }
  };

  const onItems = (packet: { windowId?: number; items?: unknown[] }): void => {
    const id = packet.windowId;
    if (!Number.isInteger(id) || id === 0) return;
    lastSeenId = id!;
    if (Array.isArray(packet.items)) itemsById.set(id!, { ...(packet as any), windowId: id!, items: packet.items });
    record(id!, opens.has(id!));
    if (bot.currentWindow?.id === id) { cancel(id); return; }
    schedule(id!);
  };

  let lastSeenId = 0;
  const onOpen = (packet: { windowId?: number; windowTitle?: unknown; inventoryType?: unknown }): void => {
    const id = packet.windowId;
    if (!Number.isInteger(id) || id === 0) return;
    lastSeenId = id!;
    opens.set(id!, { windowTitle: packet.windowTitle, inventoryType: packet.inventoryType });
    record(id!, true);
    cancel(id);
    // Mineflayer may still fail to model it (unknown type): re-check shortly.
    const timer = setTimeout(() => {
      pending.delete(id!);
      if (bot.currentWindow?.id === id || open?.id !== id) return;
      settle(id!);
    }, graceMs + 100);
    (timer as { unref?: () => void }).unref?.();
    pending.set(id!, timer);
  };
  const onServerClose = (packet: { windowId?: number }): void => {
    if (Number.isInteger(packet.windowId)) forget(packet.windowId!);
  };
  const onRespawn = (): void => { for (const id of [...opens.keys(), ...itemsById.keys()]) forget(id); open = null; };

  client.on('window_items', onItems);
  client.on('open_window', onOpen);
  client.on('open_horse_window', onOpen);
  client.on('close_window', onServerClose);
  client.on('respawn', onRespawn);

  const api: ServerWindowApi = {
    current: () => {
      const cur = bot.currentWindow;
      if (cur && Number.isInteger(cur.id) && cur.id !== 0 && open?.id !== cur.id) record(cur.id!, true);
      return open ? { ...open } : null;
    },
    lastCommandAt: () => commandAt,
    escape: () => {
      const id = open?.id ?? bot.currentWindow?.id ?? lastSeenId;
      if (bot.currentWindow && bot.currentWindow.id !== 0 && typeof bot.closeWindow === 'function') bot.closeWindow(bot.currentWindow);
      else client.write('close_window', { windowId: id });
      if (open) forget(open.id);
      return id;
    },
    close: () => {
      const cur = bot.currentWindow;
      if (cur && cur.id !== 0 && typeof bot.closeWindow === 'function') {
        const id = cur.id ?? null;
        bot.closeWindow(cur);
        if (id !== null) forget(id);
        return id;
      }
      if (!open) return null;
      const id = open.id;
      release(id);
      forget(id);
      return id;
    },
  };
  APIS.set(bot, api);

  return () => {
    client.off('window_items', onItems);
    client.off('open_window', onOpen);
    client.off('open_horse_window', onOpen);
    client.off('close_window', onServerClose);
    client.off('respawn', onRespawn);
    if (client.write !== originalWrite) client.write = originalWrite;
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    if (idleTimer) clearTimeout(idleTimer);
    if (APIS.get(bot) === api) APIS.delete(bot);
  };
}
