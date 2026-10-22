import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const RANKS = ['青铜', '黑铁', '白银', '黄金', '白金', '钻石'];
const DIVISIONS = ['III', 'II', 'I'];
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value, max = 160) => typeof value === 'string' ? value.replace(/§[0-9a-fk-or]/gi, '').slice(0, max) : '';
export const playerNameValid = value => typeof value === 'string' && /^\.?[A-Za-z0-9_]{1,16}$/.test(value);

// Mirror the server's readGrade, including the certification cap. Fame alone
// never grants a promotion. This projection does not enroll or migrate a player.
export function publicGrowth(guild, profession, level) {
  const fame = nonnegative(guild?.fame);
  let grade = null;
  if (guild?.joined) {
    if (Number.isInteger(profession?.academy?.grade) && profession.academy.grade >= 0 && profession.academy.grade <= 17) grade = profession.academy.grade;
    else if (fame !== null) {
      const legacy = [0, 10, 30, 70, 150, 350].filter(threshold => fame >= threshold).length - 1;
      const certified = guild?.rituals?.certified;
      grade = Math.min(legacy, Number.isInteger(certified) && certified >= 0 ? certified : legacy) * 3;
    }
  }
  const combat = ['warrior', 'mage', 'priest'].includes(profession?.combat) ? profession.combat : null;
  return { level: nonnegative(level), fame, completed: nonnegative(guild?.completed),
    gradeIndex: grade, rank: grade === null ? null : `${RANKS[Math.floor(grade / 3)]} ${DIVISIONS[grade % 3]}`,
    profession: combat, certificates: profession?.academy?.certificates && typeof profession.academy.certificates === 'object' ? Object.keys(profession.academy.certificates).length : null };
}

// Only exact vanilla lifecycle/advancement messages from the server thread are
// admitted. Player chat, /msg, tool output and authentication JSON never enter
// the public event database, even if they contain event-looking text.
export function parsePublicLog(line, date) {
  const match = /^\[(\d{2}:\d{2}:\d{2})\] \[Server thread\/INFO\]: (.+)$/.exec(line);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const when = Date.parse(`${date}T${match[1]}+08:00`);
  if (!Number.isFinite(when)) return null;
  const message = match[2];
  const lifecycle = /^(\.?[A-Za-z0-9_]{1,16}) (joined|left) the game$/.exec(message);
  if (lifecycle) return { kind: lifecycle[2] === 'joined' ? 'join' : 'leave', playerName: lifecycle[1],
    title: `${lifecycle[1]} ${lifecycle[2] === 'joined' ? '来到' : '离开'}千灯纪`, body: '', occurredAt: when, precision: 'second', source: 'minecraft.lifecycle' };
  const advancement = /^(\.?[A-Za-z0-9_]{1,16}) has (?:made the advancement|completed the challenge|reached the goal) \[([^\r\n]{1,120})\]$/.exec(message);
  return advancement ? { kind: 'advancement', playerName: advancement[1], title: `${advancement[1]} 获得进度「${text(advancement[2], 120)}」`,
    body: '', occurredAt: when, precision: 'second', source: 'minecraft.advancement' } : null;
}

export class WorldCatalog {
  constructor(config, game, store) { this.config = config; this.game = game; this.store = store; }
  async players() {
    return this.game.cached('public-growth', 15000, async () => {
      const [roster, gameplay, professions] = await Promise.all([this.game.roster(), this.game.plugin('config.yml'), this.game.plugin('profession-ledger.json')]);
      const players = [];
      // Bound disk work and share it across all visitors; never scan chunks or
      // issue a game command for each web page. Observers have no growth entry.
      for (let start = 0; start < Math.min(roster.length, 256); start += 8) {
        const batch = await Promise.all(roster.slice(start, start + 8).filter(row => row.available && row.kind !== 'observer' && row.kind !== 'admin').map(async row => {
          const saved = await this.game.playerNbt(row.playerUuid);
          const guild = gameplay.data?.['guild-players']?.[row.playerUuid];
          const profession = professions.data?.players?.[row.playerUuid];
          return { ...this.game.publicAgent(row), growth: publicGrowth(guild, profession, saved.data?.XpLevel),
            savedAt: saved.savedAt, progressionSavedAt: professions.savedAt, source: 'Paper.saved-player-data' };
        }));
        players.push(...batch);
      }
      return { players: players.sort((a, b) => (b.growth.gradeIndex ?? -1) - (a.growth.gradeIndex ?? -1) || (b.growth.fame ?? -1) - (a.growth.fame ?? -1) || a.name.localeCompare(b.name)),
        observedAt: new Date().toISOString(), freshness: 'saved', source: 'Paper.saved-player-data', truncated: roster.length > 256 };
    });
  }
  insert(event, identity) {
    const id = createHash('sha256').update(identity).digest('hex');
    this.store.db.prepare('INSERT OR IGNORE INTO public_events VALUES(?,?,?,?,?,?,?,?)').run(id, event.kind, event.playerName || null, event.title, event.body || '', event.occurredAt, event.precision, event.source);
  }
  async collect() {
    return this.game.cached('public-event-ingest', 15000, async () => {
      const roster = await this.game.roster();
      const allowed = new Set(roster.map(row => row.name.toLowerCase()));
      const gameplay = await this.game.plugin('config.yml');
      const [tasks, daily] = await Promise.all([this.game.plugin('task-market.yml'), this.game.plugin('dynamic-board.yml')]);
      for (const player of roster.filter(row => row.available && !['admin', 'observer'].includes(row.kind))) {
        const completed = gameplay.data?.['guild-players']?.[player.playerUuid]?.everDone;
        for (const [id, date] of Object.entries(completed || {}).slice(0, 2000)) {
          if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          const occurredAt = Date.parse(`${date}T00:00:00+08:00`);
          if (!Number.isFinite(occurredAt)) continue;
          const dailyId = /^db_\d{8}_(.+)$/.exec(id)?.[1];
          const task = tasks.data?.tasks?.[id.replace(/^tm_/, '')] || (dailyId ? daily.data?.templates?.[dailyId] : null);
          const title = text(task?.title || task?.name, 100);
          this.insert({ kind: 'quest', playerName: player.name, title: `${player.name} ${title ? `完成委托「${title}」` : '完成了一项公会委托'}`, body: title ? '' : `委托编号：${text(id, 120)}`, occurredAt, precision: 'day', source: 'AgentFriend.guild.everDone' }, `quest:${player.id}:${id}:${date}`);
        }
      }
      // Read at most the last 256 KiB. Raw logs are never returned or persisted.
      // latest.log is rotated daily by Paper; its mtime supplies the date.
      let handle;
      try {
        handle = await fs.open(path.join(this.config.serverDir, 'logs', 'latest.log'), 'r');
        const stat = await handle.stat();
        const start = Math.max(0, stat.size - 262144); const buffer = Buffer.alloc(Math.min(stat.size, 262144));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(stat.mtime);
        const lines = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/);
        if (start > 0) lines.shift();
        // Ignore the unfinished final line, which may be in the middle of a write.
        lines.pop();
        for (const line of lines) {
          const event = parsePublicLog(line, date);
          if (event && allowed.has(event.playerName.toLowerCase())) this.insert(event, `${date}:${line}`);
        }
      } catch { /* A missing/locked log does not invent activity. */ }
      finally { await handle?.close(); }
    });
  }
  async events({ kind = 'all', page = 1, limit = 20 } = {}) {
    if (!['all', 'notice', 'join', 'leave', 'advancement', 'quest'].includes(kind) || !Number.isInteger(page) || page < 1 || page > 50000 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw Object.assign(new Error('请选择有效的事件类型和页码'), { status: 400, reason: 'INVALID_PAGE' });
    await this.collect();
    const total = this.store.db.prepare('SELECT count(*) AS n FROM public_events WHERE (?=\'all\' OR kind=?)').get(kind, kind).n;
    const rows = this.store.db.prepare('SELECT * FROM public_events WHERE (?=\'all\' OR kind=?) ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?').all(kind, kind, limit, (page - 1) * limit);
    return { events: rows.map(row => ({ id: row.id, kind: row.kind, playerName: row.player_name, title: row.title, body: row.body,
      occurredAt: new Date(row.occurred_at).toISOString(), timePrecision: row.precision, source: row.source })), page, pages: Math.max(1, Math.ceil(total / limit)), total, observedAt: new Date().toISOString() };
  }
}
