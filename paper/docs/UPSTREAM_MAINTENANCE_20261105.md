# 2026-11-05 上游更新与实际部署状态

本轮跟进现有 Minecraft **1.21.1** 链路，不迁移到新的游戏大版本。服务器内置 harness 的 MC 核心已在闲置时更新；游戏内核、Numen、HarnessRouter 和其他插件仍保留现役版本。**候选文件和测试通过不等于正式上线。**

## 版本核对

| 组件 | 现役版本 | 本轮核对的上游 | 处理结果 |
| --- | --- | --- | --- |
| Youer | build 920 / NeoForge 21.1.252，含本服持久化与重生修补 | 1.21.1 分支 `36f451ca` / NeoForge 21.1.265，官方 CI #852 | 已下载、固定摘要，完成针对性实机测试；保留重生修补，尚未替换正式内核 |
| Numen 服务端假人 | API `0.1.4-qd-youer2`、内容插件 `0.1.4`，含本服身份、任务恢复和客户端兼容修补 | 源码 `19c8710b`；版本字段仍为 0.1.4，较旧上游基线多 557 次提交 | 构建和 JVM 测试通过，但实机发现重复身体、解散 ABI 不兼容；暂不替换 |
| 内置 harness 的 MC 核心 | **已由 preview.15 更新到 `0.5.7-rc.160-preview.18`** | 主干打包核心，来源 `9d8be3bb` | 已安装并回读；原控制器、适配层、账号和记忆保持 |
| HarnessRouter 服务 | 0.35.13 | **0.38.2** | 新镜像已下载，断网隔离副本完成资料迁移及接口检查；正式服务未重启 |
| autonomy 控制器 | 0.1.27，带原 HarnessRouter 适配 | 主干 0.2.153 | 新版缺少原专用适配模块，不能直接覆盖；保持原控制器 |
| Geyser | 2.12.1-b1280，含 Youer lambda 修补 | **2.12.1-b1289** | 新构建保留同一兼容修补，4 项功能夹具通过；尚未部署 |
| ProtocolLib | 5.3.0 | **5.4.0** | 官方摘要已校验，隔离组合检查；尚未部署 |
| Multiverse-Core | 5.8.1 | **5.8.2** | 官方摘要已校验，隔离组合检查；尚未部署 |

已核对且当前 1.21.1 链路未发现更新：YSM 2.6.5、车万女仆 1.5.3、Simple Voice Chat 2.6.27、VortexRPG 1.2.2-alpha、ViaVersion/ViaBackwards 5.12.2、Floodgate 2.2.5-b141、AuraSkills 2.4.0、EssentialsX 2.22.0、TAB 6.2.1、SkinsRestorer 15.12.6。这里按加载器、游戏版本及发布渠道筛选，包含既有 beta/alpha；不表示全服所有第三方插件均已完成更新验收。

上游依据：[Youer 成功 CI](https://github.com/MohistMC/Youer/actions/runs/41847765891)、[Youer 常规构建列表](https://api.mohistmc.com/project/youer/1.21.1/builds)、[Numen 固定源码](https://github.com/Dwinovo/minecraft-numen/tree/19c8710b014260bb810dd0fe8f85f054fb6decf5)、[Numen 1.21.1 发布](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta)、[HarnessRouter 0.38.2](https://github.com/HarnessRouter/harnessrouter/releases/tag/v0.38.2)、[ProtocolLib 5.4.0](https://github.com/dmulloy2/ProtocolLib/releases/tag/5.4.0)、[Geyser b1289](https://download.geysermc.org/v2/projects/geyser/versions/2.12.1/builds/1289)、[Multiverse 5.8.2](https://modrinth.com/plugin/multiverse-core/version/de7TbcZG)。

其他组件依据：[YSM](https://modrinth.com/mod/yes-steve-model/version/HZWaR0LY)、[女仆](https://modrinth.com/mod/touhou-little-maid/version/tXG1TkGx)、[语音](https://modrinth.com/plugin/simple-voice-chat/version/3Br8wxJY)、[Vortex](https://hangar.papermc.io/Asuuna_Yuuki/VortexPRG/versions/1.2.2-alpha)、[ViaVersion](https://github.com/ViaVersion/ViaVersion/releases/tag/5.12.2)、[ViaBackwards](https://github.com/ViaVersion/ViaBackwards/releases/tag/5.12.2)、[Floodgate](https://download.geysermc.org/v2/projects/floodgate/versions/2.2.5/builds/141)、[AuraSkills](https://modrinth.com/plugin/auraskills/version/9rSJ3THD)、[EssentialsX](https://github.com/EssentialsX/Essentials/releases/tag/2.22.0)、[TAB](https://github.com/NEZNAMY/TAB/releases/tag/6.2.1)、[SkinsRestorer](https://modrinth.com/plugin/skinsrestorer/version/ziIzW16f)。

## Youer：已修好的上游问题与仍需保留的补丁

此前提交的 [#596](https://github.com/MohistMC/Youer/issues/596) 和 [#597](https://github.com/MohistMC/Youer/issues/597) 已关闭。本次对实际官方产物进行两次正常启动/停止，确认：

- 已加载区块、新生成区块，以及重启后已存盘但未加载的区块，异步 API 都返回真实区块。
- 持久村民的合成 UUID 跨重启保持；非持久村民不再被保存恢复。

常规构建 API 仍列 build 920，新版是成功的 **CI 产物**，不能写成常规渠道已经发布的新 build。ZIP、启动包和安装后的库均独立固定摘要。

未修补的新内核仍复现普通死亡后没有位置包、没有传送确认、物理更新为零。只对新库的 `PlayerList.class` 应用已审查的重生连接绑定修补后，实际客户端收到位置、确认传送，并完成 37 次物理更新和服务端观测的行走；其他 2,539 条归档记录内容保持。未把此前实体持久化补丁重复套入新版。

[重生构建器](../integrations/youer-respawn-position/build.py) 仅接受两组已核验的“启动包＋原库”摘要，拒绝未知或已修补输入。[Geyser 构建器](../ops/build-geyser-youer.py) 同样只接受 b1280 / b1289 的精确官方摘要，并检查 lambda 类内容不变；b1289 只改一个类的一处方法，20,906 条其他归档记录保持。两个构建器只产出候选，不安装或重启服务。

两个候选重复构建摘要相同，已修补输入均在产生输出前被拒绝。五份候选与五份当前代码回退件在 E/F 两盘核验；这只是代码材料，不代替维护当天的当前玩家/世界冷备。

## 新内核组合验收还未通过

隔离服加入现役四份内容/兼容模组、现役 Numen 修补版、ViaVersion/ViaBackwards 5.12.2 及三个插件候选。已确认普通 Java 协议连接、原 Numen 身体的大小写复用和解散、ProtocolLib 的原生效果包克隆正常。Geyser 显式启用双传输模式后，回环旧 UDP 查询返回协议 2225 / 26.60；这不等于真实手机或 NetherNet/WebRTC 登录成功，也不能覆盖另一维护会话的移动端配置。

多世界列表却出现 `UNLOADED`，日志报 `WorldConfig for world minecraft:the_end already exists`。同一新内核和模组组合改用现役 Multiverse 5.8.1 作对照：空配置首次导入能正常列出主世界、下界和末地，但正常停机重启后也出现登记异常。因此不能简单认定是 Multiverse 5.8.2 单独引入；更不能只看插件绿色或 `/mv list` 包含 `world` 就认为正常。组合结果明确为失败，跨重启维度登记必须先修复并验证现役配置迁移，再发布新内核。

初轮遗漏现役 native-platform 依赖，导致合成 Numen 身体缺少 `HybridBodyChunks`；补齐原依赖后通过。另一次探针未接受 RCON 发送者，实际没有发出药水效果；修正探针后克隆通过。这两项是测试准备错误，原回执保留，不算作上游缺陷。Geyser 默认的 NetherNet 不响应旧 RakNet ping，不能把这一点直接归为基岩掉线；测试只在独立回环端口切换双传输，正式配置未动。

## Numen：不能凭相同版本号直接覆盖

最新源码已引入新的服务端决策循环、记忆、事件与 MCP 接口，仍沿用 0.1.4 版本字段。官方最近的 1.21.1 release 是 0.1.4.1-beta，发布资产主要是 Fabric/NeoForge 客户端；没有可直接替换本服补丁版的官方 Paper 产物。

本次从固定提交构建 API/内容两个 Paper JAR，`check` 通过，完整 JVM `test` 为 **2,992 项、零失败/跳过**。第一次依赖解析因 Maven DNS 失败中止，网络恢复后才完成；没有把依赖失败算成代码测试失败，也没有声称 Fabric/NeoForge GameTests 已执行。

使用全新隔离世界、合成主人和假人，在最新 Youer 上复现：

1. `QaNumenBody` 可以创建并领取合成测试物品；随后召唤 `qanumenbody` 又产生一个不同 UUID 的身体，两者同时在线。上游名册仍按大小写敏感匹配。
2. `numen player despawn QaNumenBody` 抛出 `PlayerList.remove(ServerPlayer)` 返回类型不匹配的 `NoSuchMethodError`，身体未退出。这里是 Paper/Youer ABI 差异，不能靠忽略错误处理。

原始测试脚本退出码不能单独表示通过：它记录了 `sameIdentity=false` 和解散后身体仍在线；以上以实际名单、UUID 和异常栈判断。测试服随后正常停止，没有改正式假人或真实玩家物品。

还需移植和验收的既有行为包括：大小写无关身份及恢复、旧客户端协议桥、主人权限和个人密钥、Youer 退出/区块兼容、生命周期回执、旧 Lua 只保留复核而不自动重派。上游新任务恢复会从头重跑保存的脚本，不等于本服 PR58 的安全恢复策略。迁移前必须用合成的旧版名册、任务与物品完成重启/回退验证；不能直接带真实注册表试跑新循环。

## harness：身体已更新，路由服务是单独候选

内置 MC 核心安装前确认控制器闲置，原适配层与 profile 完整摘要保持。打包校验及安装前后旧控制器的真实 MCP 进程检查通过：发现 43 个工具，执行 8 次离线调用，包含明确的断线/非法调用拒绝。检查没有连接游戏、没有调用模型；这不代表完成真实飞行、语音或自主冒险验收。E/F 均保留原包，原控制器仍为 0.1.27，公共 Skill 与远端客户端没有被自动升级。

主干 autonomy 0.2.153 不再提供原部署入口依赖的 `harness_router` 模块，不能直接替换旧控制器。其独立测试结果为 1,924 通过、25 跳过、6 失败：2 项 Windows 长路径测试夹具未到达被测逻辑，4 项受当前 Windows DPAPI 拒绝影响。没有使用真实密码或引入明文凭据回退，也没有把这批结果记成全绿。

HarnessRouter 0.35.13 → 0.38.2 在**网络关闭、无对外端口、独立数据卷**的副本中验收。使用 SQLite backup API 获取一致性副本，保留原密钥；不直接复制运行中裸 DB 来推断迁移成功。结果：

- 100 条控制记录身份集合保持，差异只有 3 条系统心跳时间；65 条图顶点及 64 条边内容完全一致。
- SQLite 完整性通过，服务报告凭据加密启用。
- 带原鉴权的 UHP 查询返回 0.38.2，仍支持 `2026-09-28`；缺失/错误凭据访问 harness 列表均为 401。
- 隔离容器随后正常发送 TERM 停止（退出 143）；正式 Router 仍健康、重启计数保持 0。

没有执行真实供应商任务或逐个验收 23 种 harness；健康接口不能代替这一项。正式切换前还需校验原适配器的创建/取消/流式回执、维护窗口和当前一致性备份。新版本会迁移凭据存储，旧镜像回退必须使用对应备份及原密钥，不能假定旧版可读取新版数据卷。

## 发布边界

本轮没有请求或消费新的正式游戏维护入口。发布前须按 [OPERATIONS](OPERATIONS.md) 完成现役基线核对、完整插件/模组与跨端组合验收、E/F 当前代码及冷备、真人/副本门禁和维护预告，再正常停启。不得重放已经消费的城门维护入口；不得覆盖其他会话正在处理的登录/移动端候选。

公开摘要见 [版本与证据清单](../manifests/upstream-maintenance-20261105.json)。私有测试日志、数据库、访问密钥、真实 profile 和构建产物不入 Git。
