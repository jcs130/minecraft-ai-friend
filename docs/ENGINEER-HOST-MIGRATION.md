# 天神迁至游戏 QwenPaw 列表

本次只迁一个既有角色：逻辑身份仍是 `operations:mc-god`，实际 Qwen 工作区改为 `game:qd-engineer`。游戏 `mc-god` 仍是灯语女神；其余运营角色不迁移。工单署名、工程回执、Git 分支、聊天 UUID、session/user/channel 与原定时任务 ID 保留。

2026-09-09 已完成原生导入与启用：18089 的实际智能体管理页面显示“天神 · 世界工程师”（`qd-engineer`），游戏9人、运营5人的严格健康检查通过。原四个MCP分别加载4/10/6/5项工具，两个原Cron已恢复，02:55的工程巡查自动开始；开始执行不等于该轮已经完成。原运营天神及其两个Cron保持停用。证据在本机 `runtime/engineer-host-migration-20260909/`，候选测试与上线证据分别保留。

目标保留原GLM-5.3模型、SOUL、会话、记忆正文及工程Git历史。原生恢复后仅两份已核准的ReMe派生索引刷新，其余1099份非配置文件逐字节一致。实际启用中移除了运营客户端遗留的源工作区cwd，避免指向游戏女神的目录；四个驱动的权限保持原值。司灯的运营MCP已重载，跨容器只读请求已核实路由到新天神。宿主Qwen与Minecraft没有随此次角色迁移重启。

## 原生接口与为什么需要转换

依据已安装 QwenPaw 2.2.0：`qwenpaw/app/routers/backup.py`、`backup/models.py`、`backup/orchestration.py`、`backup/_ops/create_helpers.py`、`backup/_ops/restore_helpers.py`、`app/routers/agents.py`、`app/chats/session.py`。容器源码位于 `/usr/local/lib/python3.11/site-packages/qwenpaw/`。

- 原生 backup/export 含完整选定工作区；原生 restore 没有改 ID 参数。直接把旧 `mc-god` 备份导入游戏会命中女神，禁止这样操作。
- `POST /api/agents/{id}/copy` 产生新 ID，但不复制历史会话、聊天和运行数据；Agent PUT 也不能改已有 ID。因此对原生 ZIP 做精确单角色目录转换，再走原生 import/restore。
- `SafeJSONSession` 的文件路径使用 channel/user/session，不依赖 agent ID。迁移保留这些原值，不在会话正文中全局替换 `mc-god`。
- 原生备份遇到不可读文件可能跳过；仅看到 `completed` 不足以证明完整。转换器需要冻结工作区的逐文件 SHA256/大小清单，和原 ZIP 全量核对。
- 原生 restore 会 preload 恢复角色，单独把 profile ref 标为 disabled 不足以阻止加载。因此导入 ZIP 中四个 MCP 驱动和两个 Cron 都先禁用；原运行配置的 heartbeat、Dream、自动记忆本来关闭，本次保持原值。

## 备份与转换

先让原天神完成正在执行的任务，保存源 `GET /api/agents/mc-god`、`GET /api/cron/jobs`（请求头 `X-Agent-Id: mc-god`）和工程配置。暂停原天神两个 Cron，使用原生 `PATCH /api/agents/mc-god/toggle`、`{"enabled":false}` 停用该角色，并核对原生任务终态、工程测试队列空闲。不要停用另外五个运营角色。

在源运营实例创建原生备份：

```json
POST /api/backups/jobs
{"name":"Engineer native host migration","scope":{"include_agents":true,"include_global_config":false,"include_secrets":false,"include_skill_pool":false},"agents":["mc-god"]}
```

按 job ID 查询 `GET /api/backups/jobs/{job_id}` 至 completed，按实际 backup ID 下载 `GET /api/backups/{backup_id}/export`。保存原 ZIP 的 SHA256，禁止改写原签名包。目标游戏实例须已存在相同 provider/model；本次源配置为 `zhipu-cn-codingplan` / `glm-5.3`，不是改换模型或搬运全局密钥。

在具备同版 Qwen 包和当前 `/ops` 源码的隔离进程执行以下两个阶段；工具只读源工作区/备份，只写新输出目录。清单输出必须放在源工作区外。

```text
python tools/migrate_engineer_to_game.py --inventory-workspace <已停止源角色工作区> --output <source-inventory.json>
python tools/migrate_engineer_to_game.py --source-backup <source-native.zip> --source-inventory <source-inventory.json> --prior-jobs <source-jobs-before.json> --expected-source-sha256 <原ZIP的SHA256> --output <全新staging目录>
```

输出包括 `qd-engineer-quarantined.zip`、`ready-agent.json`、`ready-cards/*.yaml`、`ready-jobs.json` 和 `migration.json`。只允许改写六个工作区文件：agent.json、jobs.json、四个已知驱动卡。四卡 endpoint/CLI 改到实际新角色，既有白名单/权限保持；工具会严格校验原运行策略，但不把身份迁移顺带变成运行配置升级。其余工作区文件逐字节保留，包括 SOUL、工程 `.git`、历史会话与学习资料。暂停前任务与备份任务必须除 enabled 外完全相同，才恢复 ready-jobs 的原开关。

工具拒绝其他角色/全局/密钥/技能池、路径穿越、链接、未知驱动/任务、缺文件、字节不符及已存在输出目录。失败目录留存，重试使用新目录；不删除失败证据、不重复导入同一目标。

源 `qiandeng_operations` 的 legacy client 可能另有 `cwd=/state/work/workspaces/mc-god`。迁移工具只接受空 cwd 或这个准确源目录，目标固定清空 cwd；入口脚本和状态根均为绝对路径，无需沿用旧目录。未知 cwd 必须报错，不能静默改成新角色目录。实机在导入后严格健康发现此遗漏时，只通过原生 API 修改已存在目标 client 的 cwd，再核对应 DriverCard；不能重跑 restore 覆盖导入后历史。此前 staging 包及其原 SHA 保留为当时证据，不追改成新版本产物。

## 原生导入、启用和回滚

1. 宿主映射 `/team/runtime-hosts.json` 设为 `prepared`，使用 `world_team_hosts.py` 的精确 schema。游戏实例准备原工程挂载及共享运营账本，工程 config.repo 改为 `/state/work/workspaces/qd-engineer/engineering/repo`。不建立空仓库，也不复制成另一个逻辑工程身份。
2. 对转换 ZIP 的实际 SHA 复核后，以 multipart `file` 和 `trust_mode=legacy` 调用目标 `POST /api/backups/import`。转换包明确无原签名，只接受这个本地产出的指定 SHA；原签名包原样保留。Qwen 可为受信任导入重新签名，所以导入后原生存储包 SHA 与本地转换包不同不应被误判为历史丢失。
3. 对返回的实际 backup ID 调用 `POST /api/backups/{backup_id}/restore`，body 使用 `migration.json.nativeRestore`：custom、仅 agent_ids=[qd-engineer]、不含 global/secrets/skill_pool、保留本地受保护配置。不要使用 full，不要自行指定额外 workspace base。
4. 导入后先核目标 ID、名称、language、模型、1:1 历史文件/聊天/会话、Git HEAD/status、7 个既有技能。核四卡和两个 Cron 仍关闭；旧天神仍停用、原五位运营与女神配置不变。
5. 经原生 AgentProfile PUT 应用 ready-agent，明确保留当前 name/language/model；四卡通过原生 MCP 配置、tools 和 policy 接口应用 ready-cards 的精确契约，核 DriverCard 与 legacy agent mcp 镜像一致。仅实际目标 qd-engineer；不把 ready-agent PUT 到 mc-god。此时 Cron 仍暂停。
6. 新实例文件守卫只允许自己的 qd-engineer 工作区；学习工具的逻辑 CLI 仍是 `--role mc-god --runtime operations`，增加 `--native-role qd-engineer --native-runtime game`；team/engineering/operations 也带明确新 host。每次调用重新检查映射，旧进程不能继续拥有执行权。
7. 映射切为 `active` 后核严格健康：`validate_native(profile,'qd-engineer',runtime='game')`、`validate_learning_workspace(folder,'qd-engineer','game')`、世界团队卡与原生 API、运营共享账本、旧天神禁用。然后原生 PUT 固定 ID 恢复 ready-jobs；原 weekly/team ID、session/user/prompt 保留。先只读工程状态和 diff，再观察唯一新原生班次，不新建重复 Cron。

若导入/恢复返回未知，先查询目标 backup/role/任务状态，不重复 restore。回滚必须先暂停新目标 Cron、等待任务/工程测试终态并禁用目标；保存新目标产生的会话、提交与工单，不能覆盖回旧包。把工程路径和 host 映射恢复到已备份的源配置后，确认旧源完整、目标不再执行，才恢复原天神开关和两个原 Cron。保留新目标归档供审查，不删除工作区；涉及共享工单的新变化逐条保留，不回滚整个账本或游戏存档。

表示层也要对应：原生 GET 返回的 running 会补齐缺省 null；因此 API 对 API、raw 文件对 raw 文件核验，不能把 null 补齐误认为运行偏好被改写。转换器用深拷贝验证原生 schema，输出保留源 raw running。

原生 MCP PUT 还会由 `drivers/adapters/mcp_card_builder.py:204` 将 client.name 写入 card.config.display_name；本项目 canonical learning_client.name 为 `qd_learning`，初始卡使用中文“本角色技能学习与每周维护”。实机启用后的唯一卡差异正是这两个名称。学习卡校验仅接受这两种准确表示，description、额外元数据、endpoint、credentials、工具白名单、default deny 与十条规则仍严格比较，不恢复旧格式规避原生写入。`test_learning_native_card.py` 通过官方 MCPClientUpdateRequest/build_mcp_driver_card 复现，未知名称仍拒绝。

原生 preload 后实际发现两份派生索引 SHA 变化：`mem_metadata/file_graph/default.jsonl.zst` 和 `mem_metadata/keyword_index/bm25_default_regex_7748e1d5a050_v1.pkl`。已只读核准生产包：ReMe `components/file_graph/local_file_graph.py:21,25,42–44` 定义图快照、启动加载并重建链接、dump 写压缩 JSONL；`components/keyword_index/bm25_index.py:63–70,361–383` 生成对应文件名并持久保存 BM25 倒排索引；`components/file_store/local_file_store.py:216,243,558,589,612,646–647` 从 chunks 同步/重建关键词索引并 dump 两个组件。Qwen `agents/memory/reme_config.py:609,625,653–654` 选择这两个 default 组件。可单列这两个准确路径的原生刷新差异，保留原/新 SHA，其他 1099 个未改配置的源文件继续逐字节核验；不能泛化忽略整个 mem_metadata，更不能覆盖回旧索引来满足字节断言。实际保存/启用结果以本机 `restored-preservation.json` 和根任务验收为准。

## 本机候选证据

忽略目录 `runtime/engineer-host-migration-20260909/` 保存源官方导出、逐文件 inventory、原任务开关及失败 staging。`staged-v2/migration.json` 记录真实转换结果：原 ZIP SHA256 `957a34e248fe3f97292d0d488d14f60410f12ecf56acb412653069efaaa26f34`；转换包 SHA256 `34b7d66f5ac7583e86a657a9dbf08c28f055573b2273d25b52fb2c083792e827`。1107 个源文件核对通过，仅六个配置文件变更，另外 1101 个文件字节一致；源 ZIP 未改动，0 模型调用、0 生产导入。

`tests/test_migrate_engineer_to_game.py` 使用真实 native BackupMeta/RestoreBackupRequest/DriverCard/SafeJSONSession，覆盖严格单角色范围、六文件转换、完整清单、暂停前任务恢复、未知任务拒绝、原生会话保存/换工作区/加载。`tests/test_engineer_learning_host.py` 验证实际工作区与逻辑账本分离、prepared 不执行、旧 host 失权、文件及 Cron 越界拒绝。隔离回归实录为 `runtime/engineer-host-migration-regression.json`；其数量/跳过项以真实报告为准，不将这份 staging 证据称为上线验收。
