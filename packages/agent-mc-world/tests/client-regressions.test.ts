import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinecraftChatProvenance } from '../src/chat-provenance.ts';
import { observeInitialScene } from '../core/initial-scene.ts';
import { methodHarness } from './method-harness.ts';
import { observeVisual } from '../src/client/visual.ts';
import { emitLogNote, logChildStdio } from '../core/support/runtime.mjs';
import { installChildSignalOwnership } from '../core/support/child-signals.ts';
import { prepareTemporaryScaffoldPlacement, armTemporaryScaffoldPlacement, recordTemporaryScaffold,
  promoteTemporaryScaffold } from '../core/temporary-scaffold.ts';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const players = { ag_CorMy: { username: 'ag_CorMy', uuid: 'uuid-cormy' }, Jojo: { username: 'Jojo', uuid: 'uuid-jojo' } };

describe('whisper identity from raw messages', () => {
  it.each(['◆黑铁 [Agent] ', '[Agent] ', ''])('recognizes optional prefix %j and keeps the full body', prefix => {
    const provenance = new MinecraftChatProvenance();
    const msg = { toString: () => `${prefix}ag_CorMy whispers to you: jojo也来啦～` };
    provenance.observe(msg, 'system');
    expect(provenance.incomingWhisper(msg, players)).toMatchObject({ username: 'ag_CorMy', message: 'jojo也来啦～' });
  });
  it.each([
    ['<Jojo> ag_CorMy whispers to you: quoted', 'system', undefined, null],
    ['Jojo: ag_CorMy whispers to you: quoted', 'system', undefined, null],
    ['ag_CorMy whispers to you: quoted', 'chat', undefined, 'uuid-cormy'],
    ['ag_CorMy whispers to you: quoted', 'system', 'chat.type.text', null],
    ['ag_CorMy whispers to you: wrong UUID', 'chat', 'commands.message.display.incoming', 'uuid-jojo'],
    ['Unknown whispers to you: not on player list', 'system', undefined, null],
    ['You whisper to ag_CorMy: hello', 'system', 'commands.message.display.outgoing', null],
  ])('rejects public, unknown or mismatched identity: %s', (text, position, translate, uuid) => {
    const provenance = new MinecraftChatProvenance(), msg = { translate, toString: () => text! };
    provenance.observe(msg, position!, uuid);
    expect(provenance.incomingWhisper(msg, players)).toBeNull();
  });
  it('delivers once before the default tag regex and replies through /msg', async () => {
    const r = methodHarness();
    try {
      Object.assign(r.bot, { players });
      (r.world as any).hookMessageEvents(r.bot);
      const msg = { translate: 'commands.message.display.incoming', toString: () => '◆黑铁 [Agent] ag_CorMy whispers to you: hello' };
      r.bot.emit('message', msg, 'chat', 'uuid-cormy');
      r.bot.emit('whisper', 'Agent', 'hello', msg.translate, msg);
      await Promise.resolve();
      expect(r.host.events.filter(e => e.text.includes('hello'))).toHaveLength(1);
      expect(r.host.events.at(-1)).toMatchObject({ text: '[MC 私聊] ag_CorMy: hello', meta: { uname: 'ag_CorMy' } });
      await r.world.tools().find(t => t.name === 'mc_do')!.handler({ steps: [{ skill: 'chat', text: '/msg ag_CorMy 收到' }] }, { role: 'test', log: r.host.log });
      expect(r.said).toEqual(['/msg ag_CorMy 收到']);
    } finally { r.close(); }
  });
  it('does not accept a default whisper event for a public quoted message', async () => {
    const r = methodHarness();
    try {
      Object.assign(r.bot, { players });
      (r.world as any).hookMessageEvents(r.bot);
      const msg = { translate: 'chat.type.text', toString: () => '<Jojo> ag_CorMy whispers to you: quoted' };
      r.bot.emit('message', msg, 'chat', 'uuid-jojo');
      r.bot.emit('whisper', 'ag_CorMy', 'quoted', msg.translate, msg);
      await Promise.resolve();
      expect(r.host.events.some(e => e.text.startsWith('[MC 私聊]'))).toBe(false);
    } finally { r.close(); }
  });
});

describe('live readouts and honest startup', () => {
  it('reads actual current account identity and death lifecycle rather than an old configured name', () => {
    const r = methodHarness();
    try {
      Object.assign((r.world as any).bridge, { connected: true });
      Object.assign(r.bot, { username: 'ActualPlayer', player: { uuid: 'actual-current-uuid' },
        deathLifecycle: { episodeId: 'death-actual', phase: 'respawn_pending', observedAt: '2026-10-15T01:00:00Z', respawnAt: '2026-10-15T01:00:04Z' } });
      const parts = r.world.requestFacts()!.parts!;
      expect(JSON.parse(parts.find(p => p.key === 'identity')!.text)).toMatchObject({ account: 'offline:actual-current-uuid' });
      expect(JSON.parse(parts.find(p => p.key === 'deathLifecycle')!.text)).toMatchObject({ episodeId: 'death-actual', phase: 'respawn_pending' });
      Object.assign(r.bot, { player: { uuid: 'new-current-uuid' } });
      expect(r.world.requestFacts()!.parts!.find(p => p.key === 'identity')!.text).toContain('new-current-uuid');
    } finally { r.close(); }
  });
  it('reports a stopped login honestly and rejects replacement work without changing the queue', async () => {
    const r = methodHarness();
    try {
      Object.assign((r.world as any).bridge, { bot: null, connected: false, reconnects: 1,
        connectionState: { active: true, phase: 'stopped', protocolState: 'closed', ready: false,
          serverLogin: { stage: 'closed', reason: 'confirmation-timeout' } } });
      const before = r.exec.status();
      const bag = await r.world.tools().find(t => t.name === 'mc_bag')!.handler({}, { role: 'test', log: r.host.log });
      expect(typeof bag === 'string' ? bag : bag.text).toContain('自动重连已停止');
      expect(typeof bag === 'string' ? bag : bag.text).toContain('不等于密码错误');
      expect(r.world.console().lamps?.find(l => l.label === '服务器')).toMatchObject({ state: 'error', hint: expect.stringContaining('确认超时') });
      for (let n = 0; n < 2; n++) {
        const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler(
          { queue: 'replace', steps: [{ skill: 'goto', at: [12, 64, 0] }] }, { role: 'test', log: r.host.log });
        expect(result).toMatchObject({ failed: true, text: expect.stringContaining('未受理') });
      }
      expect(r.exec.status()).toEqual(before);
      expect(r.host.events.some(e => /受理任务|开始任务/.test(e.text))).toBe(false);
      expect(r.bot.entity.position.x).toBe(0.5);
    } finally { r.close(); }
  });
  it('keeps an actual retry distinct from a stopped login in inventory feedback', async () => {
    const r = methodHarness();
    try {
      Object.assign((r.world as any).bridge, { bot: null, connected: false, reconnects: 1,
        connectionState: { active: true, phase: 'retrying', protocolState: 'closed', ready: false } });
      const result = await r.world.tools().find(t => t.name === 'mc_bag')!.handler({}, { role: 'test', log: r.host.log });
      expect(typeof result === 'string' ? result : result.text).toContain('正在按现有机制自动重连');
      expect(r.world.console().lamps?.find(l => l.label === '服务器')).toMatchObject({ state: 'loading' });
    } finally { r.close(); }
  });
  it('reports revoked authorization without claiming a disconnect or admitting replacement work', async () => {
    const r = methodHarness();
    try {
      Object.assign((r.world as any).bridge, {bot:null,connected:false,reconnects:0,
        connectionState:{active:true,phase:'connecting',protocolState:'play',ready:false,
          serverLogin:{stage:'required',reason:'authorization-revoked'}}});
      const before = r.exec.status();
      const bag = await r.world.tools().find(t => t.name === 'mc_bag')!.handler({}, {role:'test',log:r.host.log});
      const text = typeof bag === 'string' ? bag : bag.text;
      expect(text).toContain('网络连接仍保留');
      expect(text).toContain('操作授权未就绪');
      expect(text).not.toContain('自动重连');
      const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler(
        {queue:'replace',steps:[{skill:'goto',at:[12,64,0]}]}, {role:'test',log:r.host.log});
      expect(result).toMatchObject({failed:true,text:expect.stringContaining('操作授权未就绪')});
      expect(r.exec.status()).toEqual(before);
      expect(r.world.console().lamps?.find(l => l.label === '服务器')).toMatchObject({state:'error',hint:expect.stringContaining('操作授权未就绪')});
    } finally {r.close();}
  });
  it('delivers freshly checked scaffold obligations to tool facts and scripts, then replaces cleared facts', () => {
    const r = methodHarness();
    try {
      Object.assign((r.world as any).bridge, { connected: true });
      const pos = new Vec3(2,64,0), bot = r.bot as any;
      Object.assign(bot,{canDigBlock: (block: any) => bot.entity.position.distanceTo(block.position) < 5, canSeeBlock: () => true});
      const proof = prepareTemporaryScaffoldPlacement(bot, r.bot.blockAt(pos));
      armTemporaryScaffoldPlacement(bot, pos);
      r.set(2,64,0,'dirt'); recordTemporaryScaffold(bot, proof, r.bot.blockAt(pos));
      const fact = () => r.world.requestFacts()!.parts!.find(p => p.key === 'temporaryScaffolds')!.text;
      expect(fact()).toContain('(2,64,0)');
      expect(fact()).toContain('cleanup');
      expect((r.world as any).methodState().temporaryScaffolds).toBe(fact());
      const far = fact(); r.bot.entity.position.x = 50;
      expect(fact()).not.toBe(far);
      promoteTemporaryScaffold(bot,[pos]);
      expect(fact()).toContain('没有待清理记录');
      expect(fact()).toContain('不代表历史工地已清理');
    } finally { r.close(); }
  });
  it('reads fresh body, inventory and queue without a deferred snapshot or an image', async () => {
    const r = methodHarness();
    try {
      Object.assign((r.world as any).bridge, { connected: true });
      const facts = r.world.requestFacts();
      expect(facts).not.toBeNull();
      const first = facts!.text;
      r.bot.health = 8; r.bot.entity.position.x = 12;
      const current = r.world.requestFacts();
      expect(current!.text).not.toBe(first);
      expect(current!.parts?.map(p => p.key)).toEqual(expect.arrayContaining(['body', 'place', 'queue']));
      const result = await observeVisual(r.world.tools().find(t => t.name === 'mc_visual')!, {},
        { role: 'test', log: r.host.log }, r.host, () => r.world.requestFacts(), false);
      expect(typeof result === 'string' ? result : result.text).not.toContain('现场读数尚不可用');
      expect(current!.text).not.toContain('地形：；');
      expect(current!.text).not.toContain('服务器上只有我');
      Object.assign((r.world as any).bridge, { connected: false });
      expect(r.world.requestFacts()).toBeNull();
    } finally { r.close(); }
  });
  it('keeps the native food-reserve fact in direct SDK reads without draining host events', () => {
    const r = methodHarness();
    try {
      Object.assign((r.world as any).bridge, { connected: true });
      Object.assign(r.bot.inventory, { items: () => [{ name: 'cocoa_beans', count: 3 }, { name: 'mutton', count: 4 }] });
      const food = () => r.world.requestFacts()!.parts!.find(part => part.key === 'foodReserve')!.text;
      expect(food()).toContain('常规 4 个');
      expect(food()).toContain('mutton');
      expect(food().slice(0, 160)).toContain('不可直接吃 cocoa_beans');
      r.bot.food = 20;
      expect(food()).toContain('常规 4 个'); // Hunger is not a food-stock observation.
      Object.assign(r.bot.inventory, { items: () => [{ name: 'cocoa_beans', count: 3 }] });
      expect(food()).toContain('常规 0 个');
      Object.assign(r.bot.inventory, { items: () => [{ name: 'egg', count: 2 }, { name: 'sugar', count: 3 },
        { name: 'custom:food', count: 1 }] });
      expect(food().slice(0, 160)).toContain('不可直接吃 sugar、egg');
      expect(food().slice(0, 160)).toContain('未知 custom:food');
      Object.assign((r.world as any).bridge, { invSynced: false });
      expect(food()).toContain('数量未知');
    } finally { r.close(); }
  });
  it('rejects chat accurately while connected but waiting for authentication', async () => {
    const r = methodHarness();
    try {
      Object.assign((r.world as any).bridge, { bot: null, connectionState: { protocolState: 'play', ready: false } });
      const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler(
        { steps: [{ skill: 'chat', text: 'hello' }] }, { role: 'test', log: r.host.log });
      expect(result).toMatchObject({ failed: true, text: expect.stringContaining('正在等待服务器登录') });
      expect(r.said).toEqual([]);
    } finally { r.close(); }
  });
  it('documents mandatory probe shape and script name in the tool descriptions', () => {
    const r = methodHarness();
    try {
      expect(r.world.tools().find(t => t.name === 'mc_scout')!.description).toMatch(/shape is required/);
      expect(r.world.tools().find(t => t.name === 'mc_script')!.description).toMatch(/name is required/);
    } finally { r.close(); }
  });
  it('waits for the footprint chunks and a quiet player list, then refreshes exactly once', async () => {
    vi.useFakeTimers();
    let chunks = false;
    const bot = Object.assign(new EventEmitter(), { username: 'Self', players: {} as Record<string, unknown>,
      entity: { position: new Vec3(0, 64, 0) }, blockAt: () => chunks ? {} : null });
    const ready = vi.fn(), stop = observeInitialScene(bot, () => true, ready);
    await vi.advanceTimersByTimeAsync(2000); expect(ready).not.toHaveBeenCalled();
    chunks = true; bot.players.Self = {}; bot.players.Friend = {}; bot.emit('playerJoined');
    await vi.advanceTimersByTimeAsync(400); expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200); expect(ready).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000); expect(ready).toHaveBeenCalledOnce();
    expect(bot.listenerCount('playerJoined')).toBe(0); stop();
  });
  it.each(['end', 'respawn', 'death'])('discards the pending welcome on %s', async event => {
    vi.useFakeTimers();
    const bot = Object.assign(new EventEmitter(), { username: 'Self', players: { Self: {} },
      entity: { position: new Vec3(0, 64, 0) }, blockAt: () => ({}) });
    const ready = vi.fn(); observeInitialScene(bot, () => true, ready); bot.emit(event);
    await vi.advanceTimersByTimeAsync(2000); expect(ready).not.toHaveBeenCalled();
  });
});

it('accepts custom logging without emit or child, preserving available log methods', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  emitLogNote(log as never, { kind: 'log', level: 'info', area: 'engine', msg: 'ready', atMs: Date.now(), pid: 42 }, 'UTC');
  expect(log.info).toHaveBeenCalledWith('ready', expect.objectContaining({ pid: 42 }));
  const stderr = new EventEmitter(); logChildStdio({ stderr } as never, log as never);
  stderr.emit('data', Buffer.from('test line\n')); expect(log.warn).toHaveBeenCalled();
  expect(() => emitLogNote({} as never, { kind: 'log', level: 'debug', area: '', msg: 'skip', atMs: Date.now(), pid: 42 }, 'UTC')).not.toThrow();
});

it('leaves child SIGINT and SIGTERM owned by the parent until explicit shutdown', () => {
  const child = new EventEmitter(), stop = installChildSignalOwnership(child);
  expect(child.emit('SIGINT')).toBe(true); expect(child.emit('SIGTERM')).toBe(true);
  stop(); expect(child.listenerCount('SIGINT')).toBe(0); expect(child.listenerCount('SIGTERM')).toBe(0);
});
