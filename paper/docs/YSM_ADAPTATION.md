# YSM 外观桥接（2026-10-11已上线）

**当前正式状态：**服主授权先上线YSM后，原维护任务已完成停服、E/F `20261011-030654/.complete` 备份及五文件摘要发布，任务结果0。原身份网关转入私有Proxy 0.3.0 / Freesia 2.5.1+2.4.1 / YSM 2.4.1 Worker，Geyser扩展0.1.0启用；AgentFriend仍0.4.13、CortiEyeMirror仍0.1.10。四个新增监听全部在127.0.0.1，无新公网接口。启动、停止、Watchdog、备份和回退见 [生命周期](YSM_LIFECYCLE.md)。

普通Java、Mineflayer和Eye无需安装YSM即可继续游戏。可分发的原始模型文件夹/ZIP自动稳定扫描、原生重载、转换为网页/相机资源，经原游戏连接按需传送；新增、换贴图、替换、删除无须重启Paper。玩家 `/appearance status` 查本人状态，`/appearance list` 查目录；服主通过本机受认证的控制台分配。仅上线服务不会替全部玩家选模型，普通皮肤保持各自绑定。

正式23项原版/Mineflayer验证通过：原三账号同UUID恢复、女神实际经Proxy连接、临时角色由Worker确认模型/贴图，以及4块39828字节资产SHA256完整匹配。55项旧插件、箱子物品、Minepacks原行、技能资格/支出、领地与来源配对检查通过；测试账号仅新增一条无物品身份行，白名单已撤销。真实基岩协议2193几何/UV/RGBA和上传变化14项、生命周期/故障/实际Eye/16连接14项保留隔离证据。不是16个自主LLM长期开荒验收。

**适配边界：**基岩可看见经Proxy分配的Agent/Java模型；基岩本人分配入口、完整Molang/控制器/装备及手机/Xbox真机外观未完成。远端Web仍须拉取并重建支持YSM的前端，服务端资源到达不代表远端页面已更新。女神相机已接到模型连接；本次正式核验的是资源链路，成片验证沿用此前独立隔离记录。

发布前两次预告与原版恢复均留回执：首次Windows维护任务按ANSI误读无BOM的中文UTF-8计划而拒绝，未替换组件；修正为显式UTF-8并在Windows PowerShell 5.1实际复制验收后完整重发预告。正式难度仍普通、三维度keepInventory=true。私有证据E/F `repairs/ysm-release-20261011`。下方是历史阶段记录，未上线状态不代表当前。

---

# 历史：YSM 基岩玩家外观隔离候选

**2026-10-11普通皮肤问题已独立修复：**可米ag_CorMy新皮肤已通过匿名签名生成并热绑定，原版profile实际投递验证通过；旧脚本把SkinsRestorer默认占位符误作真实密钥才导致403。该修复无需新密钥或重启，但不启用YSM。下述Proxy/Worker仍为候选；正式接入须完成原网关路由、单实例启动/停止/Watchdog、备份回退与实际发布。本轮服主要求不重启，未改正式拓扑。

2026-10-10 增量：基岩接收端已实现原模型几何/UV/贴图转换，通过原玩家皮肤包发送；上传、换贴图、替换和删除沿用已有自动触发器，不新增公网接口。实际 Geyser 与 Bedrock 协议2193客户端通过14项联调，原资源/状态约束11项通过，正常冷重启6项通过，带纹理属性角色的应用/恢复3项通过。原骨骼与128×128 RGBA逐项核对；默认皮肤的离线Agent回调路径已修复。额外纹理角色探针有旧物品组件PartialReadError，直连原隔离Paper路径亦复现；外观通过不代表该账号的全部物品协议已验。

**正式服整个 YSM Proxy/Worker 仍未启用。** 本轮使用仅隔离服允许的自签名客户端，不是微软认证或手机/Xbox真机显示验收；正式认证、入口与原Agent客户端不变。当前用于基岩玩家看见经Proxy分配的Agent/Java模型，直接进入Paper的基岩玩家自己的模型分配尚无入口。完整YSM动画、Molang/控制器和装备尚未支持，不称为完整原生画面等价。

实现、构建、限额、配置和回退见 [基岩扩展](../integrations/geyser-ysm/README.md)、[候选清单](../manifests/ysm-bedrock-candidate-20261010.json)。私有回执 `E:/MC/research/bedrock-ysm-20261010` 保留早期换肤回调失败、重复内容模型被原生拒绝，以及冷启动诊断状态晚于实际发包而导致首次脚本误判的记录；最终脚本等待真实状态后通过。下面各阶段记录按历史时点阅读。

---

# YSM 自动网页与相机资源适配（第二阶段隔离候选，0.2.0）

2026-10-10增量：已实现从用户模型源到游戏连接、Web渲染和照片的自动链路。正式服尚未接入私有Proxy/Worker；远端LAN可视化需拉取源码并重建。下方第一阶段记录按历史时点阅读。

## 用户模型与触发器

Proxy的私有 `plugins/agentappearance/models.json` 设置 `publicModelRoot` 为Worker实际 `config/yes_steve_model/custom` 绝对目录。只发布声明 `spec: 2`、`properties.free: true` 的原始文件夹/ZIP；ZIP支持单层外包目录，不落盘解压。不会扫描 `auth`、跟随符号链接或破解加密 `.ysm`。

每5秒扫描，两次稳定摘要后生成新版本，保留模型JSON、UV、原PNG与动画文件的逐文件SHA256。新上传、替换、删除会自动改变目录版本；只对新版本限频执行原生 `ysm model reload`，不重启Paper。写入中的文件继续使用前一已验版本。控制台 `appearance list` 查实际目录，`appearance admin set <玩家> <模型ID> <贴图ID>` 分配；只有控制台能改他人，模型变化由实际Worker NBT确认。

元数据经原游戏连接 `mcagent:appearance`；有网页订阅时才经 `mcagent:ysm_asset` 请求并分块传输摘要绑定的gzip包。无需公网HTTP、上传端口或新摄影账号；普通Agent不订阅不收资源包。浏览器只绑定自己连接实际跟踪的UUID和实体ID，刷新、下线、换维度和实体ID复用清理旧状态。

## 渲染与限制

共享Web与相机复用同一个2.4.1原模型渲染器，支持有界Unicode模型/贴图/骨骼名、原Bedrock几何/UV/PNG及支持的原数值动画轨道。原模型不是硬编码三个内置角色；用户ZIP新增与贴图替换已实际成片确认。未知Molang、动画控制器、装备和完整原生客户端画面仍未全支持，显示明确状态；`completeEntityParityVerified=false`。原生1.21.1/YSM2.6.5路径保持独立。

加密 `.ysm` 官方不支持反转为普通模型；要用于网页/相机须模型作者同时提供可分发原始文件夹/ZIP。私有/付费资源不自动发布。每模型原始8MiB/压缩2MiB、最多16张2048²PNG、浏览器32模型/32MiB缓存、单连接串行传输和超时；超过预算明确不可用，不拖住游戏连接。

## 本轮验收

真实Paper/Velocity/Worker：17项拍照与自动上传联调通过；1536×1536、169列完全网格化、2×2四张地图、真人无上传链接/机器聊天、新ZIP及贴图替换、准确地图扣除均通过。16个Mineflayer4.37.1受控连接均收到真实CLI和SHA验证模型包，未收到原生加密缓存；平均4.5ms、五秒最大19.8ms。不是16个LLM长期探索压测。失败的旧脚本等待不存在MC_STATUS已保留并修正为真实中文状态回复。

原目录/ZIP/稳定写入/删除/私有/路径/加密状态等10项Java目录检查通过；共享定向测试及正常冷重启另留本轮原始证据 `E:/MC/research/photo-ysm-web-20261010`，未覆盖第一阶段验收。手机/Xbox自定义玩家模型仍未完成，原命令/地图兼容与YSM实时身体显示是不同验收项。

部署需要把Proxy/Worker接入现有单实例维护和Watchdog后按原流程发布；不能仅复制JAR就改正式路由。相机0.4.11可独立部署，无代理时普通拍照照常运行。更新远端可视化：拉取 `mc-visual-console`，用其原1.20.6 `qiandengji` 资产路径重建，再重启原宿主，核验提供的bundle摘要；源码推送不等于远端已生效。

来源：[官方模型类型与加密限制](https://yesstevemodel.github.io/wiki/type/)、[原格式](https://yesstevemodel.github.io/wiki/struct/)、[原生热重载命令](https://yesstevemodel.github.io/wiki/command/)。

---

# YSM 适配：第一阶段隔离候选

2026-10-10。正式服仍为 Paper 1.20.6 / AgentFriend 0.4.10；本次没有部署、重启正式服或开放公网接口。实现位于 [freesia-optional](../integrations/freesia-optional/README.md)，共享网页实现位于 `jcs130/mc-visual-console`。

## 已实现

保留 Paper 和原 Agent 客户端，在现有身份网关之后加私有 Velocity/Freesia，另用 Fabric 1.21.1 Worker 处理 YSM 2.4.1。未安装 YSM 不踢人，普通 Mineflayer 不下载模型缓存；Geyser 暂时沿用原 Paper 路径。

- 模型设置关联实际玩家 UUID 和 Paper 实体 ID；实际 Worker NBT 确认生效。
- 控制台可分配 Alex/gsl、Steve/tartaric_acid、default_boy/blue 或 red；普通客户端可查询本人状态与目录，不能改别人模型。
- Worker 中断时继续游戏和登录；重启后限频恢复模型连接，不要求 Agent 重新登录。
- Worker 控制连接异步重连并在正常停服时清理，修复原版退出后的 Netty 线程残留。
- 原 Minecraft 连接发送只读 `mcagent:appearance` 元数据。共享 Web 适配校验版本、原 JAR 摘要、UUID 和实体 ID，并清理失效/换维度/断线状态。
- 每五秒刷新，网页宿主十五秒过期；网页故障回调不会打断游戏协议处理。

## 客户端边界

| 客户端 | 本阶段实际验证 | 仍待完成 |
| --- | --- | --- |
| 普通 Java / Mineflayer 1.20.6 | 登录、原 UUID、移动、玩法查询、实际大背包取放、死亡复活、不收 YSM 模型缓存 | 正式入口切换及长期游戏负载 |
| 已登记 Eye | 显式原生附身后 spectator/camera ID 正确；自己的连接跟踪到主人并收到模型状态 | 原机 watcher 经新正式入口的回连验收 |
| Java 1.21.1 / YSM 2.4.1 | ViaVersion 路径上的协议夹具实际完成握手并收到模型状态包 | 匹配模组客户端的真正模型画面、动作和装备 |
| Web 现代画面 | 接到真实 Worker 状态、正确绑定实体；1.20.6 候选 bundle 构建成功 | 原模型/UV/动画渲染、Java 对照、远端消费者更新 |
| 基岩 / Xbox | 隔离 Geyser UDP 入口响应，路由保留 | 真实认证登录/操作，以及独立的自定义玩家模型转换 |

网页明确显示模型尚未渲染，`renderAvailable=false`、`completeEntityParityVerified=false`。基岩目前显示普通皮肤；不能将资源包下载能力或 Geyser Pong 当成 YSM 模型兼容。

## 隔离验收

独立存档和回环端口，未调用 LLM。完整联机回归 **29 项通过**：身份/来源拒绝、原玩法 CLI、背包实际取放、移动、显式 Eye 附身、真实 Worker 模型、1.21.1 YSM 协议夹具、Worker 停止/恢复、16 个普通 Agent 同时查询和模型同步、死亡复活后的网页状态重建、Geyser Pong。

当时共 20 个受控连接（16 个负载 Agent、主人、同伴、Eye 和 YSM 协议夹具），最近五秒 Paper tick 平均 **4.9 ms**、最大 **15.8 ms**；一分钟最大 **66.2 ms**。这是一轮已加载区域的短测试，不代表 16 个 LLM 长期自主探索或新增 Worker 没有资源成本。

同一最终 build-af6 的正常冷重启共 **6 项通过**，实际保留原 QA 玩家 UUID、default_boy/blue 模型和 Minepacks 内三枚苹果，并成功取回。早期版本也曾重新登录核实三枚苹果在玩家库存、背包内为零；最终轮次复用了这三枚物品，没有补发。

保留失败记录：早期恢复只重试一次，因控制连接早于 Worker Minecraft 端口而失败，已改为五秒重试；第一次死亡轮询错过快速复活，第二次原版 kill 被原保护规则取消，最终用管理端 Essentials kill 触发实际死亡/复活事件。冷重启取出后立即读 `bot.inventory` 读到了旧窗口缓存，失败断言照留，重新登录后实际库存与背包证明取出已完成。

共享 Web 新增 **5 项**测试通过，连同原内容/声音桥接相关回归共 **26 项**通过、零跳过；根目录配置的 TypeScript 检查通过。单独强制检查旧 `mc-modern-viewer.mts` 时，基线与候选均有 **39 项既有类型错误**；新字段没有增加错误，不能把根目录检查称为所有宿主源码类型无误。

私有原始回执：`E:\MC\research\paper-ysm-20261010`，含每次失败、构建来源和最终哈希。最终 build-af6 补充了旧会话迟到回调的身份校验，并重新通过完整 29 项回归；早期 build-af4/af5 及其失败回执保留。第三方 JAR、存档、原图和运行回执均在 Git 外。

版本、源码及产物摘要见 [候选清单](../manifests/ysm-optional-candidate-20261010.json)。这是构建和隔离验收记录，不是上线公告。

## 下一阶段

1. 用匹配的 Java 1.21.1 / YSM 2.4.1 客户端对照真正的几何、UV、动作、装备和观战画面。
2. 为共享网页增加独立 2.4.1 原资产清单和模型映射，再接原模型渲染。已逐字节比较三组内置 CC0 资产，可复用一致的文件；不能把整个 2.4.1 协议直接当作原生服 2.6.5。
3. 单独实现并真机验收 Bedrock 玩家模型及资源包；先核查玩家实体的转换入口，再选择 Geyser 扩展方案。
4. 将私有 Proxy/Worker 接入现有单实例维护和 Watchdog，保持旧网关身份来源限制、Geyser/Floodgate UUID、所有存档与玩法数据，然后按原流程备份、预告、切换与发布复核。

发布与回退以 [维护流程](OPERATIONS.md) 和集成 README 为准；本候选尚未接入正式维护任务。

来源：[Freesia 架构和配置](https://yesstevemodel.github.io/wiki/freesia-plugin/)、[锁定发布](https://github.com/YesSteveModel/Freesia/releases/tag/v2.5.1%2B2.4.1)、[Geyser 实验实体 API](https://geysermc.org/wiki/geyser/custom-entities/)。
