import { createHash } from 'node:crypto';
import type { CurrentFact, ContextBudget, PreparedContext, ToolSchema, WorldRequestFacts } from './contracts.ts';
import { PROTOCOL } from '../contracts/protocol.ts';
import type { AgentJournal } from './journal.ts';

/** Current facts replace by key. Full originals remain addressable content artifacts. */
export class CurrentFacts {
  private readonly parts = new Map<string, CurrentFact>();
  constructor(private readonly journal: AgentJournal) {}
  replace(facts: WorldRequestFacts | null): CurrentFact[] {
    const fresh = new Map<string, CurrentFact>();
    for (const part of facts?.parts ?? (facts?.text ? [{ key: 'world', text: facts.text }] : [])) {
      const revision = createHash('sha256').update(part.text).digest('hex');
      const previous = this.parts.get(part.key);
      const original = previous?.revision === revision ? previous.original : this.journal.saveBlobs([
        { bytes: Buffer.from(part.text), mime: 'text/plain', fallbackText: `Original current fact: ${part.key}` },
      ])[0].handle;
      fresh.set(part.key, { ...part, revision, original });
    }
    this.parts.clear();
    for (const [key, value] of fresh) this.parts.set(key, value);
    return [...this.parts.values()];
  }
}

/** A host may supply its exact tokenizer. The default deliberately budgets one token per UTF-8 byte. */
export function prepareContext(prefix: string, facts: CurrentFact[], tools: ToolSchema[], budget: ContextBudget,
  history = '', countTokens: (text: string) => number = text => Buffer.byteLength(text), counter = 'utf8-byte-upper-bound'): PreparedContext {
  const { contextTokens, reservedOutputTokens } = budget;
  if (![contextTokens, reservedOutputTokens].every(Number.isSafeInteger) || contextTokens <= 0 || reservedOutputTokens < 0)
    throw new Error('Invalid context budget');
  const count = (text: string) => { const n = countTokens(text); if (!Number.isFinite(n) || n < 0) throw new Error('Invalid token count'); return Math.ceil(n); };
  const usage = { prefix: count(prefix), history: count(history), tools: count(JSON.stringify(tools)), facts: 0,
    reservedOutput: reservedOutputTokens, total: 0, counter };
  usage.total = usage.prefix + usage.history + usage.tools + usage.reservedOutput;
  if (usage.total > contextTokens) throw new Error('Stable prefix, history, tools and reserved output exceed the context window');
  const tail: CurrentFact[] = [], omittedKeys: string[] = [];
  for (const fact of facts) {
    const cost = count(JSON.stringify(fact));
    if (usage.total + cost > contextTokens) { omittedKeys.push(fact.key); continue; }
    tail.push(fact); usage.facts += cost; usage.total += cost;
  }
  return { protocol: PROTOCOL, prefix, tail, omittedKeys, usage };
}
