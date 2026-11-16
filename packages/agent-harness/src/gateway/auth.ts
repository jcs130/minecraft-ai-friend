import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Per-agent credentials. Config never contains token values: either the NAME of an env var holding the token
 * (`tokenEnv`) or the token's SHA-256 hex digest (`tokenSha256`). Comparison is constant time over digests.
 */
export interface GatewayAgentConfig {
  id: string;
  tokenEnv?: string;
  tokenSha256?: string;
  /** May control every intent, pause/resume the whole harness, and see all intent events. */
  admin?: boolean;
  /** Highest priority this agent may request (default 75 = high; admin 100). ≥90 can preempt. */
  maxPriority?: number;
  ratePerMinute?: number;
  burst?: number;
  /** Max non-terminal intents owned at once (default 20). */
  maxOpenIntents?: number;
}

export interface GatewayAgent {
  id: string; admin: boolean; maxPriority: number; ratePerMinute: number; burst: number; maxOpenIntents: number; anonymous: boolean;
}

const AGENT_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export const MIN_TOKEN_LENGTH = 16;

export class AgentRegistry {
  private readonly entries: Array<{ agent: GatewayAgent; digest: Buffer }> = [];
  readonly anonymous: GatewayAgent | null;

  constructor(configs: readonly GatewayAgentConfig[], options: { env?: NodeJS.ProcessEnv; allowAnonymous?: boolean } = {}) {
    const env = options.env ?? process.env;
    const seen = new Set<string>();
    for (const c of configs) {
      if (!AGENT_ID.test(c.id ?? '')) throw new Error(`invalid agent id ${JSON.stringify(String(c.id).slice(0, 70))}`);
      if (seen.has(c.id)) throw new Error(`duplicate agent id ${c.id}`);
      seen.add(c.id);
      let digest: Buffer;
      if (c.tokenSha256 !== undefined) {
        if (!/^[0-9a-f]{64}$/i.test(c.tokenSha256)) throw new Error(`agent ${c.id}: tokenSha256 must be 64 hex chars`);
        digest = Buffer.from(c.tokenSha256, 'hex');
      } else if (c.tokenEnv !== undefined) {
        if (!ENV_NAME.test(c.tokenEnv)) throw new Error(`agent ${c.id}: tokenEnv must be an environment variable name`);
        const token = env[c.tokenEnv];
        // Never include the value in errors.
        if (!token || token.length < MIN_TOKEN_LENGTH) throw new Error(`agent ${c.id}: env ${c.tokenEnv} is unset or shorter than ${MIN_TOKEN_LENGTH} chars`);
        digest = sha256(token);
      } else throw new Error(`agent ${c.id}: tokenEnv or tokenSha256 is required`);
      const admin = c.admin === true;
      this.entries.push({ digest, agent: { id: c.id, admin, anonymous: false,
        maxPriority: clamp(c.maxPriority ?? (admin ? 100 : 75), 0, 100), ratePerMinute: clamp(c.ratePerMinute ?? 120, 1, 6000),
        burst: clamp(c.burst ?? 30, 1, 1000), maxOpenIntents: clamp(c.maxOpenIntents ?? 20, 1, 200) } });
    }
    this.anonymous = !this.entries.length && options.allowAnonymous
      ? { id: 'anonymous', admin: false, anonymous: true, maxPriority: 75, ratePerMinute: 120, burst: 30, maxOpenIntents: 20 } : null;
  }

  get size(): number { return this.entries.length; }

  /** Constant-time over all agents (no early exit). Returns null on mismatch. */
  authenticate(token: string | null | undefined): GatewayAgent | null {
    if (!token) return this.anonymous;
    const presented = sha256(token);
    let found: GatewayAgent | null = null;
    for (const e of this.entries) if (timingSafeEqual(presented, e.digest) && !found) found = e.agent;
    return found;
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : lo)));

/** Agents from `AGENT_HARNESS_GATEWAY_AGENTS_FILE` (JSON `{agents:[…]}`) or inline `AGENT_HARNESS_GATEWAY_AGENTS` (same JSON). */
export function loadAgentConfigs(env: NodeJS.ProcessEnv = process.env): GatewayAgentConfig[] {
  const file = env.AGENT_HARNESS_GATEWAY_AGENTS_FILE;
  const raw = file ? readFileSync(file, 'utf8') : env.AGENT_HARNESS_GATEWAY_AGENTS;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { agents?: GatewayAgentConfig[] } | GatewayAgentConfig[];
  const agents = Array.isArray(parsed) ? parsed : parsed.agents ?? [];
  for (const a of agents) if ('token' in (a as object)) throw new Error(`agent ${a.id}: plaintext "token" is not allowed in config; use tokenEnv or tokenSha256`);
  return agents;
}

export function hashToken(token: string): string { return sha256(token).toString('hex'); }
