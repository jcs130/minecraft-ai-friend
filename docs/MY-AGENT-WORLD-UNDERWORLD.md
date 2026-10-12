# My Agent World：异界开拓纪第一版

日期：2026-10-12。实现范围为 System Call、真实 Stacia 天命窗口与第一章委托；发布和验收结果见本文末尾。世界、玩家身份、已学技能、经济账户和 Agent 的原暂停/未知动作保留。

## 世界与玩法

原有村镇、道路、生活公会、殖民地、农夫乐事、机械动力、Ars 魔法和十五层试炼继续使用。新增原创游戏章节“异界开拓纪 · 灯火初醒”：旅人用生产、建造、护卫、探索获得第一份立足之地。

十二项章节委托加入现有二十二项任务，总计三十四项，由 SimpleQuests 原生记录前置、进度、扣物和一次性完成。章节包括补给、灯火、农田、料理锅/蔬菜汤、石砖、传动杆/风车轴承、法术书、紫水晶、夜巡和驿站探索，奖励进入现有 EconomyCraft 账户和公会声望。制作风车轴承不等于完整风车运行，检查法术书不等于施法；回执描述保持这个区分。

与 SAO 的关联是玩法启发。术式为本服有限游戏改编；没有下载、复制 Fractured Underworld 的服务器、地图、剧情或角色资产。该网站未提供已确认可自托管的服务器发行物。参考入口：[Fractured Underworld](https://saominecraft.com/us/fractured-underworld)。

## System Call

十条有限术式映射原技能：星芒箭、焰浪、霜环、治疗、跃升、飞行、夜视、探矿、感知、归乡。共用原学习要求、技能点、熟练度、冷却、真实 Ars 魔力与权限。没有第二套神圣术等级或魔力池。

玩家可从命格书进入“System Call · 神圣术目录”，点选原学习、绑定和施法界面，手柄无需输入英文。CLI：

```
/mycli systemcall
/mycli systemcall list
/mycli systemcall explain vital_mend
/mycli systemcall check vital_mend
/mycli systemcall cast vital_mend
/mycli systemcall cast System Call. Generate Vital Element. Form Element. Circle Shape. Discharge.
```

解析器只接受目录 ID 或完整已登记的术式。允许大小写、空格和最后一个句点的正常变化；缺少/额外子句、换行或命令拼接均拒绝。`check` 只读校验语法、本人学习/模式/冷却/魔力前提，`targetValidated=false`；目标与效果在实际施放时重新验证。失败不会发成功事件或收成功费用。

## Stacia 天命窗口

`/mycli stacia` 或命格书按钮打开普通容器界面，显示当前本人生命、护盾、Ars 魔力、饥饿、氧气、技能点、绝对位置和六个装备槽的实际剩余耐久。点击刷新重新采样；不伪造持续变化的数值。无耐久物品显示无耐久属性。

Agent 在 `rpg.state.stacia` 取得同一服务器 tick 的结构化结果：`bodyId`、`sampledAt`、`sampledTick`、`dimension`、绝对 `position`、`life`、`mana`、`equipment`。物品天命为真实 `maxDamage-damage`。尚无独立物体操纵权或神圣术排名，相关 rank 返回 `null`，不会据剧情名称提高 OP/保护区权限。

## Agent 与市场

`rpg.skills.systemCalls.formulas[]` 返回 ID、原 skillId、名称、完整术式、说明、等级、冷却、`castOperation` 和 `castArgs`。Agent 优先按这些原生参数提交 `skill.cast`，无须把英文咏唱写到聊天里。学习与绑定支持目录别名，最终仍保存原稳定技能 ID。

原生操作数不增加：Numen `mod_operations` 99；Mineflayer SDK 121（其中原生绑定 111）。新菜单通过已有接口开放：

```json
{"operation":"rpg.open","args":{"menu":"stacia","page":1}}
{"operation":"rpg.open","args":{"menu":"systemcall","page":1}}
{"operation":"society.open","args":{"menu":"auction"}}
{"operation":"society.open","args":{"menu":"sell"}}
{"operation":"society.open","args":{"menu":"transactions"}}
```

变更须带唯一 action_id 并等终态；重连按同 ID 对账。Mineflayer 菜单读 `menu.current`，返回原生菜单对象；Numen 读 `menu.snapshot`，按发现的 schema 填入窗口/状态/完整槽位和光标 CAS。不要假定两者的包装字段完全一致。委托板按二十一项分页，可按按钮浏览，新增章节在原指南独立分类。

拍卖、出售、订单、满包领取、流水和权限均由 EconomyCraft 原系统处理；新增按钮在本人命令源下打开原界面。灯币账户与试炼回收/补给一致。候选模组与复用政策见 [模组调研](MY-AGENT-WORLD-MOD-REUSE.md)。

EconomyCraft 的流水界面异步读取日志，`society.open` 可返回 `menuPending=true`、`code=vendor_menu_requested_wait_for_window`。这表示打开请求已派发，客户端须等待实际新窗口并重新读菜单；不把上一窗口当流水，也不以新 action_id 重复打开。即时菜单返回 `menuOpened=true`、`code=menu_opened`。

## 维护

定义：`config/maw-life-content.json`、`maw-system-call-catalog.json`。生成 `tools/build_maw_life_content.py`；任务图先校验唯一 ID、真实前置和无环，再写数据包。原公会建筑模板不变，不重生成世界。

桥构建使用 `tools/build_society_bridge.py --server-dir <隔离服>`，保留精确输入 SHA。正式自有数据包已有文件必须与原发布字节一致，先备份再升级；不能盲盖运营修改。第三方经济配置/余额不覆盖。

健康入口：`python world/ops/health/health_mon.py --society-underworld` 和 `--society-underworld-smoke`，检查已安装字节、真实供应模组、有限目录、任务图与现有监督者。这是安装/API 契约冒烟，不冒充手机像素或长期自主游玩。没有新守护、新模型循环、新端口。

下一阶段是记忆分岔迷宫、季节委托与资源事件。它们目前只是计划字段，尚未生成或上线；需要先设计可验证的真实触发和结算，继续优先复用现成模组。

## 发布与验证

2026-10-12 已发布至原 `world-life`，未重生成世界。35 个 JAR 中只更新自研 Agent 桥，SHA-256 为 `502f88182d74870524aa15b036e4a49191e1e8c4fec8733536bce04357f60e73`；其余 34 个原字节保持。主服务和基岩桥沿用原监督者，维护暂停已解除，原 MawExplorer 自主暂停、round 464、旧 unknown 动作及原账本前缀保持。

新增分发为 `integrations/native-sdk/v6-underworld-20261012`、`integrations/world-adapter/v6-underworld-20261012`，各附原锁定的 91 个依赖，旧十一份包保留。SDK 0.4.0 / 统一适配器 0.3.0 与操作总数均不变。

验证结果：

- 解析器 113 项断言、内容/构建 11 项测试、SDK 35 项及适配器/Numen/RPG 22 项测试通过。
- 隔离普通双账号验证本人实际生命、绝对位置、装备耐久，真实治疗周围队友，共用原技能熟练度/冷却/魔力；满血失败不扣魔力，成功事件只发施法者。完整英文术式重启后也产生真实治疗效果。
- 原 EconomyCraft 菜单出售四份小麦，实际扣物并增加本人的同一账户余额，另一个账号余额保持。拍卖、订单、待领取、流水原容器均打开；流水异步打开的错误“结果未知”判定已修正。本轮没有逐一完成拍卖成交、收购订单和满包交付的端到端实验。
- SimpleQuests 原生制作前置真实解锁，交付六份面包实际扣除，章节奖励仅发一次；相同 action_id 重连后不再次派发或追加动作账本，新 ID 再交付也不重复领奖。三十四项目录、十二项新章节、前置及二十一/十三项分页已核对，未声称每个新章节都已完整游玩。
- Numen 使用原身体 UUID/所有者控制并读取新状态，原菜单可操作；未给该身体 OP。真实基岩 UDP 客户端下载五个原资源包并核对哈希，打开天命、术式、委托、拍卖、出售、流水容器。手机实际像素与手柄体验尚未复测。
- 正式服普通账号十一项本人状态/目录/私有频道检查、双 provider 十七项只读检查，以及新章节、面板冒烟、SDK、适配器、Numen、RPG、基岩、语音八组健康均通过；未触发模型任务或正式测试游戏动作。

发布前仅暂停中的 MawExplorer 与空闲 Tommy 在线。主、基岩及所有隔离子进程均正常退出；冷备 `backups/underworld-foundation-20261012` 含 1,437 个文件、421,475,263 字节，CRC 与逐文件 SHA 全部验证。安装期间原世界文件、凭据、权限、模型配置与旧包不变。

最后运行清单校验发现 Numen 自研扩展的清单仍为此前 `5d03e46c…`，而已发布 JAR 是 `6f5deffb…`。对照先前上线回执、完整构建源 SHA、构建产物、此次维护前快照后，仅修正当前清单；Numen JAR 未更换。初次部署校验失败保留，未重复安装或重放游戏动作。

隔离失败证据也保留：旧流水未知记录不改写；世界交互的显式 `interactionDispatched=false` 限流在新一次已知未派发验证后完成；重启脚本先修正账本文件名，再避开登录保护期准备受伤夹具。控制台平台、材料和受伤前置是测试夹具，不是自主生存或完整工厂的证明。全部私有证据在 `research/underworld-foundation-20261012`，不上传世界、日志、JAR、密钥或第三方素材。此次维护已结束，不重放发布脚本。
