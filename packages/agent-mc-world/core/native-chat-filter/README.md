<!-- Owner: CorticoChatFilter.java, fabric.mod.json, ../../../../scripts/build-minecraft-chat-filter.mjs -->

# Native chat filter

Fabric 1.20.6 的显示端过滤器，通过 `ClientReceiveMessageEvents.ALLOW_GAME` 隐藏以 `MC_大写协议名 {` 开头的机器系统回执。普通玩家聊天、任务公告、权限错误与状态栏保持显示；Mineflayer 连接和 Agent 的协议解析独立运行。

需要 JDK 21、Fabric API，以及已启动过一次的 Fabric 1.20.6 游戏目录。构建脚本使用该目录的真实中间命名客户端和 API，运行过滤检查后生成 jar；加 `--install` 安装到指定目录：

```text
node scripts/build-minecraft-chat-filter.mjs <gameDir> --java-home <JDK21Dir> --install
```

安装后单独重载原生客户端。启动日志出现 `[CorticoChatFilter] Active`，实际隐藏第一条及此后每128条时记录计数。移除 `mods/cortico-chat-filter.jar` 并重载客户端可恢复完整显示。
