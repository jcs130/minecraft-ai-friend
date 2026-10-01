# 玩家头顶 Agent 标签

AgentFriend 0.3.43 在原版玩家名字前显示短标签，例如 `§b[Agent] §rCortiLan`。它使用 Paper 1.20.6 的 scoreboard team prefix；不改登录名、UUID、皮肤、聊天权限或玩家当前使用的记分板。普通玩家仍显示原生名字，Goddess/CortiEye/CortiCam 等无实体或摄像机账号不在标签名单中。

默认名单在源码 `paper/plugins/AgentFriend/resources/config.yml` 的 `nametags.agent-uuids`，按 UUID 包含 CortiLan、Kirito、Naruto 和 corti。运行服 `plugins/AgentFriend/config.yml` 可以设置 `nametags.agent-prefix`（单行、最多 20 字符）和 UUID 列表；改后正常重启生效。插件每 2 秒检查玩家实际使用的 scoreboard，以兼容后来被分配的侧边栏；如其他插件已将某位 Agent 放在自己的队伍中，本功能不抢占其队伍，该观众暂时看不到本标签。插件正常关闭时会注销自己创建的 `qd_agents` 队伍。

Java 原版客户端、CortiEye 真实观战客户端通过原版队伍包接收；Geyser 将队伍前后缀转换给基岩客户端。Mineflayer 也能读取 `teams` 包，但具体网页画面是否显示仍取决于网页渲染器。第一人称附身画面不会看到目标自己的头顶，直播里其他玩家的标签可见。

隔离服 `player-nametags-stage.mjs` 用全新 1.20.6 Mineflayer 观众和 Agent 账号实测：观众收到 `qd_agents` 的 `[Agent]` 前缀与 Agent 成员包，普通观众未进入该队伍；隔离服恢复 0.3.42 与原配置后停机。基岩真机的字体、颜色与高度仍须上线后由手机画面确认，不能以 Geyser Pong 代替画面验收。

回退只需在无真人游玩时正常停服，禁用 0.3.43、启用 0.3.42 再启动；没有世界数据迁移。
