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

/** Countdown ticks update the live HUD, not the language-model event history.
 * Keep stage names, coordinates and objective counts intact; only standalone
 * clock tokens are normalized when comparing successive status-bar titles. */
export function bossBarStageTitle(title: string): string {
  return title.replace(/(^|[\s|｜])\d{1,3}:[0-5]\d(?=$|[\s|｜])/g, '$1<clock>');
}

export interface BossBarReading {
  id: string | null;
  title: string;
  kind: 'boss' | 'status';
  progress: number | null;
}

/** Cheap current HUD readout; no event replay, world scan, model call or task policy. */
export function readBossBarHud(value: unknown): BossBarReading[] {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap((raw): BossBarReading[] => {
    if (!raw || typeof raw !== 'object') return [];
    const bar = raw as { entityUUID?: unknown; title?: unknown; health?: unknown };
    const title = minecraftTextComponent(bar.title).trim();
    const kind = classifyBossBarTitle(title);
    if (!title || kind === 'skillExperience') return [];
    return [{ id: typeof bar.entityUUID === 'string' ? bar.entityUUID : null, title, kind,
      progress: typeof bar.health === 'number' && Number.isFinite(bar.health) ? Math.max(0, Math.min(1, bar.health)) : null }];
  });
}

export function renderBossBarHud(bars: readonly BossBarReading[]): string {
  if (!bars.length) return '';
  return ['[服务器当前顶部状态条；环境证据，不代表目标完成或操作授权]',
    ...bars.slice(0, 8).map(bar => `${bar.title.length <= 480 ? bar.title : bar.title.slice(0, 480)+'…[标题未展开]'}${bar.progress === null ? '' : `；${bar.kind === 'boss' ? '血量' : '条形进度'} ${Math.round(bar.progress * 100)}%`}`),
    ...(bars.length > 8 ? [`另有 ${bars.length - 8} 条未展开。`] : [])].join('\n');
}
