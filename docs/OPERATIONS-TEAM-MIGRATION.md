# 原世界运营组迁入 D 的准备清单

2026-09-07。**这是迁移提案与只读校验结果，没有创建运营状态目录、修改 Compose、导入凭据、启用 Agent 或启动容器。** 公开机器清单在 [operations-team-plan.json](../config/operations-team-plan.json)，校验器在 [check_operations_team_plan.py](../tools/check_operations_team_plan.py)。

## 独立容器与角色边界

建议新增可选 Compose profile `operations`，服务名 `qwenpaw-ops`，独立运行时标识 `qiandengji-ops`。状态根为 `server/operations-agent-state`，控制台建议 `127.0.0.1:18090`；启用前仍需检查端口归属。现有游戏会话 `qwenpaw`、18089、`server/agents`、world 的 provider URL 全部保留。相同 Agent ID 必须由 runtimeId 区分，不能把玩家会话投给运营角色。

组织关系保留：**造物主 → 运营天神 → 司灯 → 运营／策划／体验官**。原身份和职责与实际工具授权分开；工程、重启、世界改写职责不能通过复制旧提示词自动获得管理员权限。

| 目标运营 ID | 来源 | 保留职责 | 模型选择来源 |
|---|---|---|---|
| `mc-god` | 宿主 `.copaw/workspaces/mc-god` | 全局目标、重大裁量、运营验收 | `zhipu-cn-codingplan / glm-5.3` |
| `default` | shadow `default` | 司灯、台账、风险分派与协调 | `aliyun-codingplan / qwen3.6-plus` |
| `mc-herald` | shadow 同 ID | 运营巡检、行为测试、体验问题 | `aliyun-codingplan / qwen3.6-plus` |
| `mc-priest` | shadow 同 ID | 世界观、剧情、活动策划 | `aliyun-codingplan / kimi-k2.5` |
| `mc-guard-kirito` | shadow 同 ID | 桐人，玩家侧体验与反馈 | `aliyun-codingplan / MiniMax-M2.5` |
| `mc-guard-naruto` | shadow 同 ID | 鸣人，玩家侧体验与反馈 | `aliyun-codingplan / glm-5.1` |

不导入 shadow 的 QA 辅助角色、旧容器 `mc-god` 叙事分身，以及宿主云端团队、local-butler、TNO 先遣角色。原 shadow `default/TEAM.md` 作为组织关系的主参考；其他副本需比对差异。司灯源目录目前没有 `SOUL.md`，校验器明确报告缺项，不能宣称该文件已完整复制。

## 版本与字段迁移

目标沿用本地镜像 `qwenpaw-mc:2.1.1`，实际 Python 包为 **2.1.0**，本地镜像 ID 已锁入清单。源 shadow 同为 2.1.0；宿主为 2.2.0。已在现有容器只读构造 `Config`／`AgentProfileConfig`，确认当前字段与 26 个内置工具名；没有启动模型或新容器。

导入时必须在固定镜像、`--network none`、干净临时 HOME 下构造新的 2.1.0 模型并 roundtrip 验证。此步骤尚未执行。源文件只提供 `id/name/description/active_model/language` 及待审的身份提示；**不要整包复制** `running/tools/mcp/acp/security/channels/backend_settings/last_dispatch`，也不复制宿主的 2.2 扩展工具配置。

现有 `world/ops/init_qwenpaw_runtime.py` 展示了真实 2.1 schema、关闭内置模板与工具注册核验方法；`tools/init_qwenpaw.py` 展示了私有重加密方式。它们当前硬编码两名游戏会话角色及 `server/agents`，**只能参考实现方法，不能直接对运营目录运行旧初始化器**。

每个运营角色的 workspace 改为 `/state/work/workspaces/<id>`。三件身份文件、TEAM 和选定技能先进入独立审阅区，逐项改旧 C 路径、shadow 服务名、身体定位与旧管理操作。只复制明确选中的技能及其依赖；不复制整个技能池、治理数据库、会话、记忆库、任务历史或 inbox。

## 私有 provider 与认证

公开计划仅保留 provider/model ID 和来源、目标目录；没有 key/token/password 值。校验器对两条选定 provider 只检查文件存在且来源唯一，未读取内容。

实际迁移时由私有工具读取 shadow 的 `aliyun-codingplan` 与宿主的 `zhipu-cn-codingplan`；如源 API key 为 ENC，仅读取对应源密钥在内存解密，目标生成新主密钥并重新加密。目标私有目录为 `server/operations-agent-state/secret`。不复制源 `.master_key`、认证库、控制台 token、登录密码、`credentials.yaml`，也不复用现有 D 会话服务的控制台身份。

模型 ID 是源配置选择，不代表本次已验证远端额度、权益或可用性。所选条目若依赖宿主 loopback 模型，只能明确决定保留后改为 `host.docker.internal`；本清单的六个选择不需要为旧 Qwen 本地别名默认接回宿主推理服务。

## 初次导入必须暂停的自动行为

不能只关 `jobs.json`。导入时六名运营角色先全部 `enabled=false`，同时落实根级与每 Agent 的下列开关，再验证没有内置 default/QA 模板意外自动启用：

- heartbeat 关闭；所有显式 jobs 关闭；不启动 ops_drive、guard_drive、oracle、saga-trigger 等外部驱动。
- MCP、四类 ACP、插件、外部消息渠道和内置动作工具先关闭。
- ReMe 的 `auto_memory_interval=0`、`dream_cron_enabled=false`、`daily_paper_cron_enabled=false`、`memory_search_enabled=false`、自动搜索关闭。
- `inbox_push_enabled`、自动记忆/梦境/论文推送全部关闭；自动标题、plan、coding_mode 关闭，context strategy 使用已验证 native。

旧 shadow 的 ReMe 23 点梦境任务不在 jobs.json 中；保留记忆文件也不等于应保留自动任务。之后可以逐角色开放交互式运营，再由唯一调度负责人启用明确的一项周期任务，不能同时恢复旧 cron 和新巡场桥。

## MCP、路径与依赖接线

| 依赖 | 已有证据 | 初始迁移策略与启用前条件 |
|---|---|---|
| 世界与健康公开投影 | `server/panel-state/world.json`、`health.json` 存在 | 只读挂载；明确快照年龄，不把旧检测当实时状态 |
| Numen MCP | D `world/sidecar/guard/mcp_numen.py` 与 `skill_cli_client.py` 存在，Python 语法通过 | 使用 D 新版，不换回旧 C 版本；先关闭。验证玩家主体、D 队列、统一 CLI 回执与失败不重放 |
| 运营 god MCP | 旧 C `mcp_god.py`、`god_channel.py` 存在；D 尚无审阅副本 | **保持关闭**。旧 `god_exec/god_send` 支持任意管理员命令，不能仅重映射路径就启用 |
| God channel | D `server/mc/god-channel/world-status.json` 存在 | 目录或信标存在不证明新运营端已授权。需验证消费者、过期检测、动作范围和回执 |
| 世界原始数据 | `server/world-data` 存在 | 不给泛化 data_read 或整个可写卷；先用公开投影，必要队列以后按文件授权 |
| MemOS | 旧 `shadow-memos-mcp:8003/mcp` 及相关服务存在 | 初期关闭；不把旧团队共享记忆作为隐式跨世界写桥 |
| 运营健康探针 | 现有探针为两个无工具会话角色设计 | 运营专属探针尚未实现；不能复用其绿灯宣称六角色工具链准备就绪 |

Numen 的旧 `MC_RCON_HOST=mc` 在 shadow 网络指向旧服，目标须明确为 D 游戏服务及其专属连接凭据；不要为运营容器默认注入全权 RCON。`MC_DATA_DIR` 最终应指向 D 队列目录，旧 `DATA_DIR=/data`、`GOD_CHANNEL_DIR=/god-channel` 需要逐一映射。MCP Python 脚本是由 Agent 管理的子进程，按角色和工具生命周期管理，不另起一套散落后台进程。

原存档有重复名字的 Kirito/Naruto 记录。迁移提示与模型不应召唤、改名、删除或任选“第一个”身体；工具启用前必须明确既有 UUID 绑定。首次写入类验收只使用专用 QA 身份，不能拿原四条角色记录试运行。

## Compose 最小形态（仅示意，未写入项目配置）

```yaml
services:
  qwenpaw-ops:
    profiles: [operations]
    image: qwenpaw-mc:2.1.1
    pull_policy: never
    restart: "no"
    entrypoint: [qwenpaw]
    command: [app, --host, 0.0.0.0, --port, "8088"]
    ports: ["127.0.0.1:18090:8088"]
    environment:
      HOME: /state/home
      QWENPAW_WORKING_DIR: /state/work
      COPAW_WORKING_DIR: /state/work
      QWENPAW_SECRET_DIR: /state/secret
      COPAW_SECRET_DIR: /state/secret
      QWENPAW_DISABLE_KEYRING: "1"
      QWENPAW_KEYRING_ACCOUNT: qiandengji-ops
      QWENPAW_AUTH_ENABLED: "1"
    volumes:
      - ./server/operations-agent-state:/state
      - ./server/panel-state:/public:ro
    networks: [operations]
networks:
  operations: {}
```

该形态不连接默认游戏网络、不挂旧 C 目录、Docker socket 或游戏控制卷。单独桥接网络并不是完整出站白名单；若要求只访问模型域名，还需另外实施并验证出站策略。专属健康探针和资源限额应在实际服务落盘时补齐。即使使用 optional profile，已经启动的容器仍会受 restart policy 影响，因此准备阶段用 `restart: "no"`，不能把 profile 当成后台不会运行的保证。

## 旧 18088 的停用与切换

主任务已经授权的旧服务临时治理可独立执行，不需要为了“等迁移”继续保留不需要的旧监听。以下条件约束的是**宣布 D 运营组已接替旧组**：

1. 保存旧身份、TEAM、选定技能、任务定义与私有迁移来源，不删除原 C。
2. 查明所有 old ops/guard/oracle、宿主钩子和调用方；停用或明确重定向，避免双调度。
3. D 六角色身份、模型、只读状态与专用 QA 回执验收通过；自动任务仍按单一负责人逐项开放。
4. 宿主非游戏定时任务与旧 MemOS 依赖分别交代，不能随游戏运营组一起误停。
5. 复核旧 18088 不再监听，当前 18089、玩家会话和游戏功能保持正常；记录可逆恢复方式，而不是删除源目录和密钥。

## 本轮只读验证

```powershell
python -X utf8 tools/check_operations_team_plan.py --inspect-image
```

本轮结果：**58 项检查通过、0 项失败、4 个明确待办警告，`readyForActivation=false`**。警告为宿主 2.2 需白名单迁移、司灯缺 SOUL、D 运营 god MCP 审阅副本未准备、运营专属健康探针未准备。另有 5 项负例确认：目标目录重叠、自动任务误开、梦境误开、端口冲突及来源越界都会使校验失败。校验包含源目录/模型选择、目标隔离、自动任务暂停、依赖存在、Python AST、本地镜像 ID 与 provider 文件存在性；不导入或执行任何源脚本。

后续仍需固定镜像中的完整目标配置 roundtrip、私有重加密、运营权限范围、角色 UUID 和真实 D 回执验收。`ok=true` 表示提案和现有来源检查成立，绝不表示可以立即启动完整运营组。
# 后续部署记录

本文件是迁移准备阶段方案；2026-09-07 已在独立 18090 服务实施有限范围迁移，并升级 QwenPaw 2.2.0。实际角色技能、任务通信、调用限制、测试和未接管的游戏身体见 [运营组当前说明](OPERATIONS-TEAM.md)。下文原方案中的未启用状态保留为历史记录。
