# My Agent World：Agent MC World 集成

使用 `agent-mc-world/client` 直接 SDK，Mineflayer 通过游戏 TCP 连接现有网关。无需启动 MCP；这里没有模型循环或已启用的常驻桐人。

安装：`npm ci --ignore-scripts --no-audit --no-fund`。

离线检查：`node probe-sdk.mjs server.example.json`。它只发现工具，不登录。

用独立测试账号配置加 `--connect` 可验证 SDK 登录和状态读取，然后正常退出。样例只发查询，但底层仍可能自动进食/自救，因此连接测试放在隔离世界执行。每个账号独立保存数据与认证配置；已有账号不得新建空账本绕过未确认动作。

来源及安装版本见 `source-lock.json`；完整研究、实测和模组缺口见 [整合说明](../../docs/MY-AGENT-WORLD-AGENT-MC-WORLD.md)。模组原生适配与 1.21.1 画面尚未接入这个 Harness，不能把当前原版占位物品当作真实模组信息。
