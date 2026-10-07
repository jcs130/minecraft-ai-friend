# DYNAMIC_BOARD — 动态委托看板（需求文档）

2026-10-07 扩展：工程和多阶段生活任务使用独立的 `task-market.yml`，复用公会任务槽和奖励，配置/验收/能力记录见 [任务市场](TASK_MARKET.md)。每日看板仍使用本文的 `dynamic-board.yml` 和八种动作目标；不要把工程目标写入旧每日模板而误认为会生效。0.3.87 安装/发布状态见 [OPERATIONS.md](OPERATIONS.md)。

状态：0.3.78 已发布，2026-10-03 18:45；下文 §1–9 保留原始需求，§10 是实际运营接口与边界 · 提出人：扛枪 · 起草：史提西亚（Goddess）· 2026-10-03 晚
关联：[LIFE_GUILDS.md](LIFE_GUILDS.md) · [OPERATIONS.md](OPERATIONS.md) · AgentFriend 正式服 0.3.78

## 1. 背景与目标

现行冒险者公会 37 项委托为静态表（`GuildManager.CONTRACTS`），内容不随世界与居民状态变化，
居民"天天做任务"缺乏新鲜感。需求：

1. 委托内容**每日根据世界/居民真实状态动态生成**（供需、互助、时令、事件、里程碑），
   而非固定写死。
2. **生活化**：委托之外，给居民"今日村报"式的仪式感与自由度（见 §6，插件只需提供最小支撑）。

## 2. 核心概念：叠加层，不动底仓

- 保留 37 项静态委托作为**底仓**（新人保底），字段、判定、奖励管线**一律不改语义**。
- 新增**动态委托层**：每日 05:00（Asia/Shanghai）生成 3–5 张，当日有效，次日重生成。
- 看板上动态委托以"今日"标签/分节与底仓区分；同一时间动态委托最多进行 1 项。

## 3. 数据源（服务器已有数据，不新增采集）

| 数据 | 来源 | 模板方向 |
| --- | --- | --- |
| 共享箱余量 | 公会服务区四组双箱（左箱基准坐标 `(-473,67,-491)` 起，见 `GuildHallManager#storageInfo`） | 供需：某组余量低于阈值 → "补 N 个 X" |
| 居民状态 | 现有玩家统计（声望/认证/在线/最近委托） | 互助："向 <低声望新居民> 赠送 X" / 教学委托 |
| 村庄事件 | `mcagent:village` 警报记录 | 应急："巡逻队出现在西边，去看一眼" |
| 时令 | 天气/现实日期 | 雨钓日（钓客奖励翻倍）、收获祭 |
| 里程碑 | 成就/首次事件（可先接 1-2 种：首次合成铁镐、首次通关试炼） | 庆祝委托 + 全服公告 |
| 双人关系 | 组队记录（现有 party 机制） | 双人协作委托 |

## 4. 功能规格

### 4.1 DailyBoardManager（新类）
- 每日 05:00 生成；启动时若当日未生成则补生成。
- 模板用 YAML 定义（`dynamic-board.yml`）：每模板含 `id、文案（{占位符}）、目标类型、参数取数方式、奖励`。
- 生成结果当日缓存于 config（`dynamic-board.today`），便于审计与去重；连续两日不得生成同一模板同一目标。
- **人工覆写**：控制台/`Goddess` 可用命令替换或增删当日动态委托（v0 人工运营期与 v1 并存的接口）。

### 4.2 命令与展示
- `/mycli guild board`：顶部增加"今日"分节（动态委托），底仓分节后移，不覆盖公会底部菜单（沿用 0.3.72 的看板控件约定）。
- 新增控制台命令 `mycli admin board regenerate|replace|clear`（调试与人工运营用）。
- Agent 私有回执：生成后向已登记在线 agent 单播摘要（复用 `mcagent:life` 通道风格，`schemaVersion=1`，新 type `MC_BOARD_TODAY`，≤256 字符私聊短 JSON + 完整数据进插件频道，遵循 0.3.73 的长度约定）。

### 4.3 判定与奖励
- 判定复用现有委托判定器（生活委托的事件统计/物品交付路径），不写新判定逻辑。
- 奖励：复用声望 + 个人试炼箱管线；动态委托声望 = 模板基准 × **1.2（村急件加成，取整）**。
- 完成/过期文案点名受益人（如"fulumu 收到了你的火把"），强化"被看见"。

## 5. 兼容性与安全约束

- **不迁移世界数据**；config 新键全部带默认值，旧 config 平滑升级。
- Geyser 基岩与 Mineflayer 全兼容：纯原版物品/原版菜单/纯文本，不新增资源包或自定义物品。
- **儿童向**：文案温和可懂；涉及其它玩家的委托默认"可拒绝"；19:00–20:00 萌萌在线时段生成的
  社交类委托仅在对方公开可见区域进行，不做私聊强制互动。
- 保护插件拒绝的方块操作不计进度（沿用生活委托的既有过滤）。
- 女神观战账号（Goddess）不生成、不收到动态委托。

## 6. 生活化最小支撑（本版顺带，工作量小）

- `mycli life status` 尾部追加一句动态文案："今日无委托也可：去钓一次鱼、看一场日落，都算过好了今天。"（固定池随机，纯文案）
- 里程碑全服公告：复用 announce 风格，仅对"首次"类事件触发，每日每玩家至多 1 条。

## 7. 验收标准（隔离服 stage 断言）

1. **生成**：admin 触发 regenerate → 生成 3–5 张；连续触发两次 → 第二次去重不重复模板+目标。
2. **数据驱动**：将共享箱某组余量改为低于阈值 → regenerate → 出现对应供需委托且数量正确。
3. **展示**：Java 原版菜单与基岩手柄均见"今日"分节；底仓 37 项不受影响、可正常接/交。
4. **判定与奖励**：完成一张供需类动态委托 → 声望按 ×1.2 结算、物品扣除、奖励入个人试炼箱。
5. **单播**：在线 agent 收到 `MC_BOARD_TODAY` 短 JSON；非本人账号收不到。
6. **覆写**：控制台 replace 替换当日某张委托后 board 立即反映。
7. **兼容**：Geyser Pong、女神桥、Watchdog 正常；日志无新 ERROR。

## 8. 验收与发布约定

- 隔离服：实际使用 `E:\MC\staging\life-buildings-20261003`（25567），probe 脚本命名 `dynamic-board-stage.mjs`、
  `dynamic-board-actions-stage.mjs`，惯例同 `life-guild-*.mjs`。
- 发布：仅在无试炼（`Dungeon finished` 后无 active）、仅服务账号在线时，走 `Afu-MC-DailyBackup`
  停服 → E/F 双盘快照 → 换 JAR → 重启 → 只读探针复核。回退用同次快照。
- 版本号顺延（0.3.77+），plugin.yml 与 OPERATIONS.md 补发布记录（含 JAR SHA256）。

## 9. 范围外（明确不做）

- 不做第二套货币/数值系统；不迁移或重写 GuildManager 静态底仓；
- 不做玩家自建委托（UGC）；不接 Jobs Reborn/BreweryX 等外部职业插件（取舍见 LIFE_GUILDS.md）。

## 10. 0.3.78 运营方式与实现边界

初次安装 0.3.78 JAR 仍需按 [OPERATIONS.md](OPERATIONS.md) 的流程备份、隔离测试和正常重启。安装后，**新增或调整已支持类型的供货委托与日常活动，只编辑正式服 `plugins/AgentFriend/dynamic-board.yml`，不用改 Java 或重启 Paper**。插件首次启动会从 JAR 复制默认模板到此文件；以后不会覆盖运营者的文件。模板文件必须纳入 E/F 备份，并与 `config.yml` 的当日卡片快照一起恢复。

模板用 `templates.<稳定ID>` 作为唯一 ID；标题、说明支持 `{item}`、`{count}`、`{stock}`、`{beneficiary}`。`reward.fame` 是基准值，生成卡片时乘 1.2 四舍五入；绿宝石和物品奖励仍进入个人试炼箱。每个模板可以设置 `priority`，数字高的先入选；同优先级每天洗牌。当前支持以下通用积木：

| 字段 | 可用值 | 取数与判定 |
| --- | --- | --- |
| `source` | `always`、`shared_stock`、`rainy`、`calendar`、`village_alert` | 分别为每日候选、公共箱库存低于阈值、主世界下雨、现实月份、当前村庄警报。`shared_stock` 需要 `chest: weapons|armor|supplies|misc`、`item`、`trigger-below`、`max-request`；`calendar` 需要 `months: [1..12]`。 |
| `goal` | `donate`、`craft`、`fish`、`lanterns`、`floor`、`party_floor`、`kills`、`claims` | 分别为交付普通物品、亲手合成次数、钓到鱼次数、放置照明方块、过指定试炼层、至少两人过指定层、击败试炼怪、领取个人试炼奖励。`floor`/`party_floor` 需要 `floor: 1..15`。 |
| `item` | Paper 1.20.6 原版物品名，如 `TORCH` | `donate`/`craft` 必填；`fish` 可用 `ANY_FISH` 或具体原版鱼名。供货时只数无自定义数据的普通物品。 |

例如，未来想加胡萝卜补给，不改代码，在 YAML 的 `templates:` 下加：

```yaml
  supply_carrots:
    source: shared_stock
    chest: supplies
    item: CARROT
    trigger-below: 32
    max-request: 16
    goal: donate
    title: 给大家备胡萝卜
    description: 补给箱还有 {stock} 个胡萝卜；请交付 {count} 个。
    icon: CARROT
    beneficiary: 出门冒险的人
    priority: 90
    reward: {fame: 6, emeralds: 2, bonus: BREAD, bonus-count: 2}
```

编辑完成后，在 RCON/控制台或由已验证的 Goddess OP 观战账号执行：

```text
mycli admin board reload                 # 校验并热加载；失败保留上次有效模板
mycli admin board list                   # 查看今日快照与序号
mycli admin board regenerate             # 按新模板/实时库存重新生成；不足 3 张时保留旧版
mycli admin board replace 1 supply_carrots # 立即把第 1 张换成指定模板
mycli admin board add supply_carrots     # 今日追加，最多 5 张
mycli admin board remove 1              # 撤下第 1 张
mycli admin board clear                 # 清空今日动态层，次日 05:00 恢复
```

`reload` 不悄悄改变已发布的当日卡片；用 `replace` 或 `regenerate` 生效。玩家已接的同 ID 动态卡会冻结接单时的目标和奖励，即使运营者之后热改模板，也按原条件完成。若卡片被撤下或次日过期，玩家下次查看时会收到指名受益人的过期说明，任务槽释放，未交付物品不会扣除。供货交付先检查公共箱容量，再把真实物品存入对应双箱；奖励队列拒绝时回滚背包和箱子。缓存写在 `config.yml` 的 `dynamic-board.today`，含日期、修订号和已解析卡片；`dynamic-board.previous.signatures` 用于跨日去重。Agent 的短 JSON 私聊不超过 256 字符，完整卡片仅单播 `mcagent:board`，旁观者与未登记用户不会收到。

目前的无代码运营范围就是上表已支持的数据源与动作。新的特殊数据源、向指定玩家直接送礼与同意/拒绝流程、以及未接入的成就类型仍需一次性增加通用判定器；不要只改 YAML 声称新动作已有真实判定。当前固定里程碑公告接入首次合成铁镐与首次通过第 10 层首领关，每位玩家每看板日最多公告一次。其他运营活动可以先用现有 `source`、`goal` 和文案组合成卡片，不必重建插件。
