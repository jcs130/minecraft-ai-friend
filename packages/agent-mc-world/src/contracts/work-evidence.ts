import { createHash } from 'node:crypto';

export const WORK_EVIDENCE_SCHEMA = 'agent-mc/work-evidence/v1' as const;

/** Host-authored delivery, not a game fact or proof that the model understood it. */
export interface WorkReport { status: string; text: string; evidence: string[] }
export interface ReportReview { reportRevision: number; decision: 'continue' | 'release'; text: string }
export interface ReportRecord {
  assignmentId: string; reportRevision: number; report: WorkReport | null;
  review?: ReportReview; ended?: boolean;
}
export interface ReviewProposal {
  assignmentId: string; expectedReportRevision: number; reportReceipt?: string;
  decision: 'continue' | 'release'; text: string;
}
export type ReviewCode = 'INVALID_REVIEW' | 'ASSIGNMENT_IDENTITY_CONFLICT' | 'NO_REPORT'
  | 'REPORT_REVISION_CONFLICT' | 'REPORT_ALREADY_REVIEWED' | 'ASSIGNMENT_ENDED' | 'FULL_REPORT_REQUIRED';

const identity = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function validReport(value: unknown): value is WorkReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as WorkReport;
  return Object.keys(value).every(key => ['status', 'text', 'evidence'].includes(key))
    && identity(report.status) && typeof report.text === 'string' && Array.isArray(report.evidence)
    && report.evidence.every(item => typeof item === 'string');
}

/** Canonical UTF-8 receipt for the exact report and revision. It is a content
 * reference, not authentication, model delivery acknowledgement or completion.
 * Fixed field order preserves existing Cortico report receipts across adapters.
 */
export function workReportReceipt(assignmentId: string, revision: number, report: WorkReport | null): string | null {
  if (!identity(assignmentId) || !Number.isSafeInteger(revision) || revision < 0)
    throw new TypeError('Invalid report identity/revision');
  if (report === null) return null;
  if (revision < 1 || !validReport(report)) throw new TypeError('Invalid report');
  return createHash('sha256').update(JSON.stringify([assignmentId, revision,
    { status: report.status, text: report.text, evidence: report.evidence }])).digest('hex');
}

/** Pure optimistic review inspection. The host still checks activity/stage
 * versions, ownership and permissions, persists the decision, and schedules it.
 * In particular, reviewable never resolves a pending item or completes a goal.
 */
export function inspectReportReview(record: ReportRecord, proposal: ReviewProposal) {
  const receipt = workReportReceipt(record.assignmentId, record.reportRevision, record.report);
  const result = (disposition: 'reviewable' | 'idempotent' | 'reject', code: ReviewCode | null) => ({
    schema: WORK_EVIDENCE_SCHEMA, source: 'caller-supplied' as const, assignmentId: record.assignmentId,
    reportRevision: record.reportRevision, reportReceipt: receipt, disposition, code,
    mutated: false as const, goalCompleted: false as const,
  });
  if (proposal.assignmentId !== record.assignmentId) return result('reject', 'ASSIGNMENT_IDENTITY_CONFLICT');
  if (!record.report) return result('reject', 'NO_REPORT');
  if (proposal.expectedReportRevision !== record.reportRevision) return result('reject', 'REPORT_REVISION_CONFLICT');
  if (!['continue', 'release'].includes(proposal.decision) || !identity(proposal.text)) return result('reject', 'INVALID_REVIEW');
  if (record.review?.reportRevision === record.reportRevision) {
    return record.review.decision === proposal.decision && record.review.text === proposal.text
      ? result('idempotent', null) : result('reject', 'REPORT_ALREADY_REVIEWED');
  }
  if (record.ended) return result('reject', 'ASSIGNMENT_ENDED');
  if (proposal.reportReceipt !== receipt) return result('reject', 'FULL_REPORT_REQUIRED');
  return result('reviewable', null);
}

export interface NativeExecution { kind: string; id: string; terminal: boolean }
export interface ExecutionWait { world: string; kind: string; id: string }
/** Already parsed, native receipt delivered by the existing host. No prose inference. */
export interface ExecutionObservation { world: string; at: number; execution: NativeExecution }

export function nativeExecutionKey(ref: ExecutionWait): string {
  if (![ref.world, ref.kind, ref.id].every(identity)) throw new TypeError('Invalid native execution identity');
  // Tuple encoding keeps colons in world names/IDs from aliasing another task.
  return JSON.stringify([ref.world, ref.kind, ref.id]);
}

export function matchesExecutionWait(wait: ExecutionWait, observation: Pick<ExecutionObservation, 'world' | 'execution'>): boolean {
  return observation.execution.terminal === true && observation.world === wait.world
    && observation.execution.kind === wait.kind && observation.execution.id === wait.id;
}

/** Choose a unique unfinished native execution from this host lifetime. Terminal
 * dominates admission even if the asynchronous callback preceded the RPC return.
 * Multiple pending actions remain ambiguous; unknown effect never authorizes retry.
 * Hosts supply trusted native observations and an explicit lifetime boundary.
 */
export function selectExecutionWait(observations: readonly ExecutionObservation[], options: {
  world: string; after: number; settled?: readonly ExecutionWait[];
}) {
  if (!identity(options.world) || !Number.isFinite(options.after)) throw new TypeError('Invalid wait scope');
  const pending = new Map<string, ExecutionWait>();
  const settled = new Set((options.settled ?? []).map(nativeExecutionKey));
  const current = observations.filter(o => o.world === options.world && Number.isFinite(o.at) && o.at >= options.after);
  for (const o of current) {
    const ref = { world: o.world, kind: o.execution.kind, id: o.execution.id }, key = nativeExecutionKey(ref);
    if (o.execution.terminal === true) settled.add(key);
    else if (o.execution.terminal === false) pending.set(key, ref);
  }
  const candidates = [...pending].filter(([key]) => !settled.has(key)).map(([, ref]) => ref);
  return { schema: WORK_EVIDENCE_SCHEMA, source: 'caller-supplied' as const,
    disposition: candidates.length === 1 ? 'unique' as const : candidates.length ? 'ambiguous' as const : 'none' as const,
    wait: candidates.length === 1 ? candidates[0] : null, candidates,
    mutated: false as const, goalCompleted: false as const };
}
