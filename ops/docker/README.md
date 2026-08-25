# 千灯纪 · 容器化部署（全栈）

产品「我的异世界」，版本「千灯纪」，出品「萌悦AI」。
本目录是上云部署的单一事实来源：modpack 清单 + 拉取脚本 + 全栈 compose 编排。
版本基准（2026-08-24 定谳）：MC 1.21.1 + NeoForge 21.1.248 + Java 21。

## 系统全景与容器化进度

| # | 组件 | 现状 | 容器化 |
|---|---|---|---|
| 1 | mc — MC 主服 + 26 件 mod（numen/numen_act/settlements 原版/Macaw 全家桶/SVC 语音/性能件…；Cobblemon/Iron's/waystones 因踢原版客户端移入 mods-disabled） | **冒烟通过（2026-08-25）** | ✅ 运行中：容器 `mc-isekai`，宿主 25699 |
| 2 | world-process — 女神化身/世界进程（bootstrap-world.mts + web-panel.mjs） | 宿主 node 进程 | TODO Dockerfile.world（旧镜像 mc-world:latest 可参考） |
| 3 | oracle — 村民神谕推理（:9001） | 宿主 python | TODO Dockerfile.oracle |
| 4 | npc — 村民之魂（mc_npc.py） | 宿主 python | TODO Dockerfile.npc |
| 5 | skin-proxy — 离线皮肤代理 | 宿主 node | TODO Dockerfile.skinproxy |
| 6 | guard — 守卫桥（guard_drive.py） | 宿主 python | TODO Dockerfile.guard |
| 7 | qwenpaw — 多智能体 OS（天神/女神/守卫；mcp_numen 随其子进程走） | 宿主服务 | TODO Dockerfile.qwenpaw |
| 8 | auth — 用户注册/登录服务端 | **代码尚不存在** | 待造物主定性后再建 |
| 数据面 | memos-api:8002 / memos-mcp:8003 / qdrant:6333 / neo4j / redis | **已在 Docker**（C:\Users\lzl19\memos-deploy） | compose 经 external 网络 memos_memos 接入 |
| 推理面 | vllm-qwen38-ara:8890（GPU） | **已在 Docker** | 本机保留；上云方案待定（GPU 实例或外部 API） |

启用方式：一期 `docker compose --env-file isekai.env up -d`（只起 mc）；全栈 `docker compose --profile full up -d`。

> **2026-08-25 造物主谕（新服决策）**：Docker 里做的是**全新服务器、全新生界**，
> 老裸机服（25599/25575，PID 见 netstat）原封不动，两服共存。
> 因此本目录不再承担存档迁移；`./data` 即新世界。
> 冒烟当日实况：NeoForge 21.1.248 安装约 3 分钟一次通过；首次启动因 `irons_lib`
> 漏下载崩在依赖闸（已补 2.1.0），补齐后 35 件全部加载，`Done (6.8s)`，healthy。

## 一期版本基准与 mod 清单

| 组件 | 版本 |
|---|---|
| Minecraft | 1.21.1 |
| NeoForge | 21.1.248（21.1 系最新，镜像首次启动自动安装） |
| Java | 21（itzg java21 镜像） |
| Cobblemon | 1.7.3（+ Kotlin for Forge 5.12.0） |
| Iron's Spells 'n Spellbooks | 1.21.1-3.16.3（+ GeckoLib 4.9.2 / Curios 9.5.1 / playerAnimator 2.0.4） |
| Macaw 全家桶 | windows/doors/roofs/bridges/fences/furniture/stairs/paths/lights/trapdoors/paintings |
| Settlements | 1.0.0-beta.1 原版（气泡修复搁置：godfix 源码版已构建但暂不用，settlementsfix.jar mixin 不进包；`scripted_chatter=false` 铁律） |
| Simple Voice Chat | neoforge 2.6.22（客户端整合包同版本硬对齐；UDP 24454 已在 compose 放行） |
| Waystones | 21.1.41 + Balm 21.0.65（路碑传送，纯加成低风险，清单建议先上） |
| 自研 | numen / numen_act（假玩家与 numen_act RCON 指令，世界根基，勿动） |

## 快速开始（任何装有 Docker 的机器）

```bash
cd ops/docker
python fetch_mods.py                        # 按 modpack.json 备齐 ./mods（21 下载 + 本地拷贝件）
docker compose --env-file isekai.env up -d  # 首次会下载 NeoForge 21.1.248 + 原版服务端 + 生成世界
docker compose logs -f mc                   # 看到 "Done ... For help" 即就绪
```

- **本机实况（2026-08-25 冒烟）**：新服宿主端口 **MC 25699 / RCON 25580 / 语音 UDP 24454**
  （老裸机服占 25599/25575，两服共存；`isekai.env` 即这套参数）。
- 治理闸会拦 `.env` 文件名（疑含密文），故环境参数放 `isekai.env`，
  RCON 密码不落盘、回落 compose 内建默认。
- 世界与全部运行数据在 `./data`（备份=备它）。内存 4G（`MC_MEMORY`，宿主空闲仅 ~7GB）。

## 上云清单

1. 云主机：2C4G 起（4C8G 佳），开 25599/25575。
2. 拷 `ops/docker/` 全目录（含已备好的 `mods/`）。
3. `docker compose up -d` —— 镜像 itzg/minecraft-server 会自动装 NeoForge、同步 /mods。
4. 带存档迁移：把现役 `mc-server/world` 打包放入 `./data/world` 再启动。
5. 备份：`data/` 目录定期快照；`docker compose down` 停服不丢数据。

## 已知事项 / 风险

- **【铁律·实测 2026-08-25】NeoForge 21.1.248 对原版协议客户端的接纳边界**：
  mineflayer（女神/探针走原版协议）能否接入，取决于包里有没有**注册必需网络通道**的模组。
  逐批二分实测结果：
  - ✅ 可接入：老式 14 件（settlements/numen/numen_act/性能件/Clumps/incontrol/Chunky/
    grieflogger/architectury/supermartijnconfiglib）＋ **Macaw 全家桶 ×11（纯方块家具无辜）**
    ＋ **Simple Voice Chat（无辜）**。当前新服即此 26 件组合。
  - ❌ 踢原版客户端（握手 `vanilla.client.not_supported`）：**Cobblemon**（单测坐实）、
    **Iron's Spells 套装**（irons_spellbooks+irons_lib+curios+playeranimator 硬绑一体）、
    **balm/waystones**（二者其一或皆是，未再细分）。
  - 结论：要女神/mineflayer/原版玩家进新服，就不能挂 Cobblemon/Iron's/waystones 这类
    内容模组；要内容模组，AI 只能以 numen 假玩家（服务端实体，不走客户端协议）存在。
  - 探针：`node ops/docker/probe-mineflayer.cjs [port]`（LOGIN/SPAWN OK 即通过）。

- **NeoForge 21.1.248 已实证**（2026-08-25 冒烟）：numen / numen_act / settlements /
  Cobblemon / Iron's Spells 全部正常加载，无需回退 21.1.73。
- **老裸机主服冻结**（2026-08-25 造物主谕：老的不动）：仍是 NeoForge 21.1.73，
  升不升 21.1.248 以后再说。
- **irons_lib 教训**：清单里有它，但 2026-08-24 批量下载时静默失败（CDN 抖动），
  首次启动崩在依赖闸才暴露。教训：下载后必须逐件核对清单与磁盘（现已 35=35 对齐）；
  fetch_mods.py 失败不应静默放过。
- **冒烟遗留小问题**（非阻塞）：① `incontrol: Error writing areas.json!`——
  首启写配置失败，需复查 config/incontrol；② settlements Inference Service: OFF（预期，未接线）；
  ③ modernfix/lithium 一处 mixin 覆写冲突（自动跳过，无害）；④ 离线模式语音加密警告（预期）。
- settlements 气泡修复整体搁置（造物主裁定 2026-08-24）：先跑原版 1.0.0-beta.1。
  godfix 源码版已构建成功存于 D:\workspace\settlements-fork（godfix 分支，产物
  build/libs/settlements-1.0.0-beta.1+godfix.1.jar），要启用时直接替换 jar 即可。
  注意：原版气泡对无 settlements 的客户端可能有兼容问题（当初 settlementsfix 就是为此），
  冒烟时留意；若客户端崩再议是否召回 settlementsfix。
- 二期（未做）：sidecar/oracle/guard/web-panel 的容器化、云端 LLM 端点接线、
  女神/守卫服务与主服同仓编排。
- **玩法扩展候选区**（造物主上传《千灯纪·模组清单》2026-08-25，③组）：8 主 mod + 7 前置
  已全部下载至 `mods-candidates/`（15 件，校验通过，清单见 `mods-candidates.json`）。
  该目录**不挂载**（compose 只 COPY_MODS ./mods），逐个拍板 + 测试服验证后才移入。
  已下：Better Combat 2.4.0 / Pufferfish's Skills 0.18.3 / Epic Fight 21.17.3.1 /
  Tensura 2.0.1.1 / Cataclysm 3.33 / Mowzie's Mobs 1.8.2 / Aquamirae 7.2.2 / MoeMusic 1.4.2。
  下不了：日式建筑 Everything Japanese——1.21.1 只有 37KB 占位 stub，真身迁去 1.21.10+ 了。
  铁律：玩法介入型（尤其世界生成/改生态）**先测试服验证再进正式服**，存档是 Settlements 活世界。
  注意：Epic Fight 与 Better Combat 同改战斗层，通常二选一；Iron's Spells 已在正式包内（3.16.3）。
