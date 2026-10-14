# My Agent World：统一 Agent 接入

2026-10-14。整合分支沿用 `experiment/agent-society-1.21.1`，合入本轮发现的 `main@4f677be`，核心仍为 `agent-mc-world 0.4.0`，包含最新游戏笔记、经验服务、通用战术、库存同步和连接修复。包版本相同不表示字节相同，部署时核对安装清单中的源码与归档 SHA。

## 三种身体，一套框架

| provider | 游戏身体 | 适合用途 | 前提 |
|---|---|---|---|
| `mineflayer` | 通过游戏协议登录的玩家 | 远程 Agent、无图形环境、已有 Mineflayer 工具 | 本整合服使用既有 NeoForge 协议网关和原生 SDK；原生模组操作按实际 operations 发现 |
| `numen` | Numen 服务端身体 | 常驻居民、原生 Lua、断线后保留身体 | 对应的私有控制入口、原 bodyId、账号权限和动作账本 |
| `java-client` | 启动器中已经登录的真实 Java 玩家 | 完整客户端模组、真实 GUI、原始画面、Baritone | Minecraft 1.21.1、NeoForge 21.1.248、Java 21，以及目标服务器要求的客户端模组 |

```text
外部宿主的人格 / 模型 / 高层目标
                  ↓
agent-mc-autonomy：一个回合协调者、目标与反馈、事件处理
                  ↓
agent-mc-world：agent-mc/v1、工具屏障、事实、事件、请求防重
                  ↓
agent-mc-host：同一工具契约与核心游戏记忆服务
                  ↓
world-adapter：明确选择一个 provider、绑定一个身体与原账本
          ├─ Mineflayer / 原生 SDK
          ├─ Numen / 原生 SDK / Lua
          └─ 真实 Java 客户端桥 / 可选 Baritone
```

不得同时对同一身体运行第二个控制器。切换 provider 不会自动迁移身体、背包、个人记忆或未完成动作。旧 Agent 的暂停、unknown 和原账本不因安装新包解除。

可选 Minescript 4.0 已接入真实客户端，使用 `minescript.state` / `minescript.run` 执行有限 Python 并返回原动作回执；安装与例子见 [Minescript 指南](MY-AGENT-WORLD-MINESCRIPT.md)。服务端常驻和远程运行继续使用同一自研核心。

## 统一工具

连接后先读 `mc_capabilities`、`mc_state`，再按需调用 `mc_operations` 和 `mc_help {"operation":"..."}`。所有 provider 保留：

- `mc_read`：只读原生查询。
- `mc_do {action_id, operation, args}`：一个实际操作，参数来自当前 provider 的目录。
- `mc_result` / `mc_wait`：查询同一个 action_id 的进度和终态。
- `mc_cancel` / `mc_stop`：取消原动作或停止当前输入；不能回滚已消耗的物品。
- `mc_control`：显式 claim、续租、release；不会授予 OP。
- `mc_navigate {action_id, position:{x,y,z}, backend:"auto"}`：绝对坐标导航。Java 客户端装有 Baritone 时 auto 选择 Baritone，否则使用本 provider 的 `body.move`。`native` 或 `baritone` 可以显式指定；强制选择不可用后端会失败。
- `mc_memory`：复用核心的游戏笔记与可选经验服务。先读 `action:help`；默认本地模式不调用模型或网络。
- `mc_visual`：具有 `frame()` 能力的真实客户端返回原始 PNG，包括模组 GUI；其他 provider 明确不可用。原有 Mineflayer/Numen Web 画面仍由 `mc_viewer` 返回显式地址。

工具受理、执行结束和玩家目标完成是三个不同判断。位置和物品名称来自实际身体；原始 ItemStack ID、完整 SNBT、菜单槽位和 stateId 保留。私有回执不发进游戏聊天。

默认核心的 vanilla `steps` 与本适配器的 `{action_id,operation,args}` 不可混用。自主框架现在读取实际 schema：只有步骤队列后端才注入 queue；操作后端保留原 action_id，不假装支持原版的检查点插队。该后端的 insert 等待原动作终态，replace 先显式停止，再接续新目标。

## 游戏记忆

适配器通过公开的 `World.gameNotebook` 端口使用核心 `GameMemoryService`，连接前、连接中和断线后访问同一作用域，不另建记忆实现。核心继续拥有 dataDir 排他锁和请求账本。

配置可选 `realmId` 与 `agentId`。同一 realmId、真实 UUID、账号名和 agentId 可跨 provider 保持笔记身份；另一角色或 Agent 的记录隔离。没有显式 realmId 时按当前接入地址或 Numen bodyId 使用弱身份；更换世界要用新 dataDir，不自动复用旧世界笔记。

`capture` 必须读取当前身体的最新实际快照，离线或陈旧快照拒绝保存。捕获内容包括绝对位置、生命、饥饿、魔力与有限库存信息；不复制物品完整组件、聊天或凭据。所有笔记仍是历史，不能代替当前查询。向量、远端检索和经验整理仅在显式配置后使用，不自动调用云服务、审核候选或修改技能。

## 可选 Baritone

客户端桥 0.3.0 注册 28 项能力。Baritone 使用原作者 `baritone-api-neoforge-1.11.3.jar`，官方 SHA256：`7f9f40952c49e78388e4e9ceaa6fd91a5b662238e06c997b3de5438177f99d8d`。只装客户端；不放进服务端 mods。

| operation | 行为与终态 |
|---|---|
| `baritone.state` | 安装状态、控制归属、准备中、路径、目标和 ETA；未安装明确说明 |
| `baritone.goto` | 原生寻路到绝对目标方格；按 Baritone feet cell 判断，并返回实际小数坐标；默认不拆块、不垫块 |
| `baritone.mine` | 提供 blocks、预期掉落 itemId、背包目标总量 targetCount；实际库存达到目标才成功 |
| `baritone.follow` | 跟随已加载、同维度、存活的 UUID，限制 durationMs；目标消失失败 |
| `baritone.farm` | 半径内有限时段收割、补种并拾取原版作物；备好种子，核对实际收成 |

例如先发现 schema、claim，再提交：

```json
{"action_id":"gather-coal-01","operation":"baritone.mine","args":{"blocks":["minecraft:coal_ore","minecraft:deepslate_coal_ore"],"itemId":"minecraft:coal","targetCount":8,"timeoutMs":60000}}
```

targetCount 是期望背包总量，不是新增数量。期间开启 legitMine、关闭对角透矿；这只约束 Baritone 采矿，不代表全部客户端读取都具有严格视线公平性。首次掉落筛选在后台准备，准备完成后才在客户端线程启动采矿，避免 Baritone 首次资源重载阻塞主线程。准备期间仍能取消，准备结果不能越过已取消的动作重新启动。

所有任务使用同一控制租约、单槽动作与持久账本。F8 释放控制并暂停，另一次 F8 解除暂停后仍需 claim。取消、超时、死亡、断线或租约失效会停止本桥拥有的 Baritone 过程并恢复临时设置；安全取消可能需要结束当前跳跃，返回 stopImmediate 供核对。已经由其他控制器启动的 Baritone 过程不能被本桥直接接管。

有限种田期间允许等待幼苗，避免收割后掉落物尚未落地就退出；到 durationMs 即停止。执行结束不代表作物产量目标达成。当前开放范围不包括完整图纸建造、所有模组作物、机器装配或所有 Mineflayer 插件。Mineflayer 风格 facade 的 `pathfinder.goto` 可复用 Baritone；`openContainer` 等待真实窗口，而普通 `activateBlock` 只表示交互输入送达。

## 接入自主框架

独立自主框架跟进到 0.1.21；本机候选 wheel 位于 `E:\QiandengJiSocietyLab\integrations\agent-mc-autonomy\v2-unified-20261014`。它是可选安装包，构建和安装不会启动模型。按下文显式选择本轮 v15 MCP entry，避免误用另一身体后端。

已有 Neko、Cortico 或其他宿主可以继续使用自己的模型与高层记忆，通过统一 SDK/MCP 接入。本次没有接 QwenPaw、复制 Cormy 个人信息或启动新的长期模型循环。

要使用独立自主框架，把原生 JSON 配置保存为私有绝对路径，并在 TOML 中选择显式身体配置：

```toml
[autonomy]
enabled = true
max_decisions = 20

[server]
host = "192.168.3.163"
port = 28976
username = "YourAgent"
version = "1.21.1"

[backend]
node = "C:/path/to/node.exe"
body_config_file = "E:/private/your-agent-body.json"

[viewer]
auto_open = false
```

body_config_file 的对象原样交给显式 MCP entry，不自动改为默认 vanilla 配置。示例 Java 身体文件：

```json
{
  "provider":"java-client",
  "username":"YourAgent",
  "expectedUuid":"填写真实客户端的UUID",
  "expectedServer":"192.168.3.163:28976",
  "controllerId":"your-agent-controller",
  "credentialsFile":"E:/your-launcher-game/maw-client-bridge/connection.json",
  "ledgerDir":"E:/private/your-original-action-ledger",
  "dataDir":"E:/private/your-harness",
  "realmId":"my-agent-world-current-world",
  "agentId":"your-agent"
}
```

原 ledgerDir 必须保留。首次新身体才创建新的账本。Mineflayer 和 Numen 的字段见[统一身体适配器](MY-AGENT-WORLD-WORLD-ADAPTER.md)，真实客户端见[客户端桥](MY-AGENT-WORLD-JAVA-CLIENT.md)。

```text
agent-mc-autonomy run --config E:/private/autonomy.toml --entry E:/QiandengJiSocietyLab/integrations/agent-mc-world/v16-minescript-20261014/agent-mc-host/mcp.mjs --goal "观察周围，收集食物并搭建安全住处"
```

模型配置沿用自主框架的显式 provider/model 与密钥环境变量。没有配置模型就不冒充自然语言自主规划。框架仅在发现 mc_control 后 claim，并在已知租约到期前续租；不会增加第二个身体队列。实时状态查询来自同一身体；采样时间变化不会独自触发重复决策。遇到 unknown 保留原请求和账本，停止重投。

## 发布与维护

本轮为可选客户端/SDK/框架分发，生产游戏服、基岩桥、原角色配置与原世界保持。客户端桥和 Baritone 随所属 Minecraft 进程退出，没有独立守护服务；常驻部署仍应交给现有服务管理器。客户端 SDK 只监听本机回环，MCP 使用 stdio，不新开公网端口。

核心 viewer 输入按上游锁定的共享源码 `68daa1431cac5f4dc3f9d95499de326834d0627d` 在独立目录重建并明确记录新归档 SHA，未取得上游原归档，也未修改共享 checkout 或生产可视化资源。默认 1.20.6 viewer 不是模组服近似渲染替代品；Java 原帧来自实际客户端。

健康检查沿用 `--society-agent-mc-world-smoke`、`--society-java-client-smoke` 与实际新包清单。测试、类型检查、打包消费者、真实流程和保全证据见 [本轮验收记录](evidence/unified-access-20261014.json)。物理键盘、长期自主生活、全模组语义及持续视频各需独立验证；接口列表不能作为这些能力已完成的证明。
