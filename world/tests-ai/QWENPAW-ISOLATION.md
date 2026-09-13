# 独立 QwenPaw 最小私有配置清单

只读分析，未复制凭据、未启动或部署。依据宿主已安装 QwenPaw 2.2.0 源码；未输出任何 API key 值。

## 隔离根目录

显式设置 `QWENPAW_WORKING_DIR`、`QWENPAW_SECRET_DIR`，放在本项目被忽略的私有 runtime 目录。设置独立 `QWENPAW_KEYRING_ACCOUNT`；容器可使用 `QWENPAW_DISABLE_KEYRING=1`。程序代码/venv 可只读复用，工作目录、secret、会话、记忆及锁文件必须独立。

安装源码 `qwenpaw/constant.py:101` 会在没有显式 working dir 时优先使用已有 `~/.copaw`。另外 `config/config.py:3761` 的旧配置迁移分支，即便自定义 working dir，也会从 `~/.copaw` 复制 sessions、memory、jobs.json 和 AGENTS/SOUL/PROFILE。因此必须先准备现代 profiles 配置和独立 agent.json，或者在 HOME 不含生产 `.copaw` 的干净容器中初始化；不要在宿主裸跑首次初始化。

## 最小配置/资产

| 独立目录中的路径 | 处理方式 |
|---|---|
| `config.json` | 新建，仅保留需要的 console 通道与现代 `agents.profiles` 引用；全部 workspace_dir 指向独立目录。不要复制全局生产配置中的通讯、自动任务、插件或路径。 |
| `workspaces/mc-herald/agent.json` | 新建独立 Agent。世界源码优先调用这个 ID；只迁移需要的 active_model 的 provider_id/model 选择与必要运行限制。 |
| `workspaces/mc-god/agent.json` | 新建独立兜底 Agent。世界源码会 fallback 到此 ID，也会用于世界审阅。它必须属于独立服务，不是生产同名 Agent。 |
| 上述工作区的 `AGENTS.md` / `SOUL.md` / `PROFILE.md` | 只迁移经审查的人格/文本职责；移除生产路径、生产 shell 指令与全权开发职责。对于纯世界文本裁决，使用不带外部工具的独立职责即可。 |
| `<secret>/providers/builtin/<provider-id>.json` 或 `custom/<provider-id>.json` | 仅导入实际选用的模型 provider 及所需模型能力配置。provider JSON 会加密敏感字段；不能只拷加密文件并假定新 master key 可解密。应在受控迁移过程中解密选中字段后重新加密进独立 secret，且不输出值。 |
| `<secret>/providers/active_model.json`（按需） | 全局模型默认指针；若每个 agent.json 都明确指定 active_model，可不依赖它。 |
| 新秘密存储的 `.master_key` / keyring 项 | 由独立运行环境生成并私有保存；不可让独立服务共享生产可写 secret 目录。 |

生产工作区中的 `.mcp`、`skill.json` 和 skills 往往含工具与生产运维入口，**不是文本神谕服务的最小依赖**。也不复制 sessions、history.db、memory、jobs.json、checkpoints、聊天日志、全局 envs.json 或其他用户 agent。

世界实际接口在 `world/src/mc-god.ts:633`：POST console chat，`X-Agent-Id` 为 mc-herald/mc-god，消费 SSE 回复与 usage。后台任务接口还会访问 `/api/console/chat/task`。独立 world 的 `QWENPAW_CONSOLE_URL` 必须指向独立服务地址；仅修改 URL 指向宿主生产服务、再沿用相同 Agent ID，会继续触发生产 Agent 的工具，不能视为隔离。

守卫身体 MCP 是另一条链。将来需要时，为独立守卫工作区单独配置本项目 `mcp_numen.py`，显式设置 NUMEN_REPO_ROOT、NUMEN_DATA_DIR、NUMEN_SKILLS_DIR、MC_DATA_DIR 与独立 MC 端点；不能原样复制生产 `.mcp`。此处只列清单，不创建这些服务。
