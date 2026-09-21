// build-idmap.cjs — 由 dump 的 tsv + minecraft-data 原版表生成 gate 用 idmap.json
// 前置: /botgate dumpids 已跑, 已把 dump/botgate-ids/{blocks.tsv,items.tsv} 拷到本目录 idmap-dump/
'use strict'
const fs = require('fs')
const path = require('path')
// 直读 minecraft-data 落盘 json（neoforge-handshake 容器同款路径），不依赖库签名
const MDD = 'D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/minecraft-data/minecraft-data/data/pc/1.21.1/'
const v = { blocks: JSON.parse(fs.readFileSync(MDD + 'blocks.json', 'utf8')),
            items: JSON.parse(fs.readFileSync(MDD + 'items.json', 'utf8')) }
if (!v.blocks || !v.blocks.length) { console.error('minecraft-data 载入失败 ✗'); process.exit(1) }

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
      // 服务端状态数与原版表不等（模组给原版方块加了属性，如 note_block 多几种乐器）
      // 旧写法把整段全塌到基态（states=vBase）→ 同一方块的不同状态被压平，细节丢失 ✗
      // 与下方 modFallback 分支保持一致：逐号推进并夹在原版段内（vBase+min(k,vcnt-1)）✓
      for (let k = 0; k < cnt; k++) states[neoBaseN + k] = vBase + Math.min(k, Math.max(0, vcnt - 1))
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

// ── 模组物品 → 「最接近的原版物品」三级递进（2026-09-21 造物主谕「别一律 paper」）──
// 级1：与 mod 方块同名 → 用该方块映射到的原版块的对应物品（语义最准 ✓ 例 prefab:block_compressed_stone → stone_bricks 物品）
// 级2：名字里的语义家族（武器/甲/食物/卷册/矿石…）→ 最像的原版物品
// 级3：都没命中 → paper（保留旧行为 ✓ 不崩）
// 注意：代理号只影响**显示与识别**，不是可操作身份；要真用模组物品请拿完整 id（RCON give / /mycli）
const IFAM = [
  [/helmet|cap\b|hood|crown|headband|coif|mask/i, 'leather_helmet'],
  [/chestplate|chestguard|tunic|robe|coat|vest|gown|hauberk/i, 'leather_chestplate'],
  [/legging|pant|trouser|chaps|greave_(?!.*boot)/i, 'leather_leggings'],
  [/boots|boot\b|shoe|sandal|sneaker|sabatons/i, 'leather_boots'],
  [/sword|blade|katana|sabre|saber|gladius|greatsword|dagger|knife|cleaver|machete/i, 'iron_sword'],
  [/pickaxe|pick_(axe|axe_|pick)|miner/i, 'iron_pickaxe'],
  [/axe|hatchet|tomahawk|chopper/i, 'iron_axe'],
  [/shovel|spade|scoop|trowel/i, 'iron_shovel'],
  [/hoe|mattock|cultivator/i, 'iron_hoe'],
  [/crossbow/i, 'crossbow'],
  [/\bbow\b|bow$/i, 'bow'],
  [/shield|buckler/i, 'shield'],
  [/spear|lance|trident|halberd|pike|javelin/i, 'trident'],
  [/mace|hammer|club|staff|wand|scepter|stave|rod\b/i, 'blaze_rod'],
  [/fishing_rod|fishpole/i, 'fishing_rod'],
  [/shears|clippers|sickle/i, 'shears'],
  [/saddle/i, 'saddle'],
  [/lead|reins|leash|halter/i, 'lead'],
  [/brush\b/i, 'brush'],
  [/flint_(and_)?steel|flintsteel|igniter/i, 'flint_and_steel'],
  [/totem/i, 'totem_of_undying'],
  [/name_tag|nametag/i, 'name_tag'],
  [/minecart/i, 'minecart'],
  [/boat\b/i, 'oak_boat'],
  [/bucket|pail|cauldron|kettle/i, 'bucket'],
  [/scroll|tome|grimoire|codex|spellbook|manual|journal/i, 'enchanted_book'],
  [/^book$|notebook|diary|ledger|album/i, 'writable_book'],
  [/potion|flask|philter|elixir|tonic|brew/i, 'potion'],
  [/bottle|vial/i, 'glass_bottle'],
  [/xp_|exp_|xorb|essence|experience|mana_|arcane_shard/i, 'experience_bottle'],
  [/ingot|billet|\bbar\b|bloom/i, 'iron_ingot'],
  [/raw_(iron|gold|copper)|cluster/i, 'raw_iron'],
  [/gem|diamond|jewel|prism|zircon|sapphire|rutile/i, 'diamond'],
  [/shard|fragment|crystal|splinter/i, 'amethyst_shard'],
  [/dust|powder|pollen|ash(?:es)?\b|cinder|soot/i, 'glowstone_dust'],
  [/nugget|scrap|bit\b|chip/i, 'iron_nugget'],
  [/cloth|fabric|silk|banner|flag|rug|carpet|tapestry|curtain/i, 'white_wool'],
  [/wool|fleece|yarn|thread|string|sinew|cord|rope|wire|cable/i, 'string'],
  [/feather|quill|plume/i, 'feather'],
  [/leather|hide|pelt|skin|membrane|blubber/i, 'leather'],
  [/bone|fang|tusk|horn|antler|rib|skull/i, 'bone'],
  [/shell|conch|coral|pearl|scallop|snail/i, 'nautilus_shell'],
  [/mushroom|fungus|spore|mycel|toadstool/i, 'brown_mushroom'],
  [/berry|fruit|apple|plum|cherry|mango|peach|grape|melon_slice/i, 'apple'],
  [/bread|bun|loaf|toast|baguette/i, 'bread'],
  [/meat|steak|beef|pork|venison|flesh|ribs|chop/i, 'cooked_beef'],
  [/stew|soup|broth|chili|curry|ramen|porridge/i, 'mushroom_stew'],
  [/cookie|biscuit|cake|pie|pastry|candy|sweet/i, 'cookie'],
  [/seed|grain|wheat|oat|rice|kernel|nut|acorn|corn|bean/i, 'wheat'],
  [/spawn_?egg|mob_?egg|effigy/i, 'chicken_spawn_egg'],   // 必须先于 /egg/ ✓ 否则刷怪蛋被当成普通蛋
  [/egg\b|roe\b|omlette|omelet/i, 'egg'],
  [/music|disc|record|vinyl|tune/i, 'music_disc_13'],
  [/clock|watch|compass|gps|scanner|tracker/i, 'compass'],
  [/^map$|atlas|chart|waypoint/i, 'map'],
  [/torch|lantern|lamp|light|bulb|candle|glow/i, 'lantern'],
  [/key|badge|card|token|coin|money|medal|seal|通宝/i, 'gold_nugget'],
  [/bag|sack|pouch|purse|pack|bundle|crate|box/i, 'bundle'],
  [/bed\b/i, 'red_bed'],
  [/flower|rose|daisy|tulip|blossom|petal|lavender|dandelion/i, 'poppy'],
  [/leaf|leaves|vine|ivy|kelp|grass|turf|sod|fern|moss|hay/i, 'kelp'],
  [/sand|gravel|dirt|soil|mud|clay|pottery|ceramic/i, 'clay_ball'],
  [/glass|pane/i, 'glass'],
  [/coal|charcoal|carbon|coke/i, 'coal'],
  [/redstone/i, 'redstone'],
  [/lapis|lazuli/i, 'lapis_lazuli'],
  [/quartz/i, 'quartz'],
  [/emerald/i, 'emerald'],
  [/netherite|ancient_debris/i, 'netherite_scrap'],
  [/gold|gilded|aurum|electrum/i, 'gold_ingot'],
  [/copper/i, 'copper_ingot'],
  [/steel|iron|ferrous|wrought/i, 'iron_ingot'],
  [/slime|goo|jelly|pudding|snot/i, 'slime_ball'],
  [/gunpowder|bomb|explosive|grenade|dynamite|tnt/i, 'gunpowder'],
  [/ender|void|dimension|portal|gate_(?!.*key)/i, 'ender_pearl'],
  [/fire|flame|ember|lava|burn|blaze|scorch|pyro/i, 'blaze_powder'],
  [/ice|frost|snow|winter|permafrost/i, 'packed_ice'],
  [/eye|ocular|vision|sight|lens|optic/i, 'ender_eye'],
  [/\bstar\b|stellar|astral|cosmic/i, 'nether_star'],
  [/sponge/i, 'sponge'],
  [/anchor|beacon|obelisk|totem_pole/i, 'respawn_anchor'],
  [/brick|tile|panel|plank|slab_(?!.*log)|block/i, 'stone_bricks'],   // 通用"建材/块"垫底
]
function iFamOf (name) {
  const short = name.includes(':') ? name.split(':')[1] : name
  for (const [re, target] of IFAM) if (re.test(short)) return target
  return null
}
// 级2.0：工具/护甲保留**材质等级**（造物主谕「映射到最接近的原版」→ 钻石剑就该长得像钻石剑）
// 先判种类再判材质，组合出的名字必须在原版物品表里真存在，否则降级（wooden_helmet 不存在 → leather ✓）
const MAT = [
  [/netherite/i, 'netherite'],
  [/diamond|prism|crystal|rutile|zircon/i, 'diamond'],
  [/golden|gold\b|aurum|electrum/i, 'golden'],
  [/ferrous|wrought|iron|steel|osmium|bronze|copper|tin|cadmium/i, 'iron'],
  [/stone|granite|basalt|cobble|obsidian|deepslate|end.?stone/i, 'stone'],
  [/leather|hide|pelt|scales/i, 'leather'],
  [/wood|oak|birch|spruce|jungle|acacia|mangrove|cherry|bamboo|timber|log\b|plank/i, 'wooden'],
]
const KIND_TOOL = [[/pickaxe|miner\b/i, 'pickaxe'], [/^\w*axe|axe_|_axe|chopper|hatchet|tomahawk/i, 'axe'],
  [/shovel|spade|trowel|scoop/i, 'shovel'], [/hoe|mattock|cultivator/i, 'hoe'],
  [/sword|blade|katana|sabre|saber|gladius|greatsword|dagger|knife|cleaver|machete|falx/i, 'sword']]
const KIND_ARMOR = [[/helmet|hood|crown|headband|coif|cap\b/i, 'helmet'],
  [/chestplate|chestguard|tunic|robe|coat|vest|gown|hauberk/i, 'chestplate'],
  [/legging|pant|trouser|chaps|greaves/i, 'leggings'],
  [/boots|boot\b|shoes|sabatons|sollerets/i, 'boots']]
function tierFamOf (name) {
  const short = name.includes(':') ? name.split(':')[1] : name
  let kind = null, armor = false
  for (const [re, k] of KIND_TOOL) if (re.test(short)) { kind = k; break }
  if (!kind) { armor = true; for (const [re, k] of KIND_ARMOR) if (re.test(short)) { kind = k; break } }
  if (!kind) return null
  let mat = armor ? 'leather' : 'iron'
  for (const [re, m] of MAT) { if (re.test(short)) { mat = m; break } }
  if (armor && (mat === 'wooden' || mat === 'stone')) mat = 'leather'     // 原版无木/石头盔 ✓
  const cand = mat + '_' + kind
  return vi.has(cand) ? cand : (vi.has((armor ? 'leather' : 'iron') + '_' + kind) ? (armor ? 'leather' : 'iron') + '_' + kind : null)
}
const it = fs.readFileSync(path.join(DUMP, 'items.tsv'), 'utf8').split('\n').filter(Boolean)
const vi = new Map()
for (const i of v.items) vi.set(String(i.name).replace(/^minecraft:/, ''), i)
const paper = vi.get('paper') ? vi.get('paper').id : 339
// fail-fast：规则里写错的原版名会把 undefined 灌进号表 ✗（线上表现为物品变未知号）→ 建表时先全量校验并告警
const badRules = []
for (const [re, target] of IFAM) if (!vi.has(target)) badRules.push(String(re) + '→' + target)
if (badRules.length) console.log('  ⚠ IFAM 失效规则（目标名不在 1.21.1 原版物品表）:\n    ' + badRules.join('\n    '))
const itemSrc = { byTarget: {}, blockItem: 0, tier: 0, family: 0, paper: 0 }
for (const line of it) {
  const [name, nid] = line.split('\t')
  const neoN = Number(nid)
  if (name.startsWith('minecraft:')) {
    const rec = vi.get(name.slice(10))
    if (rec) { items[neoN] = rec.id; continue }
  }
  let tgt = null, why = null
  const blk = report.modFallback[name]                    // 级1：同名 mod 方块已映射到的原版块
  if (blk && vi.get(blk)) { tgt = blk; why = 'blockItem' }
  if (!tgt) {
    const t = tierFamOf(name)                             // 级2.0：工具/甲（保材质等级）
    if (t && vi.get(t)) { tgt = t; why = 'tier' }
  }
  if (!tgt) {
    const s = iFamOf(name)                                // 级2.1：通用语义家族
    if (s && vi.get(s)) { tgt = s; why = 'family' }
  }
  if (tgt) {
    items[neoN] = vi.get(tgt).id
    itemSrc.byTarget[tgt] = (itemSrc.byTarget[tgt] || 0) + 1
    if (why === 'blockItem') itemSrc.blockItem++
    else if (why === 'tier') itemSrc.tier++
    else itemSrc.family++
  } else {
    items[neoN] = paper; report.modItemFallback++; itemSrc.paper++   // 级3：兜底 paper
  }
}
for (const [short, rec] of vi) {
  if (!it.some(l => l.split('\t')[0] === 'minecraft:' + short)) report.vanillaItemNoDump++
}

const topTargets = Object.entries(itemSrc.byTarget).sort((a, b) => b[1] - a[1]).slice(0, 15)
const out = {
  generatedAt: new Date().toISOString(),
  states, items,
  fallbackBlockState: (vb2.get('stone') || { minStateId: 1 }).minStateId,
  report: { ...report, modFallbackCount: Object.keys(report.modFallback).length,
            modFallbackSample: Object.entries(report.modFallback).slice(0, 40),
            itemMapping: { blockItem: itemSrc.blockItem, tier: itemSrc.tier, family: itemSrc.family, paper: itemSrc.paper,
                           distinctTargets: Object.keys(itemSrc.byTarget).length,
                           topTargets, badRules } }
}
fs.writeFileSync(path.join(__dirname, 'idmap.json'), JSON.stringify(out))
console.log(`idmap.json 生成 ✓ states=${Object.keys(states).length} items=${Object.keys(items).length} matched=${report.matched} stateMismatch=${report.stateMismatch} modFallback=${Object.keys(report.modFallback).length}`)
console.log(`物品映射 ✓ 同名方块=${itemSrc.blockItem} 工具甲(带材质)=${itemSrc.tier} 语义家族=${itemSrc.family} 仍兜paper=${itemSrc.paper} 覆盖到 ${Object.keys(itemSrc.byTarget).length} 种原版代理物（失效规则 ${badRules.length} 条）`)
console.log('  代理物 Top10:', topTargets.slice(0, 10).map(([k, n]) => k + '=' + n).join(' '))
