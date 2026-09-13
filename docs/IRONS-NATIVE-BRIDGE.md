# 原生铁魔法桥（Minecraft 1.21.1）

本桥把千灯纪玩家与 Agent 的确定性入口接到已安装的 Iron's Spells 'n Spellbooks **1.21.1-3.16.3**。它只从角色实际装备的原生法术书、镌刻装备和手持卷轴选择法术，不解锁、不发放法术，不调用管理员无消耗施法，也不写千灯纪原有技能/魔力存档。

构建目标为 NeoForge 21.1.248 / Java 21。只有服务端安装 `qiandeng-irons-bridge-0.1.0.jar`；没有新增自定义网络通道，菜单使用原版六行箱子协议。游戏中仍需遵守原生装备、学习、法力、冷却、施法时间、目标和事件判定。旧独有技能的原成长数据暂保留，不能把一条原生法术同时交给两套资源系统扣费。

## 命令与权限

| 用途 | OP 2 桥接命令 | 玩家本人，无需 OP |
| --- | --- | --- |
| 法力、原版 XP 等级、属性、当前施法 | `qdspell status <actor>` | `qdspell self status` |
| 当前装备与手持卷轴可见法术 | `qdspell list <actor>` | `qdspell self list` |
| 确定性原生施法 | `qdspell cast <actor> <namespace:id>` | `qdspell self cast <namespace:id>` |
| 显式取消 | `qdspell cancel <actor>` | `qdspell self cancel` |
| 可点击/手柄操作的法术菜单 | `qdspell menu <actor>` | `qdspell self menu` |
| Pufferfish 原生成长只读查询 | `qdspell progression <actor>` | `qdspell self progression` |

`actor` 只接受确切角色名（大小写不敏感）或 UUID，不支持 `@a` 等批量选择器。查找同时覆盖玩家列表与各已加载世界中的 `ServerPlayer`，因此覆盖继承它的 NumenPlayer。同名不同 UUID 会返回 `ambiguous_actor`；调用者必须选择 UUID。`self` 分支没有另一个目标参数，不借 OP 权限扩大本人操作。

`list` 不代表全注册表或已解锁法术目录。装备已拆掉时，即使上一秒的列表仍显示法术，`cast` 也会重新取装备并拒绝。相同 ID 同时出现在法术书和手持卷轴时，使用原生选择列表中的装备来源优先，然后主手/副手卷轴；不会因法术书冷却而自动消耗卷轴。菜单对此每个 ID 只显示一个按钮。

## 结构化结果

每次操作输出单行 `QD_SPELL_JSON ` 加 JSON（空格分隔，无冒号）。公共字段：

```json
{"schema":1,"engine":"irons_spellbooks","ok":true,"code":"ok","action":"status","actor":"QDIronsProbe","actorUuid":"...","summary":"原生施法状态"}
```

`status` / `list` 顶层另含 `mana`、`maxMana`、`level`（原版 XP 等级），`attributes` 包括原生 `maxMana`、`manaRegen`、`spellPower`、`spellResist`、`cooldownReduction`、`castTimeReduction`、`maxHealth`、当前 `health`。`casting` 包含 `active,id,level,castType,remainingTicks,totalTicks,progress`。没有正在施法时数值为 0，ID 为空字符串。

`list.spells` 每项有 `id,name,nameKey,level,mana,cooldownMs,castTimeTicks,castType,source,sourceSlot,index,ready,reasonKey?`。等级考虑原生装备加成；卷轴的本次法力与书本冷却为 0。`ready` 是只读原生基础预检：真正施法仍运行目标检查与模组事件，不是成功保证。专用服务端的 `name` 可能是英文/翻译键，前端可用 `nameKey` 与已安装客户端语言资源显示中文。列表最多输出 256 项，并给出 `total` / `truncated`。

成功受理原生施法：`ok:true, code:"casting_started", accepted:true`，另含 `spell,manaBefore,manaAfter,casting,acceptanceEvidence`。`phase` 是 `casting`，若原生调用返回时已不处于施法状态则为 `accepted`。**这不是效果完成回执。** 施法可在随后游戏 tick 中完成、取消或失败；持续法术还可能分次消耗。调用者要验证效果，应检查后续原生状态、法力、冷却和目标实际效果。

失败包括 `not_equipped`、`busy`、`actor_unavailable`、`invalid_skill_id`、`mana`、`cooldown`、`unlearned`、`native_denied`。已在施法时新的请求返回 `busy`，不会触发上游 quick-cast 的“再次调用取消”行为。意外异常返回 `bridge_error` 和“结果待核实，不要自动重发”：调用可能已经产生部分原生作用，不能盲目重放。

`progression.categories` 来自已安装 Pufferfish Skills 0.18.3 的 `SkillsAPI.streamCategories()`：`id,available,level,experience,points_total,points_spent,points_left`。无经验系统的类别 `available:false,code:"no_experience"`，`level` / `experience` 为 null，点数仍是原生 getter。`points_left` 不是 `total-spent` 的简单推导，原生上限或历史记录可使它为负。此接口不学习、不导入、不重置技能树。

## 为什么是正常施法路径

装备施法使用 `new SpellSelectionManager(player)` 与 `Utils.serverSideInitiateQuickCast(player, globalIndex)`。上游会继续调用 `AbstractSpell.attemptInitiateCast`，执行原生判定和可取消事件，再建立原生施法状态；后续 tick 决定效果、扣法力和冷却。[官方 Utils](https://github.com/iron431/Irons-Spells-n-Spellbooks/blob/1.21/src/main/java/io/redspace/ironsspellbooks/api/util/Utils.java)、[官方施法实现](https://github.com/iron431/Irons-Spells-n-Spellbooks/blob/1.21/src/main/java/io/redspace/ironsspellbooks/api/spells/AbstractSpell.java)。

卷轴保留真实手中 ItemStack，经 `ServerPlayerGameMode.useItem` 调用原生物品使用。安装 JAR 的 `Scroll.use` 字节码显示 `attemptInitiateCast` 接受时返回 CONSUME，拒绝时返回 FAIL；桥按原生使用返回判断受理，不能只用 `isCasting`，以免瞬间完成被误报失败。卷轴实际移除仍由上游施法流程处理。[官方 Scroll](https://github.com/iron431/Irons-Spells-n-Spellbooks/blob/1.21/src/main/java/io/redspace/ironsspellbooks/item/Scroll.java)。

API 以安装的 3.16.3 JAR `javap` 签名和字节码再次核对；上游分支名是 `1.21`，该分支的目标 Minecraft 是 1.21.1。没有使用 `CastSource.COMMAND`、管理员 `CastCommand`、直接 `onCast`、手动 `MagicData.setMana` 或清冷却接口。

## 构建与验收

在项目根执行：

```powershell
python tools/build_irons_bridge.py
node --test world/tests-ai/irons-smoke-contract.test.mjs
```

构建工具只读复用 botgate 的 NeoForge 依赖选择函数，编译独立源码；不会部署、启动服务或读取密钥。可用 `JDK21_BIN` / `--jdk-bin` 指定 JDK。输出位于 `world/irons-bridge-src/build/`，包含 JAR 与源/依赖哈希记录。包含安全传送的当前部署 JAR SHA-256 为 `826352269d1bb337042e083f223bf725a94a8a878f2a3b34f3c8b288f46aeee3`，以构建记录和 `manifests/server-extensions.lock.json` 核对。离线测试覆盖 8 项角色精确查找边界，以及冒烟严格回执/隔离目标检查；这不能替代实际游戏施法。

由根任务统一将 JAR 放入独立服务端 mods 后重启。在已挂载工具目录 `/checks`、源码 `/app/src`、独立运行数据 `/app/data` 的 world 容器执行：

```powershell
docker compose -p qiandengji run --rm --no-deps -T -e SMOKE_EXECUTE=qiandengji -e SMOKE_PROJECT=qiandengji -e SMOKE_TIMEOUT_MS=180000 -v D:/Projects/QiandengJi/tools:/checks:ro --entrypoint node world --import tsx /checks/smoke_irons_bridge.mjs
```

把标准输出 JSON 以 UTF-8 保存为 `reports/irons-bridge-smoke.json`。脚本在任何连接前检查 `mc:25599` / `mc:25575`、独立数据标记与共享 QA 锁；只使用 `QDIronsProbe` / `QDIronsBody`。已有同名在线角色时拒绝接管。夹具只修改这两个测试角色，选择仅作用本人的原生隐身术。金法术书是原生 `gold_spell_book`（8 格，mustEquip=true），使用真实 Curios `spellbook` 槽；卷轴在真实主手。生存资源验证不使用创造模式、不设置法力、不清冷却。

断言顺序：生存登录 → 无装备拒绝 → 装备书本列表 → 重复请求 busy 且不取消 → 显式取消无效果 → 实际菜单打开/点击 → 实际隐身、法力扣除、原生冷却拒绝 → 移除书本后玩家真正私聊 `咏唱：铁魔法：隐身术`、卷轴生效与消耗 → Numen UUID 投递 `skill-cli` 不可变请求、校验 requestId 和原生受理回执、卷轴完整施法 → 原生成长只读查询。最后清理自己的夹具/效果、dismiss 自己召唤的 Numen、验证退出并释放锁。脚本失败只表示对应断言未通过，不能以开始施法日志充当完成。

最新部署的完整入口回归已通过：`reports/irons-bridge-smoke.json` 于 **2026-09-07 04:23:03 UTC** 记录 **12 项全绿**。包含真实六行菜单点击、法力 150 → 115（35 点）、原生冷却 44950 ms；实际中文私聊咏唱后产生隐身效果、卷轴耗尽且法力 100 → 100；Agent 文件 CLI 的 UUID 请求返回匹配的 requestId/actorUuid，随后 Numen 真正产生效果并消耗卷轴；2 个原生成长分类可读。`bodyDismissed`、`qaFixtureCleared`、`probeDisconnected` 均为 true，共享 QA 锁已释放。

此前 9 项直连桥全绿另存 `reports/irons-bridge-direct-smoke.json`。最终健康状态引用完整入口主报告，不能以直连或构建成功替代。常驻执行由已有 MC 容器与其 restart/health 策略覆盖，不新增裸进程。本次游戏内实测法术是隐身术；其他法术沿同一个上游接口执行，但没有逐个释放，也没有把箱子协议点击验证称为物理手柄硬件验证。

验收中明确区分了两种非施法失败：新角色欢迎事件的错误文字可能混入 RCON 控制台输出，所以夹具以独立状态读回确认、不按任意 error 子串重放；卸下金法术书会恢复较低的原生法力上限，先等 Curios 属性变化和原生法力截断稳定，再计算卷轴是否扣法力。两者均未通过改法力、清冷却或重复写命令掩盖。

完整入口测试也定位并推动修复了旧私聊接线：minecraft-protocol 将离线 profileless 消息转成 `playerChat`，正文在 `formattedMessage`；prismarine-registry 的 `formatString` 已本地化，1.21 的网络 holder 编号也有偏移。世界入口现在按稳定的 `minecraft:msg_command_incoming` 注册名区分私聊，统一提取两种正文并关联真实在线角色，仅保留一个监听入口，避免重复施法。冒烟在消耗法术前先发只读 `cli status` 验证这条真实私聊路径。

## 同一服务端桥中的安全传送

`qdlocation <actor>` 只读真实角色位置，`qdwarp <actor> <dimension> <x> <y> <z>` 执行原生传送；两个命令均要求 OP 2。玩家和 Agent 使用 `/mycli waypoint` 与 `/mycli goto personal:6` 等地点引用，由世界服务解析归属和坐标，不开放原始坐标命令的本人权限分支。

传送使用角色的实际世界、站立身体尺寸、承重地面、碰撞和危险方块检查；在请求地点水平 2 格、垂直 4 格内选择可用落点，没有安全位置就拒绝。按 UUID 共用 3 秒冷却，支持 Numen，传送后核对实际维度与坐标。回执使用单行 `QD_WARP_JSON `，字段含 schema、action、ok、code、actor、actorUuid、dimension、x、y、z。无法确认回执时返回 `outcome_unknown`，不自动重发。

真实 Numen 主世界/下界往返、冷却和不安全目标拒绝 8 项通过；罗盘 13 个地点可见且实际点击第 9 项到达。具体范围及存储兼容见 [传送阵审计](TELEPORT-ARRAY-AUDIT.md)。此次没有安装额外传送模组，没有重建原地点数据。
