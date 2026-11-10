# 女仆独立跟随距离

本批候选为 `QiandengjiMaidBridge 0.1.23-follow-radius`，基于已合并的单次对话版0.1.22。只有完成正常维护、版本读回与原肥鱼配置核验后，才能标记已部署。

肥鱼采用32格开始跟随、16格停止追近、64格起允许原生安全传回。距离为同维度三维欧氏距离，单位为方块。桥接层在超过64格且连续8秒没有靠近进展后才尝试恢复，保留15秒重试间隔；原模组自身也能在64格边界触发原生安全返回，不承诺边界外一定等待8秒。

旧逻辑超过3格就追近，卡路8秒后即可能安全传回；原模组的8格活动半径还会独立产生约10格的传回门槛。只改其中一层无法解决反复拉回。新版本按每个原实体读取明确配置，并将其原生半径设为 `returnDistance - 2`，让两个返回门槛一致。没有自定义配置的其他女仆维持原规则，所有客户端共用服务端原生行为，不需要安装新客户端。

## 持久配置

服主对已确认的原实体设置 `Entity.getPersistentData()` 中的以下复合标签。其保存位置是实体SNBT的 `NeoForgeData.qiandengji_follow`，不是 Bukkit 名字匹配或新建替身：

```snbt
{schemaVersion:1,walkDistance:32,stopDistance:16,returnDistance:64}
```

四个字段必须是NBT整数；版本必须为1，`walkDistance >= 3`，`2 <= stopDistance < walkDistance`，`walkDistance + 4 <= returnDistance <= 256`。错误配置返回 `context.follow.state=follow_profile_invalid`，不猜测、不自动重发follow。移除配置后再正常follow可恢复原生默认半径；自定义距离变化会释放旧的主人跟随目标和计时，不清除其他工作目标。

`/qdmaid follow` 同样使用该配置，避免每次恢复跟随又改回8格。原身份、拥有者、装备、YSM模型、对话、原脑、生命与动作回执保持。停留/坐下、关闭AI、原生工作和战斗、呼吸避险、主人不可用及跨维度暂停仍按原规则；安全返回只调用原模组的安全落点方法，不改方块、不扫描或强载区块。远传随行是原有独立功能，仍需女仆在传送前主人附近并通过安全落点检查。

## Agent读取

`context.follow` 保留原字段，并增加 `recoveryBeyond`、`distanceUnit:blocks`、`customized`。自定义时 `policy=ranged_idle_companion`；未配置时仍为 `close_idle_companion`。`walk_requested` 表示已请求原生导航，不能当成已抵达。以 `position`、`dimension`、`ownerDistance` 和暂停原因判断实际状态；不扩大既有32格管理操作权限。

## 验证与发布

策略夹具直接编译真实策略类，覆盖默认值、32/64格边界、长时间卡路、进展/冷却、配置变化及非法阈值。`tests/follow-radius-stage.mjs` 配合仅回环控制台可用的 `FollowRadiusQa` 检查真实原生实体与Mineflayer回执；测试辅助JAR不进正式包。

已通过31项跟随策略、29项原生命期与144项伙伴/对话回归。隔离原生0.1.22基线的2项检查复现了“存有新距离但旧代码仍在24格内拉回”；候选14项及正常重启后16项全部通过，涵盖24格自由活动、40格实际行走、38格围挡超过旧恢复时间仍不传送、远处安全返回、原管理权限、停留、关闭AI、跨维度、其他女仆默认半径与原UUID配置持久保存。第一轮夹具在38格外下达stay，被原32格权限门槛正确拒绝；修正夹具为靠近后下令再完整重跑，没有放宽正式权限。隔离JVM均正常停止，辅助JAR已移除，正式实体和物品未用于测试。

发布使用 `build-follow-radius.py`，固定0.1.22基线SHA256 `0ceb98805025155d89f13788bf67ecfb9385c228b899f5a821d09d02f49690c1`，仅替换HybridMaidPlugin、NativeMaidFollowSupport、MaidFollowPolicy三个类族及版本元数据。候选SHA256 `2c56fe0a2b84e2fbda203b4b1fb9807b9343586840f166d07876f397a452875a`，70个无关条目字节保持，两次独立构建一致。

正式发布须使用新的单次维护批次、正常预告和停启、当次E/F冷备以及真实玩家/活动门禁；不能追加到别的已冻结维护或热换类。原实体配置设置前应保存相应字段前像，设置后核对配置、实际上下文、原身份和装备。代码回退只能换回本批前像，保留最新世界、角色、物品、记忆与回执；勿回灌旧存档。
