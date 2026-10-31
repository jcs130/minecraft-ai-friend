# 最小合成实验：真实核心执行，确定性库存 fixture

本实验将 Harness² 从账本推进到 Minecraft 方法的采集与多步合成链路。它实际执行核心脚本沙箱、动作回执、MethodLibrary、独立背包净增验收和 Google 原版优化流程。**库存转移由确定性 fixture 模拟；没有运行 Minecraft 服务端或真实 LLM，不是自主生存能力提升的证据。**

## 已核对并复用的接口

| 责任 | 现有公开接口 | 本次接法 |
| --- | --- | --- |
| 任务执行与身份 | `PracticeExecutionPort.execute({trialId,methodId,candidate,fixture,durationMs},signal)` | `createCraftingMethodPractice().executor`；候选哈希沿用核心 `procedureHash(candidate)` |
| 沙箱与原始执行 | `MethodPracticeExecutor`、`MethodRunner` | 仍走原执行 UUID、32 SDK 调用和16动作上限；本任务额外限制4次动作 |
| 版本、执行证据、复盘 | `MethodLibrary.save/recordExecution/review/evidence` | 独立练习目录；不创建第二套方法库，不调用 select/adopt/stage |
| 目标验收 | `assessPracticeTrial`、`gatePracticeCandidate` | 生命损失上限0，`wooden_pickaxe` 净增至少1；未知观测不算成功 |
| 候选优化、预算与恢复 | `Harness2Runner` | 复用现有 Google worker、调用账本、训练/留出比较和防重放 |
| 实验读取 | `createHarness2Monitor`，`agent-mc.experiments/v1` | 给 DSH `registerSource` 提供白名单元数据；不再启动另一套优化器 |
| 可选游戏经验 | `createPracticeGameMemory` | 本演示未连接；不向在线记忆写入合成 fixture 的经验 |

DSH 通用适配器以文件集合的 `artifactHash` 绑定回执，核心以 `PracticeCandidate` 的 `procedureHash` 绑定回执。两者不能直接混用。因此 Minecraft 保持自己的 Runner 与事实来源，Lab 只注册只读 source。通用插件内没有复制游戏身体或配方实现。

## 任务与可编辑面

出生在已可使用的工作台旁，从可见原木获得一把**新增**木镐：读取资源→采木→木板→木棍→木镐。配方来自已锁定的 `minecraft-data@3.112.0` 的 Java 1.21.1 数据；环境版本附配方 SHA256 前16位。

仅 `skills/minecraft-method/scripts/params.json` 可修改：`wood` 为 `oak/birch/spruce/observed`，`logs` 为1至4的整数。`observed` 从本次状态读取可用木材，不读取 fixture ID。固定驱动根据参数发出已有 `collect/craft` 形态的单步 `mc.do`；遇拒绝即停。

驱动源码、指导文字、配方、执行器、动作上限、模型路由、重置、场景、生命和背包验收标准均不可修改。`guardCraftingPractice` 在最终执行入口再次检查，模型遵循提示不是权限边界。候选不能增加 shell、网络、插件、模型请求或新 Agent。

基线 `{wood:"oak",logs:1}` 是**为实验新建的有限参考策略**，没有从在线 Agent 导出，不能据其失败宣称当前线上 Agent 不会合成。脚本化模型给出 `{wood:"observed",logs:2}`，用来验证完整优化流程；没有证明 LLM 自己发现了策略。策略改变的是参数，不是持续增加提示词。

## 固定训练与留出

| 场景 | 可见资源 | 初始木镐 | 验收 |
| --- | --- | --- | --- |
| train-oak | 橡木4 | 0 | 新增1木镐，生命不降 |
| holdout-birch | 白桦3 | 0 | 同上；测试材料种类变化 |
| holdout-spruce-existing | 云杉2 | 1 | 同上；已有成品不能冒充新产出 |

三份场景 ID、snapshot 和内容不同。每次原版/候选试跑从完整库存和原木数重置。留出数据只在优化选定候选后执行；模型请求不含留出 ID 或快照。脚本化模型本身也是测试替身，不能据“未见 ID”宣称统计意义上的泛化。

显式配置在 `examples/harness2-crafting.json`，默认 `enabled:false`。预算：6次优化模型回调、8次执行、120秒总时间、每方法5秒、600000上下文字节；任务执行不调用模型。真实模型用量不全时 token 和金额保留 `null`。SDK 调用数和动作步骤是执行工作量，不是模型账单。

## 无正式服务器的复现

先按主文档安装固定 revision 的 Python worker，再构建核心或使用本分支打包产物：

```sh
pnpm install --ignore-scripts --frozen-lockfile
pnpm run build:engine
node examples/harness2-crafting.mjs --scripted /absolute/worker.json /absolute/NEW-evidence-directory unique-job-id
```

worker JSON：`command` 指向已安装 Harness² 的 Python 3.12+，`script` 指向本包 `bridges/harness2/worker.py`，`workspace` 为独立临时工作目录。该命令显式运行一次脚本化实验，不启动后台任务或游戏连接。

输出包括 `report.json`、`monitor.json`、`jobs/<id>/journal.json`、`game-context.json`、原方法库以及 `practice/trials/<trialId>.json`。后者保存原始前后背包、原执行 UUID、候选哈希、动作序列、每步拒绝原因、步骤数及失败次数。`report.json` 保留全部8次试跑，包括重复参考探测；不要将重复探测算作不同测试场景。

同配置完成任务只读恢复；不再调用优化器或执行端。更改配置应另用任务 ID。执行前先保存 pending 身份，未决 `active.json` 会阻断包括新 ID 在内的全部 fixture 调用。中断后保留原文件，人工核对原执行和清理，不能靠删除账本重试。

默认测试无需 Python或服务器：`pnpm exec vitest run tests/crafting-practice.test.ts`。设置 `HARNESS2_TEST_WORKER` 为 worker JSON 字符串后，`tests/crafting-upstream.test.ts` 执行原 Google 优化器并验证8次执行、留出隔离、原回执和无副作用恢复。未配置时显式跳过，不伪称运行过上游。

## 后续真实环境验收

1. 使用单独 Java 1.21.1 练习服、白名单测试账号和专用 realm/instance。与源 Agent 的 instance 和 realm 都不同。固定服务端版本、插件/数据包、真实配方、世界快照、出生点、时刻、游戏规则、背包、工作台及可采资源；记录每项摘要。正式服不承担重置或实验。
2. 复用核心现有连接、采集和合成能力建立 `MethodPracticeExecutor` 的 `host/reset/observe/settle` 端口。`state.resources` 是本实验的正规化观察，须由真实已加载且可采原木推导；它并非现有线上 `mc.state()` 已保证的字段。`do` 复用原核心动作和原 taskId 回执，明确将实际终态映射到本实验的 done/blocked；不能把受理当完成。不要直接把库存 fixture 接上网络就当作真实适配器。
3. 重置取得服务端控制租约并恢复精确快照；前后观察从服务端/Mineflayer独立读取完整已知物品计数和生命，包括目标物品已知零。观察绑定同一实例、snapshot、版本和新鲜时间。执行 UUID、采集/合成任务身份、拒绝与断线原文保留在私有证据；不从方法返回值判断成功。
4. `settle` 必须等待原采集/合成/寻路任务终结、停止原动作并释放按键，核对库存和世界保存完成，再允许下一次重置。失联或未知效果立即阻断，取消不自动重投。`isolated:true` 是宿主声明，不是隔离或复位已被证明。
5. 从现有 MethodLibrary 导出待比较方法的精确引用、源码、参数和指导文字，记为真实基线。若其动作契约不同，先审查并版本化新的实验驱动；不能无说明地套用本演示基线。冻结候选可改字段及验收器摘要后，才进行 DSH 已注册模型的优化；无隐式重试或额外任务模型。
6. 训练后冻结候选。在先前未使用的真实留出快照上进行至少5组配对原版/候选运行，记录实际顺序并交替先后。每一对从同一初始快照恢复，变更木种、初始库存和资源布局；曾用于调参的场景移入训练，另建留出。汇总逐对成功/失败/未知、净增、生命损失、动作数、SDK 调用、耗时、模型调用及已知 token/金额。失败运行和取消同样保留；无观测不记为成功。
7. 只有独立观测达标、全部留出成功、原有成功项无退化且至少一项实测改善，才记为**这些场景内**通过门槛。真实自主生存还需导航、危险、饥饿等另行任务；五次小样本仍不能证明普遍提升。此阶段始终 `adopted:false`，不运行 stage/adopt、不覆盖在线方法；后续采用须独立审查候选差异、真实证据与回滚引用。

可通过导出的 `createCraftingExperiment` 注入宿主模型端口，保持核心现有 Runner。真实模型的回调预算、完整 usage 和取消应沿 DSH 已注册路由传递；不要新建供应商密钥或把私人对话放进实验。当前演示报告仅用于脚本化模型，不是付费模型实测报告。

## 本轮验证（2026-10-31，源码候选）

固定 Google revision `1cfe254e8d25b15f37048c3730134686abe60335` 实际完成4次脚本化提案/组合/反思回调及8次方法执行；训练原版失败、候选成功，两份留出均为原版失败、候选成功。全部试跑共26次动作尝试、3次被拒动作、34次 SDK 调用。每份候选成功运行4步、5次 SDK 调用，没有观察到成本降低的证据。真实模型 API 调用0；token 和金额未知。重复读取完成任务新增模型回调0，未重置或重放方法。

`TZ=Asia/Shanghai` 下全量核心测试2688通过、8跳过（viewer/login/appearance资源相关），包括本次3项执行边界测试、1项真实上游合成集成及既有真实上游物理集成。未设时区的首次全量运行有1项原有时钟测试失败；宿主为 Asia/Seoul，设定时区后该项和全量复跑通过，没有改动该功能。`typecheck`、engine build、公开声明与打包校验通过。隔离安装的包再次执行完整合成实验，并通过公开类型消费及 DSH source 只读投影检查。无服务端、真人 Desktop 窗口、真实 LLM 或在线 Agent 验收。
