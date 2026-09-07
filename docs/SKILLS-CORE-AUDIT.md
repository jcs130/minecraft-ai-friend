# 自研技能内核审查

2026-09-07。本轮修改 `world/src/mc-magic.ts` 与 `world/src/skill-catalog.ts`，入口由 `mc-cli.ts` / `mc-god.ts` 共用内核。原子定义和成长数据保留，按用户最新要求精简实际可施放目录：8 个精选主动、64 个档案（其中 57 主动停止 cast，7 被动保留）。未改原 C 盘源码或直接修改运行中的成长存档。

## 运行数据

`server/world-data/magic-atoms.json` 有 72 项：65 主动、7 被动，ID 无重复；与 `world/data/magic-atoms.json` 语义相同，仅序列化格式不同。运行定义 SHA-256：`77fc8964f4e55f7282b39ea9e619e9a6b4fd28fc7a11667501f1629973fbce6e`。

只读检查 26 条成长记录，未发现不存在于当前定义的已学 ID。原记录的技能栏以 6 槽、1 槽或未设置为主。新代码不重置等级、魔力上限加成、已学技能、天赋或被动；八槽只是快捷选择上限，不等于只能掌握八项技能。

对仍开放的精选技能保留原设计“知道咒语即可尝试，成功咏唱即掌握”：自然咏唱与精确 CLI 均依次遵循原等级／天赋、魔力、生命与饱食规则。没有新增全面的“必须先学会才能施放”门槛。守护天使代主人施法仍保留原先的已学／天赋限制，快捷技能栏只收已学或天赋的精选主动技。归档技能即使是旧天赋也停止主动释放，但天赋历史不清空。

精选顺序：`home`、`tp`、`give`、`blood_mana`、`spring`、`sky_walk`、`feather_boots`、`fireworks`。传送阵独立保留，不属于 72 原子。逐 ID 理由和原生替代依据见 [技能精简审计](SKILL-CONSOLIDATION-AUDIT.md) 与 [目录配置](../config/skill-catalog.json)。原生提示不是自动解锁，必须实际持有并装备相应书/卷轴。

## 统一接口

```ts
castExact(username, skillIdOrExactName, params?: Record<string, string | number>): Promise<CastResult>

interface CastResult {
  ok: boolean
  code: string
  skillId?: string
  name?: string
  summary: string
  manaLeft?: number
  cooldownMs?: number // 剩余冷却毫秒
  nativeHints?: string[] // 归档主动的原生替代提示，不是授予记录
}
```

精确解析优先级为稳定 ID、完整显示名称、唯一的完整咒语别名。它不做子串猜测，不调用向量或 LLM；未知名称返回 `unknown_skill`，别名冲突返回 `ambiguous_skill` 并列出可用 ID。例如“铁卫”同时对应 `guardian` 与 `golem_guard`，必须改用 ID 或完整名称。

结果码包括 `ok`、`unknown_skill`、`ambiguous_skill`、`invalid_params`、`passive`、`skill_archived`、`level`、`mana`、`health`、`food`、`already_full`、`cooldown`、`busy`、`offline`、`unavailable`、`command_failed`、`execution_error`、`outcome_unknown`。调用方应判断 `ok`，不要根据中文摘要猜成功或固定返回成功。失败不应触发“咏唱成功”气泡；结果待核实时不自动重发。

`castSpell`、`castFuzzy`、`castAsOwner` 保留 `Promise<string>` 兼容接口；其玩家扣费执行路径共用同一个结构化执行核。`castByGod` 仍是特权神迹通道，不能拿来替代普通玩家或 Agent 的精确 CLI。

`listAtoms()` / `getAtomById()` 保留全量历史原子，新增深拷贝 `catalog:{status:'featured'|'archived',reason,nativeHints}` 与目录图标覆盖。所有施放入口共同拒绝归档主动，包括特殊 `fire_aura`、旧技能书、模糊命中及代施路径；不删已授装备触发器。被动返回原有 `passive`，既有永久增益、参悟进度与装备 NBT 均保留。`feather_boots` 是主动制造装备，不是被动解锁。

当前参数规格由 `listAtoms()` / `getAtomById()` 的 `params` 提供副本：

| 技能 | 支持参数 |
| --- | --- |
| `tp` | `distance` 整数 0–30，默认 5；`direction` 八方向，默认东；每格额外消耗 5 魔力 |
| `spring` | `distance` 整数 0–10，默认 2；`direction` 八方向，默认东 |
| `give` | `item` 已开放物品中文名或 ID；`count` 整数 1–16，不指定时沿用各物品原默认数量 |

方向接受中文及 `north/east/south/west/northeast/...`。未知参数、无效物品、超界数量直接返回错误，不默默换成面包、不静默钳制参数。没有声明目标参数的技能不接受 `target`，避免自身法术被误解成对他人施放。原 CLI 的“造物 火把”等位置参数由入口兼容映射为 `item` 后调用本接口。

## 已修复问题

- 显示名称与咒语词不同导致误匹配。共有 12 项的完整名称不包含自身别名，包括羽落、多项光环及带间隔点的附魔名。完整 ID／名称现在优先匹配，`附魔·闪电链` 不会误放成攻击闪电链。
- 主动施法入口会误接收被动。现在被动返回 `passive`，不查询／扣取主动施法资源；技能摘要仍保留 `type` 与 `passiveId`。
- 原技能栏默认 6 槽而设置上限 8 槽。现在统一 `SKILLBAR_SLOTS = 8`；重复、失效或被动条目原位变空，不把后面的按钮挤到前面。返回数组不再暴露内部状态。最初空栏的角色学到技能后也能获得默认快捷栏。
- 原冷却用 `elapsed > 0`，同一毫秒重复调用可穿过；也会在离线、生命不足等前检失败时启动冷却。现在时间边界正确，前检失败不消耗冷却。开始结算后的失败保留防重复窗口，不盲目重试可能已生效的命令。
- 增加同一资源主人跨技能的执行中互斥，防止两个异步请求同时读取同一份魔力预算。玩家和 Agent 共用技能分档：攻击 3 秒、辅助 6 秒、造物 15 秒、治疗 8 秒，移除了按几个固定用户名强加 20 秒的差异。
- 原 RCON 指令错误只影响台账，仍会返回成功描述、学会技能、增加修为。现在明确返回 `command_failed`，不记成功或新学习。正常效果已生效但纯视觉失败时，仍返回技能成功，避免诱发重复释放。
- 燃血施法在无法读取生命时不再继续；服务器拒绝生命代价时不发放兑换魔力。兑换回执改用扣费前快照，修复原可变状态引用导致“换取魔力 0”的错误。
- 配置存在时严格验证 schema、重复键、重复/未知/漏项 ID 与被动分类；畸形目录拒绝启动，失败热重载保留旧门禁。缺少可选目录的旧离线夹具保持兼容，不改运行原子表。
- 旧归档技能栏槽位仅在视图原位为空，读取不重写原有数组；默认栏只选精选，新绑定归档 ID 不能进入槽位。
- 精选技能从 `qdlocation` 读取真实施术者坐标。`home/tp` 经 `qdwarp` 校验目标维度、安全落点及实际移动，确认后扣魔力；其他精选普通命令和粒子/声音包 `execute at`，修复 RCON 默认维度/观察者缓存误用。归档风爆术后停止全局清扫正常风弹。

## 验证与边界

执行：

```text
node --test world/tests-ai/magic-core.test.mjs world/tests-ai/magic-summary.test.mjs
```

34 项离线测试通过。测试将实际 TypeScript 内核打包后运行，以临时文件替代状态，以假 RCON 记录真正生成的指令，并禁止网络。除旧精确接口回归外，覆盖全部 57 归档主动跨入口零世界访问、7 被动及额外永久奖励保留、旧槽不改盘、完整目录校验与失败热重载、精选跨维度移动/造物、失败不扣魔力和不重放。测试显式设置 `stateMirrorPath: null`，不会触碰 `/mcdata` 镜像。

项目整体类型检查仍有其他模块的既有诊断，本次检查未报告 `mc-magic.ts`、`skill-catalog.ts` 或 `waypoint-travel.ts` 错误。根任务已完成本轮实际服务器验收，结果与离线回归分开记录：

- [skill-compass-smoke.json](../reports/skill-compass-smoke.json)，2026-09-07 04:17:53–04:18:01 UTC，10 组全绿：无客户端模组的生存 QA 真正右键打开 27 槽罗盘，8 个独特图标、归档只读/禁止施法且不扣魔力、Shift 点击防误施法/取走物品、原生入口 54 槽菜单、13 个传送点及第 9 项稳定引用传送、第 8 槽设置/去重，以及烟花实际生成 3 实体、消耗约 5 魔力、唯一台账和重复冷却均通过。QA 退出、测试锁释放有报告记录。
- [waypoint-travel-smoke.json](../reports/waypoint-travel-smoke.json)，2026-09-07 04:07:27–04:07:35 UTC，8 组全绿：Numen UUID 定位、安全镇内落地、原生冷却、无支撑高空/不存在维度拒绝，真实下界进入和返回主世界全部通过；测试假人已 dismiss。
- `node --test world/tests-ai/catalog-guidance.test.mjs`，6 项离线测试通过。欢迎教学从实际精选列表生成；目录模式自动守护仅尝试正常原生治疗，不再调用归档 `heal/feed`。只有 `casting_started` 写入“开始施法”事件，未装备、拒绝或回执异常均不记为救活。实际 `guardScan` 函数在隔离依赖中验证了单次调用、90 秒节流、失败无成功史记、饥饿安全指引与无目录旧兼容。

菜单实测使用协议点击，未据此声称实体手柄硬件已验收。欢迎/守护测试没有实际伤害玩家或触发治疗，不能把原生受理等同生命恢复；最终进程加载由根任务统一重启。

仍需区分的原机制：Minecraft 禁止直接改玩家饱食 NBT 时，旧实现用 Hunger 状态近似扣饱食，实际耗时受饱和度影响；这不是严格原子扣费。多条 RCON 指令中途断线可能已有部分效果和生命/饥饿消费，因此不会自动回滚或重放；目录启用后的非负魔力消耗延后到效果确认成功。自然语言路径仍保留原向量与 LLM 兜底；需要可预测行为的 CLI 应使用 `castExact`。旧无目录夹具保留观察者安全传送逻辑，部署目录环境统一使用原生安全桥，不再失败后原地传送却声称成功。

原生铁魔法使用自己的法力、冷却、法术书与施法时间，已通过独立桥调用正常玩家施法链；本轮没有把两种法力合并或重建等级属性体系。`spells archive` 提供的替代提示不意味着玩家自动拥有该法术。
