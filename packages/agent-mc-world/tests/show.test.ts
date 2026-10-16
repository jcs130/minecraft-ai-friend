import { afterEach, expect, it, vi } from 'vitest';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { EventEmitter } from 'node:events';
import { ShowPacer, bindNativeGuiPresentation, nativeGuiPresented, markShowWindowClosed } from '../core/show.ts';
import { MinecraftWorld } from '../core/world.ts';

const tempo = { ...MINECRAFT_DEFAULTS.show };
function rig() {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  const bot = Object.assign(new EventEmitter(), { entity: { id: 1 }, inventory: {}, currentWindow: null,
    game: { dimension: 'overworld' } }) as any;
  const controller = new AbortController(), notes: any[] = [];
  const ctx = { aborted: () => controller.signal.aborted, signal: controller.signal,
    diag: { write: (note: unknown) => notes.push(note) } } as any;
  return { bot, ctx, controller, notes, show: new ShowPacer(tempo, { bot, ctx }) };
}

afterEach(() => vi.useRealTimers());
it('uses readable ordinary GUI defaults', () => {
  expect(MINECRAFT_DEFAULTS.show).toEqual({ clickMs: 400, dwellOpenMs: 800,
    dwellResultMs: 1200, dwellCloseMs: 600, reopenGapMs: 900, budgetMs: 12000 });
});

it('admits current opted-in native presentation and Java compatibility, never URLs', () => {
  const r = rig(), cfg = structuredClone(MINECRAFT_DEFAULTS);
  const world = { cfg, bridge: { bot: r.bot, viewerUrl: 'http://stale.invalid', viewerKind: 'modern' }, client: { windowHint: () => null } };
  const read = () => (MinecraftWorld.prototype as any).showTempo.call(world);
  expect(read()).toBeNull();
  let ready = true;
  const revoke = bindNativeGuiPresentation(r.bot, () => ({ ready, epoch: 2, playerUuid: 'same-player' }));
  expect(read()).toEqual({ ...tempo, inventory: true });
  cfg.show.clickMs = 57;
  expect(read().clickMs).toBe(57);
  cfg.client.syncGui = false; expect(read()).toBeNull();
  cfg.client.syncGui = true; ready = false; expect(read()).toBeNull();
  world.client.windowHint = () => ({ pid: 1 }) as never;
  expect(read()).toEqual({ ...cfg.show, inventory: false });
  ready = true; r.bot.emit('end'); expect(nativeGuiPresented(r.bot)).toBe(false);
  revoke();
});

it.each(['open', 'click', 'result', 'close', 'gap'] as const)('wakes %s synchronously on task abort and removes its timer', async kind => {
  const r = rig(); markShowWindowClosed(r.bot);
  const operation = kind === 'gap' ? r.show.openGap() : r.show.beat(kind);
  const rejected = expect(operation).rejects.toThrow();
  r.controller.abort(); await rejected;
  expect(Date.now()).toBe(10000); expect(vi.getTimerCount()).toBe(0);
  expect(() => r.show.assertActive()).toThrow();
});

it.each(['window', 'end', 'death', 'respawn', 'dimension', 'viewer-epoch', 'viewer-revoke'] as const)('fences %s replacement without resuming a late operation', async kind => {
  const r = rig(); let epoch = 1;
  const revoke = bindNativeGuiPresentation(r.bot, () => ({ ready: true, epoch, playerUuid: 'same-player' }));
  const show = new ShowPacer(tempo, { bot: r.bot, ctx: r.ctx });
  const operation = show.beat('open'), rejected = expect(operation).rejects.toThrow();
  if (kind === 'window') { r.bot.currentWindow = { id: 0 }; r.bot.emit('windowOpen'); }
  else if (kind === 'dimension') r.bot.game.dimension = 'the_nether';
  else if (kind === 'viewer-epoch') epoch++;
  else if (kind === 'viewer-revoke') revoke();
  else r.bot.emit(kind);
  await vi.advanceTimersByTimeAsync(25); await rejected;
  expect(vi.getTimerCount()).toBe(0);
  expect(() => show.assertActive()).toThrow();
});

it('isolates reopen gaps per Bot and keeps the existing gap outside the operation budget', async () => {
  const a = rig(), b = rig(); markShowWindowClosed(a.bot);
  await b.show.openGap(); expect(vi.getTimerCount()).toBe(0);
  const gap = a.show.openGap(); await vi.advanceTimersByTimeAsync(899);
  expect(a.show.budget.spentMs).toBe(0);
  await vi.advanceTimersByTimeAsync(1); await gap;
  const open = a.show.beat('open'); await vi.advanceTimersByTimeAsync(800); await open;
  expect(a.show.budget.spentMs).toBe(800);
});

it('spreads a bounded craft budget over every iteration rather than making the tail instant', async () => {
  const r = rig(), show = new ShowPacer({ ...tempo, budgetMs: 6000 }, { bot: r.bot, ctx: r.ctx });
  show.planBeats({ open: 1, close: 1, click: 10, result: 10 });
  const waits: number[] = [];
  const run = async () => {
    await show.beat('open');
    for (let i = 0; i < 10; i++) {
      const before = Date.now(); await show.beat('click'); await show.beat('result'); waits.push(Date.now() - before);
    }
    await show.beat('close');
  };
  const task = run(); await vi.runAllTimersAsync(); await task;
  expect(Math.max(...waits) - Math.min(...waits)).toBeLessThanOrEqual(2);
  expect(waits.at(-1)).toBeGreaterThan(500);
  expect(show.budget.spentMs).toBeCloseTo(6000);
  expect(r.notes.filter(note => note.event === 'show-budget-limited')).toHaveLength(1);
});

it('honors hot overrides and disables a pending presentation within 25ms', async () => {
  const r = rig(); let current: typeof tempo | null = { ...tempo, clickMs: 123 };
  const show = new ShowPacer(() => current, { bot: r.bot, ctx: r.ctx });
  let wait = show.beat('click'); await vi.advanceTimersByTimeAsync(123); await wait;
  expect(show.budget.spentMs).toBe(123);
  current.clickMs = 321; wait = show.beat('click'); current = null;
  await vi.advanceTimersByTimeAsync(25); await wait;
  expect(vi.getTimerCount()).toBe(0);
});

it('makes budget exhaustion visible for unknown-length container work', async () => {
  const r = rig(), show = new ShowPacer({ ...tempo, budgetMs: 10 }, { bot: r.bot, ctx: r.ctx });
  const wait = show.beat('click'); await vi.advanceTimersByTimeAsync(10); await wait;
  await show.beat('click');
  expect(show.budget).toEqual({ spentMs: 10, adjusted: true });
  expect(r.notes[0].data.planned).toBe(false);
});
it('keeps disabled presentation zero wait', async () => {
  vi.useFakeTimers();
  const show = new ShowPacer(null);
  await show.openGap();
  for (const kind of ['open', 'click', 'result', 'close'] as const) await show.beat(kind);
  expect(vi.getTimerCount()).toBe(0);
});
