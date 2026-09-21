// build-idmap.cjs — 由 dump 的 tsv + minecraft-data 原版表生成 gate 用 idmap.json
// 前置: /botgate dumpids 已跑, 已把 dump/botgate-ids/{blocks.tsv,items.tsv} 拷到本目录 idmap-dump/
'use strict'
const fs = require('fs')
const path = require('path')
const md = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/minecraft-data')
const v = md('pc', '1.21.1')

const DUMP = path.join(__dirname, 'idmap-dump')
const states = {}
const items = {}
const report = { matched: 0, stateMismatch: 0, modFallback: {}, unknownVanilla: [], modItemFallback: 0, vanillaItemNoDump: 0 }

const vb = new Map()
for (const b of v.blocks) vb.set('minecraft:' + b.name.replace('minecraft:', ''), b)
// minecraft-data 名字一般无前缀
const vb2 = new Map()
for (const b of v.blocks) vb2.set(String(b.name).replace(/^minecraft:/, ''), b)

function vanillaBase (name) {
  const short = name.startsWith('minecraft:') ? name.slice(10) : null
  if (short == null) return null
  return vb2.get(short) || null
}

// 家族兜底：mod 块 → 选个像的原版块（short name）
const FAM = [
  [/lamp|light|lantern|glow/i, 'glowstone'],
  [/roof|ceiling/i, 'stone_bricks'],
  [/stair/i, 'stone_stairs'],
  [/slab/i, 'smooth_stone_slab'],
  [/window|glass/i, 'glass'],
  [/door|gate/i, 'oak_door'],
  [/fence|rail/i, 'oak_fence'],
  [/flower|pot|plant|sapling|leaves/i, 'potted_dandelion'],
  [/book/i, 'bookshelf'],
  [/table|chair|counter|sink|shelf|cabinet|locker|drawer|chest/i, 'oak_planks'],
  [/bell/i, 'bell'],
  [/ore/i, 'iron_ore'],
  [/log|plank|wood|beam|post|pole/i, 'oak_log'],
  [/brick|stone|wall|path|floor|road|pave/i, 'stone_bricks'],
]
function famOf (name) {
  for (const [re, target] of FAM) if (re.test(name)) return target
  return 'stone'
}

const blocks = fs.readFileSync(path.join(DUMP, 'blocks.tsv'), 'utf8').split('\n').filter(Boolean)
for (const line of blocks) {
  const [name, , neoBase, cntS] = line.split('\t')
  const neoBaseN = Number(neoBase), cnt = Number(cntS)
  const vrec = vanillaBase(name)
  if (vrec) {
    const vcnt = vrec.maxStateId - vrec.minStateId + 1
    const vBase = vrec.minStateId
    if (vcnt === cnt) {
      for (let k = 0; k < cnt; k++) states[neoBaseN + k] = vBase + k
      report.matched++
    } else {
      for (let k = 0; k < cnt; k++) states[neoBaseN + k] = vBase
      report.stateMismatch++
    }
  } else {
    const t = famOf(name)
    const rec = vb2.get(t) || vb2.get('stone')
    const base = rec.minStateId
    const c = rec.maxStateId - rec.minStateId + 1
    for (let k = 0; k < cnt; k++) states[neoBaseN + k] = base + Math.min(k, c - 1)
    report.modFallback[name] = t
  }
}

const it = fs.readFileSync(path.join(DUMP, 'items.tsv'), 'utf8').split('\n').filter(Boolean)
const vi = new Map()
for (const i of v.items) vi.set(String(i.name).replace(/^minecraft:/, ''), i)
const paper = vi.get('paper') ? vi.get('paper').id : 339
for (const line of it) {
  const [name, nid] = line.split('\t')
  if (!name.startsWith('minecraft:')) { items[Number(nid)] = paper; report.modItemFallback++; continue }
  const rec = vi.get(name.slice(10))
  if (rec) items[Number(nid)] = rec.id
}
for (const [short, rec] of vi) {
  if (!it.some(l => l.split('\t')[0] === 'minecraft:' + short)) report.vanillaItemNoDump++
}

const out = {
  generatedAt: new Date().toISOString(),
  states, items,
  fallbackBlockState: (vb2.get('stone') || { minStateId: 1 }).minStateId,
  report: { ...report, modFallbackCount: Object.keys(report.modFallback).length,
            modFallbackSample: Object.entries(report.modFallback).slice(0, 40) }
}
fs.writeFileSync(path.join(__dirname, 'idmap.json'), JSON.stringify(out))
console.log(`idmap.json 生成 ✓ states=${Object.keys(states).length} items=${Object.keys(items).length} matched=${report.matched} stateMismatch=${report.stateMismatch} modFallback=${Object.keys(report.modFallback).length} modItems→fallback=${report.modItemFallback}`)
