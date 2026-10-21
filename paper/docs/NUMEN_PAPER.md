> 2026-10-20 最新：常驻角色已切换为原 `ag_Kirito`，由 QwenPaw 控制；原星灯离场保档。见 [桐人正式接管](KIRITO_QWENPAW.md) 和 [原生能力核验](KIRITO_NATIVE_QWENPAW.md)。下文此前常驻发布段落保留历史。

## 当前状态更新（2026-10-21）

现役 **Paper 1.21.1 build133 / AgentFriend 0.4.47.10 / Numen 0.1.4 / NumenBedrock 0.1.0**，Numen API `3ccb46aa`；已兼容官方 Fabric 0.1.4/0.1.4.1。原版 Java 客户端不必安装 Numen 即可入服；完整 Java 设置面板可用官方 Fabric Release，也保留原配套的 1.21.1 模组包。基岩沿用 `/numenmenu`，原协议 3 与端口保持。最新完整双盘冷备份为 `20261021-190408`。正式核验和回退见[本次发布记录](../manifests/numen-release-compat-release-20261021.json)；此前消息降噪与自主运行修复见[前次发布说明](MESSAGE_AUTONOMY_RELEASE_20261021.md)。下方历史候选与暂停描述按当时时点阅读。

### 客户端分流、费用归属和通用框架（2026-10-21 追加候选）

**协议自动分流已经上线；下述新增 CLI 和共享 Key 限制是追加候选，尚未部署。** 线上只读检查确认 `server/keys` 为空，没有全服共享模型 Key；桐人沿用专用主人的私有凭据。不能根据有一个服务端模型档案，就认为所有人都可免费使用该模型。

| 接入方式 | 谁运行 Agent 循环 | 设置入口和资料位置 |
| --- | --- | --- |
| 官方 Fabric／NeoForge 0.1.4、0.1.4.1 的旧协议 | 玩家电脑上的原生循环，或玩家本机接入的外脑 | `/numen settings`；玩家电脑 `config/numen/`，Key不从服主复制 |
| 配套当前协议3客户端 | Paper 里的原生循环，或获授权的外部驾驶者 | `/numen settings`；服务器上本人 UUID 的资料和钥匙串 |
| 原版 Java、Mineflayer、基岩 | 服务端原生循环，或获授权的外脑；这些客户端本身不需要装Numen | 原生命令；基岩另有 `/numenmenu` 表单 |

识别依赖实际登记的频道与 Hello 协议，而非只看模组文件名。两款官方旧版布局相同，共用同一条已验证线路；未知协议不发送无法解码的面板包。新版优先原生握手，旧版按四个专属频道识别，基岩由 Floodgate 识别。不会因一次连接同时开两套模型循环，MCP驾驶优先；断线不重放未决动作。

新增命令对普通玩家开放，结果仅发本人；同伴身体不能用这些管理命令。查询不召唤、不绑定、不测试模型、不消费模型额度：

```text
/numen help
/numen status
/numen model list [页码]
/numen model set own custom chat "你的模型名" https://你的服务地址/v1
/numen player summon MyCompanion
/numen companion MyCompanion profile my:own
/msg MyCompanion 你好
```

`model set`只更新本人的 `my:<档案名>`，重复调用不新建 `_2` 条目，保留面板设过的上下文、输出预算和兼容项；通过原生库保存后，在原写车道回读文件再确认。URL不能携带用户名、密码、查询串或片段，Key单独配置。`model list`每页五项，不输出端点或Key明文；`status`区分身体、驾驶者、模型绑定、阻塞原因和共享费用授权。原版 `/numen settings` 自动返回CLI入口；基岩继续显示表单；旧版 `model set`明确提示改本机设置，不写一份实际不会使用的服务端档案。

Key仍用原生本人钥匙串：基岩通过 `/numenmenu` 输入，当前版Java通过设置面板，原版可用原有 `/numen key <服务商> <Key>`。**Paper可能记录斜杠命令，命令输入也可能出现在直播/客户端历史中**；模组/表单路径不把Key拼入命令。服务端本人Key由服务器保管，服主可读取；官方旧版的Key由玩家电脑保管。

追加候选对专用服引入 `server/server.json` 的 `sharedKeyOwners: []`，缺省不允许任何主人回退使用共享Key；只接受服主明确配置的主人UUID。原本人的Key始终优先，删除本人Key后也不借服主的；模型检查和个人MCP连接复用相同取Key策略，界面的“可用Key”跟实际费用授权一致。配置缺失、损坏或UUID表无效时保持关闭。单人世界沿用原本机共享行为。桐人的私有凭据和QwenPaw绑定保持，不把桐人的主人加入普通玩家的Key目录；本次没有给任何其他玩家配置Key或提交真实模型请求。

### Numen API、QwenPaw 与 DSH 的职责

Numen API负责身体、事件、脚本执行、任务槽和权限；Numen内容提供寻路、感知、Lua工具等。完整的Agent框架可以在服务器电脑的独立进程里运行，**不必嵌进Paper JVM**。桐人当前就是独立QwenPaw进程通过本机Numen MCP驱动原身体，QwenPaw负责模型、记忆、会话、目标和子Agent，Numen负责游戏执行。同一身体只允许一个驾驶者。

其他支持MCP的框架可使用同一接口：主人用 `/numen token create brain <同伴名> 30` 获取自己身体的作用域令牌，外脑初始化MCP，读取 `tools/list`，通过 `list_companions`、`get_events`、`say`、`lua` 等实际工具交互。`brain` 是外脑自己思考、自己付费；`channel` 只把人的消息交给内脑，仍会使用该主人已配置的模型，二者不能混用。令牌不是模型Key，也不赋予OP、别人的身体或绕过领地的权限。

已核查 [jcs130/dsh-minecraft-agent](https://github.com/jcs130/dsh-minecraft-agent) 的 `src/mc-harness.mjs` 和 `src/harness-bridge.mjs`：目前创建 `agent-mc-world` 的独立Mineflayer身体，并通过内存MCP传输 `agent-mc/v1` 工具。DSH框架的会话、模型、预算和记忆可复用，但**现有Minecraft适配器不是Numen驱动**，不能只换一个端点就声称接好了。接Numen时应另选Numen MCP驱动，保留DSH原生循环，按Numen实际工具Schema、事件和异步回执适配；不要再为同一角色启动Mineflayer身体或把 `mc_do` 原样发给Numen。此轮仅审查DSH，未修改其仓库、安装进程或接管任何现役Agent。

官方旧客户端的“外接大脑”入口在本机 `G → 设置 → 外接大脑`，能让其他MCP框架驾驶同伴，原内置循环暂停。该MCP端点、令牌和资料归玩家电脑，和Paper服务端端点的令牌不通用；游戏客户端需要保持连接。QwenPaw、DSH和其他框架均使用各自的模型配置与Key。现有服务器MCP只在本机使用；此轮不新增公网端口，也不把本机接口当成公网玩家可直连的服务。

实现源码：[0b3e1bab9](https://github.com/jcs130/minecraft-numen/commit/0b3e1bab925b1c5aa2a9d27d43cf90bdc58a1241)，在已上线兼容基线 `b134eb01e` 上追加。可重放补丁为 `paper/integrations/numen-paper/patches/owner-cli-personal-keys.patch`，已经用独立Git索引验证重放树与提交相同。构建器 `build-owner-cli.py` 固定生产API `3ccb46aa`，只覆盖6个现有class、新增2个，其余1238个原条目逐字节保留；最终候选API SHA256为 `4b36f166b3f7c7f380a297c24a1f8bcd0fe9836ea0365c2da5993bc33792b313`，内容、桥接、角色和玩家资料不随本包改动。

验证：五个核心模块共1772项JVM检查、Fabric和NeoForge构建通过；最终候选与正式内容JAR的25项Paper联机检查全部通过，另有8项原生MCP GameTest通过，包括归属、事件、回执、权限和断线清理。联机覆盖无模组设置入口、私有反馈、档案落盘及重复更新、本人模型真实往返、共享/跨用户Key拒绝、无效URL、旧版本机模型提示，以及既有私聊、权限、行走、断线和回执场景。测试只用本地假模型和假Key。初轮相对URL触发的空值异常已修复；首次联机3项失败来自夹具突发命令触发原版反刷屏、清理未完成影响后续同名同伴，以及读取下一tick之前的旧状态。保留失败日志，夹具按正常节奏发送、同主人只设置一次测试Key，阻塞验证重新查询真实状态；未放宽服务器反刷屏或验收断言。

候选与回退在 E/F `repairs/numen-owner-cli-20261021/`；待本次维护确认后，沿原预告、真人/副本检查和完整双盘冷备份流程正常更换API。回退也先正常停服和备份，再恢复 `3ccb46aa`，保留新增的个人档案、Key和世界数据；不要恢复旧玩家存档。旧API不执行新增共享授权策略，回退时仍须保持共享Key目录为空。没有提交待部署队列，没有用 `/reload` 替代更新，没有在本次新增公网接口。未做手机/Xbox真机、16个自主模型、DSH原生Numen驱动或公网MCP接入验收。

### 此前的官方旧客户端入服断线修复（6684d9e3，已被下节替代）

服主批准后，经 180/60/10 秒通知、真人退出和副本/PvP 检查，原维护任务完成 E/F 冷备份 `20261021-164816` 并只替换 API JAR，任务结果 0。正式 21 项状态/备份检查、8 项认证协议检查与 19 项同伴身份/物品核验通过，桐人原生心跳已恢复；更新说明已发。初次维护被长名单截断拦截，之后通过维护暂停协调女神守护程序，完整名单验证成功；未绕过真人门禁。见[发布记录](../manifests/numen-legacy-client-release-20261021.json)。


官方发布的 `0.1.4`、`0.1.4.1` 客户端与这里固定源码构建的客户端虽然版本号接近，协议并不相同。旧版登记 `numen_api:companion_list`，但同伴名册每行没有新版 `removedFor` 字段，也没有 `hello_ack` 握手频道。Paper 原先只检查同名频道，向旧版发了新格式；用官方 0.1.4 NeoForge 解码器验证，空名册剩余 0 字节，有一个同伴时剩余 1 字节，与玩家的断线报错一致。重装客户端不会清除服务端名册，所以仍然会断线。

修复仅在 Paper 发包前要求同时登记握手频道与目标频道；不能等待 Hello 成功再发首次名册，因为当前客户端收到名册才发 Hello。无模组和旧客户端可继续用服务端命令；完整面板仍须下文匹配的客户端包，不承诺兼容旧版客户端大脑。不要删除真实同伴或重置玩家数据。

上游 [PR #142](https://github.com/Dwinovo/minecraft-numen/pull/142)，提交 `493e0564a3e175fef2c71d16280f5b04b691452b`。1727 项 JVM、8 项真实 Paper E2E 全通过且无跳过；未修复版本的旧频道测试已复现失败。正式候选在现役 API 上仅替换 `PaperNetworkChannel.class`，其他 1219 个条目逐字节保持，并通过 4 项隔离联机（原版、旧频道重连保持同伴 UUID、新版握手及模型检查、私聊模型回复）。没有启动图形客户端验证画面。

候选 SHA256 `6684d9e36d40bcf9a3b651a278fe978c9108f141fbecab8add03701a1496ef2c`；上一版回退为 `fb4e7a8656cb4f1226c13b1b1f04bf45816fedc781c0ccc9f5df6ffc1d5daa78`。候选、回退与回执位于 E/F `MC/ops/repairs/numen-client-owner-20261021/`，见[候选清单](../manifests/numen-legacy-client-candidate-20261021.json)。本次已正常重启上线；冻结候选清单保留构建时状态，以本节发布记录为准。回退只在正常停服后恢复旧 API JAR，保留玩家和同伴目录，不覆盖旧世界。

小鱼的模型连接另行核实：已保存的新同伴绑定有真实模型回复和工具回执，保存的模型配置也通过原生 Java 流式调用。后续“another program is already running”是程序占用提示，不能当作 Key 无效；本兼容补丁不修改模型配置或执行槽。

### 官方 Release 兼容已上线（2026-10-21）

**已正常重启上线。** 正式 API 为 `3ccb46aadf19b425392b9a0f197b546a4d51a86e000a18bf097024121c3be33f`，回退为 `6684d9e3`。维护前等待可米的墓穴场次正常结束，重新180/60/10秒预告；E/F完整冷备份 `20261021-190408` 后仅替换API，任务结果0。正式21项状态/备份、10项协议和19项物品/归属核验通过，桐人原生日常已恢复。见[发布记录](../manifests/numen-release-compat-release-20261021.json)。现在根据官方旧客户端独有的频道组合识别协议族，新版仍走原 `hello_ack`/协议3，原版 Java 不必装模组，基岩仍用 `/numenmenu`。

核对目标是官方 [0.1.4](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4-1.21.1-beta) 与 [0.1.4.1](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta) 的 MC 1.21.1 发布包。对应源码提交为 `26911f83046bc2e2f8d9053707ee1f8e553582ba`、`2a5753cbde3edd342fb50e0b2a4d52dff4269d38`；两者 `api/.../network/payload` 的 25 份源码完全相同，可以按同一协议族处理。Fabric 原始发布 JAR 摘要分别为 `2ab47063de770c9baf86d2beedeb4530f6bfa89f7f4dba30babcbcb22217d4a6`、`ccc0806fd04cf3404dbc39f7579a4d7c20cd1362d06dce358850f5fdaf711a41`。与正式客户端固定基线 `7c931600c2269d21216bb6f9090588cdbe0beb01` 比较，两边各 25 种载荷源码：共有 15 种，其中 11 种的 record 声明与 codec 源码一致，4 种存在差异；另各有 10 种独有载荷。这是源码审计结果，不等于全部载荷已经运行验收。

| 范围 | 核对结果 | 服务端适配要求 |
| --- | --- | --- |
| 握手与界面 | Release 无 `hello`/`hello_ack`；界面动作枚举也有位移 | 独立识别旧连接；允许 `/numen settings`，正确转换设置与调试开关，不伪造新版 Presence |
| 同伴名册 | 新版每行多 `removedFor`；旧客户端将“不在名册”视为永久遣散，并删除本机对应资料 | 输出旧版行结构，保留本世界所有仍存在的同伴 UUID；被移出、死亡、未加载均不能简单从兼容名册删掉 |
| 召唤和换肤 | Release 的召唤带 `name, skinValue, skinSig, creative`，当前只收 `name, creative`；旧版另有 `change_skin` | 分别解码并转换到原生召唤/皮肤接口；保持名称、归属和创造模式权限校验，检查整包已读完 |
| 模型、记忆与设置 | Release 的 Agent 循环、模型档案、Key、会话和 Lua 模块在玩家客户端；当前版本把它们迁到了服务端 | 官方客户端继续管理自己的原生设置；不因打开界面把服务端其他人的 Key 或资料下发，也不声称两端历史已自动合并 |
| 执行与回执 | Release 使用 `run_program / program_result / stop_program / cancel_tasks`，当前不再登记这些入口 | 在旧协议边界适配到现有 `ServerPrograms`、身体和权限层；复用当前执行器，按真实执行结果回复，不能只打开界面就称已适配 |
| 模块和客户端回调 | 旧 `ClientCallResultPayload` 末尾还有 `Optional<ModuleSet>`，当前没有；旧模块按内容指纹补发 | 保留缺模块时尚未执行的语义；模块放在对应旧连接的作用域，不能无条件覆盖服务端现有模块/记忆；未知执行结果不自动重放 |
| 控制互斥 | 旧客户端本身会运行模型循环；服务端现有循环及桐人 QwenPaw 驾驶仍存在 | 扩展现有 `EXTERNAL` 驾驶判定，按同伴 UUID 只允许一个驱动；旧客户端不得抢占其他外脑；断线撤销自己的执行、回调和控制资格 |
| 事件与生命周期 | Release 需要 `current_task / numen_event / numen_death / numen_respawn / path_debug` | 转换实际任务、事件和死亡复活；路径布局相同，映射 `numen:path_debug` 到旧 `numen_api:path_debug`，不让两套大脑重复消费主人消息 |

可复用当前 `OwnedBody` 的 UUID 归属校验、`ServerPrograms` 的 Lua 沙箱/并发/主线程预算、既有身体操作与保护权限、`CompanionRoster`/背包快照，以及现有外脑互斥的生命周期语义。`McpMode` 的连接资格绑定 HTTP 令牌，不能直接伪造一个 MCP 会话来代表游戏客户端；旧客户端应有独立且受同一驱动仲裁约束的连接资格，无需为此开放公网端口。

最初的 8 项解码诊断保留在 `E:/MC/ops/repairs/numen-client-owner-20261021/`。本次实现与验证材料位于 E/F `repairs/numen-release-compat-20261021/`，发布摘要见 [兼容候选清单](../manifests/numen-release-compat-candidate-20261021.json)。

已完成的检查：

- **未改动的官方 Fabric 0.1.4 和 0.1.4.1**，各用独立正式运行环境启动 Java 21、Loader 0.18.1、Fabric API 0.116.7。实际打开设置并检查截图；客户端原生循环调用本地测试模型，发送 Lua，身体走到目标后收到真实回执并继续模型下一轮。测试辅助模组只操作入口，不替换官方 Numen JAR 或其网络实现。
- 最终 API 候选搭配正式正在使用的内容 JAR，通过 **20 项真实 Paper 联机检查**：原版玩家、新版晚握手、旧版设置/召唤、名册/背包归属、私聊事件、Lua 模块、缺模块补发、长消息分片、实际行走及路径频道、停止、权限确认、重复丢物不重执行、延迟回包、断线重连、死亡复活、换肤后的原 UUID 与物品保留。
- **15 项官方 NeoForge 发布 API 原始 codec 的双向检查**：召唤、换肤、执行/停止/取消、两种模块回调、任务、事件、死亡复活和0/1/2行名册，均完整消费字节。没有运行完整 NeoForge 图形客户端；不能把该项称为 NeoForge 真机验收。
- **1753 项 JVM 单元测试、8 项原生 MCP GameTest，Fabric/NeoForge 构建均通过**；基岩通过独立插件组合的 **11 项实际表单协议检查及正常冷启动后的3项回读**。基岩不是手机/Xbox真机画面验收；没有验证16个自主模型长期负载。

第一轮图形夹具曾把模型请求末尾的运行时摘要当成工具回执，另有 Windows 锁住重复提取的 GLFW DLL；修复的是测试断言和夹具进程清理，保留失败日志。隔离基岩夹具最初遗漏 ViaVersion，补齐与正式相同的版本转换插件后重测通过。正式服未因此修改配置。

上线后的官方客户端使用方式：

1. 安装 Java 版 MC **1.21.1** 对应的官方 [0.1.4](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4-1.21.1-beta) 或 [0.1.4.1](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta) Fabric JAR，保留匹配的 Fabric API，移走重复的 Numen/Numen API 模组。
2. 正常完成服务器原登录认证，用 `/numen settings` 或官方快捷键打开界面，配置**本人客户端上的**模型地址和 Key，再召唤或选择自己的同伴。
3. 官方旧版的模型、模块、对话和记忆由原客户端管理；服务器上的当前版档案不会自动复制到旧客户端。模型请求中的 `127.0.0.1` 此时指玩家电脑。基岩菜单和配套当前版客户端仍使用服务端模型资料，二者位置不同。

旧客户端是独立外部驾驶者，当前原生 MCP 控制优先；不会接管桐人 QwenPaw 或其他主人的同伴。模块只缓存到对应连接，不覆盖服务端模块/Key。所有身体动作仍经原生执行器、权限和并发门禁。退出取消本连接程序与回调；任务回执只发本人专用频道。

防重回执在内存中保留，退出后最多保留一小时；至多64个主人历史、每身体2048个程序编号，每主人回执正文至多2MiB。满额拒绝新程序，不淘汰旧编号后重做动作；需要安排维护或离线过期清理。重启不保存这张防重表，不能把它当作跨崩溃的永久事务日志，客户端对结果未知的动作仍须查询后处理。

复现：源码已推送至 [兼容提交 b134eb01e](https://github.com/jcs130/minecraft-numen/commit/b134eb01e86928ff94ca3b823b8f9ce04ab17097)，生产基线提交为 `dc6465a3d2c6dc41b16147222fb997a65587a351`。补丁 `paper/integrations/numen-paper/patches/official-release-client-compat.patch` 相对于该基线，已验证重放后整棵源码树一致。先运行 `datagenAll`，再按 CONTRIBUTING 执行单元测试、Paper E2E 与 RemoteBrain GameTest。原始官方 JAR 图形测试单独用 `:numen:paper:officialClientTest`，参数 `-PreleaseClient.python/java/official/fixture/cache` 分别指定 Python、Java、官方 JAR 目录、测试辅助模组与 Mojang/Fabric 缓存；辅助模组用 `gradlew -p numen/common/src/e2e/client remapJar --no-daemon` 构建，不发布给玩家。

生产候选使用 `build-release-compat.py --baseline <现役6684 API> --compiled <构建API> --output <新候选路径>` 生成：只覆盖15个实际变化的 class，新增24个 class，**其余1205个原条目逐字节保持**。Numen内容、NumenBedrock和其他正式插件不替换。正常重启前仍须服主本次确认、维护预告、真人/副本检查和 E/F 完整冷备份；回退只恢复旧 API `6684d9e3`，保留最新世界、玩家与同伴数据，不能用永久遣散回退。

## 桐人信息接入追加候选（2026-10-20）

任务、技能、魔力、原库存和异步消息已完成实际读取；接管竞态、长回执及旧账号权限已补。详见 [信息接入与核心复用](KIRITO_SERVER_INFORMATION.md)。正式尚未切换，当前线上仍为下述星灯版本。

## 原桐人与 QwenPaw 接管候选（2026-10-20）

原 `ag_Kirito` 的接管、真实外脑控制及桐人外观已完成隔离验证，正式尚未切换。见 [配置与验收](KIRITO_QWENPAW.md)。当前正式仍为下述星灯版本，不能把候选当作已上线。

# Numen：Paper 安装与公网玩家接入

## 当前状态（2026-10-20）

**已正式安装并启用**：Paper **1.21.1 build 133 / Java 21**、AgentFriend **0.4.47.8**、Numen **0.1.4** 和 NumenBedrock **0.1.0**。本次批准后完成预告、原维护正常停启与 E/F 完整冷备份 `20261020-023549`。实际登录网关的 Mineflayer 1.20.6／1.21.1 均收到协议3非管理员 ACK；基岩表单此前通过实际隔离协议验证，手机／Xbox画面仍待真机确认。配置个人模型与Key后才能运行自主模型，没有预置共享Key或额外公网端口。发布记录见 `paper/manifests/numen-paper-release-20261020.json`。

上游 [minecraft-numen](https://github.com/Dwinovo/minecraft-numen) 的 `1.21.1` 分支提交 `7c931600c2269d21216bb6f9090588cdbe0beb01` 已包含 Paper 实现；源码版本为 `0.1.4`。这是固定源码构建，带本仓库的 Paper 内存连接兼容补丁；不是声称已有官方稳定 Paper Release。协议与安装范围见[该提交的 Paper 文档](https://github.com/Dwinovo/minecraft-numen/blob/7c931600c2269d21216bb6f9090588cdbe0beb01/docs/paper.md)。

## 服务端常驻（2026-10-20，已上线）

这次扩展只替换 Numen API 的服务端 JAR，Numen 内容 JAR、NumenBedrock、玩家客户端与网络协议保持。普通同伴仍在主人离线后待命；只有管理员按**身体 UUID**登记的同伴能离线运行，并在 Paper 启动后的下一刻按原名册恢复，不新建第二具身体。

管理员入口（回执只给操作者）：

```text
/numen resident status
/numen resident status <同伴名或UUID>
/numen resident enable <同伴名或UUID>
/numen resident disable <同伴名或UUID>
```

重名时必须用 UUID。`status` 只查询，不启用、不召唤；它显示身体是否存在、大脑停牌及原因。`bodyState` 区分 `PRESENT`、`DORMANT`、`DEAD`、`REMOVED`，被踢出还显示实际离场原因；上游的 `hold=DEAD` 同时涵盖死亡和被移除，不能单看它判断死因。启用后没有模型、Key 或额度时仍如实显示 `BLOCKED`，不能把身体存在当作模型已正常工作。`disable` 恢复普通同伴的离线规则，不是永久遣散；原 `/numen player despawn` 仍会永久遣散。

配置沿用 `plugins/numen/server/server.json`，新增 `residentCompanions: ["身体UUID"]`，缺省空列表；原模型档案、人设、记忆、收件箱、背包与身体 UUID 都沿用原生存储。先用一个**没有 OP 的专用账号**按上文召唤、配置模型，再由管理员开启常驻；该账号随后可以退出，不需要保留客户端进程。常驻角色不会因此获得管理员身份或自动接管可米、NEKO。角色的生活目标仍由原生会话和目标功能设置。

常驻继续使用原有的小范围区块加载垫（3×3 实体活动区、7×7 加载区）；世界拆建保护与权限征询保持。主人离线不等于有人能批准权限；客户端专属的反向请求仍会失败。离线死亡者按原死亡规则在名册记录的安全位置附近复活，被踢出或被登录插件拒绝者保持 `REMOVED`，不会自动反复重连。停止通知一开始便停止大脑运行资格，防止关闭模型服务后的收尾消息重新触发决策。

另修正 Numen 漏收**未签名的原版私聊包**：保留原版 `msg_command_incoming` 类型，只用在线名册中的真实名字／显示名做唯一匹配，再交给原有 UUID 归属判断；不从聊天正文或称号猜主人。签名私聊、公屏、旁听权限与原版 `/msg` 路由保持。

最终同摘要候选已通过 1,726 项 JVM 测试、11 项原生 Paper 端到端测试，以及完整插件组合的 19 项实际 Mineflayer 4.37.1 联机／冷启动检查。主人离线后实际移动、死亡按规则复活、原 UUID 与完整物品元数据恢复、模型绑定与收件箱恢复、保护区真实挖掘拒绝、被踢后不自行重入与停用后的待命均通过；两次正常停服退出，并核对最后权限设置已落盘。上述候选初验使用本地模拟服务；追加的真实 qwen3.7-plus 模型6项、正式角色验证与两种原登录协议回归见下方发布说明。31 个原网络载荷类字节保持；本轮没有重新操作 Fabric／NeoForge 图形客户端或基岩真机表单，也没有验证 16 个自主模型负载。隔离服 EssentialsX 2.22.0 原有的版本不受支持告警保留，没有把全部第三方日志称为全绿。候选摘要和最终证据见 `paper/manifests/numen-resident-candidate-20261020.json`。

**常驻已上线。**服主明确要求本实验服使用 CodingPlan `qwen3.7-plus`，实际端点为 `https://coding.dashscope.aliyuncs.com/v1`。常驻旅人 **星灯 `ag_StarLantern`**，身体 UUID `04dfee4f-3bc3-495d-9269-6ae3323adb27`，由独立非 OP 配置账号 `NumenKeeper20` 管理；临时管理连接已经退出。API 与原生 Numen 循环的真实调用均已验证，模型在主人离线后完成只读位置查询和中文回复，原生身体与绑定保存成功。完整发布记录见 `paper/manifests/numen-resident-release-20261020.json`。

Key从现有QwenPaw加密配置读取，只存专用主人的私有钥匙串；不经聊天传Key、不写仓库或日志，也不设全服共享custom服务Key。该主人的档案、人设和偏好在 `plugins/numen/players/<主人UUID>/`，身体、记忆和聊天在 `world/numen/companions/<身体UUID>/`，背包沿原玩家存档保存。输出上限4096、主动性10，减少空闲频繁思考；`dailyTokenLimit`是上游服主共享Key的每人日额度，**不覆盖本次私有Key，没有另设日硬限额**。管理者密码已随机设置，角色名禁止从外部登录，原有玩家入口规则保留。

查看：`/numen resident status ag_StarLantern`。暂停离线运行：`/numen resident disable ag_StarLantern`；重新启用：`/numen resident enable ag_StarLantern`。这些命令需要管理员权限。普通玩家仍用原Numen界面配置自己的同伴。本次保留上游沟通权限：主人私聊可以立即唤醒，其他人的私聊作为旁听收集，不能把它宣传成任何人均可即时操控的公共客服。

重建当前候选时，在上文固定源码提交上依次应用 `paper-memory-pipeline.patch`、`server-resident.patch`、`native-unsigned-whisper.patch`、`paper-shutdown-save.patch`，执行本文后面的原构建命令，再运行 `:numen:paper:e2eTest`。最后一个补丁在 Paper 关闭插件类加载器前同步写完世界 SavedData，避免权限命中账首次序列化时出现 `zip file closed` 并中断存档。补丁遵循上游 LGPL-3.0。

回退：正常维护停服并完成原 E/F 冷备份后，恢复原 Numen API JAR（SHA256 `3179afb4d5b6cc9f83588cce18eb5141c5f7f0876c790b78a80f1a168ec5a693`）；清除或保留新配置字段都不会让旧版启用常驻。保留原同伴名册、玩家 `.dat` 和 `world/numen`，不要用永久遣散作为回退操作。

## 公网玩家怎么用

复用现有服务器域名和游戏端口。Numen 面板通过 Minecraft 自定义频道通信，不要求另开网站、MCP 或公网端口。

1. 使用 **Minecraft Java 1.21.1、Java 21**。
2. 二选一安装匹配的客户端增量包：
   - **Fabric**：Loader **0.18.1 或以上**，包内已附 Fabric API `0.116.7+1.21.1`。原 `0.16.13` Loader 需要升级。解压后把 `mods` 内的 JAR 放进该游戏实例的 `mods` 目录，移走旧 Numen 和重复 Fabric API。
   - **NeoForge**：本次构建使用 `21.1.233`；使用对应 ZIP，不能与 Fabric 包混装。
3. 仍用现有游戏地址进入、完成原登录认证。服务器安装后，执行 `/numen settings` 打开设置，配置或选择允许使用的模型方案。
4. 用 `/numen player summon nu_helper` 召唤自己的同伴。名字需未被占用，请给自己的同伴使用不同名字。
5. 用面板或聊天与同伴互动。`/numen player despawn nu_helper` 是**永久遣散**，不要把它当暂停按钮。

客户端 ZIP 在本机私有发布目录 `E:/MC/ops/repairs/numen-paper-20261019/client-packages/`，均附中文安装说明、来源和逐文件摘要，可转发给玩家：

| 客户端包 | ZIP SHA256 |
| --- | --- |
| `Numen-client-MC1.21.1-fabric-0.1.4-7c93160.zip` | `36c2f5177ad4fd4b2ee39afcaec92bddc56b9d3d5c7e79e45c216d0cefe02191` |
| `Numen-client-MC1.21.1-neoforge-0.1.4-7c93160.zip` | `69fc4aa5def817f28664ae85d6c39768fa26a4f1e37d5a72374bb6b9c071e2c5` |

服务器材质包不能自动安装 Java 模组。ViaVersion 的跨版本登录不等于 Numen 客户端模组跨版本兼容，Java 完整面板先使用上述固定组合。

### 基岩版（手机／Windows／Xbox）

本次已启用自研 **NumenBedrock 0.1.0**，通过现有 Floodgate/Cumulus 发送原生表单，不要求玩家安装 Java 模组或新增公网端口。

1. 从原基岩入口进入，完成原账号认证后输入 **`/numenmenu`**。基岩版的 `/numen settings` 也会打开同一菜单，Java 原命令保持原样。
2. 选择“模型与个人Key”，新建或修改个人档案：名称、服务商、模型、协议（Chat／Responses／Anthropic）、基础地址及个人 Key。
3. 已存 Key 不回填、不发聊天、不拼入斜杠命令；留空保留，清除需单独确认。同一服务商的本人档案共用对应 Key。**原生输入框为明文，填 Key 时避开直播；Key 保存在服务器的本人目录，服主可读取。**
4. 选择“召唤同伴”，再到“我的同伴／绑定模型”选择刚保存的档案。模型请求由服务器发出，地址中的 `127.0.0.1` 指服务器自身，不是玩家的手机或电脑。

菜单复用 Numen `Libraries`、`OwnerInputs` 和原钥匙串；不另建账本。即使是管理员，本菜单也只操作本人资料，不提供服主共享 Key 的查看／修改。共享模型档案只显示上游允许公开的字段。保存回执排在 Numen 原写入队列之后核对实际文件，不把排队写入当作已经保存。

本次验证的是实际基岩协议的表单收发与原文件恢复，手机／Xbox 真机画面及手柄文字输入仍待实机确认。原版 Java 未装 Numen 时仍可使用基础命令；本次没有给原版 Java 制作替代设置界面。

模型配置是另一项必要条件：本次没有填入任何真人 API Key，也没有启用或承诺免费模型额度；没有可用模型时，同伴实体存在不等于已能自主行动。个人 Key 或服主提供的模型方案需要按服务器模型管理规则配置。Numen 在服务端运行同伴，不会自动接管现有 Cormy／NEKO，也不会给新同伴自动绑定 YSM 模型。

## 服务端候选

安装两个上游插件和一个基岩适配插件，放在 **Paper 后端**的 `plugins`，不是 Velocity：

| 文件 | SHA256 |
| --- | --- |
| `numen_api-paper-1.21.1-0.1.4.jar` | `3179afb4d5b6cc9f83588cce18eb5141c5f7f0876c790b78a80f1a168ec5a693` |
| `numen-paper-1.21.1-0.1.4.jar` | `bfe6040eefb3cac792dc70513ae150c5e25f76f9b869fd3d9bb8eff088cb37a4` |
| `NumenBedrock-0.1.0.jar` | `08ace492d5b7758d8316c66dd839e0d14b7017465d98c2ec855ed33f9d4cab96` |

预置配置以实际生成路径为准：

- `plugins/numen/server/server.json`：每位玩家最多 2 位同伴，`hardRules=true`、`unknownAsOther=true`；未配置服主模型 Key。`dailyTokenLimit=0` 在上游表示不限额，后续启用服主 Key 前须另设预算。
- `plugins/numen/server/mcp_server.json`：`enabled=false`，监听地址保留 `127.0.0.1`。公网玩家使用面板不需要开启这个接口。
- 同伴沿用主人可用权限，默认生存模式；不授予玩家 OP、`numen.admin` 或 `numen.gamemaster`。`/numen drive` 是管理能力。
- 基岩表单使用现有 Floodgate API／Cumulus，权限 `numenbedrock.use` 默认向玩家开放。回包绑定当前玩家、连接实例与一次性表单票据；退出、重开、超时及重复回包不能重放旧操作。

版本、摘要、检查边界见 `paper/manifests/numen-paper-candidate-20261019.json`；JAR、配置和私有证据在 E/F 两盘 `repairs/numen-paper-20261019/`。

## 兼容修复与复现

原上游内存连接缺少原版协议处理器。ProtocolLib 5.3.0 在假玩家加入时注入失败，报 `NoSuchElementException: encoder`。

补丁 `paper/integrations/numen-paper/patches/paper-memory-pipeline.patch` 只修改 Paper 的 `PaperBodyAdmission`：在加入前调用原版 `Connection.configureInMemoryPipeline(..., PacketFlow.SERVERBOUND)`。没有修改 ProtocolLib，没有屏蔽异常，没有使用 NPC 标志跳过现有保护。补丁按上游 LGPL-3.0 条款提供；源码仓库及固定提交见上文，其他上游代码保持原样。

重建（Java 21；Gradle 各步骤顺序执行）：

```powershell
git clone --branch 1.21.1 https://github.com/Dwinovo/minecraft-numen.git
cd minecraft-numen
git checkout 7c931600c2269d21216bb6f9090588cdbe0beb01
git apply <本仓库>/paper/integrations/numen-paper/patches/paper-memory-pipeline.patch
.\gradlew.bat --no-daemon --max-workers=2 datagenAll
.\gradlew.bat --no-daemon --max-workers=2 :numen-api:paper:build :numen:paper:build :ai:test :script:test :agent:test :numen-api:common:test :numen:common:test -PlinkCheckPaperServer=<实际Paper核心JAR>
.\gradlew.bat --no-daemon --max-workers=2 releaseJars
```

本次通过：

- 1,721 项 JVM 单元测试，6 项上游 Paper 端到端测试；两个成品对实际 Paper build 133 的链接检查。
- 实际插件组合、Mineflayer **4.37.1** 的 14 项联机检查和冷重启后 9 项检查：移动、真实生存挖掘、营地防拆、保留 Goddess 账号拒绝、非管理员权限、大背包、原生 UUID／完整物品元数据、实际 Eye 相机、被踢后不自行重试等。
- 使用现役同一 Velocity 核心的隔离握手：普通用户收到 `numen_api:hello_ack` 的协议 3／非管理员响应，名册与世界正常到达。**该小型代理没有载入正式登录／YSM 插件，不等于正式公网完整链路验收。**
- 维护脚本与部署边界 45 项：原 12 项、Numen 15 项、名册 11 项、停止部署／失败回退 7 项，包含 Windows PowerShell 5.1。
- 基岩表单 25 项 JVM 边界检查，以及 11 项实际协议检查：新建、替换、清除、留空保留、拒绝无效地址、跨用户隔离、重复回包、同伴实体与模型绑定、私有回执及日志无 Key。正常冷重启后另验档案与 Key 回读。

基岩协议夹具只在回环地址关闭 Xbox 登录签名校验以接入自签测试客户端；**正式 Geyser 配置未修改**，该测试不代替正版 Xbox 登录验证。早期 ProtocolLib、表单类加载冲突和夹具连接失败证据均保留。表单改用 Floodgate 提供的同一套 API 与 Cumulus，避免混用 Geyser／Floodgate 的不同类加载器。

基岩适配源码在 `paper/integrations/numen-bedrock/`。`build.py` 接收 `--jdk`、`--paper-api`、`--core`、`--numen-api`、`--floodgate`、`--geyser`、`--libraries` 和一个仓库外全新 `--output` 目录；固定 Numen API 摘要，构建时自动运行 `FormsTest` 的25项检查。本次实际基岩探针及前后快照保存在私有证据目录，不包含真人 Key。正常冷重启的3项回读也通过，共14项基岩协议检查。

未宣称完成：实际公网玩家整链路、Fabric／NeoForge 图形客户端与 YSM／光影组合画面、手机／Xbox 真机、16 个自主模型的负载或长期生存。探索性 Mineflayer 4.39 探针出现过物品组件解析问题，原失败证据保留；最终兼容结论限定为本次干净通过的 4.37.1。

## 发布与回退

当前只准备候选。服主确认本次维护后，沿用原 `Afu-MC-DailyBackup` 生命周期：180／60／10 秒提醒，真人与活动副本检查，正常停服，完成 E/F 全量冷备份后才安装。不能用 `/reload` 或动态插件加载器代替重启。

Numen安装增量涉及三个 JAR、两份上述配置及两个运维助手；不混入其他 AgentFriend／Freesia 待发布版本。部署器限定精确文件名和 SHA256，拒绝错加载器、未记录覆盖与运行中替换。运维名册只按服务端 `NumenOwner` 原生 NBT 与当前 UUID 的双重证据识别假玩家，未知或损坏证据仍按真人阻止维护；不按 `ag_` 名字前缀放行。

运行失败时先正常停服并保存本次最新数据，将新增三个 JAR 移出 `plugins`、恢复助手前像，再按原流程启动；**保留 Numen 数据目录和假玩家 playerdata**，不要为回退插件而覆盖整个世界。若确认需要恢复整套存档，只能使用同一次 E/F 完整快照，且会回退快照之后的玩家进度。本次已随消息降噪版本正常上线，E/F冷备份 `20261020-023549`；原候选清单保留发布前历史。
