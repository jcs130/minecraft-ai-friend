# 服务器产品化改造方案

目标：让“我的世界AI陪玩”从本地控制台，升级为可长期运行的 AI 村庄/直播服务器系统。今天不修改正在运行的服务器，只准备方案和代码。

## 当前结论

现有 Vanilla 服务器可以继续用于验证 AI 常驻居民、采集、建造和公共箱子协作。但 Vanilla 不支持服务端插件，后续如果要做稳定的 Agent 社会、直播导播、权限、事件流和可交付产品，建议迁移到 Paper。

## 分阶段路线

### 1. 保持现状

- 不替换 `server.jar`。
- 不写 `server.properties`。
- 不重启当前服务器。
- 控制台只读取服务器目录、`server.properties`、jar 文件和日志，生成 dry-run 蓝图。

### 2. 测试副本迁移

- 复制整个服务器目录到测试目录。
- 备份 `world`、`server.properties`、`ops.json`、`whitelist.json`。
- 在测试目录验证 Paper 启动、原版客户端进服、Mindcraft 进服、2 个 AI 进服。
- 先在测试副本里安装插件，不直接动生产世界。

### 3. 服务端事件桥

优先实现一个 Paper 插件 `ai-friend-bridge`，通过 HTTP/WebSocket 把服务端状态推给控制台：

- 玩家与 AI 坐标。
- 公共聊天。
- 方块放置和破坏。
- 死亡、受伤、饥饿、进度。
- 公共箱子库存。
- 村庄区域、床、农场、照明、道路和建筑状态。

这样 Agent 不只依赖单个 bot 视角，而是拥有稳定的“服务器公共事实”。

### 4. 直播导播

增加独立观察账号 `ServerTV`：

- `ServerTV` 使用旁观模式。
- OBS 捕获原生 Minecraft 客户端，保证画质和兼容性。
- 后续 `ai-friend-director` 插件控制镜头：跟拍 AI、轮换目标、无人在线时巡航村庄。
- 控制台展示当前镜头目标、导播状态和 viewer 健康状态。

### 5. AI 社会系统

默认居民：

- `Alex`：生存管家、安全、基础资源和公共箱子。
- `Luna`：建筑、基地、道路、照明、农田和住宅。

可选扩展居民：农业、采矿、探索、战斗等专职角色，等两人模式稳定后再启用。
长期规则：

- AI 是服务器居民，不是无脑跟随玩家的宠物。
- 基地半径默认 120 格。
- 优先建设公共箱子、照明、围栏、道路、农场、床、储物和住宅。
- 真人玩家求助时优先响应；无人在线时继续建设村庄。
- 所有高风险动作需要保守策略和可回滚备份。

## 推荐 server.properties

用于正式生存/直播服务器：

```properties
gamemode=survival
difficulty=easy
max-players=12
pvp=false
spawn-protection=0
view-distance=8
simulation-distance=8
allow-flight=false
force-gamemode=false
hardcore=false
enable-command-block=false
motd=AI Friend Village
```

说明：

- `difficulty=easy` 比 `peaceful` 更接近生存，又适合新手和 AI 初期建设。
- `max-players=12` 预留真人玩家、2 个 AI、`ServerTV` 和扩展空间。
- `allow-flight=false` 是默认安全值；只有观察账号或相机工具被误踢时才考虑打开。
- offline/LAN 模式下，如果开放给更多人，必须配合白名单或权限插件。

## AI 村庄共享记忆

控制台本地保存 `data/village-state.json`，记录基地、公共箱子、AI 居民角色、资源目标和长期项目。Autopilot 会把这些信息加入任务上下文，让 AI 围绕公共仓库、照明、农场、道路和住宅持续工作。

## 控制台代码支持

已增加：

- `GET /api/server-blueprint`
- 服务器改造蓝图页面
- 实施就绪度评分：基础可运行、AI 生存配置、插件化平台、安全运维、直播观察、AI 社会系统
- 下一步行动清单：保持现状、测试副本、Paper 迁移、事件桥、导播、共享记忆
- dry-run `server.properties` 预览和备份范围检查
- Paper/插件/直播/AI 社会路线展示
- 服务端事件桥契约草案
- Markdown 方案复制

这些能力都是只读的，不会修改当前服务器。
