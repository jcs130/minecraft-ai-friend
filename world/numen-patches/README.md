# Numen 严格步行增量

`walk-only-v1.patch` 针对本项目已经部署的本地 Numen 改版，沿用其全部身体、寻路、任务和旧功能。公开仓库仅保存补丁、输入哈希、构建器与测试；完整第三方源码和生成 JAR 位于被忽略的 `runtime/`。

构建入口：

```powershell
python tools/build_numen_walk_only.py
python -m unittest discover -s tests -p test_numen_walk_build.py
```

构建器核对原 Numen JAR、配套 actuator、C 盘源码提交与逐文件哈希、原 sources JAR，再复制源码到 D 盘独立目录应用补丁。它只编译受影响的 class family，原 JAR 的其余条目，包括嵌套 API、角色资源与已有扩展，逐项验证内容不变。不会部署、重启 Minecraft 或修改 C 盘源码。部署后再次构建需用 `--baseline-jar` 指向保留的原始 JAR，不能把已修改的 JAR 当原始输入。

## 运行合同

新 `goto` 可接收 `walk_only: true`。未指定的旧调用保留原行为。新的生存 Agent 必须先看到 `get_self_status.navigation_modes` 含 `walk_only_v1`，再固定发送此参数；旧服务器可能忽略未知 JSON 字段，因此缺少能力标志时应拒绝步行请求。

严格模式固定于每次 `MoveToTaskRecord`，初次寻路、重算、放宽目标和寻找方块的路线都通过相同 `ContextProvider`。搜索与执行的 `CalculationContext` 均禁止挖掘、放置、挖掘例外清单、垫路跑酷与水桶坠落，接受的无水落差最多 3 格。既有全局 `NavSettings` 不变。

`ExecHarness` 在实际点击前依据本身体的当前任务再次拦截左右点击，并向任务记录失败。高优先级 MLG 摔落反射的选择和执行两处也检查该模式，不能通过直接 `Interaction.useBlock/useInAir` 放水或垫块。霜行者装备可能在普通行走时冻结水面，严格步行遇到它会返回明确失败，不修改装备。模式限制 Numen 本次任务的主动方块操作；不代表禁止服务器所有模组、玩家或自然物理改变世界。

关闭的门可能使严格步行无路可走；应该让模型改选路线，不能自动回退到允许破坏的 `goto`。工作区域和村庄保护仍由调用方校验，纯走路可以通过保护区域，采矿不因此获得权限。

## 可核对的终态

`get_self_status` 另返回：

- `navigation_epoch`：本次服务器进程的 UUID。
- `last_navigation_result`：本身体最近一次 `goto` 的真实终态，或 `null`。包含 `task_id`、同一 `navigation_epoch`、`state`、`success`、`navigation_mode`、`world_interaction_blocked`、`final_x/y/z`、`ground_y`、`reason` 和 `finished_at`。

终态来自原 `TaskSlot` 已确定的 `success/failed/timeout/cancelled`。缓存最多保存 32 个身体各一条记录；服务器重启清空。消费者必须同时匹配受理回执的任务 ID 和执行前观察到的服务器 epoch，不能把空闲或旧回执作为新动作成功。

编译测试验证任务隔离、执行点击闸门、旧调用兼容、序列化、真实终态缓存与工具 schema。构建器测试验证来源校验、类族替换和其他功能条目的完整保留。真实寻路、门墙与村庄环境的行为需要部署后的独立实机证据，编译成功不等同于实机验收。
