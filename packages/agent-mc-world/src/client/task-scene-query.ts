/** Bounded retrieval text, not a semantic summary or a new instruction.
 * Keep the caller's explicit purpose separate from a long, changing observation.
 * No model, World, spell names or automatic action is selected here. */
export function taskSceneQuery(input: { purpose?: string; directive?: string; query?: string }, maxChars = 200): string {
  if (!Number.isSafeInteger(maxChars) || maxChars < 32 || maxChars > 200) throw new TypeError('query budget must be 32..200 characters');
  const clean = (text?: string) => (text ?? '').replace(/\s+/gu, ' ').trim();
  const excerpt = (text: string, limit: number) => text.length <= limit ? text
    : text.slice(0, Math.ceil((limit - 3) / 2)) + ' … ' + text.slice(-Math.floor((limit - 3) / 2));
  const query = clean(input.query);
  if (query) return excerpt(query, maxChars);
  const purpose = excerpt(clean(input.purpose), Math.min(80, Math.floor(maxChars / 2)));
  const directive = clean(input.directive);
  if (!purpose) return excerpt(directive, maxChars);
  if (!directive || directive === purpose) return purpose;
  return purpose + ' | ' + excerpt(directive, maxChars - purpose.length - 3);
}
