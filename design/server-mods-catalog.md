# 服务端能力增强组件·选型实录

> 2026-08-20 天神亲笔。铁律：**纯服务端 only + bot 验收**（客户端零 mod 依赖）。
> 服务器：NeoForge **21.1.73**（1.21.1），`deepseek-harness/scratch-plugin/mc-server-neoforge`。
> 本文件取代已佚的旧 catalog，为此话题的唯一正典。

## 在役（8 jar，2026-08-20 全绿）

| 组件 | 版本 | NeoForge 门槛 | 用途 | 落地日 |
|---|---|---|---|---|
| settlements | 1.0.0-beta.1 | — | 聚落生成（自研） | 08-19 |
| GriefLogger | 1.2.6-1.21.1 | `[3,)` | **史官之目**：方块审计回溯（谁破坏/放置/开箱），SQLite database.db | 08-20 |
| architectury-api | 13.0.11 | — | GriefLogger 依赖 | 08-20 |
| supermartijn642-configlib | 1.1.8-mc1.21 | — | GriefLogger 依赖 | 08-20 |
| Chunky | NeoForge-1.4.23 | — | **全图之足**：预生成（已用于迁入点 [1750,-850] r24） | 08-20 |
| Clumps | 19.0.0.1 | `[4,)` | 经验球合并（XP 农场防实体爆炸） | 08-20 |
| ModernFix | 5.27.20+mc1.21.1 | `[21.0.111-beta,)` | 加载提速 + 内存优化 | 08-20 |
| spark | 1.10.124 | `[20,)` | 性能剖析（卡顿归因，/web 面板后续可接） | 08-20 |

## 落选与教训

- **knot 9.1.0 + yaml-config + GriefLogger 1.2.10**：knot 门槛 `[21.1.219,)` > 我方 21.1.73 → 启动即崩。
  教训：**装前必读 jar 内 `META-INF/neoforge.mods.toml` 的 versionRange**；降 GriefLogger 到 1.2.6
  （architectury+configlib 老依赖体系）后通过。Modrinth 上 knot 无旧版可降。
- **ferritecore / in-control / ai-improvements**：无 1.21.1 neoforge 变体（in-control 仅 forge）。
  ModernFix 已覆盖 ferritecore 的场景；聚落禁怪后续走 In Control! 的 neoforge 替代或自研 RCON 规则。

## 运维备忘

- 启动：`start-neoforge.bat`（bat 一次性启动，**无守护**——stop 后不会被自动拉起）。
- RCON：`python D:\ops\rcon.py "<cmd>"`（密码读 `data/rcon-secret.txt`，与 server.properties 同源）。
- **旧界截胡事故（08-20）**：NeoForge 服崩溃退出后，端口空窗期被 harness 侧旧 vanilla 服
  （`mc-server/server.jar`）抢占，bot 落错世界。对策：stop 后**秒级重启**抢回 25565。
- 大 jar（>10MB）从 Modrinth CDN 下载常半途断：用 Range 断点续传循环（`D:\ops\resume_gl.py` 法）。
