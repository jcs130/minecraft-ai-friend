/** Token bucket: `burst` capacity, refilled at `perMinute`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private readonly perMinute: number, private readonly burst: number, private readonly clock: () => number = Date.now) {
    this.tokens = burst; this.last = clock();
  }
  take(): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = this.clock();
    this.tokens = Math.min(this.burst, this.tokens + (now - this.last) * this.perMinute / 60_000);
    this.last = now;
    if (this.tokens >= 1) { this.tokens -= 1; return { ok: true }; }
    return { ok: false, retryAfterMs: Math.ceil((1 - this.tokens) * 60_000 / this.perMinute) };
  }
}

/** Keyed buckets with bounded size (oldest evicted). */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  constructor(private readonly clock: () => number = Date.now, private readonly maxKeys = 10_000) {}
  take(key: string, perMinute: number, burst: number) {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
      b = new TokenBucket(perMinute, burst, this.clock); this.buckets.set(key, b);
    }
    return b.take();
  }
}

export interface GatewayLimits {
  /** Max bytes of one inbound message (WS frame or HTTP body). Default 64 KiB. */
  maxMessageBytes: number;
  maxConnectionsPerAgent: number;
  maxSubscriptionsPerSession: number;
  /** Unauthenticated WebSocket must send hello within this time. */
  helloTimeoutMs: number;
  /** Failed auth attempts per remote address per minute. */
  authFailuresPerMinute: number;
  /** Drop pushes (and mark the next one `gap`) while a socket buffers more than this. */
  maxBufferedBytes: number;
}
export const DEFAULT_LIMITS: GatewayLimits = { maxMessageBytes: 64 * 1024, maxConnectionsPerAgent: 8, maxSubscriptionsPerSession: 8,
  helloTimeoutMs: 10_000, authFailuresPerMinute: 10, maxBufferedBytes: 1024 * 1024 };
