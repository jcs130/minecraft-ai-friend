// 造物白名单一致性测试（2026-08-30 造物扩展）：
// TS GIVE_WHITELIST/GIVE_DEFAULT_COUNT（正本） ↔ skill-chest.json items 段（镜像）
// ↔ packaging 分发正本——三者必须同步，防「五份漂移」。
// 跑法：node --test tests/js/give-whitelist-sync.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ts = readFileSync(resolve(root, 'src/mc-magic.ts'), 'utf8')

function extractObject(name) {
  const start = ts.indexOf(`export const ${name}`)
  if (start < 0) throw new Error(`${name} not found`)
  const braceStart = ts.indexOf('{', start)
  let depth = 0, i = braceStart
  for (; i < ts.length; i++) {
    if (ts[i] === '{') depth++
    else if (ts[i] === '}') { depth--; if (depth === 0) break }
  }
  return ts.slice(braceStart, i + 1)
}

const wl = [...extractObject('GIVE_WHITELIST').matchAll(/'([^']+)':\s*'([a-z0-9_]+)'/g)]
const counts = new Map([...extractObject('GIVE_DEFAULT_COUNT').matchAll(/([a-z0-9_]+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]))
// 同义词折叠（镜像生成器同规则：一物品取首中文名）
const expect = new Map()
for (const [, cn, en] of wl) if (!expect.has(en)) expect.set(en, { cn, count: counts.get(en) ?? 1 })

const runtimePath = resolve(root, 'ops/docker/shadow/mcdata/skill-chest.json')
// 运行卷副本是部署产物（不入库）：CI 干净 checkout 缺失时跳过运行卷对账；
// packaging 分发正本入库，必须存在且与 TS 全量一致（硬断言）。
const runtime = existsSync(runtimePath)
  ? JSON.parse(readFileSync(runtimePath, 'utf8'))
  : null
const dist = JSON.parse(readFileSync(resolve(root, 'packaging/mc-world/assets/data/skill-chest.json'), 'utf8'))

test('分发正本 items 与 TS GIVE_WHITELIST 全量一致', () => {
  const got = new Map(dist.items.map((it) => [it.icon, { cn: it.cn, count: it.count }]))
  assert.equal(got.size, expect.size, `物品数不一致：ts=${expect.size} json=${got.size}`)
  for (const [en, exp] of expect) {
    assert.deepEqual(got.get(en), exp, `${en} 不一致：ts=${JSON.stringify(exp)} json=${JSON.stringify(got.get(en))}`)
  }
})

test('运行卷与分发正本 items 一致（防五份漂移；CI 无运行卷时跳过）', () => {
  if (!runtime) return
  assert.deepEqual(runtime.items, dist.items)
})

test('count 护栏 1-16', () => {
  for (const it of dist.items) {
    assert.ok(it.count >= 1 && it.count <= 16, `${it.icon} count=${it.count} 越界`)
  }
})
