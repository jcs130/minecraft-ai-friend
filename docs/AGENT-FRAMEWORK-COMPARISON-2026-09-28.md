# 桐人与鸣人的两套现役框架：代码与运行态对照

核对时间：2026-09-28 11:26–11:34（北京时间）。本页是一次只读审查；竞速目标尚未完成，不能据此宣称任何框架获胜。

## 对照对象与入口

| | 桐人：重栈 | 鸣人：Mindcraft |
|---|---|---|
| 现役源码 | 本仓库 `world/survival/`，生产目录读写挂载为 survivor 容器 `/survival`；另有 `world/ops`、`world/sidecar/party`、`world/numen-actuator-src` | 仓库外 `C:\Users\lzl19\Documents\mindcraft`，本机 `develop` 提交 `c67df78`；`start-naruto.cmd` 启动 `main.js` 和 `ag_naruto` 进程 |
| 大脑 | QwenPaw `qd-survivor` 原生会话，运行角色选择 `home_llm / qwen3.8-27b-fast`；本仓库 `config/model-task-routes.json` 映射用途 | `profiles/naruto.json` 选择 `qwen3.8-27b-fast`，`reasoning_effort:none`，经本机 8010 decision-proxy；不是 QwenPaw 角色会话 |
| 身体 | `NumenGateway` → Numen 原生假玩家 Kirito；原生任务、租约、精确回执和未知不重放 | Mineflayer `ag_naruto` → gate-public 25702 → 同一个 Minecraft 服务端；直接执行 `!command` / `!newAction` |
| 决策及执行节律 | `service.py` 调 `Controller.tick`；`adaptive_router`/Jev 可做局部选择，慢脑提交至持久 `motor_mailbox`，独立 `motor_loop` 持续消费，最多六个请求 | `agent.js` 约 300ms 更新 modes；`self_prompter.js` 在空闲后唤醒模型，`ActionManager` 执行指令；模型可生成 JavaScript 动作 |
| 连续性 | `controller.json`、`memory.json`、`motor-inbox.json`、原生 QwenPaw 会话和实践库；任务与身体状态分离 | Mindcraft `bots/ag_naruto` 的历史/记忆与进程监督；当前设置 `load_memory:false`、`code_timeout_mins:-1`、`max_commands:-1` |
| 直播 | 桐人 `say`/TTS、结衣派对桥、第一人称 Numen 画面、只读 live API | Mindcraft 公屏、动作叙述和渲染视角；是否真实听见语音需单独验收 |

仓库内 `world/naruto-lite/naruto_lite.cjs` 是另一份早期直驱原型。`qiandengji-naruto-lite` 计划任务已禁用，`state/status.json` 最后写入在 9 月 27 日；当前启用的是 `qiandengji-mindcraft-naruto` 计划任务及 Mindcraft 进程。旧 README 写“鸣人轻量版 A/B”只能作历史设计，不能拿它解释今天的比赛。

## 同场竞速实际证据

`world/live/race_config.json` 规定相同起点与建房武装目标；`tools/race_setup.py` 曾清空两人的物品、发相同初始套件并在公屏喊话，随后用原生 stats 建基线。2026-09-28 11:26:02 的 `runtime/eye/race/snap-20260928.jsonl` 和 `/api/live/race` 读到：

| 自基线后的代理指标 | 桐人 | 鸣人 |
|---|---:|---:|
| 移动米数 | 1045 | 107 |
| 采掘方块 | 35 | 182 |
| 合成次数 | 0 | 8 |
| 放置火把 | 0 | 24 |
| 自动检查满足数 / 12 | 1 | 4 |

两人都没有完成封闭房屋、屋内床、铁甲铁剑铁镐和箱内 16 铁锭的整体目标。12 项自动检查仅是代理：例如双方已有的铁护腿会计入满足项；房屋结构、物品是否放在自家箱中须现场核查。桐人 `control.json` 当前 `enabled:true`，控制器在所读时刻为 `waiting`，服务容器健康；这些不证明一直有动作。鸣人运行日志虽持续写入，但最新轮反复描述自己在 y≈11–13 的竖井里跳动，尚无出井证据。

## 发现与差距

1. **目标送达与公平性未封口。** 开赛脚本只用一次公屏 `say` 投递长期目标。桐人 `control.json.mission` 仍为空，当前 `memory/goals.md` 的优先事项还是补给、公会柜台和铁剑；鸣人也可能在新进程中依赖近期聊天。两人不一定以同一个持久目标运行。两端虽使用同名本地模型，思考设置、原生工具、已学能力、工作区权限与死亡恢复也不同。现有数字能说明行动分布，不能识别架构净收益。
2. **重栈连续运动有进展，但目标产出偏低。** 桐人取得较多移动，合成与摆放为零。电机信箱让身体在 Qwen 思考时继续动，但路标失败、原生任务终态、旧目标和环境权限仍能使长程目标空转；应按十分钟窗口核对有效进展，不把“容器 healthy”当自主生存验收。
3. **Mindcraft 的代码动作灵活，但当前竖井循环未脱困。** `settings.js` 允许 `!newAction`，`code_timeout_mins:-1` 使新代码没有 ActionManager 定时中断；系统依赖外部日志哨兵和进程重启。日志显示模型知道“卡住”，仍重复竖直挖跳与无安全路径的尝试。`load_memory:false` 也不适合作为跨重启长期目标保障。
4. **竞速哨兵把活跃误判成推进。** `tools/race_watchdog.py` 把桐人走路厘米数与采掘量加总，原地挖掘可以刷新“输出”信号；鸣人只要日志继续写就报告 `ok`，即使一直困在同一竖井。原提交还每轮重置 `n_sig_ts`，使“90 分钟无产出”分支无法累计到阈值；本次集成已改为仅在统计签名变化时更新该时间戳，生产计划任务是否加载新版本须另验。哨兵仍不是目标进展裁判。

## 下一轮对照应怎么做

先让双方各自的**持久目标入口**读到同一个版本化目标与验收条件，再记录其已接收回执；开赛脚本的公屏喊话可保留节目效果，但不能充当唯一任务存储。固定起点、初始装备、模型别名及思考配置，公开列出不同权限与技能。每十分钟记录动作占空、真正位移、唯一有效采掘、合成/放置、扣血死亡、模型等待与观众互动，并用世界方块和容器读取验房。卡住时按“无净位移且无目标条件增量”计时；重启后继续同一目标，不用日志新鲜度代替进展。

工程上保留重栈的任务与身体分离、准确回执和 Jev 局部纠偏；借鉴 Mindcraft 更直接的“观察→选动作→结果”调试流和实时行为日志。鸣人的动态代码适合探索复杂动作，需给每次动作有限终态和实际进展验证。重栈应优先修复“轮次很忙但没有目标产出”的判据与目标注入，而不是仅加快模型调用。
