# 效率附魔与末影人积压（2026-10-26）

## 实际原因及修复范围

Paper 1.21.1 的 `EnderMan.requiresCustomPersistence()` 在持有方块时返回真，
即使 `PersistenceRequired=0` 也不走普通自然消失。只读扫描 149 份实体区域文件，
主世界存档有 1,275 只末影人（1,259 持物），下界 419 只（389 持物），末地 207 只
（无持物）；持物记录均为 NATURAL，无名称、显式常驻、Tags、BukkitValues、拴绳或乘客。
这些是保存时的统计，不等于同一时刻在线加载数量。

三个原有维度的 WorldGuard `__global__` 增加 `enderman-grief: deny`，阻止继续搬块。
没有关闭 `mobGriefing`，不影响村民收种、交易、玩家建造或普通怪物生成。
已有加载实体分 66 批处理，每批最多 16 个，最大 RCON 往返 221ms；实际解除
1,033 个自然末影人的持物状态，随后已加载总数从约千只降到 114，只是阶段快照。
没有使用 kill、掉落奖励、清空怪物或修改玩家物品。

23:41 已热加载最终脚本（SHA256 `e0381046136c5ea888f492aed602425665533fad7722347a4ec28294b3070097`），
同摘要七项冷启动/运行中实体加入检查通过，原六份 Denizen 脚本摘要保持。
三个 WorldGuard 文件结构比对确认只改目标 flag。正式读回持物0、末影人总数63，
未重启 Paper；未加载区块会在自然加载时处理，不声称所有存档实体已立即清空。

`content/world-life/Denizen/qd_enderman_despawn.dsc` 沿用现役 Denizen：

- 实体加入世界时延迟一 tick，按 UUID 重新检查 NATURAL、非显式常驻和持物；
  排除名称、标签、插件数据、乘客、骑乘根及拴绳，只移除 carriedBlockState。
- 初始出生区块可能早于事件注册，启动时对已加载末影人做一次补查，每 tick 一个。
- 不定时轮询世界，不强制加载远处区块，不新增客户端或游戏命令，不广播反馈。
- 仅作用于 world、world_nether、world_the_end；其它内容世界不自动纳入。

## 验证与限制

`probe/mining-endermen-stage/run.py` 使用新回环 Paper 测试目录，只有当前 Denizen、
ViaVersion、ViaBackwards，无正式存档/玩家/凭据/配置。两协议各四组真实挖掘有服务端
方块变为空气的回执。普通钻石镐挖石头约 314–316ms，效率 V 约 109–110ms；
地狱岩约 109–111ms，效率 V 为瞬间破坏。均实际收到 efficiency=5。
这是本机测试，不代表小鱼设备及网络的端到端延迟。

测试 Mineflayer 4.39 / prismarine-item 1.18 的 `.enchants` 返回原始组件对象，
探针仅把收到的附魔 ID/等级转成 digging 所需数组，没有给工具虚构等级。
原有配方解析 PartialReadError 仍保留，不把本轮挖掘回执称为整个协议零错误。

在线实际抓到 LittleFish0510 使用 1.20.6 协议，在下界挖地狱岩；原钻石镐保留
效率 V、精准采集、耐久 III、经验修补。持镐时 mining_efficiency=26，基础挖掘倍率1，
无负面效果，OnGround=true、Air=300；取样时平均 MSPT 约12。未证明附魔失效，
仍需区分客户端单块速度、连续挖掘间隔与方块回弹，不能以提高附魔或放宽保护掩盖原因。

旧探针 /summon 强制设为 COMMAND，data merge 不会覆盖现有 spawnReason；
前两次自然个体夹具不正确，失败记录保留。最终使用 Denizen 原生 reason:natural，
并正常保存/冷启动检查六类实体，不能用脚本任务手动调用冒充加载事件验收。

## 本轮事故及防复发

22:44 的诊断用了过大的 distance 范围，触发 Paper 巨大空间包围盒遍历，主线程卡住
并被看门狗停服。这是维护排查操作引起，已向服主说明并道歉。
22:44:32 完成各世界保存；22:46:20 原 Watchdog 恢复，单实例确认，原插件保持。
`ops/rcon-client.mjs` 现在在读取凭据/建立连接前拒绝超过256格的有限空间选择范围，
两项测试覆盖巨大 radius/extent 和正常本地、已加载实体查询。全地图统计改读存档。

## 证据与回退

本机私有证据：`E:/MC/ops/repairs/mining-endermen-20261026`，前像及清理回执已镜像
到 F 盘同名 repairs 目录。完整实体前像包含 UUID，不提交 Git。
隔离证据：`E:/MC/staging/mining-endermen-native4-20261026`，保留早期失败和最终结果。

回退规则只需移出新增 Denizen 脚本并 `denizen reload scripts`，按原前像撤销这三个
WorldGuard flag；不覆盖其它区域设置。持物清理已让部分自然怪正常消失，不能声称
仅撤回脚本会复活它们；不要用旧世界备份覆盖后续玩家进度。
