# 固定 NPC 重复与多参数命令纠错

## 状态与范围

2026-11-03 01:58 已完成正常维护：AF `0.4.47.49-rpg`、NPCSpeak 原 `1.0` 的局部修复及 Youer 原 NeoForge 库修复已实际加载。22 项正式检查通过，673 份角色相关文件在冷安装阶段一致，75 条原认证记录及女神原七任务保持。后台已使用独立启动入口，见 [后台生命周期](INDEPENDENT_SERVER_LIFETIME_20261103.md)及[部署清单](../manifests/npc-cli-lifecycle-deployed-20261103.json)。本批不增加玩家命令，不迁移职业、物品、密码或模型。

## 重复 NPC 的原因

现役 Youer 的地形区块就绪早于持久实体读取。此时 `CraftChunk.getEntities()` 返回空，旧的固定 NPC 恢复代码误认为原 NPC 不存在，于是另造一个；原实体稍后到达，两个同时留下。隔离服中原逻辑连续冷启动计数从 1 增至 5；等待实体真正就绪的对照始终是同一 UUID。

AF 的公会接待员、生活建筑主持人、故事 NPC 和试炼商人先等待 `isEntitiesLoaded()`，按角色合并等待并共享本插件的临时区块票。完成、取消、超时和停用均释放自己持有的票；200 tick 仍未完成时保留原身份并记录原因，不凭空生成替代者。不在主线程等待磁盘 Future。

NPCSpeak 沿用原角色配置、台词和身份文件，等待后按原 UUID 恢复；只有原身份确实不存在时才生成，并保存新 UUID。异步生成后，交互查询读取管理器当前对象，避免旧 UUID 索引失效。固定服务 NPC 静音，普通村民和女仆不受这个设置影响。

另一条独立缺陷是现役 Youer 保存实体时忽略 Bukkit `persist=false`，Shopkeepers 的临时商人因此被写入存档，重启后又创建正式商人。构建期只在 `Entity.shouldBeSaved()` 和 `saveAsPassenger()` 增加原标志检查；不更改普通实体序列化、NBT 导出或玩家存档。原内核摘要锁定，其他版本拒绝套用。

源码依据：[锁定的 Youer CraftChunk](https://github.com/MohistMC/Youer/blob/23f932ae111931962e2164ef1041b01d539900f9/src/main/java/org/bukkit/craftbukkit/CraftChunk.java)。对实际发行 JAR 另做了字节码核对，不能只根据上游主分支推断现役行为。

历史冗余实体清理单独保留完整类型化 NBT、精确 UUID 与角色关系前像。不能按“站着不动”或同名批量删除，也不能把 NPCSpeak/Shopkeepers 当前登记的实体当作残留。早期清理曾误删两个 NPCSpeak 身体，已从完整前像按原 UUID 恢复；该失败与纠正记录保留。随后异常重启又产生十组重复，是本批根因修复所针对的行为。

02:13 收尾只清除四个已确认的旧残留（三个商店身体、一个建筑主持人）。Shopkeepers 的当前身体由其运行时注册表核实，NPCSpeak 原绑定保留；已加载主世界村民从 52 变为 48，其他原 UUID 全部仍在，没有删除玩家或女仆，也没有触发死亡掉落。13 个既有好感字段按前像最大值恢复，未累加奖励。前后完整 NBT、执行清单和回执在 E/F 保留，禁止重放这次清理。

## Agent 的错误命令立即给下一步

实测可米把副本命令交给施法入口，例如：

| 错误输入 | 返回的下一步 |
|---|---|
| `/mycli cast dungeon info undead_crypt` | `/mycli dungeon info undead_crypt` |
| `/mycli cast dungeon claim undead_crypt` | `/mycli dungeon claim undead_crypt` |
| `/mycli cast dungeon_claim undead_crypt` | `/mycli dungeon claim undead_crypt` |

旧桥只有单参数未知技能进入纠正，因此多参数走不到现有语义建议。现在先按当前命令目录识别错误命名空间，返回 `COMMAND_ROUTE_MISMATCH`；普通输入给短文本，明确 `--json` 时给 `MC_CLI_ERROR`。真实技能 ID 冲突时仍优先交给原技能验证器；副本目标必须存在于加载配置，缺失或未知目标只指向对应帮助，不编造可执行目标。

本次拒绝不执行动作、不扣魔力，不发公屏；玩家或 Agent 核对建议后自行重新调用。无需新增嵌入服务，生产神经向量检索仍关闭，本地即时纠正不等待网络。完整宿主约定见 [MCP 错误回执](MCP_CLI_RECOVERY_20261101.md)。远端宿主是否把失败回执当作完成信号仍需端到端验证，不能把服务器纠正上线说成所有客户端超时都已修好。

## 验证与恢复

- Youer 五次隔离冷启动：原错误对照持续增长，等待实体方案 UUID 稳定；非持久实体在原内核被恢复、修复后不再恢复；NPCSpeak 两个原绑定跨重启保持。
- 八项真实区块边界检查涵盖重复请求、共享票取消、已有票保留、一次回调、超时不生成及停用释放。
- 两个普通 Mineflayer 客户端共 41 项联机检查：即时纠正、当前目标、未知目标、私有响应，以及拒绝前后位置、背包和魔力不变。
- 五组规则回归通过。首次区块夹具未保持加载而计数无效、首次编译夹具错误的回执保留，不计为通过。

AF 使用 `paper/ops/build-npc-cli-lifecycle.py` 在已部署 `.48` 上窄构建；仅九个类族和版本字段。主干另有尚未部署的公会公共设施分支，构建明确保留原仓储提示，不夹带该功能。NPCSpeak/内核构建见 [构建目录](../integrations/npcspeak-lifecycle/README.md)。

发布已沿原真人/副本门禁、180/60/10 秒通知和 E/F 游戏及认证冷备份正常完成；禁止 `/reload` 或在线换类。首轮因相机监督器已退出而在停服前安全中止；恢复监督器后第二轮完成，失败回执保留。当前恢复点已刷新，旧运行树另存；回退只恢复三份代码，不把旧账户、世界或账本覆盖到玩家的新进度。私有证据在 E/F `repairs/villager-cli-20261102-r1`、`repairs/npc-cli-release-20261103-r2`；入口已消费，不进入公开仓库、不重复执行。

## 分开跟进的入口加载问题

`creeping_crypt` 的 `travel` 还存在另一条故障：现役 Youer 的 `CraftWorld.getChunkAtAsync` 在目标区块尚未加载时直接完成为空，并没有启动加载；遗迹接近点因此返回“地形暂时无法加载”。这来自实际发行 `universal.jar` 的字节码核对，不是把正确命令误判为语法错误。本批没有改该加载接口，仍需隔离验证兼容加载方式及安全传送后再发布；没有代操作可米或强制重试其旅程。不能把本次命令纠正上线说成遗迹传送已修好。
