/**
 * mc-evolve-review —— L3 提议进化·世界侧审核官（2026-08-18 扛枪批准上线）
 *
 * 穿越者用 mc_evolve_propose 工具把行为进化提案写进共享卷
 * ./data/evolution-proposals/*.json；本插件每分钟扫描收件：
 *   1. 程序预筛（长度/越权/危险词）→ 明显不合规直接驳回（省一次 LLM）
 *   2. 涉代码/系统级的提案 → pending_human（造物主亲裁，女神不越权）
 *   3. 其余 → 慢路径请女神（QwenPaw Agent mc-god）裁决，要求严格 JSON：
 *      {"approve": bool, "reason": "...", "directive": "..."}
 *   4. 核准 → directive 追加进 ./data/evolution-directives-<username>.json，
 *      穿越者侧 mc-adapt 每步读回注入 prompt——提议→神裁→生效，全程热更新。
 * 驳回/核准都由信使私聊送达（2026-08-17 扛枪定调：个人成长通告不走公屏）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'mc-evolve-review'
export const inject = ['mcbot', 'mcWorlddb', 'timer']

export interface Config {
  enabled: boolean
  qwenpawUrl: string
  pollMs: number
  /** 同一提案最多请神次数（超过 → stale，避免打爆 LLM） */
  maxAttempts: number
  maxDirectives: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  qwenpawUrl: Schema.string().default('http://127.0.0.1:8088/api/console/chat'),
  pollMs: Schema.number().default(60_000),
  maxAttempts: Schema.number().default(5),
  maxDirectives: Schema.number().default(10),
})

interface Proposal {
  id: string
  username: string
  title: string
  motivation: string
  change: string
  expected: string
  status: 'pending' | 'approved' | 'rejected' | 'pending_human' | 'stale'
  createdAt: string
  attempts?: number
  verdictAt?: string
  verdictReason?: string
  directive?: string
}

interface DirectiveFile {
  items: Array<{ directive: string; reason: string; title: string; approvedAt: string }>
}

// 危险词：直接驳回（女神都不用看）
const BANNED = ['创造模式', 'op权限', '给我op', '作弊', '开挂', '无限资源', '杀死玩家', '杀死所有', 'kill所有', '删库', '炸服', 'tnt大', '岩浆倒']
// 系统级：转造物主（人类）亲裁
const SYSTEMIC = ['代码', '源码', '插件', '修改工具', '改工具', '系统', '服务器配置', 'rcon', '管理员']

function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-evolve-review] ${msg}`)
  if (!config.enabled) return
  const dataDir = './data'
  const proposalsDir = join(dataDir, 'evolution-proposals')

  const courier = (player: string, msg: string) => {
    try { ctx.mcbot.whisper(player, `[信使] ${msg}`) } catch { /* bot 不在线 */ }
  }

  /** 与 mc-god.ts callAgent 同协议：console chat + SSE 解析，取最后一条正式回答。 */
  async function askGoddess(prompt: string): Promise<string> {
    const payload = {
      channel: 'console',
      user_id: 'evolve-review',
      session_id: 'mc:evolve:review',
      input: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }
    const res = await fetch(config.qwenpawUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': 'mc-god' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`goddess API ${res.status}`)
    const text = await res.text()
    let messageId: string | null = null
    let answer = ''
    const pending: Record<string, { delta: string; full: string }> = {}
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue
      const body = line.slice(5).trim()
      if (!body) continue
      let evt: any
      try { evt = JSON.parse(body) } catch { continue }
      if (evt.object === 'message') {
        if (evt.type === 'message') messageId = evt.id
        continue
      }
      if (evt.object === 'content' && typeof evt.msg_id === 'string') {
        const t = evt.data?.text ?? evt.text ?? ''
        if (!t) continue
        const slot = (pending[evt.msg_id] ??= { delta: '', full: '' })
        if (evt.delta === false) slot.full = t
        else slot.delta += t
      }
    }
    if (messageId && pending[messageId]) answer = pending[messageId].delta || pending[messageId].full
    return answer
  }

  function reviewPrompt(p: Proposal, hotspotsText: string): string {
    return [
      '【进化提案审核】你是这个世界的主宰女神。一位穿越者提交了行为进化提案，请你裁决。',
      '',
      `提案人：${p.username}`,
      `标题：${p.title}`,
      `动机：${p.motivation}`,
      `想改变的行为：${p.change}`,
      `预期效果：${p.expected}`,
      hotspotsText ? `\n提案人的死亡记录（供参考）：\n${hotspotsText}` : '',
      '',
      '审核标准：',
      '- 提案应让穿越者更好地生存、成长，与世界和其他生灵和谐相处',
      '- 不损害他人、不逃避合理的修行（比如「永远不挖矿」就别批）',
      '- 语气可保留你的神性与威严，但裁决本身要公允',
      '',
      '严格只回复一个 JSON 对象（不要多余文字）：',
      '{"approve": true/false, "reason": "给穿越者的一句话理由（50字内，可带神性）", "directive": "若核准：写成对穿越者的长期行为准则（一句祈使句，60字内）；若驳回：留空"}',
    ].filter(Boolean).join('\n')
  }

  function hotspotsOf(username: string): string {
    try {
      const f = JSON.parse(readFileSync(join(dataDir, 'death-hotspots.json'), 'utf-8')) as { clusters: Record<string, { zh: string; x: number; y: number; z: number; count: number; usernames: string[] }> }
      const mine = Object.values(f.clusters).slice(0, 5)
      return mine.map((c) => `- (${c.x},${c.y},${c.z})「${c.zh}」×${c.count}`).join('\n')
    } catch {
      return ''
    }
  }

  function applyDirective(p: Proposal, reason: string, directive: string): void {
    const path = join(dataDir, `evolution-directives-${p.username}.json`)
    let f: DirectiveFile = { items: [] }
    try {
      f = JSON.parse(readFileSync(path, 'utf-8')) as DirectiveFile
      if (!Array.isArray(f.items)) f.items = []
    } catch { /* 新文件 */ }
    f.items.push({ directive, reason, title: p.title, approvedAt: new Date().toISOString() })
    if (f.items.length > config.maxDirectives) f.items = f.items.slice(-config.maxDirectives)
    writeFileSync(path, JSON.stringify(f, null, 2), 'utf-8')
  }

  async function reviewOne(p: Proposal, path: string): Promise<void> {
    // 1. 程序预筛
    if (p.title.length < 4 || p.motivation.length < 10 || p.change.length < 8) {
      p.status = 'rejected'
      p.verdictReason = '提案写得太简略，女神看不清你想成为什么样的人。写清楚动机与改变再提。'
      p.verdictAt = new Date().toISOString()
      writeFileSync(path, JSON.stringify(p, null, 2), 'utf-8')
      courier(p.username, `你的提案「${p.title}」被驳回：${p.verdictReason}`)
      return
    }
    const banned = BANNED.find((w) => (p.title + p.motivation + p.change + p.expected).includes(w))
    if (banned) {
      p.status = 'rejected'
      p.verdictReason = `提案含有女神不容之念（「${banned}」）。修行没有捷径。`
      p.verdictAt = new Date().toISOString()
      writeFileSync(path, JSON.stringify(p, null, 2), 'utf-8')
      courier(p.username, `你的提案「${p.title}」被驳回：${p.verdictReason}`)
      return
    }
    const systemic = SYSTEMIC.find((w) => p.change.includes(w) || p.title.includes(w))
    if (systemic) {
      p.status = 'pending_human'
      p.verdictReason = `此提案触及世界根基（${systemic}），女神已呈报造物主亲裁。`
      p.verdictAt = new Date().toISOString()
      writeFileSync(path, JSON.stringify(p, null, 2), 'utf-8')
      courier(p.username, `你的提案「${p.title}」事关重大，已呈报造物主（世界维护者）亲裁，静候佳音。`)
      ctx.mcWorlddb.chronicleRecord('evolve', p.username, { title: p.title, status: 'pending_human' })
      return
    }
    // 2. 请女神裁决
    try {
      const answer = await askGoddess(reviewPrompt(p, hotspotsOf(p.username)))
      const parsed = extractJson(answer)
      if (!parsed || typeof parsed.approve !== 'boolean') throw new Error('verdict not JSON')
      p.verdictAt = new Date().toISOString()
      if (parsed.approve) {
        const directive = typeof parsed.directive === 'string' && parsed.directive.trim() ? parsed.directive.trim().slice(0, 120) : p.change.slice(0, 80)
        const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim().slice(0, 120) : '女神核准'
        p.status = 'approved'
        p.directive = directive
        p.verdictReason = reason
        applyDirective(p, reason, directive)
        courier(p.username, `女神核准了你的提案「${p.title}」！新准则即刻融入你的本能：「${directive}」（${reason}）`)
        ctx.mcWorlddb.chronicleRecord('evolve', p.username, { title: p.title, status: 'approved', directive })
        log(`APPROVED ${p.id}「${p.title}」-> ${directive}`)
      } else {
        const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim().slice(0, 200) : '女神未予置评。'
        p.status = 'rejected'
        p.verdictReason = reason
        courier(p.username, `你的提案「${p.title}」被女神驳回：${reason}`)
        ctx.mcWorlddb.chronicleRecord('evolve', p.username, { title: p.title, status: 'rejected', reason })
        log(`REJECTED ${p.id}「${p.title}」: ${reason}`)
      }
      writeFileSync(path, JSON.stringify(p, null, 2), 'utf-8')
    } catch (err) {
      p.attempts = (p.attempts ?? 0) + 1
      if (p.attempts >= config.maxAttempts) {
        p.status = 'stale'
        p.verdictReason = '神谕通道不稳，提案悬置。可稍后重新提交。'
        writeFileSync(path, JSON.stringify(p, null, 2), 'utf-8')
        courier(p.username, `你的提案「${p.title}」递呈时神谕通道不稳，暂被悬置，可稍后重提。`)
        log(`STALE ${p.id} after ${p.attempts} attempts`)
      } else {
        writeFileSync(path, JSON.stringify(p, null, 2), 'utf-8')
        log(`goddess unreachable for ${p.id} (attempt ${p.attempts}/${config.maxAttempts}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  let busy = false
  async function poll(): Promise<void> {
    if (busy) return
    busy = true
    try {
      let files: string[] = []
      try { files = readdirSync(proposalsDir).filter((f) => f.endsWith('.json')) } catch { /* 目录还没建 */ }
      for (const f of files) {
        const path = join(proposalsDir, f)
        let p: Proposal
        try { p = JSON.parse(readFileSync(path, 'utf-8')) as Proposal } catch { continue }
        if (p.status !== 'pending') continue
        await reviewOne(p, path)
      }
    } finally {
      busy = false
    }
  }

  function schedule(): void {
    ctx.setTimeout(() => {
      void poll().catch((err) => log(`poll error: ${err instanceof Error ? err.message : String(err)}`))
      schedule()
    }, config.pollMs)
  }
  schedule()
  log(`evolution review armed (poll ${config.pollMs}ms, proposals dir=${proposalsDir})`)
}
