/**
 * Background worker lane: fire-and-forget jobs (reflection, memory maintenance) that must never block the
 * host API or the body. Bounded queue, small concurrency, failures isolated and counted.
 */
export class AsyncWorkers {
  private queue: Array<{ name: string; job: (signal: AbortSignal) => Promise<void> }> = [];
  private active = 0;
  private readonly controller = new AbortController();
  private idleWaiters: Array<() => void> = [];
  readonly stats = { completed: 0, failed: 0, dropped: 0 };

  constructor(private readonly options: { concurrency?: number; maxQueued?: number; log?: (m: string, d?: Record<string, unknown>) => void } = {}) {}

  enqueue(name: string, job: (signal: AbortSignal) => Promise<void>): boolean {
    if (this.controller.signal.aborted) return false;
    if (this.queue.length >= (this.options.maxQueued ?? 100)) { this.stats.dropped++; return false; }
    this.queue.push({ name, job });
    this.drain();
    return true;
  }

  private drain(): void {
    while (this.active < (this.options.concurrency ?? 1) && this.queue.length) {
      const { name, job } = this.queue.shift()!;
      this.active++;
      void job(this.controller.signal).then(() => { this.stats.completed++; }, error => {
        this.stats.failed++; this.options.log?.('worker job failed', { name, error: String(error).slice(0, 200) });
      }).finally(() => { this.active--; this.drain(); if (!this.active && !this.queue.length) this.idleWaiters.splice(0).forEach(r => r()); });
    }
  }

  idle(): Promise<void> { return !this.active && !this.queue.length ? Promise.resolve() : new Promise(r => this.idleWaiters.push(r)); }
  async close(): Promise<void> { this.queue = []; this.controller.abort(); await this.idle(); }
}
