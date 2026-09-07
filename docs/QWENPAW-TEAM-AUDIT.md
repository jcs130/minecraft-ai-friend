# QwenPaw 世界运营组只读审计

审计日期：2026-09-07。**本报告记录读取时的状态与建议，没有执行迁移、停用、改配置或进程治理。** 明细见 [脱敏清单](../reports/qwenpaw-team-audit.json)，管理页面可使用 [只读投影采集器](../tools/qwenpaw_inventory.py)。运行状态可能随后因主任务的统一操作而改变。

## 核心结论

用户所说的“游戏世界运营组”确实有既有实现基础：旧 shadow 工作区保留完整 `TEAM.md`、运营/策划角色、体验官、MCP 与巡场桥。当前 D 盘实例只迁入了**两个精简会话 Agent**，并没有迁入整套运营团队。不能把两个健康的 QwenPaw 容器理解为两套都在正常自主运营。

| 范围 | 实际包版本 | 控制台 | 配置 Agent / 启用 | 当前边界 |
|---|---|---|---|---|
| `qiandengji-qwenpaw-1` | Python 包 2.1.0；镜像标签 2.1.1 | `127.0.0.1:18089` | 4 / 2 | D 游戏会话后端，当前健康 |
| `shadow-qwenpaw` | Python 包 2.1.0；镜像标签 2.1.1 | `0.0.0.0`、`::` 的 18088 | 7 / 6 | 旧运营配置与 MCP 仍在；部分关键驱动已退出 |
| 宿主 QwenPaw | 已安装 2.2.0 | 配置记录 `127.0.0.1:8088` | 15 / 8 | 游戏、云端协作及非游戏任务混合；进程归属应结合主任务盘点 |

镜像版本来自容器 `importlib.metadata.version('qwenpaw')`，宿主版本来自 `.qwenpaw/venv/Lib/site-packages/qwenpaw-2.2.0.dist-info/METADATA`。没有以镜像标签代替实际包版本。

## 路径与角色

宿主 `.qwenpaw` 主要放虚拟环境、浏览器扩展和运行辅助文件。业务配置仍在 `C:/Users/lzl19/.copaw/config.json`。容器源码 `qwenpaw/constant.py:101-113` 的优先级是显式工作目录环境变量，其次已有 `~/.copaw`，最后才是 `~/.qwenpaw`；不能只搬 `.qwenpaw` 就认为搬走了团队。

- D：`server/agents/work/config.json`，容器路径 `/state/work`；凭据目录单独在 `/state/secret`，本审计未读取凭据内容。只有 `/state` 写卷与 `/ops` 只读卷，没有旧 MC 数据卷或 RCON 环境。
- shadow：`C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/ops/docker/shadow/copaw/config.json`，映射 `/root/.copaw`。另有旧 `/data`、`/mcdata`、`/god-channel` 写卷及 RCON 环境变量。它们指向原 C 世界，不能将相同名字的 Agent 当成已连接 D 世界。
- 宿主：`.copaw/workspaces/<id>/agent.json`。同一 `mc-god`、`mc-herald` 在三处是独立配置、独立工作区，不共享当前启停或模型选择。

| Agent | D 实例 | 旧 shadow | 既有职责 |
|---|---|---|---|
| `mc-god` | 启用；GLM-5.3 | 停用；qwen3.7-plus | D 为神谕/对话；旧容器分身为叙事提案与复盘 |
| `mc-herald` | 启用；GLM-5.3 | 启用；qwen3.6-plus | D 为文本答疑/传令；旧团队为运营巡检、祈愿与行为测试 |
| `default` | 停用 | 启用；qwen3.6-plus | 旧团队司灯、项目负责人 |
| `mc-priest` | 未配置 | 启用；kimi-k2.5 | 剧情、活动与村庄策划 |
| `mc-guard-kirito` | 未配置 | 启用；MiniMax-M2.5 | 桐人，玩家侧体验官 |
| `mc-guard-naruto` | 未配置 | 启用；glm-5.1 | 鸣人，玩家侧体验官 |
| `QwenPaw_QA_Agent_0.2` | 停用 | 启用 | QwenPaw 内置辅助角色，不能等同世界测试调度 |

D 两个启用角色当前均配置 `zhipu-cn-codingplan / glm-5.3`。其中司礼已不同于早期 `initialization-report.json` 所记的本地 Qwen 模型，实际应以其 `agent.json` 为准。未调用任何远端模型验证可用性、额度或计费。

旧组织证据在 shadow 的 `workspaces/default/TEAM.md:8-16`：造物主 → 宿主天神 → 司灯 → 运营、策划和体验官；`default/AGENTS.md:11-13` 也引用该组织法。`TEAM.md:18-23` 的游戏内角色表达与工作面协作分离仍可保留。三份 TEAM 文档内容已有差异，不能当成单一同步配置；未见根配置中可直接迁移的独立机器可执行团队关系字段。

## 工具、技能、任务与真实进程

**D 当前刻意是会话模式。** `mc-god`、`mc-herald` 的启用内置工具为 0，MCP 为 0，ACP 全关，技能目录无自定义技能，显式 heartbeat 关闭，ReMe 记忆搜索和自动梦境任务关闭，最大迭代 4。两份 `AGENTS.md` 也明确只返回语言结果，由世界进程验证执行，不运维服务器。这与“完整运营组”有明确差距，属于职责缺口，不是容器故障。

旧 shadow 的实际权限更大：

- 桐人、鸣人、运营和策划各有 6 个文件读写/搜索工具。司灯有 24 个启用工具，包含 shell、浏览器、跨 Agent 调用/委派；QA 有 5 个文件/shell/看图工具。
- 根级 ACP 的 opencode、qwen_code、claude_code、codex 均启用且标 trusted；若 Agent 没有覆盖，仍需核验实际继承和可执行依赖，不能仅据根开关认定全部可用。
- `drivers/mcp/*.yaml` 是当前必须核对的来源。旧 JSON `mcp.clients` 与迁移后的 driver 文件不完全一致。例如司灯 JSON 主要列 tavily，但实际 driver 中 god、memos 启用，tavily 停用。只数旧 JSON 会漏掉权限。
- god 使用 `/opt/sidecar/god-channel/mcp_god.py`，连接旧 `/god-channel` 和 `/data`；numen 使用 `/opt/sidecar/guard/mcp_numen.py`，目标 `mc:25575`，身体名 Kirito/Naruto。它们没有指向 D 服。
- memos 指向 `http://shadow-memos-mcp:8003/mcp`；其 API、Redis、Qdrant、Neo4j、embedding 依赖仍在旧容器组。宿主 mc-god 则配置 loopback 8003，不能假定等价于容器服务名。
- shadow 桐人和鸣人工作区各有 11、13 个技能目录；宿主 mc-god 有 33 个。存在不等于已验证触发，更不能原样赋给 D 会话 Agent。

读取时 shadow-QwenPaw 内的 5 个 Python 子进程可明确归属：**3 个 god MCP、2 个 numen MCP**，对应脚本都存在。D QwenPaw 容器仅主进程。这些是按 Agent 启动的正常 MCP 子进程，不应按 `python` 名称逐个杀掉；应管理其所属容器或 Agent 工具生命周期。

同时，`shadow-opsdrive`、`shadow-guard`、`shadow-oracle`、`shadow-world`、`shadow-mc` 已退出。旧 `TEAM.md:37/44/56/63` 描述的巡场、策划和守卫驱动依赖这些桥。因此目前可以说“旧团队配置存在、MCP 仍启动”，不能说“旧团队正按原节奏持续巡场”。

显式 `jobs.json` 清点：D 0 项启用；shadow 的司灯 2 小时巡场任务已停用；宿主 MC 巡检任务均停用。宿主 local-butler 仍有 **2 项启用的非 MC 任务**（内容发布/日常检查），不应纳入游戏停服清理。

另一个独立计数边界：旧 shadow 多角色使用 `remelight`，配置 `dream_cron_enabled=true`，梦境 cron 为 `0 23 * * *`，自动记忆/梦境推送亦开启。它们不在上述 jobs.json 数量中；本次没有读取运行中 scheduler 的全部内部状态，不能将“显式 jobs=0”写成“没有任何后台模型任务”。

## 建议的治理顺序

1. **先把三套身份和生命周期分开登记。** D 会话服务、旧运营组、宿主综合工作各有唯一名称、入口、数据根、负责人和启动方式。将 MCP Python 归到父 QwenPaw，把巡场/守卫桥归到所属世界；不要按端口相似或进程语言批量关闭。
2. **优先复核旧控制台访问范围。** 宿主无凭据 GET `/api/agents`，D 18089 返回 401，旧 18088 返回 200；旧端口同时发布到所有接口。该请求只验证了宿主来源，不代表已测试外部可达性。限制旧入口和认证策略应由统一治理动作落实，本审计没有改变它。
3. **把团队定义作为有版本的项目资产迁移。** 若决定将运营组迁到 D，保留司灯/运营/策划/体验官职责，逐个导入提示与必要技能，先核验名单、模型、数据映射、MCP、定时任务和权限。不要整包覆盖 2.1/2.2 配置、复制会话和密钥，也不要把旧 C 写卷直接接给 D。
4. **运营入口与玩家会话保持可核验权限。** 初期运营读取 D 的公开世界/健康投影，输出问题、策划提案和验收记录；需要改配置、重启、修改世界的动作进入受限管理接口。桐人/鸣人体验官不得仅因“运营组成员”获得 root、任意 RCON 或代码写入权限。
5. **明确唯一巡场调度。** 重新启用任何 ops/guard/cron 之前，先确认旧驱动不会同时运行，标记目标世界；设超时、并发上限、失败回执和停机后的静默状态。保留宿主非 MC 任务，由其自身业务管理。

这些是可落地建议，尚未执行或宣布治理完成。

## 公开投影接口与验证

`tools/qwenpaw_inventory.py` 提供 `collect_qwenpaw_inventory(project_root=None, user_home=None)`，仅返回 `runtimes`、`agents`、`issues`。不返回原配置对象、完整提示、任务消息、环境内容、凭据或会话。`toolCount` 仅计配置启用的内置工具；`mcpCount` 在同名 driver 覆盖 legacy JSON 后计启用客户端；`jobCount` 仅计启用的显式任务定义，不含 ReMe 自动维护。宿主进程无法在此独立确认时标为 `unverified`。

本轮完成实际配置/镜像元数据读取、Docker 状态和 MCP 子进程归属核对、两入口无凭据只读 HTTP 检测；采集器 6 项契约与敏感字段哨兵检查通过。没有调用模型、执行任务、读取聊天正文或密钥内容，也没有改变服务与进程。
