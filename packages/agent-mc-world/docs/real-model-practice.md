# 真实宿主模型的一次性 Harness² 合成实验

本次交付是可运行的模型/宿主接入与验证程序，**没有取得本次真实 LLM + Minecraft 的实验结果**。当前执行环境没有模型路由或凭据、官方服务端 JAR和 Java 21；预检返回不可运行且模型调用/游戏连接均为0。没有更改在线四个 Agent，也没有采用候选。

## 已核对的接口和版本

核对主干 `4c408e5f3502fe661d84f28ce549327b17cbb6ae`：PR #22 已合并；核心当时为 `0.5.7-rc.152-preview.2`，`mc_practice` 已有 help/start/status/result/compare/stage/cancel。本文候选另用 `0.5.7-rc.152-practice.1` 标识，未发布 npm。

同一提交的 `paper/manifests/current-deployment.json` 仍记录公共 Skill 1.3.7、嵌入核心及 Harness 身体 rc.130；DSH 下载插件 rc.24。清单是部署记录，本次未连接现役宿主检查进程。旧安装不能因本次源码修改自动获得功能。

`jcs130/dsh-harness2` PR #1 仍开放，head `e5cfd904f1b300efe5141d07ca8a98abd8efb079`。只读 source 复用核心事实源，不承担模型调用或游戏执行。新宿主适配器基于该候选，用现有 `createDshModel(ctx.llm, route)` 转换核心模型请求，保持已注册的 provider/model、思考设置、输出预算和独立会话，不另建供应商客户端。

## 实验路径

`runConnectedCraftingExperiment` 从 `agent-mc-world/experiments/connected-crafting` 公开导出。它复用原双服务端验证器、`MinecraftAgentClient`、MCP、`createClientMethodPractice`、`mc_script`、原执行 UUID 和 MethodLibrary。

两台服务端只绑定127.0.0.1，专用账户为 H2Source/H2Practice，各有独立目录/realm/连接。每次重置核对完整库存、位置、维度与生命；候选无法取得服务端控制口。命令、代码、指导、场景、评价和预算不可改；模型只可提出 `params.json` 的 wood/logs。没有把预设正确参数传入真实模型模式，也没有从真实模式回退脚本模式。

固定方法从收到的原木依次合成木板→木棍→木镐。参考参数为 `{wood:"oak",logs:1}`，是实验新建的有限参考方法，**不是在线 Agent 当前能力的导出**。保留原方法精确 revision、参数、源码和未采用状态。训练为橡木，留出为白桦、初始已有一把木镐的云杉；都要求木镐净增至少1且生命不降。留出只在候选选定后执行，不进入模型输入。

训练反馈新增 `PracticeTrial.feedback`：来自原始 SDK trace 的请求步数、失败动作组及有界逐步拒绝原因，不读取方法自己声称的成功。该反馈随原始背包/生命和独立验收传给优化器。真实模式调用模型前核对上下文包含原训练失败 trial ID；没有失败证据时停止，不生成无反馈候选。

真实模型可能未找到更好的参数。程序保留失败/不改善结果，生成报告时不会断言候选必须成功；格式错误、截断、取消等都不重试原模型请求。总预算为6次模型调用、8次游戏执行、10分钟，每次方法30秒，600000上下文字节，k=1。非法提案也消耗已发出的模型预算。

## 在已有 DSH 宿主中运行

先在**独立实验 profile**安装本次核心及 `dsh-harness2` 候选安装包，并显式安装固定 Python worker。engine包没有viewer资源；它不替换现役宿主资源或运行目录。由已经拥有 `ctx.llm` 的宿主入口调用：

```js
import {runMinecraftCraftingPractice} from '@jcs130/dsh-harness2/experiments/minecraft';

const report = await runMinecraftCraftingPractice({
  ctx, sessionId: ownedPracticeSessionId,
  route: selectedRegisteredRoute, // {provider,model,reasoningEffort?,maxTokens}; 沿用现有选择
  java: '/explicit/java21/bin/java',
  serverJar: '/explicit/official-server-1.21.1.jar',
  python: '/explicit/harness2-venv/bin/python',
  directory: '/explicit/NEW-private-experiment',
  acceptEula: true, // 仅在调用者已经接受 Minecraft EULA 后设置
  signal: explicitCancellationSignal,
});
```

调用者提供真实注册路由和其拥有的独立会话。该入口不会寻找在线人物、修改原profile、改变模型设置或把整个宿主对话交给模型；模型输入只有本实验任务和游戏证据。没有模型路由时应停止，不把测试替身作为真实模型运行。

已有专用练习客户端时，无需再开第二套游戏执行器：用 `createClientMethodPractice` 提供 executor/fixtures，再用 `createMinecraftPracticeHost` 返回的 `practice` 接到新实例的 `MinecraftAgentClient`。示例见 DSH 候选 `docs/minecraft-model.md`。这是可替换宿主端口，核心不导入DSH。

## 无交互的一次性运行与预检

可信宿主可导出自己的模型模块：`createPracticeModel({signal})` 返回 `{model,provenance,close?}`。model 是现有 `{id,generate(request,signal)}`；provenance 为 `{kind:"registered-host-llm",provider,model,sessionId}`。模块复用宿主原注册路由，不应复制凭据或启动在线 Agent。CLI不会猜测模块、模型或服务端位置。

```sh
node scripts/run-model-practice.mjs --preflight \
  --java=/explicit/java21/bin/java \
  --serverJar=/explicit/official-server-1.21.1.jar \
  --python=/explicit/harness2-venv/bin/python \
  --modelModule=/explicit/existing-host-practice-port.mjs \
  --directory=/explicit/NEW-private-experiment
```

预检只检查显式本地输入、Java21、官方1.21.1固定SHA1和Python固定revision，不导入模型模块、调用模型或连接游戏。通过后去掉 `--preflight`，由已接受EULA的调用者加 `--acceptEula=true` 运行。SIGINT/SIGTERM沿原mc_practice任务取消，不换ID重投。原目录存在时拒绝覆盖；中断目录和pending保留，先核对原执行，不靠删目录重放。

旧命令 `scripts/verify-practice-server.mjs` 仍明确运行**脚本化回归验证**；不能用它的结果充当真实模型实验。

## 报告与成本

`report.json` 保留原方法版本、候选参数/完整核心结果、所有原trial/执行UUID、前后观测的独立验收、训练及留出分开的成功/失败/未知数、请求动作步数、失败动作组和SDK调用数。`pairedComparison`只比较选中候选与每个场景的原版；`measuredExecutions`包含优化器重复探测，不把重复探测当独立场景。

`model-calls.jsonl` 在调用前写入原request ID、阶段、请求哈希和已包含的训练失败引用；完成后记reply哈希、供应商流返回的已知token。它不落提示、回答、思考正文或凭据。失败调用也计入attemptedCalls，用量缺失保持null。DSH inputTokens不含缓存读写，适配器仅在各项都已知时汇总总输入；输出和缓存单独保留。

金额没有供应商账单回执，`costUsd:null`；host stream调用次数不是独立发票证明。动作/SDK次数与模型费用分别记录，不把合成效率当模型费用降低。实验失败时另写 `failure.json` 与已取得的模型回执，原游戏/优化账本保留。

只读Lab继续通过原 `createMinecraftExperimentSource` / `registerSource` 投影核心monitor。读取不启动实验或模型，不复制世界或方法库。候选即使eligible也始终adopted:false，本程序没有stage/adopt路径。

## 可重复验证和仍需实测

单元验证：核心新增失败反馈、审计、防重投、取消、预检和报告测试。固定 Google revision `1cfe254e8d25b15f37048c3730134686abe60335` 已实际安装并运行。DSH到核心的跨包验证使用真实Google流程、原核心沙箱/方法库、训练和两组留出；模型流及库存均为显式测试替身，**不是本次真实LLM/服务端证据**。

真实验收仍须在可用宿主执行上述入口，取得非测试模型路由的完成回执、token覆盖和原始游戏trial，然后按报告审查：模型输入包含训练失败、候选由模型返回、留出未泄漏、原方法未变、真实木镐净增及动作失败数据完整。不能预填成功率或费用。未验证危险生存、寻路采木、模组服、长期学习和在线四位Agent。

本次检查：核心2755通过、8项资源相关跳过，typecheck/engine构建/公开声明/pack通过；DSH28项全部通过（含实际Google流程和跨核心测试）。两候选包在全新消费者安装后，公开入口、NodeNext类型及packed构建校验通过，并完成8次库存夹具执行/4次合成模型流回调/两组留出和恢复不重投。该验证真实模型API调用为0，测试token也不作为供应商用量。
