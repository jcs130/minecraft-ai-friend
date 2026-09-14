# 桐人的原生物资整理入口

当前已在生产安装下述 45 工具范围和最终 Python 解析器，原角色、会话、模型与凭据均保留。最新实机组合验收为 `runtime/maid-bridge-qa-0f1f6cc91adc/result.json`，26/26 通过，包含最终解析器的 9 项丢物检查。Iron 桥以实际 v3 Numen `bda81485…97b1c8` 重新编译，构建记录保留真实依赖；同组安装结衣桥 `fd51566d…9d66`，Iron 产物仍为 `1f14026f…4614`。以下 v2 依赖、候选和旧解析器复验描述是前一阶段历史，不能作为当前状态。生产查询协议及 45 工具原生重载已验证，是否自主使用仍以原角色的实际动作回执为准。

2026-09-14：针对背包 36 格占满、没有自建或授权容器时反复铺泥土腾格的问题，新增 `drop_items(turn_id, item_id, count)`。整理哪些物资、是否递给结衣仍由桐人根据实际背包和目标决定。没有额外规则循环，也不修改旧 Numen 可执行技能内核。

## 行为与凭据

一次调用从主背包按槽位顺序丢出同一物品 ID 的 1–64 件；装备栏与副手不计入可用数量。操作在现有动作锁、当前 turn 租约、精确身体/维度/生存模式和区域检查之下进行。网关先读取真实背包，数量不足时不占用动作机会；Java 在执行前再次检查数量与菜单状态。

不能直接接旧 Numen 的 drop 实现：它用 `new ItemStack(item, count)` 重建物品，可能丢掉名称、附魔、耐久和模组组件。这里由 Iron 桥注册小型原生 TaskRecord，使用实际源栈的 `split/copy` 与 `player.drop`，保留完整 ItemStack 组件及 NeoForge 的正常抛物事件。不同组件的同 ID 物品分别丢出；该入口不提供按组件筛选某个槽位的功能。

成功必须同时读到原生终态 SUCCESS、确实加入当前 ServerLevel 的物品实体、完整组件相等、数量相符以及主背包的准确减少。回执保存每个实体 UUID、源槽位、数量、坐标和完整组件指纹，不向模型泄露完整组件载荷。事件取消时只在原槽与总数量仍与本次拆栈一致的情况下恢复原栈；发生第三方改动或部分丢出则明确失败并保留实际结果，不能假报全部成功。

`pickup_confirmed` 始终为 false：物品落在地上不等于结衣已经拿到，也不能代替长期储物。递物后还要通过游戏交流和实际拾取/库存结果确认。玩法指引在 `qd-minecraft-guide/references/building.md`，继续按需查阅，不把物资整理策略塞满上下文。

## 未知不重放

复用 `WorldInteractionBridge` 的持久请求 journal：网关先保存不确定标记，服务端先持久占位，随后才向原生 TaskDispatch 提交一次。初始 ACK 丢失或损坏后，只查询同一 `actionId` 的 `qdworld dropping` 回执。重复请求返回原结果；已受理请求在服务端重启后失去内存任务时保持 unknown，不能再次投递。动作确实失败与网络未知分别记录；跨网关重启的不确定标记仍阻止后续自动动作。

这是直接 MCP 动作，工具总数由 44 增为 45。旧 `skill_library.ACTION_TOOLS` 与程序内核哈希保持原样，本轮不允许既有程序技能调用这个新动作。未来要在程序里支持它，需按独立能力升级和重新测试处理。

## 验证

- `runtime/maid-bridge-qa-82f64a820903/result.json`：独立 72 模组真实 NeoForge 组合 QA，23/23 通过，无生产存档/动作、无模型或 TTS 调用，隔离容器已拆除。
- Drop 子项 9 项：正常与丢首 ACK 两次场景均将带不同名称及 CustomData 的纸张 8→2，实际产生保留完整组件的两份实体 4+2；重复同请求没有再次扣物；原生 ItemTossEvent 取消后两槽数量及完整组件原样保留。没有把物品实体出现算成队友拾取。
- 生产 Python 最后加了严格拒绝 `schema=true` 冒充 `schema=1`；实机运行的是添加此类型约束前的副本。`runtime/drop-items-verification-20260914/captured-receipts-final.json` 精确核对只有这一个解析变更，并以最终解析器重验保存的三种真实原生回执。它是离线凭据复验，不冒充第二次实机动作，也没有改旧 QA 的哈希。
- `runtime/drop-items-verification-20260914/unit-tests-final.json`：143 项相关 Linux 隔离回归全过，含原生 MCP 45 工具构造/调用、严格组件/实体/数量解析、失 ACK 后同 ID 只读查询、未知跨重启不重放、预检不消耗租约、旧食物/交互/导航兼容与配置凭据保留。
- 第一轮 QA 的正常首 ACK 已经终态却被测试错误要求再查一次；原失败报告 `runtime/maid-bridge-qa-f28c93301a5b/result.json` 保留。扩展回归发现的新工具装饰器变量错误也已修复，首次失败集与最终通过集分别保存，不能将前者改写成通过。

Iron 候选 SHA256 为 `1f14026f8cda64d5fa86587c594e67305939201fa95adf6f09c57b4567144614`。它使用 Numen world-tick-v2 候选 `22d3d5d7a9660a0978e66b9b98071bf02a337d9b0276aa583d750ca1fbea9104` 真实编译，构建参数 `tools/build_irons_bridge.py --numen-jar <候选路径>`；build-record 记录真实依赖与来源，未事后改依赖哈希。

## 部署与维护

此实现子任务只生成候选，生产部署由主任务统一处理。部署需保留当前角色/session/租约历史，先正常 drain，备份后同组更新实际 QA 使用的 Numen、Iron 与伙伴桥，依现有清单更新 artifact 记录；survivor 镜像需含最终 MCP 和 drop 模块。Qwen 中的 DriverCard 白名单、精确工具政策和原 profile 镜像要一起同步为 45 项，不能只改显示列表或将脱敏密钥写回。`tools/configure_life_memory.py` 已兼容已知旧 43/44 工具范围；本次即时同步由独立 scoped 工具处理，不跑旧的整角色迁移脚本。

健康由现有 `world_interaction_health.py` 探针覆盖：检查安装 JAR、构建记录、源码、实际 Numen 依赖，再对两个全新未使用请求分别查询 interaction 与 dropping 协议，零物品动作。沿用原健康 manifest 和 Compose 守护，不新增进程。生产部署后还需验证原生 45 项 scope、该只读健康探针及原 session 自主整理记录；隔离 QA 不代表桐人已经在主世界用过新入口。

## 长回执完整性

最终审查另发现生存网关原 RCON 客户端只返回第一帧；Minecraft 1.21.1 会把长回复按 4096 字符切分，同一批实际物品可能已丢出，却因实体凭据被截断而暂停为 unknown。新版只修改 survivor 的 RCON 客户端：收到第一个命令回复后，发送不同 request ID 的 type-0 协议探针，逐帧收集原命令 ID，直到精确匹配原生 `Unknown request 0` 结束回执。探针不执行游戏命令；没有固定 sleep、盲目双读或重发丢物。

接收限制为 256 帧、累计 1 MiB，结束标记缺失或错误仍保留未知语义。47 项网关/丢物回归覆盖多帧、中文、精确整帧边界、错误结束标记、大小限制与丢失结束帧后的同 ID 查询。另直接加载当前 MC JAR 的原生 RCON 类进行独立 loopback socket 验证，8 项通过，36 实体的 10,976 字符回执完整返回；5 次 fixture 调用只执行 5 条 fixture 命令，结束探针不执行命令。

证据在 `runtime/survivor-rcon-framing-20260914/`。这是新增客户端分帧与回执解析验证，未在生产替桐人丢弃物资；也不把最终网关整体 SHA 冒充为此前 26 项模组实机验收的原输入。
