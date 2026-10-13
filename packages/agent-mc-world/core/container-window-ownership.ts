import { isDeepStrictEqual } from 'node:util';
import type { Bot } from 'mineflayer';
import { SkillBlocked, checkAbort, sleep, type SkillContext } from './skill-context.ts';
import { storageWindow } from './window-semantics.ts';

type ContainerWindow = NonNullable<Bot['currentWindow']>;
type WindowDescriptor = Pick<ContainerWindow, 'id' | 'type' | 'inventoryStart' | 'inventoryEnd'
  | 'hotbarStart' | 'craftingResultSlot'> & { slotCount: number };

const unknownWindows = new WeakMap<Bot, WeakSet<ContainerWindow>>();

function unconfirmedWindowsOf(bot: Bot): WeakSet<ContainerWindow> {
  let windows = unknownWindows.get(bot);
  if (windows) return windows;
  windows = new WeakSet();
  unknownWindows.set(bot, windows);
  const pending = windows;
  // A late complete read also releases an unknown object retained between tasks.
  bot._client?.on('window_items', (packet: { windowId: number; items: unknown[] }) => {
    const current = bot.currentWindow;
    if (current && packet.windowId === current.id && packet.items.length >= current.slots.length) pending.delete(current);
  });
  return windows;
}

function descriptor(window: ContainerWindow): WindowDescriptor {
  // Titles are presentation metadata. A same-ID retitle before commitment must
  // still provide fresh complete contents; closure or later replacement invalidates ownership.
  return { id: window.id, type: window.type,
    inventoryStart: window.inventoryStart, inventoryEnd: window.inventoryEnd,
    hotbarStart: window.hotbarStart,
    craftingResultSlot: window.craftingResultSlot, slotCount: window.slots.length };
}

interface Opening {
  baseline: Bot['currentWindow'];
  scope: string;
  first: WindowDescriptor | null;
  candidate: ContainerWindow | null;
  ready: Set<ContainerWindow>;
  contents: Set<ContainerWindow>;
  opened: boolean;
  committed: boolean;
  failed: boolean;
}

export interface WindowOwnershipEvent {
  kind: 'candidate' | 'bound' | 'mismatch' | 'close-deferred';
  window: ContainerWindow;
  source: string;
  heldWindow: ContainerWindow | null;
  candidateWindow: ContainerWindow | null;
  changedFields?: string[];
}

/** An opener may settle several compatible ready objects before any container operation claims one. */
export class ContainerWindowOwnership {
  heldWindow: ContainerWindow | null = null;
  private heldClosed = false;
  private unconfirmedOpening = false;
  private opening: Opening | null = null;
  private readonly unknownWindows: WeakSet<ContainerWindow>;

  constructor(private readonly bot: Bot, private readonly options: {
    valid(): boolean;
    scope(): string;
    onEvent(event: WindowOwnershipEvent): void;
  }) { this.unknownWindows = unconfirmedWindowsOf(bot); }

  beginOpening(baseline: Bot['currentWindow']): void {
    this.opening = { baseline, scope: this.options.scope(), first: null,
      candidate: null, ready: new Set(), contents: new Set(), opened: false, committed: false, failed: false };
    this.bot._client?.on('window_items', this.onWindowItems);
    this.bot._client?.on('open_window', this.onOpenPacket);
    this.bot._client?.on('open_horse_window', this.onOpenPacket);
    this.bot._client?.on('end', this.onConnectionEnd);
  }

  private readonly onOpenPacket = (): void => {
    const opening = this.opening;
    const current = this.bot.currentWindow;
    if (!opening || opening.failed || !current || current === opening.baseline || !this.options.valid()) return;
    opening.opened = true;
    this.unknownWindows.add(current);
    const next = descriptor(current);
    if ((this.heldWindow && this.heldWindow !== current)
      || (opening.first && !isDeepStrictEqual(opening.first, next))) {
      opening.failed = true;
      this.event('mismatch', current, 'open-packet');
      return;
    }
    opening.first ??= next;
    // Track the current packet object before readiness callbacks can cancel or
    // reenter. Ownership is committed only after its fresh complete contents.
    if (opening.candidate !== current) {
      opening.candidate = current;
      this.event('candidate', current, 'open-packet');
    }
  };

  private readonly onWindowItems = (packet: { windowId: number; items: unknown[] }): void => {
    const opening = this.opening;
    const current = this.bot.currentWindow;
    if (opening && current && current !== opening.baseline && packet.windowId === current.id
      && packet.items.length >= current.slots.length) opening.contents.add(current);
  };

  private readonly onConnectionEnd = (): void => {
    if (this.opening) this.opening.failed = true;
  };

  private event(kind: WindowOwnershipEvent['kind'], window: ContainerWindow, source: string): void {
    const first = this.opening?.first;
    const current = descriptor(window);
    const changedFields = kind === 'mismatch' && first
      ? (Object.keys(first) as Array<keyof WindowDescriptor>)
        .filter((key) => !isDeepStrictEqual(first[key], current[key])) : undefined;
    this.options.onEvent({ kind, window, source, heldWindow: this.heldWindow,
      candidateWindow: this.opening?.candidate ?? null,
      ...(changedFields ? { changedFields } : {}) });
  }

  private fail(window?: ContainerWindow, source = 'opener-result'): never {
    if (this.opening) this.opening.failed = true;
    if (window) this.event('mismatch', window, source);
    throw new SkillBlocked('本任务使用的容器窗口已关闭或被替换，不能确认开窗或存取结果',
      [], 'local', 'container-window-changed');
  }

  retain(window: ContainerWindow, source: string): void {
    if (!this.options.valid()) this.fail(window, source);
    if (this.heldWindow) {
      if (this.heldClosed || this.heldWindow !== window || this.bot.currentWindow !== window) this.fail(window, source);
      return;
    }
    const opening = this.opening;
    if (opening) {
      if (opening.failed || opening.scope !== this.options.scope()) this.fail(window, source);
      if (window === opening.baseline || this.bot.currentWindow !== window || !storageWindow(window)) {
        this.fail(window, source);
      }
      const current = descriptor(window);
      if (opening.first && !isDeepStrictEqual(opening.first, current)) this.fail(window, source);
      opening.first ??= current;
      opening.opened = true;
      if (opening.candidate !== window) {
        opening.candidate = window;
        if (!opening.contents.has(window)) this.unknownWindows.add(window);
        this.event('candidate', window, source);
      }
      return;
    }
    if (this.unknownWindows.has(window)) this.fail(window, source);
    if (this.bot.currentWindow !== window) this.fail(window, source);
    this.heldWindow = window;
    this.event('bound', window, source);
  }

  onWindowOpen(window: ContainerWindow): void {
    const opening = this.opening;
    // Mineflayer may emit an old prepareWindow callback after currentWindow has changed.
    if (!opening || !this.options.valid() || window === opening.baseline
      || this.bot.currentWindow !== window || !storageWindow(window)) return;
    try {
      // Native replacements are first observed through their open packet. A ready
      // callback alone cannot establish that another object belongs to this opening.
      if (opening.candidate && opening.candidate !== window) this.fail(window, 'window-open');
      this.retain(window, 'window-open');
      opening.ready.add(window);
    } catch (error) {
      if (!(error instanceof SkillBlocked)) throw error;
      opening.failed = true;
    }
  }

  onWindowClose(window: ContainerWindow | null): void {
    if (this.heldWindow && (!window || window === this.heldWindow)) this.heldClosed = true;
    if (this.opening?.opened) this.opening.failed = true;
  }

  isHeldCurrent(): boolean {
    return this.options.valid() && !this.heldClosed && this.bot.currentWindow === this.heldWindow;
  }

  hasUnconfirmedOpening(): boolean { return this.unconfirmedOpening; }

  isCurrentUnconfirmed(): boolean {
    return !!this.bot.currentWindow && this.unknownWindows.has(this.bot.currentWindow);
  }

  async awaitOpeningReady(ctx: SkillContext): Promise<void> {
    const opening = this.opening;
    if (!opening || (!opening.opened && !opening.candidate)) return;
    // Match the existing container-readiness budget; readiness comes from windowOpen, never empty slots.
    const until = Date.now() + 1_500;
    for (;;) {
      checkAbort(ctx);
      if (!this.options.valid() || opening.failed || opening.scope !== this.options.scope()) this.fail();
      const current = this.bot.currentWindow;
      if (current && current === opening.candidate && opening.ready.has(current)
        && opening.contents.has(current)) return;
      if (current && !isDeepStrictEqual(opening.first, descriptor(current))) this.fail(current);
      if (!current || Date.now() >= until) this.fail(current ?? undefined);
      await sleep(50);
    }
  }

  commitOpening(): void {
    const opening = this.opening;
    if (!opening) return;
    const current = this.bot.currentWindow;
    if (!this.options.valid() || opening.failed || opening.scope !== this.options.scope()
      || !current || current !== opening.candidate || !opening.ready.has(current)
      || !opening.contents.has(current) || !isDeepStrictEqual(opening.first, descriptor(current))
      || (this.heldWindow && !this.isHeldCurrent())) this.fail(current ?? undefined);
    this.heldWindow = current;
    opening.committed = true;
    this.unconfirmedOpening = false;
    this.event('bound', current, 'opener-result');
  }

  close(): void {
    const window = this.heldWindow ?? this.opening?.candidate;
    if (!window || (this.bot.currentWindow && this.bot.currentWindow !== window)) return;
    // Closing an unconfirmed cached window would copy its stale player slots into window 0.
    if (!this.heldWindow && !this.opening?.contents.has(window)) {
      this.event('close-deferred', window, 'unconfirmed-contents');
      return;
    }
    this.heldWindow = null;
    this.heldClosed = false;
    if (this.bot.currentWindow === window) this.bot.closeWindow(window);
  }

  endOpening(): void {
    if (this.opening && !this.opening.committed) this.unconfirmedOpening = true;
    this.bot._client?.removeListener('window_items', this.onWindowItems);
    this.bot._client?.removeListener('open_window', this.onOpenPacket);
    this.bot._client?.removeListener('open_horse_window', this.onOpenPacket);
    this.bot._client?.removeListener('end', this.onConnectionEnd);
    this.opening = null;
  }
}
