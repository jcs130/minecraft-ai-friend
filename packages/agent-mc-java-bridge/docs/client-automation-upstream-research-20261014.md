# 真实客户端与脚本执行：上游更新和开发经验

核查时间：2026-10-14 23:56（UTC+8）。范围：Minescript / Pyjinn、Numen Lua、Baritone、JsMacrosCE、MCPFabric、CC:Tweaked / Cobalt，以及 M1。使用项目源码、作者文档和官方发行元数据；搜索结果中的二手汇总不作为能力证明。本轮只做研究、文档和一个离线竞态复现，没有替换可米的模组、重载服务或新增模型循环。

## 建议

优先为当前 **Minecraft 1.20.6 / Fabric / Java 21** 身体补齐有真实终态的寻路与容器事务，并提供与已安装版本一致的函数帮助。后续将 Python、Lua、Pyjinn 做成共用操作协议的可选执行器。规划、人格、目标和长期记忆继续归宿主，语言和寻路后端都不能各自增加决策循环。

## 1. 版本核对：最新发行与当前可用分开

| 项目 | 查到的更新 | 当前实例的结论 |
| --- | --- | --- |
| Minescript | 官方 Modrinth 在 2026-09-22 发布 5.0 正式包；支持的 Fabric 包包括 1.21.8/1.21.10/1.21.11 和 26.x | 1.20.6 / Fabric 的官方匹配正式包仍是 **4.0**（2024-09-26）。5.0 不能直接换入当前实例 |
| Baritone | 官方 `v1.10.8` 明确匹配 1.20.5 / 1.20.6，含 Fabric | 值得作为当前导航的隔离候选；尚未安装或实机验收，不能用面向别的 MC 版本的最新主版本替代 |
| JsMacrosCE | 维护中的社区分支，2.0.0-beta.6 及 nightly；发布页列出 1.21.5 及之后的版本 | 不属于当前 1.20.6 的直接升级。老 JsMacros 1.9.2 与 CE 2.x 要区分 |
| MCPFabric | Modrinth 最新 0.5.1（2026-10-05）；源码支持 1.21.1+，真实客户端、截图和本地任务 | 主要学习源码结构、版本构建和任务协议；没有 1.20.6 包，本次没有迁入其额外记忆/目标层 |
| Numen | `1.21.1` 最新仍是已核查的 `0bafb9349e0fe808f1a4bc7aad5bf54f0060fc90`；补读历史找到 10 月 10–11 日的相关修复 | 已有基线包含这些修复；它们不会自动更新到我们的独立客户端 |
| M1 | 0.17.5（2026-09-18）有匹配 1.20.6 / Fabric 的包 | 可观察客户端文字界面的做法；项目声明 All Rights Reserved，未当作可复制源码或运行时依赖 |

Minescript 网站的 Pyjinn 页仍写“即将发布 5.0”，但官方发行 API 已标为 release。发行日期、loader 和 game_versions 应从发行记录核对，教程标题不能代替兼容判断。Pendulum 的搜索摘要存在，但项目入口本次无法核实，未列为可安装方案。

来源：[Minescript 官方发行列表](https://modrinth.com/mod/minescript/versions)、[对应发行 API](https://api.modrinth.com/v2/project/KcpXWngB/version)、[Baritone v1.10.8](https://github.com/cabaletta/baritone/releases/tag/v1.10.8)、[JsMacrosCE releases](https://github.com/JsMacrosCE/JsMacros/releases)、[MCPFabric](https://modrinth.com/mod/mcpfabric)、[M1](https://modrinth.com/mod/m1-machine-one-ai-interface)。本次发行元数据另存本机研究目录，不进入运行配置。

## 2. Minescript 5 / Pyjinn：值得单独适配

Pyjinn 在游戏 Java 进程内运行 Python 语法，提供异步事件循环、定时器及游戏事件。它减少外部 Python 进程这一环，适合跟游戏刻关联的短反馈程序；**具体速度提升未在我们的实例测量**。它没有完整 Python 标准库，不能把当前使用 `json/os/pathlib/dataclasses` 的包装程序改个后缀就当作已兼容。

与当前接口有关的变更包括：5.0 删除旧 Task 调度接口；外部 Python 保留 EventQueue，Pyjinn 使用另一种事件模型。适配器必须按版本和语言区分。上游历史修过 Windows Python 路径、引号/按键、killjob 不停止 Pyjinn、退出后回调仍被调用等问题；这些应成为取消与升级验收的回归场景。

5.0 的 world 监听器还允许程序跨断线继续存活；这个特性不能越过我们的停止协议。父程序取消、租约丢失或 UUID/世界变更时，必须撤销它拥有的定时器、监听器和子作业。内嵌 Java 访问也不等于沙箱。

来源：[固定源码 changelog](https://github.com/maxuser0/minescript/blob/c1229ff625b639957e1a15b6d77aa7dc4e35e3d1/CHANGELOG.md)、[Pyjinn 作者说明](https://minescript.net/pyjinn)、[当前 API 文档](https://minescript.net/docs)。

## 3. Numen 近期修复：直接转化成验收案例

| 提交与日期 | 实际修复 | 对我们的启发 |
| --- | --- | --- |
| `d46feeb7`，10-11 | Lua 方法误用点号时，报错提示需要冒号传入 self | 失败回执要给具体调用位置、参数和修正提示；常用帮助应带完整模块名和可运行例子，减少模型反复猜函数 |
| `85618886`，10-11 | `work.collect` 走向真实掉落实体，按身体与物品碰撞范围确定可拾取位置 | 不把掉落坐标取整后作为必须站到的点；区分不存在、不可达和未拾取 |
| `5c21d0b9`，10-11 | 冷却首次为 0 时不立即判断拾取失败，等待后续刻核对 | 状态转换要等待实际游戏/服务器反馈；不可用固定一次查询判断成功或失败 |
| `3205c337`，10-10 | 建造卡住判据纳入累计放置/清除进度 | 同一坐标或相同剩余数量不一定表示没有进展；判断应对应当前任务的真实效果 |

这些改动有上游单测/游戏测试源码，但本轮没有重跑 Numen 游戏测试，不能转述成我们的实机通过。

来源：[方法调用修复](https://github.com/Dwinovo/minecraft-numen/commit/d46feeb799b5129facf04fd7b6f7245667e67a0a)、[拾取目标修复](https://github.com/Dwinovo/minecraft-numen/commit/8561888657f05a81d67163bfacdabd26289fa04e)、[冷却修复](https://github.com/Dwinovo/minecraft-numen/commit/5c21d0b92e598c2cb422f9fa0c3461a32871b939)、[建造进度修复](https://github.com/Dwinovo/minecraft-numen/commit/3205c33786e2539598d8922d228608fe257940a9)。

另外，独立 `numen-mcp` 已在 2026-07-23 归档，README 说明功能从 0.0.6 起合入 numen-api。后续应参考主仓库当前接口，不能把旧独立 MCP 包视为最新安装路线。[归档说明](https://github.com/Dwinovo/numen-mcp)

## 4. Baritone：使用匹配版本的公开 API

固定 `v1.10.8` 源码确认：

- `isPathing()` 在暂停时也可返回 false；`hasPath()` 仍可能为 true。因此空闲、暂停、取消、无路和到达需分开。
- `cancelEverything()` 会撤销进程，但当前不可立即中断的移动（如跳跃）可能尚未结束。清理确认前不能释放身体槽或接纳下一动作。
- `forceCancel()` 在作者 API 中明确不建议调用，不能把它当默认停止方案。
- `allowBreak`、`allowPlace` 默认开启，且有 `allowBreakAnyway` 例外。普通走路任务需显式限制挖放；物块种类禁挖表也不能代替按坐标的领地权限。

建议通过公开目标/过程/事件接口接入同一 action ID 和租约。到达后核对真实位置与范围；采集后核对实际物品；保护拒绝作为带位置的观察交给宿主修订目标，禁止对同一失败目标无限重投。Baritone 自己的状态不能直接成为宿主目标完成证明。

来源：[匹配版本 IPathingBehavior](https://github.com/cabaletta/baritone/blob/v1.10.8/src/api/java/baritone/api/behavior/IPathingBehavior.java)、[匹配版本 Settings](https://github.com/cabaletta/baritone/blob/v1.10.8/src/api/java/baritone/api/Settings.java)。在线 Javadoc 自报另一个版本，因此实现时以已安装 JAR 对应源码为准。

## 5. JsMacrosCE：容器、状态来源与回调经验

固定源码 `1944578242dc8abf22eda9cdf31ac39fb15a41e6` 的已知问题明确指出：村民交易应从打开的交易界面读取；客户端实体上的马主人等未同步状态不能当成服务端事实。可取消的网络回调同步执行，慢回调会拖延网络处理。Lua 扩展仍未发布。

其 Inventory API 将槽位按界面映射，提供光标物品、当前 sync ID、快捷栏交换及不同容器类型。值得借鉴这些语义，但方法返回不证明服务器已接受搬运；我们的事务仍应绑定当前 screenToken、槽位/完整物品身份、光标、同步更新及最终数量。未知模组 GUI 不可一律套用原版箱子布局。

建议在游戏回调中只采集有界事件，异步交给核心；不要在网络或渲染线程等待 HTTP、模型或脚本长计算。

来源：[已知问题](https://github.com/JsMacrosCE/JsMacros/blob/1944578242dc8abf22eda9cdf31ac39fb15a41e6/KNOWN_ISSUES.md)、[Inventory API](https://jsmacrosce.com/2.0.0-beta.5/com/jsmacrosce/jsmacros/client/api/classes/inventory/Inventory.html)。后者是 beta.5 文档，不能视为后续 nightly 的全部契约。

## 6. MCPFabric：借鉴分层，保留我们的协议边界

固定源码 `f0acc37be526a7c38e52cf1337f3e60e570b4e9d` 将多版本/多 loader 的游戏访问留在 Java，较通用的任务组合放在 TypeScript。Stonecutter 构建矩阵值得参考，后续可把我们的版本专用 Minecraft 调用放进窄接口，避免复制完整核心。

源码具有单身体作业、所属会话、可取消等待和有界日志。不过本次还核查到一个清理时序问题：`JobManager` 在 `finally` 中先清除 current，再等待 onStop。离线复现证明旧清理仍等待时，第二个作业可以受理，旧清理随后能观察到新作业。**这只证明调度窗口，没有实机证明游戏动作被误停。** 不应原样移植；我们的准入应等清理与身体停止确认，迟到清理也要验证原任务/租约代次。

该项目还有自己的目标和长期记忆层；我们的宿主已负责这些能力，只参考客户端访问与执行经验。本轮没有运行第三方 Agent、接入其自动战斗或加载其管理员工具。

来源：[架构与版本构建](https://github.com/denfry/mcpfabric/blob/f0acc37be526a7c38e52cf1337f3e60e570b4e9d/README.md)、[作业源码](https://github.com/denfry/mcpfabric/blob/f0acc37be526a7c38e52cf1337f3e60e570b4e9d/mcp-server/src/agent/jobs.ts)。离线脚本与结果保存在本机 scratch 研究目录，不进入产品。

## 7. Lua VM：学习中断机制，先验证适配

Cobalt 支持在任意位置挂起、中断和恢复，CC:Tweaked 实现区分软超时、硬终止、暂停和关闭；这些适合作为 Lua 执行器的验收要求。不过 Cobalt 作者 README 明确表示它与 CC:Tweaked 同步演进、不保证 API 稳定，不建议作为普通嵌入式 Lua 的直接依赖。

因此不能仅按“更新的 VM”选型。候选必须通过：纯计算死循环、pcall 捕获普通错误后仍可终止、等待身体任务时取消、嵌套模块预算、字符串分配预算、旧监听器不复活，以及版本升级后的模块兼容。CC:Tweaked 的机器实现标有独立许可证，不复制进 MIT 核心。本次没有安装新 VM。

来源：[Cobalt README](https://github.com/cc-tweaked/Cobalt)、[CC:Tweaked CobaltLuaMachine](https://github.com/cc-tweaked/CC-Tweaked/blob/mc-1.21.x/projects/core/src/main/java/dan200/computercraft/core/lua/CobaltLuaMachine.java)。

## 8. 对本项目的具体开发顺序

| 顺序 | 下一项 | 验收方式 |
| --- | --- | --- |
| 1 | 与实际后端一致的版本化 API 帮助、完整模块调用例子、结构化错误 | 已安装版本没有的函数不广告；错误能定位并给出准确参数/提示；SDK/MCP 一致 |
| 2 | 当前 1.20.6 的可选 Baritone 导航 | 普通走路不拆墙；到达/暂停/无路/取消分别返回；断线只按原 ID 对账；清理完成才释放身体 |
| 3 | 装备、进食和容器事务 | 依据真实 GUI 映射与服务器同步，核对光标、数量和物品组件；换界面后旧 token 失效 |
| 4 | 可组合的小型采集/交互程序 | 覆盖台沿掉落、冷却过渡、受保护方块、材料不足、任务有进度但人物未移动；原始证据可查询 |
| 5 | Lua 或 Pyjinn 独立候选后端 | 共用同一身体和任务协议，取消计时器/子任务/监听器，执行预算有实测；不依赖额外宿主模型循环 |
| 6 | 多 Minecraft 版本/loader 构建矩阵 | 通用协议不复制；版本专用代码显式编译；干净构建、公开类型及 packed SDK/MCP 离线验收 |

以上是研究后建议，尚未实施的项目不能计入当前能力。此前可米的真实移动/Python/背包阶段证据见 [阶段验收](cormy-native-validation-20261014.md)，Lua 函数清单见 [API 对照](numen-lua-api-review.md)。
