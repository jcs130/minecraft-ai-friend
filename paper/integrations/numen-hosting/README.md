# Numen 服务器托管

2026-11-14 正式托管运行 `0.1.5-hosted.2`、MC 核心 `0.5.7-rc.160-preview.68` 和自治运行时 `0.2.156`，已启用战场提醒。见[发布清单](../../manifests/server-pr207-trial-deployed-20261114.json)。

这是与既有 Mineflayer 并行的托管入口。官网账号选择本人已绑定角色，填写自己的 API Key、供应商、模型和目标，再选择 **Numen 原生循环** 或 **Harness Hub · OpenCode + MC 核心**。原 UUID、背包、位置和权限继续使用，不按同名另建角色。

官网「我的角色 → 服务器托管」保存后点「启动托管」。角色须先从原客户端离线。暂停只停止行动并保留在线身体；「退出托管，回到原客户端」会确认停止、撤销模型连接、保存身体并下线，之后才用原客户端连接。不要同时启动两个控制器。

观战页支持给托管 Agent 留言、录音转文字并确认发送，以及朗读它真实说过的回复。发言标记网页观众来源，作为外部对话送入原生收件箱；不会变成服主授权。只归档实际说出的回复，不公开模型思考、工具参数或凭据。角色主人和观众仍使用原网站会话、Origin、CSRF 和访问检查。

## 当前支持范围

- 普通角色由网站本人明确启动后，以原 UUID 接入独立 Numen 身体；不会挤掉正在连接的真实客户端。
- **旧版原生 Numen 角色暂不自动迁移**，会提示核对身体及归属。原 Numen、女神、任务及历史数据保持原运行方式。
- 新模块在 `com.dwinovo.numen.hosted`、`numen_hosted_api`、`numen_hosted` 和独立资料目录运行。部署桥接模组只在服务端使用，普通 Java、Mineflayer 和基岩客户端不必因此安装新模组。
- 现有 `play.kangqiang.site` 手动玩法继续使用既有 Mineflayer。Numen 手动控制的底层租约、超时松键已验证；移动端的新控制方式须按此协议单独接线，不能宣称现有客户端已自动切换。
- 初期只开放已接线的 Numen、OpenCode。目录中尚未接线的运行方式不能启动，不把所有 Hub 后端都当成已验证。

## 同角色换身

换身与切换 Numen 托管模式使用独立状态。角色由运维预登记本人、角色 ID 和可用身体。Mineflayer 和 Numen 必须指向同一个原玩家 UUID。女仆、村民各用原生实体 UUID，并保留自己的原生状态。两类实体经独立原生交接验证后才可注册。

角色自选还需单独授权。有效控制端可使用 `mc_character_body` 查看可用身体、选择并查询原请求。网站读到同一条持久回执，受理状态应显示为切换中。原端先停止新动作，核对未结算动作并保存，下一控制端回读匹配的原生身份后，控制代次才对它生效。

向私有托管配置提供 `bodyHandoffAdapter` 时，模块须导出 `createBodyHandoff({bootstrap,coreDirectory})`，返回 `{ registrations, adapters, numen }`。同玩家双向交接可用 `originalPlayerHandoffs` 绑定已授权的桌面 SDK、同一原玩家的 Numen 配置，以及签名的原生准入入口。普通角色的角色编号和主体均使用官网核实的原玩家 UUID。桌面端按当前代次获取 `controllerPort`，用原连接证明退出和接续，游戏侧独立回读退出落盘和新连接。原客户端、游戏侧驱动或目标身体缺席时，交接会拒绝或等待原请求核对。本站后端只通过现有受保护回源访问 `/v1/character-bodies`，浏览器无权调用该私有端点。

也可以在同一份私有托管配置启用内置 `characterBodies`，填写本机 `custodyPort`、库外 `custodyKeyFile` 绝对路径及 `characters`。每项使用 `{characterId, ownerId, active, targets, generation, autonomous, combinedCustody}`。玩家身体绑定为 `{kind, bodyId, playerUuid}`，女仆和村民绑定为 `{kind, bodyId, entityUuid}`。玩家项还需原托管身份 `numenRole`，其中 `roleUuid` 与玩家身体相同。Numen 使用原角色选定的 OpenCode 托管档案。选择 Mineflayer 时需启用 `devices: true` 和官网本人配对。组合登记必须与 [游戏侧离线登记](native-bridge/NATIVE_HANDOFF.md) 的原身体、归属和代次一一核对。开服时已有 `pending` 或 `transfer` 的角色应继续查询原运维账本。

进程中止或动作结果不明时，两端保持停权，原请求进入恢复待确认。只查询原生端对原请求的结果，允许提交已证实的回执，避免重复登录或执行动作。正式注册前应完成真实双向接续和失败恢复验收。停用已启用角色时，先核对在途换身并停住已接管端，保留角色存档和换身账本。

## 模型和状态

API Key 只写入独立 AES-GCM 保管库，不回传浏览器、不写入 Agent 提示词或启动参数。切换供应商需重新提供自己的 Key。原生模型连接只驻留内存，暂停撤销；专用 Hub 使用独立数据卷、组织、令牌与加密存储，不读取原共享 Hub 的供应商配置。指定模型不能用时暂停，不能转用服主 Key 或偷偷换模型。

服务或游戏重启后默认暂停，动作结果未知时保留原回执，查询原请求而非换 ID 重投。网页显示暂停、未接入、恢复待确认以及模型错误；进程在线不等于 Agent 已完成目标。持续运行由原生循环或 MC autonomy 执行，托管服务不另写第二套决策循环。

模型目录是运维审核的 `catalogue.json`，浏览器不能填写回源地址或程序路径。当前别名与端点按 [DeepSeek 官方说明](https://api-docs.deepseek.com/) 和 [千问兼容 API](https://help.aliyun.com/zh/model-studio/qwen-api-reference/) 核对；实际可用权限、配额和地区由用户自己的模型账户决定。联测使用模拟供应商，不冒称已替用户验证付费账户。

托管 Harness 可在私有配置启用 `systemOne: {endpoint, model, tokenFile?}`。端点使用本机 `/v1/systemone`。快速层只接收限长目标和选定事实，输出规划建议。低血量、饥饿和正在执行的原生工作走现有规则；聊天、语音或原始收件箱不进入快速层。Numen 原生模型继续用角色自己的配置。

托管版 `0.1.5-hosted.2` 和 MC 核心 `preview.62` 增加 `systemOne.combatAttention`。显式启用后，持有当前 Harness 租约的空闲身体每四秒采样一次。采样只返回同维度 16 格内可见、非友方的敌对生物，最多六只。已有原生工作、未结算请求、离线或旧租约会停用本轮采样。快模型连续三次无法区分选择时，当前任务收到一条可追查的私有反馈，包含原生目标编号和未执行的证据；同一局面等待负责人处理期间停止重复推理。角色仍通过已有 Numen 工具和权限执行动作。

旧版原生托管不报告战场能力时，已有 Harness 仍可正常运行。回退时先关闭 `combatAttention`，正常停止托管进程，再按制品清单恢复此前的核心和托管 JAR。继续保留当前角色、库存、模型配置、租约和动作回执，按原流程由角色主人重新启动托管。

## 接入拓扑

`HTTPS 官网 → 已有网站会话与权限 → 云机 127.0.0.1:19084 → 专用受限 SSH 回源 → Windows 127.0.0.1:19084`

居民页面的换身入口默认关闭。托管端登记角色、原身体和可接管的目标后，可在官网托管适配器私有的 `/run/qd-hosting.json` 中显式设置 `"characterBodies": true`。登录官网，在「连接已有角色」选中本人居民即可查看当前身体与可用目标。管理权限由官网当前居民归属和托管端登记的游戏主人 UUID 共同确定。提交后按同一编号查看交接结果，刷新页面会继续查询。角色自行决定换身还需托管端为该角色开启自主权限。

Windows 托管服务连接新 Numen 的签名准入 `127.0.0.1:19085`、作用域 MCP `127.0.0.1:19086`、专用 Hub `127.0.0.1:29152` 与原 CPU ASR/TTS 桥 `127.0.0.1:8857`。这些端口不直接公开。原网站、游戏 TCP、代理及观战通道各自保留。

私有端点拒绝浏览器 Cookie、Origin、转发头和非精确回环 Host。网站逐请求查询原有角色归属并签发一分钟授权；普通角色的虚拟原生主人由稳定 HMAC 派生，不插入伪造的网站主人账号。MCP 只给指定原角色作用域，模型不接触服务器管理员凭据。

## 自部署材料

1. `native/base.json` 固定 Minecraft 1.21.1 的 Numen 0.1.5 源码。原版 Numen 使用这份源码直接构建，托管版在独立工作区应用 `native/upstream.patch`。补丁沿用作用域令牌、用户模型和动作回执，在首次接管时初始化对应角色的执行循环。保留 LGPL 的 `native/LICENSE`。
2. 使用 Java 21 先执行 `:numen-api:neoforge:runData :numen:neoforge:runData` 生成 Paper 也需要的语言文件和方块标签，再单独执行 `:numen-api:paper:jar :numen:paper:jar`。使用 `native/assemble.py` 与 ASM 9.10.1 的 `asm`、`asm-commons` 隔离托管包。安装时记录并核验四个产物的 SHA256。
3. Youer 的服务端桥见 `native-bridge/`。用同版本 NeoForge 编译类路径运行 `compile.init.gradle` 的 `compileHostedBridge`，再用 `package.py` 打包。启用 Better Combat 2.4.0 时，原版 Java、Mineflayer 和 Geyser 的普通近战在受击确认后会向支持该频道且正在追踪攻击者的观众补发武器动作。隔离联调见 [Better Combat 跨端回归](../../probe/better-combat-crossplay/README.md)。
4. `hub/base.json` 固定 Hub 镜像，`hub/hosted-byok.patch` 只用于一份新实例。开启 `HR_HOSTED_BYOK_ONLY=1`、独立 `HARNESS_INTERNAL_KEY` 和 `HR_SECRET_KEY`，使用新数据卷；HTTP Gateway 只映射宿主回环。不要覆盖旧 Hub 的镜像或数据卷。
5. MC 核心须包含公开 `NumenBodyPort`/`NumenClientWorld`；autonomy 须包含 `mc_numen` 工具目录。独立安装各自依赖，不能让运行服务依赖研究目录或其他工程的 `node_modules`。托管服务复用门户的加密工具，因此其相邻 `agent-portal/src` 和门户生产依赖也须提供。
6. `assembly.mjs` 和 `portal-assembly.mjs` 是可信运维组合。为私有配置设置 `QDJ_HOSTING_CONFIG`，官网设置绝对 `PORTAL_HOSTING_ADAPTER`；后者从只读 `/run/qd-hosting.json` 读取新的传输和签名 Key。参照 `config.example.json` 生成各自独立的随机 Key，不能复制生产值。
7. 在新插件的 `server/hosted-model.key` 写入同一原生控制 Key 的 32 字节原值；`server/hosted-bootstrap.json` 为 `{"port":19085,"mcpPort":19086}`。保护目录 ACL，仅运维账号及服务账号可读。
8. 仅在候选联测、维护提醒、正常停服和当前 E/F 冷备完成后添加两个 JAR 和桥接模组；不在线替换类、不 `/reload`。`deploy/apply_portal.py` 可将四处托管挂钩叠加到已校验的网站源码，保留现役部署覆盖层。

Windows 常驻模板在 `deploy/supervise.py`，包含进程树清理、独占锁、回环健康检查、日志轮转和退避重启。服务异常只暂停身体；开机不能自动恢复旧模型动作。SSH 使用独立账号和密钥，限制为远程回环 19084 转发，禁止交互命令、密码、PTY 和其他转发。

## 协议及回滚

本机 `POST /v1/hosting` 只供网站后端，`authorize` 后可用 `profile/configure/attach/status/mode/release`。观众作用域只允许 `messages/message/messageResult/transcribe/speak`。底层网页接管使用 `manual/input/pause`：递增 epoch 和 sequence、完整按键帧，丢弃旧帧，输入超过 500ms 或十个游戏刻即松键；服务租约失效后停住身体。不能把私有地址、令牌或未经网站验证的角色身份发给浏览器。

回滚先暂停所有新托管身体并确认原动作结算，停止本次新服务及隧道，再正常维护移除本次新增 JAR/桥接模组，官网切回原镜像。**保留**玩家数据、网站数据库、托管配置/密钥和动作回执，不回灌旧世界、背包或账号数据库。新私有目录与 SSH 配置可停用，旧服务保持原配置。验证明细见 [VALIDATION.md](VALIDATION.md)。

### 非玩家身体的停放

宿主可通过 `nativeEntityHandoffAdapters` 装配服务器提供的 `inspect`、`park`、`resume`。默认配置没有女仆或村民换身提供方。提供方的回执须绑定同一逻辑角色、当前所有者、原操作、控制代次和登记的原实体 UUID。释放还需核对其原生存档摘要、停放状态、驱动停止及跨维度恢复禁入；接管需核对原身份、原生存档恢复和独占驱动。请求已发出而回执丢失时，按原请求核对。

Youer 的实体 UUID 可在不同维度同时出现。原生桥在加载世界前校验本世界 `qiandengji-native-custody/<原UUID>.nbt` 下的女仆或村民原生存档，并在实体加入任一维度时执行停放检查。服务端在停止旧驱动前先保存完整原实体，核对停止后单独持久化其所在区块的实体数据。TLM 的驻点找回及身体控制也读取这份停放状态。未加载的实体、正在使用的商人、尚未结算的动作或委托都需要通过各自持有者核对。

每种身体保留各自的原生资料。女仆主人、背包及饰品属于原女仆，职业、贸易与库存属于原村民。逻辑人格由角色 ID 关联。持有停放档案的世界只能在核准原动作、实体存档与控制权之后维护或恢复。单独删除停放档案、撤下守卫或恢复旧世界可能重启旧驱动。游戏主线程通过 `NativeShellCustody` 与 `NativeResidentDriver` 核对原女仆控制代次及原村民登记、交易与委托状态。恢复先核对原存档摘要，再写入原区块、接管驱动并保留前像。托管程序仍需为每个角色显式登记可信的控制槽位，经私有入口持久核对原请求和新驱动。正式角色的自主换身保持关闭。
