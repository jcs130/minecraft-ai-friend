/** Lossless request view for native receipts that repeat their entire text in
 * execution evidence. The original durable receipt is never changed. */
export function receiptTextView(original: string): string {
  let value: any; try { value = JSON.parse(original); } catch { return original; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string'
    || value.text.length < 400 || Object.hasOwn(value, 'requestTextReferences')) return original;
  const refs: Record<string,string> = {};
  const evidence = value.execution?.evidence;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence) && evidence.receipt === value.text) {
    delete evidence.receipt; refs['/execution/evidence/receipt'] = '/text';
  }
  if (!Object.keys(refs).length) return original;
  value.requestTextReferences = {protocol:'agent-mc/receipt-text-references/v1', pointers:refs,
    meaning:'Only byte-identical repeated text is referenced. Native status, effects, failures and the full text above are unchanged. This view is not a new receipt.'};
  const view = JSON.stringify(value);
  return view.length < original.length ? view : original;
}
