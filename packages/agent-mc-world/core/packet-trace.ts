import { appendFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { EventEmitter } from 'node:events';
import { minecraftTextComponent } from './nbt-text.mjs';

/**
 * Opt-in protocol trace for diagnosis (AGENT_MC_PACKET_TRACE=<file>). Writes JSONL with packet
 * names and small summaries only. Never logs chat text, command arguments, dialog payloads of
 * login screens, custom payload bytes or click-action payloads.
 */
type Client = EventEmitter & { state?: string; write: (name: string, params: any) => any };

const AUTH_RE = /authme|login|register|密码|登录|注册|password/i;
const QUIET_OUT = new Set(['position', 'position_look', 'look', 'flying', 'keep_alive', 'pong', 'tick_end', 'chunk_batch_received', 'arm_animation']);
const QUIET_IN = new Set(['ping', 'keep_alive', 'rel_entity_move', 'entity_move_look', 'entity_look', 'entity_head_rotation',
  'entity_velocity', 'player_info', 'update_time', 'sound_effect', 'entity_sound_effect', 'world_particles', 'entity_metadata',
  'entity_update_attributes', 'sync_entity_position', 'entity_teleport', 'bundle_delimiter', 'teams', 'map_chunk', 'update_light',
  'entity_destroy', 'spawn_entity', 'entity_equipment', 'animation', 'entity_status', 'scoreboard_score', 'playerlist_header',
  'player_chat', 'profileless_chat', 'tab_complete', 'declare_commands', 'declare_recipes', 'tags', 'chunk_biomes', 'unload_chunk']);

const pos = (p: any) => p && typeof p === 'object' ? [p.x, p.y, p.z] : p;
const short = (v: unknown, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };

export function textOf(v: any): string {
  try { return minecraftTextComponent(v); } catch { return ''; }
}

export function summarizeIncoming(name: string, d: any): Record<string, unknown> | null {
  switch (name) {
    case 'block_change': return { at: pos(d.location), state: d.type };
    case 'multi_block_change': return { section: d.chunkCoordinates, n: d.records?.length,
      first: (d.records ?? []).slice(0, 4).map((r: number) => ({ rel: [(r >> 8) & 15, r & 15, (r >> 4) & 15], state: r >> 12 })) };
    case 'acknowledge_player_digging': return { seq: d.sequenceId };
    case 'position': return { xyz: [d.x, d.y, d.z], v: [d.dx, d.dy, d.dz].map((n: number) => typeof n === 'number' ? Math.round(n * 1e4) / 1e4 : n), flags: d.flags?._value ?? d.flags, id: d.teleportId };
    case 'open_window': return { id: d.windowId, type: d.inventoryType, title: short(textOf(d.windowTitle), 60) };
    case 'window_items': return { id: d.windowId, n: d.items?.length, state: d.stateId };
    case 'close_window': return { id: d.windowId };
    case 'set_slot': return { id: d.windowId, slot: d.slot };
    case 'open_book': return { hand: d.hand };
    case 'show_dialog': {
      const raw = JSON.stringify(d).slice(0, 4000);
      if (AUTH_RE.test(raw)) return { redacted: 'auth-dialog' };
      return { dialog: short(raw, 600) };
    }
    case 'clear_dialog': return {};
    case 'game_state_change': return { reason: d.reason, value: d.gameMode };
    case 'respawn': return { world: d.worldState?.name, copy: d.copyMetadata };
    case 'update_health': return { hp: d.health, food: d.food };
    case 'death_combat_event': return { player: d.playerId };
    case 'system_chat': return { overlay: d.isActionBar ?? d.overlay ?? null, len: textOf(d.content).length,
      head: short(textOf(d.content).replace(/\s+/g, ' '), 40) };
    case 'custom_payload': return { channel: d.channel, len: d.data?.length };
    case 'set_title_text': case 'action_bar': return { text: short(textOf(d.text), 60) };
    case 'boss_bar': return { action: d.action };
    case 'abilities': return { flags: d.flags };
    case 'held_item_slot': return { slot: d.slot };
    case 'face_player': return {};
    case 'camera': return { id: d.cameraId };
    case 'kick_disconnect': return { reason: short(textOf(d.reason), 120) };
    default: return {};
  }
}

export function summarizeOutgoing(name: string, d: any): Record<string, unknown> {
  switch (name) {
    case 'block_dig': return { status: d.status, at: pos(d.location), face: d.face, seq: d.sequence };
    case 'position': case 'position_look': case 'look': case 'flying': {
      const r = (n: unknown) => typeof n === 'number' ? Math.round(n * 1000) / 1000 : undefined;
      return { xyz: d.x === undefined ? undefined : [r(d.x), r(d.y), r(d.z)], yaw: r(d.yaw), pitch: r(d.pitch), g: d.flags?.onGround ?? d.onGround, hc: d.flags?.hasHorizontalCollision };
    }
    case 'player_input': return { inputs: Object.entries(d.inputs ?? {}).filter(([k, v]) => v === true && k !== '_value').map(([k]) => k) };
    case 'entity_action': return { action: d.actionId };
    case 'block_place': return { at: pos(d.location), seq: d.sequence };
    case 'use_item': return { hand: d.hand, seq: d.sequence };
    case 'chat_command': case 'chat_command_signed': {
      const cmd = String(d.command ?? '').split(/\s+/)[0];
      return { cmd: AUTH_RE.test(cmd) || /^(l|reg|log)$/i.test(cmd) ? '[auth]' : cmd };
    }
    case 'chat_message': return { len: String(d.message ?? '').length };
    case 'window_click': return { id: d.windowId, slot: d.slot, button: d.mouseButton, mode: d.mode };
    case 'close_window': return { id: d.windowId };
    case 'client_command': return d;
    case 'teleport_confirm': return { id: d.teleportId };
    case 'custom_click_action': return { id: d.id };
    case 'custom_payload': return { channel: d.channel };
    case 'held_item_slot': return { slot: d.slotId };
    default: return {};
  }
}

let diagnosticsInstalled = false;
/**
 * Trace-mode only: record uncaught exception stacks and, when the event loop stalls for more than
 * 5 s, the JS frames of the busy code (function names and file:line only) next to the trace.
 */
function installStallDiagnostics(file: string): void {
  if (diagnosticsInstalled) return;
  diagnosticsInstalled = true;
  const note = (o: Record<string, unknown>) => { try { appendFileSync(file + '.diag.jsonl', JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n', { mode: 0o600 }); } catch { /* best effort */ } };
  process.on('uncaughtException', (err) => note({ kind: 'uncaught', stack: String((err as Error)?.stack ?? err).slice(0, 4000) }));
  try {
    const beat = new Int32Array(new SharedArrayBuffer(4));
    const pulse = setInterval(() => Atomics.add(beat, 0, 1), 250); pulse.unref();
    // The worker attaches to this thread's inspector and pauses it once when it stops beating,
    // so the stall note carries the JS frames that keep the event loop busy.
    const worker = new Worker(`const { workerData } = require('node:worker_threads'); const fs = require('node:fs'); const inspector = require('node:inspector');
      const b = workerData.beat; let last = -1, since = Date.now(), fired = 0;
      const note = (o) => { try { fs.appendFileSync(workerData.file, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\\n', { mode: 0o600 }); } catch {} };
      const s = new inspector.Session(); s.connectToMainThread();
      s.on('Debugger.paused', (m) => { const frames = (m.params.callFrames || []).slice(0, 25).map((f) => (f.functionName || '(anon)') + ' ' + String(f.url).split('/node_modules/').pop() + ':' + (f.location.lineNumber + 1));
        note({ kind: 'stall-stack', stalledMs: Date.now() - since, frames }); s.post('Debugger.resume'); });
      s.post('Debugger.enable', () => {});
      setInterval(() => { const v = Atomics.load(b, 0); if (v !== last) { if (fired) note({ kind: 'stall-end', stalledMs: Date.now() - since }); last = v; since = Date.now(); fired = 0; return; }
        const ms = Date.now() - since; if ((fired === 0 && ms > 5000) || (fired === 1 && ms > 30000)) { fired++; s.post('Debugger.pause'); } }, 500);`,
      { eval: true, workerData: { beat, file: file + '.diag.jsonl' } });
    worker.unref();
    note({ kind: 'diag-start', pid: process.pid });
  } catch (err) { note({ kind: 'diag-failed', err: String(err) }); }
}

export function installPacketTrace(client: Client, file: string | undefined = process.env.AGENT_MC_PACKET_TRACE): () => void {
  if (!file) return () => {};
  installStallDiagnostics(file);
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  let lastFlush = Date.now();
  const line = (o: Record<string, unknown>) => { try { appendFileSync(file, JSON.stringify(o) + '\n', { mode: 0o600 }); } catch { /* best effort */ } };
  const tick = () => {
    if (Date.now() - lastFlush < 10_000) return;
    lastFlush = Date.now();
    line({ t: new Date().toISOString(), dir: 'counts', counts: { ...counts } });
    for (const k of Object.keys(counts)) delete counts[k];
  };
  let sampleUntil = 0, sampled = 0;
  // Ring of the last ~2 s of our own movement (out) and self velocity (in), written out with every
  // server position correction so a setback can be compared tick by tick with what we sent.
  const ring: Array<Record<string, unknown>> = [];
  let selfId: number | undefined;
  const remember = (o: Record<string, unknown>) => { ring.push(o); if (ring.length > 45) ring.shift(); };
  const onPacket = (data: any, meta: { name: string; state?: string }) => {
    const name = meta?.name; if (!name) return;
    counts['in:' + name] = (counts['in:' + name] ?? 0) + 1;
    const first = !seen.has('in:' + name); seen.add('in:' + name);
    if (name === 'login' && typeof data?.entityId === 'number') selfId = data.entityId;
    if (name === 'entity_velocity' && data?.entityId === selfId) remember({ t: new Date().toISOString(), dir: 'in', name, v: data.velocity ?? [data.velocityX, data.velocityY, data.velocityZ] });
    if (name === 'explosion') remember({ t: new Date().toISOString(), dir: 'in', name, kb: data.playerKnockback ?? data.playerMotion ?? null });
    if (name === 'position') { if (ring.length) line({ t: new Date().toISOString(), dir: 'pre', ring: ring.splice(0) }); sampleUntil = Date.now() + 600; sampled = 0; }
    if (QUIET_IN.has(name) && !first) { tick(); return; }
    let s: Record<string, unknown> | null = null;
    try { s = summarizeIncoming(name, data); } catch { s = { err: 'summary' }; }
    line({ t: new Date().toISOString(), dir: 'in', name, ...(first ? { first: true } : {}), ...(s ?? {}) });
    tick();
  };
  const origWrite = client.write;
  const write = function (this: unknown, name: string, params: any) {
    counts['out:' + name] = (counts['out:' + name] ?? 0) + 1;
    const first = !seen.has('out:' + name); seen.add('out:' + name);
    const isMove = name === 'position' || name === 'position_look' || name === 'flying' || name === 'look' || name === 'player_input' || name === 'entity_action';
    if (isMove) { try { remember({ t: new Date().toISOString(), name, ...summarizeOutgoing(name, params ?? {}) }); } catch { /* best effort */ } }
    const sampleMove = isMove && Date.now() < sampleUntil && sampled++ < 12;
    if (!QUIET_OUT.has(name) || first || sampleMove) {
      let s: Record<string, unknown> = {};
      try { s = summarizeOutgoing(name, params ?? {}); } catch { s = { err: 'summary' }; }
      line({ t: new Date().toISOString(), dir: 'out', name, ...(first ? { first: true } : {}), ...s });
    }
    return origWrite.call(client, name, params);
  } as Client['write'];
  const onError = (e: Error & { field?: string }) => line({ t: new Date().toISOString(), dir: 'error',
    field: e?.field ?? null, msg: String(e?.message ?? e).slice(0, 400) });
  client.write = write;
  client.on('packet', onPacket);
  client.on('error', onError);
  line({ t: new Date().toISOString(), dir: 'meta', event: 'trace-start' });
  return () => {
    client.off('packet', onPacket);
    client.off('error', onError);
    if (client.write === write) client.write = origWrite;
  };
}
