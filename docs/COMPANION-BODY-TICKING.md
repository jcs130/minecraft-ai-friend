# 结衣的原生跟随与实体更新

结衣沿用车万女仆原生的跟随、寻路和远距离回归。Qwen 只负责交流、目标与分工。2026-09-14 的故障不是缺少跟随行为：原结衣已经开启 following，主人也在线，但位置和 Motion 在离主人约 31 格处停止变化。

当前 Numen 原生 `CompanionChunkLoader` 的 radius=2 是加载区域半径，其源码明确中心区块为 `ENTITY_TICKING`，外围区块只是加载。桐人的服务器端身体没有真人玩家的完整模拟距离，走进相邻区块后，结衣可能仍然能被 UUID 查到，却已不再执行实体更新。仅用 `loaded=true` 或 `following=true` 不能验证同行。

已安装 TLM 1.5.3 的 `MaidFollowOwnerTask` 字节码确认：原脑会检查同维度、主人存活、非旁观者、非 home 模式以及可移动状态，再设置原生行走目标；距离过远时调用 TLM 自带 `teleportToOwner`。我们不再实现一套寻路或定时传送。

## 修复与边界

`CompanionTick` 由现有 NeoForge 服务器 Post tick 驱动，给独立配置授权的一对 bodyUuid / ownerUuid 保持一个半径 2 的原版区域票。配置只在启动读一次；每 20 tick 或身体跨区块时刷新，旧票 40 tick 自然过期。该票让结衣自身所在区块执行实体更新，随后由原 TLM Brain 决定行动。

只接受已加载、存活、未移除的原女仆身体，以及当前在线、同维度、UUID 精确匹配的真实 `NumenPlayer` 主人；following 必须开启、未坐下且 NoAI=false。主人离线、身份变化、切换 home 或坐下后停止续票。不会新建角色、修改主人、直接调用 entity.tick、搜索未加载存档或加载未知远处区块，不修改 Numen 本身或真人玩家的模拟距离。

未加载的伙伴不会仅凭配置被召回；跨维度也不靠本补丁传送。若原生 TLM 因地形、行为状态或没有安全回归位置而失败，必须根据真实状态处理，不把区块更新资格当成导航成功。

`qdmaid invoke` 的原生 `identity` / state 回执新增 `ticking`：实际 `entityTicking`、bodyTickCount、serverTick、当前资格和最近续票 tick。对同 UUID 连续采样后才能验证物理持续更新。

## 部署

1. 构建：`run-python.bat tools/build_maid_bridge.py`。构建记录和候选 JAR 在 `world/maid-bridge-src/build/`，该步骤不会部署。
2. 在已有维护安全边界备份生产桥 JAR 与配置，安装候选桥。`config/companion-ticking.json` 是本项目原结衣与桐人的独立绑定样例，安装为 `server/mc/config/qiandeng-companion-ticking.json`。这是独立于不死保护的授权，不能因为人物有保护就自动扩充角色名单。
3. 该策略启动缓存，Minecraft 需要在统一维护窗口重启。客户端仍用相同现有 mod ID / version / serializer 协议；新增部分完全是服务器生命周期和回执字段，不新增客户端注册表条目。
4. 维护后检查原两个人物 UUID、背包与会话，连续采样结衣真实 tick，随后观察原生同行与交流回执。没有这些实机结果不能称协作验收完成。

隔离验收入口为 `run-python.bat tools/smoke_maid_bridge.py --run-isolated --ticking`。使用当前全部服务端模组、新建独立远处平坦世界和 QA 身份，没有生产世界挂载、LLM 或 TTS 调用。测试包括外围已加载但物理停止、恢复原脑后自然跟回、跨区块跟回，以及主人离线后停止续票、实体 tick 到期。

## 本轮候选验收

候选 JAR SHA-256 为 `b47940211aecd26ca164e580b482c382f60dc61d93b2369166baa5f1da3eacef`，离线 145 项通过。实际 TLM 依赖 JAR 为 `ac7c07068be61216180a75e6845dc1e91f8c95a7c2e19ad241b81a127e7802dd`，已核对的原生 `MaidFollowOwnerTask.class` 为 `3b941e2606b5f1e103a598378f13501ba363409fe8fb5e395e0e3bf29b15a759`。

独立实机报告 `runtime/maid-bridge-qa-12fb6f42b483/result.json` 的 10 项检查全部通过，隔离服务已清理：

- 服务器 tick 166→200，36 格外女仆已加载，但 bodyTickCount 停在 51、entityTicking=false，复现了外围加载不等于实体更新。
- 测试解除坐姿后，没有直接移动女仆；原 TLM 跟随行为把距离从 36 降至 3.01 格，bodyTickCount 51→61；继续观察时 61→95，距离 0.99 格。
- QA 夹具把主人移到下一处区块，女仆由原脑从 63.29 格外回到 4.06 格。这包含原生远距离回归，不冒称全程步行，也不是生产人物的移动验收。
- 主人在服务器 tick 287 离线，tick 340 时原位置不再 entity ticking 且女仆已卸载，没有残留 forceload 或模型/TTS 请求。

此前 `runtime/maid-bridge-qa-e48b8b5eaf35/result.json` 失败原因是 QA 主人缺少 Numen Registry 登记，主人本身未取得自主资格；原始失败保留。修正的是新测试世界的完整登记，不放宽生产身份检查。

生产部署后的只读检查为 `run-python.bat tools/companion_tick_health.py`。这个报告只证明真实实体更新，输出 `followArrivalVerified=false`；桐人、结衣的原生活会话、附近交流及角色分工仍需另外验证。
