import type { DeferredRendered } from './support/host-contract.ts';

type Render = (signal?:AbortSignal) => DeferredRendered | null | Promise<DeferredRendered | null>;

/** A deferred IPC ticket can consume only its registered callback. New tickets supersede their type. */
export class DeferredRenders {
  private nextId = 1;
  private readonly entries = new Map<string, { id: number; render: Render }>();

  arm(type: string, render: Render): number {
    const id = this.nextId++;
    this.entries.set(type, { id, render });
    return id;
  }

  async render(type: string, id: number, signal?:AbortSignal): Promise<DeferredRendered | null> {
    const entry = this.entries.get(type);
    if (!entry || entry.id !== id) return null;
    this.entries.delete(type);
    const out = await entry.render(signal);
    return signal?.aborted ? null : out;
  }
}
