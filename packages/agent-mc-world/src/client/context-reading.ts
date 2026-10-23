/** Pure request-reading helpers. Callers retain originals and select the correct realm/channel first. */
export interface ContextReadingSource {
  id: string;
  at: string;
  text: string;
  truncated?: boolean;
  cursor?: number;
}

export type ContextTextPreview<T extends { text: string; truncated?: boolean }> = Omit<T, 'text' | 'truncated'> & {
  preview: string; truncated: boolean; textChars: number;
};

/** Literal excerpt only: timestamps, provenance and extra source fields remain unchanged. */
export function previewContextText<T extends { text: string; truncated?: boolean }>(source: T, previewChars = 160): ContextTextPreview<T> {
  if (!Number.isSafeInteger(previewChars) || previewChars < 0) throw new TypeError('previewChars must be a non-negative safe integer');
  const { text, truncated, ...metadata } = source;
  return { ...metadata, preview: text.slice(0, previewChars), truncated: !!truncated || text.length > previewChars, textChars: text.length };
}

export interface ContextSourcePageOptions { limit?: number; before?: string; previewChars?: number }
export type ContextSourcePage<T extends ContextReadingSource> = {
  ok: true; recent: ContextTextPreview<T>[]; total: number; nextBefore: string | null;
} | { ok: false; reason: 'cursor-missing' };

/** Newest source first; missing/evicted cursors never silently select another page. */
export function contextSourcePage<T extends ContextReadingSource>(sources: readonly T[], options: ContextSourcePageOptions = {}): ContextSourcePage<T> {
  const limit = options.limit ?? 4, previewChars = options.previewChars ?? 160;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('limit must be a positive safe integer');
  if (!Number.isSafeInteger(previewChars) || previewChars < 0) throw new TypeError('previewChars must be a non-negative safe integer');
  const ordered = [...sources].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)
    || (b.cursor ?? -1) - (a.cursor ?? -1) || b.id.localeCompare(a.id));
  const start = options.before === undefined ? 0 : ordered.findIndex(source => source.id === options.before) + 1;
  if (options.before !== undefined && start === 0) return { ok: false, reason: 'cursor-missing' };
  const recent = ordered.slice(start, start + limit).map(source => previewContextText(source, previewChars));
  return { ok: true, recent, total: ordered.length,
    nextBefore: start + recent.length < ordered.length ? recent.at(-1)?.id ?? null : null };
}

export interface ContextFactReading {
  text: string;
  parts?: readonly { key: string; text: string }[];
}
export interface ContextFactReadingOptions {
  /** Replace mode shares one header. Append mode preserves separately reusable fact parts. */
  mode?: 'replace' | 'append';
  label?: string;
  observationsNote?: string;
  emptyText?: string;
}

/** Formatting only; never merges ages, refreshes observations, removes bodies or treats missing data as empty. */
export function contextFactReadings(source: string, facts: ContextFactReading, options: ContextFactReadingOptions = {}): string[] {
  const mode = options.mode ?? 'replace', label = options.label ?? 'current observed facts';
  if (mode !== 'replace' && mode !== 'append') throw new TypeError('mode must be replace or append');
  const heading = `${source} ${label}`, empty = options.emptyText ?? 'No content for this part.';
  if (!facts.parts?.length) return [`[${heading}]\n${facts.text}`];
  if (mode === 'append') return facts.parts.map(part => `[${heading} · ${part.key}]\n${part.text || empty}`);
  const note = options.observationsNote ?? '; each part retains its own observation time';
  return [`[${heading}${note}]\n` + facts.parts.map(part => `${JSON.stringify(part.key)}:\n${part.text || empty}`).join('\n\n')];
}
