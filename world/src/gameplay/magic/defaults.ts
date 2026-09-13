// Existing fallback definitions. The configured atom file remains authoritative.
import type { Atom } from './contracts.ts'

// ── 数字梯度：默认原子指令表（可被 data/magic-atoms.json 覆盖）────────
// mana 上限 100 / 回蓝每秒 2.0（= Iron's 每秒 2% 上限，满蓝 50s）。
// 三资源消耗：mana=时间回蓝，food=吃回（data modify foodLevel），hp=血祭（damage magic 无视护甲）。
export const GIVE_WHITELIST: Record<string, string> = {
  '苹果': 'apple', '面包': 'bread', '熟牛肉': 'cooked_beef', '熟猪排': 'cooked_porkchop',
  '熟鸡肉': 'cooked_chicken', '熟鳕鱼': 'cooked_cod', '熟鲑鱼': 'cooked_salmon',
  '胡萝卜': 'carrot', '土豆': 'potato', '烤土豆': 'baked_potato', '西瓜': 'melon_slice',
  '橡木': 'oak_log', '木头': 'oak_log', '云杉木': 'spruce_log', '白桦木': 'birch_log',
  '木板': 'oak_planks', '木棍': 'stick', '圆石': 'cobblestone', '石头': 'stone',
  '煤': 'coal', '铁锭': 'iron_ingot', '铜锭': 'copper_ingot', '火把': 'torch',
  '木镐': 'wooden_pickaxe', '石镐': 'stone_pickaxe', '铁镐': 'iron_pickaxe',
  '木斧': 'wooden_axe', '石斧': 'stone_axe', '铁斧': 'iron_axe',
  '木剑': 'wooden_sword', '石剑': 'stone_sword', '铁剑': 'iron_sword',
  '木锹': 'wooden_shovel', '石锹': 'stone_shovel',
  // 基建/工作设施（穿越者要建家冶炼的需求）
  '熔炉': 'furnace', '高炉': 'blast_furnace', '工作台': 'crafting_table',
  '锻造台': 'smithing_table', '铁砧': 'anvil', '箱子': 'chest', '木桶': 'barrel',
  '玻璃': 'glass', '沙子': 'sand', '泥土': 'dirt', '石砖': 'stone_bricks',
  '梯子': 'ladder', '栅栏': 'oak_fence', '门': 'oak_door', '床': 'white_bed',
  '箭': 'arrow', '弓': 'bow', '盾牌': 'shield', '灯笼': 'lantern',
  '铁盔甲': 'iron_chestplate', '铁剑鞘': 'iron_helmet',
  // 2026-08-30 造物扩展：甜点/零食/手工材料（萌萌向：体验/探索/创意）
  '蛋糕': 'cake', '饼干': 'cookie', '南瓜派': 'pumpkin_pie', '甜浆果': 'sweet_berries',
  '发光浆果': 'glow_berries', '蜂蜜瓶': 'honey_bottle', '牛奶': 'milk_bucket',
  '纸': 'paper', '书': 'book', '墨囊': 'ink_sac', '羽毛': 'feather', '线': 'string',
  '皮革': 'leather', '燧石': 'flint', '骨粉': 'bone_meal', '砖块': 'brick',
  '铁轨': 'rail', '雪球': 'snowball', '花盆': 'flower_pot', '画': 'painting',
  '音符盒': 'note_block', '红石': 'redstone',
  // 收纳（2026-08-30 造物主谕「背包不够用了」）：Sophisticated Backpacks 已在服。
  // 注意「背包」⊂「大背包」——extractItem 已改最长匹配，防截胡。
  '背包': 'sophisticatedbackpacks:backpack', '大背包': 'sophisticatedbackpacks:iron_backpack',
}

/**
 * 造物分类默认数量（2026-08-30）：按物品定 give 数——食物×4、原料×8、
 * 工具装备×1、其他默认×1。key = GIVE_WHITELIST 的英文 id；未列出的回退 1。
 * 护栏：填模板时 max(1, min(16, n))。
 */
export const GIVE_DEFAULT_COUNT: Record<string, number> = {
  apple: 4, bread: 4, cooked_beef: 4, cooked_porkchop: 4, cooked_chicken: 4,
  cooked_cod: 4, cooked_salmon: 4, carrot: 4, potato: 4, baked_potato: 4,
  melon_slice: 4, cake: 1, cookie: 8, pumpkin_pie: 4, sweet_berries: 8,
  glow_berries: 8, honey_bottle: 2, milk_bucket: 1,
  oak_log: 8, spruce_log: 8, birch_log: 8, oak_planks: 16, stick: 8,
  cobblestone: 16, stone: 16, coal: 8, iron_ingot: 4, copper_ingot: 4,
  glass: 8, sand: 8, dirt: 8, stone_bricks: 8, oak_fence: 4, ladder: 4,
  arrow: 8, torch: 4, lantern: 2, paper: 8, book: 2, ink_sac: 4, feather: 4,
  string: 4, leather: 4, flint: 4, bone_meal: 8, brick: 8, rail: 8,
  snowball: 8, redstone: 8,
  'sophisticatedbackpacks:backpack': 1, 'sophisticatedbackpacks:iron_backpack': 1,
}

export const DEFAULT_ATOMS: Atom[] = [
  {
    id: 'home', layer: 'effect', category: 'support', name: '归乡',
    words: ['归乡', '回家', '回基地', '归途', '回巢'],
    cost: { mana: 20, food: 0, hp: 0 },
    commands: ['tp {target} {bx} {by} {bz}'],
    reply: '空间之力涌动，你被送回基地。',
    particles: [
      'minecraft:portal {bx} {by+1} {bz} 0.5 0.5 0.5 0.3 80',
      'minecraft:end_rod {bx} {by+1} {bz} 0.4 0.4 0.4 0.05 50',
    ],
    sounds: ['minecraft:entity.enderman.teleport'],
    title: '归乡',
    subtitle: '空间之力，护你归途',
  },
  {
    id: 'tp', layer: 'effect', category: 'support', name: '空间传送',
    words: ['传送', '瞬移', '闪现', '撕裂虚空', '空间跳跃', '跃迁'],
    cost: { mana: 20, food: 0, hp: 0 },
    paramCosts: { distance: { mana: 5 } },
    params: {
      distance: { type: 'number', default: 5, max: 30 },
      direction: { type: 'direction', default: '东' },
    },
    commands: ['tp {target} {tx} {ty} {tz}'],
    reply: '虚空撕开一道裂缝，你向{direction}跃迁 {distance} 格。',
    particles: [
      'minecraft:end_rod {tx} {ty+1} {tz} 0.4 0.4 0.4 0.05 60',
      'minecraft:portal {tx} {ty+1} {tz} 0.5 0.5 0.5 0.3 50',
    ],
    sounds: ['minecraft:entity.enderman.teleport'],
    title: '撕裂虚空',
    subtitle: '向{direction}跃迁 {distance} 格',
  },
  {
    id: 'heal', layer: 'effect', category: 'support', name: '圣愈术',
    words: ['圣愈', '治愈', '治疗', '疗伤', '回血', '痊愈'],
    cost: { mana: 30, food: 0, hp: 0 },
    commands: [
      'effect give {target} minecraft:instant_health 1 1',
      'effect give {target} minecraft:saturation 1 20',
    ],
    reply: '柔和的光笼罩你，伤口愈合，饥饿缓解。',
    particles: [
      'minecraft:heart {px} {py+1} {pz} 0.6 0.6 0.6 0.1 25',
      'minecraft:glow {px} {py+1} {pz} 0.4 0.4 0.4 0.01 40',
    ],
    sounds: ['minecraft:block.enchantment_table.use'],
    title: '圣愈',
    subtitle: '柔和的光，抚平伤痛',
  },
  {
    id: 'feed', layer: 'effect', category: 'support', name: '饱食赐福',
    words: ['饱食', '充饥', '饱腹', '不饿', '充能'],
    cost: { mana: 20, food: 0, hp: 0 },
    commands: ['effect give {target} minecraft:saturation 1 99'],
    reply: '神力化作暖流，你的饥饿感消失了。',
    particles: ['minecraft:glow {px} {py+1} {pz} 0.5 0.5 0.5 0.01 30'],
    sounds: ['minecraft:block.note_block.chime'],
    title: '饱食赐福',
    subtitle: '暖流涌动，饥饿消散',
  },
  {
    id: 'give', layer: 'effect', category: 'support', name: '造物术',
    words: ['造物', '赐予', '给予', '赐下', '给我', '变出'],
    cost: { mana: 20, food: 0, hp: 0 },
    params: { item: { type: 'item', default: 'bread' } },
    commands: ['give {target} {item} {count}'],
    reply: '一件物资自虚空中凝聚，落入你的手中。',
    particles: ['minecraft:enchant {px} {py+1} {pz} 0.5 0.5 0.5 0.1 50'],
    sounds: ['minecraft:block.enchantment_table.use'],
    title: '造物',
    subtitle: '虚空中，物质凝成',
  },
  {
    id: 'light', layer: 'effect', category: 'support', name: '照明术',
    words: ['照明', '点火', '火把', '光亮', '照亮', '驱暗'],
    cost: { mana: 5, food: 0, hp: 0 },
    commands: ['give {target} minecraft:torch 4'],
    reply: '几根火把落入你的手中，照亮前路。',
    particles: ['minecraft:flame {px} {py+1} {pz} 0.3 0.3 0.3 0.02 30'],
    sounds: ['minecraft:block.fire.ambient'],
    title: '照明',
    subtitle: '火光，驱散黑暗',
  },
  {
    id: 'time_day', layer: 'effect', category: 'world', name: '破晓术',
    words: ['破晓', '天明', '白昼', '天亮', '日出', '驱夜'],
    cost: { mana: 60, food: 0, hp: 0 },
    commands: ['time set day'],
    reply: '太阳撕裂夜幕，世界重归白昼。',
    particles: [
      'minecraft:firework {px} {py+2} {pz} 0.5 0.5 0.5 0.01 25',
      'minecraft:glow {px} {py+2} {pz} 0.5 0.5 0.5 0.01 30',
    ],
    sounds: ['minecraft:block.beacon.activate'],
    title: '破晓',
    subtitle: '太阳，撕裂夜幕',
  },
  {
    id: 'weather_clear', layer: 'effect', category: 'world', name: '驱云术',
    words: ['驱云', '放晴', '晴空', '雨停', '云散'],
    cost: { mana: 35, food: 0, hp: 0 },
    commands: ['weather clear'],
    reply: '乌云散尽，天空放晴。',
    particles: ['minecraft:cloud {px} {py+2} {pz} 0.5 0.5 0.5 0.05 40'],
    sounds: ['minecraft:block.chain.break'],
    title: '驱云',
    subtitle: '乌云散尽，晴空万里',
  },
  {
    id: 'terraform', layer: 'effect', category: 'utility', name: '大地塑形',
    words: ['塑形', '裂地', '掘土', '开辟', '平整', '挖地'],
    cost: { mana: 30, food: 6, hp: 0 },
    commands: ['fill {px} {py-1} {pz} {px} {py-1} {pz} minecraft:air'],
    reply: '你消耗体力（饱食度），重塑了脚下的大地。',
    particles: ['minecraft:poof {px} {py} {pz} 0.5 0.5 0.5 0.1 40'],
    sounds: ['minecraft:block.gravel.break'],
    title: '大地塑形',
    subtitle: '脚下大地，为你重塑',
  },
  {
    id: 'meteor', layer: 'effect', category: 'attack', name: '陨石术',
    words: ['陨石', '天罚', '星陨', '神雷', '天雷', '雷击'],
    cost: { mana: 80, food: 0, hp: 15 },
    commands: ['summon minecraft:lightning_bolt {tx} {ty} {tz}'],
    reply: '你燃烧生命，召唤天雷轰击前方！',
    particles: [
      'minecraft:lava {tx} {ty+1} {tz} 0.3 0.3 0.3 0.05 30',
      'minecraft:flame {tx} {ty+1} {tz} 0.3 0.3 0.3 0.1 30',
    ],
    sounds: ['minecraft:entity.lightning_bolt.thunder'],
    title: '陨石',
    subtitle: '燃烧生命，天罚降临',
  },
]
