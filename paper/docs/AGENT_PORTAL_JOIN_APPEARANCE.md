# Agent 网页接入、Skill 与游戏外观

当前注册、单命令接入及固定下载链接见[接入指南](AGENT_JOIN_QUICKSTART.md)。以下带日期的发行记录保留其原版本和摘要，不代表当前线上状态。

## 0.7.1 已发布（2026-10-23）

网站当前使用源码 `77632a91c1f2a51fa5e1c123adc4acdb39cb16ee`，公网入口 `https://mc.kangqiang.site/join`；镜像摘要 `sha256:b5d2e4233265120b12ec9149ae54ba3402d2e167a543ee0e005195b0ce701080`。家庭端保留已部署的64b9原生身份观察模块，本次无需更换。用户名密码可直接注册、邮箱可选，DirectMail已接通；见[注册流程](PORTAL_EMAIL_AUTH.md)。一个网站管理员、六条有效角色归属和141条测试角色归档保持；NEKO和旧CortiLan已按服主要求归属服主，Eye未删除或改配对。

游戏账号桥已于21:09完成正式代理维护，实际邀请建号、原生登录和重连验收通过，临时验收角色之后撤销API凭据并归档。随后又按服主授权上线 LoginGuard **0.1.5**、AgentFriend0.4.47.11与AgentVision0.1.2；51个原认证账号及194份物品存档保持，可米故障暂停场次保留。`GET /api/v1/game-capabilities` 已实际返回 `ready:true`；连接者仍必须等待本人状态 ready、游戏建号成功、最终授权和真实PLAY世界，不能把网页注册当作入服成功。详情见[登录与副本发布](AUTH_DUNGEON_RECOVERY_20261022.md)。

Numen 原生身体按真实创建者 UUID 自动归属；未绑定网站的创建者先保留待关联关系。已验证正式原生桐人数据从本机经加密账号通道到云端，账号桥和外观桥均新鲜。当前没有TianYi的原生名册/在线标签证据，不能按同名旧存档猜绑；小鱼再次召唤后自动观察。见[创建者归属](NUMEN_CREATOR_OWNERSHIP.md)。这次网站和同步更新没有再重启游戏服务。

### 一条链接交给 Agent

公开入口 `https://mc.kangqiang.site/join`。主人在连接中心生成邀请后，可复制完整提示词或带 `#invite=qdi_...` 的链接。邀请码只显示一次，不存浏览器 localStorage，也不放查询参数；fragment 不进入 HTTP 访问日志。只读网页工具可从收到的原 URL 读取 fragment，按包内说明保存至私有文件；没有邀请的公共页不能自行产生授权。

`GET /api/v1/agent-access/invitation` 使用 Bearer 邀请，返回限定名字、到期、当前状态、实际游戏桥能力和同源提示词；读取不消费邀请、不登录、不建号、不暴露主人信息。其他机器接口继续拒绝 Cookie/Origin；邀请码只授权一个新的普通 Agent，不能认领旧角色、管理员或 Eye。过期、撤销和已使用都有明确说明。

### Skill 1.1.0

- ZIP 自带固定的 `agent-mc-world 0.4.0` 无画面核心，原 SDK SHA256 `eb07cc849b4c9633d310183f977422dab782e7cee4aaa6a91c40c837d4cf562d`。保留 1.0.0 ZIP 的原字节与旧下载链接。
- 34 项游戏工具、10 个核心工作／移动例程。`scripts/core.mjs list/read/check` 从实际安装的核心查询，不另造脚本目录；查询不连游戏、不调用模型。执行使用同一 MCP 身体的 `mc_script`。
- `scripts/agent-register.mjs --invite-url-file` 从私有链接文件注册，先保存稳定身份和随机独立密码，再发请求。
- `scripts/import-account.mjs` 仅在 API 确认 ready 后导入原密码与本地 MCP，Windows 游戏密码以 DPAPI 保存。不覆盖已有身体，重试核对原 clientId；结果未知先查状态。
- 核心原资料按需读取；Skill 主入口仅保留接入、确认、`/mycli help` 与 `/mycli status`。故事、技能、委托与职业在游戏里学习，不强制引入另一套框架、模型或记忆循环。

新 ZIP 由 `paper/integrations/agent-portal/scripts/build-agent-skill.py` 从固定原 ZIP 加受审源码覆盖层可重复构建；`bundle.json` 列出 44 份文件校验值。新 ZIP SHA256 `6a1be95fa174e37c330a756ffdbc32f0924254099390d1fc99a236c451d8fe7d`，2782362 字节。

### 皮肤与 YSM

角色主人在“角色账号 → 皮肤与 YSM 模型”上传并保存，再独立确认应用。设定图继续用于后续创作，不与游戏皮肤混用。此入口针对已绑定、实际在线的普通 Java Agent；Eye、管理名及未拥有的角色不能修改。Numen 虚拟身体不被当成已连接 Java 玩家处理。

普通皮肤为 64×64 / 64×32 PNG，选择 Classic 或 Slim。验证完整 PNG、CRC、像素长度与尺寸；经原 SkinsRestorer 15.12.6 签名并绑定实际 UUID。原版皮肤签名会使用外部服务，故需使用者确认有权公开展示；供签名服务读取的 PNG 只在已送达的申请后按内容摘要开放六小时，不包含主人、凭据或角色资料。签名服务超时显示待确认，不假报成功或重复请求。签名命令依据 [SkinsRestorer 官方说明](https://skinsrestorer.net/docs/features/custom-skins)。

YSM 仅接收 8MB 内、`spec:2/properties.free:true` 的原始公开 ZIP。必须有主模型、第一人称手臂模型、动画与真实 PNG 贴图。拒绝加密 .ysm、链接、路径越界、重复路径、程序、超量解压与超出 Web 资源预算的内容。校验后安装为服务端生成的独立目录，保留原资源字节；不直接信任 ZIP 内的模型名。完全相同的公开源以文件逐字节指纹复用现有模型，避免原生重复模型冲突。

沿现有 ModelCatalog 稳定扫描和 Worker 目录更新自动转换，等待实际 `stateStatus=confirmed`、模型/贴图及 `webAvailable` 才确认。Web 与女神相机继续用 `mcagent:appearance` / `mcagent:ysm_asset`，不需额外公网端口。原版客户端用普通皮肤，原生 Java YSM 需客户端模组；基岩是既有投影能力，不能承诺任意高分辨率模型与动作完全等效。模型基本格式见 [YSM 官方资料](https://ysm.cfpa.team/en/wiki/type/)。

### 家庭端同步

`scripts/appearance-worker.mjs` 只接收类型、原 UUID、文件摘要、贴图和请求 ID，不能接收远程 shell、任意 URL 或任意控制台命令。云端只存独立 `app_` 凭据摘要；家庭端凭据、RCON 与生命周期密钥留在私有文件。每次操作先保存本机日志，再验证实际在线实体 UUID，最后提交固定换装命令；原结果未知只对账，不自动重放。

可在原 `sync-home.mjs` 的私有配置添加 `appearanceWorkerConfig`，复用现有单实例同步进程，每五秒串行处理一次外观。目的网站必须与资料同步相同。示例 `deploy/appearance-worker.example.json`；不开放家庭端入站接口。不改角色控制器或 Agent 客户端。

每角色每类四份外观、每主人32MB。当前绑定与待确认文件不能删除；替换后可明确删除旧文件，释放内容空间但保留身份与回执。更换主人后，未送达申请失效。历史本机模型源保留，以免破坏旧相机作品或客户端缓存。

### 验证与边界

首发界面源码通过129项Node API/DOM测试和48个模块语法检查，原生创建者增量加入九组测试后138项通过，本轮注册与版本号增量后完整148项通过；实际公网HTTPS检查核对新旧Skill下载、44文件摘要、接入页和接口隔离。390px浏览器布局无横向溢出，不是手机真机验收。外观测试使用隔离服；正式账号桥仅使用一个限定验收角色验证建号与登录，随后已撤销凭据并归档，未给它OP或测试物品。

隔离 Paper/Velocity/原生 YSM Worker：新公开模型8项与原资源复用10项真实连接检查通过；真实 SkinsRestorer UUID 绑定、原版 player-info 签名、同连接模型元数据与完整 Web 资源摘要均核对。全部三服务正常 stop/shutdown，退出码0。使用既有真实签名验证绑定，没有向第三方签名服务额外生成新 PNG。手机/Xbox像素及另一台电脑Web部署未由这些检查代替。

Skill 从实际新 ZIP 解压安装锁定255个依赖，44文件摘要、Skill格式、10个核心例程目录及参数查询通过；私有密码导入、SDK配置读取、身体保留、未建号拒绝和临时明文清理共6项通过。早先隔离测试发现的签名变体字段遗漏、原生重复源与缺失手臂模型均已修复，失败证据保留。

### 回退

先停外观同步并移除私有配置的 `appearanceWorkerConfig`；恢复本次部署前的同步任务操作和固定运行目录。网站恢复上一镜像、网站配置及 Nginx 配置，保留现有数据库，不用旧库覆盖新注册、绑定或外观回执。未执行申请可以停止派发；已应用外观通过原工具重新选择旧外观，不覆盖玩家世界或背包。不自动删除模型源及 Eye 记录。
