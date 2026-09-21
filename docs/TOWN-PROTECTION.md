# 主城区建筑保护

2026-09-21 更新：普通拆建已改为**固定方块名单**，不再封锁整片城区的空气。空位可放床，玩家新增方块可以拆除；建筑、道路、保留设施及其基础合计 88,134 格受保护。火焰、流体与危险桶操作仍按区域约束。当前 schema 2、实现及验收说明见 [女神意图分流与方块级城镇保护](JEV-SPELL-ATTENTION.md)。下文是 9 月 20 日整区保护的历史部署记录，不代表当前普通建造规则。

2026-09-20 22:15:43（北京时间）：正式部署和原调度恢复完成。生产 `qdworldprotect status` 已确认保护启用、全高边界正确且无 OP 手动豁免，`town_protection_health.py` 四项全部通过；29 个文件部署于 22:06:30 完成，bridge/Numen 哈希与隔离 QA 组合一致。152 项离线断言、26 项原生行为测试仍分别标为离线/隔离 QA 证据，不冒充生产破坏性试验。Qwen 随后自然恢复 healthy，恢复后的服务、PawApps 和原生语音工具复查通过；全量 health_mon 原报告仍为失败，不能据专项通过宣称全项目全绿。

范围为主世界 `minecraft:overworld` 的 X `[-715,-375]`、Z `[695,1035]`，边界包含在内，覆盖所有 Y。保护固定在既有服务端 `qiandeng_irons_bridge` 中，没有新模组依赖、守护进程、模型、维护租约或 Agent 提示词规则。

## 保护与保留的操作

| 操作 | 策略 |
|---|---|
| 真人、OP、Numen 假玩家手动挖掘 | 拒绝移除建筑；没有 OP 手动豁免 |
| 普通方块放置、工具剥皮/修路/新开耕地 | 拒绝；新工程由受信控制台维护 |
| 小麦、胡萝卜、马铃薯、甜菜 | 只允许成熟作物且下方实际为耕地时收获；只允许空位且下方耕地时补种；骨粉仅用于这些已有农作物 |
| 干草、树叶、木材、草、泥土 | 不因“植物/农场材料”放行，避免拆掉屋顶、地板和围墙 |
| 门、箱子、熔炉等工作站、原版村民交易 | 保留原生交互和方块内部状态更新；隔离服已验证门打开及 ChestMenu/FurnaceMenu/MerchantMenu |
| TNT 等原生爆炸 | 从爆炸影响集合排除区域内方块，以及画、展示框、盔甲架；不因此给玩家无敌 |
| 火焰与相邻野外火灾 | 拦截区域内火焰生成和燃烧目标；营火不是普通火焰，不被移除 |
| 水/岩浆扩散、流体转化 | 按目标方块拦截；边界外流体不能冲入破坏装饰。水池正常静态保留，区域内自然水流重排也会受限 |
| 活塞 | 检查本体、头、推动块及目的地、被破坏块；跨边界操作也拒绝 |
| 生物破坏、踩坏农田 | 拒绝破坏建筑；不全局关闭 `mobGriefing`，保留村民成熟作物耕作路径 |
| 野外、其他维度 | 不适用这个区域规则，保留原生控制与 RSI 实验空间 |

底层覆盖 NeoForge 原生 break/place/tool/explosion/piston/griefing 事件，并以窄 Mixin 补充 `Level.removeBlock/destroyBlock`、火焰、流体目的地。没有全局拦截 `Level.setBlock`，否则门开关、炉子点亮、作物生长以及原生维护都会被误伤。Mixin 为服务端专用且 `required=true` / `require=1`；目标方法不兼容时拒绝启动，不能静默降为无保护。

受信控制台/RCON 的 `setblock`、`fill`、`place template` 和 `clone` 是维护入口。为保留床门等邻接清除，只有命令源无实体且权限 4 时，这四个原生实现的同步调用栈会允许底层移除。作用域用 `try/finally` 清理；返回、异常、下一 tick、其他线程均不能继承，不存在持久开关或租约。普通 OP 玩家和假玩家输入不会获得这个豁免。施工优先使用 `replace` 和完整双箱 `move`，避免 `destroy` 掉物。不要授权 Agent 任意 RCON、世界 NBT 编辑或安装服务端代码。任意第三方模组直接改区块、磁盘世界编辑及受信控制台本身不属于本保护的对抗边界。

“没有 OP 手动豁免”指挖掘、放置和工具操作；没有重新实现 Minecraft 的管理员命令权限。已经获准使用原版 `/setblock` 等命令的管理员仍能施工，本次不授予任何新命令权限。

## 现役兼容与构建证据

现役 Minecraft 1.21.1、NeoForge 21.1.248、Java 21。升级前 bridge JAR SHA256 为 `321c2e5c2d309c4936ffe0fa20808e50c109ea637a9db689f0178f81c8d353de`，与当时生产 build-record 一致；新增前候选与生产的原 12 个 Java 源文件逐字节相同。审计位于 `runtime/town-rebuild-20260920/protection/baseline-audit.json`。

候选构建命令：

```powershell
C:/Python314/python.exe -I -B tools/build_irons_bridge.py --libraries D:/Projects/QiandengJi/server/mc/libraries --mods D:/Projects/QiandengJi/server/mc/mods --numen-jar runtime/town-rebuild-20260920/candidate-dependencies/numen-neoforge-1.21.1-0.1.3.jar
```

仅使用现役依赖，不下载或部署。输出 `world/irons-bridge-src/build/qiandeng-irons-bridge-0.1.0.jar`，当前 SHA256 `361636f64e201bbf5cd11cf9963d9051d2a9562c1e3d157c804782f6a897af4a`。152 项离线断言通过：既有 actor lookup 8、trade rules 27、interaction arguments 12，固定区域/作物策略 83，以及维护作用域的源限制、嵌套、异常清理、线程隔离和延迟调用 22。作用域使用 NeoForge 已内置的 MixinExtras 0.5.3，不另装依赖。离线断言不证明 Mixin 启动成功，也不替代实际原生行为测试。

本次组合构建另用 `--numen-jar runtime/town-rebuild-20260920/candidate-dependencies/numen-neoforge-1.21.1-0.1.3.jar` 绑定楼梯修复候选 `5e913b2ffb1a39b199333f768526537867be726bf27c451e7a1a507cc8a35da0`；精确依赖与源路径记录在 build-record 中。QA-only helper 不属于生产依赖。

这是既有服务端桥的更新，不引入注册方块、物品、实体或自定义客户端网络包；从实现接口看无须更新客户端。部署时必须替换原同文件/同 modId，不能并列放两个 bridge JAR，并需要 Minecraft 服务端重启；不能用 `/reload` 加载 Java/Mixin。客户端保持原包的实际加入验证仍应记录为独立验收，未做时不能声称已测。

## 健康与验收

控制台/RCON 只读 `qdworldprotect status` 返回 `QD_TOWN_PROTECTION_JSON`，包括启用状态、范围、全高标记、无 OP 豁免和累计拒绝数。它只允许无实体的权限 4 命令源，不提供关闭保护命令。服务复用现有 Minecraft 容器看门狗，不新增常驻进程。

隔离服 `qd-town-rebuild-20260920` 使用 `network none`，在最终候选组合上完成以下原生验证。测试调用真实 Numen `ServerPlayerGameMode.destroyBlock/useItemOn`、原生命令和游戏更新，不以人工发布事件代替行为。

- 生存/创造 OP 假玩家城内挖掘被拒；野外可挖。普通放置城内被拒、野外成功，物品扣减符合结果。
- 门正常打开，箱子、熔炉和临时原版村民分别打开原生菜单。没有使用原居民交易或玩家物品。
- 光照完成更新后，成熟小麦真实收获并用种子补种（种子 3→2）；未成熟小麦不能破坏。胡萝卜、马铃薯和甜菜仅有策略断言，未逐种进行原生收获试验。
- 原生 TNT 实际爆炸后城内木块保留，野外对照被破坏；原生燃烧检查使用确定点燃概率，城内木块保留、野外对照烧毁。边界活塞不能推入，野外对照正常推进。
- 实际水、岩浆沿封闭导流槽流到边界外相邻格，城内草仍完整；边界发射器的水桶不能灌入，野外发射器对照实际放水。
- 控制台 `setblock`/`fill` 更换门时上下半均正确移除，床两半正确联动；单箱和完整双箱 `clone move` 后源为空，完整方块实体 NBT（仅排除根坐标）相等，双箱方块状态也相等。物品包含命名及耐久组件。
- 原生 `place template` 后核对 163 个模板方块名称。故意触发受信命令失败后，OP 手动挖掘仍被拒，验证同步维护作用域没有泄漏。
- 移出 QA-only helper JAR 和 marker 后第二次启动成功，原生保护状态仍启用，无新增客户端依赖。专用假玩家 `4b558c6e-0692-4d8e-a729-22151219d067` 和交易村民 `d4f9f834-9b51-4a9d-88d1-60176f388fab` 均精确核对不存在，主城仍为 33 村民/4 傀儡。

早期失败没有覆盖：旧候选曾留下门上半，已用上述同步命令作用域修复并重测；立即把熔炉换为耕地的测试曾因光照尚未更新导致原生种子放置失败，最终等待实际亮度 14 后通过，没有放宽保护；旧测试在嵌套命令实际执行前检查 `clone`，已改为派发与后像分别读取。最终模板命令的真实响应是 `Loaded template`，测试原预期文案错误使该脚本停止；未重投命令，随后 163 格后像证明放置成功。原始 journal 均在 `runtime/town-rebuild-20260920/protection/`。

交接时 QA 正常运行、tick frozen，已保存 `qa-snapshots/phase13-after-protection`，原 220 个 forceload 数量保持，本子任务未新增。测试场起始盒 X `[-728,-699]`、Z `[700,730]`、Y `[240,248]` 的 8,370 格先逐格确认空气且无实体，再搭建测试平台。高空场及野外侧自然危险效果只保留在隔离快照，不复制生产；这个初始盒并非全部世界变化的差异边界。主代理导航身体 QDTownQA920 在两次只读 UUID 查询中不在线，本子任务没有改动、重新召唤或重置它。详细交接见 `protection/handoff.json`。

`tools/town_protection_health.py` 接入既有健康循环，核对原生范围、部署 JAR/build-record/manifest/源码与上述真实 QA 回执。生产重启后四项全部通过，QA fixture 和 marker 未部署生产。上述结果不等于已验证所有第三方模组的破坏方式、全部作物/交易流程或真人客户端加入。

## 正式文件部署与运行验收

`runtime/town-rebuild-20260920/deployments/reviewed-final-files-v2/journal.jsonl` 已记 `complete`：29 个显式文件全部写入并验证，1 个 waypoint mirror 只备份。部署计划 SHA256 为 `ca66625f832a3c17ce1e3fa5061df10d0c10276d811e5d0512e9d23abc7d023a`；旧计划保留未执行，没有清除部署锁或重投。

实际服务端 bridge 为 `361636f64e201bbf5cd11cf9963d9051d2a9562c1e3d157c804782f6a897af4a`，Numen 为 `5e913b2ffb1a39b199333f768526537867be726bf27c451e7a1a507cc8a35da0`，与 QA 组合一致。原 Minecraft 容器正常停止，退出码 0，随后启动 healthy；正式 `before-restart` 完整备份为 `D:/backups/mc-neoforge-auto/2026-09-20T140359.5435857Z-2bea106a`，恢复后完整备份为 `D:/backups/mc-neoforge-auto/2026-09-20T141133.6146792Z-25448c7f`，均 complete/save-on confirmed。

`production/runtime-restoration-verification.json` 七项全部通过，包括全部 43 个部署相关文件（29 写入、14 校验相同）、原三份配置、primary/mirror waypoint、原五个容器身份/镜像及运行状态、生产保护。该回执当时 Qwen 为 unhealthy，原记录保留；随后未重启 Qwen、未改配置，Docker 原探针在 UTC 14:16:54–14:17:49 返回 exit0/ok=true，10 角色与 99 技能绑定通过，FailingStreak=0。13 个默认服务均 running，已配置 Docker 探针均 healthy，gate 没有 healthcheck。不能因此省略另行运行的全量 health_mon 历史问题。

`production/body-after-restoration/preservation-proof.json` 已确认 `identity_inventory_experience_permanent_abilities_preserved`：原身体身份、物资、XP、永久 abilities、健康、registry 和 advancements 保持。女神 attributes 只改列表顺序；桐人只增加原生临时 speed 修饰，原 world 被动引擎启动后重新施加既有五种已解锁效果，实际 ON 日志与 skill-events 配置均绑定到补证。它不是新永久能力，正常时间计数也不计为 RSI 收益。两份 strict comparison 原样保留 `differences_require_review`，完整解释见 `production/BODY-AFTER-RESTORATION-REVIEW.md`，未放宽通用校验规则。桐人只做一次 existing restore，女神沿原进程恢复原 UUID。`resumed.json` 于 `2026-09-20T14:15:43.653358Z` 确认 profilesAndCronsExactlyRestored=true，原 10 角色、16 班次和会话保持，原禁用项仍禁用。

223 个本轮 owned forceload 已全部释放。`20-resume-game-ticks` 的 unfreeze 一次实际成功，但测试预期写成 `unfrozen` 导致断言失败；真实响应是 `The game is running normally`，未重投命令。随后 `21-observe-resumed-ticks` 独立确认正常运行、目标 20 TPS、该次 100 样本平均 7.8ms。保留原失败 journal，不把断言文案错误写成未执行或再次解冻。

全量检查于 UTC 14:17:35 开始采样、14:20:53 输出，exit1，`production/full-health-after.stdout.json` 原样保留 14 个顶层失败。服务项采样早于 Qwen 的 14:17:49 自然恢复；`production/final-health-closure.json` 的新只读采样确认 currentServices.ok=true，原全量报告中的 town_protection 与 panel_smoke.game_qwenpaw 子项也通过，但 fullHealthOriginalOk 仍为 false，不能把这个子项当作整个面板通过。

UTC 14:23:58 用原 helper 单次复查 PawApps，8 项及既有行为证据全部通过；发现接口耗时 0.047 秒、两个 SDK 入口 0.203/0.078 秒、动态 board 6.453 秒。UTC 14:24:05 单次原生工具 GET 返回 200，耗时 0.547 秒，48 个工具中 speak/speech_status/stop_speaking 均启用。两次复查没有改源或延长 timeout，没有模型或游戏动作；后者仅证明工具可用，不证明客户端实际出声。证据为 `production/pawapps-recheck-after-recovery.json`、`production/character-speech-tools-recheck.json`。旧 character_speech 错误没有保留异常类型，不能武断归因为超时。

world_team 的发布清单为 13 项：合法 withdrawn 1、blocked 7、published 5；旧健康白名单不接受 withdrawn，造成检查契约不一致，本次没有修改检查器。其余全量失败需要按各自证据判断，不能统一称为历史问题，也不因服务恢复而覆盖原失败报告。 分类详见 `production/FULL-HEALTH-AFTER-CLASSIFICATION.md` 与 `production/full-health-after-classification.json`，分别记录采样窗口、临时读取问题、旧来源不匹配和检查契约差异；当前语音、队伍通信、女仆原生行为未做新的行为验收，不能统称纯历史或全部通过。

## 一手接口来源

- [NeoForge 1.21.1 事件说明](https://docs.neoforged.net/docs/1.21.1/concepts/events/)。
- [NeoForge 1.21.1 BlockEvent 源码](https://raw.githubusercontent.com/NeoForged/NeoForge/1.21.1/src/main/java/net/neoforged/neoforge/event/level/BlockEvent.java)：原生挖掘、放置、工具修改及流体事件。
- [NeoForge 1.21.1 FireBlock 补丁](https://raw.githubusercontent.com/NeoForged/NeoForge/1.21.1/patches/net/minecraft/world/level/block/FireBlock.java.patch)：燃烧检查含 `Direction` 参数，避免误用旧版签名。
- [MixinExtras WrapMethod 官方说明](https://github.com/LlamaLad7/MixinExtras/wiki/WrapMethod)与[现役 0.5.3 注入器](https://raw.githubusercontent.com/LlamaLad7/MixinExtras/0.5.3/src/main/java/com/llamalad7/mixinextras/injector/wrapmethod/WrapMethodInjector.java)：方法包装与参数类型检查。
- 运行版本最终以已装 `neoforge-21.1.248-server.jar` 的 `javap` 签名及编译为准。现役 Numen `BlockDigger.destroyNow/digStep`、`Interaction.use` 调用 `ServerPlayerGameMode`；现役该类字节码确认会执行 NeoForge break/right-click hooks。
- [GriefLogger 官方说明](https://daqem.com/projects/grieflogger)：已有模组用于日志与回滚，不等于区域实时阻止；原 InControl 刷怪规则同样不能代替方块保护。
