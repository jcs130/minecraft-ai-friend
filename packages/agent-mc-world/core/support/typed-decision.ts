export interface TypedChoice<Key extends string> {
  choice: Key;
  /** Confidence reported by the service, which may be normalised above chance. */
  confidence: number;
  choiceProbability: number;
  probabilities: Record<Key, number>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Accepts top-probability and above-chance confidence conventions; callers threshold choiceProbability. */
export function parseTypedChoice<Key extends string>(value: unknown, keys: readonly Key[]): TypedChoice<Key> | null {
  const answer = record(value);
  const values = record(answer?.probabilities);
  if (!answer || !values || (answer.type !== undefined && answer.type !== 'choice')
    || typeof answer.choice !== 'string' || !keys.includes(answer.choice as Key)
    || !probability(answer.confidence) || Object.keys(values).length !== keys.length
    || !keys.every(key => Object.hasOwn(values, key) && probability(values[key]))) return null;
  const probabilities = Object.fromEntries(keys.map(key => [key, values[key]])) as Record<Key, number>;
  if (Math.abs(keys.reduce((sum, key) => sum + probabilities[key], 0) - 1) > 0.02) return null;
  const choice = answer.choice as Key;
  const choiceProbability = probabilities[choice];
  if (Math.max(...Object.values<number>(probabilities)) - choiceProbability > 0.000001) return null;
  const aboveChance = keys.length === 1 ? 1 : Math.max(0, (choiceProbability - 1 / keys.length) / (1 - 1 / keys.length));
  if (Math.min(Math.abs(answer.confidence - choiceProbability), Math.abs(answer.confidence - aboveChance)) > 0.01) return null;
  return { choice, confidence: answer.confidence, choiceProbability, probabilities };
}
