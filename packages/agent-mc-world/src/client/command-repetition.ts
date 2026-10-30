/** Bound consecutive opaque server-command submissions between explicit inspections. */
import { createHash } from 'node:crypto';

export interface CommandSubmission {
  tracked: true;
  admitted: boolean;
  commandHash: string;
  submissions: number;
  limit: number;
  firstRequestId: string;
  latestRequestId: string;
  after: number;
  serverEffect: 'unverified';
}

/** No command text is retained. Inspection permits reconsideration, not proof of success. */
export class CommandRepetitionGuard {
  private current: Omit<CommandSubmission, 'admitted' | 'tracked' | 'serverEffect'> | null = null;
  private readonly requests = new Map<string, { hash: string; result: CommandSubmission }>();
  constructor(readonly limit = 3) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) throw new TypeError('Invalid command repetition limit');
  }
  /** Check a new request; transport retries keep their original decision.
   * @param name - exact game tool name.
   * @param args - original model arguments.
   * @param requestId - stable request identity.
   * @param after - journal cursor before this submission.
   * @returns metadata-only admission, or null for other actions and authentication.
   */
  admit(name: string, args: Record<string, unknown>, requestId: string, after: number): CommandSubmission | null {
    const steps = args.steps;
    if (!this.limit || !name.endsWith('_do') || !Array.isArray(steps) || !steps.length || steps.length > 64) return null;
    const commands: string[] = [];
    for (const step of steps) {
      if (!step || typeof step !== 'object' || step.skill !== 'chat' || typeof step.text !== 'string') return null;
      const text = step.text.trim();
      if (!text.startsWith('/') || text.length > 2048 || /^\/(?:[a-z0-9_.-]+:)?(?:login|register|l|reg|auth|captcha|msg|tell|w)(?:\s|$)/i.test(text)) return null;
      commands.push(text);
    }
    const hash = createHash('sha256').update(JSON.stringify(commands)).digest('hex'), previous = this.requests.get(requestId);
    if (previous) {
      if (previous.hash !== hash) throw Error('Command request id reused with different arguments');
      return structuredClone(previous.result);
    }
    if (this.current?.commandHash !== hash) this.current = { commandHash: hash, submissions: 0, limit: this.limit,
      firstRequestId: requestId, latestRequestId: requestId, after };
    const admitted = this.current.submissions < this.limit;
    if (admitted) { this.current.submissions++; this.current.latestRequestId = requestId; }
    const result: CommandSubmission = { ...this.current, tracked: true, admitted, serverEffect: 'unverified' };
    this.requests.set(requestId, { hash, result });
    while (this.requests.size > 256) this.requests.delete(this.requests.keys().next().value!);
    return structuredClone(result);
  }
  /** An explicit inspection returned. Background fact/event polling must not call this. */
  inspected(): void { this.current = null; }
  /** Return only bounded hashes and request identities. */
  snapshot() { return { protocol: 'agent-mc-command-repetition/v1', current: this.current && structuredClone(this.current) }; }
}
