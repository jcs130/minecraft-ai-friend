# 无账号场景观战源 · WorldObserver 0.1.0

**候选，未部署到正式服。** Paper 1.21.1 / Java 21 / ProtocolLib 5.3.0，复用
[mc-visual-console](https://github.com/jcs130/mc-visual-console) 现代化页面。
已有玩家或 Numen 身体是观察对象；网页观众不会登录新的 Minecraft 玩家，不占 Eye 名额。

## 组成

- `src/…/WorldObserverPlugin.java`：只读采集原玩家 UUID、姿态、原生区块/实体包和物品 SNBT。
- `worker.mjs`：查询网站授权，解码 1.21.1 原生数据，复用现代渲染源并出站 WSS 发布。
- `config.yml`：插件默认关闭，启用后仅监听 `127.0.0.1`。
- `worker.example.json`：本机私有路径示例，实际凭据单独存文件。
- `tests/worker.test.mjs`：租约、撤权、关闭竞态、断流和大小/来源限制。

不修改 Agent 客户端，不运行决策模型，没有游戏控制、登录、RCON或任意 URL 代理接口。

## 构建与准备

```text
python build.py --server /absolute/paper-server --jdk /absolute/jdk-21 --output /new/build-directory
npm ci --ignore-scripts
npm test
```

构建只读使用服务端已解析的 `versions/1.21.1/paper-1.21.1.jar`、
`plugins/ProtocolLib-5.3.0.jar` 和 `libraries/`。输出 JAR 与 SHA256，不自动安装。
代码依赖精确的 1.21.1 NMS；其他核心或版本必须单独适配，不能直接换版本号。

将已审核的 mc-visual-console 固定提交冻结到独立运行目录，安装其锁定依赖。
原始 Minecraft 素材需用该项目的导出工具生成，保持原模型、材质、注册表和 SHA256；
不能拿翻译后的 Mineflayer 方块表替代渲染注册表。官网可信页面由该提交的
`renderer-src/tools/build-native-spectator-site.mjs <new-directory>` 生成。
页面与家庭端的浏览器、控制台 bundle 摘要必须一致，否则拒绝发布。

## 启用（需维护确认）

1. 正常停服并完成原 E/F 冷备份；不要使用 `/reload`。
2. 安装独立 WorldObserver JAR，将其配置 `enabled` 设为 `true`，保留回环绑定。
3. 启动后插件生成 `plugins/WorldObserver/worker.key`。只允许运行服务的系统账号读取。
4. 本机生成独立 `obs_` 加 32 字节 base64url 随机凭据；原文写入私有文件，官网只配 SHA256。
   它不是游戏密码、网站登录凭据或通用控制 Token，不放仓库、URL或前端。
5. 在私有 `worker.json` 填绝对路径、官网 HTTPS 地址和原始资源/外观目录。
6. 官网启用 `live.worldObserverEnabled`，配 `worldObserverTokenHash`、
   `native3dSiteDirectory`，然后按官网正常发布流程启动。
7. 用服务管理器运行 `node worker.mjs /absolute/private/worker.json`；家庭端仅出站 HTTPS/WSS 443。

公网反向代理只为现有 `POST /api/v1/internal/world-view/poll` 和精确的
`/api/v1/live/<32位小写十六进制ID>/source` 路由提供转发；后者需要 WebSocket Upgrade。
`/watch/` 的 SSE 转发应关闭缓冲。不要将本机观察端口映射到公网。
普通浏览器和其他用户不能调用 worker 入口，所有网页读取仍按 UUID / 会话核验。

## 范围、限额与真实性

- 默认半径 2 区块，最多 4 个同时观察对象；16 个 Agent 在线不等于必须同时采集 16 份场景。
  同一 UUID 的多个观众共享一个场景，镜头在各自浏览器里切换。
- 普通玩家仅采集已经发给其原连接的区块与已跟踪实体；Numen 仅采集附近已经加载的区块，
  活体实体还要通过其视线检查。无生成、强制加载或额外区块票据。
- 区块每服务端 tick 最多编码一份并轮换对象，开始下一对象前检查 2 ms 预算。
  单份编码不可中断，**不是严格的 2 ms 最大耗时保证**。实体/姿态约 5 Hz；
  Numen 方块事件合并更新，另对已加载区块约每 5–8 秒校准，避免无网络包时一直显示旧地形。
- 原版登录包同样使用的群系哈希用于草/树叶染色，不导出原始世界种子。
  村民类型、职业使用服务端实际注册表，未知模型保持明确不可用。
- 私有观战仅 owner/admin，可显示本人完整背包；公开场景仅明确列入
  `live.worldObserverPublicUuids` 的 UUID，隐藏完整背包、私聊、菜单和系统工具消息。
  默认公开列表为空，旧公开 JPEG 权限不会自动升级成完整 3D 权限。
- 8 秒本机超时、20 秒网页需求过期，撤权/离线/换 UUID 清除旧源；队列与响应有限额。
  它不是录像服务，恢复后拉当前状态，不回放旧操作。
- 第一人称、第三人称跟随、3D 观战、原小地图与镜头设置复用现代前端。
  浏览器并非完整 Java 客户端；未验收的模型、声音、完整动画和像素一致性不可宣称等效。
  YSM 需要已审核的 `bundledAppearanceCatalogFile`，不能只根据玩家名字生成替代身体。

## 验证与回退

在隔离 Paper 用一个原角色验证：网页切换视角前后，在线角色/UUID列表不增加；
区块、村民与可见持物为真实数据。再验证多个观众共享、Numen 原身体、
方块变化、离线清屏、撤权、跨账号隔离和手机布局。测试资源不进入正式世界。

回退先停 worker，正常关闭官网开关/还原旧镜像和配置；需移除插件时正常停启 Paper。
保留最新网站 SQLite、原玩家资料、原密码、世界及 Eye 配对；不回滚旧数据库或合并同名 UUID。
完整部署约定见 [网站观战](../../docs/ACCOUNT_FREE_WORLD_VIEW.md)。
