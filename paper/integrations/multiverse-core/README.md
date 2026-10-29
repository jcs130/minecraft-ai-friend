# Multiverse-Core 多楼层基础

使用官方 **5.8.1**，不修改第三方JAR。2026-10-27随AgentFriend0.4.47.20正常维护正式上线，显式登记aincrad；[发布记录](../../docs/ADVENTURE_RELEASE_20261027.md)。下方隔离测试不是新增正式楼层。

`prepare.py --output <新的评审目录>` 从官方 GitHub 获取固定版本，核验与官方 Hangar 相同的 SHA256，再复制本仓库配置。也可用 `--cached-jar <已下载文件>`，仍须通过同一摘要检查。不分发世界、账号、密钥或玩家存档。

配置保留现有玩法控制权：不强制改变游戏模式或飞行，不接管复活、首次出生、刷怪限额，不自动清实体或修改聊天前缀。只自动登记默认世界；艾恩葛朗特和以后楼层必须逐个显式登记，防止误管理副本临时世界。没有安装 Multiverse-Inventories，楼层之间不分割同一角色的背包。

用户继续使用现有 `/warp aincrad`、`/warp village` 与 `/mycli`，不新增玩家命令树。新楼层目前仅验证独立世界能力，正式攻略仍使用既有 `aincrad` 第一层配置；不能把安装多世界插件称为已开放所有楼层。

艾恩葛朗特城外开放探索，不设置 5120 格围墙或越界禁入区。现有地图建筑防拆规则及原两位建设者例外保留。

`probe/client.mjs` 只接受已有回环 QA 的25924/25925，通过原生 MV 命令及普通 Mineflayer 检查新世界、原城导入、往返、职业、物品数量、飞行回收与观战模式。普通玩家不能创建世界。冷启动另测世界和物品保存；没有将创建测试平地当作已建成正式楼层，也没有冒称基岩真机验收。

物品验收逐项查询测试剑、盾和17个圆石的标量字段，拒绝截断的NBT摘要。早期测试清掉受保护道具后触发原生补发、以及测试角色被僵尸击杀的失败均保留；不能把这些归因于跨世界丢物。最终联机18项、正常冷启动9项通过，固定摘要见[候选清单](../../manifests/multiverse-core-candidate-20261027.json)。原Mineflayer组件解析警告、QA缺少生产建筑掩码和Essentials版本提示仍保留，不称完整插件组合全绿。

本轮安装器已收敛放行固定JAR/配置，17项安装撤销检查通过，正式双盘冷备20261027-141626。以后更换仍需原维护流程。回退只撤下插件和本次配置，保留新增世界及最新玩家资料；不能删除世界或恢复旧玩家背包。

官方资料：[Release](https://github.com/Multiverse/Multiverse-Core/releases/tag/5.8.1)、[Hangar](https://hangar.papermc.io/Multiverse/Multiverse-Core/versions/5.8.1)、[配置](https://mvplugins.org/core/reference/configuration-file/)、[世界创建及传送命令](https://mvplugins.org/core/fundamentals/commands-usage/)。
