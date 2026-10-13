# 外部 Java 服务器、正版账号与客户端启动

## 三个边界

| 层 | 配置 | 结果与限制 |
| --- | --- | --- |
| Mineflayer 连接 | `host`、`port`、`version: auto` 或明确版本 | 自动协商 Java 协议；受固定 Mineflayer 版本支持范围限制 |
| 账号 | `auth: offline` / `microsoft`、`username` | 微软设备码授权与 Java profile；离线账号不能用于 online-mode 服务器 |
| 显示 | `viewerPort`、`viewerAssetsDir`；`client` / `player` | 网页素材和已安装 Java 客户端版本各自匹配，不由连接成功推定兼容 |

这是独立 Java 客户端，不要求服务端跑在本机。白名单、账号权限、反机器人、代理策略及模组协议仍可能阻止接入；没有实现 Bedrock 或 Realms 目录，也不承诺任意模组服支持。

## 首次正版接入

1. 安装 release 包，复制 `examples/minecraft-online.json` 为仓库外的私有配置。
2. 填写服务器。`username` 是该账号的稳定缓存标识，可用别名；实际游戏名和 UUID 从验证后的 Java profile 取得，不拼 `ag_` 前缀。
3. 使用 MCP 时设置 `consolePort`，启动一次 MCP 进程；打开其本机连接台。没有 MCP 时运行 `minecraft-agent-client <私有配置.json>`，默认连接台端口 7796。两种入口共用执行器，选一种拥有该实例。
4. 显式连接后，在连接台查看微软设备码，自己到官方授权页面完成登录。无需将密码交给 Agent。
5. 确认账号验证、协议连接和真实游戏实体分别就绪，再通过 `mc_events` / 现场读数核验当前世界。账号验证完成不代表已通过服务端白名单。

实现直接使用 [Mineflayer 的 Microsoft 模式](https://github.com/PrismarineJS/mineflayer#usage) 和 [Prismarine Auth](https://github.com/PrismarineJS/prismarine-auth)，复用其 OAuth、刷新与 Java profile 检查。连接层保留原生聊天签名路径，未另造认证协议。

## 缓存与取消

默认分别保存于私有 `dataDir/auth/agent`、`auth/observer`、`auth/player`。也可为各账号配置 `profilesFolder`；相对路径相对私有配置文件解析。保持账号标识与目录稳定才能复用授权。不同账号或实例不要共享缓存。

缓存含刷新凭据，只应由本机运行用户访问，不提交、不放共享盘或 Web 静态目录。Unix 创建目录使用 0700；Windows 继承私有数据目录权限，发布验证没有替用户审核 ACL。要清除授权，先停该账号连接，再由账号所有者删除对应缓存并按需撤销微软授权。

设备码只出现在操作员连接台，默认不在 MCP 状态、事件、模型事实或 OBS。设备码到期明确显示；结束该次连接后可重新尝试。取消使旧授权结果失效，不能迟到后又启动窗口。验证失败明确失败，不回退成同名离线账号。

## Java 观察者与玩家窗口

这版复用已有 Java 启动器：读取 `gameDir/versions/<versionId>/<versionId>.json` 及继承链、库、资源和 natives。先用常用启动器安装正确版本，再填写 `gameDir`、`versionId` 与适合该版本的 `javaPath`。**本版没有实现游戏/JRE/模组的自动下载安装。**

`world.client` 是可选观察者；`world.player` 是可选玩家。它们各有 `auth`、`username`、`profilesFolder`，启动时通过 Prismarine Auth 取得真实 Java profile/token，再传给 Java 进程；公开命令预览不显示正版启动参数。只在需要时启动，默认不开窗口。不要让观察者和 Agent 使用同一个在线账号，否则服务端可能踢掉原连接。

观察者自动附身、传送或观战需要服务端相应权限/插件，通用默认 `autoSpectate: false`、`resyncSec: 0`。离线服的密码插件由独立 `loginConfigFile` 处理；Microsoft 验证不代替插件密码，也不会自行发送服务器命令。

## 网页与 OBS

连接台仅绑定 `127.0.0.1`，允许显式连接/断开、启动/关闭两类 Java 窗口；没有任意命令、文件浏览或凭据下载接口。相同 MCP 进程可同时提供画面、连接台和只读指标。

共享前端来自固定提交的 [mc-visual-console](https://github.com/jcs130/mc-visual-console)。内置现代素材为 Java 1.20.6，其他协议使用基础画面并记录素材不匹配；现代 OBS/HUD 仅在匹配资源时提供。Java 原生窗口就绪也不能证明账号已进入服务器。新版现代画面有真实路径、方向键/鼠标操作标记和 OBS 视角校准；公开解释与候选路线由 Agent/宿主显式发布，标注来源，不展示隐藏推理或凭据。

## 本次验证范围

- 本机临时 Java 1.20.6 与 1.21.1 协议服务：真实状态探测、自动版本识别、离线协议登录。没有完整世界，不能验证游戏操作与画面一致性。
- 注入认证结果：profile/UUID/token 传递、缓存目录隔离、授权失败、到期、取消及迟到结果；窗口启动使用测试子进程，未启动真实游戏。
- 本机连接台：同源操作、访问范围、异步启动/取消、公开信息与凭据隔离；Cortico、MCP、SDK 装配另测。
- **未验证：真实微软账号的完整授权/刷新、公网 online-mode 进服、各服务器完整玩法，以及其他版本的现代画面。** 需要账号所有者首次授权后分别记录结果。

源码、安装包、当前部署加载与真实进服分别记录；本次开发不重载可米现役实例。
