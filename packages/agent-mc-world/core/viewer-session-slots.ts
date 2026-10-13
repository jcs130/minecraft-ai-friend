/** ViewerSessionSlots keeps temporary capture connections separate from audience connections. */
export class ViewerSessionSlots {
  private viewers = 0;
  private captures = 0;

  constructor(readonly maxViewers: number, readonly maxCaptures: number) {}

  reserve(capture: boolean): (() => void) | null {
    if (capture ? this.captures >= this.maxCaptures : this.viewers >= this.maxViewers) return null;
    if (capture) this.captures++;
    else this.viewers++;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (capture) this.captures--;
      else this.viewers--;
    };
  }

  status(): { viewers: number; maxSessions: number; captureSessions: number; maxCaptureSessions: number } {
    return { viewers: this.viewers, maxSessions: this.maxViewers,
      captureSessions: this.captures, maxCaptureSessions: this.maxCaptures };
  }
}
