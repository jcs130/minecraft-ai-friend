import { estimateTokens, truncateToTokens } from './tokens.ts';
import type { HarnessEvent, Intent, Summary } from './types.ts';

export const SUMMARY_DEFAULT_TOKENS = 300;
export const SUMMARY_MIN_TOKENS = 80;
export const SUMMARY_MAX_TOKENS = 800;

export interface SummaryInput {
  topic?: string;
  maxTokens?: number;
  now: Date;
  executor: 'running' | 'idle' | 'paused' | 'no-body';
  active: Intent | null;
  queued: Intent[];
  paused: Intent[];
  events: HarnessEvent[];
  /** Compact memory lines (current facts), most relevant first. */
  facts: string[];
  /** One-line body status (kind, lifecycle, safety halt). */
  body?: string | null;
}

const pri = (p: number) => (p >= 90 ? '紧急' : p >= 70 ? '高' : p >= 40 ? '中' : '低');
const intentLine = (i: Intent) => {
  const step = i.plan ? ` 步骤${Math.min(i.stepIndex, i.plan.length)}/${i.plan.length}` : '';
  return `${i.goal}（${pri(i.priority)}${step}${i.reason ? `；${i.reason}` : ''}）`;
};

/**
 * Hot-layer summary for the host. Sections are added in priority order and each line only if it still fits,
 * so the result never exceeds the budget (estimated tokens).
 */
export function buildSummary(input: SummaryInput): Summary {
  const budget = Math.max(SUMMARY_MIN_TOKENS, Math.min(SUMMARY_MAX_TOKENS, Math.floor(input.maxTokens ?? SUMMARY_DEFAULT_TOKENS)));
  const lines: string[] = [];
  let truncated = false;
  const used = () => estimateTokens(lines.join('\n'));
  const add = (line: string, required = false) => {
    const room = budget - used() - (lines.length ? 1 : 0);
    if (estimateTokens(line) <= room) { lines.push(line); return true; }
    truncated = true;
    if (required && room > 8) lines.push(truncateToTokens(line, room));
    return false;
  };
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    if (!add(title)) return;
    for (const item of items) if (!add(`- ${item}`)) break;
  };

  add(`【游戏状态摘要】${input.now.toISOString().slice(0, 16)}Z｜执行器：${{ running: '执行中', idle: '空闲', paused: '已暂停', 'no-body': '未连接身体' }[input.executor]}${input.topic ? `｜话题：${input.topic}` : ''}`, true);
  add(input.active ? `当前意图：${intentLine(input.active)}` : '当前意图：无', true);
  if (input.body) add(input.body);
  section('最近关键事件：', input.events.slice().reverse().map(e => `${e.at.slice(11, 16)} ${e.text}`));
  section(input.topic ? '相关记忆：' : '记忆要点：', input.facts);
  section('待办：', [...input.paused.map(i => `[暂停] ${intentLine(i)}`), ...input.queued.map(intentLine)]);

  const text = lines.join('\n');
  return { text, tokens: estimateTokens(text), budget, truncated, generatedAt: input.now.toISOString() };
}
