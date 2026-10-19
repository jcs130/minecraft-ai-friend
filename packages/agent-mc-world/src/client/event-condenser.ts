import type { EventEnvelope } from '../contracts/host.ts';

/**
 * Model-facing event list hygiene. Servers emit login handshakes, machine-readable MC_* JSON, tutorial
 * tips and boss-bar countdowns through chat; the raw journal keeps all of it, the model sees:
 * - drop: pure UI/tutorial noise (counted in one "omitted" note)
 * - once: shown the first time per session (key)
 * - latest: only the newest event per key stays in the window (countdowns, snapshots, status)
 * - rewrite: known MC_* payloads condensed to short facts
 * Unmatched events (player chat, danger, protection, task receipts) pass unchanged.
 */
export type CondenseAction = 'drop' | 'once' | 'latest' | 'keep';
export interface CondenseRule {
  id: string;
  /** Matched against `${type} ${text}`. */
  match: RegExp;
  action: CondenseAction;
  /** Dedupe/supersede key; defaults to the rule id. */
  key?: (event: Pick<EventEnvelope, 'type' | 'text'>, match: RegExpMatchArray) => string;
  /** With 'latest': combine the superseded event's text with the new one (e.g. a running name list). */
  merge?: (previous: string, current: string) => string;
  /** Shorter text for the model. Return null to drop. */
  rewrite?: (text: string) => string | null;
}
export interface EventCondenserOptions {
  /** Rule ids to disable from the defaults. */
  disable?: readonly string[];
  /** Extra rules, checked before the defaults. */
  rules?: readonly CondenseRule[];
  /** Window size kept for the model. Default 24. */
  window?: number;
}

const json = (text: string, code: string): Record<string, any> | null => {
  const at = text.indexOf(code + ' {');
  if (at < 0) return null;
  try { return JSON.parse(text.slice(at + code.length + 1)); } catch { return null; }
};
const join = (...parts: unknown[]) => parts.filter(p => p !== undefined && p !== null && p !== '' && p !== false).join('；');

export const DEFAULT_CONDENSE_RULES: readonly CondenseRule[] = [
  // Login handshake: the client logs in itself; keep only the outcome and failures.
  { id: 'auth-progress', match: /MC_AUTH_(LOGIN|PASSWORD_OK)\]|正在验证登录/, action: 'drop' },
  { id: 'auth-state', match: /MC_AUTH_STATE \{/, action: 'latest', rewrite: text => {
    const j = json(text, 'MC_AUTH_STATE');
    return j ? `[登录状态] ${j.status ?? '未知'}${j.authorized ? '（已授权）' : ''}` : text;
  } },
  { id: 'guide', match: /MC_GUIDE \{/, action: 'once', rewrite: text => {
    const j = json(text, 'MC_GUIDE');
    return j ? `[服务器指南] ${join(j.message, j.helpCommand && `帮助 ${j.helpCommand}`, j.stateCommand && `状态 ${j.stateCommand}`)}` : text;
  } },
  { id: 'status', match: /MC_STATUS \{/, action: 'latest', rewrite: text => {
    const j = json(text, 'MC_STATUS');
    if (!j) return text;
    return `[服务器状态] ${join(j.adventurerRank, j.mana !== undefined && `魔力 ${j.mana}/${j.maxMana}`, j.mainStage && `主线 ${j.mainStage}`,
      j.downed && '倒地', j.inDungeon && '副本中', j.inPvp && 'PVP 中', j.nextCommand && `下一步 ${j.nextCommand}`)}`;
  } },
  { id: 'guide-next', match: /MC_GUIDE_NEXT \{/, action: 'latest', rewrite: text => {
    const j = json(text, 'MC_GUIDE_NEXT');
    return j ? `[服务器引导] ${join(j.title, j.message, j.nextCommand && `下一步 ${j.nextCommand}`)}` : text;
  } },
  // Boss bar / event countdowns: only the newest reading per bar matters.
  { id: 'bossbar', match: /\] (.{1,24}?) \| \d+:\d+ 状态条进度为/, action: 'latest', key: (_e, m) => 'bossbar:' + m[1] },
  { id: 'event-countdown', match: /\[村庄活动\] (\S+) 还有 \d+ 秒结束/, action: 'latest', key: (_e, m) => 'countdown:' + m[1] },
  // Per-session tutorial and UI tips.
  { id: 'tips', match: /槽位\d|【特色道具】|\[照片\]|\[村庄生活季\]|SkinsRestorer|^mymc\.chat \[MC (插件|系统)\] (守护\/恢复|战斗咏唱|探矿术|探索咏唱|Agent 用 \/mycli|附魔台旁|可学习|每项可用|魔力统一|技能分|逐项说明)/, action: 'drop' },
  // "No local notes" for several accounts at login: one running line instead of ~90 chars each.
  { id: 'player-history-none', match: /\[游戏玩家历史\] 账号 (\S+?)；本地未找到/, action: 'latest',
    rewrite: text => `[玩家历史] 无本地关系笔记：${text.match(/账号 (\S+?)；/)?.[1] ?? '?'}（不代表初次见面，可查 mymc_memory）`,
    merge: (previous, current) => {
      const names = (t: string) => t.match(/无本地关系笔记：([^（]*)/)?.[1].split('、') ?? [];
      const all = [...new Set([...names(previous), ...names(current)])];
      return current.replace(/无本地关系笔记：[^（]*/, `无本地关系笔记：${all.join('、')}`);
    } },
  { id: 'player-history', match: /\[游戏玩家历史\] 账号 (\S+?)；/, action: 'once', key: (_e, m) => 'history:' + m[1] },
  // Queue progress notes restate the latest tool receipt; only the newest matters.
  { id: 'task-queue', match: /^mymc\.task\.queue /, action: 'latest' },
  { id: 'world-snapshot', match: /^mymc\.world\.snapshot |出生点读数已更新/, action: 'latest' },
  { id: 'ambient', match: /^\S+ \[Minecraft\] (\S{1,6}边有\S{1,8}的动静|\S{1,8}走远了)。$/, action: 'latest', key: e => 'ambient:' + e.text },
];

export interface CondenserStats { seen: number; dropped: number; deduped: number; superseded: number; rewritten: number }

/** Built-in text rules only summarize known system channels, never a player's words or action evidence. */
function acceptsDefaultRule(event: EventEnvelope): boolean {
  const kind = event.type.slice(event.type.indexOf('.') + 1);
  if (event.execution || kind === 'task' || kind.startsWith('goal')) return false;
  if (kind !== 'chat') return ['event', 'memory', 'task.queue', 'world.snapshot'].includes(kind);
  if (event.senderKey || typeof event.meta?.uname === 'string' || event.meta?.channel === 'private') return false;
  return /^\[MC (?:登录消息|系统|插件)\]/u.test(event.text ?? '');
}

export class EventCondenser {
  private readonly rules: CondenseRule[];
  private readonly window: number;
  private readonly once = new Set<string>();
  private events: EventEnvelope[] = [];
  private keys: (string | null)[] = [];
  readonly stats: CondenserStats = { seen: 0, dropped: 0, deduped: 0, superseded: 0, rewritten: 0 };

  constructor(options: EventCondenserOptions = {}) {
    const off = new Set(options.disable ?? []);
    this.rules = [...(options.rules ?? []), ...DEFAULT_CONDENSE_RULES.filter(rule => !off.has(rule.id))];
    this.window = options.window ?? 24;
  }

  /** Feed new journal events (oldest first). */
  push(events: readonly EventEnvelope[]): void {
    for (const event of events) this.add(event);
  }

  /** Model-facing window, oldest first. Counts of what was hidden are in stats. */
  view(): EventEnvelope[] { return [...this.events]; }

  /**
   * Events newer than `cursor` (what the model already read) plus `tail` older ones for continuity.
   * Hosts that retire earlier snapshots use this so each step carries mostly new events.
   */
  since(cursor: number, tail = 2): EventEnvelope[] {
    const fresh = this.events.filter(e => e.cursor > cursor);
    const old = this.events.filter(e => e.cursor <= cursor).slice(-tail);
    return [...old, ...fresh];
  }

  private add(event: EventEnvelope): void {
    this.stats.seen++;
    const subject = `${event.type} ${event.text ?? ''}`;
    let rule: CondenseRule | undefined, match: RegExpMatchArray | null = null;
    for (const candidate of this.rules) {
      if (DEFAULT_CONDENSE_RULES.includes(candidate) && !acceptsDefaultRule(event)) continue;
      match = subject.match(candidate.match); if (match) { rule = candidate; break; }
    }
    if (!rule || rule.action === 'keep') return this.append(event, null);
    if (rule.action === 'drop') { this.stats.dropped++; return; }
    const key = rule.key ? rule.key(event, match!) : rule.id;
    if (rule.action === 'once') {
      if (this.once.has(key)) { this.stats.deduped++; return; }
      this.once.add(key);
    }
    let text = event.text;
    if (rule.rewrite) {
      const short = rule.rewrite(event.text ?? '');
      if (short === null) { this.stats.dropped++; return; }
      if (short !== text) { text = short; this.stats.rewritten++; }
    }
    if (rule.action === 'latest') {
      const index = this.keys.indexOf(key);
      if (index >= 0) {
        if (rule.merge) text = rule.merge(this.events[index].text ?? '', text ?? '');
        this.events.splice(index, 1); this.keys.splice(index, 1); this.stats.superseded++;
      }
    }
    this.append(text === event.text ? event : { ...event, text }, rule.action === 'latest' ? key : null);
  }

  private append(event: EventEnvelope, key: string | null): void {
    this.events.push(event); this.keys.push(key);
    if (this.events.length > this.window) { this.events.shift(); this.keys.shift(); }
  }
}
