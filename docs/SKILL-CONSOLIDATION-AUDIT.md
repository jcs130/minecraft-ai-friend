# 技能精简审计与实施契约

2026-09-07。实际运行定义共 72 项：65 个主动原子、7 个被动原子。默认保留 8 个特色主动技能；另 57 个旧主动停止施放，7 个被动退出主动目录。传送阵使用独立的传送点簿，不计入这 72 项，继续提供公共点和个人点。

本轮用户已授权精简运行技能，因此“归档”不是仅隐藏界面：旧 ID、完整名称、唯一别名、自然咏唱、模糊匹配、神力代施与守护代施均受核心门禁。已归档主动返回 skill_archived，不执行 RCON、不收费、不新增学习；原生替代提示只介绍可选法术，不授予书、卷轴或装备。

## 配置与默认入口

机器可读目录为 [config/skill-catalog.json](../config/skill-catalog.json)：schema=1，featured 是按默认顺序排列的 ID 数组；archived 按 ID 提供 kind/reason/nativeHints；icons 是顶层物品图标表；categories 描述精选分组。原生铁魔法和传送阵是独立固定入口，归档页用于浏览原因与替代建议。

| ID | 名称 | 默认图标 | 保留理由 |
|---|---|---|---|
| home | 归乡 | minecraft:compass | 固定返回千灯堂；与原生回溯返回床或出生点不同。 |
| tp | 空间传送 | minecraft:ender_pearl | 按方向与距离精确位移，保留 distance/direction 参数。 |
| give | 造物术 | minecraft:crafting_table | 白名单生存物资，统一 item/count 参数，不扩大可造范围。 |
| blood_mana | 燃血术 | minecraft:redstone | 用生命换取旧体系魔力；不增加铁魔法原生法力。 |
| spring | 化水术 | minecraft:water_bucket | 在指定方向生成水源的生存建造工具；会改变目标方块。 |
| sky_walk | 御空术 | minecraft:elytra | 由已安装服务端 fly 实现 60 秒临时飞行，并附缓降。 |
| feather_boots | 羽落之靴 | minecraft:leather_boots | 授予带 featherfall 标记的皮靴，穿戴时免坠落伤害；属于主动造物，不是被动定义。 |
| fireworks | 烟花术 | minecraft:firework_rocket | 召唤三枚烟花火箭的社交小术，不宣称自定义彩色爆炸。 |

归乡仍指向千灯堂，不能偷偷改为床；原生 recall 返回床或出生点，portal 建立临时两端门户，均不替代持久公共/个人传送阵。空间传送保留精确方向与距离参数。造物术保留白名单及 1–16 数量边界；旧照明术的低成本不自动转移给造物术。燃血术只补充旧体系魔力，不补充 Iron’s 原生法力。

## 逐 ID 归档依据

下表直接对应实装 catalog。nativeHints 中的 35 个不同原生 ID，均已对照已安装 3.16.3 JAR 的 SpellRegistry 注册字段、具体 Spell 类及提取的中文说明核对。相近用途不表示伤害、时长、目标或资源完全等价。

| 原子 ID / 真实名称 | 处置类别 | 具体理由 | 可选原生法术 | 定义证据 |
|---|---|---|---|---|
| heal / 圣愈术 | native_alternative | 旧瞬间治疗加饱和与原生治疗重复；原生治疗不会自动复制饱食补充。 | irons_spellbooks:heal（治疗）；irons_spellbooks:greater_heal（强效治疗） | [L85](../server/world-data/magic-atoms.json#L85) |
| feed / 饱食赐福 | redundant | 直接饱和效果归档，生存补给统一使用食物或造物术。 | — | [L150](../server/world-data/magic-atoms.json#L150) |
| food_mana / 炼食术 | redundant | 与燃血术重复的旧魔力转换，饥饿扣除为近似效果；原生暴食只转换原生法力。 | irons_spellbooks:gluttony（暴食） | [L181](../server/world-data/magic-atoms.json#L181) |
| light / 照明术 | redundant | 给予四根火把与造物术重叠；改用造物术需遵守其原有成本，不静默沿用本术价格。 | — | [L249](../server/world-data/magic-atoms.json#L249) |
| time_day / 破晓术 | world_ritual | 改变全服时间，不属于默认个人技能；暂不开放此旧全局命令。 | — | [L281](../server/world-data/magic-atoms.json#L281) |
| weather_clear / 驱云术 | world_ritual | 改变全服天气，不属于默认个人技能。 | — | [L314](../server/world-data/magic-atoms.json#L314) |
| terraform / 大地塑形 | repair_required | 实际只破坏脚下一个方块，与大地塑形名称不符；原生点石成掘仅作为挖掘替代。 | irons_spellbooks:touch_dig（点石成掘） | [L345](../server/world-data/magic-atoms.json#L345) |
| rampart / 覆土术 | specialized | 实际向下覆盖十格泥土柱，会改写原地形；归档此专用建造捷径。 | — | [L377](../server/world-data/magic-atoms.json#L377) |
| meteor / 陨石术 | native_alternative | 旧陨石实际上召唤闪电；原生落雷对应旧效果，星海落瀑对应流星主题，两者不等价。 | irons_spellbooks:lightning_bolt（落雷）；irons_spellbooks:starfall（星海落瀑） | [L451](../server/world-data/magic-atoms.json#L451) |
| swift / 迅捷术 | native_alternative | 普通速度药水效果转向原生急迫或超负荷；原生增益还含其他属性，遵守各自规则。 | irons_spellbooks:haste（急迫）；irons_spellbooks:charge（超负荷） | [L484](../server/world-data/magic-atoms.json#L484) |
| leap / 跃升术 | native_alternative | 普通跳跃提升效果归档；飞升提供不同的垂直机动方式，并非同款药水。 | irons_spellbooks:ascension（飞升） | [L513](../server/world-data/magic-atoms.json#L513) |
| feather_fall / 羽落 | redundant | 普通短时缓降归档；精选御空术与羽落之靴保留飞行及防坠特色，成本与装备要求各自独立。 | — | [L543](../server/world-data/magic-atoms.json#L543) |
| ironskin / 铁肤术 | native_alternative | 普通抗性提升与原生橡肤的防御用途重复，具体减伤遵守原生法术。 | irons_spellbooks:oakskin（橡肤） | [L573](../server/world-data/magic-atoms.json#L573) |
| regen / 再生术 | native_alternative | 普通再生效果转向原生再生云域或治愈之环，范围与施法机制不同。 | irons_spellbooks:cloud_of_regeneration（再生云域）；irons_spellbooks:healing_circle（治愈之环） | [L602](../server/world-data/magic-atoms.json#L602) |
| strength / 神力术 | native_alternative | 普通力量药水效果归档；超负荷提供另一种原生战斗强化，不等同力量等级。 | irons_spellbooks:charge（超负荷） | [L631](../server/world-data/magic-atoms.json#L631) |
| haste / 急迫术 | native_alternative | 旧挖掘急迫效果转向原生急迫；原生另含移动、攻速和施法时间加成。 | irons_spellbooks:haste（急迫） | [L660](../server/world-data/magic-atoms.json#L660) |
| night_vision / 夜视术 | redundant | 普通夜视与既有夜视之瞳被动重复；保留已获得的夜视被动。 | — | [L689](../server/world-data/magic-atoms.json#L689) |
| water_breath / 水息术 | redundant | 普通水肺效果与既有鱼鳃被动、原版药水重复，不编造不存在的原生水肺法术。 | — | [L718](../server/world-data/magic-atoms.json#L718) |
| fire_res / 避火术 | redundant | 普通抗火效果与既有火衣被动、原版药水重复。 | — | [L748](../server/world-data/magic-atoms.json#L748) |
| invisibility / 隐身术 | native_alternative | 原生隐身术已接通正常施法，其真隐身可隐藏装备并受原生破隐条件约束。 | irons_spellbooks:invisibility（隐身术） | [L777](../server/world-data/magic-atoms.json#L777) |
| rain / 唤雨术 | world_ritual | 改变全服天气，归档个人直接唤雨。 | — | [L806](../server/world-data/magic-atoms.json#L806) |
| storm / 雷暴术 | world_ritual | 旧术改变全服雷暴天气；原生雷暴是战斗法术，不能当作天气命令等价替换。 | irons_spellbooks:thunderstorm（雷暴） | [L836](../server/world-data/magic-atoms.json#L836) |
| steed / 唤马术 | native_alternative | 旧术直接生成无明确生命周期的马；原生召唤骏马承担坐骑法术。 | irons_spellbooks:summon_horse（召唤骏马） | [L866](../server/world-data/magic-atoms.json#L866) |
| guardian / 铁卫术 | redundant | 与铁卫傀儡重复且直接生成无主人、无数量限制的铁傀儡；原生召唤提供不同的战斗伙伴。 | irons_spellbooks:summon_polar_bear（召唤北极熊）；irons_spellbooks:raise_dead（驱役亡灵） | [L896](../server/world-data/magic-atoms.json#L896) |
| purge / 退魔术 | repair_required | 旧术直接 kill 多种怪物且距离选择器缺少玩家执行原点，归档此绕过伤害结算的旧命令。 | irons_spellbooks:divine_smite（神圣打击）；irons_spellbooks:shockwave（震荡波） | [L927](../server/world-data/magic-atoms.json#L927) |
| windburst / 风爆术 | native_alternative | 旧术在脚下生成风弹；原生呼啸之风与震荡波提供原生风力战斗，不复制脚下弹体。 | irons_spellbooks:gust（呼啸之风）；irons_spellbooks:shockwave（震荡波） | [L966](../server/world-data/magic-atoms.json#L966) |
| summon_wolf / 通灵契约 | repair_required | 永久宠物契约使用不适配 1.21.1 的复合 CustomName，限额查询还缺执行原点；保留既有宠物，暂不新增。 | irons_spellbooks:summon_polar_bear（召唤北极熊） | [L996](../server/world-data/magic-atoms.json#L996) |
| summon_pack / 驮兽契约 | repair_required | 货运驴契约有独特用途，但 CustomName 版本与归属/数量限制待修；原生骏马并不替代货运驴。 | — | [L1035](../server/world-data/magic-atoms.json#L1035) |
| rasengan / 螺旋丸 | repair_required | 保留鸣人主题设计记录；旧弹道后续命令仍引用退役实体类型及宽泛目标选择器，暂不对外释放。 | irons_spellbooks:gust（呼啸之风）；irons_spellbooks:sonic_boom（音爆） | [L1067](../server/world-data/magic-atoms.json#L1067) |
| kage_bunshin / 影分身之术 | repair_required | 运行原子缺 special 分派，实际仍召唤两个雪傀儡；现有 Numen 分身执行器并未被此定义接通。 | — | [L1167](../server/world-data/magic-atoms.json#L1167) |
| clarity_glow / 澄光 | redundant | 短时夜视加粒子与夜视、社交特效重复。 | — | [L1202](../server/world-data/magic-atoms.json#L1202) |
| initiate / 灌顶 | progression_bypass | 廉价再生魔力换原生战斗经验绕开探索成长；停止此旧经验兑换，不重置既有等级。 | — | [L1232](../server/world-data/magic-atoms.json#L1232) |
| fireburst / 炎爆术 | native_alternative | 旧指令生成火球转向原生火球术或火焰箭，由原生处理瞄准、法力和冷却。 | irons_spellbooks:fireball（火球术）；irons_spellbooks:firebolt（火焰箭） | [L1259](../server/world-data/magic-atoms.json#L1259) |
| frost_nova / 冰霜新星 | native_alternative | 旧范围减速及多目标 damage 指令有兼容隐患，转向原生冰浪或冰霜尖刺。 | irons_spellbooks:frostwave（冰浪）；irons_spellbooks:ice_spikes（冰霜尖刺） | [L1294](../server/world-data/magic-atoms.json#L1294) |
| chain_lightning / 闪电链 | native_alternative | 原生连锁闪电替代旧多目标召雷指令，并按原生目标与伤害结算。 | irons_spellbooks:chain_lightning（连锁闪电） | [L1329](../server/world-data/magic-atoms.json#L1329) |
| starburst / 星爆气流斩 | repair_required | 保留桐人主题记录；实际为单次范围 damage 而非完整连击，且含退役实体过滤。原生剑系仅是可选战斗替代。 | irons_spellbooks:echoing_strikes（回响打击）；irons_spellbooks:summon_swords（召唤利剑）；irons_spellbooks:shadow_slash（暗影斩击） | [L1365](../server/world-data/magic-atoms.json#L1365) |
| venom_breath / 剧毒瘴气 | native_alternative | 旧范围中毒恶心转向原生毒雾喷射或毒液飞溅，原生瞄准与范围不同。 | irons_spellbooks:poison_breath（毒雾喷射）；irons_spellbooks:poison_splash（毒液飞溅） | [L1400](../server/world-data/magic-atoms.json#L1400) |
| barrier / 结界术 | native_alternative | 旧结界实际只是自身抗性与抗火，没有实体屏障；原生护盾术或橡肤提供真实防御选项。 | irons_spellbooks:shield（护盾术）；irons_spellbooks:oakskin（橡肤） | [L1434](../server/world-data/magic-atoms.json#L1434) |
| feather_shield / 羽盾术 | native_alternative | 旧伤害吸收增益与原生神圣守护的临时生命用途重叠，原生可作用友方范围。 | irons_spellbooks:fortify（神圣守护） | [L1467](../server/world-data/magic-atoms.json#L1467) |
| golem_guard / 铁卫傀儡 | repair_required | 旧定义含双层 SNBT 大括号、无主人却检查 Owner 限额等问题，并与铁卫术重复。 | irons_spellbooks:summon_polar_bear（召唤北极熊） | [L1499](../server/world-data/magic-atoms.json#L1499) |
| magnet / 磁石术 | repair_required | 物品距离选择器缺 execute at 玩家，会以 RCON 原点取物；修复前不纳入精选，原生念力只牵引生物并非拾取替代。 | — | [L1571](../server/world-data/magic-atoms.json#L1571) |
| sense / 心眼术 | native_alternative | 旧发光扫描含退役实体过滤，原生位面视觉提供穿透地形观察生物的对应用途。 | irons_spellbooks:planar_sight（位面视觉） | [L1604](../server/world-data/magic-atoms.json#L1604) |
| starlight / 星尘术 | redundant | 纯粒子小术归档，默认社交特效保留烟花术。 | — | [L1638](../server/world-data/magic-atoms.json#L1638) |
| fire_aura / 火焰光环 | specialized | 旧环绕光环受角色专用权限与独立 tick 系统约束，退出通用技能目录；原生烈焰风暴并非永久光环。 | irons_spellbooks:blaze_storm（烈焰风暴） | [L1670](../server/world-data/magic-atoms.json#L1670) |
| thunder_aura / 雷光光环 | specialized | 旧环绕雷光系统从默认施法归档；原生雷暴提供战斗主题替代，并非旧光环等价物。 | irons_spellbooks:thunderstorm（雷暴） | [L1702](../server/world-data/magic-atoms.json#L1702) |
| heal_aura / 圣愈光环 | native_alternative | 旧主动治疗光环转向原生治愈之环或再生云域；既有护甲治疗光环奖励单独保留。 | irons_spellbooks:healing_circle（治愈之环）；irons_spellbooks:cloud_of_regeneration（再生云域） | [L1733](../server/world-data/magic-atoms.json#L1733) |
| speed_aura / 迅捷光环 | native_alternative | 旧速度光环与普通速度术重复，转向原生急迫的正常装备施法。 | irons_spellbooks:haste（急迫） | [L1764](../server/world-data/magic-atoms.json#L1764) |
| enchant_fire / 附魔·焰 | permanent_equipment | 直接永久附火焰附加的旧捷径归档；已附魔物品不变，可走附魔台/铁砧。 | — | [L1830](../server/world-data/magic-atoms.json#L1830) |
| enchant_sharp / 附魔·锋 | permanent_equipment | 直接永久附锋利的旧捷径归档；保留已有装备附魔。 | — | [L1861](../server/world-data/magic-atoms.json#L1861) |
| enchant_knock / 附魔·退 | permanent_equipment | 直接永久附击退的旧捷径归档；保留已有装备附魔。 | — | [L1892](../server/world-data/magic-atoms.json#L1892) |
| enchant_loot / 附魔·夺 | permanent_equipment | 直接永久附抢夺的旧捷径归档；保留已有装备附魔。 | — | [L1922](../server/world-data/magic-atoms.json#L1922) |
| night_eye / 夜视之瞳 | passive | 夜视之瞳属于永久被动，退出主动菜单；保留 passives 中的 night_vision 和参悟进度。 | — | [L1952](../server/world-data/magic-atoms.json#L1952) |
| iron_body / 铁躯 | passive | 铁躯属于永久被动，保留 resistance 被动与参悟进度，无需主动施放。 | — | [L1976](../server/world-data/magic-atoms.json#L1976) |
| gale_body / 疾风之躯 | passive | 疾风之躯属于永久被动，保留 speed 被动与参悟进度。 | — | [L2000](../server/world-data/magic-atoms.json#L2000) |
| fish_gill / 鱼鳃 | passive | 鱼鳃属于永久被动，保留 water_breathing 被动与参悟进度。 | — | [L2023](../server/world-data/magic-atoms.json#L2023) |
| fire_veil / 火衣 | passive | 火衣属于永久被动，保留 fire_resistance 被动与参悟进度。 | — | [L2047](../server/world-data/magic-atoms.json#L2047) |
| ench_chain_lightning / 附魔·闪电链 | permanent_equipment | 停止新增旧武器闪电链附魔，保留 custom_data.skill_enchant 与既有命中触发；原生连锁闪电是主动施法。 | irons_spellbooks:chain_lightning（连锁闪电） | [L2101](../server/world-data/magic-atoms.json#L2101) |
| ench_fireburst / 附魔·炎爆 | permanent_equipment | 停止新增旧武器炎爆附魔，保留既有装备触发；原生火球术不自动变成命中附魔。 | irons_spellbooks:fireball（火球术） | [L2130](../server/world-data/magic-atoms.json#L2130) |
| ench_rasengan / 附魔·螺旋丸 | permanent_equipment | 旧武器螺旋丸附魔归档，已发出的 custom_data.skill_enchant 仍保留，不清除角色奖励。 | — | [L2159](../server/world-data/magic-atoms.json#L2159) |
| ench_aura_bloodlust / 附魔·嗜血光环 | permanent_equipment | 停止新增旧护甲嗜血光环，保留已有 custom_data.aura 和被动学习记录。 | — | [L2187](../server/world-data/magic-atoms.json#L2187) |
| ench_aura_healing / 附魔·治愈光环 | permanent_equipment | 停止新增旧护甲治愈光环，保留已有护甲治疗效果与学习记录；原生治愈之环不是自动附魔。 | irons_spellbooks:healing_circle（治愈之环） | [L2216](../server/world-data/magic-atoms.json#L2216) |
| aura_bloodlust / 嗜血光环 | passive | 旧嗜血光环无 passiveId，是护甲附魔的学习门槛；保留 learned/innateSkill 与已有护甲标记，不伪造被动效果。 | — | [L2245](../server/world-data/magic-atoms.json#L2245) |
| aura_healing / 治愈光环 | passive | 旧治愈光环无 passiveId，是护甲附魔的学习门槛；保留学习记录和已有护甲标记。 | — | [L2266](../server/world-data/magic-atoms.json#L2266) |
| thousand_return / 千回 | redundant | 实际仅十秒吸收与短时再生，没有复活或传送；名称容易误导，默认防御恢复使用原生法术。 | irons_spellbooks:fortify（神圣守护）；irons_spellbooks:heal（治疗） | [L2287](../server/world-data/magic-atoms.json#L2287) |

## 永久奖励与成长保留

夜视之瞳、铁躯、疾风之躯、鱼鳃、火衣分别对应独立的被动 ID：night_vision、resistance、speed、water_breathing、fire_resistance。保留 magic-state 中 passives、passiveProgress、learned、advancementSkills、innateSkill、maxManaBonus 及等级记录。不能用 atom ID 清洗被动集合；例如 fortitude 来自 skill-events/原有默认定义，并不在本次 72 原子中。

另两项 aura_bloodlust/aura_healing 虽标为 passive，却没有 passiveId；它们是原有护甲技能附魔的学习门槛，不应凭空当作自动持续效果。保留这些 learned/innate 记录与已有装备 custom_data.aura。4 种原版永久附魔、3 种武器 skill_enchant 和 2 种护甲 aura 的授予旧技能归档后，既有装备仍保留原 NBT 与触发能力。也不移除已生成宠物。

feather_boots 是主动给予皮靴，原子未声明 type:passive；它不占永久被动解锁槽，也不调用 unlockPassive。靴子 custom_data.featherfall 被服务端 FeatherBootsMixin 读取，穿戴时取消摔落伤害。重复制造仍遵守本术资源和冷却，既有靴子不会因目录变化失效。

已有技能栏的归档主动 ID 只在服务视图原位呈现空槽，读取不会重写原档数组或挤压后续位置。新默认栏从 featured 顺序与已学/天赋取交集；新设置归档 ID 按现有无效槽契约返回空槽。旧出生天赋可继续保留历史记录，但其归档主动不再可施放。后续新天赋候选应只取 featured 主动。

## 核心执行与维度修复

[mc-magic.ts](../world/src/mc-magic.ts) 通过 [skill-catalog.ts](../world/src/skill-catalog.ts) 加载目录。Config.catalogPath 可选，缺省为 atomsPath 同目录 skill-catalog.json；原本未配目录的离线夹具保留旧行为。已有目录若 JSON 损坏、重复对象键、重复分类、未知 ID、漏掉任一原子或将被动列为主动，启动报错；运行中热重载失效或删文件，保留此前门禁并报错，不开放旧 72 技能。

listAtoms/getAtomById 保留全量原子，并深拷贝投影 catalog:{status,reason,nativeHints} 与图标/参数。castExact 的归档结果是 {ok:false,code:"skill_archived",skillId,name,summary,nativeHints}。被动仍返回 code:"passive"。实际 72 原子没有 appraise；旧无目录夹具的鉴定内部路径仍可查询并有离线测试，不为其新造运行技能。

启用目录后，每个精选技能先通过 qdlocation 读取真实施术者坐标，避免观察者跨维度缓存。home/tp 使用 [waypoint-travel.ts](../world/src/waypoint-travel.ts) 的 qdwarp 结构回执：归乡指定 minecraft:overworld，方向传送使用施术者原维度；原生桥确认安全落点和实际 teleported 后才扣旧魔力。拒绝不扣费、不学习；outcome_unknown 不自动重发，并保留尝试冷却窗口。

其余精选普通效果命令以及粒子、声音在 execute at 施术者 run 的维度上下文执行，保留 RCON 权限，不再在 RCON 默认维度 setblock/summon。普通效果收到明确拒绝或传输中断时，不扣旧魔力、不新增学习、不自动重放；生命/饥饿成本和已发生的部分效果不能安全回滚，会在失败说明中指出。无目录夹具仍保留原调用协议。归档 windburst 后，其旧全局 kill wind_charge 定时清扫也停止，避免删除正常原生风弹。

## 验证与范围

欢迎与自动守护的旧提示也已同步：欢迎 LLM 教学段从当前精选列表生成，原生法术必须具备实际书/卷轴；VIP 和祈愿提示不再在目录模式推荐旧圣愈、照明或全局天象技能。濒死守护仅尝试一次正常原生 irons_spellbooks:heal，并保留原有 90 秒尝试节流。只有原生 casting_started 会记录“开始施法”，不写成“已救活”；未装备、拒绝或回执中断只给安全撤退、进食与装备治疗提示。饥饿分支停止调用归档 feed，不再无依据声称已经喂饱。无目录环境保留旧兼容。

针对上述收尾运行 node --test world/tests-ai/catalog-guidance.test.mjs，6 项通过：包括动态欢迎列表、原生受理/拒绝边界，以及提取实际 guardScan 函数在隔离依赖下验证只调用一次原生治疗、失败不写成功史记、饥饿不施放旧术和旧环境兼容。mc-god.ts 整文件通过 esbuild 语法转换；未运行真实救援或重启服务。

已运行 node --test world/tests-ai/magic-core.test.mjs world/tests-ai/magic-summary.test.mjs：34 项全部通过。覆盖全部 57 归档主动的多个施法入口零世界访问、7 被动/额外 fortitude 保留、旧槽视图不改原档、精选成本和冷却、损坏/重复/缺失目录拒绝、失败热重载、跨维度传送、化水/烟花执行上下文、回执中断不重放和鉴定夹具。测试使用临时数据与模拟 RCON，未修改实际玩家状态。

本模块通过 esbuild 编译。全仓 TypeScript 检查仍有其他文件的既有错误，本次 mc-magic.ts、skill-catalog.ts 与调用的 waypoint-travel.ts 没有类型错误。部署、真实菜单/手柄与最终运行冒烟由根任务统一完成；离线通过不等于已完成新版本现场验收。

根任务已完成现场验收并保存报告：

- [技能罗盘冒烟](../reports/skill-compass-smoke.json)：2026-09-07 04:17:53–04:18:01 UTC，10 组全绿。生存模式、无客户端模组的 QA 真正右键指南针打开 27 槽主界面，8 个图标互不相同；Shift 快速移动不能拿走图标或施法；64 档案只读且归档施法返回 skill_archived，魔力不变。原生入口实际打开 54 槽法术菜单；13 个传送点可见，第 9 项点击按 personal:6 到达并读回位置。第 8 技能槽设置/去重通过；烟花经统一请求观察到 3 枚实体、约 5 点魔力消耗、唯一成功台账，重复请求受冷却阻止。报告确认 QA 已退出并释放测试锁。
- [原生传送冒烟](../reports/waypoint-travel-smoke.json)：2026-09-07 04:07:27–04:07:35 UTC，8 组全绿。Numen UUID 定位、安全落地、共享原生冷却、无支撑高空拒绝且不移动、无效维度拒绝，以及进入真实下界再返回主世界均已通过。报告确认测试假人已 dismiss。

以上是实际服务器、协议菜单与效果验收，不等于实体手柄硬件按键测试。欢迎/自动守护的 6 项测试属于离线逻辑回归，没有将“开始治疗施法”推断成真实生命已恢复；其最终世界进程加载由根任务统一重启。

审计基线：server/world-data/magic-atoms.json SHA-256 = 77fc8964f4e55f7282b39ea9e619e9a6b4fd28fc7a11667501f1629973fbce6e；安装 irons_spellbooks-1.21.1-3.16.3.jar SHA-256 = 55a290db9b966e0c5d2f5c051d50775f3db6375cdb52730c4da528bcf5d5daa0。本轮未改两者，也未删或重置玩家成长文件。

核心证据：[运行原子](../server/world-data/magic-atoms.json)、[原生中文名称及 guide](../world/src/irons-spell-names.json)、[被动/技能状态引擎](../world/src/mc-magic.ts)、[羽落靴运行判断](../world/botgate-src/dev/god/botgate/mixin/FeatherBootsMixin.java)、[永久装备技能标记与学习门槛](../world/botgate-src/dev/god/botgate/magic/SkillEnchantCommand.java)、[原生执行桥](../world/irons-bridge-src/src/dev/qiandeng/irons/QiandengIronsBridge.java)。
