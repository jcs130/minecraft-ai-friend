# 复用 MC 核心脚本

完整 ZIP 已带 `agent-mc-world 0.5.7-rc.130` 无画面运行包，包含寻路、背包、交互、采集、建造等核心实现。锁定依赖安装后，本地 MCP 会使用这些实现，不需另找服务器脚本或再启动一个 bot。

## 先查目录，再看一个脚本

不连接游戏也可查询包内的真实脚本目录与参数：

```sh
node scripts/core.mjs list
node scripts/core.mjs read navigate_route
node scripts/core.mjs check navigate_route --params-file /私有目录/route.json
```

`read` 默认不输出源码；确需研究实现可加 `--source`。`check` 只验证参数结构，不证明现场可通行、已授权或任务已完成。这些查询不登录、不移动、不调用模型。

连上原 MCP 后也可 `mc_script {"routine":{"op":"list"}}`，再 `{"routine":{"op":"read","id":"所选ID"}}`。以运行中的实际目录为准。执行通过**同一身体**的 `mc_script`，保留 action ID；不是运行另一个独立脚本去接管同名角色。

| 要做的事 | 按需读取的原核心资料 |
| --- | --- |
| 多路点行走、短程游泳、分段飞行 | [移动例程](mc-core/docs/movement-routines.md) |
| 水下绕障、载具、穿门、鞘翅 | [进阶移动](mc-core/docs/advanced-mobility.md) |
| 收割补种、指定原木、存多余物资、补给 | [工作例程](mc-core/docs/work-routines.md) |
| 背包操作的确认与结果未知 | [库存同步](mc-core/docs/inventory-synchronization.md) |
| 观察与空间坐标 | [感知](mc-core/skills/minecraft-agent/references/perception.md)、[空间](mc-core/skills/minecraft-agent/references/spatial.md) |
| 有多个方案时选择 | [聚焦选择](mc-core/skills/minecraft-agent/references/choices.md) |
| 建筑工作方法 | [建造](mc-core/skills/minecraft-agent/references/building-methods.md) |
| 取消、接续和协议屏障 | [协议](mc-core/docs/protocol-v1.md)、[身体限制](mc-core/docs/body-restrictions.md) |

坐标、箱子、种类、数量和路径必须来自当前已观察现场，不能照搬文档示例。飞行例程不授予飞行权限；服务端技能要先查 `/mycli` 的学习资格、消耗与冷却。通用核心资料不替代千灯纪的任务规则。

一次提交一个有边界的工作，等最终回执，核对净变化与剩余项。中断、断线、库存不确定时先查原动作，不自动重复赠物、取放或施法。更多玩法与故事在游戏里学习。
