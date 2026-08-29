// 造物白名单镜像生成器（2026-08-30 造物扩展）：
// 从 src/mc-magic.ts 的 GIVE_WHITELIST + GIVE_DEFAULT_COUNT 生成 skill-chest.json
// 的 items 段——TS 是正本，json 是镜像；CI 一致性测试对账（tests/js/give-whitelist-sync.test.mjs）。
//
// 用法：node scripts/gen-give-items.mjs [skill-chest.json 路径]
// 缺省写 ops/docker/shadow/mcdata/skill-chest.json（运行卷），同时刷
// packaging/mc-world/assets/data/skill-chest.json（分发正本）。
import { readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ts = readFileSync(resolve(root, 'src/mc-magic.ts'), 'utf8')

function extractObject(name) {
  const start = ts.indexOf(`export const ${name}`)
  if (start < 0) throw new Error(`${name} not found in mc-magic.ts`)
  const braceStart = ts.indexOf('{', start)
  let depth = 0, i = braceStart
  for (; i < ts.length; i++) {
    if (ts[i] === '{') depth++
    else if (ts[i] === '}') { depth--; if (depth === 0) break }
  }
  return ts.slice(braceStart, i + 1)
}

// 轻量解析：抓 '中文名': 'en_id' 与 en: n（GIVE_DEFAULT_COUNT 值是数字）
const whitelistSrc = extractObject('GIVE_WHITELIST')
const countSrc = extractObject('GIVE_DEFAULT_COUNT')
const entries = [...whitelistSrc.matchAll(/'([^']+)':\s*'([a-z0-9_]+)'/g)]
const counts = new Map([...countSrc.matchAll(/([a-z0-9_]+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]))

// 同义词折叠：多个中文名映射同一物品时取首个为主（如 木头→oak_log 让位 橡木）
const seen = new Set()
const items = []
for (const [, cn, en] of entries) {
  if (seen.has(en)) continue
  seen.add(en)
  items.push({ cn, icon: en, count: counts.get(en) ?? 1 })
}

const targets = [
  resolve(root, 'ops/docker/shadow/mcdata/skill-chest.json'),
  resolve(root, 'packaging/mc-world/assets/data/skill-chest.json'),
]
for (const t of targets) {
  let cfg = { version: 1 }
  if (existsSync(t)) {
    try { cfg = JSON.parse(readFileSync(t, 'utf8')) } catch { cfg = { version: 1 } }
  } else {
    // 分发正本缺省骨架（icons 段与运行卷一致）
    cfg = JSON.parse(readFileSync(targets[0], 'utf8'))
  }
  cfg.items = items
  writeFileSync(t, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  console.log(`${t}: ${items.length} items`)
}
// 运行卷先写，分发正本后写——若顺序反了（分发不存在）直接拷运行卷全量，保证两份一致
if (!existsSync(targets[1])) cpSync(targets[0], targets[1])
