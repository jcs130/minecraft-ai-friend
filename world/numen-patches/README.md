# Numen 严格步行增量

`walk-only-v1.patch` 针对本项目已经部署的本地 Numen 改版，沿用其全部身体、寻路、任务和旧功能。补丁文件名保留兼容，当前构建产物为 `walk-only-v2.jar`，新增严格到达能力。公开仓库仅保存补丁、输入哈希、构建器与测试；完整第三方源码和生成 JAR 位于被忽略的 `runtime/`。

构建入口：

```powershell
python tools/build_numen_walk_only.py
python -m unittest discover -s tests -p test_numen_walk_build.py
```

构建器核对原 Numen JAR、配套 actuator、C 盘源码提交与逐文件哈希、原 sources JAR，再复制源码到 D 盘独立目录应用补丁。它只编译受影响的 class family，原 JAR 的其余条目，包括嵌套 API、角色资源与已有扩展，逐项验证内容不变。不会部署、重启 Minecraft 或修改 C 盘源码。部署后再次构建需用 `--baseline-jar` 指向保留的原始 JAR，不能把已修改的 JAR 当原始输入。

## 运行合同

新 `goto` 可接收 `walk_only: true`。未指定的旧调用保留原行为。新的生存 Agent 必须先看到 `get_self_status.navigation_modes` 含 `walk_only_strict_arrival_v2`，再固定发送此参数。服务器同时保留 `walk_only_v1` 标记。只有旧标记的版本可能在错误高度或水中提前成功，不能用于本生存 Agent 的新导航合同。

严格模式固定于每次 `MoveToTaskRecord`，初次寻路、重算和寻找方块的路线都通过相同 `ContextProvider`。搜索与执行的 `CalculationContext` 均禁止挖掘、放置、挖掘例外清单、垫路跑酷与水桶坠落，接受的无水落差最多 3 格。既有全局 `NavSettings` 不变。

`ExecHarness` 在实际点击前依据本身体的当前任务再次拦截左右点击，并向任务记录失败。高优先级 MLG 摔落反射的选择和执行两处也检查该模式，不能通过直接 `Interaction.useBlock/useInAir` 放水或垫块。霜行者装备可能在普通行走时冻结水面，严格步行遇到它会返回明确失败，不修改装备。模式限制 Numen 本次任务的主动方块操作；不代表禁止服务器所有模组、玩家或自然物理改变世界。

关闭的门可能使严格步行无路可走；应该让模型改选路线，不能自动回退到允许破坏的 `goto`。工作区域和村庄保护仍由调用方校验，纯走路可以通过保护区域，采矿不因此获得权限。

## 高度和落脚

仅对 `walk_only:true` 的坐标导航增加以下到达要求：

- `x+y+z`（BLOCK）：必须匹配指定的三维脚位。实际小数高度通过原生 `BlockHelper.playerFeet` 转为寻路脚格，因此半砖、农田等不要求角色实际 Y 是整数。失败后不能再按水平距离小于三格宣告成功。
- `x+z`（COLUMN）：仍可作为水平路标，但到点时必须干燥、有实际鞋底支撑；水面、水底和空中不算安全到达。它不证明已到高处 NPC 柜台，交付仍检查当前三维距离。

支撑来自角色实际包围盒鞋底的薄碰撞探针，能识别半砖等局部碰撞形状；`onGround` 不能单独充当证据。原版静止身体会保留约 `-0.0784` 的重力速度，此值不被误判为下落。坐标和干燥支撑必须连续三个不同游戏 tick 成立，同一 tick 重复检查不增加计数。跳跃到点后最多等待二十 tick 落稳；水中终点明确失败。

这些条件只约束坐标任务的终点，不禁止途中入水或从水底游向陆地；原游泳输入与路线计算未改。`walk_only:false` 以及原有 FIND/YLEVEL 的到达行为保持原样。

## 可核对的终态

`get_self_status` 另返回：

- `navigation_epoch`：本次服务器进程的 UUID。
- `last_navigation_result`：本身体最近一次 `goto` 的真实终态，或 `null`。包含 `task_id`、同一 `navigation_epoch`、`state`、`success`、`navigation_mode`、`world_interaction_blocked`、`final_x/y/z`、`ground_y`、`reason` 和 `finished_at`。

严格坐标任务另带 `arrival_mode`（`block_3d` / `column_supported`）、`on_ground`、`in_water`、`dry_supported`，带 Y 时还包含 `requested_y`。`navigation_mode` 保持 `walk_only_v1` 以兼容回执解析。历史字段 `ground_y` 实际只是 `floor(actualY)`，不是测得的支撑块高度，不能拿它证明站在实体地面。

终态来自原 `TaskSlot` 已确定的 `success/failed/timeout/cancelled`。缓存最多保存 32 个身体各一条记录；服务器重启清空。消费者必须同时匹配受理回执的任务 ID 和执行前观察到的服务器 epoch，不能把空闲或旧回执作为新动作成功。

编译测试验证任务隔离、执行点击闸门、旧调用兼容、序列化、真实终态缓存、XYZ 高度匹配、水中/空中拒绝、连续 tick 稳定和半砖/农田鞋底探针。构建器测试验证来源校验、类族替换和其他功能条目的完整保留。真实寻路、门墙与村庄环境的行为需要部署后的独立实机证据，编译成功不等同于实机验收。

## 原身体重连增量

`python tools/build_numen_body_restore.py` 在已验证的严格步行产物上仅替换 core 入口类并新增 `ExistingBodyRestore`。`restore-existing-v1.json` 固定输入 JAR、actuator、入口源码和新增源码哈希；其余 class、嵌套 API、资源逐项校验不变。生成文件和构建记录位于被忽略的 `runtime/numen-body-restore-build/`，不自动部署。

仅服务端控制台/RCON 的四级命令 `numen_restore_existing <bodyUUID> <ownerUUID> <name>` 恢复注册表中已有身体。先检查 UUID/name/owner、存档存在和可读、存档 UUID/NumenOwner/维度/存活生存状态、物品槽位及当前注册表可解码的 ItemStack；原生有未完任务时拒绝自动恢复。缺档、死亡或身份不符均明确拒绝，绝不调用 summon、新建 UUID、改物资、替换皮肤或指定传送位置。通过后仅复用原 `Companions.respawn` 与原 `.dat` 加载流程。

回执前缀 `QD_NUMEN_RESTORE_JSON `，能力 `existing_body_restore_v1`，包含同一 bodyUuid/ownerUuid/bodyName、ok、code、phase（restored/observed/rejected/unknown）。原生每身体 60 秒冷却，最多跟踪 64 个身份。成功说明原身份已上线；所有模组物品 components、等级和模型最终是否保持仍需部署后用真实存档与上线状态比对，编译测试不能代替实机验收。

survivor 的 `body_reconnect.py` 只在 enabled、无活动决策、无未确认动作或开放租约时工作。感知失败先读原生在线名单，明确缺席后才预留一次恢复；名单读取失败是退避，不是身体不存在。每天最多 3 次原生恢复尝试。请求结果未知或进程中断于预留后，只能通过后续名单确认原身份在线，不能再次重放。状态持久在 `body-reconnect.json`，管理摘要为 `bodyReconnect`；blocked/unknown 需要核查具体原因，不自动清状态。恢复不修改任何模型、预算、目标或程序状态，下一观察周期继续原调度。

部署前先保留停止后的完整存档备份，再使用 `python tools/deploy_numen_body_restore.py --record runtime/numen-body-restore-build/<build>/build-record.json` 检查；追加 `--apply qiandengji` 才执行。该脚本检查当前 JAR、actuator、构建源码和测试哈希及全部未修改条目，要求精确的 `qiandengji-mc-1` 已停止，备份被覆盖文件和锁。只替换服务端原 `numen-neoforge-1.21.1-0.1.1.jar`，缓存到被忽略的 `vendor/numen-cache/`，不向客户端增加 Numen。随后运行 `python tools/record_deployment.py` 更新整服记录。脚本不启动服务器、不创建身体，原身体是否成功加载应在随后运行中核验。

重建时使用 `--baseline-jar vendor/numen-cache/baseline-numen.jar`，这个缓存保存恢复增量之前的严格步行 JAR。构建记录还保留源码、测试和构建器哈希，改动这些文件后须重新构建，不能沿用旧记录。
