import { createHash } from 'node:crypto';

/** Additive source-owned request view. The original event and its metadata remain authoritative. */
export interface SupervisorEventView {
  protocol: 'event-context-view/v1';
  originalSha256: string;
  supervisor: string;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Producers opt in only for routine detail. Never use this to summarize unknown outcomes or human input. */
export function supervisorEventView(original: string, supervisor: string): SupervisorEventView {
  if (!supervisor.trim() || supervisor.length > 2000) throw new RangeError('Supervisor view must contain 1–2000 characters');
  return { protocol: 'event-context-view/v1', originalSha256: hash(original), supervisor };
}

/** A missing, malformed or mismatched view preserves the full original, including after upgrades. */
export function readSupervisorEventView(original: string, value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const view = value as Partial<SupervisorEventView>;
  return view.protocol === 'event-context-view/v1' && view.originalSha256 === hash(original)
    && typeof view.supervisor === 'string' && !!view.supervisor.trim()
    && view.supervisor.length <= 2000 && view.supervisor.length < original.length
    ? view.supervisor : null;
}

/** Only an accepted tactical choice is routine progress. Rejection/error details are never condensed. */
export function tacticSupervisorView(receipt: Record<string, unknown>): SupervisorEventView | null {
  if (receipt.accepted !== true || receipt.error || !receipt.candidate || typeof receipt.candidate !== 'object') return null;
  const candidate = receipt.candidate as Record<string, unknown>;
  const summary = JSON.stringify({ id: receipt.id, at: receipt.at, accepted: true,
    choice: {kind:candidate.kind, targetId:candidate.targetId}, decisionId:receipt.decisionId,
    tacticRevision:receipt.tacticRevision, method:receipt.method, runId:receipt.runId,
    meaning:receipt.meaning, goalCompleted:false });
  return summary.length <= 2000 ? supervisorEventView(JSON.stringify(receipt), summary) : null;
}
