# FOM 航空学与千灯纪内容整合包

2026-10-16，衍生版本 `2.42-qiandengji-20261016.1`。以原作者 FOM **2.42** 为基础，游戏固定 **Minecraft 1.21.1 / NeoForge 21.1.248 / Java 21**。

线上 FOM 已于 10 月 15 日合入生活和 RPG 内容。这次补齐可导入的**完整客户端安装清单**，无需先装原包再叠增量。客户端包与线上 102 个服务端 JAR 对应；玩家导入客户端包不需要再次重启服务器。

## 给玩家和 Agent 的文件

本机发布目录：`E:\MC\发布\FOM-2.42-千灯纪-20261016`。

| 文件 | 启用 JAR | 用途 |
| --- | ---: | --- |
| `FOM-2.42-千灯纪-玩家版.mrpack` | 127 | 普通完整 Java 客户端 |
| `FOM-2.42-千灯纪-Agent版.mrpack` | 130 | 同样的游戏内容，加三个客户端控制组件 |

两版都保留作者禁用的 10 个文件。JAR 数与加载器显示的模组数不同。`.mrpack` 是完整安装清单，首次导入仍需下载其中列出的原文件，以及游戏和加载器。格式按 [Modrinth 官方规范](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack) 生成，包含 SHA1、SHA512、文件大小和侧别。

将所需版本导入支持 `.mrpack` 的启动器，**创建新的独立实例**。配置 Java 21，建议分配 6 GiB 内存。连接 `micro.kangqiang.site:28976`，家庭网可用 `192.168.3.163:28976`。账号按游戏内私有提示登录或设密。详细步骤随包放在 `FOM-QiandengJi/开始这里.txt`，也见 [文字版指引](FOM-UNIFIED-QUICKSTART.txt)。

启动器额外 JVM 参数沿用已验证的单方法规避：`-XX:CompileCommand=exclude,net.caffeinemc.mods.lithium.common.shapes.VoxelShapeMatchesAnywhere::cuboidMatchesAnywhere`。这是此前实际遇到的 C2 编译崩溃的兼容措施；`.mrpack` 不定义通用 JVM 参数字段，需要在启动器设置，不能宣称包已自动配置该参数。

原有实例继续使用也可以：上轮六 JAR 增量包仍保留。不要把新包叠加导入已有的个人实例，避免覆盖自己的设置。

## 合并的内容

- 保留原作者的 Create、航空学、Sable 物理、铁路、火炮、物流、仓储、地图、画面和界面配置及资源引用。
- 增加农夫乐事 **1.3.4**、车万女仆 **1.5.3**、Iron 法术 **3.16.3**，以及 GeckoLib **4.9.3**、playerAnimator **2.0.4**、IronLib **2.2.0**。已有 Curios 继续复用。playerAnimator 是作者标记为 beta 的兼容版。
- Agent 版增加 **MAW Client Bridge 0.5.0、Minescript 4.0、Baritone 1.11.3**，全部限定客户端。普通玩家版无需这三个组件。
- Agent 的控制 SDK 沿用 `java-client-bridge/v9-native-crafting-release-20261015`。游戏包里不预填 SDK 角色、密钥、动作账本或其他电脑的 Python 路径；首次启动生成自己的本机连接配置。Minescript 的 Python 按本机实际安装配置。

玩法从原生配方、手册和菜单学习。服务器基础入口仍为 `/fom help`、`/fom status`、`/fom inventory`、`/fom nearby`。先确认登录与现场加载，再执行操作；结果未知先对账。没有新增另一套自主任务循环。

## 可复现构建与检查

[整包锁](fom-pack-20261016.lock.json) 固定原作者归档哈希、侧别、Agent 组件和两种版本的数量；[内容锁](fom-content-20261015.lock.json) 固定六个扩展模组。原作者归档：FOM 2.42 / Modrinth 版本 `wWYmnFIR`。

```powershell
python tools/build_fom_pack.py --base E:\下载\FOM-2.42.mrpack --downloads E:\六个扩展JAR目录 --profile player --output E:\发布\玩家版.mrpack
python tools/build_fom_pack.py --base E:\下载\FOM-2.42.mrpack --downloads E:\六个扩展JAR目录 --profile agent --agent-bundle E:\已发布客户端桥目录 --output E:\发布\Agent版.mrpack
python tools/build_fom_pack.py --verify E:\发布\Agent版.mrpack --cache E:\已下载完整文件的游戏目录
cd tools
python -m unittest build_fom_pack_test prepare_fom_content_test fom_service_test
```

工具只接受固定原作者归档和明确列出的文件，不能递归导出已玩过的游戏目录。保留原 137 条下载引用和 412 个覆盖文件的原字节，包括索引之外的 `reforgedplaymod`；增加内容后计算全部哈希，输出稳定顺序和时间戳的 ZIP。已有输出拒绝覆盖，写入完成并自检后才发布新文件。`--verify` 是只读文件健康检查，`--cache` 进一步逐个核对实际下载字节。

第三方 JAR 通过原作者的下载地址取得；原作者归档内已有覆盖资源保持。自研客户端桥作为独立 JAR 仅放 `client-overrides`，附许可证。包内记录来源、许可及构建回执。源码仓库只提交工具、锁、说明和脱敏验收记录，JAR、整包、世界和凭据留在仓库外。衍生名称和版本与作者版本明确区分，第三方版权属于原作者。

## 验证范围

两种版本的全部安装文件经过清单和哈希核对；在全新目录按索引和覆盖层落盘，启用 JAR 与本机已验证客户端逐 SHA256 相同。实际导入语义由脚本复现，**没有把启动器 UI 导入冒充为已测**。代码测试覆盖原包保留、两个版本、可重复构建、损坏文件、目录越界、Windows 名称规范化、大小写冲突、重复成员、符号链接、清单侧别和真实缓存核验。

全新 Agent 版实例实际连接线上 FOM，22 项客户端/API 检查通过；读到 Create 699、航空学 46、农夫乐事 185、女仆 73、Iron 法术 231 项真实物品目录。取得并查看原生帧，地形、快捷栏、女仆入门道具与小地图正常呈现；QA 正常退出 0。此轮没有移动、物品存取、战斗或模型调用；普通玩家版未另跑独立游戏进程，其文件与 Agent 版的共同游戏内容逐哈希相同。

原生玩法及生产发布验收见 [FOM 内容扩展](MY-AGENT-WORLD-FOM-CONTENT.md)。本次新实例的实际连接、目录和画面结果另见 [整包验收记录](evidence/fom-unified-pack-20261016.json)。线上服务继续由现有拥有者守护；本次没有新增后台服务。

FOM 的旧 Web 3D 仍待适配。2026-10-16 基岩部分兼容入口已上线 UDP 28988，见 [多端接入](MY-AGENT-WORLD-FOM-BEDROCK.md)；Mineflayer 和基岩兼容入口均不能代替完整模组客户端执行所有玩法。全部法术、女仆自主种田、多人航空器及 16 Agent 长期负载仍未全面验收。Paper 千灯纪保持独立。

## 更新和回退

客户端：原实例保留，导入新实例后登录同一服务器、使用自己的账号。服务器中的角色进度由服务器保存。若只需回退画面/控制组件，退出客户端后切回原实例；若旧实例缺少必需内容 JAR，应沿用本轮内容组合，不能拿未安装六个扩展的原包连接新服。

服务端：本次没有变更 JAR、世界、网关或认证配置，无新的服务端回退步骤。上轮内容升级的整服冷备、恢复方式和“不能单独删新模组”的说明见内容扩展文档；不得把客户端新实例或测试世界复制到线上。
