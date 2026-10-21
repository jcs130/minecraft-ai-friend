> 2026-10-20 最新：常驻角色已切换为原 `ag_Kirito`，由 QwenPaw 控制；原星灯离场保档。见 [桐人正式接管](KIRITO_QWENPAW.md) 和 [原生能力核验](KIRITO_NATIVE_QWENPAW.md)。下文此前常驻发布段落保留历史。

## 当前状态更新（2026-10-21）

现役 **Paper 1.21.1 build133 / AgentFriend 0.4.47.10 / Numen 0.1.4 / NumenBedrock 0.1.0**。原版 Java 客户端不必安装 Numen 即可入服；完整 Java 设置面板需要下文固定的 1.21.1 模组包。基岩沿用 `/numenmenu`，原协议 3 与端口保持。最新完整双盘冷备份为 `20261021-164816`；Numen API 已更新为 `6684d9e3`，修复官方旧客户端收到不兼容名册后断线。正式核验和回退见[本次发布记录](../manifests/numen-legacy-client-release-20261021.json)；此前消息降噪与自主运行修复见[前次发布说明](MESSAGE_AUTONOMY_RELEASE_20261021.md)。下方历史候选与暂停描述按当时时点阅读。

### 官方旧客户端入服断线修复已上线（2026-10-21）

服主批准后，经 180/60/10 秒通知、真人退出和副本/PvP 检查，原维护任务完成 E/F 冷备份 `20261021-164816` 并只替换 API JAR，任务结果 0。正式 21 项状态/备份检查、8 项认证协议检查与 19 项同伴身份/物品核验通过，桐人原生心跳已恢复；更新说明已发。初次维护被长名单截断拦截，之后通过维护暂停协调女神守护程序，完整名单验证成功；未绕过真人门禁。见[发布记录](../manifests/numen-legacy-client-release-20261021.json)。


官方发布的 `0.1.4`、`0.1.4.1` 客户端与这里固定源码构建的客户端虽然版本号接近，协议并不相同。旧版登记 `numen_api:companion_list`，但同伴名册每行没有新版 `removedFor` 字段，也没有 `hello_ack` 握手频道。Paper 原先只检查同名频道，向旧版发了新格式；用官方 0.1.4 NeoForge 解码器验证，空名册剩余 0 字节，有一个同伴时剩余 1 字节，与玩家的断线报错一致。重装客户端不会清除服务端名册，所以仍然会断线。

修复仅在 Paper 发包前要求同时登记握手频道与目标频道；不能等待 Hello 成功再发首次名册，因为当前客户端收到名册才发 Hello。无模组和旧客户端可继续用服务端命令；完整面板仍须下文匹配的客户端包，不承诺兼容旧版客户端大脑。不要删除真实同伴或重置玩家数据。

上游 [PR #142](https://github.com/Dwinovo/minecraft-numen/pull/142)，提交 `493e0564a3e175fef2c71d16280f5b04b691452b`。1727 项 JVM、8 项真实 Paper E2E 全通过且无跳过；未修复版本的旧频道测试已复现失败。正式候选在现役 API 上仅替换 `PaperNetworkChannel.class`，其他 1219 个条目逐字节保持，并通过 4 项隔离联机（原版、旧频道重连保持同伴 UUID、新版握手及模型检查、私聊模型回复）。没有启动图形客户端验证画面。

候选 SHA256 `6684d9e36d40bcf9a3b651a278fe978c9108f141fbecab8add03701a1496ef2c`；上一版回退为 `fb4e7a8656cb4f1226c13b1b1f04bf45816fedc781c0ccc9f5df6ffc1d5daa78`。候选、回退与回执位于 E/F `MC/ops/repairs/numen-client-owner-20261021/`，见[候选清单](../manifests/numen-legacy-client-candidate-20261021.json)。本次已正常重启上线；冻结候选清单保留构建时状态，以本节发布记录为准。回退只在正常停服后恢复旧 API JAR，保留玩家和同伴目录，不覆盖旧世界。

小鱼的模型连接另行核实：已保存的新同伴绑定有真实模型回复和工具回执，保存的模型配置也通过原生 Java 流式调用。后续“another program is already running”是程序占用提示，不能当作 Key 无效；本兼容补丁不修改模型配置或执行槽。

### 官方 Release 完整兼容核对与实现边界（2026-10-21）

**本节是已完成的差异核对及解码原型验证，不是已完成的兼容插件。** 正式仍为上节 `6684d9e3`，此次没有替换 JAR、重启、迁移玩家资料或改变桐人的控制方式。完整兼容不能通过移除频道门禁、跳过解码错误或把旧客户端直接记入新版 `Presence` 实现。

核对目标是官方 [0.1.4](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4-1.21.1-beta) 与 [0.1.4.1](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta) 的 MC 1.21.1 发布包。对应源码提交为 `26911f83046bc2e2f8d9053707ee1f8e553582ba`、`2a5753cbde3edd342fb50e0b2a4d52dff4269d38`；两者 `api/.../network/payload` 的 25 份源码完全相同，可以按同一协议族处理。Fabric 原始发布 JAR 摘要分别为 `2ab47063de770c9baf86d2beedeb4530f6bfa89f7f4dba30babcbcb22217d4a6`、`ccc0806fd04cf3404dbc39f7579a4d7c20cd1362d06dce358850f5fdaf711a41`。与正式客户端固定基线 `7c931600c2269d21216bb6f9090588cdbe0beb01` 比较，两边各 25 种载荷源码：共有 15 种，其中 11 种的 record 声明与 codec 源码一致，4 种存在差异；另各有 10 种独有载荷。这是源码审计结果，不等于全部载荷已经运行验收。

| 范围 | 核对结果 | 服务端适配要求 |
| --- | --- | --- |
| 握手与界面 | Release 无 `hello`/`hello_ack`；当前 `/numen settings` 用新版 `Presence` 判断可用性 | 根据旧版独有频道确认协议族，界面动作发旧格式；区分未装模组、旧协议和握手未完成，不能伪造新版报到 |
| 同伴名册 | 新版每行多 `removedFor`；旧客户端将“不在名册”视为永久遣散，并删除本机对应资料 | 输出旧版行结构，保留本世界所有仍存在的同伴 UUID；被移出、死亡、未加载均不能简单从兼容名册删掉 |
| 召唤和换肤 | Release 的召唤带 `name, skinValue, skinSig, creative`，当前只收 `name, creative`；旧版另有 `change_skin` | 分别解码并转换到原生召唤/皮肤接口；保持名称、归属和创造模式权限校验，检查整包已读完 |
| 模型、记忆与设置 | Release 的 Agent 循环、模型档案、Key、会话和 Lua 模块在玩家客户端；当前版本把它们迁到了服务端 | 官方客户端继续管理自己的原生设置；不因打开界面把服务端其他人的 Key 或资料下发，也不声称两端历史已自动合并 |
| 执行与回执 | Release 使用 `run_program / program_result / stop_program / cancel_tasks`，当前不再登记这些入口 | 在旧协议边界适配到现有 `ServerPrograms`、身体和权限层；复用当前执行器，按真实执行结果回复，不能只打开界面就称已适配 |
| 模块和客户端回调 | 旧 `ClientCallResultPayload` 末尾还有 `Optional<ModuleSet>`，当前没有；旧模块按内容指纹补发 | 保留缺模块时尚未执行的语义；模块放在对应旧连接的作用域，不能无条件覆盖服务端现有模块/记忆；未知执行结果不自动重放 |
| 控制互斥 | 旧客户端本身会运行模型循环；服务端现有循环及桐人 QwenPaw 驾驶仍存在 | 扩展现有 `EXTERNAL` 驾驶判定，按同伴 UUID 只允许一个驱动；旧客户端不得抢占其他外脑；断线撤销自己的执行、回调和控制资格 |
| 事件与生命周期 | Release 需要 `current_task / numen_event / numen_death / numen_respawn / path_debug`，新版改为服务端 Feed/历史通道 | 转换真实状态、死亡复活和任务终态；核对原版私聊与事件输入是否重复，不能让内外两套大脑重复消费同一条主人消息 |

可复用当前 `OwnedBody` 的 UUID 归属校验、`ServerPrograms` 的 Lua 沙箱/并发/主线程预算、既有身体操作与保护权限、`CompanionRoster`/背包快照，以及现有外脑互斥的生命周期语义。`McpMode` 的连接资格绑定 HTTP 令牌，不能直接伪造一个 MCP 会话来代表游戏客户端；旧客户端应有独立且受同一驱动仲裁约束的连接资格，无需为此开放公网端口。

隔离 JVM 已直接加载官方 0.1.4 NeoForge 发布包内的 Mojang 映射 codec，并使用正式 API 编码，8 项断言通过：0/1/2 个同伴分别验证当前名册与旧格式转换名册；新版一行会剩 1 字节，两行已发生读取错位并抛解码异常，转换后三种数量均完整解码；旧召唤交给当前解码器剩 2 字节，旧客户端回调剩 1 字节。Fabric 两个原始发布包已核对内嵌 API 确实无 Hello、有 RunProgram。上述检查没有启动完整 Fabric/NeoForge 图形客户端，没有验证模型循环、完整交互或长期稳定性。私有复现脚本、差异矩阵和结果在 `E:/MC/ops/repairs/numen-client-owner-20261021/` 的 `audit-release-compat.py`、`ReleaseCodecProbe.java`、`run-release-codec-probe.py` 与 `private/release-compat-*.json` / `private/release-codec-*.json`。

实施应先完成界面、名册、召唤、背包和位置的双协议分流，再接回旧程序/模块/事件及驱动互斥。**发布门槛是完整闭环，不是第一阶段界面能打开**：用未经修改的官方 Fabric 0.1.4/0.1.4.1 和 NeoForge 发布包实测“登录→设置→配置本人模型→召唤→私聊→真实移动/存取→停止→断线重连”，验证另一位主人不能读或驱动其同伴，原物品/UUID 保持；并回归原版 Java、当前协议 3、基岩表单及桐人 QwenPaw。未经这批联机验收和当次维护确认，不部署到正式服。

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
