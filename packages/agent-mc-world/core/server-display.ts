/** Generic readout of vanilla-visible custom server display (scoreboard, teams, bars, chat). */

import { readBossBarHud, renderBossBarHud, type BossBarReading } from './boss-bar.ts';
import { itemCustomName, itemLoreText } from './item-display.ts';
import { minecraftTextComponent } from './nbt-text.mjs';

const TEAM_COLORS = [
  'black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold', 'gray',
  'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white',
] as const;

export type ScoreRow = {
  name: string; displayName: string; value: number;
  /** Visible line text when the entry is a placeholder whose text comes from its team prefix/suffix. */
  line?: string;
  /** Right-hand text: fixed number format (26.1 styling), '' when the score is hidden (blank format). */
  right?: string | null;
};
/** One sidebar row as a player reads it. */
export function scoreRowText(row: ScoreRow): string {
  const left = row.line || row.displayName || row.name;
  const right = row.right === undefined || row.right === null ? String(row.value) : row.right;
  return right ? `${left} ${right}` : left;
}
export type ScoreboardSlot = {
  slot: string;
  objective: string;
  title: string;
  rows: ScoreRow[];
};
export type TeamReading = {
  name: string;
  displayName: string;
  prefix: string;
  suffix: string;
  members: string[];
};
export type LabeledStat = {
  label: string;
  value: string;
  source: 'system-chat' | 'item-lore' | 'action-bar';
  text: string;
  at: number;
};
export type ExperienceReading = { level: number; progress: number | null; total: number | null };
export type ServerDisplaySnapshot = {
  scoreboards: ScoreboardSlot[];
  teams: TeamReading[];
  selfTeam: TeamReading | null;
  bossBars: BossBarReading[];
  actionBar: { text: string; at: number } | null;
  tabHeader: string;
  tabFooter: string;
  experience: ExperienceReading | null;
  pluginChannels: string[];
  stats: LabeledStat[];
};

type PacketClient = {
  on(event: string, handler: (packet: any) => void): void;
  off(event: string, handler: (packet: any) => void): void;
  prependListener?(event: string, handler: (packet: any) => void): void;
};

type DisplayBot = {
  _client?: PacketClient | any;
  username?: string;
  scoreboards?: Record<string, any>;
  scoreboard?: Record<string | number, any>;
  teams?: Record<string, any>;
  teamMap?: Record<string, any>;
  bossBars?: unknown;
  experience?: { level?: number; progress?: number; points?: number };
  inventory?: { items?: () => unknown[]; slots?: unknown[] };
  currentWindow?: { slots?: unknown[]; title?: unknown } | null;
  serverDisplay?: Pick<ServerDisplayHandle, 'snapshot'> | ServerDisplayHandle;
};

export type ServerDisplayHandle = {
  snapshot(): ServerDisplaySnapshot;
  stop(): void;
};

function textOf(value: unknown, limit = 160): string {
  return minecraftTextComponent(value).replace(/§[0-9a-fk-orx]/gi, '').trim().slice(0, limit);
}

function asJsonComponent(value: unknown): string | unknown {
  if (value == null || typeof value === 'string') return value;
  const text = textOf(value, 500);
  return JSON.stringify({ text });
}

export function displaySlotName(position: unknown): string {
  if (typeof position === 'string' && position) return position;
  const n = typeof position === 'number' && Number.isInteger(position) ? position : Number(position);
  if (n === 0) return 'list';
  if (n === 1) return 'sidebar';
  if (n === 2) return 'belowName';
  if (n >= 3 && n <= 18) return `sidebar.team.${TEAM_COLORS[n - 3]}`;
  return Number.isFinite(n) ? `slot-${n}` : 'unknown';
}

const CHAT_STAT_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: '游戏币', re: /^你拥有的游戏币为:\s*\$?\s*(-?\d+)/ },
  { label: '游戏币', re: /^余额[:：]\s*\$?\s*(-?\d+)/ },
  { label: '点券', re: /^(?:\[系统\]\s*)?您有\s*(-?\d+)\s*多个点[劵券]/ },
];

export function statsFromChatText(text: string, at = Date.now()): LabeledStat[] {
  const plain = text.replace(/§[0-9a-fk-orx]/gi, '').trim();
  const out: LabeledStat[] = [];
  const seen = new Set<string>();
  for (const rule of CHAT_STAT_PATTERNS) {
    const match = plain.match(rule.re);
    if (!match || seen.has(rule.label)) continue;
    seen.add(rule.label);
    out.push({ label: rule.label, value: match[1], source: 'system-chat', text: plain.slice(0, 200), at });
  }
  return out;
}

export function statsFromLoreLines(lines: readonly string[], sourceText = '', at = Date.now()): LabeledStat[] {
  const out: LabeledStat[] = [];
  for (const line of lines) {
    const plain = line.replace(/§[0-9a-fk-orx]/gi, '').trim();
    const stat = /^(?:[▪◆●○•✦★☆]\s*)?(.+?)\s*[»›→]\s*(.*)$/.exec(plain);
    if (stat) {
      // Help/menu navigation is not a numeric/server attribute. Preserve it in lore, not HUD.
      if(stat[2].trim().startsWith('/'))continue;
      out.push({
        label: stat[1].replace(/^[▪◆●○•✦★☆]\s*/, '').trim(),
        value: stat[2].trim() || '未知（服务器未提供）',
        source: 'item-lore',
        text: (sourceText ? sourceText + '：' + plain : plain).slice(0, 200),
        at,
      });
      continue;
    }
    const quest = /^(?:[○●])\s*(.+?)\s+(\d+)\s*\/\s*(\d+)\s*$/.exec(plain);
    if (quest) {
      out.push({
        label: quest[1].trim(),
        value: `${quest[2]}/${quest[3]}`,
        source: 'item-lore',
        text: (sourceText ? sourceText + '：' + plain : plain).slice(0, 200),
        at,
      });
    }
  }
  return out;
}

type ObjectiveState = { name: string; title: string; items: Map<string, ScoreRow> };

class ServerDisplayStore {
  readonly objectives = new Map<string, ObjectiveState>();
  readonly slots = new Map<string, string>();
  readonly teams = new Map<string, TeamReading>();
  readonly memberTeam = new Map<string, string>();
  actionBar: { text: string; at: number } | null = null;
  tabHeader = '';
  tabFooter = '';
  experience: ExperienceReading | null = null;
  pluginChannels: string[] = [];
  readonly chatStats = new Map<string, LabeledStat>();
  readonly itemStats = new Map<string, LabeledStat>();
  readonly itemSeenAt = new WeakMap<object, number>();

  upsertObjective(name: string, title?: string): ObjectiveState {
    const current = this.objectives.get(name) ?? { name, title: '', items: new Map() };
    if (title !== undefined) current.title = title;
    this.objectives.set(name, current);
    return current;
  }

  setScore(objective: string, itemName: string, value: number, displayName?: unknown, numberFormat?: unknown, styling?: unknown): void {
    const board = this.upsertObjective(objective);
    const shown = textOf(displayName, 80) || itemName;
    const fmt = numberFormat == null ? null : Number(numberFormat);
    board.items.set(itemName, {
      name: itemName,
      displayName: shown === '[object Object]' ? itemName : shown,
      value: Number.isFinite(value) ? value : 0,
      ...(fmt === 0 ? { right: '' } : fmt === 2 ? { right: textOf(styling, 80) } : {}),
    });
  }

  /** Placeholder entries (formatting codes only) show their team's prefix/suffix as the line. */
  private rowWithLine(row: ScoreRow): ScoreRow {
    const team = this.teams.get(this.memberTeam.get(row.name) ?? '');
    if (!team) return row;
    const own = row.name.replace(/§./g, '').replace(/[\u0000-\u001f\u0080-\u009f§]/g, '');
    const line = `${team.prefix}${own}${team.suffix}`.trim();
    return line ? { ...row, line } : row;
  }

  resetScore(itemName: string, objective?: string | null): void {
    if (objective) this.objectives.get(objective)?.items.delete(itemName);
    else for (const board of this.objectives.values()) board.items.delete(itemName);
  }

  upsertTeam(packet: Record<string, unknown>, mode: string): void {
    const name = String(packet.team ?? '');
    if (!name) return;
    const members = Array.isArray(packet.players) ? packet.players.map(String) : [];
    if (mode === 'remove') {
      const previous = this.teams.get(name);
      for (const member of previous?.members ?? []) this.memberTeam.delete(member);
      this.teams.delete(name);
      return;
    }
    const current = this.teams.get(name) ?? { name, displayName: name, prefix: '', suffix: '', members: [] };
    if (mode === 'add' || mode === 'change') {
      if (packet.name !== undefined) current.displayName = textOf(packet.name, 80) || name;
      if (packet.prefix !== undefined) current.prefix = textOf(packet.prefix, 40);
      if (packet.suffix !== undefined) current.suffix = textOf(packet.suffix, 40);
    }
    if (mode === 'add' || mode === 'join') {
      for (const member of members) {
        current.members = [...new Set([...current.members, member])];
        this.memberTeam.set(member, name);
      }
    }
    if (mode === 'leave') {
      current.members = current.members.filter((member) => !members.includes(member));
      for (const member of members) this.memberTeam.delete(member);
    }
    this.teams.set(name, current);
  }

  noteChat(text: string, at: number): void {
    for (const stat of statsFromChatText(text, at)) this.chatStats.set(stat.label, stat);
  }

  noteItemStats(items: unknown[], at: number): void {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (!this.itemSeenAt.has(item)) this.itemSeenAt.set(item, at);
      const receivedAt = this.itemSeenAt.get(item)!;
      const record = item as { name?: string; lore?: unknown; componentMap?: Map<string, { data?: unknown }>; components?: Array<{ type?: string; data?: unknown }>; nbt?: unknown };
      const custom = itemCustomName(record) ?? '';
      const lines = itemLoreText(record);
      const title = custom || (typeof record.name === 'string' ? record.name : '');
      for (const stat of statsFromLoreLines(lines, title, receivedAt)) {
        this.itemStats.set(stat.label, { ...stat, text: `${title} ${lines[0] ?? ""}：${stat.text}`.trim() });
      }
    }
  }

  snapshot(bot?: DisplayBot): ServerDisplaySnapshot {
    this.noteItemStats([
      ...(bot?.inventory?.items?.() ?? bot?.inventory?.slots ?? []),
      ...(bot?.currentWindow?.slots ?? []),
    ], Date.now());
    const scoreboards: ScoreboardSlot[] = [];
    const used = new Set<string>();
    for (const [slot, objective] of this.slots) {
      const board = this.objectives.get(objective);
      if (!board) continue;
      used.add(objective);
      scoreboards.push({
        slot,
        objective,
        title: board.title,
        rows: [...board.items.values()].sort((a, b) => b.value - a.value || a.displayName.localeCompare(b.displayName, 'zh')).slice(0, 15).map((row) => this.rowWithLine(row)),
      });
    }
    for (const board of this.objectives.values()) {
      if (used.has(board.name)) continue;
      scoreboards.push({
        slot: 'hidden',
        objective: board.name,
        title: board.title,
        rows: [...board.items.values()].sort((a, b) => b.value - a.value || a.displayName.localeCompare(b.displayName, 'zh')).slice(0, 15).map((row) => this.rowWithLine(row)),
      });
    }
    const teams = [...this.teams.values()];
    const selfName = bot?.username;
    const selfTeam = (selfName && this.memberTeam.get(selfName)
      ? this.teams.get(this.memberTeam.get(selfName)!) : null) ?? null;
    const experience = this.experience ?? experienceFromBot(bot);
    const stats = mergeStats(this.chatStats, this.itemStats);
    return {
      scoreboards,
      teams,
      selfTeam,
      bossBars: readBossBarHud(bot?.bossBars),
      actionBar: this.actionBar,
      tabHeader: this.tabHeader,
      tabFooter: this.tabFooter,
      experience,
      pluginChannels: this.pluginChannels,
      stats,
    };
  }
}

function mergeStats(...maps: Array<Map<string, LabeledStat>>): LabeledStat[] {
  const out = new Map<string, LabeledStat>();
  for (const map of maps) {
    for (const [label, stat] of map) {
      const previous = out.get(label);
      if (!previous || stat.at >= previous.at) out.set(label, stat);
    }
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh'));
}

function experienceFromBot(bot?: DisplayBot): ExperienceReading | null {
  const exp = bot?.experience;
  const level = exp?.level;
  if (!exp || typeof level !== 'number' || !Number.isFinite(level)) return null;
  const progress = exp.progress;
  const total = exp.points;
  return {
    level,
    progress: typeof progress === 'number' && Number.isFinite(progress) ? progress : null,
    total: typeof total === 'number' && Number.isFinite(total) ? total : null,
  };
}

function listen(client: PacketClient, event: string, handler: (packet: any) => void, prepend = false): () => void {
  if (prepend && typeof client.prependListener === 'function') client.prependListener(event, handler);
  else client.on(event, handler);
  return () => client.off(event, handler);
}

/** Track 1.20.3+ / 26.1 scoreboard, team and HUD packets that Mineflayer still treats as the old shape. */
export function installServerDisplay(bot: DisplayBot): ServerDisplayHandle {
  const client = bot._client;
  const store = new ServerDisplayStore();
  const stop: Array<() => void> = [];
  if (!client) {
    const handle = { snapshot: () => store.snapshot(bot), stop() {} };
    bot.serverDisplay = handle;
    return handle;
  }

  stop.push(listen(client, 'scoreboard_objective', (packet: Record<string, unknown>) => {
    const name = String(packet.name ?? '');
    const action = packet.action;
    if (!name) return;
    if (action === 1) {
      store.objectives.delete(name);
      for (const [slot, objective] of store.slots) if (objective === name) store.slots.delete(slot);
      return;
    }
    if (action === 0 || action === 2 || action === undefined) {
      store.upsertObjective(name, packet.displayText === undefined ? undefined : textOf(packet.displayText, 80));
    }
    if (packet.displayText !== undefined && typeof packet.displayText !== 'string') {
      packet.displayText = asJsonComponent(packet.displayText);
    }
  }, true));

  stop.push(listen(client, 'scoreboard_score', (packet: Record<string, unknown>) => {
    if (packet.action === 1) {
      store.resetScore(String(packet.itemName ?? ''), typeof packet.scoreName === 'string' ? packet.scoreName : undefined);
      return;
    }
    // 26.1 upserts have no action field; older protocols use action 0.
    if (packet.action === undefined || packet.action === 0) {
      store.setScore(String(packet.scoreName ?? ''), String(packet.itemName ?? ''), Number(packet.value),
        packet.display_name ?? packet.displayName, packet.number_format, packet.styling);
      if (packet.action === undefined) packet.action = 0;
    }
  }, true));

  stop.push(listen(client, 'reset_score', (packet: Record<string, unknown>) => {
    const itemName = String(packet.entity_name ?? packet.itemName ?? '');
    const objective = packet.objective_name ?? packet.scoreName;
    store.resetScore(itemName, typeof objective === 'string' && objective ? objective : null);
    const boards = bot.scoreboards ?? {};
    const target = typeof objective === 'string' ? boards[objective] : undefined;
    if (target?.remove) target.remove(itemName);
    else for (const board of Object.values(boards)) (board as { remove?: (name: string) => void })?.remove?.(itemName);
  }));

  stop.push(listen(client, 'scoreboard_display_objective', (packet: Record<string, unknown>) => {
    const slot = displaySlotName(packet.position);
    const name = String(packet.name ?? '');
    if (!name) store.slots.delete(slot);
    else store.slots.set(slot, name);
  }));

  const onTeam = (packet: Record<string, unknown>) => {
    const mode = typeof packet.mode === 'number'
      ? (['add', 'remove', 'change', 'join', 'leave'][packet.mode] ?? String(packet.mode))
      : String(packet.mode ?? '');
    for (const field of ['name', 'prefix', 'suffix'] as const) {
      if (packet[field] !== undefined && typeof packet[field] !== 'string') packet[field] = asJsonComponent(packet[field]);
    }
    store.upsertTeam(packet, mode);
  };
  stop.push(listen(client, 'teams', onTeam, true));
  stop.push(listen(client, 'scoreboard_team', onTeam, true));

  stop.push(listen(client, 'action_bar', (packet: Record<string, unknown>) => {
    const text = textOf(packet.text ?? packet.message);
    if (text) store.actionBar = { text, at: Date.now() };
  }));

  stop.push(listen(client, 'system_chat', (packet: Record<string, unknown>) => {
    const text = textOf(packet.content ?? packet.message ?? packet.formattedMessage);
    if (!text) return;
    const at = Date.now();
    if (packet.isActionBar === true) store.actionBar = { text, at };
    else store.noteChat(text, at);
  }));

  stop.push(listen(client, 'playerlist_header', (packet: Record<string, unknown>) => {
    store.tabHeader = textOf(packet.header, 240);
    store.tabFooter = textOf(packet.footer, 240);
  }));

  stop.push(listen(client, 'experience', (packet: Record<string, unknown>) => {
    const level = Number(packet.level);
    if (!Number.isFinite(level)) return;
    const progress = Number(packet.experienceBar);
    const total = Number(packet.totalExperience);
    store.experience = {
      level,
      progress: Number.isFinite(progress) ? progress : null,
      total: Number.isFinite(total) ? total : null,
    };
  }));

  stop.push(listen(client, 'custom_payload', (packet: Record<string, unknown>) => {
    const channel = typeof packet.channel === 'string' ? packet.channel : '';
    if (!channel || store.pluginChannels.includes(channel)) return;
    store.pluginChannels = [...store.pluginChannels, channel].slice(0, 32);
  }));

  const handle: ServerDisplayHandle = {
    snapshot: () => store.snapshot(bot),
    stop() { for (const fn of stop) fn(); },
  };
  bot.serverDisplay = handle;
  return handle;
}

function fallbackScoreboards(bot: DisplayBot): ScoreboardSlot[] {
  const slots: ScoreboardSlot[] = [];
  const positions = bot.scoreboard ?? {};
  const names = new Set<string>();
  for (const key of ['list', 'sidebar', 'belowName', ...TEAM_COLORS.map((color) => `sidebar.team.${color}`)]) {
    const board = (positions as Record<string, any>)[key] ?? (positions as Record<number, any>)[key === 'list' ? 0 : key === 'sidebar' ? 1 : key === 'belowName' ? 2 : undefined as never];
    if (!board?.name) continue;
    names.add(String(board.name));
    slots.push({
      slot: key,
      objective: String(board.name),
      title: textOf(board.title, 80),
      rows: (Array.isArray(board.items) ? board.items : []).filter((item: any) => item && !String(item.name ?? '').startsWith('#')).slice(0, 15)
        .map((item: any) => ({
          name: String(item.name ?? ''),
          displayName: textOf(item.displayName ?? item.name, 80) || String(item.name ?? ''),
          value: Number.isFinite(item.value) ? item.value : 0,
        })),
    });
  }
  for (const [name, board] of Object.entries(bot.scoreboards ?? {})) {
    if (names.has(name) || !board) continue;
    slots.push({
      slot: 'hidden',
      objective: name,
      title: textOf(board.title, 80),
      rows: (Array.isArray(board.items) ? board.items : []).slice(0, 15).map((item: any) => ({
        name: String(item.name ?? ''),
        displayName: textOf(item.displayName ?? item.name, 80) || String(item.name ?? ''),
        value: Number.isFinite(item.value) ? item.value : 0,
      })),
    });
  }
  return slots;
}

/** Cheap current display readout; uses the live packet store when installed. */
export function readServerDisplay(bot: DisplayBot | null | undefined): ServerDisplaySnapshot {
  if (bot?.serverDisplay) return bot.serverDisplay.snapshot();
  if (!bot) {
    return {
      scoreboards: [], teams: [], selfTeam: null, bossBars: [], actionBar: null,
      tabHeader: '', tabFooter: '', experience: null, pluginChannels: [], stats: [],
    };
  }
  const teams = Object.values(bot.teams ?? {}).map((team: any) => ({
    name: String(team.team ?? team.name ?? ''),
    displayName: textOf(team.name, 80),
    prefix: textOf(team.prefix, 40),
    suffix: textOf(team.suffix, 40),
    members: Array.isArray(team.members) ? team.members.map(String) : Object.keys(team.membersMap ?? {}),
  }));
  const selfName = bot.username ?? '';
  return {
    scoreboards: fallbackScoreboards(bot),
    teams,
    selfTeam: teams.find((team) => team.members.includes(selfName)) ?? null,
    bossBars: readBossBarHud(bot.bossBars),
    actionBar: null,
    tabHeader: '',
    tabFooter: '',
    experience: experienceFromBot(bot),
    pluginChannels: [],
    stats: statsFromLoreLines([
      ...(bot.inventory?.items?.() ?? []).flatMap((item) => itemLoreText(item as object)),
      ...(bot.currentWindow?.slots ?? []).flatMap((item) => item && typeof item === 'object' ? itemLoreText(item) : []),
    ]),
  };
}

export function renderServerDisplayHud(snapshot: ServerDisplaySnapshot): string {
  const parts: string[] = [];
  const bars = renderBossBarHud(snapshot.bossBars);
  if (bars) parts.push(bars);
  const sidebar = snapshot.scoreboards.find((board) => board.slot === 'sidebar')
    ?? snapshot.scoreboards.find((board) => board.slot !== 'hidden')
    ?? snapshot.scoreboards[0];
  if (sidebar && (sidebar.title || sidebar.rows.length)) {
    parts.push(`[服务器计分板${sidebar.title ? `：${sidebar.title}` : ''}]`);
    for (const row of sidebar.rows) parts.push(scoreRowText(row));
    const extra = snapshot.scoreboards.filter((board) => board !== sidebar && board.slot !== 'hidden');
    if (extra.length) parts.push(`另有 ${extra.length} 个已显示的计分板槽位。`);
  }
  if (snapshot.stats.length) {
    parts.push('[服务器可见数值；仅记录已收到的原文，不是推断]');
    for (const stat of snapshot.stats.slice(0, 16)) parts.push(`${stat.label} ${stat.value}（${stat.source}；记录 ${new Date(stat.at).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false }) + ' Asia/Shanghai'}；${Date.now()-stat.at>300000?'历史读数，待重新查询':'近期读数'}；来源 ${stat.text}）`);
  }
  if (snapshot.selfTeam && (snapshot.selfTeam.prefix || snapshot.selfTeam.displayName)) {
    parts.push(`计分板队伍 ${snapshot.selfTeam.prefix || snapshot.selfTeam.displayName}`.trim());
  }
  if (snapshot.actionBar?.text) parts.push(`动作栏 ${snapshot.actionBar.text}`);
  if (snapshot.tabHeader || snapshot.tabFooter) {
    parts.push(`列表栏 ${[snapshot.tabHeader, snapshot.tabFooter].filter(Boolean).join(' / ')}`);
  }
  if (snapshot.experience && (snapshot.experience.level || snapshot.experience.total)) {
    parts.push(`经验等级 ${snapshot.experience.level}${snapshot.experience.total != null ? `（总计 ${snapshot.experience.total}）` : ''}`);
  }
  if (snapshot.pluginChannels.length) parts.push(`插件通道 ${snapshot.pluginChannels.join('、')}`);
  return parts.join('\n');
}

export function viewerScoreboardState(snapshot: ServerDisplaySnapshot): { title: string; rows: Array<{ name: string; value: number }> } {
  const sidebar = snapshot.scoreboards.find((board) => board.slot === 'sidebar')
    ?? snapshot.scoreboards.find((board) => board.rows.length && board.slot !== 'hidden');
  if (!sidebar) return { title: '', rows: [] };
  return {
    title: sidebar.title.slice(0, 80),
    rows: sidebar.rows.filter((row) => !row.name.startsWith('#')).map((row) => ({
      name: `${row.line || row.displayName || row.name}${row.right ? ` ${row.right}` : ''}`.slice(0, 80),
      value: row.value,
    })),
  };
}

