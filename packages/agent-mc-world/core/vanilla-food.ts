/** Java 1.21.1 semantics verified against Mojang's Foods/FoodData and item overrides.
 * Factual references only, not current inventory or server component overrides.
 * See docs/research/vanilla-1.21.1-food-knowledge.md for reproducible provenance.
 */
export const VANILLA_KNOWLEDGE_VERSION = '1.21.1';
export const MOJANG_1211_SOURCE = 'https://piston-meta.mojang.com/v1/packages/499680d659b7a0ccb2fa9a809c345c5baf2ace7d/1.21.1.json';
export const FOOD_COOKING: Readonly<Record<string, string>> = Object.freeze({
  beef: 'cooked_beef', porkchop: 'cooked_porkchop', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit',
  chicken: 'cooked_chicken', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato', kelp: 'dried_kelp',
});
export interface FoodEffect { effect: string; durationTicks: number; amplifier: number; chance: number }
const effect = (effect: string, durationTicks: number, amplifier = 0, chance = 1): FoodEffect =>
  ({ effect, durationTicks, amplifier, chance });
export const FOOD_EFFECTS: Readonly<Record<string, readonly FoodEffect[]>> = {
  chicken: [effect('hunger', 600, 0, .3)], rotten_flesh: [effect('hunger', 600, 0, .8)],
  poisonous_potato: [effect('poison', 100, 0, .6)], spider_eye: [effect('poison', 100)],
  pufferfish: [effect('poison', 1200, 1), effect('hunger', 300, 2), effect('nausea', 300)],
  golden_apple: [effect('regeneration', 100, 1), effect('absorption', 2400)],
  enchanted_golden_apple: [effect('regeneration', 400, 1), effect('resistance', 6000),
    effect('fire_resistance', 6000), effect('absorption', 2400, 3)],
};
export const FOOD_CAUTIONS: Readonly<Record<string, string>> = {
  chicken: '生鸡肉有 30% 概率附加饥饿 I 30 秒；烹饪可消除此默认风险。',
  rotten_flesh: '腐肉有 80% 概率附加饥饿 I 30 秒，饱和度很低；原版没有把腐肉烧成熟肉的配方。',
  poisonous_potato: '毒马铃薯有 60% 概率中毒 5 秒，不是可烧成烤马铃薯的普通马铃薯。',
  spider_eye: '蜘蛛眼必定中毒 5 秒，不能当日常安全口粮。',
  pufferfish: '河豚附加剧毒、饥饿与反胃；原版没有可消毒的熟河豚配方。',
  chorus_fruit: '紫颂果食用后可能随机传送，位置和可通行性必须重新观察。',
  suspicious_stew: '谜之炖菜效果由 minecraft:suspicious_stew_effects 组件决定；仅凭物品名无法确认安全。',
  ominous_bottle: '不祥之瓶不走普通补饥饿路径；饮用附加不祥之兆 6000 秒，等级取决于组件，不是口粮。',
  honey_bottle: '蜂蜜瓶饮用 40 ticks，移除中毒；不移除所有状态效果。',
  golden_apple: '金苹果有再生与伤害吸收效果；日常自动进食保留这种特殊补给。',
  enchanted_golden_apple: '附魔金苹果有再生、抗性、抗火与伤害吸收效果；保留特殊补给。',
};
export const VANILLA_GUIDES = [
  { name: 'food', title: '食物：生肉、熟肉与安全口粮 / raw cooked food',
    content: '优先使用已携带的安全熟食；生牛肉/猪排每个补 3 饥饿与 1.8 饱和，牛排/熟猪排为 8 与 12.8。'
      + '生羊肉 2/1.2，熟羊肉 6/9.6；生鸡肉 2/1.2 且有饥饿风险，熟鸡肉 6/7.2。'
      + '数字单位是点，不是肉图标：一个肉图标表示 2 饥饿点。饱和度决定后续耐饿能力，新增饱和受进食后饥饿值上限限制。'
      + '安全且有烹饪条件时优先把生食加工；饥饿危急或还没有炉子/燃料时可先吃可用的安全生食，不应为了等待熟食饿死。'
      + '鸡蛋 egg 不能直接吃或在原版烧熟，可作为蛋糕/南瓜派的合成材料。蛋糕需放置后交互吃。'
      + '腐肉、毒马铃薯、蜘蛛眼、河豚不能按普通生肉假定可烧熟去毒。查询 food/<实际物品ID> 取得逐项数值和风险。' },
  { name: 'health', title: '生命恢复、饥饿与饱和 / health regeneration hunger saturation',
    content: '食物通常不直接恢复生命。Java 1.21.1 在 naturalRegeneration 开启且需要治疗时：饥饿值 >=18 可每 80 ticks 恢复 1 生命；'
      + '饥饿值 =20 且饱和度 >0 时，每 10 ticks 可恢复 min(饱和度,6)/6 生命。恢复会增加消耗。'
      + '食物饥饿最多 20，饱和最多为当时饥饿值；服务器通常不向客户端同步实际饱和，不可由背包营养推算成当前读数。'
      + '游戏规则、难度、状态效果和服务器修改均可能改变结果，必须观察真实生命/饥饿变化。满饥饿时是否能食用和执行器是否支持要分别核实。' },
  { name: 'cooking', title: '烹饪、烧炼与合成的区别 / furnace smoker campfire charcoal smelt',
    content: '原版熟肉、熟鳕鱼、熟鲑鱼、烤马铃薯和干海带通过烹饪获得，不是 crafting grid 配方。'
      + 'beef/porkchop/chicken/mutton/rabbit/cod/salmon/potato/kelp 均可在熔炉 200 ticks、烟熏炉 100 ticks、营火 600 ticks 加工一件（以 20 TPS 为游戏时间基准）。'
      + '熔炉/烟熏炉需要燃料；营火需要点燃，不用持续补燃料。具体工具是否支持某设备应读 mc_help，不代表任一执行器都已实现。'
      + 'charcoal 是 logs_that_burn 标签原木的 smelt 产物，不可 craft；木炭可用于火把与后续燃料。'
      + '先核实当前原料、炉子、燃料与安全站位，使用 mc_help skill:smelt 查看原生参数。估计烧完不等于取到成品，需 take 后核对库存。' },
] as const;
