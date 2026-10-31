# 让 Agent 通过核心实际使用 Harness²

`rc.148` 将已有 `Harness2PracticeService` 接入 `MinecraftAgentClient`。SDK 的 `tools()` 与 MCP 的工具目录包含 `mc_practice`；宿主提供模型、固定 worker 和隔离练习端后，Agent 直接使用 `help/start/status/result/compare/cancel`。结果进入同一核心事件流、请求事实和 `experiments()` 监测，不再依赖示例脚本私下启动 Runner。

没有配置时，`help/status` 明确返回 `available:false`，可在连接前读取；不会自动下载优化器、启动模型、连接第二个身体或拿正式服做重置。安装包的可用性和现役宿主是否已经配置分别验收。

## 宿主接线

```js
import {MinecraftAgentClient} from 'agent-mc-world/client';
import {createClientMethodPractice} from 'agent-mc-world/learning';

// Connect this explicitly configured dedicated client and wait for actual readiness first.
// It must have its own account, dataDir, realm and server, separate from sourceCfg.
const practice = createClientMethodPractice({
  directory: privateTrialDirectory,
  client: dedicatedPracticeClient,
  agent: ownedAgentId,
  fixtures: fixedTrainingAndHoldoutCases,
  control: dedicatedServerResetAndSettlePort,
  validate: validateDeclaredCandidateSurface,
});

const source = new MinecraftAgentClient({
  cfg: sourceCfg, dataDir: sourceDataDir, log,
  practice: {
    worker: explicitPinnedPythonWorker,
    model: existingHostBackgroundModelPort,
    practice: practice.executor,
    fixtures: practice.fixtures,
    capability: actualEnvironmentCapabilitiesAndLimits,
    budget: {modelCalls:6,trials:8,wallMs:300000,trialMs:30000,contextBytes:600000},
  },
});
```

`model` 复用宿主已有注册路由，提供 `{id,generate(request,signal)}`，按现有 `Harness2ModelReply` 返回完整制品和已知 usage，不添加隐藏重试或任务内模型请求。核心不选择供应商、读取凭据或导入 DSH/NEKO。记忆端口仍由宿主显式提供；没有端口不宣称经验已进入规范记忆。

`control.reset` 为可信宿主能力，候选拿不到它。它恢复已登记的固定快照，核对实际出生点/材料/工作台/背包，返回绑定的 `snapshotId/environmentVersion/settled:true`。`control.settle` 必须核对原 runId/执行 UUID、真实任务终态、队列及按键；发送 stop 或等待固定时长不算清理确认。脚本中的两个独立本地原版服演示了真实控制和回执验证，生产宿主须提供自己环境的对应能力。

练习客户端绑定实际观测的 realm、账户和连接 generation，重连或换世界使旧执行端作废。创建新的端口前先核对旧 pending；不能借重新实例化、改 ID 或换目录重投未知动作。多位 Agent 应使用各自专用端，或由可信宿主串行持有同一个独占控制租约；不能同时驱动一个练习身体。

## Agent 实际操作

1. `mc_practice {op:"help"}` 检查实际可用环境、预算和目标。未配置时先由宿主完成接线，不能假装训练已开始。
2. 通过 `mc_script library read` 读取待改善方法的精确版本。`start` 提交 job ID、methodId、revision、游戏任务、原参数和目标模式，立即得到 accepted；不用在一次工具调用里等待模型与身体全部结束。
3. 读取同一个 job 的 `status/result`，或消费 `minecraft.practice` 完成事件。事件只含状态和证据索引；完整源码按需展开。上下文只附最近3项任务，不新增模型循环。
4. `result.selected.params` 是候选制品的一部分。自然任务复用时应显式传到 `mc_script params`；仅保存代码不保存参数默认值。核对原父版本、适用场景、真实执行与净变化后，才使用既有 review/adopt；核心没有自动采用路径。
5. `cancel` 取消原任务并等待宿主清理。退出/断开源客户端会取消其活动实验；重连重新载入原请求索引，历史结果可读，未完成任务不自动续跑。

## 真实游戏执行端

`createClientMethodPractice` 通过连接中的 `mc_script` 进行语法校验、保存精确方法版本、执行和复盘；执行 UUID、方法库和游戏执行器全部复用。它不另写一套合成或导航算法。

前后观测是宿主固定的只读程序，从真实客户端读取生命、维度、坐标和完整已收到的背包。目标物品的已知零只在完整背包读数成功后建立；缺失/截断/断线不会变成零。摘要被截断时，读取原只读调用的详细结果。验收继续使用 `assessPracticeTrial` 与独立留出门槛。

候选的 SDK 调用数来自原执行回执。方法库默认只返回摘要，执行端按原 UUID/调用编号展开持久明细，保留动作请求、实际终态和拒绝原因。`actionSteps` 为请求的动作步数，`failedActions` 为未完成的 `mc.do` 动作组数；演示中每组恰好一步。真实 token/金额未知时保持未知，不能用 SDK 次数冒充模型费用。

每次重置前先写 pending 和原 dispatch requestId，取得后补上 runId/执行 UUID。清理或身份不明会保留 pending 并阻断全部新 trial ID。即使已经观测到目标，缺失原执行或清理证据也不会判成功。

## 可复现的双服务端验收

构建核心后，在独立目录运行随包附带的验证器：

```sh
node scripts/verify-practice-server.mjs \
  --java=/absolute/java21/bin/java \
  --serverJar=/absolute/official-server-1.21.1.jar \
  --python=/absolute/harness2-venv/bin/python \
  --directory=/absolute/NEW-private-evidence-directory \
  --acceptEula=true
```

调用者须接受 Minecraft EULA。验证器只接受全新目录及官方1.21.1服务端的固定 SHA1，创建两个仅绑定 `127.0.0.1` 的独立原版服，以两个普通离线测试账户运行；不读取生产配置。需要 Java 21、已显式安装固定 Harness² revision 的 Python 和本包依赖。不会自动安装模型或服务端。

任务使用已收到的两块原木及附近工作台，实际制作木板→木棍→木镐；当前不声称已经验证采木寻路、危险生存、模组服或真实 LLM 的自主发现。训练场景为橡木，独立留出为白桦和初始已有木镐的云杉；判定新增至少一把且生命不降。候选仅能改 wood/logs，代码/指导/验收固定，模型为明确标记的脚本化回调。

验收覆盖公开 MCP 的发现、help、start、result、cancel，真实服务端背包净增，原执行与动作明细，源方法未变和未采用，完成任务读取及源服务断开/重连后不重放。报告、原始方法库、逐 trial 文件和两个服务端 console.log 都保存在新目录。最后正常断开客户端并停服；失败目录和 pending 保留，不在同一目录自动重试。

## 2026-10-31 验证状态

源码运行和独立安装的 `agent-mc-world-0.5.7-rc.148.tgz` 分别通过上述双原版服验证：完整优化8次真实方法执行，另一次取消测试保留1次已完成基线、取消中的模型请求不重投。完成优化使用4次脚本化模型回调，取消测试再使用1次；真实供应商模型调用0。训练与两份留出中，原参数未新增木镐，候选均净增1、生命损失0；每份成功候选实际执行3步/4次SDK调用，失败次数来自展开的原调用回执。

公开 MCP 发现/启动/结果/取消、源服务重建不重放、源方法版本不变及未采用均通过。核心全量2690通过、8项viewer/login/appearance资源相关跳过；公开类型、构建、打包校验及安装包NodeNext消费通过。未测试真实 LLM 自主找到策略、完整生存、模组服或现役四位Agent。此安装包为 engine 构建；现役宿主升级时应保留其已验证的外部 viewer 资源，并注入实际模型和专用练习端。源码合入、npm发布和现役加载分开记录。
