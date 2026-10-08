# My Agent World：Neko 接入与维护

2026-10-08：已为 [mc-agent-neko](https://github.com/wehos/mc-agent-neko) 和 [Project N.E.K.O.](https://github.com/Project-N-E-K-O/N.E.K.O) 接通原生模组工具。mc-agent-neko 提供 Mineflayer 身体，N.E.K.O. 现有 Minecraft 插件增加 `minecraft_mod` 工具；后者是可选对话入口，普通 Agent 仍可直接使用框架无关的 [原生 SDK](MY-AGENT-WORLD-NATIVE-CALL-API.md)。

已增加独立普通玩家 MawNeko 的限时实机测试：mc-agent-neko 直接调用阿里云 Coding Plan `qwen3.7-plus`，不连接 QwenPaw，也不启动 N.E.K.O. 对话平台。没有替换现役 MawExplorer、重启 Minecraft 或重生成世界；MawExplorer 的原自主暂停、旧未知导航和模型任务保持。前一阶段的两个 QA 已退出；本次账号与记录独立。

## 直接模型实机测试（2026-10-08）

### 原生模组界面与库存提示（本次更新）

网页直接使用本人原生 `slotLayout`、物品 ID/组件、`mayPickup` 和光标物品。Curios 9.5.1 的背包、负 X 坐标饰品栏、动态列与分页行按原 `CuriosScreen` 的 PNG 裁剪和 `CuriosContainer` 坐标实现；贴图字节、安装 JAR 和资源优先级都须验证。Domum 1.0.231 建筑切割台接入原背景、材料/产物/背包槽和当前原生选择，必须匹配本人 UUID、windowId、stateId 和 5 秒内观测。**Domum 本次完成源码移植/测试，未在当前 Neko 会话实机验收。**分组/款式按钮图标与滚动位置、Curios 按钮/配方书仍明确未支持。其他模组窗口若有真实槽位坐标，显示标明用途的槽位诊断视图，不冒充原 GUI。

实际 Coding Plan 模型已执行 `curios.open → menu.current → menu.click(37) → menu.current → menu.click(9) → menu.current`，把本人已有的 `patchouli:guide_book` 从快捷栏移入空背包格。原始包确认 state 1→3→5：先在 37 槽、随后在光标、最后在 9 槽；完整 SNBT 相同，最后光标为空，没有授予 OP 或物资。浏览器检查确认了实际位置、原 PNG 饰品界面与魔力 100/100，浏览器错误日志为空。测试角色后来受伤到 17.5 血，退出保护正常结束该次连接；保留证据后人工进入下一验证阶段，没有自动重试未知操作。

修复 Neko `!inventory` 和提示词库存读取旧代理槽位的问题：启用适配器时从本人原生菜单/`playerInventory` 读取真实 ID、名称、数量和槽号，完整组件通过 `menu.current` 获取；无原生快照时报告不可用，不能回落成代理物品。未启用适配器的普通 Neko 保留原查询。重新登录后模型及网页共同确认指南书在 9 槽、37 槽为空，累计模型账本保留 40 次调用；这是本地受控预算的使用量，不是供应商限额判断。

同连接只读观察器每 2 秒查询 Ars，并在实际打开相关窗口时查询 Curios/Domum；不打开窗口或施法。法术/魔力携带观测时间，超过 5 秒为陈旧；出生、重生和断线清理缓存。写操作占用期间不发起新的观察轮次。服务端回执的成功、拒绝或未知以私有状态显示，不发周期聊天。MawNeko 的 YSM `default/default` 与 Soul Spell 专用物品模型仍未适配；角色窗口显示明确原因，不再无限显示载入或使用替代人物。

新增只读探针（只证明数据链，不能证明像素一致）：

```powershell
python tools/probe_neko_gui.py --state-directory E:\QiandengJiSocietyLab\integrations\neko\trial-20261008
```

本次相关 88 项浏览器/资源测试、43 项原生客户端/适配测试通过；另有 2 项 GUI 探针测试及既有 Neko overlay 实际命令路由检查。安装器允许按上次安装清单的精确文件哈希升级自己的 overlay，任何额外本地改动仍拒绝覆盖，并先备份。现役 Java/网关/MawExplorer 的 PID、runId、原自主暂停、模型任务和 QwenPaw 配置/凭据哈希保持。当前网页仍是本机限时实测入口，未改成长期无人值守 Agent，也未接 QwenPaw。私有证据：`research/neko-ui-20261008/`。

库存提示的修复不代表全部 Neko 原版动作都能制造或使用模组物品。模组菜单、生产和专用交互仍须按 `modList → modExplain → modCall` 使用原生操作，真实前置条件不足时保留拒绝。自然采集→制造→施法命中、长期殖民地经营及所有专用 GUI 的完整流程仍待继续验收。

### 前一阶段验证记录

真实模型已完成 Ars 法术目录、6 项符文及各自已学习状态查询，打开本人 Curios 饰品菜单，并用新增 `menu.close` 关闭。关闭发送标准 `close_window`，必须收到同一玩家后续原生 `windowId=0` 快照才确认成功；光标有物品时拒绝，断线或超时为 unknown。它不是点击空槽或伪造本地界面状态。

隔离自动脱困干扰后，模型选择目标并实际走了约 5.85 格，最终位置约 `(-429.56,66,390.5)`，生命 20、死亡 0。模型自己的到达描述不能代替真实位置：目标是 `(-429.5,65,390.5)`，实际到达其附近，并非逐坐标完全相等。本次未授予 OP、物资或传送，也未完成自然采集、制造、施法命中或长期殖民地经营。

同一个 bot 已接入 mc-visual-console 原资产视角：`http://127.0.0.1:28990/third/`。该端口仅本机，限时进程退出后关闭。村庄、位置、真实模组物品名与已支持的原资产图标可见；Soul Spell 专用模型仍明确标为未支持，完整人物/动画/界面一致性不作已验收声明。法术/魔力 HUD 当前未取得匹配快照时显示未同步，不能填默认值冒充。

入口为 `tools/start_neko_trial.py --config <绝对配置路径>`，密钥只从进程环境 `MAW_NEKO_CODINGPLAN_API_KEY` 传入。无需安装、启动或调用 QwenPaw；本机可选 `--credential-file` 只用其现有本地解密器读取已加密凭据，不连接其 API 或修改配置。模型模块由安装器复制到上游 `src/models/maw_codingplan.js`，profile 使用 `{ "api":"mawcp", "model":"qwen3.7-plus" }`。

本机配置和私有证据在 `E:\QiandengJiSocietyLab\integrations\neko\trial-20261008`，故障归档在 `research/neko-run-20261008`，不提交凭据或原始游戏日志。运行器有唯一进程锁、心跳、15 分钟时限与外层停止回路；本次保留同一账号/账本，累计模型调用上限经复核由 24 增至 32，没有删除旧记录或更换账号绕过未知结果。默认上限 24，配置硬上限 64；不自动重试模型异常或游戏未知写入。`stop.requested` 请求正常退出；旧锁、未完成意图和 unknown 必须先检查，不能清账本重跑。

本次暴露并修复 ESM 循环导入初始化、日志包装破坏上游动作函数身份、缺少关闭模组菜单及网页状态包含 Vec3 实例的问题。上游自动脱困曾抢断行走并挖走 1 个泥土，记录保留；最终测试禁用自主模式和导航中的挖掘/搭建，受伤即停止。前期耗尽自设测试预算是本地限额，不是 Coding Plan 套餐用尽。

本次定向回归 213 项 Node、9 项 Python 通过，Neko 上游命令/JSON 转义/身体占用/私有 WebSocket 入口检查通过；不是全部上游平台测试。原服 runId 和 Java/网关/worker PID 不变，原自主暂停、model-task 与 QwenPaw 配置/凭据文件哈希逐项未变。源码更新后重新生成安装清单，`--neko` 仍只验文件，不把限时实测冒充长期在线健康。

首次部署可复制 [trial.example.json](../world/src/neko-adapter/trial.example.json) 到自己的部署目录，核对本机 Node、模组资产及仓库绝对路径，固定玩家名和状态目录。示例复用 28990/28991/48909，须等当前测试结束或选择空闲端口；启动器不会接管已有进程。由安全终端环境提供密钥后运行：

```powershell
python tools/start_neko_trial.py --config E:\自己的部署目录\neko-trial.json
```

首次自动创建状态目录及 `model-config.json`；后续保留该文件与调用账本，不因重启自动清空或放宽限额。`status.json` 是当前快照，`trial-events.jsonl`、`command-results.jsonl`、`native-packets.jsonl`、`model-calls.jsonl` 是私有累计证据；`process-exit.json` 记录外层回收结果。完整模组菜单与模型回复可能包含游戏隐私，不能直接上传公共仓库。

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

现有 49 项原生操作中 23 项只读、26 项变更（含 menu.close）；同一本人连接注册 19 个 SDK 频道。范围包括殖民地岗位/研究/供料、女仆任务/背包、Ars 学习/编书/选槽/施法、Create 设置/过滤/流体查询、Domum 切割与 Curios 饰品。目录存在不代表任意机器、原生 GUI 或完整自主生产链都已经适配，具体限制见 [模组操作指南](MY-AGENT-WORLD-MOD-OPERATIONS.md)。

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

本次只有带守护与时限的 Neko 实机测试，尚未设为长期托管服务。现有 `http://192.168.3.163:28984` 仍显示 MawExplorer；MawNeko 使用上文 28990 同连接视角。完整动画/碰撞、复杂生产和新服基岩/公网仍按原能力清单保留未验项。
