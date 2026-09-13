# 游戏 QwenPaw 服务

当前游戏实例已包含原神谕双角色、真实桐人及村民/公会/女仆三个专职角色，共6个启用角色。模型任务统一入口、追加注册与本轮验证见 [MODEL-TASK-ROUTING.md](../../docs/MODEL-TASK-ROUTING.md)。以下保留神谕服务的初始化与升级历史，不应重跑旧初始化覆盖当前角色。

本项目仅整合原有 `mc-god` 和 `mc-herald` 神谕能力。游戏运行镜像为 `qiandengji-qwenpaw-game:2.2.0-qd1`（官方包 2.2.0 加项目就绪兼容补丁），与六角色运营容器、宿主 QwenPaw 分开。最初初始化使用 `qwenpaw-mc:2.1.1`（实际 Python 包 2.1.0）；旧初始化器仍锁定这个来源，再通过下述离线迁移进入 2.2。不要把宿主配置整包搬入，也不要对已有游戏状态重跑初始化。

`python tools/init_qwenpaw.py` 已在本地执行。脚本只读取原角色的模型选择与对应 provider，生成新主密钥并重加密选定凭据，写入被 Git 忽略的 `server/agents/secret`。原 MCP、driver、skills、tasks、jobs、sessions、历史玩家信息均不复制。角色提示词使用本目录经过审阅的 `qwenpaw-prompts`，保留神谕职责与角色语气。

初始化拒绝覆盖已有运行目录，不要为重跑测试删除正式独立角色的历史。`runtime/qp-init/test-state` 是单独的虚构离线测试配置，没有真实 provider 凭据。

新初始化默认让 `mc-herald` 使用 `mc-god` 的云 provider/model，同时保留各自角色提示词。原 herald 模型选择保存在私有 `init-manifest.json` 的 `source_model_selection`，对应 provider 仍独立加密保存。只有显式传入 `--use-source-herald-model` 才沿用源角色模型；默认策略在 mc-god 也为本地 provider 时拒绝猜测云模型。

## Compose 接入

以下片段交由主项目 compose 集成；初始化脚本不启动服务。

```yaml
qwenpaw:
  image: qiandengji-qwenpaw-game:2.2.0-qd1
  restart: unless-stopped
  entrypoint: ["qwenpaw"]
  command: ["app", "--host", "0.0.0.0", "--port", "8088", "--log-level", "info"]
  ports:
    - "127.0.0.1:18089:8088"
  environment:
    HOME: /state/home
    QWENPAW_WORKING_DIR: /state/work
    COPAW_WORKING_DIR: /state/work
    QWENPAW_SECRET_DIR: /state/secret
    COPAW_SECRET_DIR: /state/secret
    QWENPAW_DISABLE_KEYRING: "1"
    QWENPAW_KEYRING_ACCOUNT: qiandengji
    QWENPAW_AUTH_ENABLED: "0"
  extra_hosts:
    - "host.docker.internal:host-gateway"
  volumes:
    - ./server/agents:/state
    - ./world/ops:/ops:ro
  healthcheck:
    test: ["CMD", "python", "/ops/qwenpaw_health.py"]
    interval: 30s
    timeout: 25s
    retries: 4
    start_period: 60s
```

在 `world` 服务设置：

```yaml
environment:
  QWENPAW_CONSOLE_URL: http://qwenpaw:8088/api/console/chat
  QWENPAW_CONSOLE_TOKEN_FILE: /run/secrets/qwenpaw-console-token
volumes:
  - ./server/agents/secret/console-token.txt:/run/secrets/qwenpaw-console-token:ro
```

世界服务只得到独立控制台 token；不要给它挂载整个 Agent secret 目录。旧令牌与登录凭据保存在 `server/agents/secret`，仅保留兼容用途，不得复制进文档或分发包。18089 网页按用户要求本机免密码访问。

网页部署使用 `QWENPAW_AUTH_ENABLED=0`，端口必须绑定 `127.0.0.1`。`allow_no_auth_hosts` 仍为空，不添加网段白名单。world 的同步 chat、后台 task 和轮询仍通过 `qwenpawHeaders` 添加旧认证头；服务在免密码模式兼容这些请求。管理台的内部 control token、CSRF 和 Host/Origin 保护见 [服务器管理设计](../../docs/SERVER-MANAGEMENT.md)。

镜像启动时强制确保 `default` 与 `QwenPaw_QA_Agent_0.2` 存在。初始化会预置这两个**禁用**占位配置，避免首启意外添加可用工具；实际仅 `mc-god`、`mc-herald` 两个角色启用。健康探针检查启用角色集合。

## 已验证和启动后检查

初始化与配置验证容器均使用 `--network none` 和独立 HOME。`qwenpaw_verify_config.py` 通过真实 `load_config`、`load_agent_config`、ProviderManager 及 AgentBuilder 构建确认：两角色 toolkit 为 0；provider/模型存在；新密钥可解密；控制台 token 有效。Builtin tools 全量显式禁用（不能写空 tools），ACP 的 4 个默认代理禁用，MCP 为空。额外的 memory_search、自动记忆、梦任务、scroll recall、coding/visual 工具也关闭。

启动后运行：

```powershell
docker compose -p qiandengji up -d qwenpaw
docker compose -p qiandengji exec -T qwenpaw python /ops/qwenpaw_health.py
```

健康探针只读取版本、配置与 API：免密码访问正常，两个游戏角色存在且工具全部禁用。不触发模型请求或游戏动作。容器 restart 策略提供常驻守护；该探针覆盖配置和 HTTP 就绪，**真实模型回复仍需另行验证**。

历史版本已运行 `python /ops/qwenpaw_smoke.py` 完成双模型真实短问答：两个角色均返回预期 JSON、无错误事件。本机摘要为项目 `reports/qwenpaw-smoke.json`，不含令牌或玩家历史；此测试直接访问独立控制台，不执行 Minecraft 动作。该历史证据不代表升级后或更换模型后的推理结果。

历史游戏长提示词暴露过原本地 herald 模型的 `incomplete chunked read` 断流，短问答成功不能代表游戏请求稳定。2026-09-07 曾把两角色统一到 `zhipu-cn-codingplan / glm-5.3`，相关备份在私有 `server/agents/model-choice-backups`。2026-09-08 升级前实读用户最新选择为 `mc-god: zhipu-cn-codingplan / glm-5.3-flash`、`mc-herald: aliyun-codingplan / qwen3.5-plus`。升级保留即时配置，不能按历史文档覆盖模型。历史实际游戏结果以带原始日期的 `reports/goddess-smoke.json` 为准。

## 游戏容器升级

官方稳定版来源：[QwenPaw 2.2.0](https://pypi.org/project/qwenpaw/2.2.0/)。在独立镜像构建阶段执行官方 `qwenpaw update --yes`，并核对目标版本：

```powershell
docker build -f world/ops/Dockerfile.qwenpaw-game -t qiandengji-qwenpaw-game:2.2.0-qd1 world/ops
```

构建不挂载游戏状态。Dockerfile 在最新稳定版与已审查的 2.2.0 不一致时停止，避免日后重建意外带入新版本。直接在运行容器执行 `qwenpaw update --yes` 会被官方命令拒绝；容器内临时安装也不能保证重建后保留。

已有实例先在私有状态副本验证迁移，再确认没有正在执行的任务，仅停止 `qwenpaw`，完整备份 `server/agents`。使用新镜像、`--network none`、Compose 中相同的 HOME/WORKING_DIR/SECRET_DIR，把该状态挂到 `/state`、源码 `world/ops` 只读挂到 `/ops`，执行 `/ops/upgrade_qwenpaw_runtime.py --apply` 和 `/ops/qwenpaw_verify_config.py`。验证成功后 `docker compose up -d --no-deps qwenpaw`。仅凭 HTTP 成功不能证明升级完成，还须检查真实包版本、角色和模型选择、持久状态、world 容器到原 API 的连接及控制台界面。

2.2 的 ProviderManager 会把供应商文件转换到新 schema，并重新加密相同 API key，因此密文文件哈希可能改变。迁移须核对解密后的凭据、URL、模型 ID 及用户选择一致；不能把这类自动转换误报成密钥值更换。完整备份包含原始密文及主密钥。

官方 2.2.0 在内置 `default` 禁用时，即使两个游戏角色都启动成功，仍不会设置 `/api/healthz` 的就绪信号。`patch_qwenpaw_game.py` 只补充该回调：没有启用 default、启用集合非空且所有角色都启动成功才报告就绪；失败或空集合不通过，不启用额外角色。补丁在构建时严格核对版本与源码上下文，常驻健康检查同时读取官方就绪接口。

回退时先停止游戏 `qwenpaw`，保留失败状态供排查，恢复本次完整私有备份，把 Compose 的游戏镜像改回 `qwenpaw-mc:2.1.1` 再单独启动。不要只降级镜像而沿用已经迁移的配置。Minecraft、world、六角色运营容器和宿主 8088 不参与游戏 QwenPaw 升级。

模型入口整合已将 `world/src/providers/qwenpaw-provider.ts` 的后台任务 JSON 修正为 `timeout: 570` 秒，本地轮询上限仍为 590000 毫秒。后台回执未知时不再转同步重复投递，传令官请求失败也不跨角色重投。生产 world 从 `MODEL_TASK_ROUTES_FILE` 加载中央用途目录，按 `world.oracle`、`world.herald`、`world.saga`、`world.evolution_review`、`world.daily_report` 选择注册的 QwenPaw Agent 与 API；三类消费者统一读取控制台认证。部署验收由维护流程记录，源码测试不代表线上已更新。

宿主本地模型 provider 的 loopback 主机已转换为 `host.docker.internal`，端口与 API 路径保留。此地址仅用于原选定的本地语言模型服务，不能替换为旧 QwenPaw Agent API。若该模型服务只监听宿主 loopback，容器可达性需要启动后确认；云模型与本地模型的实际回答均不在离线检查中冒充成功。
