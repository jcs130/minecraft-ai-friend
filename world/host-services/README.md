# 宿主侧服务正本（host-services）

> 这里收的是**不在 compose 里、跑在宿主机上的服务**的**可复建正本**（入 git ✓）。
> 它们的运行副本原本散落在被 gitignore 排除的目录里（`ops/docker/.gitignore: shadow/`、根 `.gitignore: /server/`），
> 换机 / 重建即丢 —— 2026-09-21 收编进本目录，杜绝"权威不在受控位置"。
> 部署与验收动作见 `docs/deploy-release-runbook.md` §5–§6；号映射权威见 `docs/BOTGATE-IDMAP.md`。

| 子目录 | 服务 | 运行副本位置 | 状态 |
|---|---|---|---|
| `viaproxy-bedrock/` | 基岩桥（ViaProxy 内嵌 Geyser） | `C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\viaproxy` | 在跑 ✓ 已过门（`--target-address 127.0.0.1:25701`） |
| `skin-proxy/` | 皮肤注入代理 | `C:\Users\lzl19\.dsh\profiles\web` | 在跑 ✓ 上游已改 25701 ✓ 实测 11/11 |
| `geyser-container/` | Geyser 容器化 A/B 试验 | `D:\Projects\QiandengJi\server\geyser-ab` | 试验中（宿主发 UDP **19141**，现役 19140 未动） |

## 同步纪律（重要）

1. **改运行副本必须同步改这里**（反之亦然）✓ 否则正本变谎言
2. 大文件（`ViaProxy-3.4.12.jar` 47MB、`Geyser-ViaProxy.jar` 42MB、`Geyser-Standalone.jar` 54MB）**不入 git** ✓ 只记来源与指纹（见各子目录 `notes.md`）
3. 每次动完宿主服务，用**进程命令行实查**验收（`schtasks /end` 不杀 bat spawn 的孤儿进程 ✓ 见 runbook §6）

## 当前指纹（收编时 2026-09-21）

| 文件 | sha256 前 16 |
|---|---|
| `viaproxy-bedrock/start-viaproxy.bat` | `8606aa5b201056de` |
| `viaproxy-bedrock/geyser-config.yml` | `7bacffb010ada823` |
| `skin-proxy/start-skin-proxy-local.cmd` | `2e00b360d273b7ce` |
| `geyser-container/config.yml` | `30e4d6d7d3aea4fc` |
| 运行副本 `D:\...\skin-proxy-local.mjs`（属 harness/dsh 侧，**不复制只记指纹**） | `07770ea233fc6203` |
| `Geyser-Standalone.jar`（仓内 `server/geyser-standalone/`，54MB 不入库） | `11ced1e0ceb5afbf` |
