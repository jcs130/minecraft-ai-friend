# 自主角色周围的自然世界更新

当前实现已升级为 `autonomous_world_tick_v3`：每个精确授权角色的中心区块及八个相邻区块都获得自己的原生短期票据，即固定 3×3 区块活动区；下面保留 v2 的诊断与验收历史。每张票据的原生半径仍为 2，活动区的区块半径为 1，两者不是同一个量。即使角色站在区块边缘，周围仍有至少 16 格连续物理与随机更新空间；更远导航随身体移动更新区域，不保持整张地图运行。

12:11 的生产观察发现，v2 中桐人在 `(-638,64,1059)` 时，距离几格的旧农田已经跨到相邻区块。身体位置的 `execute if loaded` 可执行，农田位置不满足；12:12 自主移动跨过边界后，相同农田读取立即返回。该版本 `ExecuteCommand.isChunkLoaded` 实际要求 `getChunkNow` 存在、`FullChunkStatus.ENTITY_TICKING` 且实体已加载，因此空回复证明缺少活动更新条件，不能单独断言方块从未缓存。这说明只更新角色所在区块不足以支持营地玩法，不应要求角色为种田记住区块边界。

v3 的 Numen 每张票以原身体 UUID 为稳定标识；结衣每张票以票据目标区块为稳定标识，二者使用不同票据类型。移动时只移除“旧区域减去新区域”，交集保留并续期，进入的新区块获得新票；跨维度或失效时完整移除自己全部九张票。两个角色的重叠区域不会互相删除票据。刷新仍为 20 tick、过期 40 tick，所有移除都匹配五参数 `forceTicks=true`，不手动推进作物。

v3 新构建入口为 `tools/build_numen_world_tick_v3.py --baseline-jar <已验 v1 原始 JAR>`，批准清单为 `world/numen-patches/autonomous-world-tick-v3.json`，构建记录单独写入 `runtime/numen-world-tick-v3-build/latest.json`。v1/v2 批准清单、JAR 和旧实机记录不改写；健康检查按实际 JAR SHA 选取对应记录，v3 还要求九个区块真实 `shouldForceTicks` 和实体更新都成立。新版隔离测试把作物放在北侧相邻区块，并检查移位的旧边缘释放、交集保留、新边缘加入，以及停用后全部经过区块清理。

旧 v1/v2 构建器另行固定到 `world/numen-patches/versions/` 的历史源码和原测试，避免引用当前 v3 源却标成旧版本。隔离重建已经精确复现原 v1 `47cc11d6…` 和 v2 `22d3d5d7…` JAR，原断言各 34 项通过；历史复验使用 `--no-latest`，没有改动 v3 的任何已验输入。具体命令和来源见 `world/numen-patches/versions/README.md`。

v3 隔离实机验收 `runtime/maid-bridge-qa-0f1f6cc91adc/result.json` 共 26 项通过：相邻农田在主人离线、主人在线、仅结衣家园工作三个分支中，分别经过 717、112、362 个服务器 tick，观察到 1/1/2 株成长、21/3/15 块耕地湿润。Numen 和结衣分别横移一个区块后，旧侧票据消失、交集仍生效、新侧票据加入，实际九格均进入实体更新；停用和停用后重启，经过的 12 个区块内强制更新计数均为 0。仍保持 `randomTickSpeed=3`，没有真实玩家 proximity、模型或 TTS 请求、生产存档修改，临时服务已拆除。Numen 39 项检查、女仆桥 152 项检查、Python 健康检查 18 项通过。

本次 v3 验收的 Numen SHA256 为 `bda81485d7a6760bb0288b232f251f4a12972936bd6c47104b1094b43397b1c8`，女仆桥为 `fd51566d090c34a7c1c5fbc8909276f11beb48cbf158b5a4a4a738dc5d449d66`，同服 Iron 桥为 `1f14026f8cda64d5fa86587c594e67305939201fa95adf6f09c57b4567144614`。精简候选与源码证据见 `runtime/survival-priority-20260914/world-tick-v3-acceptance.json`。此验收证明物理更新与工具执行链，不把“设置了农耕模式”当成已经完成自主收获。

2026-09-14 的生存检查发现，桐人还在完成原会话回合，但多株作物种下数小时后仍为 age 0。11:30 的新只读检查确认三株依旧 age 0，`randomTickSpeed=3`；耕地 moisture 0 还可能有供水原因，不能仅凭干土判断不更新。

Numen 为避免虚拟玩家发送区块包和加载整片模拟距离，把 `ChunkMap.skipPlayer` 对自身设为 true，再用半径 2 的短期票据恢复身体更新。NeoForge 1.21.1 的 `ServerChunkCache.tickChunks` 同时把天气、随机方块更新放在“附近有计入 DistanceManager 的玩家，或者有 forceTicks 票据”的条件内。旧四参数 `addRegionTicket` 默认 `forceTicks=false`，因此身体能走动不代表周围作物在长。

`autonomous_world_tick_v2` 只为 `numen-autonomous-bodies.json` 中 UUID、主人、名字和原注册表完全匹配的已有角色补充原生五参数票据。半径仍是 2，20 tick 续期、40 tick 自动过期；票据标识包含身体 UUID，同区块角色不会移除彼此的票。原主人在线和离线都覆盖，原 Numen 身体加载和客户端区块包优化保留。移动、死亡、离线或关闭原加载器时，用相同五参数和 `forceTicks=true` 移除自己的旧票。

结衣既有的精确身份票据也启用原生 forceTicks。跟随和家园工作模式都可以保持更新；改成家园农耕不再自动冻结身体。主人仍须原身份在线、同维度，角色存活、非坐下、非 NoAI；其他女仆不获得新的资格。坐下、离线和无效身份停止续期并移除自己的票。这里不启动额外模型、守护或遍历作物的生长循环，也不改随机更新速率。

这只让票据中心区块进入原版世界更新，周边加载区块和整片模拟距离并没有全部激活。角色离开后作物不保证继续生长；营地供水、光照、季节模组和工具工作条件仍由真实世界决定。

构建使用 `tools/build_numen_world_tick.py`，从 v1 精确已部署 JAR 仅替换 `AutonomousBodyTick` 类族；基线哈希及保留能力记录在 `world/numen-patches/autonomous-world-tick-v2.json`。旧 v1 批准清单不改写。女仆仍由 `tools/build_maid_bridge.py` 构建，无新注册项或客户端协议。

只读健康检查 `tools/numen_autonomy_health.py` 按实际部署 SHA 选择 v2 新构建记录，检查授权、票据续期和原生 `DistanceManager.shouldForceTicks`。`tools/companion_tick_health.py` 同样读取原生标志。标志可证明进入世界更新条件，不能代替作物实际生长的验证。

独立实机验收入口为 `tools/smoke_maid_bridge.py --run-isolated --world-tick --numen-jar <候选>`。专用测试世界用有水的 63 株 age 0 小麦，维持原 `randomTickSpeed=3`，分别观察桐人主人离线、主人在线以及仅结衣家园工作时的自然 age/moisture 变化，再检查停用及停用后重启没有遗留强制票。测试布置不使用生产身份或存档；候选构建成功不等于这些自然变化已经通过，具体实测以新的 runtime 结果为准。

2026-09-14 独立实机结果保存在 `runtime/maid-bridge-qa-82f64a820903/result.json`：23 项全部通过，涵盖同服组合的 Numen、女仆桥及物品丢弃桥。三种世界更新条件均从 63 株 age 0、63 块 moisture 0 的有水测试田开始，在没有真实玩家 proximity 的情况下观察到自然变化：

| 当前提供更新的角色 | 观察经过的服务器 tick | 已生长作物 | 已湿润耕地 |
| --- | ---: | ---: | ---: |
| Numen 身体，主人离线 | 313 | 1 | 12 |
| Numen 身体，主人在线 | 61 | 1 | 1 |
| 仅结衣，家园工作状态 | 263 | 1 | 13 |

关闭 Numen 加载器并让结衣坐下后，测试地块的 `plotForceTicks`、`plotEntityTicking` 和 `plotLoaded` 均变为 false；将两份授权配置停用后保存重启，这三项仍为 false，`forceload query` 无遗留。实机测试没有请求模型或 TTS，没有写生产存档，临时服务已拆除。自然增长有随机性，表中耗时是这一轮的实际结果，不是生长速度保证。生产营地仍须有正确水源和光照；此结果也不代替生产中自主规划、耕种和收获的持续验收。

本次组合验收精确 JAR SHA256：

- Numen：`22d3d5d7a9660a0978e66b9b98071bf02a337d9b0276aa583d750ca1fbea9104`。
- 女仆桥：`44d1116586c35ac1867dbc61d197483708af32b8d86c5fd06b24cb342cab1091`。
- 铁魔法与交互桥：`1f14026f8cda64d5fa86587c594e67305939201fa95adf6f09c57b4567144614`。

Numen 构建保留 497 个无关归档条目，34 项授权检查通过；女仆桥 147 项合约检查通过，其中 15 项覆盖身份、跟随和家园状态的资格。Python 自主健康检查 17 项通过。第一次组合测试 `runtime/maid-bridge-qa-f28c93301a5b/result.json` 保留失败记录：正常丢弃的首次响应已经是终态，测试却要求必须再查询；修正此测试前提后重新启动了上述全新独立世界，未修改第一次结果。
