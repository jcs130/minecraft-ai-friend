import { onConnectionEnd } from './connection-end.ts';
/** Ordinary GUI presentation. No timer owns or cancels a native inventory receipt. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Bot } from 'mineflayer';
import { Aborted, type SkillContext } from './skill-context.ts';
import { inventoryClickState } from './inventory-click-sync.ts';

export interface ShowTempo {
  clickMs: number;
  dwellOpenMs: number;
  dwellResultMs: number;
  dwellCloseMs: number;
  budgetMs: number;
  reopenGapMs: number;
  /** True only for a current native presentation that includes inventory-grid slots. */
  inventory?: boolean;
}
type ShowBeat = 'open' | 'click' | 'result' | 'close';
type Window = NonNullable<Bot['currentWindow']>;
type TempoSource = ShowTempo | null | (() => ShowTempo | null);

/** The producer owns current player/session/epoch readiness, never a saved URL. */
export interface NativeGuiPresentation { ready: boolean; epoch: number; playerUuid: string }
const presentations = new WeakMap<Bot, () => NativeGuiPresentation | null>();
const presentationDisposers = new WeakMap<Bot, () => void>();
export function bindNativeGuiPresentation(bot: Bot, ready: () => NativeGuiPresentation | null): () => void {
  presentationDisposers.get(bot)?.();
  presentations.set(bot, ready);
  const revoke = () => {
    if (presentations.get(bot) === ready) presentations.delete(bot);
    if (presentationDisposers.get(bot) === revoke) presentationDisposers.delete(bot);
    detachEnd();
  };
  const detachEnd = onConnectionEnd(bot, revoke);
  presentationDisposers.set(bot, revoke);
  return revoke;
}
export function nativeGuiPresented(bot: Bot | null | undefined): boolean {
  if (!bot?.entity) return false;
  try { return presentations.get(bot)?.()?.ready === true; } catch { return false; }
}

interface Scene { closedAt: number | null; epoch: number }
const scenes = new WeakMap<Bot, Scene>();
function sceneFor(bot: Bot): Scene {
  let scene = scenes.get(bot);
  if (scene) return scene;
  scene = { closedAt: null, epoch: 0 }; scenes.set(bot, scene);
  const current = scene;
  bot.on('windowClose', () => { current.closedAt = Date.now(); });
  const reset = () => { current.epoch++; };
  for (const event of ['death', 'respawn'] as const) bot.on(event, reset);
  onConnectionEnd(bot, reset);
  return scene;
}
export function markShowWindowClosed(bot: Bot, now = Date.now()): void { sceneFor(bot).closedAt = now; }

const operations = new AsyncLocalStorage<{ bot: Bot; show: ShowPacer }>();
export function currentShowPacer(bot: Bot): ShowPacer | undefined {
  const operation = operations.getStore(); return operation?.bot === bot ? operation.show : undefined;
}
export function withShowPacer<T>(bot: Bot, show: ShowPacer, run: () => Promise<T>): Promise<T> {
  return operations.run({ bot, show }, run);
}

export class ShowPacer {
  private spent = 0;
  private window: Window | undefined;
  private readonly scene?: Scene;
  private readonly epoch?: number;
  private readonly dimension?: unknown;
  private invalid: Error | null = null;
  private readonly presentation?: () => NativeGuiPresentation | null;
  private readonly presentationEpoch?: number;
  private plan?: Record<ShowBeat, number>;
  private budgetReported = false;

  constructor(private readonly source: TempoSource, private readonly options: {
    bot?: Bot; ctx?: Pick<SkillContext, 'aborted'> & Partial<Pick<SkillContext, 'abortedBy' | 'signal' | 'diag' | 'taskId'>>;
  } = {}) {
    if (options.bot) {
      this.scene = sceneFor(options.bot); this.epoch = this.scene.epoch;
      this.dimension = options.bot.game?.dimension;
      this.presentation = presentations.get(options.bot);
      try { this.presentationEpoch = this.presentation?.()?.epoch; } catch { /* optional renderer */ }
    }
  }
  get tempo(): ShowTempo | null { return typeof this.source === 'function' ? this.source() : this.source; }
  get budget(): { spentMs: number; adjusted: boolean } { return { spentMs: this.spent, adjusted: this.budgetReported }; }
  /** Known craft work shares the budget proportionally, including the last iteration. */
  planBeats(beats: Record<ShowBeat, number>): void { this.plan = { ...beats }; }
  bindWindow(window: Window): void { this.window = window; this.assertActive(); }
  releaseWindow(): void { this.window = undefined; }
  assertActive(): void {
    if (this.invalid) throw this.invalid;
    const { bot, ctx } = this.options;
    try {
      if (ctx?.aborted()) throw new Aborted(ctx.abortedBy?.() ?? null);
      if (ctx?.signal?.aborted || (this.scene && this.scene.epoch !== this.epoch)
        || (bot && bot.game?.dimension !== this.dimension)) throw new Aborted('GUI 操作的任务或连接代次已改变');
      if (bot && this.presentation) {
        let epoch: number | undefined;
        try { epoch = this.presentation()?.epoch; } catch { /* absence disables presentation */ }
        if (presentations.get(bot) !== this.presentation
          || (epoch !== undefined && this.presentationEpoch !== undefined && epoch !== this.presentationEpoch))
          throw new Aborted('原生 GUI 展示的会话或代次已改变');
      }
      if (bot && this.window && (bot.currentWindow ?? bot.inventory) !== this.window)
        throw new Aborted('GUI 操作窗口已关闭或被替换');
    } catch (error) { this.invalid = error as Error; throw error; }
  }
  /** Close only the same actual window; cancellation may leave its materials for reconciliation. */
  ownsWindow(window: Window): boolean {
    const bot = this.options.bot;
    return !!bot && this.scene?.epoch === this.epoch && bot.game?.dimension === this.dimension
      && (bot.currentWindow ?? bot.inventory) === window;
  }
  closeWindow(window: Window, close: () => void): void {
    if (this.ownsWindow(window) && this.options.bot && inventoryClickState(this.options.bot).phase === 'ready') close();
    this.releaseWindow();
  }
  private async wait(ms: number): Promise<void> {
    this.assertActive();
    if (ms <= 0) return;
    const { bot, ctx } = this.options;
    const expected = bot ? bot.currentWindow ?? bot.inventory : undefined;
    const finishAt = Date.now() + ms;
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const events = ['windowOpen', 'windowClose', 'end', 'death', 'respawn'] as const;
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        ctx?.signal?.removeEventListener('abort', check);
        for (const event of events) bot?.off(event, check);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        try {
          this.assertActive();
          if (bot && (bot.currentWindow ?? bot.inventory) !== expected) {
            this.invalid = new Aborted('GUI 等待期间窗口已被替换'); throw this.invalid;
          }
          // Disabled presentation drops its remaining dwell. Checks also cover old
          // contexts without an AbortSignal and producer readiness/epoch changes.
          if (!this.tempo || Date.now() >= finishAt) return finish();
          clearTimeout(timer); timer = setTimeout(check, Math.min(25, finishAt - Date.now()));
        } catch (error) { finish(error); }
      };
      for (const event of events) bot?.on(event, check);
      ctx?.signal?.addEventListener('abort', check, { once: true });
      check();
    });
    this.assertActive();
  }
  async openGap(now = Date.now()): Promise<void> {
    this.assertActive();
    const t = this.tempo, closed = this.scene?.closedAt;
    if (!t || closed == null) return;
    await this.wait(Math.max(0, Math.min(t.reopenGapMs, t.reopenGapMs - (now - closed))));
  }
  async beat(kind: ShowBeat): Promise<void> {
    this.assertActive();
    if (kind === 'open' && this.options.bot) this.bindWindow(this.options.bot.currentWindow ?? this.options.bot.inventory);
    const t = this.tempo;
    if (!t) { if (this.plan) this.plan[kind] = Math.max(0, this.plan[kind] - 1); return; }
    const durations = { open: t.dwellOpenMs, click: t.clickMs, result: t.dwellResultMs, close: t.dwellCloseMs };
    const ms = durations[kind], left = Math.max(0, t.budgetMs - this.spent);
    const remaining = this.plan ? (Object.keys(durations) as ShowBeat[])
      .reduce((sum, beat) => sum + this.plan![beat] * durations[beat], 0) : ms;
    const wait = Math.max(0, Math.min(ms, left, remaining > 0 ? left * ms / remaining : ms));
    if (this.plan) this.plan[kind] = Math.max(0, this.plan[kind] - 1);
    if (wait < ms && !this.budgetReported) {
      this.budgetReported = true;
      this.options.ctx?.diag?.write({ lane: 'craft', event: 'show-budget-limited', taskId: this.options.ctx.taskId,
        msg: this.plan ? 'GUI 节拍预算不足，按剩余合成步骤等比例分配，末轮保留节拍' : 'GUI 节拍预算耗尽，后续步骤减少等待',
        data: { budgetMs: t.budgetMs, spentMs: this.spent, remainingRequestedMs: remaining, planned: !!this.plan } });
    }
    this.spent += wait;
    await this.wait(wait);
  }
}
