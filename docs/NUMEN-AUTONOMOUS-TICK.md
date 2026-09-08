# 自主桐人的区块更新

## 当前部署与实机结果

2026-09-08 已在项目服务端部署 `47cc11d609b03b62734c4772b2aa40a89ba02a5bbaab0d85ab10589d45ffec3b`，完成受管备份、替换与 Minecraft 重启；客户端未增加 Numen。维护证据在 `runtime/native-tick-maintenance/fc72856afa114d87b20d58fc1057837b/`，产物备份在 `runtime/numen-autonomous-backups/20260908T151105156372Z/`。

原桐人身体 UUID、主人和背包原样保留，`keepInventory=true` 未变。身体从 `(-627.5236145531612, 71.23152379758702, 976.0912591252202)` 自然推进到 `(-627.2315588291656, 71, 978.6089589446965)`，`OnGround` 从 `0b` 变为 `1b`；没有传送、物品写入或新建身体。维护报告中的身体/服务器 tick 同增 19。独立复查的原生健康 7 项全过，后续两次采样的身体/服务器 tick 同增 20，确认实体物理更新已经恢复。

`reports/numen-autonomy-smoke.json` 记录 5 项物理验收、当前 7 项原生健康以及原始证据 hash；可用 `python -X utf8 runtime/collect_numen_autonomy_smoke.py` 只读复查。该报告明确 `modelNavigationVerified=false`：自然落地和物理恢复不等于模型已经成功走到导航目标；模型行动与公会/小队回执仍分别验收，不覆盖旧报告。

后续恢复原生活会话的独立验收已通过，见 `reports/survivor-life-autonomous-tick-smoke.json`。首轮 `task-0ac9a230c648` 有 5 次原生 `goto` 成功到达回执，从原位置走到营地 `(-639.5,64,1050.6)`；一次进食动作前后饥饿从 10 到 15（进食接口仅返回过程结束，不能把它包装为原生完成标志）。第二轮 `task-83272dad1dc6` 有实际放置及睡觉回执，之后继续查看公会、采矿。原生任务和逐动作回执与同一个持久生活 session 对应；没有用新聊天或运营脚本代替角色决定行动。人物最近两轮回复已使用“结衣”。

同一生活会话的 `/mycli` 试用任务 `task-2a8d114c61f4` 已有两项真实成功回执：`feather_boots`（羽落之靴）和 `give bread 4`（造物术），均为此前已学能力。面包实物从 8 增至 12；羽落之靴施法成功，但当时背包 36 格占满，未在随身或装备栏验到靴子，不能声称已穿戴。两次回执均记录实际法力消耗，之后恢复满值不代表免费施法。`game_learn spring` 因没有真实技能书被拒绝，不能把本次试用记成新学技能。逐项证据保留在本机 `runtime/mycli-practice-one-task-native-proof.json`。

## 2026-09-08 实机故障

桐人仍在原生玩家列表中，身体位置长期停在 `(-627.5236145531612, 71.23152379758702, 976.0912591252202)`，`OnGround=0`，`Motion` 三轴不变。原生移动任务返回 `no-path`。只读 RCON 确认游戏时间正常推进，但 `execute in minecraft:overworld if loaded -628 71 976` 返回 `Test failed`；原主人 UUID 的实体测试也失败。不能把该故障归为树冠、模型传错高度或地形碰撞。

故障发生时服务端 Numen JAR SHA-256 为 `97ed80699ef1d0e7c958566a5b2873e13d4476b6c865675547cf275c68d87d67`；嵌套原生 API JAR 的 SHA-256 为 `48205ad1235dd4b154e045f20b6296eb17af35d5b3d5bf9d2a18a028ce0c4070`，与恢复补丁的已锁定基线完全一致。对该实际 API 的 `javap` 反汇编进一步确认：主人查找结果为空就跳过加载票刷新。

原生实现位于本机锁定源 `runtime/numen-walk-only-source/api/common/src/main/java/com/dwinovo/numen/`：

- `mixin/ChunkMapCompanionMixin.java:43`：假玩家 `skipPlayer=true`，取消原版完整玩家区块加载票；其余客户端区块追踪也取消。
- `task/CompanionTickDispatcher.java:95`：仅主人在线时调用 `CompanionChunkLoader.refresh`，但第 144 行的 `brain.tick` 仍运行。离线主人的身体区块停止实体更新后，调度与物理状态因此分离。
- `entity/CompanionChunkLoader.java:37`：替代票使用区域半径 2、原生超时 40 游戏 tick，每 20 tick 或跨区块时刷新。停止刷新后由原生距离管理器回收；不需要永久 `forceload`。
- `entity/NumenPlayer.java:282`：物理更新包含 `super.tick()` 和 `doTick()`，不能从“仍在玩家列表中”推断该方法持续执行。

故障证据与实际只读回执保留在被忽略的 `runtime/reports/numen-offline-owner-tick-20260908.json`。诊断没有传送、强制加载、修改实体、恢复身体、触发模型或重启服务。

## 修复边界与验收

补丁只为精确登记的自主桐人增加服务器 tick 续票入口，继续复用原生有界加载器；校验原身体 UUID、主人、名称及存活登记。普通同伴、女仆或仅同名实体不获得离线常驻资格。取消登记、身份不匹配、死亡、移除后不续票，旧票仍按原生超时回收。不会手工调用身体 tick，不建立额外进程，也不改变原生物理规则。

离线资格门测试、构建产物、物理恢复和模型导航分别记录。物理探针与生活报告分别证明同一身体更新及模型所选导航的到达；只看到在线状态、票申请或任务接受均不足以宣布导航成功。

## 构建与回归

`tools/build_numen_autonomous.py` 在原 `97ed8069…` JAR 上应用锁定补丁，产物 SHA-256 为 `47cc11d609b03b62734c4772b2aa40a89ba02a5bbaab0d85ab10589d45ffec3b`。`runtime/numen-autonomous-build/latest.json` 记录构建输入和测试。独立逐项 ZIP 比较确认 496 个原条目不变，仅替换原 core tick 接线类，增加 `AutonomousBodyTick` 及其身份 record；原生嵌套 API、死亡恢复和执行器保持原内容。

`world/numen-patches/tests/AutonomousTickPolicyTest.java` 针对编译后的真实资格门完成 34 项检查，覆盖配置禁用、身份漂移、登记不存在、死亡、移除和主人上线；未在该测试中创建世界或区块。配置 `config/numen-autonomous-bodies.json` 本轮只列原桐人，安装到服务端 `config/numen-autonomous-bodies.json`。模组启动时读取一次，tick 中只用内存快照；文件授权变化须重新启动服务后生效，原生登记/身体状态变化则逐 tick 校验。

只读命令 `numen_autonomy_status` 返回 `ServerLevel.isPositionEntityTicking` 的实际结果、身体 `tickCount`、服务器 tick 与已加载策略 hash。`execute if loaded` 只能作为初步区块证据，不代替这个实体更新状态。`python -X utf8 tools/numen_autonomy_health.py` 连续读取两次，验证当前构建/源码/精确身份、原生半径和超时、两次实体更新状态及身体 tick 增长；静止角色无需为健康检查强行走路。其 14 项离线回归明确拒绝在线但物理冻结、单次标记、旧样本、计数重置及身份/产物漂移；已纳入总健康的 `numen_autonomy` 项。导航能否到达目的地另行实机验证。
