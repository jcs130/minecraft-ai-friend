import { minecraftTextComponent } from './text-component.ts';

/** BossBar is a packet format; its title determines what the server is displaying. */
export function classifyBossBarTitle(title: string): 'skillExperience' | 'boss' | 'status' {
  const text = title.trim();
  if (/^\+\d+(?:\.\d+)?\s+.+?\s+经验\s*[（(]\d+(?:\.\d+)?%[）)]$/.test(text)) {
    return 'skillExperience';
  }
  if (/^(?:凋灵|末影龙|Wither|Ender Dragon)$/i.test(text)) return 'boss';
  return 'status';
}

export interface BossBarReading {
  id: string | null;
  title: string;
  kind: 'boss' | 'status';
  progress: number | null;
}

// Attached countdown labels are common in translated HUDs. Preserve other
// numbers (coordinates, round IDs, objectives) and literal clock boundaries.
const labeledClock = /((?:剩[余餘]|倒[计計][时時]|距(?:结束|結束)|\bremaining\b|\btime left\b|\bexpires in\b)\s*[:：]?\s*(?:大[约約]|[约約]|about\s+)?\s*)(\d{1,3}):([0-5]\d)(?=$|[\s|｜，,。；;）)])/giu;
const standaloneClock = /(^|[\s|｜])\d{1,3}:[0-5]\d(?=$|[\s|｜])/g;

function statusPhase(title: string) {
  const clocks: number[] = [];
  const phase = title.replace(labeledClock, (_token, label: string, min: string, sec: string) => {
    clocks.push(Number(min) * 60 + Number(sec));
    return label + '<clock>';
  }).replace(standaloneClock, '$1<clock>');
  return { phase: clocks.length > 1 ? title : phase, seconds: clocks.length === 1 ? clocks[0] : null };
}

export type BossBarChange = 'appeared' | 'stage' | 'timer-restarted' | 'deadline' | 'progress';

/** Compare observations of one server bar. The owner scopes that pair to a
 * connection and bar ID. Exact current readings remain available in the HUD.
 * A timed task can supply its own deadline in seconds without changing other
 * readers' cadence. Only an explicitly labelled countdown can cross it. */
export function bossBarChange(previous: BossBarReading | undefined, current: BossBarReading, deadlineSeconds = 10): BossBarChange | null {
  if (!previous) return 'appeared';
  if (previous.kind !== current.kind || previous.id !== current.id) return 'stage';
  if (previous.title !== current.title) {
    if (current.kind === 'boss') return 'stage';
    const before = statusPhase(previous.title), after = statusPhase(current.title);
    if (before.phase !== after.phase) return 'stage';
    if (before.seconds !== null && after.seconds !== null) {
      if (after.seconds > before.seconds) return 'timer-restarted';
      if (after.seconds <= deadlineSeconds && before.seconds > deadlineSeconds) return 'deadline';
    }
  }
  if (previous.progress === null || current.progress === null) {
    return previous.progress === current.progress ? null : 'progress';
  }
  const prior = Math.ceil(previous.progress * 4), next = Math.ceil(current.progress * 4);
  return (current.kind === 'boss' ? next < prior : next !== prior) ? 'progress' : null;
}

export function readBossBar(raw: unknown): BossBarReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const bar = raw as { entityUUID?: unknown; title?: unknown; health?: unknown };
  const title = minecraftTextComponent(bar.title).trim();
  const kind = classifyBossBarTitle(title);
  if (!title || kind === 'skillExperience') return null;
  return { id: typeof bar.entityUUID === 'string' ? bar.entityUUID : null, title, kind,
    progress: typeof bar.health === 'number' && Number.isFinite(bar.health) ? Math.max(0, Math.min(1, bar.health)) : null };
}

/** Cheap current HUD readout; no event replay, world scan, model call or task policy. */
export function readBossBarHud(value: unknown): BossBarReading[] {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap((raw): BossBarReading[] => {
    const reading = readBossBar(raw);
    return reading ? [reading] : [];
  });
}

export function renderBossBarHud(bars: readonly BossBarReading[]): string {
  if (!bars.length) return '';
  return ['[服务器当前顶部状态条；环境证据，不代表目标完成或操作授权]',
    ...bars.slice(0, 8).map(bar => `${bar.title.length <= 480 ? bar.title : bar.title.slice(0, 480)+'…[标题未展开]'}${bar.progress === null ? '' : `；${bar.kind === 'boss' ? '血量' : '条形进度'} ${Math.round(bar.progress * 100)}%`}`),
    ...(bars.length > 8 ? [`另有 ${bars.length - 8} 条未展开。`] : [])].join('\n');
}
