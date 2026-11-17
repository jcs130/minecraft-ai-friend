/**
 * Conservative token estimate without a tokenizer: CJK ≈ 1 token per char, other text ≈ 1 token per 3.5 chars.
 * Over-estimates for English, which is the safe direction for a budget.
 */
export function estimateTokens(text: string): number {
  let cjk = 0, other = 0;
  for (const ch of text) {
    if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/u.test(ch)) cjk++; else other++;
  }
  return cjk + Math.ceil(other / 3.5);
}

/** Cut text so that estimateTokens(result) ≤ budget, adding an ellipsis if cut. */
export function truncateToTokens(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  const chars = [...text];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(chars.slice(0, mid).join('') + '…') <= budget) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? chars.slice(0, lo).join('') + '…' : '';
}
