/** Request-only decision evidence. This module never writes memory, chooses an
 * activity or interprets a returned tool receipt as a completed objective. */
export interface DecisionEvidenceItem {
  id: string;
  kind: 'intent' | 'report' | 'fact' | 'call' | 'event';
  source: string;
  observedAt: string | null;
  text: string;
  /** A host-owned read route to the original, not an instruction to replay it. */
  read?: Readonly<Record<string, unknown>>;
}

export function projectDecisionEvidence(items: readonly DecisionEvidenceItem[], options: {
  maxChars?: number; maxItemChars?: number;
} = {}) {
  const maxChars = Math.max(1024, Math.min(96000, options.maxChars ?? 24000));
  const maxItemChars = Math.max(256, Math.min(maxChars, options.maxItemChars ?? 4000));
  const included: Array<DecisionEvidenceItem & { originalChars: number; truncated: boolean }> = [];
  const omitted: Array<Omit<DecisionEvidenceItem, 'text'> & { originalChars: number }> = [];
  let omittedCount = 0;
  const omit = (item:DecisionEvidenceItem) => {
    omittedCount++;
    if(omitted.length<64){const {text,...reference}=item;omitted.push({...reference,originalChars:text.length});}
  };
  let chars = 0;
  // Callers order by decision relevance; no model-generated summary substitutes
  // for the original text. Excerpts preserve both the beginning and the outcome.
  for (const item of items) {
    const limit = Math.min(maxItemChars, Math.max(0, maxChars - chars - 512));
    if (limit < 256) {
      omit(item); continue;
    }
    const truncated = item.text.length > limit;
    const marker = '\n[节选：中段省略；按 read 读取原件，不能据此推断遗漏内容]\n';
    const text = truncated ? item.text.slice(0, Math.floor((limit - marker.length) / 2)) + marker
      + item.text.slice(-Math.ceil((limit - marker.length) / 2)) : item.text;
    const projected = { ...item, text, originalChars: item.text.length, truncated };
    const size = JSON.stringify(projected).length;
    if (chars + size > maxChars) {
      omit(item); continue;
    }
    included.push(projected); chars += size;
  }
  return { protocol: 'decision-evidence/v1' as const, items: included, omitted, omittedCount,
    omittedIndexComplete:omittedCount===omitted.length,
    evidenceChars: chars, maxChars, complete: omittedCount === 0 && included.every(item => !item.truncated) };
}
