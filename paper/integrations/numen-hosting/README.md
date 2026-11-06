# Numen 服务器托管

这是与既有 Mineflayer 并行的托管入口。官网账号选择本人已绑定角色，填写自己的 API Key、供应商、模型和目标，再选择 **Numen 原生循环** 或 **Harness Hub · OpenCode + MC 核心**。原 UUID、背包、位置和权限继续使用，不按同名另建角色。

官网「我的角色 → 服务器托管」保存后点「启动托管」。角色须先从原客户端离线。暂停只停止行动并保留在线身体；「退出托管，回到原客户端」会确认停止、撤销模型连接、保存身体并下线，之后才用原客户端连接。不要同时启动两个控制器。

观战页支持给托管 Agent 留言、录音转文字并确认发送，以及朗读它真实说过的回复。发言标记网页观众来源，作为外部对话送入原生收件箱；不会变成服主授权。只归档实际说出的回复，不公开模型思考、工具参数或凭据。角色主人和观众仍使用原网站会话、Origin、CSRF 和访问检查。

## 当前支持范围

- 普通角色由网站本人明确启动后，以原 UUID 接入独立 Numen 身体；不会挤掉正在连接的真实客户端。
- **旧版原生 Numen 角色暂不自动迁移**，会提示核对身体及归属。原 Numen、女神、任务及历史数据保持原运行方式。
- 新模块在 `com.dwinovo.numen.hosted`、`numen_hosted_api`、`numen_hosted` 和独立资料目录运行。部署桥接模组只在服务端使用，普通 Java、Mineflayer 和基岩客户端不必因此安装新模组。
- 现有 `play.kangqiang.site` 手动玩法继续使用既有 Mineflayer。Numen 手动控制的底层租约、超时松键已验证；移动端的新控制方式须按此协议单独接线，不能宣称现有客户端已自动切换。
- 初期只开放已接线的 Numen、OpenCode。目录中尚未接线的运行方式不能启动，不把所有 Hub 后端都当成已验证。

## 模型和状态

API Key 只写入独立 AES-GCM 保管库，不回传浏览器、不写入 Agent 提示词或启动参数。切换供应商需重新提供自己的 Key。原生模型连接只驻留内存，暂停撤销；专用 Hub 使用独立数据卷、组织、令牌与加密存储，不读取原共享 Hub 的供应商配置。指定模型不能用时暂停，不能转用服主 Key 或偷偷换模型。

服务或游戏重启后默认暂停，动作结果未知时保留原回执，查询原请求而非换 ID 重投。网页显示暂停、未接入、恢复待确认以及模型错误；进程在线不等于 Agent 已完成目标。持续运行由原生循环或 MC autonomy 执行，托管服务不另写第二套决策循环。

模型目录是运维审核的 `catalogue.json`，浏览器不能填写回源地址或程序路径。当前别名与端点按 [DeepSeek 官方说明](https://api-docs.deepseek.com/) 和 [千问兼容 API](https://help.aliyun.com/zh/model-studio/qwen-api-reference/) 核对；实际可用权限、配额和地区由用户自己的模型账户决定。联测使用模拟供应商，不冒称已替用户验证付费账户。

## 接入拓扑

`HTTPS 官网 → 已有网站会话与权限 → 云机 127.0.0.1:19084 → 专用受限 SSH 回源 → Windows 127.0.0.1:19084`

Windows 托管服务连接新 Numen 的签名准入 `127.0.0.1:19085`、作用域 MCP `127.0.0.1:19086`、专用 Hub `127.0.0.1:29152` 与原 CPU ASR/TTS 桥 `127.0.0.1:8857`。这些端口不直接公开。原网站、游戏 TCP、代理及观战通道各自保留。

私有端点拒绝浏览器 Cookie、Origin、转发头和非精确回环 Host。网站逐请求查询原有角色归属并签发一分钟授权；普通角色的虚拟原生主人由稳定 HMAC 派生，不插入伪造的网站主人账号。MCP 只给指定原角色作用域，模型不接触服务器管理员凭据。

## 自部署材料

1. `native/base.json` 固定可获取的 Numen 上游提交，`native/upstream.patch` 包括身体控制、用户模型、对话及同名/退出生命周期修复。按 LGPL 保留 `native/LICENSE`，先对该提交执行 `git apply`，使用 Java 21 构建 `:numen-api:paper:build :numen:paper:build --no-daemon`。
2. `native/assemble.py` 配合 ASM 9.9.1 的 `asm`、`asm-commons` 将两个构建隔离命名。构建环境可能影响归档摘要，安装时重新记录并核验产物 SHA256。
3. Youer 的服务端桥见 `native-bridge/`，用同版本 NeoForge 编译类路径运行 `compile.init.gradle` 的 `compileHostedBridge`，再用 `package.py` 打包；它只保留托管玩家的重生类型，不修改原身体和客户端协议。
4. `hub/base.json` 固定 Hub 镜像，`hub/hosted-byok.patch` 只用于一份新实例。开启 `HR_HOSTED_BYOK_ONLY=1`、独立 `HARNESS_INTERNAL_KEY` 和 `HR_SECRET_KEY`，使用新数据卷；HTTP Gateway 只映射宿主回环。不要覆盖旧 Hub 的镜像或数据卷。
5. MC 核心须包含公开 `NumenBodyPort`/`NumenClientWorld`；autonomy 须包含 `mc_numen` 工具目录。独立安装各自依赖，不能让运行服务依赖研究目录或其他工程的 `node_modules`。托管服务复用门户的加密工具，因此其相邻 `agent-portal/src` 和门户生产依赖也须提供。
6. `assembly.mjs` 和 `portal-assembly.mjs` 是可信运维组合。为私有配置设置 `QDJ_HOSTING_CONFIG`，官网设置绝对 `PORTAL_HOSTING_ADAPTER`；后者从只读 `/run/qd-hosting.json` 读取新的传输和签名 Key。参照 `config.example.json` 生成各自独立的随机 Key，不能复制生产值。
7. 在新插件的 `server/hosted-model.key` 写入同一原生控制 Key 的 32 字节原值；`server/hosted-bootstrap.json` 为 `{"port":19085,"mcpPort":19086}`。保护目录 ACL，仅运维账号及服务账号可读。
8. 仅在候选联测、维护提醒、正常停服和当前 E/F 冷备完成后添加两个 JAR 和桥接模组；不在线替换类、不 `/reload`。`deploy/apply_portal.py` 可将四处托管挂钩叠加到已校验的网站源码，保留现役部署覆盖层。

Windows 常驻模板在 `deploy/supervise.py`，包含进程树清理、独占锁、回环健康检查、日志轮转和退避重启。服务异常只暂停身体；开机不能自动恢复旧模型动作。SSH 使用独立账号和密钥，限制为远程回环 19084 转发，禁止交互命令、密码、PTY 和其他转发。

## 协议及回滚

本机 `POST /v1/hosting` 只供网站后端，`authorize` 后可用 `profile/configure/attach/status/mode/release`。观众作用域只允许 `messages/message/messageResult/transcribe/speak`。底层网页接管使用 `manual/input/pause`：递增 epoch 和 sequence、完整按键帧，丢弃旧帧，输入超过 500ms 或十个游戏刻即松键；服务租约失效后停住身体。不能把私有地址、令牌或未经网站验证的角色身份发给浏览器。

回滚先暂停所有新托管身体并确认原动作结算，停止本次新服务及隧道，再正常维护移除本次新增 JAR/桥接模组，官网切回原镜像。**保留**玩家数据、网站数据库、托管配置/密钥和动作回执，不回灌旧世界、背包或账号数据库。新私有目录与 SSH 配置可停用，旧服务保持原配置。验证明细见 [VALIDATION.md](VALIDATION.md)。
