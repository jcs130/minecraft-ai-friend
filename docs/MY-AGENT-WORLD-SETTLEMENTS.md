# 万家烟火与村民新闻：隔离整合记录

2026-10-14：在 NAS `共享文件/mc-mods/万家烟火` 找到 `mods.zip`（21 个 JAR）及独立的 `villager_news-1.0.1.jar`。当前已把 **Settlements 万家烟火 + Villager News 村民新闻** 加入隔离候选，完成普通 Mineflayer/Numen 接入、村民真实背包与市长交易菜单验证。**没有发布到正式服；正式服仍为原35个JAR。** 基岩与网页新增模型、界面及声音适配尚未验收，不能把隔离服成功理解为手机已完整可玩。

版本、哈希、频道及发布边界由 [候选清单](../manifests/society-settlements-1.21.1.candidate.json) 固定。该清单不是现役安装锁；`productionInstalled=false`。原始包、生成JAR、注册表、测试存档和回包保存在私有 `E:\QiandengJiSocietyLab\research\wanjiayanhuo-20261014`，不上传Git。

## 选择与兼容性

- 本体是 `settlements-1.0.0-beta.nightly-101226`，Minecraft 1.21.1 / NeoForge / Java21，与现服版本相符。模组针对村庄和村民生活，[作者仓库](https://github.com/breeze-devs/Settlements-Alpha)提供源码；具体农耕、生产与长期性能仍须实测。
- 村民新闻的文件名为1.0.1，但JAR元数据实际版本是 **1.0.0-r328**。它提供新闻角色、村民交互及背包，包含大量原录音；不能把文件名当作完整版本标识。
- 压缩包里的Create 6.0.10与车万女仆1.5.3和现役JAR逐SHA一致，复用现有文件。
- ModernFix、FerriteCore、Waystones、Sophisticated Storage、Lootr、锦致装饰、烹饪等其余候选未安装。客户端工具及前置不整包混入服务端；其中JEI文件的Minecraft依赖元数据为`[1.21, 1.21.1)`，排除了当前1.21.1，必须另行核对。
- 没有替换MineColonies，没有批量转换现有公会NPC，也没有重生正式世界。这里只验证了新隔离世界中的三类NPC，不能证明所有旧村庄及公会NPC迁移均已通过。

## 已修复的实际故障

1. 原始两个JAR一起加载会崩溃。村民新闻的`SettlementsInventorySaveMixin`调用已经不存在的`VillagerInventoryAttachment.saveFrom`；该版Settlements已采用原生Attachment serializer。兼容副本仅移除此过期重定向，保持当前原生存档机制。
2. 原村民背包把原生库存账本里的128面包投影为单个128物品堆。打开菜单时`ItemStack`序列化超出1–99范围，导致隔离服崩溃。新的8格容器按真实堆叠上限显示，并以完整组件区分物品，直接结算原生账本；不清空装备、不丢弃超出8格的库存。
3. 原副本存入物品时只按基础Item计数，可能丢失自定义名称/附魔等组件。兼容实现以完整组件匹配并使用原生按变体消费接口，已验证命名钻石7个取出再放回。
4. Settlements的可选同步频道未声明时，服务器在玩家进入世界时发送种子表会报`Payload ... may not be sent to the client`。候选网关明确声明17个实际频道；不依赖“没有强制要求频道就代表不用适配”。
5. 增加两个模组会改变组件编号。沿用现服旧注册表时，Mineflayer在登录收物品包即报`NATIVE_PACKET_LENGTH_MISMATCH`并停止连接。候选使用同模组集合重新导出的真实注册表；新增`enchant_attempted`的BOOL和`villager_totem_mode`的固定32位INT编解码。INT不是VarInt，不能猜编号或吞掉未知字段。

兼容JAR只改动一份Mixin JSON及一个容器类；其余类和全部资源逐条原样保留。NAS原包未改。构建工具限制到已审计的两份输入SHA，拒绝对其它版本盲目打补丁：

```powershell
python tools/build_villager_news_compat.py --news "Y:/mc-mods/万家烟火/villager_news-1.0.1.jar" --settlements E:/private/settlements-1.0.0-beta.nightly-101226.jar --libraries E:/QiandengJiSocietyLab/server/libraries --output E:/private/new/villager_news-1.0.1-maw-compat2.jar --javac E:/MC/jdk/jdk-21.0.12.1+1/bin/javac.exe
```

Settlements原文件来自NAS的`mods.zip`。输出必须是新文件；构建不安装模组、不重启服务，生成旁路`*.build.json`记录输入、输出和源码哈希。

## Agent怎么操作

使用原生SDK，无需另建控制器或模型循环。先查询本人provider的`operations`和`help`，不要把两个provider的命令形状混用：

1. Mineflayer通过`body.observe`读取实际可见实体的类型、UUID和绝对坐标；Numen按其实际观察接口。村民新闻市长与Settlements村民保持真实模组类型，不冒充原版村民。
2. 装备真实`villager_news:news_manual`，用`body.interactEntity`右键可见、可触及的村民。参数包括实体ID/UUID、手、当前快捷栏和完整物品SNBT。
3. 村民背包是实际`villager_news:villager_backpack`菜单，共48槽：8格背包、4护甲、36格玩家物品。读取最新`slotLayout.owner/inventoryIndex`，不要猜自己的背包起点。
4. Mineflayer使用`menu.click {slot,button}`，SDK内部取最新窗口、槽位和光标完整CAS。Numen使用原生`menu.pickup`，参数按本人`help`传入。游标有物品时不能关闭菜单。
5. 空手右键市长可打开真实`minecraft:merchant`交易菜单。验证菜单可打开不等于所有交易、价格与交付均已验收。

成功回执、失败和未知均保留原action_id。首次菜单测试中的两个参数错误来自QA脚本混用provider入口，未派发物品变更，不能归咎于模组。另一个失败世界因旧背包崩溃留下未知动作，原账本和世界保留，不重投。

## 验证与发布门槛

已验证37模组隔离服启动，Mineflayer/Numen各16项基础接入回归，真实村民背包开关、128面包拆堆、带名称物品存取和市长交易菜单；263项网关测试通过。已用原世界重启检查同NPC UUID及命名物品保留。完整背包对照还发现NPC在运行期间把水瓶喝成玻璃瓶，须区分真实消耗和存档丢物，不用“全部没变”掩盖正常玩法。

测试使用新建平坦世界、显式NPC/物品夹具和零模型调用，不能称作Agent自主获得物资或经营村庄。Mineflayer为普通非OP账号；Numen沿既有夹具使用bypass权限模式，因此没有把它当作完整生产权限隔离验收。第二次重启前重新采集实时背包，之后全部可见物品/组件及三类NPC UUID精确一致，兼容包重复构建SHA一致。

下一步必须完成新增注册表对应的资源导出、原模型/纹理与动态状态、基岩下发和专用界面，再验证普通基岩连接及网页实际画面。Java原图、2233段村民新闻声音、村民动作/气泡、自动生活生产和负载尚未全验。还需对正式世界的公会NPC做复制世界验证；发布时按现有零玩家备份/守护维护流程，保留世界、余额、原身份、动作账本及SDK旧版本。

候选尚未进入主安装清单。仅复制两个JAR会同时漏掉兼容副本、注册表、频道和多端资源，不能作为发布步骤。
