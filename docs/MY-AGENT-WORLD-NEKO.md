# My Agent World：Neko 接入与维护

2026-10-08：已为 [mc-agent-neko](https://github.com/wehos/mc-agent-neko) 和 [Project N.E.K.O.](https://github.com/Project-N-E-K-O/N.E.K.O) 接通原生模组工具。mc-agent-neko 提供 Mineflayer 身体，N.E.K.O. 现有 Minecraft 插件增加 `minecraft_mod` 工具；后者是可选对话入口，普通 Agent 仍可直接使用框架无关的 [原生 SDK](MY-AGENT-WORLD-NATIVE-CALL-API.md)。

本轮没有替换现役 MawExplorer、启动第二条模型循环、重启 Minecraft 或重生成世界。MawExplorer 的原自主暂停、旧未知导航和模型任务保持。两个 QA 角色已退出，测试 WebSocket 已关闭。本轮验收的是工具调用链，不是 Neko 长期自主生活、对话/语音 UI、所有模组内容或 Neko 自己的网页画面。

## 实际接入链

```text
Project N.E.K.O. 的 minecraft_mod(operation, id, args, callId)
  → 已有 game_agent_minecraft WebSocket 客户端
  → mc-agent-neko 的 native_mod 消息入口（本机回环）
  → 同一个 bot 上的 attachModAgentClient
  → LAN 网关 192.168.3.163:28977
  → NeoForge 1.21.1 原生权限与模组逻辑
  → 仅请求 WebSocket 返回结构化回执
```

Neko 自己的模型也能使用 `!modList()`、`!modExplain("id")`、`!modCall("id", "参数JSON字符串")`、`!modStatus()`、`!modResult("callId")`。命令文档会自动包含这些入口，解析器支持转义的 JSON 字符串与完整 SNBT。普通移动、战斗和采集仍使用原 Neko 工具；模组身份、完整物品组件、窗口与 CAS 通过原生接口读取，不能拿代理 player_head 或代理方块 ID 当成实际模组内容。

现有 48 项原生操作中 23 项只读、25 项变更；同一本人连接注册 19 个 SDK 频道。范围包括殖民地岗位/研究/供料、女仆任务/背包、Ars 学习/编书/选槽/施法、Create 设置/过滤/流体查询、Domum 切割与 Curios 饰品。目录存在不代表任意机器、原生 GUI 或完整自主生产链都已经适配，具体限制见 [模组操作指南](MY-AGENT-WORLD-MOD-OPERATIONS.md)。

## 安装与配置

本机目录：`E:\mc-agent-neko`、`E:\Project-N.E.K.O`。上游分别锁定 `23f5971203e3f4d15ef416ff8e5cc67965845d82`、`fb2a2e731a8c954478d08678b0c8cf40e8145a54`。适配源代码保存在本仓库 `world/src/neko-adapter/`；安装器先核对上游提交、原文件与已安装结果，有不相容的本地修改就拒绝覆盖。

在本仓库根目录预览；首次安装才加 `--apply` 与一个尚不存在的备份目录：

```powershell
python tools/install_neko_mod_adapter.py --neko E:\mc-agent-neko --project-neko E:\Project-N.E.K.O
python tools/install_neko_mod_adapter.py --neko E:\mc-agent-neko --project-neko E:\Project-N.E.K.O --backup-root E:\QiandengJiSocietyLab\backups\neko-install-NEW --record E:\QiandengJiSocietyLab\integrations\neko\installation.json --apply
```

mc-agent-neko 使用 Node 22。适配锁定 Mineflayer 4.37.1、minecraft-protocol 1.66.2、minecraft-data 3.112.0、prismarine-chunk 1.41.0、vec3 0.2.0，并附完整 `package-lock.json`。在其目录运行 `npm ci --ignore-scripts --no-audit --no-fund`。本轮未构建它的 Canvas/原版截图器；截图保持关闭，不能因此声称该渲染器可用。

启动已配好模型的 Neko 时，把下列环境传给它及其子进程。服务器版本固定 `1.21.1`，host `192.168.3.163`，port `28977`，auth `offline`；使用独立玩家名，绝不能复用在线 MawExplorer 或其他人的账号。

```powershell
$env:MAW_NEKO_ADAPTER_FILE='E:\minecraft-ai-friend-society-lab\world\src\neko-adapter\native-runtime.cjs'
$env:MAW_NEKO_LEDGER_DIR='E:\QiandengJiSocietyLab\integrations\neko\ledgers'
$env:NEKO_PLUGIN_WS_HOST='127.0.0.1'
$env:NEKO_PLUGIN_WS_PORT='48909'
$env:NEKO_AGENT_SCREENSHOT_INTERVAL_MS='0'
$env:DEBUG_CHAT='0'
$env:NODE_PATH='E:\QiandengJiSocietyLab\gateway\permanent\node\node_modules'
```

Neko 根 `settings.js` 的 `allow_insecure_coding` 设置为 `false`，并禁用 `!newAction`；接入用原生工具，不绕过回执和身体所有权写任意代码。上游默认游戏端口 55916 不是本服入口。`SETTINGS_JSON` 环境变量接受 JSON **内容**而不是文件路径，可用 `(Get-Content -Raw <私有设置文件>)` 提供覆盖，`profiles` 沿用接入方已经配置好的模型档案。

N.E.K.O. 的 `game_agent_minecraft` 运行配置 `[game_agent].ws_url` 指向同一个 Neko 的回环 WebSocket，例如 `ws://127.0.0.1:48909`，再启用插件。安装器保留其 `auto_start=false`，不修改平台核心、不写模型密钥、不自动开启模型。平台整体使用其官方要求的 Python 3.11；本轮只在独立 Python 3.12 测试环境验证 SDK/插件，不等同于完整桌面平台验收。生成式模型调试仍遵守本项目 QwenPaw 与线上 `qwen3.7-plus` 的既有约定；本次没有新增 Neko 模型角色或把现役模型迁过去。

## 工具示例与结果

```json
{"operation":"list"}
{"operation":"explain","id":"colony.assignCitizen"}
{"operation":"call","id":"spell.glyphs","args":{"limit":1}}
{"operation":"call","id":"curios.open","args":{},"callId":"open-curios-001"}
{"operation":"result","callId":"open-curios-001"}
```

`minecraft_mod` 的 `args` 是对象，无需手工编码 Base64。返回保留原生 `result`，外层含 `requestId`、action、callId、playerUuid、epoch、成功/失败与 unknown；读取明确的失败代码，不能仅凭传输成功推断游戏成功。没有附近/所属殖民地时，`colony.status` 可返回 `no_nearby_or_owned_colony`，这就是实际前置条件。参数按 `explain` 取，不猜组件、坐标、角色权限或研究材料。

只向调用的 WebSocket 发 `native_mod_result`；不广播，不镜像原生 JSON 到游戏聊天。既有 Neko 普通日志/库存广播不是这条原生回执。任意账号都走自己的 bot/UUID，未特判 MawExplorer、CortiLan 或 QA 名字。

## 身体、重复请求与故障

写入前要求 Neko 身体空闲，先结束原本的移动/攻击/进食/窗口操作。模组写入在途期间拒绝其他手部/物品写包，ActionManager 与动作反射让位；不抢占一个未结束的 Neko 动作。读取可以并行。这个适配没有重写 Neko 全部寻路/原版技能，也没有把原生碰撞查询接入其 pathfinder。

每个账号有独立 `writer.lock` 和 fsync 的 `native-actions.jsonl`。先落 intent，后执行原生操作，最后落 result。同一个 callId、同样参数返回原结果；改变参数则拒绝，不重新消耗物品。未知写入、未完成 intent、身份变化或账本 IO 故障阻止后续写入，不能靠断线、重生或重启绕过。N.E.K.O. 客户端传输超时也会保留 callId 并阻止继续 call，用 `result` 读到原调用的已知结果后才能继续；客户端这层等待集合在内存，身体账本持久化。进程重启后必须先查 status/旧 callId，不能新建 ID 重试。

当前启动时对账本设 16 MiB 读取上限，达到后需维护审查；不会自动截断或删除调用历史。尚未提供自动归档工具，不能丢掉历史 callId 索引来腾空间。

崩溃留下 writer.lock 时，先确认该账号的 Neko 进程确已退出，再对账 intent/result 和服务器状态。清除锁只释放单写者占用，不会清除 unknown；不能删账本、换账本目录或换号当作恢复。回滚先停止本次 Neko 实例，按安装备份逐个恢复原文件；新增 helper/lock 仅在确认还是本次产物后处理。Minecraft 世界和现役 Agent 不需要回滚或停机。

## 实测与维护

普通非 OP `MawNekoQA1008`、`MawNekoQB1008` 经实际 LAN IP 登录，使用真实 Neko `initBot`、命令注册表、WebSocket 服务及真实 N.E.K.O. `minecraft_mod` handler/SDK/客户端。最后一轮有 1 个 Neko 命令读取、10 个插件工具回执，117 个本人原生包；模组目录、schema、殖民地能力、glyph、饰品状态、女仆列表及原生饰品栏打开均通过。同 callId 再次调用没有第二个写意图，无关 WebSocket 收到的原生回执为 0。无 OP、无物资授予、无模型调用；QA 正常断开，临时 28988 端口关闭。

早期未登录 username 的初始化错误已修；另一次把“没有殖民地”的真实拒绝误设为必须成功的探针断言，保留失败记录并修正探针，不改成伪成功。上游插件目录 check 为 0 error / 8 个既有支持文件警告；相关 105 项上游测试以原文件字节副本隔离平台全局 conftest 后通过，完整平台 suite 没有运行。

```powershell
node --test world/src/neko-adapter/native-runtime.test.cjs
python -m unittest discover -s world/src/neko-adapter/project-neko -p test_native_mod.py
node tools/test_neko_overlay.mjs E:\mc-agent-neko
python world/ops/health/health_mon.py --neko
python world/ops/health/health_mon.py --society
```

`--neko` 只检查安装清单与当前代码/锁文件哈希，明确不代表 Neko 已自主在线。`--society` 仍检查现役三服务；其中 autonomy-active 因用户原自主暂停为 false，不能冒充全绿。安装收据在 `E:\QiandengJiSocietyLab\integrations\neko\installation.json`，私有实测证据在 `research/neko-adapter-20261008/`，都不提交。

持久在线 Neko 必须接入进程守护、健康与停机回路，并完成模型路由；本次没有新增裸常驻进程。现有 `http://192.168.3.163:28984` 仍显示 MawExplorer，不能当成 Neko 视角。Neko 同连接的 mc-visual-console 输出尚未接线，完整动画/碰撞、复杂生产和新服基岩/公网仍按原能力清单保留未验项。
