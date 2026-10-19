# FOM · Smart NPC（2026-10-20）

目标服为现有 `E:/MC/servers/fom-2.42`，独立于 Paper 千灯纪。采用 [Smart NPC 2.0.1 官方发布](https://www.curseforge.com/minecraft/mc-mods/smart-npc/files/9125288)，Minecraft 1.21.1 / Java 21。JAR 要求 NeoForge `[21.1.250,21.2)`，因此从 21.1.248 升到 **21.1.250**，不另行升级 Create、Aeronautics、Sable 或现有生活/RPG 模组。

源码项目是 [PlaIsMe/SmartNpc](https://github.com/PlaIsMe/SmartNpc)。用户提供的 AnnoyingVillagers 是另一项目；未把它混装进来。此模组使用游戏内置 AI 目标，不需要新建大模型账号或 Key。

## 内容与配置

| 项目 | 设置 |
| --- | --- |
| 服务端 | 原 102 个 JAR 原字节保留，新增 Smart NPC，共 103 个 |
| 中文角色 | 营地工匠、林间矿工、河畔渔夫、田园农夫、巡林剑士、远行旅人 |
| 兴趣 | 建造、采矿、种田、钓鱼、探索、讨伐怪物、结伴；不配置猎杀玩家/村民、恶作剧击打、掠夺箱子兴趣 |
| 自然生成 | 上限 4；权重 2，每批 1 个 |
| 日常 AI | 同时 2 个工作者；40 ms 调度目标 |
| 区块 | `forceTickManage=0`，不强制加载远处 NPC |
| 聊天 | 中文生活对白，带 `[NPC]` 前缀；接受组队仍回复原模组要求的 `ok` 或 `okay` |

配置源在 [world/fom-smart-npc](../world/fom-smart-npc)。运行位置：

- `server/config/smart_npc-server.toml`、`smart_npc-names.toml`。它们是 COMMON 配置，文件名含 server 也不应放到 world/serverconfig。
- 中文对白数据包：`server/world/datapacks/fom-smart-npc`。
- NeoForge 首次载入会补配置注释；验收比较有效 TOML 值，不把注释变化当作配置丢失。
- 合作型兴趣不等于不改地形：原生采矿、砍树和建设仍会改动世界。没有把 Paper 的领地或公会系统迁过来，也没有宣称 NPC 遵守所有其他模组的私有保护逻辑。

## 三端边界

| 入口 | 地址 | 本轮范围 |
| --- | --- | --- |
| 完整 Java | `micro.kangqiang.site:28976` | 新客户端包，真实 NPC 模型、中文角色名与原生行为 |
| 完整 Java Agent 身体 | 同上 | 原客户端桥 0.5.0 / SDK v9 可选组件保持；未恢复旧自动控制器 |
| 普通 Mineflayer | LAN `192.168.3.163:28977` | 1.21.1、离线、`ag_` 名字；真实号表翻译、认证、区块与普通容器存取 |
| 国际基岩 | `micro.kangqiang.site`，UDP `28988` | 同一世界、新物品图标包与原物品身份/数量；保留 Xbox 验证 |

**基岩和基础 Mineflayer 的连通不等于 Smart NPC 的完整外观与专用检查界面已转换。** 不支持的自定义实体保持原桥接的明确边界；通过 `/fom nearby` 获取真实实体类型，未伪装成村民。要与原生 NPC 完整交互，使用完整 Java 客户端或其 Agent 身体。

两个桥接发布物都从新增模组后的原生 `maw_registry dumpids` 导出重新构建，不能沿用旧数字 ID。实测导出包含 `smart_npc:player_npc` 与钓鱼浮标、协议 7 的专用频道。基岩新包为 1080 个原生静态图标，具名物品目录 4575 项；没有新开公网管理端口。

## 客户端

见 [简明更新指引](FOM-SMART-NPC-QUICKSTART.txt)。完整分发位于 E/F 两盘 `MC/发布/FOM-2.42-SmartNPC-20261020`：

- 玩家版 128 个启用 JAR；Agent 版 131 个；各保留作者禁用的 10 个。
- 增量 ZIP 含 Smart NPC 原版 JAR、官方 NeoForge 21.1.250 安装器、GPL 文本与源码资料。
- 构建使用固定的原作者 FOM 2.42 归档及锁定文件，未导出玩过的客户端配置、账号、控制凭据或存档。
- 新旧 loader 分开记录：`upstreamDependencies=21.1.248`，衍生包实际 `dependencies=21.1.250`。
- Smart NPC 以明确的 GPL 原版覆盖文件入包，保留官方来源和公开源码快照。没有放宽 mrpack 的标准下载域名名单；未声称源码快照可复现作者二进制。
- 启动器 UI 导入未另行自动化；按格式实际安装到全新目录并校验全部 JAR、真实运行 Agent 客户端，以及重复构建逐字节校验已完成。

锁定来源：[客户端包](fom-pack-20261020.lock.json)、[内容](fom-content-20261020.lock.json)。原 20261016 发布和历史锁保留。默认构建与本轮改动前的构建器逐字节一致；历史发布与当前源码指引另有既存的基岩入口说明差异，不把当前指引冒充历史原字节。

## 验证与运行

本轮隔离验证：55 项 Python 测试（打包 21、FOM 守护 18、基岩守护 7、NPC 策略 6、客户端 loader 3），完整 Java 11 项，Mineflayer 存取 8 项、重连 5 项、冷启后 5 项，真实基岩 UDP/材质/物品存取 13 项。

原生验收包括：六个模组物品目录、实际 NPC/中文角色名、AI 活动、中文邀请和原始 framebuffer。NPC 身份与配置名在正常冷启动后保持；新增 NPC 蛋和农夫乐事物品经存入→关闭→重开→取回→重连→冷启后数量与空光标一致。基岩测试用隔离回环桥，**不冒称手机/Xbox 正向账号或 NPC 原生外观已验**。

4 个自然 NPC、2 个 AI 工作者的隔离样本：20 TPS，平均约 5.0 ms/刻、P95 9.4 ms、P99 20.0 ms，100 刻窗口。此为短样本，不是 16 Agent 长时间负载结论。

正式服已启动，主服 12 项、基岩桥 8 项健康通过，普通 Mineflayer 6 项只读检查通过。最终 Agent 整合包以全新 Java 实例进入正式服并保持在线 90 秒、正常退出；没有获取控制租约或执行物品/移动操作。自然 NPC 受白天、生成位置和已有区块条件影响，未向正式世界强行召唤测试 NPC。

原有启动 ERROR 归一化后为 311 类；新增 1 类为作者包内大写 `chat/HOW_TO_USE.txt` 被资源路径校验忽略，18 个实际对白 JSON 正常加载。未为消除此说明文件告警修改作者 JAR。

早期 QA 的抢先连接失败、未获取控制租约与命令生成姓名的过早断言均保留在私有研究记录；未作为成功计数。最终客户端与候选的所有游戏/网关/桥接子进程正常退出，未重放未知游戏动作。

继续使用现有 owned-child 守护与 HKCU 登录启动入口。`fom_service.py` 验证模组 SHA、混合登录、物理同步和新增 NPC 策略；`fom_health.py` 增加 3 项 NPC 检查；基岩健康检查核对实际 UDP、原生图标与当前世界。运行脚本冻结在 FOM 自身 ops 下，不依赖 Codex 缓存，不把源码修改当成自动部署。

```powershell
E:/MC/runtime/python-3.12.14/python.exe E:/MC/servers/fom-2.42/ops/service-tools/fom_health.py --config E:/MC/servers/fom-2.42/ops/service.json
E:/MC/runtime/python-3.12.14/python.exe E:/MC/servers/fom-2.42/ops/bedrock-service-tools/fom_bedrock_health.py --config E:/MC/servers/fom-2.42/ops/fom-bedrock.json
```

## 备份与回退

E/F：`MC/backups/fom-smart-npc-20261020-before`，完整冷备 35109 文件、4804994410 字节；ZIP SHA256 `b614e3ab4c6c978f3099f303679f9ebef9a457968c039833d7452ab57e42583d`。每个成员的 CRC/SHA 与双盘归档一致性均验证，包含世界、玩家、认证库、模组、libraries、配置和 ops。

需要回退时先正常停止 FOM 基岩桥和 FOM 主服务，核实所有自有子进程退出及端口释放。将当前整个 `E:/MC/servers/fom-2.42` 保存在新的留存目录，再从上述完整归档恢复到原路径；不要直接删除新增 JAR 后继续加载带自定义实体的世界。该完整恢复会回到备份时的世界进度，所以应先保全更新后的数据，并由维护者选择恢复时间点。随后用原控制脚本启动原发布和旧 21.1.248 客户端。Paper 不在此回退范围。

仅源码、配置、锁与脱敏验收进入 `experiment/agent-society-1.21.1`。JAR、原帧、第三方素材、世界、凭据、运行日志与备份不提交 Git。最终上线状态见 [验收记录](evidence/fom-smart-npc-20261020.json)。
