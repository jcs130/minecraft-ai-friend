/** A keyed capture connection expires after a minute without a renewal. */
export class ViewerCaptureLease {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = true;

  constructor(private readonly expired: () => void, private readonly idleMs = 60_000) {
    this.renew();
  }

  renew(): void {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.release(), this.idleMs);
    this.timer.unref();
  }

  stop(): void {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  release(): void {
    if (!this.active) return;
    this.stop();
    this.expired();
  }
}
