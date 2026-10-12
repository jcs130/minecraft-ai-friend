import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

const installed = Symbol.for('qiandengji.inventory-session');
const stable = value => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

/** One private file per player's UUID, outside the repository. A corrupt or
 * unwritable journal fails closed. Never delete it to recover an unknown action. */
export function createInventoryJournal(filename) {
  const file = path.resolve(filename), limit = 16_777_216;
  return {
    load() {
      if (!fs.existsSync(file)) return null;
      if (fs.statSync(file).size > limit) throw new Error('inventory_journal_too_large');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    save(state) {
      const bytes = Buffer.from(stable(state));
      if (bytes.length > limit) throw new Error('inventory_journal_too_large');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.' + randomUUID() + '.tmp';
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
    }
  };
}

/**
 * Opt-in, per-connection personal-container adapter, tested on Java 1.20.6.
 * Supply prismarine-item(bot.registry) as Item. Route ALL storage operations on
 * this connection through this session; do not mix clickWindow/deposit/withdraw.
 *
 * Mineflayer predicts clicks locally, and some versions only copy an open
 * container's player slots back to bot.inventory on close. Neither a resolved
 * click promise nor that intermediate inventory proves a server-side transfer.
 * Here clicks use the ordinary window_click protocol without predicting changed
 * slots. The server supplies the actual changed slots and carried item. Only
 * decoded SERVER packets enter the mirror or repair the local inventory view.
 * No new server protocol, synthetic success, item drop, or automatic retry.
 */
export function installInventorySession(bot, { Item, timeoutMs = 5000, quietMs = 80,
  requestRefresh = () => bot.chat('/mycli inventory refresh'), onReceipt = () => {}, journal } = {}) {
  if (bot[installed]) return bot[installed];
  if (!Item?.fromNotch || !Item?.toNotch) throw new TypeError('Supply prismarine-item(bot.registry) as Item');
  if (bot.version !== '1.20.6') throw new Error('Inventory session is verified for 1.20.6 only');
  if (!(timeoutMs >= 20 && timeoutMs <= 60000 && quietMs >= 0 && quietMs < timeoutMs)) throw new RangeError('Invalid inventory timeouts');
  let epoch = 0, revision = 0, active = null, ended = false, disposed = false;
  let queue = Promise.resolve(), blocked = null, lastRefresh = 0;
  const connectionId = randomUUID(), ownerUuid = bot.player?.uuid ?? null;
  const hooks = [], receipts = new Map();
  if (journal) {
    if (!ownerUuid || !journal.load || !journal.save) throw new Error('install_journal_after_spawn_with_stable_player_uuid');
    const saved = journal.load();
    if (saved) {
      if (saved.schemaVersion !== 1 || saved.ownerUuid !== ownerUuid || !Array.isArray(saved.receipts)
        || saved.receipts.length > 128 || saved.pending && (!saved.pending.id || saved.pending.before?.ownerUuid !== ownerUuid || !saved.pending.expected?.slots)) throw new Error('invalid_or_wrong_owner_inventory_journal');
      blocked = saved.pending;
      for (const r of saved.receipts) { if (!r.operationId || !r.status) throw new Error('invalid_inventory_journal_receipt'); receipts.set(r.operationId, r); }
    }
  }
  function checkpoint(pending, result) {
    if (!journal) return;
    const recent = new Map(receipts); if (result) recent.set(result.operationId, { schemaVersion: 1, ...result, at: Date.now() });
    journal.save({ schemaVersion: 1, ownerUuid, pending, receipts: [...recent.values()].slice(-128) });
  }
  const on = (emitter, name, fn) => { emitter.on(name, fn); hooks.push(() => emitter.off(name, fn)); };
  const cloneItem = raw => {
    const item = Item.fromNotch(raw);
    if (!item) return null;
    const wire = Item.toNotch(item), one = { ...wire };
    if ('itemCount' in one) one.itemCount = 1;
    if ('count' in one) one.count = 1;
    // Data components are an unordered map: Paper may serialize the same item
    // in a different component order after reconnect. Keep lore/page list order
    // intact, normalize ONLY the component and removed-component maps for identity.
    if (one.components) one.components = [...one.components].sort((a, b) => String(a.type ?? a.name).localeCompare(String(b.type ?? b.name)));
    if (one.removeComponents) one.removeComponents = [...one.removeComponents].sort();
    return { key: createHash('sha256').update(stable(one)).digest('hex'), name: item.name,
      count: item.count, stackSize: item.stackSize, wire: structuredClone(wire) };
  };
  const itemAt = (item, count) => count > 0 ? { ...structuredClone(item), count, wire: { ...structuredClone(item.wire), ...('itemCount' in item.wire ? { itemCount: count } : { count }) } } : null;
  const equal = (a, b) => (a?.key ?? null) === (b?.key ?? null) && (a?.count ?? 0) === (b?.count ?? 0);
  const same = (a, b) => a && b && a.slots.length === b.slots.length && a.slots.every((item, i) => equal(item, b.slots[i])) && equal(a.cursor, b.cursor);
  const snap = () => active?.slots ? { connectionId, ownerUuid, epoch: active.epoch, windowId: active.id, revision: active.rev, stateId: active.stateId,
    inventoryStart: active.start, inventoryEnd: active.end, slots: structuredClone(active.slots), cursor: structuredClone(active.cursor),
    observedAt: active.at, source: 'server_slot_packets' } : null;
  function syncPlayer(index, item) {
    // Open chest player region is 27 main slots then 9 hotbar slots (9..44).
    const slot = index - active.start + 9;
    const value = item ? Item.fromNotch(item.wire) : null;
    if (value) value.slot = slot;
    bot.inventory.updateSlot(slot, value);
  }
  function syncCursor(item) {
    const value = item ? Item.fromNotch(item.wire) : null;
    if (bot.currentWindow === active?.window) active.window.selectedItem = value;
    bot.inventory.selectedItem = value;
  }
  function changed(stateId) {
    active.stateId = stateId >= 0 ? stateId : active.stateId;
    active.rev = ++revision; active.at = Date.now();
  }
  on(bot._client, 'open_window', packet => {
    // A real open packet creates a new epoch even when the numeric id is reused.
    // Duplicate high-level windowOpen callbacks do not create/open operations.
    const window = bot.currentWindow;
    active = { epoch: ++epoch, id: packet.windowId, window, start: window?.inventoryStart,
      end: window?.inventoryEnd, slots: null, cursor: undefined, stateId: -1, rev: ++revision, full: 0, at: Date.now() };
  });
  on(bot._client, 'window_items', packet => {
    // Do not buffer packets for closed/unknown windows across a later id reuse.
    if (!active || packet.windowId !== active.id || bot.currentWindow !== active.window || packet.stateId < active.stateId) return;
    if (!Array.isArray(packet.items) || packet.items.length !== active.window?.slots.length || active.end - active.start !== 36 || packet.carriedItem === undefined) return;
    active.slots = packet.items.map(cloneItem); active.cursor = cloneItem(packet.carriedItem);
    changed(packet.stateId); active.full = active.rev;
    for (let i = active.start; i < active.end; i++) syncPlayer(i, active.slots[i]);
    syncCursor(active.cursor);
  });
  on(bot._client, 'set_slot', packet => {
    if (!active?.slots || bot.currentWindow !== active.window) return;
    // Protocol libraries may decode the cursor's byte sentinel as unsigned 255.
    if ((packet.windowId === -1 || packet.windowId === 255) && packet.slot === -1) {
      if (packet.stateId >= 0 && packet.stateId < active.stateId) return;
      active.cursor = cloneItem(packet.item); changed(packet.stateId); syncCursor(active.cursor); return;
    }
    if (packet.windowId !== active.id || packet.stateId < active.stateId || packet.slot < 0 || packet.slot >= active.slots.length) return;
    active.slots[packet.slot] = cloneItem(packet.item); changed(packet.stateId);
    if (packet.slot >= active.start && packet.slot < active.end) syncPlayer(packet.slot, active.slots[packet.slot]);
  });
  const close = () => { active = null; epoch++; revision++; };
  on(bot._client, 'close_window', close);
  on(bot, 'windowClose', window => { if (active?.window === window) close(); });
  on(bot._client, 'respawn', close);
  on(bot._client, 'login', close);
  on(bot, 'end', () => { ended = true; close(); });
  const enqueue = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
  const healthy = () => { if (ended || disposed) throw new Error('connection_ended'); };
  const current = expectedEpoch => {
    healthy();
    if (!active?.slots || bot.currentWindow !== active.window || (expectedEpoch !== undefined && active.epoch !== expectedEpoch)) throw new Error('window_changed_or_not_synchronized');
    // Support ordinary storage containers only; never click menus/trade/craft.
    if (!/^minecraft:generic_9x[1-6]$/.test(active.window.type) || active.end - active.start !== 36) throw new Error('not_a_storage_container');
    return active;
  };
  async function waitFor(test, expectedEpoch, ms = timeoutMs) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      healthy();
      if (expectedEpoch !== undefined && (!active || active.epoch !== expectedEpoch)) throw new Error('window_changed');
      const result = test();
      if (result && Date.now() - active.at >= quietMs) return result;
      await sleep(Math.min(15, Math.max(1, deadline - Date.now())));
    }
    throw new Error('server_slot_confirmation_timeout');
  }
  function receipt(data) {
    const result = { schemaVersion: 1, ...data, at: Date.now() };
    if (result.operationId) {
      receipts.set(result.operationId, result);
      while (receipts.size > 128) receipts.delete(receipts.keys().next().value);
    }
    // Logging must not change the transaction's outcome or cause a retry.
    try { onReceipt(structuredClone(result)); } catch { }
    return structuredClone(result);
  }
  async function refresh() {
    const w = current();
    // The existing read/sync command has a two-second server cooldown.
    const delay = 2100 - (Date.now() - lastRefresh);
    if (delay > 0) await sleep(delay);
    current(w.epoch); const after = revision; lastRefresh = Date.now();
    await requestRefresh();
    await waitFor(() => active.full > after && snap(), w.epoch);
    return snap();
  }
  async function click(slot, button, expectedEpoch) {
    const w = current(expectedEpoch), before = snap(), item = before.slots[slot], cursor = before.cursor;
    const expected = structuredClone(before);
    if (!cursor) { // pickup; never click an empty source
      if (!item) throw new Error('empty_source');
      const count = button === 1 ? Math.ceil(item.count / 2) : item.count;
      expected.cursor = itemAt(item, count); expected.slots[slot] = itemAt(item, item.count - count);
    } else {
      if (item && item.key !== cursor.key) throw new Error('different_item_in_destination');
      const count = Math.min(button === 1 ? 1 : cursor.count, cursor.stackSize - (item?.count ?? 0));
      if (count <= 0) throw new Error('destination_full');
      expected.cursor = itemAt(cursor, cursor.count - count); expected.slots[slot] = itemAt(cursor, (item?.count ?? 0) + count);
    }
    // Send exactly once. Empty predictions let the vanilla server send the real
    // changed slots; the carried item describes the pre-click client state.
    bot._client.write('window_click', { windowId: w.id, stateId: w.stateId, slot, mouseButton: button, mode: 0,
      changedSlots: [], cursorItem: cursor ? structuredClone(cursor.wire) : Item.toNotch(null) });
    await waitFor(() => active.rev > before.revision && same(snap(), expected) && snap(), expectedEpoch);
  }
  const api = {
    query: () => enqueue(async () => {
      try { return receipt({ status: 'observed', snapshot: await refresh(), blocked: !!blocked }); }
      catch (e) { return receipt({ status: 'unavailable', reason: e.message, blocked: !!blocked }); }
    }),
    open: ({ command = '/minepacks:backpack open', verifyWindow = w => /^minecraft:generic_9x6$/.test(w.type) } = {}) => enqueue(async () => {
      try {
        healthy(); if (active || bot.currentWindow) throw new Error('close_current_window_first');
        const prior = epoch; bot.chat(command);
        await waitFor(() => active?.epoch > prior && active.slots && snap());
        current(); if (!verifyWindow(active.window)) throw new Error('unexpected_storage_window');
        active.personal = command === '/minepacks:backpack open';
        return receipt({ status: 'opened', snapshot: snap(), blocked: !!blocked });
      } catch (e) { return receipt({ status: 'unavailable', reason: e.message, blocked: !!blocked }); }
    }),
    transfer: ({ operationId = randomUUID(), direction, slot, count } = {}) => enqueue(async () => {
      if (receipts.has(operationId)) return structuredClone(receipts.get(operationId));
      if (blocked) return receipt({ operationId, status: 'blocked', reason: 'previous_result_unknown', pendingOperationId: blocked.id });
      let before, expected, dispatched = false;
      try {
        const w = current(); before = snap();
        if (before.cursor) throw new Error('cursor_not_empty');
        if (!['deposit', 'withdraw'].includes(direction) || !Number.isInteger(slot) || slot < 0 || slot >= w.end
          || (direction === 'deposit' ? slot < w.start : slot >= w.start)) throw new Error('invalid_source_or_direction');
        const source = before.slots[slot]; if (!source) throw new Error('empty_source');
        count ??= source.count;
        if (!Number.isInteger(count) || count < 1 || count > source.count || count > 64) throw new Error('invalid_count');
        const range = direction === 'deposit' ? [0, w.start] : [w.start, w.end];
        let destination = -1;
        for (let i = range[0]; i < range[1]; i++) {
          const item = before.slots[i];
          if (!item || item.key === source.key && item.stackSize - item.count >= count) { destination = i; break; }
        }
        if (destination < 0) throw new Error('destination_full');
        expected = structuredClone(before);
        expected.slots[slot] = itemAt(source, source.count - count);
        expected.slots[destination] = itemAt(source, (before.slots[destination]?.count ?? 0) + count);
        // Persist the intent BEFORE the first write, so a new connection cannot
        // silently replay an action whose acknowledgement was lost.
        const pending = { id: operationId, before, expected };
        checkpoint(pending);
        blocked = pending;
        dispatched = true;
        await click(slot, 0, w.epoch);
        if (count === source.count) await click(destination, 0, w.epoch);
        else {
          for (let i = 0; i < count; i++) await click(destination, 1, w.epoch);
          await click(slot, 0, w.epoch);
        }
        if (!same(snap(), expected) || snap().cursor) throw new Error('final_state_mismatch');
        const result = { operationId, status: 'confirmed', direction, count, sourceSlot: slot, destinationSlot: destination, before, after: snap() };
        checkpoint(null, result); blocked = null;
        return receipt(result);
      } catch (e) {
        if (dispatched) blocked = { id: operationId, before, expected };
        return receipt({ operationId, status: dispatched ? 'unknown' : 'not_executed', reason: e.message, before, observed: snap(), retrySafe: !dispatched });
      }
    }),
    reconcile: ({ allowPersonalReopen = false } = {}) => enqueue(async () => {
      if (!blocked) return receipt({ status: 'nothing_pending', snapshot: snap() });
      try {
        const after = await refresh(), pending = blocked;
        const changedWindow = after.connectionId !== pending.before.connectionId || after.epoch !== pending.before.epoch;
        // Reconnect can return carried items to different player slots. A caller
        // may explicitly re-open ONLY the same UUID's personal Minepacks. Compare
        // every component fingerprint separately in bag/player/cursor regions.
        // Matching a title or reusing a numeric window id never proves identity.
        if (changedWindow && !(allowPersonalReopen && active.personal && ownerUuid && pending.before.ownerUuid === ownerUuid))
          return receipt({ operationId: pending.id, status: 'unknown', reason: 'window_epoch_changed_inspect_before_resuming', observed: after });
        const contents = s => {
          const sum = items => { const counts = {}; for (const i of items) if (i) counts[i.key] = (counts[i.key] ?? 0) + i.count; return counts; };
          return stable([sum(s.slots.slice(0, s.inventoryStart)), sum(s.slots.slice(s.inventoryStart, s.inventoryEnd)), s.cursor]);
        };
        const matches = s => changedWindow ? contents(after) === contents(s) : same(after, s);
        if (!matches(pending.expected) && !matches(pending.before)) return receipt({ operationId: pending.id, status: 'unknown', reason: 'partial_or_conflicting_state', observed: after });
        const result = { operationId: pending.id, status: matches(pending.expected) ? 'confirmed' : 'not_applied', before: pending.before, after, reconciled: true };
        checkpoint(null, result); blocked = null;
        return receipt(result);
      } catch (e) { return receipt({ operationId: blocked.id, status: 'unknown', reason: e.message, observed: snap() }); }
    }),
    close: () => enqueue(async () => {
      if (blocked) return receipt({ status: 'blocked', reason: 'inspect_unknown_result_before_closing' });
      try {
        const w = current(); if (active.cursor) throw new Error('cursor_not_empty');
        bot.closeWindow(w.window); close();
        return receipt({ status: 'close_requested', confirmation: 'client_close_sent; persisted_contents_require_reopen' });
      } catch (e) { return receipt({ status: 'not_executed', reason: e.message }); }
    }),
    snapshot: () => ({ status: active?.slots ? 'observed' : 'unavailable', snapshot: snap(), blocked: !!blocked }),
    dispose: () => { disposed = true; close(); hooks.forEach(remove => remove()); delete bot[installed]; }
  };
  bot[installed] = api;
  return api;
}
