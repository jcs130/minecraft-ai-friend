# 独立神谕服务

本项目仅整合原有 `mc-god` 和 `mc-herald` 神谕能力。初始化使用 `qwenpaw-mc:2.1.1`，已核对镜像实际 Python 包为 **qwenpaw 2.1.0**。宿主 2.2 的配置不能直接整包搬入。

`python tools/init_qwenpaw.py` 已在本地执行。脚本只读取原角色的模型选择与对应 provider，生成新主密钥并重加密选定凭据，写入被 Git 忽略的 `server/agents/secret`。原 MCP、driver、skills、tasks、jobs、sessions、历史玩家信息均不复制。角色提示词使用本目录经过审阅的 `qwenpaw-prompts`，保留神谕职责与角色语气。

初始化拒绝覆盖已有运行目录，不要为重跑测试删除正式独立角色的历史。`runtime/qp-init/test-state` 是单独的虚构离线测试配置，没有真实 provider 凭据。

新初始化默认让 `mc-herald` 使用 `mc-god` 的云 provider/model，同时保留各自角色提示词。原 herald 模型选择保存在私有 `init-manifest.json` 的 `source_model_selection`，对应 provider 仍独立加密保存。只有显式传入 `--use-source-herald-model` 才沿用源角色模型；默认策略在 mc-god 也为本地 provider 时拒绝猜测云模型。

## Compose 接入

以下片段交由主项目 compose 集成；初始化脚本不启动服务。

```yaml
qwenpaw:
  image: qwenpaw-mc:2.1.1
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
    QWENPAW_AUTH_ENABLED: "1"
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

世界服务只得到独立控制台 token；不要给它挂载整个 Agent secret 目录。令牌与随机控制台登录密码保存在 `server/agents/secret`，不得复制进文档或分发包。网页若需要登录，本机可查看该目录的 `console-login.json`，不要在日志中打印内容。

token 认证不需要固定 Docker 子网。`allow_no_auth_hosts` 已置空；实际镜像按精确 IP 匹配该列表，不支持 CIDR。必须保留 `QWENPAW_AUTH_ENABLED=1`。world 的同步 chat、后台 task 和轮询均通过 `qwenpawHeaders` 添加认证；未配置 token 的旧环境仍保持原行为。

镜像启动时强制确保 `default` 与 `QwenPaw_QA_Agent_0.2` 存在。初始化会预置这两个**禁用**占位配置，避免首启意外添加可用工具；实际仅 `mc-god`、`mc-herald` 两个角色启用。健康探针检查启用角色集合。

## 已验证和启动后检查

初始化与配置验证容器均使用 `--network none` 和独立 HOME。`qwenpaw_verify_config.py` 通过真实 `load_config`、`load_agent_config`、ProviderManager 及 AgentBuilder 构建确认：两角色 toolkit 为 0；provider/模型存在；新密钥可解密；控制台 token 有效。Builtin tools 全量显式禁用（不能写空 tools），ACP 的 4 个默认代理禁用，MCP 为空。额外的 memory_search、自动记忆、梦任务、scroll recall、coding/visual 工具也关闭。

启动后运行：

```powershell
docker compose -p qiandengji up -d qwenpaw
docker compose -p qiandengji exec -T qwenpaw python /ops/qwenpaw_health.py
```

健康探针只读取 API：无 token 请求必须 401，两角色存在且工具全部禁用。不触发任何模型请求或游戏动作。容器 restart 策略提供常驻守护；该探针覆盖配置和 HTTP 就绪，**真实模型回复仍需另行验证**。

本机已运行 `python /ops/qwenpaw_smoke.py` 完成双模型真实短问答：两个角色均返回预期 JSON、无错误事件。公开摘要为项目 `reports/qwenpaw-smoke.json`，不含令牌或玩家历史；此测试直接访问独立控制台，不执行 Minecraft 动作。

后续真实游戏长提示词暴露出原本地 herald 模型的 `incomplete chunked read` 断流，短问答成功不能代表游戏请求稳定。独立 `mc-herald` 已于 2026-09-07 切换到与 mc-god 相同的 `zhipu-cn-codingplan / glm-5.3`；角色提示词不变。原选择及提示词哈希保存在私有 `server/agents/model-choice-backups`。恢复时先停止独立 qwenpaw，仅将 mc-herald 的 `agent.json` 中 `active_model` 换回备份的 `previous_active_model`，再重启并重新跑游戏聊天冒烟；不覆盖整份 agent 配置、不删除会话，也不修改原生产 QwenPaw。当前实际游戏结果以 `reports/goddess-smoke.json` 为准。

宿主本地模型 provider 的 loopback 主机已转换为 `host.docker.internal`，端口与 API 路径保留。此地址仅用于原选定的本地语言模型服务，不能替换为旧 QwenPaw Agent API。若该模型服务只监听宿主 loopback，容器可达性需要启动后确认；云模型与本地模型的实际回答均不在离线检查中冒充成功。
