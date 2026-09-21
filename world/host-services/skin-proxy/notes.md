# 皮肤代理 skin-proxy · 宿主服务

## 归属（重要）
运行副本在 `C:\Users\lzl19\.dsh\profiles\web` = **harness / dsh 侧**（不是游戏仓资产）✓ 本目录只收**启动器正本 + 指纹**，
**不复制 `skin-proxy-local.mjs` 源码**（避免造出第二份事实源）✓ 改它须与 harness 侧对齐。

## 它是什么
双端 Minecraft 协议代理：`客户端 → :25566 → 上游`；login/config 两侧各走各的状态机，
**PLAY 阶段走字节级 raw bridge**（历史上 packet 转发会把 NeoForge 扩展字节弄坏）。
用途：给自家 bot 注入皮肤（皮肤库与面板/agent-store 同一份 `skins.json`，单一事实源）。
当前皮肤映射：`kirito / naruto / actprobe / edward`（每小时热重载）。

## 2026-09-21 的关键变更
`SKIN_UPSTREAM_PORT=25565`（裸口，绕过号翻译）→ **`25701`（神社之门）**
运行副本留有 `start-skin-proxy-local.cmd.bak-raw25565` 可回滚。
验证：`node verify-gate.cjs 127.0.0.1 25566` → **11/11 exit 0** ✓（raw bridge 会把门翻好的字节原样透传，符合预期）

## ⚠ 一条差点犯的错（记此防复发）
今天我先把它判成"死进程"（依据：`Establish` 0 条 + 游戏仓 0 引用）并 disable+kill ✗ **错**：
① 瞬时 0 连接不代表没人用；② 它住在 harness 目录，**我的检索面没覆盖到**；③ 它日志当天还在写。
已当场 `enable + /run` 回滚恢复（`RESTORED 25566`）。判遗留服务请按 runbook §6 的四条硬证据。


---

## 2026-09-21 深夜：已收编进容器（`compose.yml` 服务 `skin-proxy`）

**运行位置变更**：宿主直跑（计划任务 `SkinProxy-Local-Autostart`，**已 disable**）→ **容器 `qiandengji-skin-proxy-1`**
- 基座 `qiandengji-world:20260913-qd1`（node v22 + minecraft-protocol 1.67.0 ✓）
- **脚本与皮肤库的正本仍在 `.dsh` 侧**（`C:\Users\lzl19\.dsh\profiles\web\`）✓ 容器只读挂载 ✓ 不在仓里复制第二份
  - ⚠ 曾差点挂错：仓里 `server/character-skins/skins.json` 是**另一份 0 preset 的文件** ✓ 挂它=皮肤全丢 ✓ 现役那份是 `.dsh\profiles\web\data\skins.json`（15 presets / 4 assignments）
  - ⚠ 脚本必须挂在 **`/app/` 下**（与 `/app/node_modules` 同层）✓ ESM 不认 `NODE_PATH` ✓ 挂 `/opt` 会 `ERR_MODULE_NOT_FOUND`
- 上游：`host.docker.internal:25701`（经宿主发布口进内门 ✓ 与容器化 ViaProxy 同处方）

### 本轮给它补了两个健壮性修复（正本文件已改，备份 `skin-proxy-local.mjs.bak-nowatchdog`）
1. **握手看门狗** `SKIN_HS_TIMEOUT_MS`（默认 12s）：上游半死连接时主动断开——原先要挂满客户端自己的 30s 超时
2. **连续失败自愈** `SKIN_HS_FAIL_BUDGET`（默认 2）：连续 2 次看门狗超时 → 进程 `exit(1)` → 容器 `restart: unless-stopped` 拉起干净进程
   根因（**已修正，见文末实验**）：曾判为"容器/Linux 状态泄漏"与"门重启导致" ✓ **两条都被对照实验推翻** ✓ 真相是代理进程自身缺陷：上游=裸口 25565 时 0/5、上游=门 25701 时 1/5 ✓ 与门和容器无关 ✓

**验收（2026-09-21 17:29-17:30）**：基线 11/11 → 重启门 → 第1/2 次各 14s 快速失败（watchdog 1/2、2/2）→ 自愈退出 → 容器拉起新进程（RestartCount=1）→ **第 3 次 11/11 ✓ 全程无人工干预** ✓
对比改前：门一重启就永久僵住 ✓ 必须人工重启进程 ✗

### 回滚
```
docker compose stop skin-proxy
schtasks /change /tn "SkinProxy-Local-Autostart" /enable && schtasks /run /tn "SkinProxy-Local-Autostart"
```


---

## ⚠ 2026-09-21 深夜·对照实验推翻上面两条结论（以此节为准）

| 组 | 上游 | 连打 5 次结果 |
|---|---|---|
| A | **裸口 `127.0.0.1:25565`（= 我改造之前的原状）** | **0/5** ✗（每次 2 秒即失败） |
| B | 门 `127.0.0.1:25701` | **1/5** ✗（第一次成，之后上游"TCP 连上但字节到不了对端"，12s 看门狗断开） |

**结论（三条，都推翻我先前说过的话）**：
1. **不是门的问题**：回退到改造前的裸口上游，它**更差**（0/5）✓ 所以"过门导致退化"不成立 ✓
2. **不是容器/Linux 的问题**：宿主 Windows 直跑同样 1/5 ✓ 我先前那句"Linux 下状态泄漏"是错的 ✓
3. **是代理进程自身的缺陷**：新进程第一次会话能成，之后所有上游连接半死 ✓ 我 20:4x 报的"皮肤代理 11/11 ✓ 第五条通路闭合"**是拿 n=1 当稳定性结论** ✗ 方法错误在此记档

**我造成的一次真实故障（已修）**：为"自愈"加的连续失败 `process.exit(1)` ✓ 在宿主上等于**永久下线**（计划任务不会自动拉起）✓ 现改为**需 `SKIN_SELF_HEAL=1` 显式开启**（容器里由 restart 策略监督时才允许自杀）✓ 握手看门狗 `SKIN_HS_TIMEOUT_MS` 保留 ✓ 它只是快速失败 ✓ 不会杀死进程 ✓

**当前定状**：
- 上游 = `25701`（方向正确，且 A 组证明回退不会更好）✓ 宿主直跑实例（pid 见 `Get-NetTCPConnection -LocalPort 25566`）✓ 容器版已从 compose **注释停用**（定义保留在文件里，写明原因）✓
- **它现在不可靠**：任何依赖它的 bot 皮肤注入都可能失败 ✓ 好在**当前无人在用**（`Establish` 连接 0 条 ✓ numen 身体不经它 ✓）
- **待办（归组件属主，harness/dsh 侧）**：修"首会话后上游连接半死"的进程内缺陷（怀疑 socket/listener 泄漏）✓ 修好后：`SKIN_SELF_HEAL=1` + 容器版取消注释即可收编 ✓
- **战略解法（更值得做）**：按已定架构走 **GameProfile textures 服务端进皮** ✓ 一旦落地，这个 TCP 皮肤代理**整体退役** ✓ 比修它更划算 ✓

**方法论教训（今天第 N 次）**：
- **n=1 的成功不能当"通路稳定"** ✓ 稳定性必须连打多次（本轮起统一用 5 次）
- 归因必须有**对照组 + 回退组**：本轮"回退到改造前状态再测"这一步来得太晚 ✗ 它直接推翻了我的因果结论
