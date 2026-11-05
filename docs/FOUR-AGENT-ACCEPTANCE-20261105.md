# 四 Agent 原生五人队伍：兼容性核查与验收工具

## 2026-11-05 Windows 复核补充

- 正式 RPG 桥的 `plugin.yml` 使用 CRLF；原诊断正则误判描述文件无效。同一回归先失败，规范化换行后 20 项 Python 检查通过，仍拒绝重复字段和不符的插件身份。
- Windows 普通权限不能创建文件符号链接。逃逸测试改用同样会被真实路径检查拒绝的目录联接，不跳过边界断言；8 项 Node 预检通过。
- 已对当前三 JAR 的只读副本完成真实 JDK21 夹具编译；未安装或启动夹具。正式桥 0.2.19 缺少 `PartyFormation`、`plan` 和新的身份字段，诊断正确返回 `needs_artifact_review`，不能据源码合并声称已部署。
- 当前部署清单另发现两条旧 AF.54/RPG.18 摘要仍列在现役栏，需从现役栏移除并保留历史，不能放宽工具的唯一基线校验。
- 真实四宿主模型消费与自主交流仍未验收；后文首次执行结果按当时环境阅读。

本轮核查始于 `main@02ad1c8ae9fcb38bafeb4ee513c45cb0546e6d60`；交付已同步 `main@8ae351734cd4e7741636fd25ee58f16e68fc070b`，保留后续语音代理及飞行修复，相关部署清单与组队源码未变化。PR #21 已合并，源码包含原生 `party plan`、`selfUuid/partyId/memberCount` 和独立自治社交收件箱。**本轮没有四个现役宿主或匹配现役摘要的插件副本，不能宣布四只已实际组队或自然聊天。**交付的是只读诊断、匹配基线的 QA 夹具构建入口和强化后的隔离验收；没有更新正式服、连接现役角色、改变任务/记忆/队伍或重启 Agent。

## 源码、构建与部署核对

| 层次 | 已核对的事实 | 不能由此推断 |
| --- | --- | --- |
| PR #21 | 合并提交 `a45a4a40bd3097749fc24822a04b0a1e274747bd`；当时 PR 说明尚未完成四客户端/实际模型验收 | 合并即上线 |
| 主干源码 | `NativeParties` 调用 `PartyFormation`；`NativePartyView` 返回 UUID 与原生队伍 ID；AF 目录有 `guild.party.plan` | 在线 JAR 等于整份主干源码 |
| 原生 Vortex | 五席能力本来就有；party4 增量主要在 RPG 桥、AF 目录和自治运行时 | `qd32-cooperation` 标签能判断是否包含新增规划入口 |
| 旧 party4 构建器 | 锁定 AF.39，输出 AF.40-party4 / RPG.15-party4 | 可以覆盖现役 AF.54 / RPG.18 |
| 后续构建 | `build-common-catalog.py` 的普通 RPG.15 基于旧合作桥，仅换 SkillTransition；`build-cli-recovery.py` 的 RPG.17 只换 VortexBridge；11月3日 RPG.18 只换 TwinCityGates 与 plugin.yml | 完整重编译过 NativeParties / NativePartyView / PartyFormation |
| AF 目录 | 后续 CLI 构建会更新 AgentCliCatalog，可能出现目录广告领先桥能力的组合 | 有帮助条目即命令实现已加载 |

这些后续记录不构成完整的现役字节溯源。`.16`、现役文件及加载中的类仍需实查；结论是**源码已整合，现役 party4 是否完整整合尚未确认**，不是断言现网没有原生组队。正常原生 `create/invite/accept/status` 与新增只读 `plan` 也须分开检查。

本轮读取的顶层 `current-deployment.json`（记录时间 2026-11-04 22:28 +08:00）：

| 组件 | 记录版本 | 记录 SHA-256 |
| --- | --- | --- |
| VortexRPG | 1.2.2-alpha，qd32 + compact-sidebar | `1fb78b4c3da03acbd50875aae2b7aea437d01337a4c251568ff64e19da197618` |
| QiandengjiRpg | 0.2.18 | `51877d0d0c19bf0693a8b0c70d48204970d74bbdde495c0b492ad75c49f06d98` |
| AgentFriend | 0.4.47.54-rpg | `5cf8e98db72dcb69c9f2c13ea4f905f19d9c8bd4332e732ee54bae6c06ab5fd5` |

工具从**传入的最新部署清单**读取摘要，不把本表或清单里的嵌套历史当作永远有效的基线。摘要不符就报告漂移，不替换、不降级、不自动修改清单。

## 四只宿主的适配边界

| 角色 / 历史账号 | 需要在实际进程核对的路径 | 本轮状态 |
| --- | --- | --- |
| 可米 / `ag_CorMy` | Cortico 衍生路径：原 MC 接收事件 → World/WakeBus → 当前模型轮 → 实际游戏聊天工具；旁白/TTS 不能充当游戏发送 | 入口、版本、UUID、模型和开关均未实时核实 |
| 库博 / `Coobot` | Cortico 路径：排查未点名伙伴是否仅 piggyback、队列工作期间能否消费聊天，保留原节奏与人格 | 同上；框架关联只是排查线索 |
| 肥鱼 / `DeepFish` | DSH 路径：实际加载插件与核心包、事件订阅、宿主恢复/唤醒、工具调用及真实收据串联 | 同上；不能拿公开插件版本冒充安装版本 |
| 悠怡 / `Yui` | N.E.K.O. 路径：MC 连接 → 插件/自治运行时 → 原宿主模型端口 → 决策返回 → 原身体工具 | 同上；不能认作旧 QwenPaw 原生女仆“结衣” |

账号映射来自既有记录，UUID 留空等待当次真实连接证据；不从名字计算离线 UUID。任何宿主关联都不作为已验证的安装事实。每只要保留原进程入口、安装包摘要、进程启动时间、原连接 ID、模型路由名称和唤醒配置的**私有只读导出**。不要导出 Key、完整启动命令、环境变量、人格或私人记忆。

如果实际采用 `agent-mc-autonomy`，复用现有命令：

```bash
python -m agent_mc_autonomy social-status --config /absolute/original-agent.toml --data /absolute/original-runtime
```

它只读原账本，不能代替宿主版本核查，也不能让未接入该运行时的宿主自动生效。该路径源码默认 `social.enabled=false`；核心源码默认唤醒集合包含 `chat-other`，但宿主仍可能覆盖。旧 `world/survival/socialAttentionMode=shadow` 与双人女仆接口不应当作这四个外部宿主的通用开关。

本轮没有替四个未知安装实现/启用适配器。下述中立证据格式是接入合同，需要宿主在**现有事件、模型请求和工具回执日志**上做只读投影，不能另起模型循环、代答固定台词或猜造缺失 ID。

## 只读插件诊断

Python 3.11+，仅标准库。从仓库根执行；不带 JAR 时返回 `needs_artifact_review`，退出码 2：

```bash
python paper/integrations/vortex-rpg/diagnostics/party4_diagnostics.py artifacts \
  --manifest paper/manifests/current-deployment.json
```

取得现役三份插件的**只读副本**后，用明确路径核对：

```bash
python paper/integrations/vortex-rpg/diagnostics/party4_diagnostics.py artifacts \
  --manifest paper/manifests/current-deployment.json \
  --native /private/copies/VortexRPG-current.jar \
  --bridge /private/copies/QiandengjiRpg-current.jar \
  --friend /private/copies/AgentFriend-current.jar
```

输出分开记录摘要是否符合当前清单、插件描述符、原生管理器 API、三类桥接实现及 AF 广告符号。只解析 ZIP / JVM 常量池，不加载类。`recorded_artifact_symbols_present` 只说明静态符号齐全，**不证明二进制链接、正确路由或实服行为**；`runtimeVerified`、`binaryCompatibilityVerified` 始终为 false。缺文件、缺类、缺符号、基线漂移各有输出。未知不是“功能不存在”。

若桥确实缺少能力，应以这些现役字节为基底另做窄补丁，保持原生 Vortex、TwinCityGates、相册、NPC/存储/安全修复和其他条目。原 `build-four-player-party.py` 的冻结锁不放宽；本轮未提供未经当前实物验证的新业务 JAR。

## 隔离四客户端工具

`four-party-stage.mjs` 已移除 E 盘固定导入，改用仓库既有 RCON 与客户端兼容模块。必须显式选择 `--preflight` 或 `--run-isolated`，旧的隐式执行参数被拒绝。它不启动服务器，只连接预先准备好的独立 `127.0.0.1:29397` / RCON `29398`，只创建随机 `ag_CP…` QA 身体，绝不使用四个原账号。

准备条件：

1. 独立游戏目录、测试账号和数据，匹配现役的 Youer/Paper API 1.21.1 组合，已有另一个 NORMAL 世界供同维度类型、不同世界的路由检查；**不能把普通 Vanilla 服务器或只有语音探针的测试服当作匹配环境**。
2. 明确的 `server-ip=127.0.0.1`、`server-port=29397`、`rcon.port=29398`、`enable-rcon=true`、`online-mode=false`；标记文件 `.communication-qa` 内容仍为 `127.0.0.1:29397 20261030`，这是既有夹具协议标记，不是验收日期。拒绝重复属性、路径穿越、符号链接、已有结果文件。
3. 三份当前基底副本以及另审过的 party4 候选组合；原生 Vortex 必须与当前清单摘要一致。新 QA 夹具只用于隔离服。
4. 显式准备带 Mineflayer 的独立 Node 消费者目录。使用当前锁定版本，不能把 npm 最新版当作四个实际宿主版本。

构建新版 QA 夹具的入口只读取精确当前副本；需要完整 JDK21 和匹配 server libraries，输出目录必须全新且在源服务器目录之外：

```bash
python paper/integrations/vortex-rpg/diagnostics/build_party4_fixture.py \
  --manifest paper/manifests/current-deployment.json --server-copy /private/current-copy \
  --native /private/copies/VortexRPG-current.jar \
  --bridge /private/copies/QiandengjiRpg-current.jar \
  --friend /private/copies/AgentFriend-current.jar \
  --jdk /absolute/jdk21 --output /private/fresh-party4-fixture
```

此入口只生成 `CooperationFixture-0.0.2-party4-qa.jar`，不生成/安装业务插件。旧基底或缺少 libraries 在创建输出之前拒绝。未取得当前三份 JAR，因此本轮没有执行这一步的真实插件编译。

隔离目录还需 `.party4-artifacts.json`。由准备者按**实际文件与已审核的构建记录**填写，不提供伪造成功的默认锁：

```json
{
  "schema": "party4-stage-lock/v1",
  "deploymentSha256": "SHA256_OF_THE_EXACT_CURRENT_DEPLOYMENT_JSON",
  "artifacts": {
    "native": {"file": "plugins/VortexRPG-current.jar", "sha256": "ACTUAL_HASH", "baselineSha256": "CURRENT_HASH"},
    "bridge": {"file": "plugins/QiandengjiRpg-candidate.jar", "sha256": "ACTUAL_HASH", "baselineSha256": "CURRENT_HASH", "buildReport": "reviewed-bridge-build.json", "buildReportSha256": "REPORT_HASH"},
    "friend": {"file": "plugins/AgentFriend-current.jar", "sha256": "ACTUAL_HASH", "baselineSha256": "CURRENT_HASH"},
    "fixture": {"file": "plugins/CooperationFixture-0.0.2-party4-qa.jar", "sha256": "ACTUAL_HASH"}
  }
}
```

替换示意文件名和占位符；候选与基底不同就必须保留构建报告与摘要。锁校验只证明选择一致，**不替代人工审查构建报告的变更范围**。不要因为工具要求摘要就重填旧包的基线，或给旧 AF.40-party4 改名冒充当前版本。

```bash
node paper/integrations/vortex-rpg/tests/four-party-stage.mjs --preflight \
  /private/party4-stage /private/new-result.json \
  /absolute/repo/paper/manifests/current-deployment.json /private/node-consumer

node paper/integrations/vortex-rpg/tests/four-party-stage.mjs --run-isolated \
  /private/party4-stage /private/new-result.json \
  /absolute/repo/paper/manifests/current-deployment.json /private/node-consumer
```

`--preflight` 不加载 Mineflayer、不连 RCON、不创建结果文件。运行模式首先只读 `coopqa identify`：核对正在运行的夹具根路径、启动时的插件输入摘要、加载来源及两个实际世界。Paper 重映射后 JAR 的摘要另列，不能冒充与源 JAR 字节一致。然后才能登录新 QA 身体。

脚本验证：一次创建、三次邀请、三位接收者本人接受；四端准确的 self UUID、成员 UUID 集合和同一 partyId；四人占位而第五席空闲；12 个有向附近收件关系；48 格内边界、48.25 格外、同维度类型不同世界；跨世界仍同队；离线成员保留。成功、失败均保留新 QA 队伍证据，不自动 disband/leave/kick。距离外“未收件”仅为有限观察窗，不能当作无限期不投递的数学证明。

发送的是带随机标记的**传输探针**，结果固定标记 `evidenceKind=controlled-game-clients`、`modelCalled=false`、`actualHostAcceptance=false`。这个测试即使通过，也不等于四个实际角色自然聊天。

## 实际宿主证据验收

模板：[four-agents.example.json](../paper/integrations/vortex-rpg/diagnostics/four-agents.example.json)。复制到私有目录后填入真实观察窗口、原连接 UUID 与原日志文件路径；默认 UUID 为 null，运行只返回缺口，不会创建替代身份。路径相对 spec 文件解析，也支持绝对路径。

```bash
python paper/integrations/vortex-rpg/diagnostics/party4_diagnostics.py audit \
  --spec /private/four-agents/spec.json
```

每个 host.json 是原宿主只读采集导出，格式 `party4-host-capture/v1`，包含：

| 字段 | 原始来源 |
| --- | --- |
| `account/uuid/runId/serverId/connectionId/capturedAt` | 同一次实际 MC 连接与采集窗口，时间带时区 |
| `family/version/coreVersion/modelRoute` | 实际加载入口、安装元数据、原模型路由名称；不导出 Key |
| `process.pid/startedAt` | 现有进程观测；此工具不控制进程 |
| `wakePolicy` | 原宿主真实配置的中立投影，如 categories、paused、socialEnabled、batchSeconds、cooldownSeconds、maxPeerTurns；不改配置 |
| `installationSha256.entrypoint/hostPackage/corePackage` | spec 指向的原安装文件摘要；元数据支持 package.json 与 pyproject.toml |

每只 events.jsonl 是原始日志的中立投影，每行共同字段为 `id/kind/at/account/uuid/runId/serverId/connectionId`。原始日志须私有保留，可复核投影，禁止手工补造关联关系。按各宿主现有字段适配下表；没有原 ID 就报告未验证，不能靠同文或近时间补成 ACK：

| kind | 必要证据字段 |
| --- | --- |
| `party.status` | `value`：本人真实 `/mycli guild party status --json` 结果；四端最后状态需在30秒内同一 partyId、四个准确 UUID，后来的退队/冲突不能被早先成功遮住 |
| `chat.received` | `event`：原核心 `minecraft.chat/chat`，保留 run/cursor/ts 与 meta.senderUuid、identityEvidence；只有 packet-sender / player-list-format 身份级别可计数，不使用旁观者镜头或官网气泡 |
| `model.input` | `turnId/receivedEventIds`：仅列实际进入模型请求的本地收件事件 ID；被 token 预算排除的内容不算 |
| `model.result` | `inputId/turnId/status/modelInvocation/providerRequestId（或本地宿主原 modelTraceId）/chatToolCalls`；真实调用标 real，completed 才记消费，聊天调用保留原 call id；unknown、假模型、纯旁白不算回应 |
| `chat.sent` | `turnId/toolCallId/chatDelivery`；使用原 agent-mc/chat-delivery/v1 收据，保留 channel/text/sentAt；仅计公开交流或发给队内伙伴的私聊，组队命令及空收据不计回应。只确认 client-transport sent，不推定对方听见 |
| `task.receipt` | `taskId/status/receipt`：真实生存任务终态及原回执，不用聊天承诺代替 |
| `activity.completed` | `taskId/status/nativeReceiptRef/activity`：关联本地真实 task.receipt；activity 为 gather/craft/farm/explore/build/follow 之一；其他活动需另按原回执人工检查 |

审核输出包括每只从谁收件、哪些来信实际被模型消费、哪些回合有可追溯游戏发送、哪些生存任务有终态和全部输入文件 SHA256，不复制聊天正文、人格或记忆。完整目标为 12 个收件方向、12 个模型消费方向、每只至少一次有来信上下文的真实模型发言及正常生存任务。任务/发言相关性、是否自然回应具体内容仍需阅读私有原轨迹：同轮有消息与发言并不足以自动判定语义质量。

通过最多给出 `evidence_complete_pending_human_review`；`runtimeVerified/evidenceAuthenticityVerified/naturalConversationQualityVerified` 始终为 false，明确它是离线审查给定导出，不是远程进程认证或语义裁判。`fixture`、未知来源环境、缺失收件、伪模型、断开的 ID、过期窗口、UUID/安装版本冲突不会得到完整状态。`production-passive-export` 只允许审阅已经产生的原日志，不代表授权对现网发测试消息。

退出码：0 为对应层次证据齐备待复核，2 为缺口/漂移，1 为输入无法解析。任一代码都不触发重连、模型、修复、队伍变更或部署。

## 本轮实际执行结果

- 原生上游 `ExpeditionPartyManager` Git blob `f91bf3807b4bc24dd4d5a4703a695f963bd81f61`，SHA256 与既有固定锁相同；规则 162、原生四人 76、原生五人 106，共 **344 条 Java 离线断言通过**。
- 冻结构建器拒绝检查 **2 项通过**。
- 新诊断测试 **19 项通过**，包括未提供插件、旧摘要、模拟证据、UUID/模型未知结果、发言关联、最后状态冲突、原游标重复、只读不改文件、旧基底构建拒绝。
- Node 预检与名册检查 **8 项通过**；隔离脚本语法通过。
- 既有自治 `test_party_context/test_social/test_social_evidence` **52 项通过**，其夹具禁止网络/模型/进程，不属于真实对话。
- QA Java 夹具对 Paper 1.21.1 API 加 Vortex **编译签名 stub** 做过语法编译，仅验证 API/语法；不是匹配现役三 JAR 的完整编译或联机证明。此环境只有 Java21 runtime，无完整 javac/ct.sym，首次 `--release 21` 尝试失败；改用同版本编译模块 `-source 21 -target 21` 完成语法核验，正式构建入口仍要求完整 JDK21。
- 实际运行缺输入诊断：插件 `needs_artifact_review`；四宿主 `incomplete`、收件/模型消费均 **0 个已提供的证据关系**，不是认定四只从未聊天。
- 新增检查已接入现有 CI；Ruff 与公共源码检查通过。没有更改正式部署清单或下载/运行包。

尚未执行：匹配当前三 JAR 的完整编译、隔离真实四客户端联机、四个实际宿主导出适配、真实模型自主交流、长期生存与防回声表现。下一步的必要输入是**当前三 JAR 及 libraries 的只读副本、隔离服、四个实际宿主的只读安装/事件/模型/工具记录**。取得输入后沿上述入口继续，不重放旧维护或恢复旧角色数据。
