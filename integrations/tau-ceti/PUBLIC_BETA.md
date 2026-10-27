# My Agent World · Aincrad 公测部署

本批目标：替换原 FOM 模组服，采用公开免费 Aincrad 第一层地图，同时保留机械、殖民地、农业和魔法生活。Paper 千灯纪继续作为独立实例。最终运行证据见 [public-beta-release.json](public-beta-release.json)；只有其中实际完成的检查才能视为上线验收。

## 玩家如何加入

1. 在启动器创建独立实例，导入作者的 [TauCeti-ATM10-CF-1.3.2](https://www.curseforge.com/minecraft/modpacks/tau-ceti-atm/files/8462075)。游戏为 **1.21.1 / NeoForge 21.1.234**，作者建议分配 16 GiB 客户端内存。不要覆盖其他实例。
2. 正常退出该实例。下载本目录的 [client_patch.ps1](client_patch.ps1) 和 [client-patch-manifest.json](client-patch-manifest.json)，放在同一文件夹。
3. 使用 Windows PowerShell 执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\client_patch.ps1 -MinecraftDir "D:\你的启动器\实例\Tau\.minecraft"
   ```

   路径须选中**刚导入的 Tau 实例**；可先加 `-Plan` 查看清单。脚本核对官方启动脚本、下载来源和每个文件的 SHA-256，全部下载通过校验后才移动旧文件；发生安装失败会恢复本次移动的旧文件。旧文件备份位置会显示在结果中。不会修改其他实例、微软账号或系统执行策略。

4. 手动添加我们的服务器 **micro.kangqiang.site:28976**。官方包预设服务器属于作者社区，需另加上述地址。
5. 测试期支持游戏内注册：首次离线账号输入 `/register 密码 密码`，至少 8 位；后续 `/login 密码`。已存在的原 FOM 登录数据库保持。正式认证的正版走 MixAuth 的 Mojang 校验路径；本批离线注册和密码重登有实际记录，尚不把正版客户端免密登录写成已实测。

补丁目前包含 **54 个保留玩法/依赖 + Sodium，共 55 个文件，约 193 MiB**。它使用原作者公开下载地址，不重新打包这些模组。替换旧 Sodium，并备份会冲突的旧渲染附属组件。SHA 固定清单若与脚本版本不同会停止，重新下载同一版本的二者即可。

## Agent 如何加入

Mineflayer 连接 **micro.kangqiang.site:28977**，局域网用 **192.168.3.163:28977**。协议 Minecraft **1.21.1**，使用独立的 `ag_` 开头账号，例如 `ag_Kirito`，`auth: 'offline'`。首次同样 `/register`，后续 `/login`；只有收到真实授权状态后才执行游戏动作。每个 Agent 的账号、密码和长期记忆由它自己的运行时维护，不共用测试账号。

```javascript
const bot = require('mineflayer').createBot({
  host: 'micro.kangqiang.site', port: 28977,
  version: '1.21.1', username: 'ag_YourName', auth: 'offline'
})
// 通过自己的秘密配置读取密码，再按服务端实际注册/登录提示提交。
// 不把密码写进日志、直播画面、记忆笔记或公开脚本。
```

原生客户端身体、Mineflayer 登录身体、Numen 常驻身体是三种入口。不能让两个控制器同时控制同一个身体。Numen **0.1.4.1** 及原生扩展已留在服务端，SDK **127.0.0.1:28989/TCP** 不直接开放公网；先从 SDK 的 `operations` / `mod_operations` 查询本实例真实支持的动作。模型、记忆和决策循环继续由 Agent 运行时管理，本批不自动发起付费推理。

`/mycli help`、`/mycli list`、`/mycli status` 提供短说明和本人绝对位置；`/fom inventory`、`/fom inspect <x> <y> <z>`、`/fom nearby` 是保留名称的原生只读桥。模组物品的原版投影可能显示为 paper 等基础类型，必须结合原生 ID 和组件判断。登录或收到区块，不等于已经验证所有模组操作、真实纹理和 GUI。

## 地图与可玩内容

主世界使用 [SAO Map Floor 1，Alyaaa / Yoplay](https://www.curseforge.com/minecraft/worlds/sao-map-floor-1/files/6729184) 的公开免费地图，独立转换到 1.21.1；出生点 **(-582.5, 69, 934.5)**。原图实际保存范围约 X -2224～2511、Z -2256～2335。这只是第一层，不能称为完整的一百张楼层地图，也不包含付费 PROJECT AINCRAD 地图。

主图通过原生 YAWP 保护建筑和地形，普通玩家交互保留；自然资源另用 **myagentworld:wilderness**，包含正常地形、矿物与群系，可采集、农业、建设机械和建立殖民地。`allowotherdimcolonies=true` 已按实际 MineColonies 配置启用。

- `/mycli wild`：前往资源世界；异步准备区块、检查脚下碰撞和头顶空间后传送。
- `/mycli spawn` 或 `/aincrad`：返回起始之城。
- `/tower floor`：查看原包的全服塔进度和钥匙需求。
- 起始广场发光方块上 `/tower`：使用原生波次塔。初始物资含一枚 echo_shard 钥匙；该塔有共享进度和原包的 1 小时战斗锁定规则。原包塔并非旧 Paper 的个人试炼系统。

传送先回 `accepted`，后以角色实际维度和位置核验 `completed`。同一未完成请求不会重复派发；观测失败回 `unknown`，须查询 `/mycli status`，不能以新请求 ID 盲目重试。这里只提供游戏指令层的短期状态，跨重启动作对账使用原 SDK 账本。原地形保护、认证和战斗禁止逃离规则不为测试关闭。

当前总计 **527 个服务端 JAR（含库和 Agent 组件）**，不是 527 个独立玩法。Tau 自带版本优先，不用旧 FOM 的同名 JAR 覆盖：

| 内容 | 当前整合 |
| --- | --- |
| 机械动力 | Create 6.0.10；保留旧 FOM 的部分机械、铁路、物流、炮械和飞行扩展 |
| 殖民地 | MineColonies 1.1.1339 snapshot，Structurize / BlockUI / Domum 等匹配依赖 |
| 农业生活 | Farmer's Delight 1.3.2、储物及原包生活系统 |
| 女仆 | Touhou Little Maid 1.5.3 |
| 探索魔法 | Twilight Forest 4.8.3345、Iron's Spells 3.16.1、Ars Nouveau 5.12 等 |
| 任务与挑战 | FTB Quests、Easy NPC、Gateways to Eternity、Lootr 等原生框架 |

Petrolpark 1.5.1 / Petrol's Parts 1.3.0-snapshot2 要求更高 NeoForge，保持原字节归档，暂未加载；Smart NPC 同样因加载器下限排除，使用现有 Easy NPC。墓碑/领地等重复体系不强行并装。YSM、Folkways、Settlements、Wandscape 不在此次已加载清单里；旧研究和资源仍保留，不能冒称已经迁入。

## 运维与恢复

正式目录 `E:/MC/servers/tau-ceti-1.3.3`：`server/` 存世界与配置，`ops/` 存 supervisor、版本清单、私有回执和冻结网关。旧 FOM 及前一 Tau 候选均保留，重置没有覆盖 Paper 及原玩家世界。

| 端口 | 作用与范围 |
| --- | --- |
| 28976/TCP | 公测 Java 整合包入口 |
| 28977/TCP | 公测 Mineflayer 网关 |
| 28989/UDP | Simple Voice Chat；须客户端安装相应模组，公网路由可达性单独核验 |
| 28989/TCP | Numen 私有 SDK，仅回环，不能转发 |
| 28985/TCP | 监护健康接口，仅回环，不能转发 |
| 28988/UDP | 旧基岩端口；Tau 新资源/协议尚未验收，当前不启动旧桥冒充兼容 |

仍沿用原模组服端口和 Windows 既有规则，不修改 Paper、防火墙其他规则或路由器。HKCU Run 只能保留一个拥有这些端口的模组服服务，最终切换须写入发布清单。

```text
python tau_service.py status --config service.json
python tau_service.py console --config service.json --request-id 唯一编号 --command "save-all flush"
python tau_service.py shutdown --config service.json --request-id 唯一编号
python tau_service.py run --config service.json
python tau_service.py resume --config service.json --request-id 唯一编号
```

维护停止后 `run` 不会擅自清除暂停，需明确 `resume`。仅操作自己启动的子进程，通过 stdin 正常保存退出，不按名称结束 Java。已确认成功的探针出现短时超时采用有界 30 秒宽限，状态仍报告不健康；未首次就绪、鉴权错误、配置变化、进程归属异常不适用宽限。

每次 JVM 启动重新导出真实注册表，按完整名称重建映射；数字 ID 跨启动可能变化。网关在本次注册表准备前不启动。静态冻结目录不修改，新版本创建新目录。保留原始未知组件失败，不跳过未知长度字段来制造成功。

重置前完整冷备 `tau-before-aincrad-reset.zip` 为 2,000,749,633 字节，SHA-256 `a7c2ee73dad90f2d30f95a18b3d4b97e10038dc56d8e3caa136a1f045eb34503`，E/F 双盘已核对。旧 FOM 另有整服冷备。密码数据库、私有 SDK 凭据和验收账号不入 Git。

另有新世界及配置冷备 `tau-public-world-baseline.zip`，209,802,485 字节，SHA-256 `1f5f5fef0c29eaefb4386b008510446654f1cb8340f8b0c04ede17f89609a859`，3042 个文件，E/F 两份一致。冻结模组/网关按发布清单匹配，不能仅还原一份旧 service.json 后混用新 JAR。SimpleBackups 原生配置已启用，每 120 分钟全量保存世界、保留 10 份且最多 25 GB；它不替代认证数据库、SDK 私有数据和 ops 账本的专项备份。FerriteCore、Lithium、ModernFix、Spark 已随实际模组集加载。

## SAO MMORPG 后续缺口

目前是结合 SAO 地图的整合包公测基础，完整第一季 MMORPG 还需这些连续玩法：

1. 起始之城教程、SAO 故事线、NPC 委托与工会晋升，使用 FTB Quests / Easy NPC 继续编排。
2. 原生等级、武器熟练度、剑技与魔法的统一成长规则；旧 Paper 职业、工会、技能进度没有自动复制。
3. 多座真正有路线、机关、精英/Boss 的楼层，以及队伍独立进度、断线续关和奖励结算。
4. 材料、打造、耐久、回收、市场与货币闭环，控制奖励膨胀；优先复用原生模组系统。
5. Java 真客户端全流程、Numen / Mineflayer 各模组实操、完整 Web 渲染与基岩模型/菜单，逐项验收。
6. 网站绑定、公测注册迁移、跨世界角色档案、委托/捐赠统计与持续内容运营。

本批 17 项 Python 回归和 21 项 Node 回归通过，客户端补丁 `-Plan` 以真实官方 ZIP 启动脚本验证，未写入 mods。真实联机检查和外部状态探测结果独立记录；未验证项不随数量或启动成功一并宣称完成。

## 已知兼容债务

原包仍有指向缺失物品、配方、流体或战利品条件的日志，例如部分 Allthemodium 旧装备、Reliquary 流体及 Sable 的 Copycats 标签。多次 `/reload` 会重复这些日志，不能按累计数量推断同时发生了多少故障，也不能把成功启动说成零错误。清单中相关奖励/配方需继续逐项清理；这批已验证的是登录、世界往返、保护与实际资源采集，不是所有 527 个 JAR 的完整玩法。

Numen/MixAuth 都会参与登录时序；账号名保护要先于 MixAuth 的可取消处理运行。`TauLoginNameMixin` 使用显式优先级，禁止将 `@` 开头的离线名字当作第三方脚本中的命令选择器。验证必须检查实际断开回执，编译通过不能代替这一项。
