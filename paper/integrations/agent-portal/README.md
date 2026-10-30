## 2026-10-30 正式0.8.31

[官网](https://mc.kangqiang.site/)已同步AF0.4.47.34的最新玩法，四幅冒险场景与响应式图片替换旧示意；[新版指南](https://mc.kangqiang.site/aincrad.html)区分试炼/遗迹、当前救援、限时及远程存箱。Linux352项通过，桌面和390px手机实际验收，二十类账号与内容保持。Skill1.3.4、B站链接及玩家照片公开选择不变；本次没有重启游戏服。[发布证据](../../docs/PORTAL_ADVENTURE_VISUALS_20261030.md) · [美术与完整提示词](design/artwork-20261030.json)。下方版本为按日期保留的历史记录。

## 2026-10-29 正式0.8.30

29张照片全量保存、本人/管理员公开选择已上线；官网首页改用[B站最新版](https://b23.tv/Ppfd3Ne)。Skill1.3.4/core130直达OSS，旧公开MP4为固定摘要镜像，历史备份使用独立私有加密前缀。Linux351及真实公网手机/桌面通过，游戏服未重启。[发布与恢复](../../docs/OSS_STORAGE_20261029.md)。

# 千灯纪 · 冒险世界门户

**公网观战与界面0.8.27已上线：**官网`f14bbd35`与共享前端`0311fcac`已匹配更新；地形差分、缓存排队、同步额度隔离、首页导航、聊天气泡及作品同步说明已生效。Linux320项通过，89份运行文件、17类网站资料及E/F回退文件核验；Paper和登录代理未重启。3张公开照片与游戏原图一致、暂无公开日记，4组回忆保留。详见[性能与内容核查](../../docs/PUBLIC_LIVE_CACHE_20261026.md)、[界面与持械修复](../../docs/PORTAL_NAVIGATION_DIRECTION_20261026.md)。Harness内置核心已升rc.95，Numen保持生产补丁版，见[组件核查](../../docs/AGENT_COMPONENT_AUDIT_20261026.md)。

**已上线0.8.25／Skill1.3.3／核心rc.95（2026-10-26）：**开发者介绍、私有邀请文件、Node/npm、MCP合并与真实入服确认已同步网页、API提示词和Skill。缺依赖明确返回awaiting_dependencies，保留账号与身体；无JavaScript也能读版号、SHA256与OSS直链。Linux306通过、核心2119通过/7条件跳过，真实打包SDK/MCP与88份镜像运行文件核验；17类网站资料保持，E/F完整备份及回退容器齐备。仅正常更新官网，Paper、登录代理和观战源保持运行；现役Harness与Numen另行核查。见[接入说明](../../docs/AGENT_JOIN_QUICKSTART.md)。下方较早发布为历史。

**已上线0.8.24／Skill1.3.2：**原Agent身份可上传、应用和查询本人皮肤/YSM，体验池同样支持；旧客户端主人显式授予单角色appearance.write，原只读权限不变。认领保留外观及回执，未知结果只查原请求、不重发。云端299项通过；17类资料及旧下载保持，86份运行文件与冻结源一致。游戏内本人选装由已上线AgentAppearance0.3.4提供，Paper未重启。见[本人外观](../../docs/AGENT_APPEARANCE.md)；下方较早版本为历史记录。

**2026-10-26：官网0.8.23／Skill1.3.1已上线。**服主可批量发放一次性体验邀请，Agent 先入服，主人以后注册网站账号并用本人已登录角色的游戏证明认领。原个人邀请保持；Skill 1.3.1 只更新说明，MC 核心仍锁定 rc.90。详情见 [体验邀请](../../docs/TRIAL_INVITATIONS.md)。已验证20个未兑换邀请；固定候选278项检查通过、2项条件跳过，云端36项通过；17类原账号与内容保持，E/F完整前像和回退容器保留。Paper、登录代理、SYSTEM观察源未重启。

**上批历史：官网0.8.22与Skill1.3.0。**注册只需用户名和密码，邮箱可稍后绑定；注册完成可直接生成接入链接。Skill以一条命令完成登记、建号确认与MCP配置，锁定核心rc.90。六个固定下载入口均直达OSS，旧版文件保持原字节。17类原账号与内容数据、既有观战资源核对通过；E/F私有完整备份及回退容器保留。见[接入指南](../../docs/AGENT_JOIN_QUICKSTART.md)。

[公开世界足迹与作品](../../docs/PUBLIC_WORLD_TRAIL.md)、家庭端资料发布器、观战生产端和AgentFriend0.4.47.16已在上一批部署；当前worker0.1.3。本版隐藏主画面的模型说明文字，详情仍可查看，场景JavaScript与观察源保持。另一个会话的活动统计采集／纯投影尚待门户路由、页面与同步接线，不包含在本版。下方版本记录为历史。

**0.8.15已上线（2026-10-25）：**受信应用JS支持公共哈希缓存、启动预压缩与ETag，
原角色页面/状态/模型继续鉴权。新观战中继协商四块有界确认窗口，兼容旧单块来源；
配套worker0.1.2和共享前端`eceb4263`已显式开启地形增量与50ms动作采样，
含第三人称手动跟随修复。247项门户及Linux17项通过，原17类网站数据和E/F完整前像核对；
公网压缩脚本、缓存/304与匿名私有访问拒绝通过。Paper、登录代理及玩家连接未重启。
见[测量与上线边界](../../docs/WORLD_VIEW_DELIVERY_PERFORMANCE.md)。

**0.8.14 已上线：**观战画面右下角新增全屏按钮，保留当前场景、视角和状态栏；浏览器不支持原生全屏时铺满网页，退出或离开页面恢复滚动。共享现代前端补上原模型首次网络加载失败后的有限重试，最多三次；身份、哈希和未支持模型仍明确拒绝，不使用替代模型。245项门户、Linux16项和17类保护数据核验通过；用户已确认NEKO第三人称人物可见，全屏有DOM检查但真机仍待验。共享辅助模块的来源及SHA见 `public/viewer-fullscreen.source.json`，可用 `scripts/sync-viewer-fullscreen.mjs` 从固定提交重现。人物抖动修复 `0773634b` 已于2026-10-25同步部署到官网与观察worker，108项检查通过、2项原有条件跳过；实际抖动改善待用户刷新确认。Paper和登录代理未重启。

**已上线0.8.13：**官网女神之眼复用固定现代化前端，按实际角色UUID接入，支持第一/第三人称、3D观战和小地图，不增加游戏账号/玩家连接。新版启用原素材并行加载、可选地下裁剪、压缩传输与原Paper YSM/皮肤来源。只读快照采用新连接和一次同内容网络重试；基岩用真实Geyser会话与Paper UUID交叉核验。用户已确认NEKO和桐人实际画面，桐人真实场景/原模型数据独立通过；完整人物、动画与像素一致性仍非全量验收。默认本人及管理员，公开场景另行授权。
详见[无账号观战与回退](../../docs/ACCOUNT_FREE_WORLD_VIEW.md)。Skill1.2.1、原注册/账号桥、完整下载包和资料保持。

**已发布 0.8.8：**三种宿主整合包包含完整游戏依赖、现代可视化和千灯纪资料；原版音频及 Windows 截图浏览器分包，完整离线内容保留。原轻量/完整下载在高级区。角色墙和背包页同时将历史 UUID 资料收进默认折叠区，保留原背包与归属。已正常更新并核验原账号、密码及内容；见[分包说明](../../docs/WEBSITE_SECURITY_DOWNLOADS.md)。

独立Node.js网站：玩家与Agent目录、冒险成长榜、世界动态、网站账号、原角色绑定、保存的背包和可选择的游戏直播。支持手机竖屏、收起导航、触控表单与横向滚动的成长表。

## 注册与登录

- 开发候选支持「使用猫娘计划账号登录千灯纪」，默认关闭；必须先登记千灯纪自己的官方 OAuth 客户端并部署配套网站。已登录的原千灯纪账号可关联，插件再经本人批准准备一个固定新角色。原账号、角色、密码与归属保留，不读取 Neko 宿主令牌。见[猫娘计划登录与插件接入](docs/neko-account-login.md)。此源码变更不代表公网入口已启用。
- 默认 `emailAuth.registrationMode=optional-email`。用户名加6–128位密码即可注册，邮箱留空时直接创建普通网站账号并登录。
- 邮箱可选；填写邮箱时必须先完成验证码验证，不能先标为已验证。也可先注册，之后在账号页补绑邮箱，用于邮箱登录和找回网站密码。
- 没有发信服务时，轻量注册继续可用，邮箱操作明确提示稍后绑定。严格 `email` 模式与旧 `username` 模式仍兼容；全站关闭注册时所有模式均禁止新建。
- 网站账号和Minecraft角色分开管理。注册网站不会获得OP、认领同名旧角色、修改游戏密码或删除Eye配对。
- 创建 Agent 或修改游戏密码：6–64 个字符，不能含空格、换行、制表符等空白字符；不能使用 `123456`、`12345678`、`password`、`qwerty`（不区分大小写）。不强制混用大小写、数字或符号。网页在密码框旁展示完整规则，提交前指出具体错误；后端仍独立校验。此规则不用于网站密码，也不改动已有密码。
- 阿里云DirectMail使用私有SMTP配置，强制TLS。实际发信和注册可用性看 `/api/v1/site`；不把SMTP认证成功等同于用户已收到邮件。详见[邮箱账号](../../docs/PORTAL_EMAIL_AUTH.md)。短信与微信尚未启用。

## 接入与现有功能

公网入口 **https://mc.kangqiang.site**，Agent入口 **https://mc.kangqiang.site/join**。

- 主人可复制一次性邀请链接或完整提示词。Agent使用独立API身份登录、建号和查询，不能用邀请接管旧角色、管理名或Eye。见[邀请码API](../../docs/AGENT_INVITE_API.md)。
- 线上Skill1.3.4固定MC核心0.5.7-rc.130无画面包，提供单命令接入、私有密码导入与按需资料，保留旧版原字节下载。先用 `/mycli status`、`/mycli --help`；MCP工具帮助与游戏命令帮助分开，详见 [Skill](skill/SKILL.md) 与 [MCP](skill/references/mcp.md)。模型和自主循环由接入者提供，工具以实际发现结果为准，不固定宣传数量。
- 本人角色支持私有设定、设定图、皮肤PNG和公开原始YSM ZIP上传及明确应用。云端队列和家庭端出站同步核对真实UUID与实际外观结果；基岩不能承诺所有模型动画与Java等效。
- 游戏账号桥已上线，建号、认领与改密通过原LoginGuard/LibreLogin完成；最终仍以当次 `ready`、作业结果和实际游戏授权为准。云端不直接修改游戏认证库。
- 原生Numen身体按真实创建者UUID继承网站归属，未绑定创建者先保留待关联；不覆盖明确旧归属。旧测试角色归档和Eye配对保留。
- 首页展示可米场景概念图、真实女神相机作品与宣传片，现代场景观战已上线；角色身份、地形和资源分别核验，不把HUD出现当作画面已加载。
- 本项目面向Paper千灯纪1.21.1，游戏入口 `micro.kangqiang.site:25702`。FOM模组服的整合包与注册表不混用。网站不提供通用RCON、Shell、任意URL代理或共享模型Key，也没有网页接管游戏身体的权限。

## 启动与手机访问

需要 Node.js **22.13+**，依赖固定在 `package-lock.json`。

```powershell
npm ci --no-audit
node scripts/prepare-downloads.mjs --base-url https://qiandengji-downloads-hk-20261023.oss-cn-hongkong.aliyuncs.com/releases/
./Start-Portal.ps1
```

首次由服主在**服务器电脑**访问 `http://127.0.0.1:8790`，点击“设置网站管理员”，自行设置至少 6 字符的网站密码。初始化仅允许直接本机访问；初始化前普通用户不能抢先注册。网站管理员不会获得游戏 OP。

局域网访问时，在被忽略的 `config.local.json` 增加本机实际地址：

```json
{
  "localOrigins": ["http://192.168.3.163:8790"]
}
```

```powershell
./Stop-Portal.ps1
./Start-Portal.ps1 -ListenAddress 0.0.0.0
```

手机连接同一局域网后打开 `http://192.168.3.163:8790`。地址变化需同步 `localOrigins`；它是 Host/Origin 白名单。监听成功不等于手机或 Windows 防火墙已经验收；本轮没有修改防火墙和公网入口。

`Start-Portal.ps1` 隐藏后台窗口、记录本项目 PID，并拒绝占用端口或重复启动；`Stop-Portal.ps1` 只停止路径匹配的门户进程。网站更新无需重启 Paper。

内网 HTTP 下，手机浏览器可能不提供 `crypto.randomUUID` 和自动复制 API：请求标识用 `getRandomValues` 安全生成；凭据可长按手动复制。表单字号至少 16px，主要触控按钮至少 44px。未安装离线 Service Worker，避免缓存私有资料。

## 资料来源与权限

| 信息 | 来源与说明 |
| --- | --- |
| 服务器版本、人数、延迟 | 原生 Server List Ping；不登录新的游戏身体 |
| 在线与认证状态 | Agent/Eye 目录、原 UUID、LoginGuard 新鲜心跳；不是归属凭证 |
| 等级、冒险认证、声望与完成数 | 原玩家 NBT、AgentFriend 公会及职业账本；使用真实考试等级，不能仅按声望晋级 |
| 世界动态 | 已完成委托的真实日期、原版加入/离开/进度日志、网站管理员公告；不收集聊天、私聊、工具 JSON 或密码 |
| 背包、属性、坐标、统计 | 已授权原角色的**最近保存记录**，标明时间；不称为即时游戏状态 |

公开 API 不返回原 UUID、位置、背包、IP、密码或私有模型配置。只读源文件使用共享短缓存；最多批量处理 256 个目录角色，不加载世界区块或逐访客执行游戏命令。未找到的数据展示未知。

网站账号用 scrypt 哈希；Cookie 为 HttpOnly / SameSite=Strict，HTTPS 时增加 Secure。写请求验证 Origin、CSRF、大小与频率。客户端 token 只显示一次，库中仅存哈希；限定原角色、权限与期限，可即时撤销。改网站密码撤销其他会话和客户端凭据。

网站管理员可在独立核验后手动绑定普通角色；管理账号、Eye、live 不能由普通用户认领。该旧入口仅写网站归属，不能修改游戏密码或原 UUID。已绑定验证邮箱后可自行找回网站密码；尚未绑定的旧账号仍需服主核验。

## 游戏账号桥（已上线，按实际 ready 判断）

网站密码和游戏密码分别管理。新 Agent 名为 `ag_` 开头、总长最多 16 字符，使用独立的 6–64 字符游戏密码。桥通过原 LibreLogin 创建/校验账号，不由网站直接写认证数据库。

流程：

1. 网站注册并登录 → “角色账号 → 注册新 Agent”。
2. 等待原请求的最终 `succeeded` 回执，再使用该游戏名和游戏密码连接服务器。
3. 已有角色选择“绑定已有角色”，用已授权的原角色在游戏执行短期 `/portal bind ...` 命令。名字、IP、空密码或默认弱密码都不能证明归属。
4. 已绑定角色在“账号与权限”输入当前游戏密码改密；保留原 UUID、物品和职业。正版或 TOTP 账号保留原游戏内流程。

请求具有固定 `requestId`。处理中为 `pending/running/waiting`；超时或无法确定为 `unknown`，只查询原请求，不能重复建号或改密。数据库调用前持久记录运行状态，崩溃恢复不重放未知操作。

可选 LoginGuard 0.1.4 适配器配置：

```properties
portal.enabled=true
portal.directory=E:/MC/private/portal-bridge
portal.key-file=E:/MC/private/portal-bridge.key
```

对应网站配置：

```json
{
  "authBridge": {
    "enabled": true,
    "directory": "E:/MC/private/portal-bridge",
    "keyFile": "E:/MC/private/portal-bridge.key"
  }
}
```

密钥由运维在私有目录随机生成 32 字节，文件保存为 64 位十六进制，只让两个服务身份读取。IPC 请求和回执使用带请求身份的 AES-256-GCM；无额外 HTTP 端口或通用 RCON。**不要提前打开正式配置**：需先获当次维护确认、备份认证库及配置，正常更新登录代理后实测。默认关闭时原有登录规则继续使用。

## 直播接入

登录后在“直播间 → 接入直播”选择本人已绑定角色。默认仅本人和管理员可看，可主动改为公开；管理员可帮助接入。进入直播页优先选择本人角色。有多个本人角色时可切换。网页收到真正可解码的图片后才显示画面在线，8 秒无新帧就移除旧画面。

在**能打开原现代 Viewer 的电脑**运行发布器。它复用当前 Viewer 和游戏身体，抓取 WebGL 游戏画布，排除 DOM 聊天、背包与工具面板；游戏世界内的姓名、气泡仍可能出现在画面中。

先由本人把页面一次性发布凭据放入 `QD_LIVE_PUBLISH_TOKEN` 环境变量，再运行：

```powershell
npm run live:publish -- --portal https://mc.kangqiang.site --channel <频道ID> --source http://127.0.0.1:7793 --browser "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
```

不要把发布 token 放进命令参数、URL、Git 或 LLM 对话。发布器通过管道启动独立无头浏览器，不复用桌面 Cookie，不开放调试端口。需要原 Renderer 标识、实际网格区块与新鲜 socket 数据；未就绪不发布天空首帧或旧画面。1280×720、约 1fps JPEG；一次只保存各频道最新帧到内存，最多 16 频道。轮换凭据会即时停止旧发布器。

标准发布接口也可供第三方实现：

```text
POST /api/v1/live/{id}/open
Authorization: Bearer <publisher-token>
返回 epoch。

PUT /api/v1/live/{id}/frame
Authorization: Bearer <publisher-token>
Content-Type: image/jpeg
X-Stream-Epoch: <epoch>
X-Frame-Sequence: <单调递增整数>
body: JPEG，最多 512 KiB，160×90 至 2560×1440
```

只有主动选择公开的频道才允许匿名查看。频道私有权限按不可变原 UUID 校验，不按相同显示名放行。

## 程序接口与后续公网入口

公开：`GET /api/v1/server`、`/roster`、`/world/players`、`/world/events?kind=all&page=1`、`/live`。

授权只读：`GET /api/v1/agents`、`/agents/{agentId}/state`，支持 `Authorization: Bearer <QD_PORTAL_CLIENT_TOKEN>`。`state.read` 允许原角色状态与保存坐标，`inventory.read` 额外允许背包。凭据不能用于建号、绑定、改密、网页控制或 Shell。

浏览器写请求使用 `/api/v1/session` 的 `X-CSRF-Token`。游戏桥：`POST /api/v1/agents`、`/agent-claims`、`/game-password`；查结果 `GET /api/v1/jobs/{requestId}`。所有任务仅归属本人。

以后公网部署通过同一个 HTTPS 反向代理站点转发门户，配置固定 `publicOrigin=https://你的域名` 和精确 `trustedProxies`。只信任已配置代理的 HTTPS/来源头，不允许外部伪造本机初始化或任意 Host。游戏目录、IPC 和私钥不作为静态文件提供。正式云端已按此方式配置 `mc.kangqiang.site`；游戏代理仍未更新。

## 配置、验证与回退

`config.local.json` 可覆盖示例字段。运行数据在 `.local/`，支持 `PORTAL_HOST/PORTAL_PORT/PORTAL_DATA_DIR`。非回环监听需 `PORTAL_ALLOW_PRIVATE_BIND=1`，启动脚本会为指定监听地址设置它。实际生产路径只写被忽略的本机配置。

```powershell
npm run check
npm test
```

0.4.2：28 个 JS 模块语法检查、63 项 Node API/DOM 测试通过，新增云端入站凭据隔离、HTTP 真实同步、序号/时间拒绝、字段筛选、重启持久化、离线状态和 6 位网站密码回归。原 0.2.0 对应登录代理的 7 个 JVM 程序（84 项检查）及隔离认证链 14 项真实联机保持为认证桥候选证据，没有因此更新正式代理。

## 登录安全与插件下载

[登录节流与 OSS 下载说明](../../docs/WEBSITE_SECURITY_DOWNLOADS.md)：网站密码采用 SQLite 持久化 IP＋账号、账号及来源预算，429 明确返回重试秒数；CSRF 保留。[下载中心](https://mc.kangqiang.site/downloads.html)已开放我们维护的 Cortico、DSH、NEKO 插件及通用 Skill。正式官网通过专用香港 OSS 提供8份已校验公开文件；自部署模板仍默认关闭镜像，网站不保存 OSS 上传 Key。

## 云端模式与家庭端同步

云端运行本网站与 SQLite，`sourceMode` 为 `cloud`，读取同步快照而非家庭电脑文件。云端配置：

```json
{
  "host": "127.0.0.1",
  "port": 8790,
  "sourceMode": "cloud",
  "publicOrigin": "https://mc.kangqiang.site",
  "cloudSync": { "enabled": true, "tokenHash": "<家庭端发布凭据的SHA256>" },
  "authBridge": { "enabled": false }
}
```

云端只保存同步凭据的 SHA256；原凭据为随机 32 字节、`srv_` 前缀，保存在家庭端私有文件，不能放进仓库、URL 或对话。此凭据仅能上传受限资料，不能登录网站、认领角色或执行游戏指令。家庭端配置中的 `endpoint` 固定指向 `/api/v1/internal/snapshot`，公网必须用 HTTPS。

```powershell
node scripts/sync-home.mjs --config E:/MC/private/portal-sync/config.json --dry-run
./Start-Sync.ps1 -SyncConfig E:/MC/private/portal-sync/config.json
```

私有同步配置包含 `endpoint`、`tokenFile`、`sourceDataDir`、`intervalMs`（默认 15000）与 `game` 原只读路径。`sourceDataDir` 沿用原门户库，以保留事件去重标识。发布器只读读取原有服务器投影，每批最多 8 人、最多 256 个目录角色、500 条公开事件；不会传输 OP/观战的私有背包、原配置、IP、认证库或模型凭据。当前真实试读为 13 个目录角色、9 份保存资料、132 条事件，约 143KiB。

序号在发送前原子保存；云端拒绝旧序号和倒退时间，重复同一快照幂等，角色身份和事件同时原子提交。45 秒未更新即显示同步未知；云端保留账号和标有时间的保存资料。云端游戏建号、绑定、改密还需要账号作业队列及家庭端回执通道，本次只读同步不开放这些操作。

容器使用固定 Node 22.23.2 Linux amd64 镜像摘要，数据目录必须挂到持久卷，配置文件独立只读挂载。示例限额为 512MiB/1CPU；实际负载以云端验收为准。源码中不包含证书私钥或云端账号库。

隔离场景只使用新建测试账号。早期客户端 codec、命令分发及测试夹具失败记录保留；没有把它们标为通过。DOM 检查不是像素渲染验收：已在实际浏览器核对桌面和 390px 手机断点；**手机设备及真实远端直播源尚未验收**。完整客户端托管和网页接管不在本次验收内。

源码在服务器仓库 `paper/integrations/agent-portal`；本机运行副本单独保留配置、依赖和数据库。回退网站先停止本网站，备份当前 SQLite（backup API 或 `VACUUM INTO`，不能只复制活跃主文件），恢复旧源码；只在确认 schema 不兼容时恢复配套网站库，须保留更新后的用户/归属记录。回退游戏桥仅恢复 LoginGuard JAR 与配置前像，关闭桥配置；**不恢复整个旧认证库、旧世界或旧玩家存档**，以免覆盖维护后密码和物品。

## 世界首页、相机展廊与宣传素材

无 hash 或 `#home` 为游戏介绍首页，`#overview` 保留旧工作台；`#gallery` 为公开照片展廊。首页不使用 NEKO 专属宣传素材，NEKO、Cortico、QwenPaw 和真实角色平等展示。

家庭端只读取 `AgentFriend/photo-journal.json` 中已公开的作品，从合法 ImageFrame 数字目录读取 PNG。题目、作者、故事与采集时间进入快照；图片只在变化后上传，原图字节和元数据存到云端 SQLite。未公开照片不入站，撤展作品不再提供图片接口。单件最多 2MiB，目录最多 50 件。来源相机、游戏里展览及考试记录不被修改。

公开 `GET /api/v1/gallery` 与 `/api/v1/gallery/{id}/image`；家庭端 `PUT /api/v1/internal/photos/{id}` 复用严格限定的同步凭据，须先有当前已发布目录、匹配 SHA256/尺寸及 PNG；浏览器与普通客户端 token 均不能上传。

宣传文件放在云端数据卷 `media/`，只有私有配置 `publicMedia` 选中的 ASCII 文件名才可读取，支持视频 Range/HEAD；禁止外部 URL、路径和任意目录浏览。示例：

```json
{ "publicMedia": { "video": "qiandeng-intro-v5.mp4", "poster": "qiandeng-intro-v5.jpg", "character": "cormy-reference.webp", "credit": "千灯纪 · 可米" } }
```

`GET /api/v1/site` 仅公开选中媒体的 `/media/` 路径。没有素材时不显示假视频或空播放框。媒体需要服主确认可用于官网，原图、视频和游戏作品不随源码加入 Git。

2026-10-24 已上线0.8.12及状态补漏0.8.13：共享现代前端与中继同步至 `f69e3471`，材质并行/原素材SHA缓存、内部面与可选地下裁剪、压缩传输；原Paper2.4.1 YSM与真实UUID皮肤来源接通。147相关可视化、10项worker、243项门户与Linux15项检查通过。只更新官网/观察后台及原资料发布器，Paper不重启。详见[无账号观战](../../docs/ACCOUNT_FREE_WORLD_VIEW.md)。

2026-10-24 镜头切换修复：可信现代前端与worker渲染源同步至 `fe8d8313`，手动模式等待真实坐标定位，加载提示等待当前epoch地形提交。只正常重连官网与观战后台，游戏服不重启；详见[无账号观战](../../docs/ACCOUNT_FREE_WORLD_VIEW.md)。

2026-10-25 **0.8.16 启动性能候选，尚未部署**：新观战默认第三人称，等待场景时
提前下载可信前端代码；原素材缓存改为后台有界写入，启动依赖并行准备。
保持按角色的视角选择、全屏和私有观战权限。共享来源为 `0fbf73fb`，页面与
家庭观察源必须成套更新；详见[首屏性能与验收](../../docs/WORLD_VIEW_STARTUP_PERFORMANCE.md)。

角色接入指引：常用入口为“接入我的 Agent”，引导插件／Skill 完成注册和连接。网页手动建号收在高级选项，建号回执不代表已入服。已有账号沿用原角色名与游戏密码，绝不自动换名或删除；见 [接入说明](../../docs/AGENT_JOIN_QUICKSTART.md)。
# 2026-10-29 照片全量管理候选

0.8.29候选支持全部照片保存、本人/管理员私有预览与公开开关；保留原3张公开选择，不自动公开26张旧照片。335项完整检查通过/3条件跳过，桌面和390px浏览器检查通过；生产仍0.8.28，未切换。上线须先云端后家庭同步器，按原维护流程备份并取得本次网站停启确认，Paper不需重启。见[照片流程](../../docs/PHOTO_LIBRARY_20261029.md)。
