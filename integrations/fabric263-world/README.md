# My Agent World: Living Adventures — Fabric 26.3 实验世界

用户指定的十组内容已一起安装，并用匹配的真实 Java 客户端联机。此目录是独立实验服的可复现部署、原生客户端验证和维护工具；没有替换 SAO、千灯纪主服或共用账号系统。

当前版本：Minecraft **26.3**、Fabric Loader **0.20.1**、Fabric API **0.165.0+26.3**、私有 Temurin **25.0.5+8**。内容锁定于 `pack.spec.json` / `pack.lock.json`，不会在每次启动时追最新版本。

## 内容清单

| 方向 | 已锁定的模组版本 | 用途 |
| --- | --- | --- |
| 世界主线 | Village Quest 2.6.3 | 村庄人物、剧情、日常、声望与发展 |
| 委托 | JustQuests 0.4.5 | 个人／团队任务、重复任务与领奖命令 |
| 地形 | Terralith 2.6.5 | 原版方块构成的新群系与地形 |
| 村庄、船只 | Towns and Towers 1.13.13 | 更多村庄、据点和船只结构 |
| 地下城 | Dungeons and Taverns 6.1.0 | 遗迹、酒馆与地下城探索 |
| 料理 | Farmer's Delight Refabricated 3.6.30 | 厨房、食材加工与农业 |
| 职业、法术 | Wizards 3.1.4、Paladins & Priests 3.1.4.1 | Spell Engine 1.10.9、Spell Power 1.6.2、Runes 1.3.2 |
| 近战 | Better Combat 3.2.2 | 攻击动作、武器机制；需 Player Animation Library 1.2.8 |
| 交易 | Universal Shops 1.16.0 | 容器式商店；Polymer 0.18.5 为服务端依赖 |
| 运营人物 | Easy NPC 7.17.1 | 自定义 NPC、配置界面与交互 |
| 性能 | Lithium 0.26.3、FerriteCore 9.0.0、spark 1.10.187 | 游戏逻辑、内存优化及实测分析 |
| 客户端 | Sodium 0.9.2、GraalWeave 0.1.1、官方 Baritone API 1.20.0 | 真正的客户端渲染、Python 原生数据及动作、寻路 |

含依赖及自有兼容组件：服务端 **30 个顶层 JAR**，客户端 **31 个顶层 JAR**。Fabric 显示的嵌套模块数量不是内容模组数量。Player Animation Library 使用人工指定版本，依赖解析不能擅自用另一个“最新稳定版”替换。Baritone 发布号 1.20.0 对应本次 26.3 构建，不代表 Minecraft 1.20。

`Structure Pool API`、`Lithostitched` 的项目目录端侧标签不足以判断真实依赖；它们作为硬依赖也进入匹配客户端，已通过实际冷启动验证。不能按目录标签直接删掉。

## 本机部署与边界

- 服务端：`E:/MC/servers/agent-world-fabric-26.3-lab`
- 客户端：`E:/MC/clients/agent-world-fabric-26.3-lab`
- 私有缓存及证据：`E:/MC/runtime/fabric263-lab`
- 游戏入口：**127.0.0.1:39781**；管理辅助入口：**127.0.0.1:39782**。

管理辅助入口使用随机本地 Token，只用于把命令交给该实验服 stdin。接受命令不代表游戏目标完成。未开启 RCON、未改防火墙／路由器／网站／生产端口。

这是回环离线测试身份，不是公网登录方案。不要仅修改 `server-ip` 后直接公开；正式开放还需登录、身份与权限、建筑保护和发布验收。现有账号、角色记忆和原服世界未迁移。没有安装适配到 26.3 的 Mineflayer 网关、Numen 或基岩桥，不能据此声称这些入口已经可用。

## 准备、启动和停止

以下命令在本目录执行，`python` 需是可用的 Python 3.11+。本机使用 Codex 随附 Python；没有修改系统 PATH、JAVA_HOME 或全局启动器账号。

```powershell
python prepare.py --server E:/MC/servers/agent-world-fabric-26.3-lab --client E:/MC/clients/agent-world-fabric-26.3-lab --cache E:/MC/runtime/fabric263-lab --accept-eula
python install_content.py
python manage.py start
python manage.py status
python manage.py client --username GraalScout
python probe.py --status
```

`start` 返回 starting，必须等 `status` 的 `ready=true`；进程存在、端口打开或退出码 0 都不足以证明启动成功。准备脚本校验原始来源、大小、哈希与依赖，拒绝覆盖不同字节，也拒绝写入已有但不属于本实验的实例目录。

```powershell
python manage.py stop
python manage.py status
python backup.py --primary E:/MC/backups/fabric263-lab-20261101 --secondary F:/MC-backups/fabric263-lab-20261101 --label your-new-snapshot-name
```

备份须看到干净停止、退出码 0 且两个回环端口均关闭；两个输出路径必须是新文件。归档包括世界、配置、Easy NPC 状态、实例设置及本次源码／锁文件，并逐文件验证主副本。不会把管理 Token、个人启动器凭据或供应商 JAR 打进分发包。恢复时解压到新的独立实例，按同一锁重新准备并隔离验收，不覆盖原服。

## 原生 Agent 接入

本实验使用 **GraalWeave 控制真正的 Fabric 客户端身体**，尚未挂常驻大模型循环。Python 可从当前客户端对象读取实际注册 ID、组件、容器槽位、任务同步数据与法术选项；不是把模组道具翻译为原版物品后再猜真实身份。

```powershell
python probe.py --code-file inspect_world.py --request-id your-new-read-id
python probe.py --code-file read_catalog.py --request-id your-new-catalog-id
python probe.py --code-file read_village_state.py --request-id your-new-village-read-id
python probe.py --code-file quest_snapshot.py --request-id your-new-quest-read-id
```

只允许一个控制器串行操作本身体。上游 Python 是受信任的完整本地执行权限，其原始发现 Socket 没有公网鉴权；只保留回环连接，不能直接发布。统一 MCP／自研核心的身体租约、远程鉴权和持续自主循环是下一阶段，当前工具不冒充这些能力。

每次执行使用唯一 request ID；先保存私有回执，再提交。重复 ID 只读原结果；同 ID 不同源码报错；结果 unknown 不自动重放。`status=ok` 只说明 Python 执行结束，必须检查实际位置、物品和服务端任务进度才算游戏目标完成。不要自动重放 `gather_probe.py`、`craft_probe.py`、`cast_probe.py`、`setup_combat_fixture.py` 等一次性动作脚本；已经用过的 ID 全部只作对账证据。

26.3 实际菜单接口为 `handleContainerInput(..., ContainerInput, player)`；不能套用旧版 `ClickType`。屏幕通过 `mc.gui.screen()` 读取。饰品扩展后实测背包菜单 51 槽，不能假定固定 46 槽。

Village Quest 绘制的 Journal 不暴露普通按钮列表；本次按真实 `JournalScreenData` 的唯一类型读取本人主线、下一步与声望，不声称已自动点击所有自绘界面。JustQuests 的本人进度来自 `ClientQuestData`。两套声望／任务经济尚未合并。

## 委托与合成兼容

`starter-quests.json` 提供 8 个自有 `maw:` 委托：采木、工作台、住所、小麦、蔬菜汤、夜巡、畜牧、附魔。安装器只合并本命名空间，保留模组内置任务及玩家进度；修改已有自有定义需明确 `--update-owned`。

例如：`/quest list`、`/quest accept maw:gather_logs`、`/quest progress`、`/quest claim maw:gather_logs`。当前服务端同步 38 项任务，8 项来自此文件；这不是把整套目录塞进模型上下文。

`maw-fabric263-compat-0.1.0.jar` 修复已实测的 JustQuests 0.4.5 快速合成漏计数：用 `ResultSlot.checkTakeAchievements` 的真实移出数量，为空参数的 `onTake` 保留一次性合成证据。原任务钩子仍是唯一计数来源；不写任务进度、不发额外奖励、不改库存或权限。编译器锁定原 JustQuests 字节，Mixin 必须准确命中，不能降低注入检查来伪装成功。

## 已验收与未验收

详见 `acceptance-20261101.json`。实测为普通生存、无 OP 的 GraalScout：

- 官方 Baritone 短距离走到目标附近；自然采集 4 原木，任务领奖 4 面包。
- 用真实 2×2 合成格制作工作台；修复后任务真实完成，领取 8 火把。
- 读取农夫乐事 189 项、Wizards 42 项、Paladins 51 项真实物品；打开原生 Village Quest 日志并读取本人信息。
- 原生奥术箭命中命名静止尸壳靶，客户端与服务端均确认血量 **20 → 15.8**；这是显式管理夹具，不是野外自主战斗成绩。
- 冷重启、同 UUID 重连后物品及已完成的两项任务保持；真实截图由 Java 客户端产生。
- 单客户端正常时段 `tick query` 样本：平均 4.5 ms，P95 6.8 ms，P99 8.9 ms。不能外推多人或长时间满载表现；世界加载阶段仍记录到 2–5 秒尖峰。

尚未完整验收：全职业／治疗／组队玩法，烹饪锅完整加工，商店交易、Easy NPC 剧情制作、每类遗迹的完整攻略，自研核心持续自主生存、Mineflayer／基岩／Web 的 26.3 渲染。装入模组与打通全部玩法是不同的验收阶段。

## 已知问题与退出

开发过程保留了首次缺依赖、任务 JSON 字段不符、首版 Mixin 注入失败和离线测试角色遭怪物击杀的记录；没有删模组或赋予无敌来使测试变绿。当前 QA 角色已经下线，不在运行自主模型循环。

热更完整资源栈时曾出现农夫乐事 `farmersdelight:tools/knives` 标签异常和 RPG 掉落警告；最终定义已做冷启动。正式内容更新先停服备份后冷启动，暂不把全栈热重载当作已支持能力。离线身份的 Realms／档案 401、可选属性 `ranged_weapon:haste` 和 Windows OSHI 进程统计警告均保留，不声称日志完全无告警。

官方 Baritone 1.20.0 的非 daemon 缓存线程曾让客户端退出看门狗触发。`close_client.py` 仅对该精确 JAR 哈希：取消寻路、保存客户端缓存、停止唯一审核过的缓存执行器，再请求 Minecraft 退出。已实际复验进程退出且无新增看门狗报告。上游两条 InterruptedException 退出日志仍保留。使用该辅助脚本后本进程必须退出，不能在同一进程重新启用寻路；普通窗口关闭路径尚未修补。

```powershell
python probe.py --code-file close_client.py --request-id your-new-close-id
```

## 分发与验证

已生成独立客户端候选包 `E:/MC/releases/my-agent-world-fabric26.3-0.1.0-lab.2.mrpack`。在支持 Modrinth 包的启动器中导入新的独立实例，选择 Java 25。此包不是 SAO R2 的替代更新，尚未上传生产网站。

包中 32 项供应商下载索引指向原始发行地址，并带哈希、大小、端侧说明；自有兼容 JAR 附 Java 源码。不包含 Minecraft 本体、账号、存档、管理密钥、第三方模型／贴图提取物。许可证以锁中的原项目声明为准；不能把索引视为允许另行重分发所有供应商二进制的授权。

```powershell
python -m unittest test_prepare test_probe test_backup test_install_content
python package_client.py E:/MC/releases/your-new-build.mrpack --release-id your-new-build
```

21 项回归覆盖依赖端侧、固定版本、哈希、目录归属、路径、未知结果不重放、执行成功不夸大目标、冷备份、旧快照不可覆盖，以及首次／重复安装任务和命名空间冲突。管理、依赖、内容的改动都先在本实验验收；不要修改生产服务或使用原服账号来代替测试角色。
