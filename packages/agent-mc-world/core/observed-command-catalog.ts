export interface ObservedCommandUsage {
  id: string;
  usage: string;
  observedAt: number;
}

export interface CommandRouteMismatch extends ObservedCommandUsage {
  suggestedCommand: string;
}

const plainToken = /^[^\s\u0000-\u001f\u007f<>\[\]{}|]+$/u;
const safeLine = (value: string) => value.length <= 1_024 && !/[\u0000-\u001f\u007f]/u.test(value);

function literalPrefix(usage: string): string[] {
  const tokens = usage.trim().split(/\s+/u), result: string[] = [];
  for (const token of tokens) {
    if (!plainToken.test(token)) break;
    result.push(token);
  }
  return result;
}

const beginsWith = (value: readonly string[], prefix: readonly string[]) =>
  prefix.length <= value.length && prefix.every((part, i) => value[i] === part);

/** Bounded, connection-local command evidence supplied by an explicit server
 * adapter. Does not parse chat, infer capabilities, execute or rewrite commands.
 * Only proves that an extra tool-owned command prefix contradicts observed use.
 */
export class ObservedCommandCatalog {
  private readonly entries = new Map<string, ObservedCommandUsage>();
  constructor(private readonly maxAgeMs = 15 * 60_000, private readonly capacity = 128) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || !Number.isInteger(capacity) || capacity < 1)
      throw new RangeError('Command evidence needs a positive age and capacity');
  }

  clear(): void { this.entries.clear(); }

  note(value: ObservedCommandUsage): boolean {
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 128 || !safeLine(value.id)
      || typeof value.usage !== 'string' || !safeLine(value.usage) || !value.usage.startsWith('/')
      || !Number.isFinite(value.observedAt) || literalPrefix(value.usage).length < 2) return false;
    const previous = this.entries.get(value.id);
    if (previous && previous.observedAt > value.observedAt) return false;
    this.entries.delete(value.id);
    this.entries.set(value.id, { ...value });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
    return true;
  }

  /** For e.g. toolPrefix='/root cast', compare the attempted '/root cast x y'
   * with explicitly observed '/root x y <value>'. Unknown commands pass through.
   * A known matching cast usage takes precedence over an alternate namespace.
   */
  misplacedPrefix(command: string, toolPrefix: string, now = Date.now()): CommandRouteMismatch | null {
    if (!safeLine(command) || !safeLine(toolPrefix)) return null;
    const input = command.trim().split(/\s+/u), prefix = toolPrefix.trim().split(/\s+/u);
    if (prefix.length < 2 || !input.every(t => plainToken.test(t))
      || !prefix.every(t => plainToken.test(t)) || !beginsWith(input, prefix) || input.length <= prefix.length) return null;
    const fresh = [...this.entries.values()].filter(e => now >= e.observedAt && now - e.observedAt <= this.maxAgeMs);
    if (fresh.some(e => beginsWith(input, literalPrefix(e.usage)))) return null;
    // Remove only the wrapper-owned suffix. Preserve every caller token.
    const proposed = [prefix[0], ...input.slice(prefix.length)];
    const matches = fresh.filter(e => {
      const literal = literalPrefix(e.usage);
      return literal.length >= 2 && !beginsWith(literal, prefix) && beginsWith(proposed, literal);
    }).sort((a, b) => literalPrefix(b.usage).length - literalPrefix(a.usage).length);
    if (!matches.length) return null;
    const match = matches[0];
    return { ...match, suggestedCommand: proposed.join(' ') };
  }
}
