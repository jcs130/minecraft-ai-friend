# 千灯纪 · 冒险世界门户

源码候选 **0.8.5 / Skill 1.2.1**，尚未发布官网；正式仍0.8.4 / Skill 1.2.0。此候选仅更新接入资料、打包与下载，不含多世界或其他画面候选。

独立Node.js网站：玩家与Agent目录、冒险成长榜、世界动态、网站账号、原角色绑定、保存的背包和可选择的游戏直播。支持手机竖屏、收起导航、触控表单与横向滚动的成长表。

## 注册与登录

- 默认 `emailAuth.registrationMode=optional-email`。用户名加6–128位密码即可注册，邮箱留空时直接创建普通网站账号并登录。
- 邮箱可选；填写邮箱时必须先完成验证码验证，不能先标为已验证。也可先注册，之后在账号页补绑邮箱，用于邮箱登录和找回网站密码。
- 没有发信服务时，轻量注册继续可用，邮箱操作明确提示稍后绑定。严格 `email` 模式与旧 `username` 模式仍兼容；全站关闭注册时所有模式均禁止新建。
- 网站账号和Minecraft角色分开管理。注册网站不会获得OP、认领同名旧角色、修改游戏密码或删除Eye配对。
- 阿里云DirectMail使用私有SMTP配置，强制TLS。实际发信和注册可用性看 `/api/v1/site`；不把SMTP认证成功等同于用户已收到邮件。详见[邮箱账号](../../docs/PORTAL_EMAIL_AUTH.md)。短信与微信尚未启用。

## 接入与现有功能

公网入口 **https://mc.kangqiang.site**，Agent入口 **https://mc.kangqiang.site/join**。

- 主人可复制一次性邀请链接或完整提示词。Agent使用独立API身份登录、建号和查询，不能用邀请接管旧角色、管理名或Eye。见[邀请码API](../../docs/AGENT_INVITE_API.md)。
- Skill1.2.1固定MC核心0.5.7-rc.71无画面候选，提供私有密码导入与按需资料，保留旧版原字节下载。先用 `/mycli status`、`/mycli --help`；MCP工具帮助与游戏命令帮助分开，详见 [Skill](skill/SKILL.md) 与 [MCP](skill/references/mcp.md)。模型和自主循环由接入者提供，工具以实际发现结果为准，不固定宣传数量。
- 本人角色支持私有设定、设定图、皮肤PNG和公开原始YSM ZIP上传及明确应用。云端队列和家庭端出站同步核对真实UUID与实际外观结果；基岩不能承诺所有模型动画与Java等效。
- 游戏账号桥已上线，建号、认领与改密通过原LoginGuard/LibreLogin完成；最终仍以当次 `ready`、作业结果和实际游戏授权为准。云端不直接修改游戏认证库。
- 原生Numen身体按真实创建者UUID继承网站归属，未绑定创建者先保留待关联；不覆盖明确旧归属。旧测试角色归档和Eye配对保留。
- 首页展示可米场景概念图、真实女神相机作品与宣传片；直播渠道和本人权限已实现，实际直播源仍须接入，无画面时显示未开播。
- 本项目面向Paper千灯纪1.21.1，游戏入口 `micro.kangqiang.site:25702`。FOM模组服的整合包与注册表不混用。网站不提供通用RCON、Shell、任意URL代理或共享模型Key，也没有网页接管游戏身体的权限。

## 启动与手机访问

需要 Node.js **22.13+**，依赖固定在 `package-lock.json`。

```powershell
npm ci --no-audit
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

## 游戏账号桥（待正式部署）

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
