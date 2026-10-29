# 攻略地图与 RPG 插件接入核查（更新至2026-10-27）

本批为开发候选，未安装到正式服。当前目标是 Paper 1.21.1 / Java 21。来源、版本与验收状态见 `paper/config-candidates/conquest-rpg/upstream-resources.json`，地图文件不随仓库分发。

后续已经取得另一张免费地图：[CurseForge SAO Map Floor 1](https://www.curseforge.com/minecraft/worlds/sao-map-floor-1)，原包为 `SAOFloorOne.zip`，SHA256 `0ddf2c3f8c767d2acdfa3be793293a47fd7cb3d45a34bb997ff9d5861970518f`。正式服另项维护已导入 `aincrad` 供探索；本批只在隔离副本配置第一层攻略。原图北部环形遗迹的15个落脚/刷怪位置已离线查实，并已实走三段战斗。完整玩法验收与后续计划见 [第一层攻略候选](AINCRAD_RPG_CANDIDATE_20261027.md)。原图署名保留，不随Git打包地图。

## 地图选择

主候选采用用户指定的 [Lerfing / PROJECT AINCRAD](https://www.planetminecraft.com/project/sword-art-online-map-project-aincrad-100-floors/)。作者公开说明 V2 有前 20 层地形，2025-10-24 更新增加 24 处地下城、城镇和坐标文档；2026-02-02 更新为基岩版支持。页面的“100% complete”和标题“100 FLOORS”不能作为 100 层均可攻略的证据。

[作者下载页](https://www.patreon.com/Lerfing/posts/updated-aincrad-96437751)要求 Gold 或以上会员。用户目前没有存档，选择先准备接入并试用免费资源。作者的免费资源目录中未查到这张地图的免费版；“Join for free”是会员入口，不是地图免费下载授权。该地图尚未下载，存档版本、性能、真实路线与服务器使用条款尚未验证。

免费验证候选：

- [JusttCrafts / Sword art online floor 1](https://www.planetminecraft.com/project/sword-art-online-floor1/)明确提供免费下载，作者介绍有起始城镇、两个地下城及首领房，要求 1.16+。其 2024-06-02 发布说明也明确未完成、无继续制作计划，部分房屋无内饰且有少量坏方块。适合验证首层流程，不承诺后续楼层；不是 Lerfing 地图的免费版。
- [sven14smeets / Aincrad floor 1](https://www.planetminecraft.com/project/aincrad-floor-1/)提供 Java 下载入口，2026-09-13 公会广场更新说明恢复开发，完成度标为 30%。下载是否可直接取得、内部地形和战斗空间仍待检查。

上述免费候选的下载跳转在本次环境未通过站点安全验证，未取得存档，不能标为已安装或已联机验收。

## 接入方式与发布条件

使用独立攻略世界，保持既有主村庄、出生营地、玩家 UUID 和物品。地图来源可替换，职业、通关记录不以建筑压缩包路径作为身份。

1. 原始包只读保存，记录来源、SHA256、版本与使用条件；检查压缩包路径、世界目录、`level.dat`、`DataVersion`、区块、实体与数据包。
2. 高于 1.21.1 的存档拒绝直接降级打开。旧版只复制到隔离服升级；原包保留。自定义维度/高度和原有命令方块、函数需单独审核，不能因为是一张地图就自动运行附带逻辑。
3. 有实际文件后才填写起点、返回点、城镇安全区、野外练级区、迷宫入口、首领区与下一层门。付费地图坐标仍留空；免费地图坐标已按存档和实走填入候选，禁止把其他城堡直接登记成原作逐室复刻。
4. 用真人协议与 Mineflayer 实走“入口 → 补给/选职业 → 野外 → 迷宫 → 首领 → 结算 → 返回”；检查楼梯、门、桥、落差、撤退及断线恢复。原地图建筑足迹决定区域边界，不以一个大圆半径代替所有关卡。
5. 副本战斗按小队独立记录；世界探索与首领遭遇分别管理。不给每个玩家复制整个多层大世界；大型世界按附近区块加载，避免常驻预加载全部楼层。
6. 第一层验收通过后才开放，其余楼层保持未开放。旧试炼塔保留“练习”身份，官网区分地图资源、可进入楼层、实际通关与未采集数据。

原Caleari/虚空城堡样机已停用，`prepare.py`明确拒绝继续创建它。当前`ConquestWorld`只绑定已有真实`aincrad`地图和配置的战斗区域，不生成替代城堡；`prepare_aincrad.py`仅创建回环验收服。`dungeons-overlay.yml`仍是候选，不直接覆盖正式配置。

## VortexRPG 实测

后续兼容适配已完成首轮和冷启动验证，见 [1.21.1 适配记录](VORTEX_1211_COMPAT.md)。
下文保留官方原包失败证据；适配候选仍未部署，完整副本地图/战斗/结算不能据此称为完成。

[官方项目](https://modrinth.com/plugin/vortexrpg)是服务端插件，提供职业、技能、数值成长、队伍、首领、副本和计分板，不要求客户端安装对应模组。免费获取不等于可无条件重新分发：项目页标注 ARR，而源码仓库主页的开放源码表述与授权文件需要进一步核对。

版本查询时，最新 `1.2.10-alpha` 面向 26.1 系列；最近一个元数据标注支持 1.21.1 的版本为 `1.2.2-alpha`。下载已核对官方 SHA512。源码主分支的 `gradle.properties` 使用 Paper API 1.21.11，不能把项目页的“1.21+”当作逐版本验证。

在只装 VortexRPG 的新世界、Paper 1.21.1、Java 21、127.0.0.1:25928 上：

- 插件可完成启用，Paper 正常进入 ready；隔离实例随后正常停止。
- 无客户端模组的 Mineflayer 1.21.1 成功出生，可查询职业、技能和副本目录，可创建队伍。
- 角色加入即反复出现 `NoSuchFieldError: org.bukkit.attribute.Attribute.MAX_HEALTH`，影响实时属性、职业选择、HUD、计分板及团队协同。`/vrp class choose knight` 后资料显示 Knight，但没有完成正常回执，不能算职业流程成功。
- `/vrp stats text` 一次返回约 70 行，包括全部生活专业及种田说明，也不满足本服精炼中文、冒险优先的 Agent 入口要求。
- 默认副本配置给出两种波次副本，但尚未验证模板地图、实际施法、完整战斗与奖励；不得用“插件启动”代替这些验收。

结论：当前官方包不能直接装到正式 1.21.1。它可作为候选框架继续做兼容验证；在成功前，不迁移现有角色，不同时启用两套生命/伤害/经验/奖励结算器。若采用，必须由 `/mycli` 提供精炼中文适配，并明确唯一数值来源，保留地图、任务和登录系统的现有职责。

## 复现

`paper/probe/conquest-stage/vortex_boot.py` 只允许新建 `E:/MC/staging/` 的直接子目录、回环端口 25926..25930，固定校验官方插件哈希。它仅复制 Paper 运行库，生成空白世界；不复制正式玩家、配置或凭据。自动建地形、外部 NPC 模型调用关闭，退出使用正常 `stop`。

传 `--client paper/probe/conquest-stage/vortex_client.mjs` 可复现实际入服、选职业与查询。Python 需要 PyYAML；客户端脚本使用本机现有 Mineflayer 测试依赖。

本次证据目录：

- `E:/MC/staging/vortex-rpg-compat-20261026/`：空服启动。
- `E:/MC/staging/vortex-rpg-client-20261026/`：真实客户端、消息与异常栈。
- `E:/MC/ops/repairs/conquest-rpg-20261026/vortex/`：官方版本元数据、校验后的原始 JAR 与默认配置。

第一次联机验证后的汇总程序遇到 Windows GBK 解码错误，原始 Java 日志和 `client-result.json` 已落盘，隔离服务也已正常停止；脚本已改为 UTF-8 并将运行时异常明确标记为不通过。该测试失败原因来自已保存的服务器栈，不是根据汇总程序退出码推断。
