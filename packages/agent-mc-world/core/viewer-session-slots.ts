/** Audience limit 0 is unlimited; temporary captures retain their independent limit. */
export class ViewerSessionSlots {
  private viewers = 0;
  private captures = 0;

  constructor(readonly maxViewers = 0, readonly maxCaptures = 1) {
    for (const limit of [maxViewers, maxCaptures]) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Viewer session limits must be non-negative safe integers');
    }
  }

  reserve(capture: boolean): (() => void) | null {
    if (capture ? this.captures >= this.maxCaptures : this.maxViewers > 0 && this.viewers >= this.maxViewers) return null;
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

  status(): { viewers: number; maxSessions: number; audienceUnlimited: boolean; captureSessions: number; maxCaptureSessions: number } {
    // Legacy observers compare viewers >= maxSessions without recognizing 0.
    return { viewers: this.viewers, maxSessions: this.maxViewers || Number.MAX_SAFE_INTEGER, audienceUnlimited: this.maxViewers === 0,
      captureSessions: this.captures, maxCaptureSessions: this.maxCaptures };
  }
}
