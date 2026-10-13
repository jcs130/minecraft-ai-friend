import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolOutcome } from './contracts.ts';
import type { AgentJournal } from './journal.ts';
type RecordEntry = { requestId: string; signature: string; phase: 'pending' | 'returned' | 'failed'; outcome?: ToolOutcome; error?: string };
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
    if (record.phase === 'pending') throw new Error('Request outcome unknown after interruption; inspect archived evidence before issuing a new request id');
    if (record.phase === 'failed') throw new Error(record.error);
    return record.outcome!;
  }
  write(record: RecordEntry) {
    const body = record.outcome ? { ...record, outcome: { ...record.outcome,
      blobs: this.journal.saveBlobs(record.outcome.blobs).map(({ handle, fallbackText }) => ({ handle, fallbackText })) } } : record;
    const file = this.file(record.requestId), temporary = file + '.tmp';
    writeFileSync(temporary, JSON.stringify(body)); renameSync(temporary, file);
  }
}
