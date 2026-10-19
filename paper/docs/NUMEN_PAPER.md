# Numen：Paper 安装与公网玩家接入

## 当前状态（2026-10-20）

**已正式安装并启用**：Paper **1.21.1 build 133 / Java 21**、AgentFriend **0.4.47.8**、Numen **0.1.4** 和 NumenBedrock **0.1.0**。本次批准后完成预告、原维护正常停启与 E/F 完整冷备份 `20261020-023549`。实际登录网关的 Mineflayer 1.20.6／1.21.1 均收到协议3非管理员 ACK；基岩表单此前通过实际隔离协议验证，手机／Xbox画面仍待真机确认。配置个人模型与Key后才能运行自主模型，没有预置共享Key或额外公网端口。发布记录见 `paper/manifests/numen-paper-release-20261020.json`。

上游 [minecraft-numen](https://github.com/Dwinovo/minecraft-numen) 的 `1.21.1` 分支提交 `7c931600c2269d21216bb6f9090588cdbe0beb01` 已包含 Paper 实现；源码版本为 `0.1.4`。这是固定源码构建，带本仓库的 Paper 内存连接兼容补丁；不是声称已有官方稳定 Paper Release。协议与安装范围见[该提交的 Paper 文档](https://github.com/Dwinovo/minecraft-numen/blob/7c931600c2269d21216bb6f9090588cdbe0beb01/docs/paper.md)。

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
