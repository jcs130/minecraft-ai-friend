# Youer 上游核对与兼容缺陷复现

2026-11-03 核对完成，**正式内核未升级**。官网常规构建列表最新仍是本服使用的 build 920；GitHub 1.21.1 分支有更新的成功测试构建。两项当前故障在该测试包的纯净环境中仍存在，已完成 Paper 对照和上游 issue 草稿。连接器对上游仓库写入返回 403，电脑控制又无法可靠识别 Windows 浏览器当前网址，因此**尚未创建上游 issue**。

## 构建通道与实际版本

| 来源 | 实际内容 |
|---|---|
| [官网构建 API](https://api.mohistmc.com/project/youer/1.21.1/builds) | build 920，2026-09-28；提交 `e315863237815205021e0255f3057cca22eb28a0`，NeoForge 21.1.252 |
| [上游 1.21.1 分支](https://github.com/MohistMC/Youer/tree/1.21.1) | 2026-10-29 的 `23f932ae111931962e2164ef1041b01d539900f9`，比常规构建多 37 次提交 |
| [官方 CI #844](https://github.com/MohistMC/Youer/actions/runs/40834104418) | 成功，NeoForge 21.1.265；产物 ID `12879893723`，名称 `Youer-1.21.1-server` |
| 正式服 | build 920 的启动包及本服已验证的实体保存兼容补丁；AgentFriend 仍 `.49`，`.50` 传送修复另待维护加载 |

常规启动包 SHA256 为 `ccb6e44668919d6a5a69aeffbe3fefb71f7c9c6127cc01ea1febc3f20f32fca1`，与正式文件相同。当前修补的 NeoForge 21.1.252 server 库摘要仍为 `4541fcdb7e6b7eb37a4a353bc8c4523d8ccfad7fb6ee682dbcfb4b4ad9ff32e4`；启动包相同不等于内部库未经修补。

测试 ZIP 的 SHA256 `13cea1a31dc749888f15c385e3176de5024a171efceebadb8ffeac684bfbf661` 与 GitHub 产物摘要一致；其中 `youer-1.21.1-23f932ae-server.jar` 的 SHA256 为 `6083800040829dd1e3a12f74707e47d4227dfc2831935303f7926dfd4b0a61ba`。实际启动日志确认 NeoForge 21.1.265，而非复用了旧内核。

37 次提交包含 NeoForge 更新、难度缩放与区块卸载时 tick 容器归属修复等内容。这里只跟进同一 Minecraft 1.21.1 分支；26+ 是另一条迁移路线，不能直接覆盖现有客户端与存档。

## 纯净实机对照

两个全新隔离世界均只安装 [最小复现探针](../integrations/youer-upstream-probe/README.md)，无用户内容模组或玩法插件。使用 Java 21.0.12.1；Youer 为上述官方测试包，Paper 为 1.21.1 build 133 / `3cb8529`。每种内核各正常启动、停机两次；四个测试端口均已关闭。

| 行为 | Youer 23f932ae | Paper 对照 |
|---|---|---|
| 异步读取已加载区块 | 返回区块 | 返回区块 |
| 对未生成区块请求 `generate=true` | 返回空，仍未生成 | 返回并生成区块 |
| 正常重启后，读取已存盘但未加载的区块 | 37 ms 正常完成为空，区块仍未加载 | 42 ms 返回区块并加载 |
| `setPersistent(true)` 村民跨重启 | 原 UUID 保持 | 原 UUID 保持 |
| `setPersistent(false)` 村民跨重启 | 原 UUID 恢复，标志仍为 false | 不恢复 |

冷区块测试在正常停机后检查 region 位置非零，重启后再次验证 `isChunkGenerated=true`、`isChunkLoaded=false`。不能把同 tick 的保存/卸载当作已落盘证据。探针不会在启动时生成替代村民，排除了测试插件重建造成的重复。

这分别对应本服远征/地点传送准备失败和临时商人跨重启重复的内核原因。最新源码的 [CraftWorld 异步入口](https://github.com/MohistMC/Youer/blob/23f932ae111931962e2164ef1041b01d539900f9/src/main/java/org/bukkit/craftbukkit/CraftWorld.java#L2405) 仍只查询已加载对象；[Entity 补丁](https://github.com/MohistMC/Youer/blob/23f932ae111931962e2164ef1041b01d539900f9/patches/net/minecraft/world/entity/Entity.java.patch) 虽保存 Bukkit 标志，正常实体保存仍未阻止非持久化对象落盘。

这是 API 行为与正常重启的对照，未代替本服 55 插件、女仆、YSM、登录代理、Geyser、原版客户端和 Mineflayer 的完整组合验收，也不是性能基准。不能据纯净启动成功就发布新内核。

## 上游报告及后续维护

已检索现有 issue 的 `getChunkAtAsync`、`setPersistent`、`Bukkit.persist`、Shopkeepers 和重复村民相关关键词，未找到相同报告。两份去除私人信息的完整草稿：

- [异步区块读取与生成失效](youer-upstream-issues/async-chunks.md)
- [非持久化实体跨重启恢复](youer-upstream-issues/nonpersistent-entities.md)

第一条创建请求被 GitHub 集成以 `403 Resource not accessible by integration` 拒绝，未创建编号；第二条没有重复发送同一无权请求。服主已恢复浏览器控制并登录 GitHub，但工具未能可靠识别 Windows 浏览器当前网址而停止；后续需从可稳定识别网址的浏览器入口按原授权代发。草稿只含公开构建信息、合成实体和复现代码，不包含正式日志、世界、真实角色身份、凭据或私有下载签名。

后续内核维护先同时核对官网构建列表和 GitHub 成功 CI，固定提交、产物与摘要，再对照这两个探针；保留仍需要的本地兼容修复，并完成实际插件/模组/跨端组合及最新冷备验证后正常停启。禁止把 build 920 专用字节码补丁直接套给未知 JAR，也不能用新内核单独替代 [.50 的安全传送修复](TRAVEL_CLI_20261103.md)。

本轮失败夹具原件另留：RCON 参数位置、RCON 发送者类型及首次冷区块尚未落盘的测试设计问题均已纠正，不计为上游缺陷。有效结论以四次最后正常启停和 [公开清单](../manifests/youer-upstream-audit-20261103.json) 为准。私有 E/F 记录保留完整测试证据；未消费旧部署入口。
