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
