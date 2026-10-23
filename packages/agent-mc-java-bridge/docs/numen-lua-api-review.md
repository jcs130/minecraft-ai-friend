# Numen Lua API 与真实客户端接入核查

核查日期：2026-10-14。源码基线：`Dwinovo/minecraft-numen` 的 `1.21.1` 分支，固定提交 `0bafb9349e0fe808f1a4bc7aad5bf54f0060fc90`。本机旧 Numen 副本不包含这套新 Lua 实现，本报告以新拉取的上游源码为准。

## 结论

值得借鉴的是“模型选程序，程序在本地连续做事，每步取得真实结果”的执行协议，以及可发现的游戏函数库。Lua 本身不会提供寻路、战斗或合成能力。这些能力来自 Numen 的游戏执行后端；真实 Java 客户端需要自己的实现或显式配置的 Minescript / Baritone 后端。

当前 Agent MC Java 桥已经接入可选 **Minescript 4.0 Python** 程序执行，沿用同一身体租约、队列、稳定 action ID、去重、超时、取消和真实状态证据。**当前没有安装 Lua VM，没有移植完整 Numen Lua API，也不会自动把旧 Mineflayer JavaScript 翻译为 Python/Lua。** 以下兼容方案是源码核查后的设计，不是已经可调用的承诺。

## 两层 API

底层函数由 `ApiRegistry` 登记后生成 `ScriptCatalog`，帮助、参数和返回类型来自同一目录。上层 Lua 模块调用这些函数，组合完整的小任务。

| Numen 函数组 | 作用 | 真实客户端现状与迁移边界 |
| --- | --- | --- |
| `numen.status.self/owner/world` | 身体、主人、世界状态 | 已有实际 UUID、位置、朝向、血量、饥饿、维度和库存；主人关系由宿主提供，不能猜测 |
| `numen.scan.map/blocks/entities/block/container/sight` | 地图、实体、方块、容器和视线查询 | Minescript 可读取已加载客户端方块、实体；完整扫描、可见性、分页需要独立封装，不能假定拥有服务端全图 |
| `numen.move.to/away/follow` | 寻路、撤离、跟随 | 当前有短程按键移动和 Python 程序；路径规划尚未移植。Baritone 必须显式安装、配置并验证 |
| `numen.inv.items/count/recipes/craftable/craft/eat/drop` | 库存、配方、合成、进食、丢弃 | 已有完整物品组件、库存摘要和原文查询；合成/装备等高层事务须核对服务器同步结果，不能只检查脚本退出 |
| `numen.gear.wear/hold/remove` | 装备、持物、卸装 | 已有快捷栏选择、原生菜单点击、Minescript 库存接口；高层事务需检查物品身份、光标和终态 |
| `numen.gui.view/put/take/move/quick/close` | 容器读写与菜单操作 | 已有真实菜单槽、光标、修订号、`screenToken` 和点击/关闭；精确数量搬运与异常恢复尚未封装 |
| `numen.use.block/item/entity/hit/sleep/dismount` | 使用、交互、攻击、睡眠、下坐骑 | 已有持物使用和原生 GUI；定点交互须加入距离、视线、目标身份及实际效果校验 |
| `numen.work.dig/fish` | 挖掘、钓鱼 | 客户端可以驱动实际按键；成熟采集程序、超时和方块变化/掉落结算还需实现 |
| `numen.build.blueprint/place/diff` | 蓝图、放置、差异查询 | 不能从安装 Lua 推导已支持。需独立的客户端世界查询、材料核对和放置执行后端 |
| `numen.fight.attack` | 战斗任务 | 尚未移植 Numen 战斗后端；不能把旧 Mineflayer 战斗驱动套在真实客户端上同时抢身体 |
| `numen.locate.structure/biome` | 结构与群系查找 | 涉及服务端能力/权限；客户端不默认宣称具备 |
| `numen.time.wait` | 等待 | Python 支持有界等待，桥接动作可取消；后续中立脚本接口应显式区分等待与身体任务 |
| `creative.give` | 创造权限操作 | 必须由真实权限证明，不作为通用生存能力 |

## 上层模块的实际做法

这些是源码中的算法，不是第二个模型：

- `move.explore`：短段寻路，每段重新读取实际坐标并运行检查函数；无位移报 `no_path`。
- `work.collect/mine`：读取真实掉落实体或矿簇，逐项执行、重新扫描；背包满、不可达和零进展明确失败。
- `inv.make`：查询配方和材料，选择随身 2×2 或实际工作台；返回具体材料不足，核对最终数量。
- `inv.store/fetch/smelt/give`：移动、打开容器、实际搬运/等待、读回数量，关闭界面。
- `fight.clear`：扫描敌人后逐个执行战斗任务；仅目标已不存在可以跳过，其他错误保留。
- `gui.Window`：`put/take/move/quick/close` 是底层函数的对象方法；`gui.count` 只统计当前容器侧槽位。
- `build.raise`：蓝图差异查询后逐步放置；`shape` 提供坐标、集合、盒体/线/柱/球等纯计算。
- `time.wait_until`：等待真实条件；不是提交后直接宣布成功。

适合优先复用的是这类小程序的流程和校验方式。寻路可以依赖另一个执行后端，但模型、记忆和目标仍由宿主负责。

## 语言中立的执行协议

`ScriptCatalog.Kind` 分为 `VALUE`（立即值）、`PENDING`（延迟值，不占身体任务槽）、`JOB`（身体任务，受理后等待 `task_finished`）。`ScriptRun` 提供：

1. `start()`：运行到第一次 API 调用或结束。
2. `Call(line, group, name, args, options)`：交出请求；此时不声称执行完成。
3. `resume(Result)`：拿到该调用的真实结果，从原位置继续。
4. `refuse(ApiError)`：参数/权限不满足时，不派发身体动作。
5. `Done(ok, line, error, value, failure)`：程序终态；不等于宿主目标完成。
6. `close()`：等待中、计算中均可停止，释放资源。

错误有 `kind/message/fn`，可带 `hint/data`，Lua 可用 `pcall` 按原因处理。客户端兼容层也应保留这些结构，避免只能看到一段“操作失败”。单次 RPC、任务受理、动作终态、脚本终态、真实模型回合边界必须分别表达。

建议新增可选 Lua 后端时使用独立命名空间 `mc.*`，由同一操作目录生成帮助和校验，路由到现有身体队列。每次子调用关联父程序和稳定编号；重连先对账，未知不自动重放。不能为了兼容函数名称而伪造已支持的能力。

## 沙箱与预算

上游使用 Lua 5.2 的纯 Java VM，开放基础、字符串、表、数学和登记的宿主函数；不开放 `io/os/debug/package/coroutine/luajava`、二进制块等入口。库表只读。它还限制 API 调用数、指令切片/总量、字符串分配、墙钟和输出。

固定提交中的参考值包括：200 次 API 调用、20 分钟墙钟、每片 100 万/总计 1000 万指令、64 MiB 字符串；stdout 6000 字符、stderr 每条 4000/总计 12000、返回显示 6000 字符。**这些是 Numen 的预算，不能直接作为当前客户端的实测指标。** 当前 Minescript 桥使用 100–30000 ms 动作期限和有界 JSON 输出；Python 能访问本机文件和 Java，不等同于上述 Lua 沙箱。

本次已经据此修正真实客户端回执：常用状态/背包/动作终态返回摘要，书本及完整组件保存原文，`mc_evidence` 按内容摘要和页码查询。模型需要详细物品时再使用 `mc_bag` 的组件分页。不能每次状态查询都把几十万字符送回上下文。

## 推荐落地顺序

1. 稳定当前 Minescript 生命周期和短程移动/真实菜单操作；用 Cormy 主会话验收，不用人工探针替代自主执行。
2. 统一操作目录、结构化错误及父子任务证据，先补可验证的装备、进食、容器事务。
3. 为目标移动/采集接入显式后端，验证路径终态、受保护方块拒绝、取消及断线对账。
4. 在这套协议上增加可选 Lua VM 与 `mc.*` 函数，才有可靠的旧工具兼容底座。Lua 和 Python 共享身体，不能各起一条控制循环。

Numen 源码采用 LGPL-3.0；本次仅研究与独立实现，没有把其实现复制进 MIT 核心。未来若复用 VM 或库实现，需单独处理依赖、来源和许可证保留。

## 一手来源

进一步核对的最新发行、上游修复与开发经验见 [真实客户端上游调研](client-automation-upstream-research-20261014.md)，包含 Minescript 5 / Pyjinn、匹配 1.20.6 的 Baritone、JsMacrosCE、MCPFabric 和 Lua VM 的比较。

- [ScriptCatalog](https://github.com/Dwinovo/minecraft-numen/blob/0bafb9349e0fe808f1a4bc7aad5bf54f0060fc90/agent/src/main/java/com/dwinovo/numen/api/agent/script/ScriptCatalog.java)
- [ScriptRun](https://github.com/Dwinovo/minecraft-numen/blob/0bafb9349e0fe808f1a4bc7aad5bf54f0060fc90/agent/src/main/java/com/dwinovo/numen/api/agent/script/ScriptRun.java)
- [ScriptLimits](https://github.com/Dwinovo/minecraft-numen/blob/0bafb9349e0fe808f1a4bc7aad5bf54f0060fc90/agent/src/main/java/com/dwinovo/numen/api/agent/script/ScriptLimits.java)
- [LuaSandbox](https://github.com/Dwinovo/minecraft-numen/blob/0bafb9349e0fe808f1a4bc7aad5bf54f0060fc90/lua/src/main/java/com/dwinovo/lua/LuaSandbox.java)
- [Lua 组合模块](https://github.com/Dwinovo/minecraft-numen/tree/0bafb9349e0fe808f1a4bc7aad5bf54f0060fc90/numen/common/src/main/resources/modules)
- [Minescript 4.0 API](https://github.com/maxuser0/minescript/blob/main/docs/v4.0/README.md)

