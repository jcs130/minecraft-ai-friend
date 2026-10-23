/** Optional Java 1.21.1 references, synthesized from the pinned primary-source research.
 * Advice does not choose tasks or certify current safety/executor availability.
 * See docs/research/vanilla-1.21.1-survival-foundations-20261016.md.
 */
import { VANILLA_KNOWLEDGE_VERSION } from './vanilla-food.ts';

interface SurvivalSource { url: string; version: string; evidence: string; sha1?: string }
interface SurvivalGuide { name: string; title: string; summary: string; content: string; sources: readonly SurvivalSource[] }
const article = (slug: string, evidence: string): SurvivalSource => ({
  url: `https://www.minecraft.net/${slug}`, version: VANILLA_KNOWLEDGE_VERSION,
  evidence: `${evidence}; introductory advice, exact mechanics pinned separately`,
});
const original = (evidence: string): SurvivalSource[] => [
  { url: 'https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar',
    sha1: '30c73b1c5da787909b2f73340419fdf13b9def88', version: VANILLA_KNOWLEDGE_VERSION, evidence },
  { url: 'https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt',
    sha1: '2244b6f072256667bcd9a73df124d6c58de77992', version: VANILLA_KNOWLEDGE_VERSION,
    evidence: 'Official class/member mappings for the cited original mechanics; see research for mapped identities' },
];
const executor = (file: string, evidence: string): SurvivalSource => ({
  url: `https://github.com/jcs130/minecraft-ai-friend/blob/3f7095cd97617f4192e4657814c0fe05ea56be43/packages/agent-mc-world/core/${file}.ts`,
  version: VANILLA_KNOWLEDGE_VERSION, evidence: `${evidence}; source contract, not live capability/success evidence`,
});
const night = article('en-us/article/how-survive-your-first-night-minecraft', 'Alternative shelter, light, equipment and bed choices');
const craft = article('en-us/article/how-craft', 'Inventory grid and crafting-table discovery');

export const VANILLA_SURVIVAL_GUIDES: readonly SurvivalGuide[] = [
  { name: 'bed', title: '床、羊毛、睡觉与重生点 / bed wool sleep night spawn',
    summary: '有床或能取得同色羊毛时，比较安全睡觉与临时庇护；核实维度、材料、睡眠拒绝和醒后时间，点击不等于跳夜。',
    content: '先按当前维度、时间、威胁、饥饿、材料和兴趣比较已有床、制作床或 guide/night_shelter；缺羊毛时可换方案，不要反复盲目 craft。'
      + '\nJava 1.21.1 普通床配方：一排 3 个同色羊毛，下一排 3 个 minecraft:planks 标签木板，产出对应颜色的一张床；宽 3 格，需工作台的 3×3 格，不能用背包 2×2。木板可混树种，羊毛不能任意混色。按实际颜色与背包 ID 查 recipe/white_bed 或其他颜色配方；染色另查。item/shears 只是可选取毛工具。'
      + '\n放置前观察水平两格床位、脚下支持、净空及可达的进出/醒来站位。确认实际床头床尾方块。床在原版 Nether/End 的 bed_works=false 维度使用会爆炸（强度 5）；未知或自定义维度先核实床是否可用，不能点击试错。'
      + '\n当前 Mineflayer 源码用 use {at:[x,y,z]} 对床交互并在实际入睡后等醒；读 mc_help 的 use/build/craft 契约，无独立 sleep 技能。waitForWake 有界至 60 秒，超时/取消可能起床，不代表天亮。白天且无雷暴、附近危险怪、头顶阻挡、距离不够、床被占用等拒绝须看真实反馈；普通下雨不等于雷暴。'
      + '\n能躺下、设置重生点、醒来、跳夜是不同结果。多人还受 playersSleepingPercentage/深睡人数及 doDaylightCycle 影响；白天或危险拒绝睡眠时也可能已设置点。分别检查当前睡眠/醒来回执、时间、维度、生命及实际重生点；床被拆/堵后旧坐标不能保证重生。'
      + '\n先读实际工具与脚本能力；可选 Java-client helper 的 methodAdapter/methodCalls 能力不同，不能用其缺少高层睡眠执行器推断 Mineflayer 不会用床。读卡和 craft 接受均不证明床、物资或安全已完成。',
    sources: [night, article('en-us/article/taking-inventory--bed', 'Beds and nearby-monster sleep restrictions'), craft,
      ...original('data/minecraft/recipe/{white_bed,red_bed}.json; data/minecraft/dimension_type/{overworld,the_nether,the_end}.json; BedBlock, ServerPlayer.startSleepInBed, ServerLevel.tick, SleepStatus, GameRules'),
      executor('skills-interact', 'useProbeAt, skillUse, waitForWake'),
      { url: 'https://github.com/jcs130/minecraft-ai-friend/blob/3f7095cd97617f4192e4657814c0fe05ea56be43/packages/agent-mc-world/src/client/java-methods.ts',
        version: VANILLA_KNOWLEDGE_VERSION, evidence: 'Optional Java-client methodAdapter/methodCalls discovery; source contract, not active Mineflayer capability evidence' }] },
  { name: 'night_shelter', title: '没床过夜、临时庇护与等天亮 / no bed night shelter hide wait dawn',
    summary: '夜间缺床或找羊毛风险高时可选择小型封闭照明庇护；保留脚头空气、支撑与出口，实际等待并复查天色和危险。',
    content: '是否暂避取决于新鲜时间、生命/饥饿、周边危险、资源和当前兴趣。可避免的夜间暴露或低饥饿，是重新评估采矿/探索计划的依据；资料不替你选任务。缺床可在可达干燥地点做小型封闭亮处，或挖入已观察的侧坡；无需先造完整房子。'
      + '\n先检查岩浆、水、沙砾坠落、边缘、方块碰撞与支撑，不盲挖脚下直井，不在水下封死。普通站立需可靠地面及脚/身体/头部两格净空；所谓埋地避难是围住空气格，不能把方块塞进头部或身体导致窒息。稳定材料、墙顶与可重新打开的出口应适合现场；留可用工具和退出材料。'
      + '\n照明减少普通生成风险，不清除已有怪，也不保证挡住所有怪物/特殊生成。木门不在所有难度与怪物条件下可靠；洞口、侧缝、屋顶和安全接近须实际复查。墙或火把回执不等于庇护已安全。必要时先按 guide/food、guide/health 处理可用口粮与生命。'
      + '\n确需等候时用现有执行器允许的有界等待/任务语义，并重新观察时间、生命、空气和威胁；共享脚本可查询 await bot.waitForTicks 的实际能力与预算。没有 wait_until_dawn 技能；mc_wait 等动作终态也不是等天亮。一秒延迟、结束回合或计划声明不证明过夜，不能靠重复模型调用消磨夜晚。也可选择庇护内其他安全活动。'
      + '\n外出前复查真正天色、出口与外部威胁；黎明不保证怪全消失。时间不推进或无法安全等待时报告条件并比较替代方案，不改时间/难度或给予无敌。观察与建造参数读 mc_help probe/observe/build；不用历史坐标代替现场。',
    sources: [night, article('de-de/article/how-survive-your-first-day', 'Illustrative enclosed lit hillside refuge and waiting'),
      ...original('Entity.isInWall, LivingEntity.baseTick, FallingBlock: solid collision, suffocation/air and falling support hazards'),
      executor('method-capabilities', 'Shared awaited bot.waitForTicks; inspect backend bounds'), executor('placement', 'Placement support and body-collision checks')] },
  { name: 'equipment', title: '装备、武器、防具与工具 / equipment armor weapon sword axe shield pickaxe tools',
    summary: '按当前任务、耐久、材料和威胁选择木石工具、剑斧盾与护甲；查采掘前提和配方，携带不等于装备或防御成功。',
    content: '用当前背包、耐久、生命/饥饿、当地威胁和兴趣选择装备，不必集齐整套才临时避难。木镐可开局取得合适石料，再考虑石镐/斧/剑；铁料和燃料允许时可考虑铁工具、盾与护甲。没有原版石护甲，Java 1.21.1 也没有后续版本的铜装备层级。'
      + '\n矿物与任务有工具前提，查 block/<实际方块ID> 的 harvestTools 与 recipe/<工具ID>；不是任意镐都能有效采任意矿。recipe/wooden_pickaxe、stone_pickaxe、stone_axe、stone_sword、shield 和 iron_chestplate 可按需读取；石工具的 stone_tool_materials 标签包括圆石、黑石、深板岩圆石，不能只按示例猜材料。'
      + '\n斧利于取木且可防身，剑是另一选择，铲用于土方，锄用于耕地；依据收益和资源取舍。盾配方为 6 木板+1 铁锭，仍要实际装备并有效主动朝向格挡，不能仅凭携带/副手有盾认定防护；并非所有攻击可挡。铁套总计 24 铁锭不是必须完成的目标。'
      + '\n查 mc_help craft/equip 和实际 methodAdapter/methodCalls；当前 Mineflayer equip {item} 可推断护甲槽，hand:main/off 指定手，但可选执行器可能不同。核对库存、穿戴/手持状态与耐久变化；制作成功不代表穿上，接受动作不代表拿到物品。'
      + '\n食物不足、天黑或危险上升时可先参照 guide/food、guide/night_shelter，避免不必要的夜战/水战，不为凑装备强迫深挖。参考不覆盖原生战斗/反射策略，也不保证武器或护甲能赢。',
    sources: [night, craft, article('en-us/article/taking-inventory--shield', 'Shield crafting and active frontal blocking limits'),
      ...original('data/minecraft/recipe/{wooden_pickaxe,stone_pickaxe,stone_axe,stone_sword,shield,iron_helmet,iron_chestplate,iron_leggings,iron_boots}.json; data/minecraft/tags/item/stone_tool_materials.json'),
      executor('skills-craft', 'skillEquip hand and armor-slot handling')] },
  { name: 'base', title: '房子、家、基地与营地 / house home base camp workbench furnace',
    summary: '按当前地形与兴趣把小庇护扩成可进出的家：照明、工作台、炉子、箱子和后续床；建筑外壳不是已核实的安全基地。',
    content: '结合新鲜地形、威胁、生命/口粮、可达资源与用户兴趣选址和规模。可用的小庇护能逐步扩成家，不需要固定路线或预定坐标。选择干燥、可达且有安全工作空间的位置，考虑食物/水与出入口；夜晚暴露高或饥饿低时可先比较 guide/night_shelter 与 guide/food。'
      + '\n留实际可行的进出路径、移动净空和地面支持，再按需要加入可接近的工作台、熔炉、箱子、照明，以及有材料/安全维度时的床。recipe/crafting_table、recipe/furnace、recipe/torch 按需查；木炭可作火把原料，其获取查 guide/cooking。不是写下设计或放了墙就已竣工。'
      + '\n读 mc_help 的 observe/probe、build 与放置相关能力、goto 和真实建造契约；实际工具名和参数以广告 help 为准，不能猜操作。建筑方式与装饰由 Agent 选择，不启动隐藏建造链。保持出口，核查屋顶/洞口、照明与周边实体；灯和墙不能保证所有怪物都安全。'
      + '\n工作台不自动补材料，熔炉还需实际输入/燃料及取出成品，箱子不创造食物。分别参照 guide/cooking、guide/storage、guide/bed；床需要安全可达的两格空间与使用条件。'
      + '\n用实际方块、通路、容器可达性、库存和危险观测评估是否可用；归家/重生点与维度是当前事实，历史坐标或 memory 笔记需重新确认，不强制返回旧点。保存位置不等于已建成、可重生或有补给。',
    sources: [night, article('de-de/article/how-survive-your-first-day', 'Illustrative shelter and usable work space'), craft,
      ...original('data/minecraft/recipe/{crafting_table,furnace,torch,charcoal}.json; data/minecraft/tags/item/stone_crafting_materials.json'),
      executor('placement', 'Supported placement and collision constraints')] },
  { name: 'storage', title: '箱子、收纳与背包存取 / chest storage inventory stow take',
    summary: '容量限制当前工作时可做可达箱子；验证开盖及真实存取，随身保留口粮、关键工具和退出材料，仓储不产生食物。',
    content: '背包容量妨碍当前目标时，可以选择可达箱子或已有获准使用的容器；整理方式按兴趣和工作需要决定。查 recipe/chest：8 个 minecraft:planks 标签木板围一圈，中间空，产出 1 箱子，需工作台。按实际物品和材料查配方，不默认自动制作中间物。'
      + '\n在安全地面与可达位置放置，保持开盖上方可用空间和接近路线；实心阻挡或猫等条件可能影响开启。看真实交互/容器反馈，不把摆下箱子等同于已能存取。当前库存用 mc_bag，mc_help 的 stow/take、容器观察和 build/goto 契约按实际能力读取。'
      + '\n存放冗余材料时，仍随身保留可用口粮、必要工具、照明与退路方块；别把一切都存进去再无补给远行。食物选择查 guide/food、guide/health；仓储不产生新食物，也不证明已经补饱。'
      + '\n核对目标容器身份、访问权限、存取前后背包与槽位数量。动作被接受或终态返回不能替代真实物品变化；目标或结果未知时保留原回执，不盲目重复存取。记下箱子维度/地点仅是历史提示，再次使用需重新观察可达性和内容；可与 guide/base、guide/cooking 结合，非强制收纳任务。',
    sources: [article('en-us/article/block-week-chest', 'Storage and optional organization examples'), craft,
      ...original('data/minecraft/recipe/chest.json; ChestBlock.isChestBlockedAt/isBlockedChestByBlock and cat obstruction handling'),
      executor('skills-container', 'stow/take and actual container/inventory effects')] },
  { name: 'farming', title: '食物来源、种田、耕地与补种 / farming farm crops seeds wheat renewable food',
    summary: '先比较当前可吃口粮和烹饪，再按资源选择可再生小麦/蔬菜或其他来源；种植要真实生长、收集和补种，不立即充饥。',
    content: '当前饥饿/生命、现成口粮、危险、材料和兴趣决定是否适合种田。缺粮时先比较安全可用食物与烹饪，不能饿着等苗成熟；查 guide/food、guide/health、guide/cooking 和 food/<实际ID>，不复制营养表。腐肉不能在原版烧成安全熟肉。也可比较现有获准收获的作物、动物或其他安全来源，不强制农场计划。'
      + '\n可选可达水边小块地，尤其缺桶用铁时；锄合适土壤，确认实际 farmland 后用对应种子/作物种植，提供照明、安全路径并减少踩踏。小麦用 wheat_seeds，胡萝卜/普通马铃薯本身可种；毒马铃薯不是普通种植/烤制原料。按 mc_help 的 use、采挖/收集能力操作，不猜执行器支持。'
      + '\nJava 1.21.1 水在耕地水平四格内（含对角）、同高或高一格可保湿；雨也影响湿度。水有益，不代表暂干耕地完全不能种。普通作物随机生长要求亮度至少 9，速度受周边、随机 tick、区块实际加载与服务器规则影响；没有保证成熟的固定现实倒计时。'
      + '\n观察实际作物状态：成熟小麦/胡萝卜/马铃薯 age=7，甜菜 age=3，不能给所有作物套同年龄。成熟后收获并核实掉落已入包，留种/留作物补种，确认新的作物格。use 回执不证明种下，打掉作物不证明捡到；只有种苗也不证明粮食恢复。'
      + '\n小麦查 recipe/bread（3 小麦合成 1 面包，无需炉子）；普通马铃薯的烤制查 guide/cooking。比较投入、生长时间与当前可取得食物，按服务器/datapack/版本及实际 executor 能力调整；农场、安全通路与补给均需当前方块和库存证据。',
    sources: [article('en-us/article/block-week-farmland', 'Hoeing, irrigation, light and trampling'),
      article('fr-fr/article/taking-inventory--wheat', 'Planting, growth, harvesting and wheat uses'),
      ...original('FarmBlock.isNearWater; CropBlock.randomTick; BeetrootBlock.getMaxAge; Foods and food cooking recipe inputs; data/minecraft/loot_table/blocks/{wheat,carrots,potatoes,beetroots}.json; data/minecraft/recipe/bread.json'),
      executor('skills-interact', 'SEED_CROP and farmland-targeted use probes')] },
];
