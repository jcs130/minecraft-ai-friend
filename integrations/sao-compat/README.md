# SAO 0.76.1-lite：Numen / Mineflayer 隔离接入

任务、职业与技能采用按需查询接口 `mc_sao`；不预装整本任务书进上下文。原生提交/领奖、职业及技能接入方法与边界见 [GAMEPLAY.md](GAMEPLAY.md)。

后续已启用桐人 `ag_Kirito`：自研 autonomy 0.2.129 + core rc.130，经 Mineflayer/Forge 原生桥接，由线上 qwen3.7-plus 驱动。已实际采集 4 个橡木原木，并通过原生任务领取、装备初心者之剑。调用优化与实际结果见 [OPTIMIZATION.md](OPTIMIZATION.md)。运行、停止、记忆及已知缺口见 [KIRITO.md](KIRITO.md)；建筑保护和真实村庄验收见 [PROTECTION.md](PROTECTION.md)。隔离性质与原端口保持。

2026-10-29 的实验候选。现役 Paper 与 Tau 1.21.1 的目录、进程、网关、防火墙、端口转发和自动启动保持原状。本目录不包含世界、模型密钥或第三方模组二进制。

## 环境与隔离

| 项目 | 实际值 |
| --- | --- |
| 作者整合包 | SAO-0.76.1-lite.zip，内部 versionId 为 1.0.1 |
| 包 SHA-256 | 707f8a9db948a9ad5855b28246ec46738a9a7fe953ed30d0531e4291967360bd |
| 游戏 / 加载器 | Minecraft 1.20.1 / Forge 47.4.10 |
| Java | 独立 Temurin 17.0.20.1+1，4 GiB 上限、4 个活动处理器 |
| Numen | [官方 v0.1.4.1-1.20.1-beta](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.20.1-beta)，2026-10-29 核对的对应版本最新发布 |
| 测试根目录 | E:/MC/research/sao-0.76.1-agent-20261029 |
| 游戏 | 127.0.0.1:39676 / TCP |
| Numen 外部控制 | http://127.0.0.1:39689/mcp，Owner Bearer Token |

作者包有 202 个顶层模组 JAR、30 个 FTB 章节、934 个任务；包内没有世界存档。导出服务端时按发布者信息排除 29 个客户端模组，再按真实专用服务器异常及精确哈希排除 LootBeams 和 Oculus/Mekalus。保留 171 个作者包 JAR，另加 Numen 与自有组件，共 173 个顶层 JAR。原客户端文件保存原样。

两条入口控制不同身体：

| 接入 | 身体与状态 | 模型及记忆 |
| --- | --- | --- |
| Numen MCP | 游戏 JVM 中的原生假玩家，持久 UUID、背包、位置、动作账本；Owner Token 与控制租约 | 外部 Agent 管理；本轮没有启动托管模型循环 |
| Mineflayer + SDK | 真实登录玩家；FML3 协商、当前 JVM 注册表、本人原生菜单及 ItemStack | 桐人使用自研 autonomy/core；模型与记忆由宿主管理 |

Numen 身体不依赖主人常开 Minecraft 客户端。Numen 网络适配仅对 `numen_api:main` 增加缺席客户端支持，已安装客户端仍校验原协议版本；缺席客户端不接收 Numen GUI 消息。其他模组的网络检查、游戏权限和碰撞规则保持。本轮包含缺席 Numen 的协议联机验证，尚未做真人客户端全部界面验收。

这是回环实验服，没有开放到局域网或公网，也没有接入现役 Watchdog。`lab_control.py` 保持本次 JVM 的 stdin；终端结束会正常 `stop`。服务端驻留身体与 Windows 开机自启是两件事。

## Mineflayer 使用

在此目录 `npm ci --ignore-scripts`，使用 Node 22。依赖已锁定，Forge 协议源码锁定到 PrismarineJS 提交 `3d86a35a`。

```js
const { createSAOBot } = require('./sao_bot.cjs')
const bot = createSAOBot({
  root: 'E:/MC/research/sao-0.76.1-agent-20261029',
  username: 'YourAgent'
})
await bot.nativeReady
const capabilities = await bot.native.operations()
const state = await bot.native.snapshot()
// state.self、state.menu 均来自该账号的原生游戏连接。
```

适配在内部插件注入前安装当前 JVM 的真实方块、物品、实体 ID；261,125 个方块状态的属性组合逐项校验。启动 PID、版本、注册表计数及服务端 epoch 不匹配会拒绝启用身体。注册表是静态类型定义，不是远处世界观测；未知/未加载方块仍不能当作空气。玻璃的透光属性与碰撞形状分别保留。

`bot.native.operations()` 返回本服实际提供的 7 项能力：`native.capabilities`、`body.snapshot`、`inventory.inspect`、`menu.current`、`menu.click`、`menu.close`、`control.actionStatus`。复用 [原生客户端契约](../tau-ceti/native-bridge/operations.json)，不按玩家名筛选。

物品带真实命名空间、显示名组件、完整 SNBT/完整性标记及指纹。模组菜单提供实际 windowId/stateId、槽位坐标、库存归属、光标物品和原生进度数字。未知模组窗口走原生接口，不猜成普通箱子。点击采用已观察槽位、完整组件和 epoch 的比较校验；结果未知时查询原 requestId，不自动重放。

此候选的注册表缓存来自同机文件；尚未封装远程下载/授权分发。不要把本工厂写成普通原版 Mineflayer 公网入口。每个 Forge worker 使用独立 Node 进程：上游 NMP 的 customPackets 编译缓存按版本共享，本适配的配方包覆盖不能与同进程普通客户端混用。

Forge 配方包含模组专用序列化器。客户端保留 `nativeRecipeStream` 原始字节及观测时间，避免原版解析器阻塞后续区块和心跳。服务端配方目录尚未回移，故不广告 `native.recipes`；原版静态 `recipesFor/recipesAll/craft` 快捷调用明确拒绝，不能据此猜配方。已知配方可通过实际原生工作台/机器菜单操作；自动发现及自动合成仍待补齐。

## Numen 外部控制

使用 `setup_resident_lab.py --root <测试根目录>` 创建全新的本机测试账户。Token 及控制租约保存在 `.private.json`，不进 Git、不进聊天；当前实例已限制这些文件的 Windows ACL。不要复制现役账户、模型配置或玩家记忆。

向 `/mcp` POST 标准 JSON-RPC `tools/list` 或 `tools/call`，用 `Authorization: Bearer <本人 Token>`。先调用 `operations` 获取当前组，再用 `group` 查询精确函数和返回类型。当前登记 23 组、80 个函数；其中 `side=client` / `availableWithoutClient=false` 的函数不能冒称纯服务端可用。

基本顺序：`create_companion`（持久唯一 action_id）→ `claim_control` → `get_state` → `lua` → `action_status`。耗时程序异步返回 `accepted`，必须读取 `terminal` 并核对实际世界变化。停止返回 `cancel_requested_query_terminal` 后继续对账。`unknown` 不等于失败或未执行。

每个身体同一时刻只有一个控制器。`bypass` 是跳过 Numen 主人逐次确认，仍是正常生存玩家，不授予 OP。恢复沿用原 UUID 和 playerdata，不新建替身或重放旧脚本。Forge 版将恢复排到全部 ServerStarted 监听器结束后的首个 tick，避免在 FTB 队伍/任务尚未初始化时加入身体。

`resident_cli.py` 是本机验收工具，会读取私有凭据、脱敏保存回执。`mawsao audit_restore <UUID>` 仅控制台可用，且只允许有实验标记、已知恢复错误、离线并且全部动作已终结的身体；先持久化审核记录，再恢复原身份。它不能解除未知动作的门禁。

## 构建与维护

所有输出放入独立实验目录，不向旧服复制任何内容：

1. `prepare_pack.py --pack <包.zip> --output <新目录>`：校验并下载作者索引，支持使用 `--cache-zip` 作逐文件校验缓存。
2. `prepare_runtime.py --output <新目录>`：获取独立 Java、Forge 安装器及 Numen full `-all.jar`，写来源和哈希。普通 Maven 瘦 JAR 不作为独立运行包。可选 `--server-cache` 复用同一安装器。
3. `export_server.py --root <新目录>`：按发布者客户端标记导出；已有服务端配置拒绝覆盖。安装 Forge 47.4.10 后仅在停服状态应用已审核的兼容修复。
4. `generate_resident_addon.py --root <目录>`：从本仓冻结的自有 resident-reference 与现役原生契约生成 Forge/Java17 构建。参考来源为本项目提交 `78ec7abb`，不会读取源仓配置或私钥。
5. 用独立 Java17、Gradle8.7 执行生成目录的 `build`。ForgeGradle 锁定 6.0.54，限制 `--no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx2G`。遇 Java TLS 下载问题可运行 `seed_build_cache.py`，缓存仍核验发布者 SHA-1。
6. 正常退出实验 JVM 后再换组件。已应用 Numen FTB 修复的 JAR 需要本组件的 `FtbServerTitles`，应成对保留或成对恢复原版，不能只删组件。

兼容修复均保留客户端原件、来源、单项哈希与改动条目：

- `patch_server.py`：Vzling 公共 Mixin 中仅在客户端执行的动画初始化，避免预解析客户端类型导致开服失败，公共动画接口保留。
- `patch_teams.py`：作者添加的 `saoConnectedPlayerId` 客户端辅助方法不能在专服校验公共团队类时链接 LocalPlayer；仅替换专服副本的该方法。
- `patch_numen_quests.py`：Numen 的两个 FTB 服务端类共 6 处调用，改读专服存在的 `getRawTitle`。FTB 的本地化 `getTitle` 标为 CLIENT，专服会移除，原调用会崩服。
- `patch_remnant_script.py`：把 UUID/NBT 访问改成实际 KubeJS 接口。旧残片升级保持数量、自定义标签、附魔和 Lore，仅按原迁移逻辑移除旧名称。支持显式准备脚本热重载；JAR 修复仍须停服。
- `review_client_renderers.py`：只排除已审核精确哈希的 LootBeams 与 Oculus/Mekalus。其他未知模组保留，不能为过启动而任意删玩法。

验证与限制见 [VALIDATION.md](VALIDATION.md)。新增模组或升级后重新导出本次 JVM 注册表并实测，不能复用旧数值 ID，也不能把本次通过等同于全模组已适配。
