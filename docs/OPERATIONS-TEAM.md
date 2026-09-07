# 千灯纪世界运营组

2026-09-07：独立运营服务已从 QwenPaw 2.1.0 升至 **2.2.0**。官方版本说明：[v2.2.0](https://github.com/agentscope-ai/QwenPaw/releases/tag/v2.2.0)。该版改进后台协作任务跟踪、取消和模型用量统计。宿主 QwenPaw 8088 保持原用途；游戏会话服务 18089、Minecraft、旧角色身体和存档不在本次升级范围。

日常入口：[运营组](http://127.0.0.1:19091/#operations)。工作区、对话、原生后台任务和技能管理：[运营 QwenPaw 控制台](http://127.0.0.1:18090)。登录信息在忽略的 `server/operations-agent-state/secret/console-login.json`，不能公开或提交。登录后选择司灯可发起运营任务，例如“让灯语检查当前快照，给出最值得处理的一项问题”。

## 角色与技能

|角色|实际配置的供应商 / 模型|本职技能|
|---|---|---|
|运营天神 mc-god|智谱 Coding Plan / glm-5.3|优先级与验收|
|司灯 default|阿里云 Coding Plan / qwen3.6-plus|精简协作与分工|
|灯语 mc-herald|阿里云 Coding Plan / qwen3.6-plus|服务故障与证据诊断|
|灶火祭司 mc-priest|阿里云 Coding Plan / kimi-k2.5|剧情和活动设计|
|桐人 mc-guard-kirito|阿里云 Coding Plan / MiniMax-M2.5|法杖、手柄、技能兼容验收|
|鸣人 mc-guard-naruto|阿里云 Coding Plan / glm-5.1|新手、探索、联机恢复验收|

全员另有证据报告技能，共 **7 份源码、12 项实际工作区绑定**。正文在 `world/ops/skills/`，绑定在 `operations-role-skills.json`。安装调用 QwenPaw SkillService，原生 Skill 工具按需加载已启用正文；没有为了读技能开启任意文件读取或 shell。工具可以查询固定游戏说明、世界内容状态和服务文档，不能把文档当实测证据。

技能根据现有自研言灵、8 槽、Iron 法术、传送阵及探索内容编写。两位体验官当前能提出验收方案和分析现有证据；驱动原游戏身体实玩仍待后续接线，不能声称它们已经在游戏内完成测试。

## 通信和调用费用

司灯通过 `operations_delegate` 委托其他五个固定角色；适配层使用官方 `build_agent_chat_request` 和 `/api/console/chat/task`，任务状态、停止与结果由 QwenPaw 原生后台任务负责。没有另造 Agent 执行器。`operations_task` 只能查询这套适配层登记的任务。普通问答不触发整队。

- 委托共享磁盘锁和持久化账本：至少间隔 **30 分钟**，滚动 **24 小时最多 4 次**；每个子任务 **180 秒**。失败或丢失应答也预占预算，不自动重投。
- 只有司灯有派工工具，目标不含自己。其他角色不能回调，不能派生动态子 Agent。任务查询至少间隔 30 秒，查询 HTTP 本身不调用模型。
- 全运营实例模型并发 **1**，每分钟最多 **6 次**；每角色迭代上限 **5**，根配置与新版 loop gate 同时设定。禁用自动重试、跨模型回退、自动标题、心跳、定时任务与记忆整理。
- 上面的 4 次是**派工次数**，不是总模型请求数；一个任务可能需要数轮模型请求。直接在原生控制台发起的人工对话仍受模型并发/QPM/迭代限制，不计入派工账本。
- 管理台显示实际请求和 Token 计数，不伪造金额或套餐余额。供应商配置与一次任务成功不同：本次只实测灯语，未逐一消耗其他角色额度。

首次新版实测：灯语用时约 **30.1 秒**，**4 次模型请求**，输入 **48,399**、输出 **1,530 Token**，成功保存带 requestId 的报告。它指出健康快照陈旧。随后复用现有两分钟库存采集任务刷新轻量服务健康；不新增常驻进程，不调用 LLM。旧完整部署报告仍单独保存。

实测后精简了发给模型的快照，移除重复服务说明、归档技能全文等。当前协议验证中约 **48 KB 来源文件被投影为 10.4 KB**，保留时间、哈希、现有技能、任务板与传送点。这是字节测量，不冒充缩减后的 Token 实测。全六角色 MCP、技能绑定和限制验证额外模型调用为 0。

## 可执行入口

```powershell
# 状态、配置、技能及预算验证：不调用模型
docker exec qiandengji-qwenpaw-ops-1 python /ops/operations_team_health.py
docker exec qiandengji-qwenpaw-ops-1 python /ops/operations_team_smoke.py

# 会调用模型：按需派给一名角色，共用上述频率预算
docker exec qiandengji-qwenpaw-ops-1 python /ops/operations_team_run.py --role mc-herald

# 停止独立运营实例；其他服务继续运行
python tools/operations.py stop --group operations --execute qiandengji
```

服务登记在 Compose operations profile、管理台维护白名单和健康清单，restart=unless-stopped，仅绑定主机回环 18090；使用独立 operations 网络。公开状态/文档只读挂载，没有 Docker socket、RCON 或世界写权限。报告属于提案，不能自动发奖、重启或修改存档。

每角色仅一个项目 MCP Driver。新版迁移默认的 wildcard ask 被替换为四项固定工具 allow（司灯另有两项协作工具），其它能力默认 deny；没有关闭全局安全机制。所有新版 builtin 默认开关重新清零，避免升级带入新增权限。

## 构建与迁移

需要本机已有 `qwenpaw-mc:2.1.1` 基础镜像；它实际包版本为 2.1.0，来源约束由初次导入工具验证。构建使用官方 PyPI 的精确 2.2.0 版本，不升级宿主 Python 环境。

```powershell
docker build -f world/ops/Dockerfile.operations -t qiandengji-qwenpaw-ops:2.2.0 world/ops
# 仅新机器/空目标目录使用；从指定旧角色来源迁入身份与所选provider，默认不执行
python tools/prepare_operations_team.py --execute qiandengji
```

已有实例必须先停止 qwenpaw-ops、备份其完整私有状态，再在新镜像中离线运行 `/ops/upgrade_operations_runtime.py`（挂载 `/state`、只读 `/ops`，配置 HOME、QWENPAW_WORKING_DIR、QWENPAW_SECRET_DIR，与 Compose 一致）。最后 `docker compose --profile operations up -d --no-deps qwenpaw-ops`。升级脚本保留身份和所选供应商、重新绑定已审查技能及工具权限；不要在仍有任务运行时改配置。

本次升级前备份在忽略的 `runtime/operations-upgrade-20260907/operations-agent-state`。回退须先停止运营实例并保存当前状态，再将备份复制到新目录、将专用实例挂载切到该副本并选回旧镜像；不覆盖正在运行的数据，不恢复其它旧游戏环境。旧版运营任务未通过完整验收，回退仅用于诊断。

本地证据：`reports/operations-team-smoke.json`、`server/operations-agent-state/protocol-smoke.json`、`run-reports/latest.json`。它们与密钥、会话、存档一起留在忽略目录。GitHub 只发布实现、技能、无密钥配置和验证脚本。
