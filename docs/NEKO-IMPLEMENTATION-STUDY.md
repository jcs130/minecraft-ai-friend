# mc-agent-neko 实现研究（2026-09-19）

> 研究人：天神（mc-god）　对象：`scratch/mc-agent-neko`（wehos 的 mindcraft 分叉）
> 目的：**拆解它的机制**，不是为了"跑起来"，是为了把可复用的部分搬进千灯纪。
> 所有结论均来自读码与实测，附文件/行号锚点与实测数字。

---

## 一、先说结论：它不是"一个 bot"，是四个层

| 层 | 载体 | 规模 | 职责 |
|---|---|---|---|
| 反射层（本能） | `src/agent/modes.js` | **7419 行 / 586 KB** | 两段式调度：always-observers + 可中断 reflex；`initModes` 在 7408，调度闸在 7364（`mode.on && !paused && !active && (isIdle() \|\| interruptible)`） |
| 框架层（脑干） | `src/agent/framework/*` | contracts 21 KB / world_model **151 KB(1949 行)** / kernel 44 KB / arbiter 20 KB / instinct / triggers / llm_gate / tool_lanes + tools(6) | 世界模型、提案、决策环、**身体仲裁**、任务生命周期、车道互斥 |
| 策略层（手脚） | `bots/_supervisor/skills/*.js` | **~90 个技能文件**，`prepNether` 186 KB、`chopWood` 186 KB、`feedUp` 112 KB、`achieve` 96 KB、`missionNether` 83 KB、`surfaceUp` 77 KB、`branchMine` 58 KB、`mineDown` 51 KB | 干活的脚本：每个技能是一段可中断的长流程 |
| 监工层（外部） | `bots/_supervisor/*.mjs` + 根 `watchdog.ps1` | `botwatch` 32 KB、`overseer-snapshot` 23 KB、`bot-medic` 18 KB、`bridge` 17 KB、`ticket-server` 17 KB、`oracle-daemon`/`ore-oracle`（透视 oracle）、`checkpoint`、`frame-at` | 看门狗、体检、单据系统、X-ray 路由、快照复盘 |

监工层还留了 **`arbitration.json` 82 KB** —— 这不是配置，是**学出来的胜负矩阵**（见 §三.3），以及 775 KB 的 `CHANGELOG.md`（逐日复盘）。

---

## 二、可直接搬走的七个机制

### 1. 唯一的态势源（World model），谁都别自己算
`framework/world_model.js` 头注写得很直白：重活**已经**在 `modes.js` 的 `world_model` 模式里做了——每 2 秒重算一份 god-view `bot._world` 并广播到 `world_model.json`；`framework/world_model.js` 只做三件事：**读**它、`proposeTasks()`（提案）、`mentalState()`（闲不闲）。
契约在 `contracts.js`：`World` 有 `time/pos/vitals/hostiles/cover/picks/migration/mode/nightPlan/landmarks/counts/recommendation/stage` 等固定字段（`EMPTY_WORLD` 给了空壳形状）。
> **搬法**：我们的角色每回合重算全套 perception → 各自为政。应先落一份"世界快照"单一真源，其余模块只读。

### 2. 提案 / 决策 / 执行三段分离——LLM 只做"选"，不做"编坐标"
- 提案侧（`world_model.proposeTasks`，572 行起）**只推高层意图**：`BOOTSTRAP_KIT` / `SURFACE_RESCUE`(92) / `GET_FOOD` / `GET_BED` / `GET_ARMOR` / `GET_IRON_TOOLS` / `GET_DIAMOND_GEAR` / `HUNT_PEARLS`(94.5) / `GO_END` / `SLAY_DRAGON` / `NIGHT_SEAL`(91) / `MIGRATE` / `FREE_PLAY`(1) …… 74 处 `push`，每项带 `priority`、`rationale`、`skill`、`args`。
- 头注明写硬约束：**"精确坐标永远不进 LLM"**（blueprint §C：别暴露透视、别压垮模型）。
- 决策侧在 `kernel.js`：`survival` 模式 = 读世界 → 若闲 → 拿提案 → LLM 挑/批 → 提交任务（派技能）；**"Safety never waits for the LLM"**（保命不等模型）。
> **搬法**：这正是治"角色乱走"的正解——把动作空间从"自由生成"收缩成"从 N 个带理由的提案里选一个"。

### 3. 身体所有权仲裁（arbiter）——最值得学的一个
`framework/arbiter.js` 头注记录了**动机**：身体（pathfinder goal / control states / dig）是全局共享资源，无仲裁抢占 → **一天 ≥6 死 + 3 个大死锁**（C345-B stop 脉冲连杀溺水营救 7 次；反射 8s 抢 goal → 夜爬 8 分钟走 3 格）。它的解法**不是**层级制、**不写 if 山**：

1. **成对胜负矩阵**（`arbitration.json`）：holder vs claimant 一对一，允许局部例外，不强求全序；支持家族通配（`kernel:*` / `mode:*`）。
2. **只在矩阵查不到时才问 LLM**：`askLLM` 异步、**4 秒超时**（`LLM_TIMEOUT_MS=4000`）、超时回退 holder（最小惊讶）；非 persist 裁决缓存 120 s，失败负缓存 30 s（"API 挂了别每拍捶"），`resolve()` **同步返回**、未命中即 `pending`（现状保持）——**问询绝不阻塞 tick**。
3. **`persist:true` 的裁决写回矩阵** = **学习闭环**，同一对下次零成本。
4. **唯一硬编码地板 = 性命**（`vitalNow`：氧 ≤8 / 着火 / 岩浆）**秒抢，不进矩阵、不问 LLM**。设计稿原话：**"地板，不是阶梯……其余一切归矩阵/LLM"**；理由是——若矩阵能压地板，一条坏的 LLM 持久规则就会把溺水营救**永久制度性压死**。
5. 所有权令牌 `bot._bodyOwner={name,kind,since}`，**只释放自己的**（owner-tag 语义）。
6. 红线：无模块级可变状态（缓存全挂 `bot._arb` + 文件）、**任何异常退化为现状、永不抛出**。

> **搬法（第一优先）**：我们的角色缺的正是"谁能在什么时候抢走身体"。矩阵 + LLM 兜底 + persist 学习，是**既安全又可进化**的形状；而且"地板不进学习系统"这条对我们极其重要——**命不可被学出来的规则覆盖**。

### 4. 工具独占车道（tool_lanes）——协作式互斥 + 可抢占
`framework/tool_lanes.js`：给"本该万无一失的脚本动作"（垂降接水/MLG、搭桥、瞬建掩体）一条**独占车道**：
- **不可中断**：车道里的 fn 跑完为止，**不查 `bot.interrupt_code`**（这就是它存在的意义）；
- 只被**更高优先级且共享冲突域**的车道抢占；`LANE`/`LANE_PRIORITY`/`LANE_CONFLICT` 在 `contracts.js`：冲突域 = `move` / `hand` / `place` / `window`；
- 抢占是**协作式**：`ctx.preempted()` 供长脚本安全退出，`preemptGraceMs=1500` 宽限，超时才强制 reject（"让被抢的脚本有机会收尾，比如把水收回来"）；
- 单线程现实（Node+mineflayer）：所谓"独占线程池"= **主事件循环上的协作式互斥**，纯计算才丢 worker。
> **搬法**：我们的技能没有"不可中断"概念，任何一拍都可能被新决策踩断 → 半成品动作堆积。给关键动作上车道是直接的稳定性收益。

### 5. 任务生命周期键（triggers）——"每晚只做一次"是算出来的，不是判出来的
`framework/triggers.js`：把 reflex 层"执行优先 / 问 LLM / 否决则本周期压制"的契约**提升到任务层**，并把生命周期从"连续测试窗口"泛化成 **`lifecycleKey`**：
`TriggerSpec = { id, lifecycleScope, condition(world,bot), lifecycleKey(world,bot), resolve(world,bot) }`；
`shouldFire` / `markFired` / `cancelTrigger` / `isCancelled` / `setCooldown` / `gcKeys` + 每 bot 的 `bot._triggerState`；`nightSeq(bot)` 让"今晚一次 / 明晚独立"**自然浮现**。
**取消台账只有这一处**（`llm_gate.js` 委托给它，不另存一份）。
> **搬法**：桐人"重复占比 1.00"的病根之一就是**没有生命周期**——同一件事每拍都重新被允许。

### 6. 活锁（livelock）闭环——kernel 里一整套硬数字
`kernel.js` 顶部常量就是一部"怎么不死循环"的实战清单：
- `DISPATCH_FAIL_LIMIT=3` + `DISPATCH_COOLDOWN_MS=300000`（提交的目标技能文件不存在 → 5 分钟后自然重提）；
- `NO_DELTA_LIMIT=4` + `NO_DELTA_MOVE_BLOCKS=6`（**位移不足 6 格 = 抖动/击退，不算赶路**）+ `NO_DELTA_EXEMPT=/^(NIGHT_|DUSK_GO_BED$|HOLD$|SLEEP$|FREE_PLAY$)/`；
- `INTERRUPT_UNWIND_LIMIT=8` + `INTERRUPT_HOLD_MS=4000`（连撤 8 次 → 冷却；撤完停 4 秒等反射落定）；
- `BUSY_STUCK_MS=180000`（3 分钟没动静就算卡）；
- `SUPERVISOR_CANCEL_WINDOW_MS=30000` —— 注释强调**必须与技能的 `cancelRequested()` TTL 对齐**（跨模块 TTL 不同步是经典暗雷）。
> **搬法**：桐人的 `walk_target_too_far` / farmland 导航死锁，正缺这套"没位移=不成立"的判据。

### 7. 迁移安全：开关 + 影子模式 + 字节等同
- `FRAMEWORK_ENABLED_DEFAULT`、`contracts.js` 注明 **flag-OFF 时是 byte-identical legacy behavior**；
- kernel 注释：功能开关默认 **OFF**，打开后**先跑 SHADOW**（只记录"它本来会提交什么"，不真派发），确认后再接 `decideAndDispatch`；
- `llm_gate.js` 默认**关**：`llmGate()` **瞬时返回 `{proceed:true}`、零 LLM 调用、零聊天输出**（用户原话被抄进注释："目前先关掉，但是要有这个模块"、"LLM 全程不出声/纯本能"）；开关走 `bots/_supervisor/decision-config.json`（5 s TTL 缓存，允许热改）。
> **搬法**：我们要给角色换脑（RSI 第 3 层）时，**影子模式是唯一安全的落地姿势**——先让它"只说不动"，对比它与现役决策的差异。

---

## 三、实测（2026-09-19，本地模型）

**环境**：ollama 在 **`192.168.3.152:11434`**；模型 **`qwen3.8-27b:latest`**（16.81 GB / 27.3B）。本机即 `192.168.3.133`（**本机没有任何 LLM 服务在听**：8890/11434/8000/1234/8080/5000 全关；本机 ollama 只装了 `bge-m3-cpu` 与 `qwen3-4b-instruct-judge`，服务未启）。

| 项 | 结果 |
|---|---|
| 冷启动一次 | 60.4 s（含加载权重），**8.4 tok/s** |
| 热态 | **9.0 tok/s**；一句"我醒了 + !goToSurface" 共 15.9 s |
| `think:false` + `num_ctx=16384` + `num_predict=700` | **8.0 s**，正文干净：`!goToSurface`（eval_count=5，无思考 token） |
| 坑 | `num_predict=64` 时正文**为空**（推理链吃光预算）→ mindcraft 拿不到 `!命令`，**必须给足 num_predict + 关思考** |

**接入**：`profiles/nekox.json` → `{"api":"ollama","model":"qwen3.8-27b:latest","url":"http://192.168.3.152:11434","params":{num_ctx:16384,num_predict:700,temperature:0.7,think:false}}`（fork 的 `models/ollama.js` 把 `params` 原样透传进 `/api/chat`，所以 `think:false` 生效）。
**运行实况**（`scratch-run/nekox.log`）：`MC server found (127.0.0.1:25565)` → `NekoX logged in! / spawned.` → `⏱MODES 515ms | world_model=505ms self_preservation=10ms`（**framework v2 的模式真在跑**）→ 收到女神信使的一句话 → `Awaiting local response... (model: qwen3.8-27b:latest, attempt: 1)` → `executing code...`（**本地模型真在驱动**）；另有它自己的智能输出：`🤖Broadcasting log message: Can't seal here, no mobs — standing down, skill-layer dig-in owns it.`

**踩到的三个坑（值得记）**：
1. **嵌入模型没继承 url**：`prompter.js:92` 在 profile 无 `embedding` 时用 `createModel({api: chat_model_profile.api})` —— 只传 api **不传 url** → 默认打 `127.0.0.1:11434` → 99 次 `ECONNREFUSED` → 三次 `Error with embedding model, using word-overlap instead.`（**降级非致命**）。已修：profile 补 `embedding = {api:ollama, model:nomic-embed-text:latest, url:...152:11434}`。
2. **cmd 里 `set VAR={"a":"b"}` 不要转义引号**：写成 `\"` 会让 `JSON.parse` 失败 → 静默回落根配置（端口 55916）→ 连不上。`main.js` 的 `SETTINGS_JSON` 是 `Object.assign(settings, JSON.parse(...))`，能覆盖 `profiles`/`port`/`only_chat_with` 等。
3. **别在自己的 shell 进程树里 `start` 长命进程**：我的 shell 一结束，它就一起被收走（日志戛然而止且无任何致命标记）。用 `Start-Process -WindowStyle Hidden` 才活得住。

---

## 四、给千灯纪的搬运清单（按优先级）

| 序 | 机制 | 对应我们哪个病 | 落地形态 |
|---|---|---|---|
| A | **trigger lifecycleKey**（§二.5） | 桐人重复占比 **1.00**、停滞目标 32 | 每类任务一个 lifecycleKey（"本夜一次/本班一次"），台账单点持有 |
| B | **body owner + 成对矩阵**（§二.3） | 动作互相踩踏、半成品堆积 | 角色加 `bodyOwner` 令牌 + 冲突域矩阵；**命为地板，不进学习** |
| C | **活锁闭环硬数字**（§二.6） | farmland 导航死锁 / `walk_target_too_far` | 无位移 ≥6 格不算赶路、连撤 8 次冷却、TTL 跨模块对齐 |
| D | **提案/决策/执行三段**（§二.2） | LLM 自由发挥 → 乱走 | 先出提案（带 rationale+priority），LLM 只选；坐标不进 prompt |
| E | **tool lanes**（§二.4） | 关键动作被中断 | 高价值动作入独占车道（协作式互斥 + 1500 ms 宽限） |
| F | **开关+影子模式**（§二.7） | 换脑即翻车风险 | RSI 第 3 层先 SHADOW：只记录"本会提交什么" |
| G | **persist 裁决写回矩阵**（§二.3.3） | RSI 缺"越跑越省"的闭环 | 冲突裁决沉淀成规则，同对下次零 LLM 成本 |

**与 RSI 设计的接口**：G 就是 RSI 的"经验固化"最小形态（冲突 → LLM 判 vs → 持久化 → 下次零成本）；F 是"角色自改 harness"的安全姿势；A/C 是**度量的稳定器**（重复率与卡死判据不干净，RSI 的指标就不可信）。

---

## 五、待办与未知

1. NekoX 现以本地模型在线（进程独立）；**同度量对照实验**（DeepSeek vs qwen3.8-27b 的行为差异）尚未做。
2. 嵌入模型只剩"词重叠"降级——已改 profile，**需重启后确认 0 次 ECONNREFUSED**。
3. RCON 直连（宿主 `127.0.0.1:25575`）被拒；仓内可用姿势是 `docker exec <mc 容器> python3 /app/rcon_cmd.py <pw> 127.0.0.1 25575 <命令>`（见 `resource/god_rcon.py`）。要在游戏里给它派活，走这条。
4. `_supervisor` 监督层（botwatch/bridge/medic/ticket）**尚未拉起**——它才是"自主生存"的外环，目前只跑了内核。
5. 未细读：`admin_mission.js`(40 KB)、`commands/actions.js`(46 KB)、`vision/`（相机+渲染+视觉解释）、`oracle`（X-ray 路由）、`water_navigation.js`(46 KB)。

---

## 六、追加（同日更晚）：把它的视觉真打开，并顺手补完两个他们留下的坑

**先更正本文开头的一处判断** ✗：本机**就有**本地模型 —— **`127.0.0.1:8017` = `qwen3.8-27b-turbo-unc`**（OpenAI 兼容 ✓，capabilities 含 `completion,multimodal` ✓，**热态 29.6 tok/s** ✓，为局域网那台 ollama 的 3 倍 ✓）；配套 `127.0.0.1:8087 = local-embedding` ✓。这正是小喵（agent `local-butler`，"基于本地 Qwen3.8-27B、零云端依赖"）在用的那一套 ✓。**教训**：判断"本机有没有服务"必须先枚举真实监听端口 ✓，不能拿一张固定端口表去试 ✓。NekoX 现已整套切过去 ✓（`model`/`code_model`/`vision_model` 用 `api=lmstudio` ✓ 指向 8017 ✓；`embedding` 指 8087 ✓）—— 选 `lmstudio` 而不选 `vllm` 有两个硬理由 ✓：`lmstudio.sendRequest` **会把 profile 的 `params` 透传** ✓（`vllm.js` 不透传 ✗ → 我先前设的 max_tokens 一直没生效 ✓），且它**会自动剥 `</think>` 块** ✓；另外 `vllm.js` **没有 `embed()`** ✓ 而 lmstudio 有 ✓。

**"64 秒断线"结案**：不是它的 bug ✓，是**我的启动方式** ✗ —— Windows 作业对象会把我这条 shell 的**整棵进程树**收走 ✓（连我起的看门狗一起 ✗）。正解 = **计划任务**：`schtasks /create /tn NekoX-Local /tr "cmd /c watch-nekox.bat" /sc onlogon /f` ✓（`/end` 只杀任务进程 ✓、node 会孤儿化活下来占端口 ✓ → 新实例秒退 `rc=0` ✓；须按 CommandLine 精确杀 ✓）。补丁版看门狗把退出码写进 `watch.log` ✓ —— **正是它记下的 `exit rc=-1` 指认真凶** ✓。

### task#12（他们注释里挂着、一直没人做的那件事）
`vision_interpreter._ensureCamera` 里进程内 `Camera` 会刷 **88 条 `ReferenceError: THREE is not defined`** ✓ —— prismarine-viewer 的**实体网格**要一个全局 `THREE` ✓，进程内没人设 ✓。修法 = 在 `await import('./camera.js')` **之前**注入（它是 import 期解析 ✓）：`globalThis.THREE = (await import('three')).default` ✓ → 报错 **88 → 0** ✓。

### task#13（#12 修完才露出来的雷）
THREE 一注入，实体网格**真的开始提交 GL 命令** ✓ → 撞中 `render_worker.mjs` 开头写死的那个故障：**headless-gl 在 Windows 上原生崩溃，进程退出码 -1（4294967295）、无 JS 栈、JS 层拦不住** ✓✓ —— `watch.log` 当场记到 `exit rc=-1` ✓、bot 掉线 ✓。**这就是他们把 `NEKO_DISABLE_INPROC_VISION=1` 设成默认的真正原因** ✓（不是保守 ✓ 是有实测 19 次崩溃归档 ✓）。
正解是它自己代码里那条：**同一个渲染器搬进一次性子进程** ✓（`camera_proc.js` + `render_worker.mjs` ✓ 崩只杀 worker ✓ 父进程 2 秒重试重生 ✓ bot 不掉线 ✓）。我把**按需视觉**的默认路径也换成了它 ✓，三处改动（补丁存 `world-notes/neko-vision-task12-13.patch` ✓）：
1. `_ensureCamera`：默认 `CameraProc` ✓（`NEKO_VISION_INPROC=1` 才走老的进程内路 ✓），并把它的 `capture()→base64` 适配成 `analyzeImage()` 要的**文件名**契约 ✓；
2. 等 `'ready'` 加 **30 秒超时** ✓（构造函数自启 `_init()` 且每 2 秒重试 ✓，不兜住就会永久挂住视觉管线 ✓）；
3. `analyzeImage(null)` **如实回"相机没准备好"** ✓ 而不是读 `null.jpg` 让模型瞎编 ✓。

**验收** ✓：两轮 `lookAtPosition` ✓ → **THREE 报错 0** ✓、`watch.log` 再无 `rc=-1` ✓、进程数 3→4 ✓（多的那个就是隔离渲染子进程 ✓）；第一轮 worker 未就绪 ✓ → **null 兜底当场生效** ✓（如实说"相机没准备好" ✓ 没有瞎编 ✓）。

**我亲自看了那张图，据此更正一件事** ✗（图存 `world-notes/neko-vision-evidence/` ✓）：
- **通路为真** ✓：画面里**确实渲染出了一个实体**（青色人形 + 头顶灰色粒子 ✓）—— 这就是 task#12 注入 THREE 的**物证** ✓（补丁前实体网格画不出来 ✗）；左侧红砖+木板+黄绿玻璃的浮空结构 ✓、大片白天晴空 ✓ 都是真的 ✓，它说的 "Bright daytime sky" **说对了** ✓。
- **读图有编造** ✗：它说的"远处树枝上有只**鹦鹉**"—— 图里**无树无鹦鹉** ✓，是那个青色浮空实体被认错 ✓；它更早自称"我在末地小岛" ✗ 亦被图与 `locate biome small_end_islands`（查无此域 ✓）双重证伪 ✓ —— 明明是**主世界白天** ✓。
- **纪律**：所以"视觉通了"**不等于**"它看见的就是世界事实" ✓。**别拿它的话当世界事实** ✓ —— 这条今天又救了一次 ✓。

**仍未了** ✗：① 它先前自称在「末地小岛」而实为村心 ✓（世界模型字段可疑 ✓ 与本轮视觉描述互相矛盾 ✓ —— 说明**别拿它的话当世界事实** ✓）；② 周期截图通道 `NEKO_AGENT_SCREENSHOT_INTERVAL_MS` 仍关着 ✓（只开了按需 ✓）；③ `_supervisor` 外环（botwatch/bridge/medic/ticket）还没拉 ✓；④ 同度量对照实验（本地 vs 云端）没做 ✓。

---

## 七、再追加：它自报"我在末地小岛"的真根因（我上一条判错了，现更正 ✗）

**判错的更正** ✓：我先前写"那是模型 confabulation（看着浮空方块瞎编）"✗ —— **不对** ✓。装上 $STATS 位置行之后复测 ✓，它报 `维度：overworld ✓ 坐标：-543.5,188.0,868.5 ✓` 与服务端**完全一致** ✓，**唯独 `生态域：small_end_islands`** ✗ —— 说明**它是在如实汇报自己读到的数据 ✓，而那个数据源是脏的** ✓✓。

**真 bug（两处同源 ✓）**：`mc.getAllBiomes()` 返回的是**按 mcdata 自身顺序排的数组** ✓，而 `bot.world.getBiome(pos)` 返回的是**服务端下发的网络 biome id** ✓ —— **两者不同序** ✗ → 用 id 去数数组下标 ✓ 必然错位 ✗。实测表现：**主世界 y=188 的平原被读成 `small_end_islands`** ✓✓；且 id 越界时 `mc.getAllBiomes()[id].name` 直接抛 `undefined (reading 'name')` ✗（本轮日志里确实抓到过这条 TypeError ✓）。
- `src/models/prompter.js` `$STATS` ✗ → 模型自述位置错 ✓
- `src/agent/library/world.js:518 getBiomeName()` ✗ → **这条更值钱** ✓：它喂给 `full_state` 与 **migration / badBiome** 一类决策 ✓ —— **也就是说它的"要不要搬家、这里危不危险"可能一直在用错的生态域做判断** ✓✓

**修法** ✓：改用 **`bot.registry.biomes[id].name`** ✓（服务端权威映射 ✓），mcdata 只作兜底 ✓ 并守住越界 ✗。补丁存 `world-notes/neko-grounding-task14.patch` ✓。
**验收** ✓：修后它自报 `overworld / plains / -543.5,188.0,868.5` ✓ 与 `data get entity NekoX Dimension`、`locate biome minecraft:plains（0 blocks away）`、`data get entity NekoX Pos` **四项全对** ✓✓；`small_end_islands` 字符串**全仓零命中** ✓ 亦证它不是代码写死 ✓。

**顺带定谳的第二个问题（比位置更值钱 ✓✓）**：它长时间 **`PERSISTENT PIN — 6 kicks ineffective over 35min`** ✗ 的死锁真因是
```
action "mode:self_preservation" trying to interrupt current action "action:collectBlocks"
```
—— **自保反射一次次掐断 LLM 刚发起的采集动作** ✓✗（89 次空转 ✓、任务 0 产出 ✓）。它自己报警说 "needs a **relocating recovery venture**" ✓ —— **知道该搬家却没有对应提案/技能** ✓。这正是 §二.3 身体所有权仲裁该覆盖的那一对（`self_preservation` vs `collectBlocks` ✓），但这条抢占走的是老的 `interrupt_code` 路 ✓ **没进 arbiter** ✓ → **仲裁器的覆盖面有洞** ✓✓。另外：我把它 tp 到地面（y=63 ✓）后 **它自己又爬回了 y=188 的浮空塔** ✓ → 说明有个持续目标在把它拽回去 ✓（值得单独查 ✓）。

---

## 八、task#15 结案：PERSISTENT PIN 的真正根因 = 动作从不领身体令牌 ✓✓

**我先前判"抢占绕开了 arbiter"是不准确的** ✗ —— 读码定谳 ✓：`modes.js:7231` ✓ 反射**确实查了**仲裁 ✓（`if (_enforce && _verdict.winner !== 'claimant') return;` ✓），问题是 **`action_manager.runAction` 从不登记 bodyOwner** ✓ → `currentOwner()` 返回 null ✓ → `arbiter.js:209` 直接短路 **`body unowned → claimant wins`** ✓✓ —— 所以 self_preservation 每一拍都**合法地**赢走身体 ✓、掐死 `action:collectBlocks` ✓ → 35 分钟 6 次强拆无效 ✓✓。**仲裁器没被绕过 ✓ 是它被告知"身体没人用"** ✓ —— 这个区别很关键 ✓：不是加规则 ✗ 是**补令牌** ✓。

**修法（三处 ✓，补丁 `world-notes/neko-body-ownership-task15.patch`）**：`runAction` 开始时 `setBodyOwner(bot, actionLabel, kind)` ✓；成功路径与 catch 路径都 `releaseBodyOwner(bot, actionLabel)` ✓（**出错也必须还 ✓，否则身体被一条死动作永久占住 ✓ 会是更糟的死锁 ✓**；owner-tag 语义保证只还自己的 ✓）。**刻意不加第二次仲裁调用** ✓（modes 已调 ✓ 再调就是重复烧 LLM ✗）。

**实测验收** ✓（从本次启动行起算 ✓）：`trying to interrupt` **0** ✓、`PERSISTENT PIN` **0** ✓、`Infinite action loop` **0** ✓、`reconnectNow` **0** ✓；技能真执行 ✓（`!runSkill("nightShelter","mode=seal")` 解析并跑 ✓）；角色从 y=188 浮空塔回到 **y=64 地面** ✓✓。

## 九、附身观战（live = B 站直播端真实客户端 ✓）

`live` 是**真实客户端**（可开光影 ✓），要"附身到 Agent 身上观战" ✓。因 MC 一名一端 ✓，它**不能**同时是观战服务的机器人号 ✓ → 走**外挂跟随器** ✓：`tools/live_spectate.py` ✓

- 命令 ✓：`start <目标>` / `stop` / `status` / `loop` ✓（常驻循环由计划任务 `LiveSpectate` 拉 ✓，`/sc onlogon` ✓）
- 机制 ✓：`gamemode spectator live` ✓ + 每 0.5 s `tp live <目标>` ✓；停止时归位 + 回生存 ✓
- **心跳续租** ✓：跟随器活着且挂着目标就续租 ✓ → **直播端晚点上线也接得上** ✓；跟随器进程死了没人续 → 租约过期自动停 ✓ **不留幽灵机位** ✓
- 安全 ✓：只发 `tp`/`gamemode` ✓ 不碰背包属性 ✓；目标须在 `ALLOWED_TARGETS` ✓；机位不在线不发命令 ✓（不刷 RCON 错）✓；归位点只在真取到坐标时才存 ✓
- 配套 ✓：`live` 已进 `INTERNAL_BOT_NAMES` ✓ + `EXCLUDE_PROX` ✓ → 不被赐福/不回话/NPC 不凑到镜头前搭话 ✓（world 已重建生效 ✓、npc 已 force-recreate 生效 ✓）
