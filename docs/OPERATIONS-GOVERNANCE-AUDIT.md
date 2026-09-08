# D 项目运维治理审计

2026-09-07。范围为 D:\Projects\QiandengJi 的现有源码、Compose、初始化脚本、脱敏配置字段和管理页。本文没有启动或停止服务，没有执行 Docker、RCON、模型请求或完整健康巡检，没有修改代码与运行配置。根协调者仍在完成本轮部署验收；本文不代替最新 `reports/` 的运行证据。

用户的新定位是：QwenPaw Agent 团队承担游戏世界运营工作。可复用现有 QwenPaw、ModelProvider、玩家命令应用服务、Numen/MCP 和 19091 页面；首先补齐服务治理与受控操作，不需要另造 Agent 大脑。

## 结论

D 已经拥有独立的 9 服务 Compose、统一启停 CLI、多个实际行为探针、只读管理页和角色会话适配器。缺口集中在服务清单之外的依赖、功能级可用性、常驻巡检、配置变更记录，以及运营组的实际职责和权限。

最小可实施范围是：建立服务与配置登记表，扩展现有 `tools/project.py` 为固定服务 ID 的操作入口，添加受监督的轻量状态采集，将功能与依赖状态投影到现有管理页，再让运营角色通过同一受控入口工作。先登记共享 TTS；不要因为“一键启动”而接管旧 C 盘的全部服务。

## 已有能力与职责边界

| 当前组件 | 已实现 | 治理不足 |
|---|---|---|
| `compose.yml` | 固定 qiandengji 项目；9 个服务；本机端口；全部 `restart: unless-stopped`；8 个服务有健康检查 | 只描述 Compose 内部依赖；无宿主共享服务清单；不自动恢复单纯 unhealthy 的进程 |
| `tools/project.py` | setup/start/stop/status/logs/rcon；校验存在原存档；固定项目目录和 Compose 文件 | 默认服务列表再次手写；参数适合可信人工 CLI，不宜直接开放给模型；没有重启计划、影响范围、操作回执、配置版本或维护互斥 |
| `start-server.bat` / `stop-server.bat` | 已统一调用 project.py | 统一的只是 D Compose，未覆盖 8100 推理依赖；未包含依赖治理和健康等待闭环 |
| `world/bootstrap-world.mts` | 模块依赖注入；生命周期清理；world 内发布公开快照 | 多个后台循环仍共处 world；全局异常被记录并抑制，进程存活不等于所有循环成功 |
| `world/ops/health/health_mon.py` | Docker 状态、文件与制品身份、真实协议、已记录行为、当前 player/voice 能力和名单恢复门禁 | 混合了“当前就绪”和“历史验收”；不是常驻调度器；未覆盖 TTS 当前可用性和向量服务降级 |
| `check-health.bat` | 人工运行完整巡检并写报告 | 仓内未发现 D 项目周期运行此巡检的任务注册脚本或 Compose 服务；未调查宿主任务计划，不能据此断言宿主绝无额外调度 |
| `world/admin/*` | 19091 独立只读 HTTP，15 秒世界快照；过期标记；角色后端入口 | 无服务启停、日志、依赖图、配置差异、运营任务与回执页；健康公开摘要目前只有容器检测 |
| QwenPaw 初始化与健康脚本 | 独立凭据、console 认证；两个角色；工具禁用校验 | 当前是文本神谕模式；健康脚本写死两个启用角色、零工具，不是可配置运营组策略 |

`ModelProvider` 的 chat/task 保留角色和会话隔离，提供替换后端的边界；它不执行 Minecraft 或 Docker 操作。扩展运营能力应另接受控应用端口，不把任意 shell 放进会话适配器。

## 当前服务清单与依赖

以下为配置事实，不表示本次检查了实际在线状态。

| ID | 用户入口 / 数据 | 启动依赖 | 功能依赖与运行边界 |
|---|---|---|---|
| mc | 游戏 127.0.0.1:25567；RCON 25577；SVC UDP 24455 | Docker、Java21 镜像、D 存档与模组 | 世界与游戏协议权威；保存数据在 `server/mc`，世界名 shadow 是目录名称，不代表连接旧 shadow 服务 |
| world | world-data / mcdata / godvoice 队列 | mc healthy | 命令、施法、女神监听、进度和公开快照；普通命令不依赖 QwenPaw 健康启动 |
| gate | 127.0.0.1:25701 | mc healthy | Vanilla 协议 Agent 连接入口；当前只检查进程状态，Compose 无独立健康探针 |
| npc | mcdata、world-data、MC 日志 | mc healthy；world started | 书、NPC、工会轮询；有 RCON 成功和线程/轮询时效检查；模型、自动造任务等目前关闭 |
| resources | 127.0.0.1:19090/packs/ | 无业务前置 | D 本地女仆配音资源；不应因世界停服而一起强制失效 |
| qwenpaw | 127.0.0.1:18089 | 已初始化 D 私有状态、镜像 | 实际选定云模型与联网；故障影响神谕与对话，不应阻断确定性玩家命令 |
| voice | D godvoice 文本队列→音频队列 | 队列挂载 | 外部本机 8100 TTS；听到声音还需 mc/godvoice/SVC 客户端；推理失败和播放失败须分开 |
| asr | D godvoice mic/inbox→outbox | D 本地 ASR 模型目录 | Paraformer 本地推理；后续施法需 world + mc；当前心跳在模型加载之后写入 |
| panel | 127.0.0.1:19091 | 公开快照目录 | 页面可独立运行；世界、NPC、服务检测分别过期；不持有 Docker socket 或 RCON/Agent 密钥 |

### 宿主与旧环境依赖逐项判定

| 项目 | D 当前事实 | 应如何登记与处理 |
|---|---|---|
| 本地 TTS 8100 | `compose.yml` 的 voice 明确指向 `http://host.docker.internal:8100`。女仆模型配置准备脚本和语音 smoke 也引用同端点。D 未定义 TTS 推理容器 | 登记 `tts-local` 为共享外部依赖，起初只读检查；记录真实所有者及启动入口后，才决定独立迁移或继续共享 |
| 8100 的进程所有者 | D 文档明确复用既有本机推理；继承注释称 shadow-tts / IndexTTS。此次未检查端口与容器身份，不能声称实际监听者已核实 | 所有者暂标 `unverified`；下一次只读盘点以端口所有者、容器 label、挂载和启动命令确认，不能靠进程名猜归属 |
| TTS 切换能力 | `world/sidecar/voice_paths.py::local_tts_url` 只接受本地三种主机名且端口必须 8100 | 将来迁入 D 的服务名或新端口时，需要同时修改受控端点配置、验证器、女仆配置和 smoke；只改 Compose URL 会启动失败 |
| world 众生册 Qdrant / embedding | Compose 设置 `MC_MEMORY_ENABLED=0`。bootstrap 默认地址为容器自己的 127.0.0.1:6333 / 11434，但世界记忆索引当前关闭 | 记为 disabled；不纳入基础玩法启动闭包，不为了让清单变绿而自动启动旧 MemOS/Qdrant |
| 技能向量匹配 | `mc-magic.ts` 独立使用 `OLLAMA_EMBED_URL`，默认 `http://127.0.0.1:11434/api/embeddings`；不受 `MC_MEMORY_ENABLED=0` 控制。Compose 未提供这个变量 | 这是未治理的可选能力。容器 loopback 不是宿主；请求失败会返回 null，健康不显示降级。应显式设置 enabled/disabled 和端点，禁用时停止预热，启用时增加状态 |
| MemOS | D Compose 没有 MemOS 服务或 external MemOS 网络；D 选定角色也关闭记忆功能，所读活跃装配没有直接接入 MemOS | 登记为未接入/未来可选；旧 C 历史 Compose 的 memos_memos 网络不能当作 D 的依赖事实 |
| QwenPaw 宿主模型 | D 两个启用角色的实际 active_model 均为 zhipu-cn-codingplan / glm-5.3；所选 provider 端点分类均为 external，非宿主 loopback | 当前选定模型不依赖宿主本地模型。初始化保留了“将旧 loopback 改为 host.docker.internal”的机制；未来切换模型应重新计算依赖 |
| QwenPaw Host MCP | D 总配置及四个 workspace 的 mcp.clients 均为空；内置工具、coding、记忆和 heartbeat 禁用；仅 mc-god / mc-herald 启用 | Host MCP 不在当前 D 能力闭包。没有证据表明 D 在调用宿主 MCP；不能展示“已接入运营工具” |
| Numen MCP / 技能 CLI | `tools/run_numen_mcp.py` 为独立 stdio 入口，覆盖 D 端口/路径；`tools/skill_cli.py` 使用 D 队列与回执 | 可直接复用，属于按需外部进程，不是当前 QwenPaw 已启用的 MCP。运营角色需要绑定准确身份和权限，不统一授予完整身体控制 |
| Docker 镜像 | D 复用 mc-world、mc-sidecar、mc-voice、qwenpaw-mc 等本机已有镜像，`pull_policy: never` | 镜像存在是部署先决条件；登记 digest、来源、恢复方式。仅保留 tag 不等于可在另一台电脑重建全部服务 |

本次读取私有 Agent 配置时只输出角色、开关、工具/MCP ID 和 provider 端点分类，没有输出或写入 token、API key、聊天历史。

## 会遗漏或误解的健康状态

1. **TTS 不可用时 voice 仍可能正常。** watcher 每轮写 `state=polling`，合成任务失败后移为 `.err`；`tools/voice_health.py` 只看 updated_at，既不检查 8100，也不计失败率、最老任务年龄。历史 `voice-inference` / voice smoke 成功不能证明当前 TTS 存活。
2. **页面服务绿不代表功能验收绿。** 完整 health 有自有杖、语音、恢复和制品检查，但公开 `health.json` 的 ok 取 `report['services']['ok']`，services 也仅是容器检测。页面没有公开 capability 状态，运营者看不到“容器正常但录音名单/当前制品/语音行为门禁不满足”。
3. **world 的 Docker 健康只检查心跳文件 mtime。** 完整 probe 会进一步校验 player/voice 能力，仍没有覆盖每个后台循环的最近成功、失败和积压。不能把一个进程里的所有子功能都画成同一个绿色点。
4. **QwenPaw 健康确认认证和工具策略，不触发推理。** 云模型限流、断流或服务不可用时，console 可能仍 healthy。需要单独标注最近推理成功/失败与耗时；低成本定期模型 smoke 应单列成本与频率，不放到高频 HTTP 探针里。
5. **禁用和未检查不是失败或正常。** 关闭的世界记忆应该是 disabled；未核验所有者的 Host TTS 应是 unknown；向量兜底失败应是 degraded，不能默认为完整可用。
6. **完整巡检和持续监控不是同一件事。** health_mon 当前为一次性执行，仓内默认启动列表没有巡检进程。`unless-stopped` 覆盖退出重启，不覆盖只变 unhealthy 的容器；不应承诺已有自动修复闭环。

## 最小治理设计

### 一张登记表，保留现有真实配置来源

新增版本化 `config/operations-services.json` 作为治理索引。第一版不要复制 Compose 的完整 environment、端口或命令，避免第三份配置漂移；通过 `composeService` 引用既有定义并做一致性检查。`config/server-runtime.json` 和现有 lock 继续各自提供端口/发行与制品约束。

登记字段建议：

- serviceId、ownerProject、kind（compose / external / on-demand / artifact）、desiredState、purpose、composeService 或既有 launcherRef。
- startupDependencies、capabilityDependencies、optionalDependencies；分别描述启动顺序与功能可用性。
- configRefs、secretRefs（只保存引用）、dataRefs、artifactRefs、reloadMode（无需重载 / 进程重启 / 容器重建）。
- readinessProbe、capabilityProbe、logSource、logRedaction、supervisor、supportedActions、protectedPaths。
- 最后应用的配置摘要与制品身份；当前观察值另写运行态，不把观察结果回写成期望配置。

一致性检查至少拒绝：Compose 服务未登记、服务 ID 重复、依赖不存在/有环、活跃端点未归属、宿主专属端点被错误解释为容器 loopback、公开状态包含 secret 值。角色 provider 变更必须重新识别依赖，不能永久认定都是云端。

### 复用 CLI，再统一页面和 Agent 的操作来源

扩展 `tools/project.py`，新增 inventory、doctor、plan、restart、operation-status；保留 start/stop/status/logs 的人工入口。服务参数映射为固定 ID，不向 Agent 暴露任意 subprocess 参数、Compose 参数、路径或 RCON 文本。

一个操作计划说明目标、依赖闭包、受影响能力、配置差异、维护锁、所需备份与验证步骤。执行时使用服务 ID 查登记表，固定 `qiandengji` 与 D 路径，校验实际 container label；先满足依赖后启动，停止时逆序处理已选闭包。外部共享 TTS 默认无启停权限；停止 D 不停止旧 shadow。

普通 `stop world` 与“关闭对话”不能混用：world 仍承载玩家命令和语音队列；关闭运营角色/模型通道不应停 world。不要借运维治理改写现有角色进度或重建世界。

操作记录使用唯一 requestId、actorRole、target、plan/config 版本、开始/结束时间、步骤、退出码和恢复结果。超时返回 outcome_unknown 后先查询状态，不盲目重跑。复用当前 QA 维护标记与互斥语义，避免部署、备份、录音临时名单和 Agent 重启同一服务互相覆盖；完成前需核验名单、锁和服务恢复。

### 轻量常驻采集与完整验收分开

第一版可用一个有明确任务 ID 的 Windows 计划任务，周期调用只读 collector，沿用 project.py 的 Docker 调用适配；状态原子发布到 panel-state。不要给现有 panel 挂 Docker socket。collector 只查 D label 服务和已登记共享端点，轮次不重叠、每个检查有 timeout，并记录自身最近完成时间。

轻量 collector 发布 transport/process/readiness/capability/dependency 五类状态，以及 observedAt、validUntil、lastSuccess、lastError、queueDepth、oldestPendingAge。TTS 采用其实际提供的廉价就绪接口；若没有，则先做连接可达加最近合成结果，不能把 HTTP 端口开放当成模型已加载。主动合成与模型问答放入显式 smoke，频率和消耗单独治理。

完整 health_mon 保留为验收工具，输出最后测试的制品/源码身份和范围，避免每 30 秒反复做全部检查。自动恢复先只覆盖 D 可重启无状态 sidecar，并设置次数、退避和熔断；对 mc、共享 TTS、存档恢复和配置替换保留单独维护流程。所有恢复动作仍执行同一操作计划和回执，不新增第二套后台 shell。

## 运营组职责与权限

当前两个角色的提示词明确排除运维、自动任务和工具。未来修改职责时，初始化模板、实际 workspace、启用角色集合与 qwenpaw_health/verify_config 必须一起更新；不能只改提示词就宣称具备权限。

建议先定义工作职责，仍使用现有 QwenPaw 管理角色和任务，不急于新增多个常驻进程：

| 工作职责 | 第一阶段能力 | 有条件开放的执行权限 |
|---|---|---|
| 运营协调 | 读取全局状态、汇总故障、生成维护计划 | 提交登记表允许的 operation request；不直接持有 Docker/宿主 shell |
| 游戏服务巡检 | 读取命令/语音/NPC/队列状态，定位失效依赖 | 对明确授权的 D sidecar 执行既定恢复计划；不改奖励、余额或原存档 |
| 世界内容运营 | 基于玩法规则给出活动、探索和技能说明建议 | 通过现有玩法应用服务执行已获授权且可验证的操作；内容上线仍走构建/验证流程 |
| 玩家服务与传令 | 保留 mc-herald 的答疑；引用近期服务状态 | 仅游戏内已授权的服务反馈；不因此获得外部消息或宿主控制权 |

mc-god/mc-herald 的具体分工可由根方案合并以上职责。将来接入 MCP，应提供 `ops_inventory`、`ops_status`、`ops_logs`、`ops_plan`、`ops_submit`、`ops_receipt` 等限界工具，通过 application/OperationsPort 调用同一 runner。模型输出是请求，固定应用代码负责权限和执行；玩家聊天、日志和公告正文不能变成治理指令。

已存在的技能 CLI 允许可信本地调用者指定 actor，Numen MCP 持有实际 RCON 适配。若交给运营角色，工具适配层必须绑定授权角色/身体，不能直接把这些通用脚本及密钥授予全部角色。游戏角色权限和运维角色权限需要分开登记。

## 19091 运营组管理页

在现有导航中增加“运营组”和“服务管理”，复用当前公开读模型和页面风格：

- 服务表显示运行地点（D / 共享宿主 / 未接入）、所有者、期望状态、观察状态、影响能力、依赖、上次检查和配置版本；TTS 不隐藏在 voice 的绿灯后。
- 运营组显示现有角色、职责、启用/暂停、授权工具范围、当前任务、最近回执、待处理故障与模型状态；“接口声明支持 task”不能显示为“正在运营”。
- 日志仅从登记过的来源读取有界尾部，按服务和 operationId 定位。默认脱敏 token、凭据、玩家语音正文；不得通过 URL 参数任意读取文件。
- 配置页先提供来源、已应用版本和差异；密钥仅显示已配置/缺失及引用，不提供原文。切换 provider 同时显示依赖变化和重载计划。
- 页面写操作后续由独立受控操作入口处理，保留当前只读 panel 的挂载与进程权限。使用独立认证和 CSRF 防护，不能仅靠 localhost/Host 检查就开放启停。页面和 Agent 最终调用同一操作服务，产生同一回执。

第一阶段即使只提供计划和 CLI 执行，也应在页面清楚显示“查看”“已生成计划”“已提交”“已执行及验证”，不要用一个成功提示替代真实操作结果。

## 验证建议与实施顺序

1. **静态登记与只读页面。** 录入 9 个 D 服务、共享 TTS、选定模型、禁用 memory/embed 与按需 MCP；验证 Compose/登记表一致、端点归属、无 secret 泄露。确认 8100 真实所有者；本报告不代替该检查。
2. **健康闭环。** 用离线 fixture 模拟 TTS 不可达但 voice 心跳新鲜、向量 disabled、模型服务失败、完整功能探针失败但容器正常；断言页面不显示完整功能可用。验证 collector 停止后页面过期，以及 UTC/UTC+08 时间比较。
3. **统一受控操作。** 离线验证依赖有环、未知 ID、旧 shadow label、路径越界、任意额外参数、维护锁冲突、重复 requestId、部分失败后的状态查询与恢复；记录 planned / executed 的区别。
4. **最小 D 实测。** 根协调者安排独立维护窗口，先以 resources 或 panel 等无存档服务验证启停、日志、状态更新和锁释放，再测试 world/npc 的依赖计划。检查 QwenPaw 不可达时确定性技能仍可用；不为验收主动停止共享旧服务。
5. **角色接入。** 先只读工具与计划建议，再为确定角色开放少量操作 ID。验证越权请求、玩家日志中的伪指令、已撤销权限和重复执行不会产生动作；QwenPaw 切换适配器时运维权限不变。

本轮最小目标应是“D 一键启动知道自己缺什么、页面能解释哪项能力不可用、运营组通过同一有限入口执行有回执的任务”。迁移 GPU TTS、打开 MemOS、恢复全部旧 Agent 团队或宿主 Host MCP，均可作为后续独立事项。

## 主要源码证据

- [Compose](../compose.yml)、[项目 CLI](../tools/project.py)、[运行/迁移配置](../config/server-runtime.json)、[健康入口](../check-health.bat)。
- [当前完整健康探针](../world/ops/health/health_mon.py)、[语音心跳探针](../tools/voice_health.py)、[NPC 心跳探针](../tools/npc_health.py)。
- [语音 watcher](../world/sidecar/god-voice-watcher.py)、[语音端点约束](../world/sidecar/voice_paths.py)、[ASR watcher](../world/sidecar/mic_asr_watcher.py)、[既有语音迁移记录](VOICE-INTEGRATION.md)。
- [world 装配](../world/bootstrap-world.mts)、[技能向量适配](../world/src/mc-magic.ts)、[模型端口](../world/src/providers/model-provider.ts)。
- [QwenPaw 初始化](../tools/init_qwenpaw.py)、[容器初始化](../world/ops/init_qwenpaw_runtime.py)、[QwenPaw 健康](../world/ops/qwenpaw_health.py)、[当前 QwenPaw 边界](../world/ops/QWENPAW-LOCAL.md)。
- [管理 HTTP](../world/admin/server.mjs)、[公开读模型](../world/admin/read-model.mjs)、[公开快照发布](../world/admin/publish.mts)、[管理前端](../world/admin/public/app.js)。
- [隔离 Numen MCP 入口](../tools/run_numen_mcp.py)、[技能 CLI](../tools/skill_cli.py)。
