# AI Agent 接入千灯纪

外部 Agent 使用现有 Numen 服务端身体和 Python stdio MCP 桥。Numen 是上游项目，本包保留本地 `numen_act` 扩展与现有技能通道。神谕角色 `mc-god` / `mc-herald` 独立运行、只提供语言模型回答；不要把身体 MCP 配到这两个神谕角色中。

## 启动 MCP

入口是 `tools/run_numen_mcp.py`，示例配置在 `config/numen-mcp.example.json`。将示例导入支持 stdio MCP 的外部 Agent；Python 环境需要安装 `mcp` SDK。55 项工具保留原动作，并新增技能回执查询。`goddess_cli` 现在返回统一技能入口的实际 JSON 回执，`skill_receipt` 只读查询既有请求；原生铁魔法和旧秘术的用法见 `SKILLS-UNIFIED-CLI.md`。

```powershell
python tools/run_numen_mcp.py --check
python world/tests-ai/mcp_stdio_check.py
```

真正作为 MCP 服务启动时不带 `--check`。stdio 的标准输出由协议占用，不在该窗口手动输入游戏命令。

启动器固定使用本项目 `server/world-data` 的咏唱、祈愿和回执通道，以及该目录的 `rcon-secret.txt`。RCON 仅连 `127.0.0.1:25577`，临时渲染客户端仅连本机 `25567`；继承的 RCON 密码与生产地址不会覆盖这两个目标。示例 JSON 不含密钥。

`NUMEN_COMPANION` 是要绑定的 Minecraft 登录名，默认 `QiandengAgent`；只接受 1–16 位字母、数字和下划线。`NUMEN_DISPLAY` 是显示名。修改这些变量不会自动创建或替换任何玩家身体。

## 准备身体

这些命令来自本项目真实集成测试 `tools/smoke_ai.mjs`：测试从成功登录的临时客户端取得 owner UUID，召唤 `QDSmokeBody`，查询自状态，最后 dismiss；目前已全部通过。

为正式外部 Agent 绑定身体时，使用**本独立服中选定拥有者的真实 UUID**，把下例的占位值替换好。不要使用玩家名代替 UUID，不要复用 `QDSmokeProbe` / `QDSmokeBody` 等测试名，也不要替换已经在线的身体。

```powershell
docker compose -p qiandengji exec -T mc rcon-cli 'numen_act list'
docker compose -p qiandengji exec -T mc rcon-cli 'numen_act summon <拥有者UUID> QiandengAgent'
docker compose -p qiandengji exec -T mc rcon-cli 'numen_act invoke QiandengAgent get_self_status {}'
```

成功召唤的回复包含 `summoned=QiandengAgent|uuid=`；自状态回复包含本身体的姓名、HP、坐标。外部 Agent 随后使用 MCP 的 `get_self_status` 感知身体，`list_skills` / `read_skill` 获取技能说明，动作任务用 `task_status` 查看执行进度。

需要让这个身体退出时，操作对应的登录名：

```powershell
docker compose -p qiandengji exec -T mc rcon-cli 'numen_act dismiss QiandengAgent'
```

`chant` 进入世界现有施法通道，`pray` 进入神谕请求通道。技能是否存在、等级、魔力、生命与饥饿消耗由世界服务判断。MCP 接收请求不代表法术已经执行；应读取现有 `get_recent_messages` 中本角色的咏唱回执，并结合身体状态确认结果。不要在线改写整个 `magic-state.json`，否则可能覆盖世界进程缓存中的玩家进度。

确定性操作优先使用 `goddess_cli`：`skills` 列出 8 项特色秘术，`spells` 查看当前可用原生法术，`spells archive` 查看 64 项旧技能档案。旧主动技能返回 `skill_archived`，不会自动解锁对应铁魔法。`waypoint` 列出地点与固定引用，`goto personal:6` 或 `goto shared:1` 使用该引用传送；编号只是格式示例，应选择实际查询结果。支持真实维度和安全落点检查，`outcome_unknown` 时先查询位置，不自动重试。

## 渲染与依赖

现有 `guard-render-pure.mts` 和 `guard-render-webgl.mts` 已纳入本项目。默认使用 `world/node_modules`；本地也可将 `NUMEN_NODE_MODULES` 指向明确选择的已安装依赖目录，代码和世界数据仍使用 D 盘项目。`NODE_EXE` 可以指定 Node 路径。

本机已安装 D 盘 Node 依赖，但安装时使用了 `--ignore-scripts`，canvas/gl 等原生模块的构建和真实出图**尚未验收**。`--check` 看到 tsx 启动文件存在，只说明找到启动器，不能当作视觉测试通过。俯视渲染依赖 Mineflayer/pngjs/vec3；第一人称还依赖 prismarine-viewer、three、node-canvas-webgl 及原生图形依赖。

## 已通过的集成检查

测试仅对本项目存档副本的专用 QA 角色执行，不改真实玩家等级或技能。

- 原版协议 Mineflayer 登录成功，实际右键技能指南针收到 27 槽罗盘，8 项特色技能图标各不相同。
- `numen_act` / `skillchest` / `fly` 命令存在；Numen 身体自状态成功。
- `fireworks` 实际生成 3 个烟花实体并消耗 5 点魔力，同一请求重放未再次施法；归档的 `heal` 被拒绝且不扣费。
- Numen UUID 通过 Agent CLI 原生入口实际施放隐身术，卷轴被消耗；真实玩家中文咏唱同样通过。
- Numen 原生跨维度传送至下界并返回主世界，3 秒冷却与不安全落点拒绝均通过。
- 假身体已 dismiss，测试客户端已退出。

当前证据为 `reports/skill-compass-smoke.json`（10 组）、`reports/irons-bridge-smoke.json`（12 组）、`reports/waypoint-travel-smoke.json`（8 组）。此前 `feather_fall` 的 8 点魔力和 45 槽轮盘记录属于精简前历史基线；该主动技能现已归档。实体手柄输入与 Agent 离屏 WebGL 视觉仍未验收。
