import Database from 'better-sqlite3'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { OFFERING_ITEM_CN, type OfferingInfo } from './mc-offering.ts'

/**
 * mc-worlddb —— 世界数据库（正规数据库，世界进程唯一持久层）。
 *
 * 结构化数据 → SQLite（data/world.db，WAL 模式，事务保证）：
 *   prayers    慢路径祈愿收件箱（持久化队列：pending → done，重启不丢信）
 *   offerings  供奉流水（虔诚度史的真源，按玩家聚合查询）
 *   chronicle  编年史真源（世界运行 + 穿越者历程；world-chronicle.md 是它的可读导出）
 *   reviews    女神观察期报（世界迭代需求文档的每期存档）
 *   memory_points 众生册登记簿（向量点的 id 分配 + 文本留档，Qdrant 不可用也不丢内容）
 *
 * 向量记忆 → Qdrant（独立 collection，与家里 MemOS 的 neo4j_vec_db 完全隔离）：
 *   众生册 = 女神与每个穿越者的互动记忆（祈愿/供奉/裁决/神谕），
 *   语义召回后注入裁决 prompt——女神因此「记得」旧缘，且这份记忆
 *   归世界数据库所有，不依赖任何 agent 框架的内置记忆。
 *
 * 降级铁律：Qdrant / embedding 任一不可用时，众生册自动退化为「只留档、不召回」，
 * 绝不阻塞祈愿处理与世界运转。
 */
export interface Config {
  enabled: boolean
  dbPath: string
  chronicleMdPath: string
  memoryEnabled: boolean
  qdrantUrl: string
  qdrantCollection: string
  embeddingUrl: string
  embeddingModel: string
}

// ── 公共类型 ─────────────────────────────────────────────────────────
export interface ChronicleEntry {
  at: number
  type: string
  actor: string
  detail: Record<string, unknown>
}

export interface InboxRow {
  id: number
  username: string
  name: string
  wish: string
  offering: OfferingInfo | null
  at: number
}

export interface MemoryHit {
  at: number
  kind: string
  text: string
  score: number
}

export interface MailRow {
  id: number
  from: string
  to: string
  body: string
  at: number
  readAt: number | null
}

export interface DiaryRow {
  id: number
  username: string
  /** 现实日期 YYYY-MM-DD（每人每天一篇，UNIQUE 约束兜底）。 */
  day: string
  content: string
  gameDay: number | null
  at: number
}

export interface WorlddbService {
  /** 收件箱：入队一封祈愿（返回 ahead = 排在他前面还有几封）。 */
  inboxPush(username: string, name: string, wish: string, offering?: OfferingInfo): { id: number; ahead: number }
  /** 收件箱：取最老一封待处理信（不动状态——处理完成才 complete，中途崩溃信不丢）。 */
  inboxPeek(): InboxRow | null
  /** 收件箱：处理完毕，落裁决摘要。 */
  inboxComplete(id: number, verdict: string): void
  inboxPendingCount(): number
  /** 账本：记一笔供奉流水（收执成功后调用）。 */
  ledgerRecord(username: string, offer: OfferingInfo): void
  /** 账本：给女神看的供奉史摘要。 */
  ledgerSummary(username: string): string
  /** 账本：某人自某时刻以来供奉某物的累计数量（创世之笔神托核销用）。 */
  ledgerCountSince(username: string, itemId: string, sinceTs: number): number
  /** 史官：记一条编年史（入库 + md 双写导出）。 */
  chronicleRecord(type: string, actor: string, detail: Record<string, unknown>): void
  /** 史官：读某时刻以来的全部条目。 */
  chronicleSince(ts: number): ChronicleEntry[]
  /** 守望者：下一期观察期号（从 DB 恢复，重启不重置）。 */
  reviewNextSeq(): number
  /** 守望者：上一期观察的时间（重启不重置，避免重复汇总）。 */
  reviewLastAt(): number
  /** 守望者：存一期观察报告。 */
  reviewSave(issue: number, entries: number, stats: string, markdown: string, at?: number): void
  /** 众生册：记一条与某人的互动记忆（embed → Qdrant；失败仅留档不报错）。 */
  remember(username: string, kind: string, text: string): Promise<void>
  /** 众生册：语义召回与此人相关的旧事（失败返回 []，绝不阻塞裁决）。 */
  recall(username: string, query: string, k?: number): Promise<MemoryHit[]>
  // ── 书信（女神信差，2026-08-17）：好友制邮件，离线落库在线投递 ──
  /** 落一封信（收件箱容量守卫在调用方 mc-social）。返回信件 id。 */
  mailPush(from: string, to: string, body: string): { id: number }
  /** 未读信件（旧→新）。 */
  mailUnread(username: string): MailRow[]
  mailUnreadCount(username: string): number
  /** 收件箱存量（含已读，容量守卫用）。 */
  mailInboxCount(username: string): number
  /** 最新未读的寄件人（上线提醒文案用），无则 null。 */
  mailLatestSender(username: string): string | null
  /** 最近 N 封（新→旧，含已读）。 */
  mailRecent(username: string, limit: number): MailRow[]
  mailMarkRead(username: string, ids: number[]): void
  /** 清空收件箱，返回删除数。 */
  mailClear(username: string): number
  // ── 好友（双向确认）──
  friendRequestAdd(from: string, to: string): { ok: boolean; reason?: string }
  /** 等我答复的请求（from 名单）。 */
  friendPendingFor(username: string): string[]
  /** 答应 from 的请求 → 双向好友。无此请求返回 false。 */
  friendAccept(me: string, from: string): boolean
  friendRemove(me: string, other: string): boolean
  friendList(username: string): string[]
  areFriends(a: string, b: string): boolean
  // ── 日记档案馆（2026-08-17）：每人每天一篇，UNIQUE(username, day) ──
  /** 落一篇日记。当天已有（UNIQUE 冲突）返回 false，由调用方回话。 */
  diaryAdd(username: string, day: string, content: string, gameDay: number | null): boolean
  /** 最近 N 篇（新→旧）。username 为空 = 全体穿越者混排（讲台/面板用）。 */
  diaryList(username: string | null, limit: number): DiaryRow[]
  /** 某人的日记总篇数（「第 N 篇」编号用）。 */
  diaryCount(username: string): number
  /** 领书去重标记：首次（该 username 从未领过欢迎册）返回 true 并落标记。 */
  diaryGiftMark(username: string): boolean
}

// ── 编年史 md 导出格式（史官亲笔）─────────────────────────────────────
export const CHRONICLE_TYPE_CN: Record<string, string> = {
  prayer: '祈愿', verdict: '神谕', godcast: '神迹', offering: '供奉',
  cast: '咏唱', levelup: '升级', innate: '降临天赋',
  death: '陨落', presence: '行迹', 'world-review': '女神观察',
  skill: '天资觉醒', law: '法则修订',
  balance: '天平拨正',
  say: '话语', mail: '书信', friend: '结交',
  diary: '日记',
  saga_muse: '创世感怀', saga_atom: '新咒降世', saga_quest: '神托任务',
  saga_event: '大事件', saga_reject: '创世驳回',
  ask: '求知', help: '查册', welcome: '迎新',
}

function chronicleMdLine(e: ChronicleEntry): string {
  const ts = new Date(e.at)
  const hhmm = `${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
  return `- [${hhmm}] ${CHRONICLE_TYPE_CN[e.type] ?? e.type}｜${e.actor}：${detailText(e)}\n`
}

function detailText(e: ChronicleEntry): string {
  const d = e.detail
  const reply = typeof d.reply === 'string' ? d.reply.slice(0, 40) : ''
  switch (e.type) {
    case 'prayer': {
      const o = d.offering as OfferingInfo | undefined
      return `「${String(d.wish ?? '').slice(0, 50)}」${o ? `（供奉 ${o.cn}×${o.count}）` : '（空手）'}`
    }
    case 'verdict':
      return `${d.action === 'cast' ? `应允${d.skill ? '·' + String(d.skill) : ''}` : d.action === 'instant' ? '点拨自行咏唱' : '拒绝'}${reply ? `「${reply}」` : ''}`
    case 'godcast':
      return `女神亲施 ${String(d.skill ?? '')}`
    case 'offering':
      return `${String(d.cn ?? '')}×${String(d.count ?? '')} 已归神库`
    case 'cast':
      return `${String(d.skill ?? '')}（魔${String(d.mana ?? 0)}${Number(d.hp) ? ` 血${String(d.hp)}` : ''}${Number(d.food) ? ` 食${String(d.food)}` : ''}，经验+${String(d.exp ?? 0)}）`
    case 'levelup':
      return `魔力层级 ${String(d.from)} → ${String(d.to)}`
    case 'innate':
      return `选定出生天赋「${String(d.skill ?? '')}」`
    case 'death':
      return `第 ${String(d.total ?? '?')} 次陨落`
    case 'balance':
      if (d.reset) return `天平复位（撤 ${String(d.removed ?? '?')} 道补丁${d.atom ? `·${String(d.atom)}` : '·全部'}）`
      return `${String(d.summary ?? '')}`
    case 'presence':
      return d.event === 'join' ? '踏入此界' : '离去'
    case 'say': {
      const modeCn = d.mode === 'shout' ? '喊' : d.mode === 'whisper' ? '悄悄' : '说'
      return `${modeCn}「${String(d.text ?? '')}」（${Array.isArray(d.heard) ? d.heard.length : 0} 人听见）`
    }
    case 'mail':
      return `寄给 ${String(d.to ?? '')}：「${String(d.body ?? '')}」`
    case 'friend':
      return d.event === 'accept' ? `与 ${String(d.to ?? '')} 结为好友` : `向 ${String(d.to ?? '')} 发起结交`
    case 'diary':
      return `第 ${String(d.no ?? '?')} 篇（${String(d.day ?? '')}，${String(d.chars ?? 0)} 字）`
    default:
      return JSON.stringify(d).slice(0, 100)
  }
}

// ── 建表 ─────────────────────────────────────────────────────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS prayers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  wish TEXT NOT NULL,
  offering_json TEXT,
  at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  verdict TEXT,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prayers_status ON prayers(status, id);
CREATE TABLE IF NOT EXISTS offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_cn TEXT NOT NULL,
  count INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offerings_user ON offerings(username, at);
CREATE TABLE IF NOT EXISTS chronicle (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_chronicle_at ON chronicle(at);
CREATE TABLE IF NOT EXISTS reviews (
  issue INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  entries INTEGER NOT NULL,
  stats TEXT NOT NULL,
  markdown TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_points(username, at);
CREATE TABLE IF NOT EXISTS mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mail_to ON mail(to_user, id);
CREATE TABLE IF NOT EXISTS friends (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  day TEXT NOT NULL,
  content TEXT NOT NULL,
  game_day INTEGER,
  at INTEGER NOT NULL,
  UNIQUE(username, day)
);
CREATE TABLE IF NOT EXISTS diary_gift (
  username TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
`

// ── 旧文件数据一次性迁移（表空 + 旧文件存在 → 导入 → 改名 .migrated）──
function migrateLegacy(db: Database.Database, dbPath: string): void {
  const dataDir = dirname(dbPath)

  // 祈愿收件箱 prayer-inbox.json
  const inboxPath = resolve(dataDir, 'prayer-inbox.json')
  if (existsSync(inboxPath)) {
    const n = (db.prepare('SELECT COUNT(*) AS c FROM prayers').get() as { c: number }).c
    if (n === 0) {
      try {
        const raw = JSON.parse(readFileSync(inboxPath, 'utf-8')) as {
          pending?: Array<{ id: number; username: string; name: string; wish: string; offering?: OfferingInfo; at: number }>
          done?: Array<{ id: number; username: string; name: string; wish: string; offering?: OfferingInfo; at: number; verdict: string; processedAt: number }>
        }
        const ins = db.prepare('INSERT INTO prayers (username, name, wish, offering_json, at, status, verdict, processed_at) VALUES (?,?,?,?,?,?,?,?)')
        const tx = db.transaction(() => {
          for (const p of raw.pending ?? []) {
            ins.run(p.username, p.name, p.wish, p.offering ? JSON.stringify(p.offering) : null, p.at, 'pending', null, null)
          }
          for (const d of raw.done ?? []) {
            ins.run(d.username, d.name, d.wish, d.offering ? JSON.stringify(d.offering) : null, d.at, 'done', d.verdict, d.processedAt)
          }
        })
        tx()
        console.log(`[mc-worlddb] migrated ${(raw.pending?.length ?? 0) + (raw.done?.length ?? 0)} prayers from prayer-inbox.json`)
      } catch (err) {
        console.error(`[mc-worlddb] prayer-inbox.json migration failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      renameSync(inboxPath, inboxPath + '.migrated')
    }
  }

  // 供奉账本 devotion-ledger.json（按玩家 history 展开）
  const ledgerPath = resolve(dataDir, 'devotion-ledger.json')
  if (existsSync(ledgerPath)) {
    const n = (db.prepare('SELECT COUNT(*) AS c FROM offerings').get() as { c: number }).c
    if (n === 0) {
      try {
        const raw = JSON.parse(readFileSync(ledgerPath, 'utf-8')) as {
          players?: Record<string, { history?: Array<{ at: number; id: string; cn: string; count: number }> }>
        }
        const ins = db.prepare('INSERT INTO offerings (username, item_id, item_cn, count, at) VALUES (?,?,?,?,?)')
        const tx = db.transaction(() => {
          for (const [username, p] of Object.entries(raw.players ?? {})) {
            for (const h of p.history ?? []) {
              ins.run(username, h.id, h.cn, h.count, h.at)
            }
          }
        })
        tx()
        console.log(`[mc-worlddb] migrated devotion ledger from devotion-ledger.json`)
      } catch (err) {
        console.error(`[mc-worlddb] devotion-ledger.json migration failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      renameSync(ledgerPath, ledgerPath + '.migrated')
    }
  }

  // 编年史 chronicle.jsonl（真源入表；md 是导出物无需迁移，record 时继续追加）
  const jsonlPath = resolve(dataDir, 'chronicle.jsonl')
  if (existsSync(jsonlPath)) {
    const n = (db.prepare('SELECT COUNT(*) AS c FROM chronicle').get() as { c: number }).c
    if (n === 0) {
      try {
        const ins = db.prepare('INSERT INTO chronicle (at, type, actor, detail_json) VALUES (?,?,?,?)')
        const tx = db.transaction(() => {
          for (const line of readFileSync(jsonlPath, 'utf-8').split('\n')) {
            if (!line.trim()) continue
            try {
              const { at, type, actor, ...detail } = JSON.parse(line)
              if (typeof at === 'number' && typeof type === 'string' && typeof actor === 'string') {
                ins.run(at, type, actor, JSON.stringify(detail))
              }
            } catch { /* skip bad line */ }
          }
        })
        tx()
        console.log(`[mc-worlddb] migrated chronicle from chronicle.jsonl`)
      } catch (err) {
        console.error(`[mc-worlddb] chronicle.jsonl migration failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      renameSync(jsonlPath, jsonlPath + '.migrated')
    }
  }
}

export interface WorlddbHandle {
  service: WorlddbService
  dispose: () => void
}

// ── 服务装配 ─────────────────────────────────────────────────────────
export function createWorlddb(config: Config): WorlddbHandle {
  const log = (msg: string) => console.log(`[mc-worlddb] ${msg}`)

  const dbPath = resolve(config.dbPath)
  {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(SCHEMA_SQL)
  migrateLegacy(db, dbPath)

  // 编年史 md 导出物
  const mdPath = resolve(config.chronicleMdPath)
  {
    const dir = dirname(mdPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(mdPath)) {
      appendFileSync(mdPath, '# 初始之地 · 世界编年史\n\n> 女神亲笔。这个世界运行过的一切，与穿越者们走过的每一步。\n\n', 'utf-8')
    }
  }

  // ── 向量记忆（Qdrant 众生册）───────────────────────────────────────
  let qdrantReady = false
  let qdrantDownLogged = 0

  async function embed(text: string): Promise<number[] | null> {
    try {
      const res = await fetch(`${config.embeddingUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.embeddingModel, input: [text.slice(0, 2000)] }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`embed ${res.status}`)
      const data = (await res.json()) as { embeddings?: number[][] }
      const vec = data.embeddings?.[0]
      return Array.isArray(vec) ? vec : null
    } catch (err) {
      log(`embedding failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  async function ensureQdrant(): Promise<boolean> {
    if (!config.memoryEnabled) return false
    if (qdrantReady) return true
    try {
      const colUrl = `${config.qdrantUrl}/collections/${config.qdrantCollection}`
      let res = await fetch(colUrl, { signal: AbortSignal.timeout(5_000) })
      if (res.status === 404) {
        res = await fetch(colUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vectors: { size: 1024, distance: 'Cosine' } }),
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`create collection ${res.status}`)
        log(`qdrant collection "${config.qdrantCollection}" created (1024d Cosine)`)
      } else if (!res.ok) {
        throw new Error(`get collection ${res.status}`)
      }
      qdrantReady = true
      return true
    } catch (err) {
      // 限频日志：qdrant 不可用时每 10 分钟最多哀叹一次，不刷屏
      if (Date.now() - qdrantDownLogged > 600_000) {
        qdrantDownLogged = Date.now()
        log(`qdrant unavailable (${err instanceof Error ? err.message : String(err)}) — 众生册退化为只留档不召回`)
      }
      return false
    }
  }

  const insMemory = db.prepare('INSERT INTO memory_points (username, kind, text, at, synced) VALUES (?,?,?,?,?)')
  const markSynced = db.prepare('UPDATE memory_points SET synced = 1 WHERE id = ?')

  async function remember(username: string, kind: string, text: string): Promise<void> {
    const at = Date.now()
    const info = insMemory.run(username, kind, text, at, 0)
    if (!(await ensureQdrant())) return
    const vec = await embed(text)
    if (!vec) return
    try {
      const res = await fetch(`${config.qdrantUrl}/collections/${config.qdrantCollection}/points?wait=true`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: [{
            id: Number(info.lastInsertRowid),
            vector: vec,
            payload: { username, kind, text, at },
          }],
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) markSynced.run(info.lastInsertRowid)
      else throw new Error(`upsert ${res.status}`)
    } catch (err) {
      log(`qdrant upsert failed (point #${info.lastInsertRowid} 留档待补): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function recall(username: string, query: string, k = 5): Promise<MemoryHit[]> {
    if (!(await ensureQdrant())) return []
    const vec = await embed(query)
    if (!vec) return []
    try {
      const res = await fetch(`${config.qdrantUrl}/collections/${config.qdrantCollection}/points/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: { nearest: vec },
          filter: { must: [{ key: 'username', match: { value: username } }] },
          limit: k,
          with_payload: true,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`query ${res.status}`)
      const data = (await res.json()) as {
        result?: Array<{ score: number; payload?: { kind?: string; text?: string; at?: number } }>
      }
      return (data.result ?? []).flatMap((r) => {
        const p = r.payload
        if (!p?.text) return []
        return [{ at: p.at ?? 0, kind: p.kind ?? '', text: p.text, score: r.score }]
      })
    } catch (err) {
      log(`qdrant query failed: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  // ── SQL 语句（服务方法共用）────────────────────────────────────────
  const insPrayer = db.prepare('INSERT INTO prayers (username, name, wish, offering_json, at, status) VALUES (?,?,?,?,?,?)')
  const cntPending = db.prepare("SELECT COUNT(*) AS c FROM prayers WHERE status='pending'")
  const cntPendingBefore = db.prepare("SELECT COUNT(*) AS c FROM prayers WHERE status='pending' AND id < ?")
  const peekPending = db.prepare("SELECT id, username, name, wish, offering_json, at FROM prayers WHERE status='pending' ORDER BY id LIMIT 1")
  const completePrayer = db.prepare("UPDATE prayers SET status='done', verdict=?, processed_at=? WHERE id=?")
  const insOffering = db.prepare('INSERT INTO offerings (username, item_id, item_cn, count, at) VALUES (?,?,?,?,?)')
  const aggOffering = db.prepare('SELECT COUNT(*) AS total, MAX(at) AS last_at FROM offerings WHERE username=?')
  const aggByItem = db.prepare('SELECT item_id, SUM(count) AS n FROM offerings WHERE username=? GROUP BY item_id ORDER BY n DESC')
  const sumOfferingSince = db.prepare('SELECT COALESCE(SUM(count),0) AS c FROM offerings WHERE username=? AND item_id=? AND at>=?')
  const insChronicle = db.prepare('INSERT INTO chronicle (at, type, actor, detail_json) VALUES (?,?,?,?)')
  const selChronicleSince = db.prepare('SELECT at, type, actor, detail_json FROM chronicle WHERE at >= ? ORDER BY seq')
  const maxReviewIssue = db.prepare('SELECT COALESCE(MAX(issue), 0) AS m FROM reviews')
  const maxReviewAt = db.prepare('SELECT MAX(at) AS m FROM reviews')
  const insReview = db.prepare('INSERT OR REPLACE INTO reviews (issue, at, entries, stats, markdown) VALUES (?,?,?,?,?)')
  // 书信 & 好友（女神信差）
  const insMail = db.prepare('INSERT INTO mail (from_user, to_user, body, at) VALUES (?,?,?,?)')
  const selMailUnread = db.prepare('SELECT id, from_user, body, at FROM mail WHERE to_user=? AND read_at IS NULL ORDER BY id')
  const cntMailUnread = db.prepare('SELECT COUNT(*) AS c FROM mail WHERE to_user=? AND read_at IS NULL')
  const cntMailInbox = db.prepare('SELECT COUNT(*) AS c FROM mail WHERE to_user=?')
  const latestMailSender = db.prepare('SELECT from_user FROM mail WHERE to_user=? AND read_at IS NULL ORDER BY id DESC LIMIT 1')
  const selMailRecent = db.prepare('SELECT id, from_user, body, at, read_at FROM mail WHERE to_user=? ORDER BY id DESC LIMIT ?')
  const markMailRead = db.prepare('UPDATE mail SET read_at=? WHERE to_user=? AND id=? AND read_at IS NULL')
  const delMail = db.prepare('DELETE FROM mail WHERE to_user=?')
  const selFriendAny = db.prepare("SELECT a, b, status FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)")
  const insFriend = db.prepare('INSERT INTO friends (a, b, status, at) VALUES (?,?,?,?)')
  const accFriend = db.prepare("UPDATE friends SET status='accepted' WHERE a=? AND b=? AND status='pending'")
  const delFriend = db.prepare('DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)')
  const selFriendAccepted = db.prepare("SELECT CASE WHEN a=? THEN b ELSE a END AS other FROM friends WHERE (a=? OR b=?) AND status='accepted'")
  const selFriendPendingFor = db.prepare("SELECT a FROM friends WHERE b=? AND status='pending'")
  // 日记档案馆
  const insDiary = db.prepare('INSERT INTO diary (username, day, content, game_day, at) VALUES (?,?,?,?,?)')
  const selDiaryByUser = db.prepare('SELECT id, username, day, content, game_day, at FROM diary WHERE username=? ORDER BY id DESC LIMIT ?')
  const selDiaryAll = db.prepare('SELECT id, username, day, content, game_day, at FROM diary ORDER BY id DESC LIMIT ?')
  const cntDiary = db.prepare('SELECT COUNT(*) AS c FROM diary WHERE username=?')
  const insDiaryGift = db.prepare('INSERT OR IGNORE INTO diary_gift (username, at) VALUES (?,?)')

  function mailRow(r: { id: number; from_user: string; body: string; at: number; read_at?: number | null }, to: string): MailRow {
    return { id: r.id, from: r.from_user, to, body: r.body, at: r.at, readAt: r.read_at ?? null }
  }

  const service: WorlddbService = {
    inboxPush(username, name, wish, offering) {
      const info = insPrayer.run(username, name, wish, offering ? JSON.stringify(offering) : null, Date.now(), 'pending')
      const ahead = (cntPendingBefore.get(info.lastInsertRowid) as { c: number }).c
      return { id: Number(info.lastInsertRowid), ahead }
    },
    inboxPeek() {
      const row = peekPending.get() as { id: number; username: string; name: string; wish: string; offering_json: string | null; at: number } | undefined
      if (!row) return null
      return {
        id: row.id,
        username: row.username,
        name: row.name,
        wish: row.wish,
        offering: row.offering_json ? (JSON.parse(row.offering_json) as OfferingInfo) : null,
        at: row.at,
      }
    },
    inboxComplete(id, verdict) {
      completePrayer.run(verdict, Date.now(), id)
    },
    inboxPendingCount() {
      return (cntPending.get() as { c: number }).c
    },
    ledgerRecord(username, offer) {
      insOffering.run(username, offer.id.replace(/^minecraft:/, ''), offer.cn, offer.count, Date.now())
    },
    ledgerCountSince(username, itemId, sinceTs) {
      const row = sumOfferingSince.get(username, itemId.replace(/^minecraft:/, ''), sinceTs) as { c: number }
      return row.c
    },
    ledgerSummary(username) {
      const agg = aggOffering.get(username) as { total: number; last_at: number | null }
      if (!agg.total) return '此生从未供奉过你'
      const items = (aggByItem.all(username) as Array<{ item_id: string; n: number }>)
        .map((r) => `${OFFERING_ITEM_CN[r.item_id] ?? r.item_id}×${r.n}`)
        .join('、')
      const ago = agg.last_at ? `；上次供奉在 ${Math.max(1, Math.round((Date.now() - agg.last_at) / 60_000))} 分钟前` : ''
      return `这是他第 ${agg.total} 次供奉；累计：${items || '无'}${ago}`
    },
    chronicleRecord(type, actor, detail) {
      try {
        const at = Date.now()
        insChronicle.run(at, type, actor, JSON.stringify(detail))
        appendFileSync(mdPath, chronicleMdLine({ at, type, actor, detail }), 'utf-8')
      } catch (err) {
        console.error(`[mc-worlddb] chronicle record failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    chronicleSince(ts) {
      const rows = selChronicleSince.all(ts) as Array<{ at: number; type: string; actor: string; detail_json: string }>
      return rows.map((r) => {
        let detail: Record<string, unknown> = {}
        try { detail = JSON.parse(r.detail_json) } catch { /* skip */ }
        return { at: r.at, type: r.type, actor: r.actor, detail }
      })
    },
    reviewNextSeq() {
      return (maxReviewIssue.get() as { m: number }).m + 1
    },
    reviewLastAt() {
      return (maxReviewAt.get() as { m: number | null }).m ?? 0
    },
    reviewSave(issue, entries, stats, markdown, at = Date.now()) {
      insReview.run(issue, at, entries, stats, markdown)
    },
    // ── 书信 ──
    mailPush(from, to, body) {
      const info = insMail.run(from, to, body, Date.now())
      return { id: Number(info.lastInsertRowid) }
    },
    mailUnread(username) {
      return (selMailUnread.all(username) as Array<{ id: number; from_user: string; body: string; at: number }>)
        .map((r) => mailRow(r, username))
    },
    mailUnreadCount(username) {
      return (cntMailUnread.get(username) as { c: number }).c
    },
    mailInboxCount(username) {
      return (cntMailInbox.get(username) as { c: number }).c
    },
    mailLatestSender(username) {
      return (latestMailSender.get(username) as { from_user: string } | undefined)?.from_user ?? null
    },
    mailRecent(username, limit) {
      return (selMailRecent.all(username, limit) as Array<{ id: number; from_user: string; body: string; at: number; read_at: number | null }>)
        .map((r) => mailRow(r, username))
    },
    mailMarkRead(username, ids) {
      const now = Date.now()
      for (const id of ids) markMailRead.run(now, username, id)
    },
    mailClear(username) {
      const info = delMail.run(username)
      return Number(info.changes)
    },
    // ── 好友 ──
    friendRequestAdd(from, to) {
      const row = selFriendAny.get(from, to, to, from) as { a: string; b: string; status: string } | undefined
      if (row) {
        if (row.status === 'accepted') return { ok: false, reason: `你们已经是好友了。` }
        return { ok: false, reason: row.a === from ? '好友请求早已送出，耐心等对方答复。' : '对方先向你发起了请求——直接 /friend accept <游戏ID> 答应即可。' }
      }
      insFriend.run(from, to, 'pending', Date.now())
      return { ok: true }
    },
    friendPendingFor(username) {
      return (selFriendPendingFor.all(username) as Array<{ a: string }>).map((r) => r.a)
    },
    friendAccept(me, from) {
      const info = accFriend.run(from, me)
      return Number(info.changes) > 0
    },
    friendRemove(me, other) {
      const info = delFriend.run(me, other, other, me)
      return Number(info.changes) > 0
    },
    friendList(username) {
      return (selFriendAccepted.all(username, username, username) as Array<{ other: string }>).map((r) => r.other)
    },
    areFriends(a, b) {
      const row = selFriendAny.get(a, b, b, a) as { status: string } | undefined
      return row?.status === 'accepted'
    },
    // ── 日记 ──
    diaryAdd(username, day, content, gameDay) {
      try {
        insDiary.run(username, day, content, gameDay, Date.now())
        return true
      } catch {
        return false // UNIQUE(username, day) 冲突 = 今天已记过
      }
    },
    diaryList(username, limit) {
      const rows = (username ? selDiaryByUser.all(username, limit) : selDiaryAll.all(limit)) as Array<{ id: number; username: string; day: string; content: string; game_day: number | null; at: number }>
      return rows.map((r) => ({ id: r.id, username: r.username, day: r.day, content: r.content, gameDay: r.game_day, at: r.at }))
    },
    diaryCount(username) {
      return (cntDiary.get(username) as { c: number }).c
    },
    diaryGiftMark(username) {
      return insDiaryGift.run(username, Date.now()).changes === 1
    },
    remember,
    recall,
  }
  const dispose = () => {
    try { db.close() } catch { /* already closed */ }
    log('worlddb disposed')
  }

  if (config.enabled) {
    const prayers = (db.prepare('SELECT COUNT(*) AS c FROM prayers').get() as { c: number }).c
    const offerings = (db.prepare('SELECT COUNT(*) AS c FROM offerings').get() as { c: number }).c
    const chronicle = (db.prepare('SELECT COUNT(*) AS c FROM chronicle').get() as { c: number }).c
    log(`world db ready @ ${config.dbPath} (prayers=${prayers}, offerings=${offerings}, chronicle=${chronicle}); 众生册 qdrant=${config.memoryEnabled ? config.qdrantUrl : 'off'} collection=${config.qdrantCollection}`)
  }

  return { service, dispose }
}
