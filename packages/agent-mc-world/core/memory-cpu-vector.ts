/** Small, deterministic CPU token vectors. This is lexical similarity, not a neural embedding model. */
export const CPU_MEMORY_VECTOR_VERSION = 'cpu-token-vector/v1';
type Vector = Map<string, number>;
export function cpuMemoryVector(text: string): Vector {
  const counts: Vector = new Map();
  const add = (key: string, weight = 1) => counts.set(key, (counts.get(key) ?? 0) + weight);
  // The notebook already caps content. Keep independent callers bounded too.
  const normalized = text.slice(0, 6400).normalize('NFKC').toLowerCase();
  for (const word of normalized.match(/[\p{L}\p{N}_]+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(word)) {
      const chars = Array.from(word);
      for (let i = 0; i < chars.length; i++) {
        add('c:' + chars[i], .3);
        if (i + 1 < chars.length) add('b:' + chars.slice(i, i + 2).join(''));
        if (i + 2 < chars.length) add('t:' + chars.slice(i, i + 3).join(''), .5);
      }
    } else add('w:' + word, 2);
  }
  for (const [key, count] of counts) counts.set(key, Math.log1p(count));
  const norm = Math.hypot(...counts.values());
  if (norm) for (const [key, value] of counts) counts.set(key, value / norm);
  return counts;
}
export function cpuMemorySimilarity(a: Vector, b: Vector): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [key, value] of small) dot += value * (large.get(key) ?? 0);
  return dot;
}
