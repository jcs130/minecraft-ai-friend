import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolOutcome } from './contracts.ts';
import type { AgentJournal } from './journal.ts';
type RecordEntry = { requestId: string; signature: string; phase: 'pending' | 'returned' | 'failed'; outcome?: ToolOutcome; error?: string; cancelled?: true };
export class RequestOutcomeUnknownError extends Error {
  constructor(readonly requestId: string, message = 'Request outcome unknown after interruption; query the original request id without replaying it') { super(message); }
}
/** Pending records survive crashes: an uncertain operation must never be silently submitted again. */
export class RequestLedger {
  private readonly directory: string;
  constructor(private readonly journal: AgentJournal) {
    this.directory = join(journal.dataDir, 'requests'); mkdirSync(this.directory, { recursive: true });
  }
  private file(id: string) { return join(this.directory, createHash('sha256').update(id).digest('hex') + '.json'); }
  read(requestId: string, signature: string): ToolOutcome | null {
    const file = this.file(requestId);
    if (!existsSync(file)) return null;
    const record: RecordEntry = JSON.parse(readFileSync(file, 'utf8'));
    if (record.requestId !== requestId || record.signature !== signature) throw new Error('Request id reused with different arguments');
    if (record.phase === 'pending') throw new RequestOutcomeUnknownError(requestId);
    if (record.phase === 'failed') throw new RequestOutcomeUnknownError(requestId, record.error);
    return record.outcome!;
  }
  /** Reconcile only. Never calls a handler, acquires a body, or changes a pending record. */
  inspect(requestId: string) {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 256) throw new Error('Invalid request id');
    const file = this.file(requestId);
    const base = { request_id: requestId, retryable: false, retry_after: null,
      completed: null, remaining: null, replayed: false, goal_completed: false };
    if (!existsSync(file)) return { ...base, status: 'unknown', reason: 'request_not_found', outcome: null };
    const record: RecordEntry = JSON.parse(readFileSync(file, 'utf8'));
    if (record.requestId !== requestId) throw new Error('Request ledger identity mismatch');
    return { ...base, status: record.phase === 'returned' ? 'returned' : 'unknown',
      reason: record.phase === 'returned' ? null : record.phase === 'pending' ? 'interrupted_or_pending' : record.cancelled ? 'request_cancelled' : 'execution_error',
      outcome: record.outcome ?? null, error: record.error ?? null };
  }
  write(record: RecordEntry) {
    const body = record.outcome ? { ...record, outcome: { ...record.outcome,
      blobs: this.journal.saveBlobs(record.outcome.blobs).map(({ handle, fallbackText }) => ({ handle, fallbackText })) } } : record;
    const file = this.file(record.requestId), temporary = file + '.tmp';
    writeFileSync(temporary, JSON.stringify(body)); renameSync(temporary, file);
  }
}
