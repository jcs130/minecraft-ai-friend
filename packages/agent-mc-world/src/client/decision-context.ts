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
  maxChars?: number; maxItemChars?: number; offset?: number;
  /** Host metadata is counted too; it must not shadow the projection fields. */
  envelope?: Readonly<Record<string, unknown>>;
} = {}) {
  const maxChars = Math.max(1024, Math.min(96000, Math.floor(options.maxChars ?? 24000)));
  const maxItemChars = Math.max(256, Math.min(maxChars, Math.floor(options.maxItemChars ?? 4000)));
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(maxChars) || !Number.isSafeInteger(maxItemChars)
    || !Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Invalid evidence budget/page');
  const included: Array<DecisionEvidenceItem & { index: number; originalChars: number; truncated: boolean }> = [];
  const omitted: Array<Partial<Omit<DecisionEvidenceItem, 'text'>> & {
    index: number; originalChars: number; metadataTruncated?: boolean;
  }> = [];
  const result = { ...options.envelope, protocol: 'decision-evidence/v1' as const,
    items: included, omitted, offset, totalItems: items.length,
    omittedCount: Math.max(0, items.length - offset), omittedIndexComplete: false,
    nextOffset: null as number | null, evidenceChars: maxChars, maxChars, complete: false };
  for (const key of Object.keys(options.envelope ?? {})) {
    if (['protocol', 'items', 'omitted', 'offset', 'totalItems', 'omittedCount', 'omittedIndexComplete',
      'nextOffset', 'evidenceChars', 'maxChars', 'complete'].includes(key)) throw new Error('Reserved evidence field: ' + key);
  }
  const size = () => JSON.stringify(result).length;
  if (size() > maxChars - 64) throw new RangeError('Evidence envelope exceeds budget');
  const marker = '\n[节选：中段省略；按 read 读取原件，不能据此推断遗漏内容]\n';
  const excerpt = (text: string, limit: number) => text.length <= limit ? text
    : text.slice(0, Math.floor((limit - marker.length) / 2)) + marker
      + text.slice(-Math.ceil((limit - marker.length) / 2));
  // Count the actual serialized object, including escaping, read routes and host
  // metadata. Reserve room for at least a compact omission/index recovery route.
  const reserve = Math.min(512, Math.floor((maxChars - size()) / 4));
  let index = Math.min(offset, items.length);
  for (; index < items.length; index++) {
    const item = items[index];
    const projected = { ...item, index, text: '', originalChars: item.text.length, truncated: true };
    let low = Math.min(256, item.text.length), high = Math.min(maxItemChars, item.text.length), best = -1;
    included.push(projected);
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      projected.text = excerpt(item.text, mid); projected.truncated = item.text.length > mid;
      if (size() <= maxChars - reserve) { best = mid; low = mid + 1; } else high = mid - 1;
    }
    if (best < 0) { included.pop(); break; }
    projected.text = excerpt(item.text, best); projected.truncated = item.text.length > best;
  }
  result.omittedCount = items.length - index;
  // A bounded reference page replaces the old unbudgeted 64-entry side channel.
  // Numeric indices let hosts recover even an individually oversized reference.
  for (; index < items.length && omitted.length < 64; index++) {
    const { text, ...reference } = items[index];
    const entry: typeof omitted[number] = { ...reference, index, originalChars: text.length };
    omitted.push(entry); result.nextOffset = index + 1 < items.length ? index + 1 : null;
    if (size() > maxChars) {
      omitted[omitted.length - 1] = { index, originalChars: text.length, metadataTruncated: true };
      if (size() > maxChars) { omitted.pop(); break; }
    }
  }
  if (index === offset && offset < items.length) {
    throw new RangeError('Evidence envelope leaves no room for an original reference');
  }
  result.nextOffset = index < items.length ? index : null;
  result.omittedIndexComplete = result.omittedCount === omitted.length;
  result.complete = offset === 0 && result.omittedCount === 0 && included.every(item => !item.truncated);
  // Fixed point: the count itself participates in the serialized size.
  for (let i = 0; i < 4; i++) { const chars = size(); if (chars === result.evidenceChars) break; result.evidenceChars = chars; }
  return result;
}
