# 传送阵审计与保留改进方案

审计日期：2026-09-07。目标：Minecraft 1.21.1、NeoForge 21.1.248。本轮已保留现有“传送阵”名称、书页、罗盘/技能箱和数字入口，并补齐存储可靠性、服务端维度与安全落点检查、稳定引用及独立菜单。建议继续沿用此实现；未安装 Waystones，未访问历史 NPC 聚集区域。

本文保留审计初始问题及方案比较，并记录最终真实验收：罗盘 10 组、服务端传送 8 组全部通过。文末明确列出实际证据与未测边界。

## 审计初始数据与入口

正本是 `server/world-data/waypoints.json`，容器路径 `/app/data/waypoints.json`；Java UI 读取 `server/mcdata/waypoints.json`，容器路径 `/mcdata/waypoints.json`。这是两份文件和两个挂载，依靠 world 双写同步，并非同一个文件。审计时两份 SHA256 均为 `4742d55bcb9caa8c0a39124396340376374e3ecbf86938e9c998b0abc86147b0`。挂载证据见 [compose.yml](../compose.yml)。

| 归属 | 数量 | 内容与状态 |
|---|---:|---|
| 公共 | 3 | 千灯村广场、家·千灯堂、萌萌村广场，id 1–3 |
| MengMeng 私人 | 5 | 4 个同名“藏宝点”及“家”，id 1–5 |
| Kirito 私人 | 1 | “试炼之地”，id 1 |
| 总计 | 9 | 全部记录标注 `minecraft:overworld`；没有发现状态、共享白名单或落点安全验证时间字段 |

审计初始 MengMeng 视图为 3 公共 + 5 私人 = 8 点，下一次记点就超过原技能箱的显示容量；Kirito 看到 4 点。这些原有地点的坐标仅从文件读取，没有逐一访问。后续真实测试只点击专用 QA 私人点，不能据已验证的 QA 落点断言所有历史地点今天仍安全。

真实链路为 `mc-waypoints.ts` → `mc-god.ts` 的 `goto / waypoint / handleNumberTeleport / tpWaypoint`。面板和命格书的点击指令原来都是 `/mycli 传送去 <当前序号>`，经已有 CLI 路由交给 world 执行。公屏纯数字、中文数字及“八号哎”形式在点名闸之前被识别；私聊数字也能触发。守护天使私聊可按既有映射代主人操作。它是有粒子和声音表现的已存坐标传送系统；没有“必须站在某个阵台方块上”的验证。

- [mc-god.ts](../world/src/mc-god.ts)：`tpWaypoint`、`handleNumberTeleport`、`goto`、`waypoint` 及聊天数字快路径。
- [SkillChestLayout.java](../world/botgate-src/dev/god/botgate/chest/SkillChestLayout.java)：审计前第 150–165 行最多列 8 点，末格“还有 N 个”无点击动作；原分页仅服务技能。
- [SkillChestIO.java](../world/botgate-src/dev/god/botgate/chest/SkillChestIO.java)：按 shared + 当前玩家名下 personal 读取。
- [SkillBookUseMixin.java](../world/botgate-src/dev/god/botgate/mixin/SkillBookUseMixin.java)：传送页读取同一镜像，点击序号；“记住这里”固定提交“记 藏宝点”。虽然属性前缀保留 `settlementsfix`，实现位于当前 botgate，不依赖退役 JAR。

## 审计初始确认的缺口

| 项目 | 审计前的实际行为 | 当时风险与处理方向 |
|---|---|---|
| 损坏保护 | 加载失败后仍构造种子并保存；备份使用 ESM 中的 `require` | 原地点可能被覆盖。独立存储层本轮已修复，见下节 |
| 写入反馈 | 正本和镜像直接写，错误吞掉 | 命令可称成功但未持久化；UI 可能读半份 JSON。已改各自原子替换、错误显式可见 |
| 跨维度 | `Waypoint.dim` 存在，但记点只读取 Pos、默认记为主世界；传送命令未使用 `wp.dim` | 不能承诺地狱/末地坐标正确。必须读取真实维度并在指定维度执行，不能只改数据字段 |
| 安全落点 | 原实现直接 `tp`，没有脚下承重、身体空间、流体/火焰/虚空、边界检查 | 曾经安全的地点可能被建房、挖空或淹没；记点时安全也不能代替每次传送检查 |
| 成功判断 | RCON 失败被转为空字符串，仍发“传送阵已开”、写成功纪事 | 执行端必须返回结构化结果；只有位置及维度确认后才发成功效果/记录 |
| 权限与身份 | 公共点全员可用，私人列表按玩家名隔离；不是 UUID 所有权 | 现有普通入口没有改别人私人列表的参数，但名称变更、重名 Agent 与代主人执行须由身份层明确处理。稳定引用 `personal:5` 仍需绑定请求主体，不能作为跨玩家万能 ID |
| 数字与点击 | 数字按当前列表位置解释；持久书页/已打开菜单也提交位置 | 删除前面的点后旧按钮会指向其他位置。新按钮应提交稳定引用，数字兼容作为即时列表快捷方式 |
| 重名 | 原精确/模糊查找都取第一个；同名藏宝点已真实存在 | 新存储保留旧点、拒绝含糊选择并提供候选；按稳定引用可准确选择 |
| 删除 | 列表显示全局序号，旧删除参数却是私人段序号 | 保留旧命令兼容，但新 UI 应显示具体待删名称并使用 personal:id，不要求用户心算公共点偏移 |
| 冷却 | 数字快路径有 3 秒节流，goto/按钮路径原先没有同一门槛 | 应在统一传送执行入口限流，不能只在聊天预解析处限流 |
| 发现与菜单 | 没有发现状态；公共点直接开放；原界面超过 8 点无可点分页 | 保留既有开放点。未来探索点可选“到访解锁”，已有公共点不应突然锁住；所有界面共用同一过滤和分页视图 |

存储修复、指定维度执行、安全落点拒绝、统一服务端冷却和新菜单现已接入，并通过下文的真实验收。此表保留最初的诊断依据；到访解锁、所有权迁成 UUID 等扩展不在本轮完成范围。

## 本轮已完成的存储层修复与 API

[mc-waypoints.ts](../world/src/mc-waypoints.ts) 已完成：

1. 损坏或不可读正本保留原样，不写种子、不覆盖旧镜像、不接受新增/删除。`getStatus().available=false` 明确告知调用者；只有原文件明确不存在才允许创建新簿。
2. 同目录临时文件写入、`fsync`、重命名替换；正本成功后再更新内存和镜像。正本失败抛 `write_failed`，内存不提前变更。镜像失败单独报告，不把已提交正本误报失败或重试新增。
3. 校验版本、列表形状、归属、同列表重复 ID、有限坐标、维度资源名、1–16 字显示名及控制符；维度高度和环境危险由执行端验证。保留合法旧数据的 ID、顺序、同名点和额外字段。
4. 稳定引用 `shared:id / personal:id`；可选 `nextPersonalIds` 保存已发出 ID 的高水位，删除最高 ID、重启再新增也不复用。私人上限仍为 10；旧 `remove(username,n)` 仍按私人序号。
5. 已有同名点不删除、不自动改名；查询返回歧义候选，新增同名拒绝。返回的数据是副本，调用者不能绕过保存篡改状态。

| API | 约定 |
|---|---|
| `getStatus()` | `available/source/lastWriteOk/error` 及 `mirror.path/ok/error` |
| `listWithRefs(username)` | 每项包含 `ref/index/scope/waypoint`；index 仅用于即时显示 |
| `resolve(username,query)` | `found` 带 `entry`；`ambiguous` 带 `matches`；其余 `not_found/invalid_query/unavailable` |
| `byRef(username,ref)` | 返回该主体可见的点或 null；只读，不代表已传送 |
| `add(username,name,x,y,z,dim)` | 成功返回点、满 10 返回 null；不合法/同名/落盘失败抛带 code 的 `WaypointStoreError` |
| `removeRef(username,ref)` | 仅删除该主体的 personal 引用；公共引用拒绝 |
| `syncMirror()` | 只重试镜像；失败不重新新增地点 |

调用方需要同时调整：`allFor().findIndex(w => w === added)` 改成 ID/ref 比较；“记住这里”的固定“藏宝点”应给唯一后缀或让记点入口自动命名；名字歧义要列候选，不能回退到第一个。`getStatus().mirror.ok=false` 时应解释菜单稍后同步，不能让用户重复新增。

[waypoints.test.mjs](../world/tests-ai/waypoints.test.mjs) 11 项在隔离 Linux 镜像内全部通过，覆盖 BOM/旧顺序、损坏及不可读保留、合法字段、同名消歧、ID 不复用、个人隔离/上限、正本失败回滚、镜像故障恢复、数字解析及跨 UID 权限。Windows 为 10 项通过、1 项 POSIX 检查跳过。测试只使用系统临时目录，Linux 容器使用 network none，只读挂载 D 源码。单文件严格 TypeScript 检查通过。

```powershell
node --test world/tests-ai/waypoints.test.mjs
# 从 world 目录运行：
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node src/mc-waypoints.ts
```

首次实际罗盘验收发现镜像也使用了正本的 0600 权限：world 写者为 root，Minecraft Java 为 UID 1000，导致 Java 实际读到 0 个地点。现已改为正本保持 0600、UI 镜像明确 0644；临时文件提交前用 fchmod 固定权限，防止进程 umask 再次剥夺读取权限。Linux 回归用 UID 1000 子进程实际读取镜像成功，读取正本仍返回 EACCES；重写/删除/重新同步后的权限均验证。修复后，真实 NeoForge 界面与 MC 日志均显示 13 个 QA 视图地点；最终罗盘脚本 10 组全过，已验证第 9 项点击到达，详见下文。

边界：正本和镜像是两次独立原子替换，不是跨卷事务；仍按单 world 进程写入设计，没有多写者协调；没有把名字归属自动迁成 UUID，也没有自动解锁发现点。

## Waystones 作为可选后续方案

2026-09-07 从作者发布的 Modrinth 官方 API 核验：Waystones `21.1.42+neoforge-1.21.1`，版本 ID `1gzy0HSm`，发布于 2026-08-31；指定 Minecraft 1.21.1 和 NeoForge，必需依赖项目 `MBAkmtvl` 即 Balm。对应可用 Balm 为 `21.0.65+neoforge-1.21.1`，版本 ID `KgypwTqX`。Waystones 要求客户端和服务端均安装；现有两侧 mods 文件与内容清单均未含它们。来源：[Waystones 版本 API](https://api.modrinth.com/v2/version/1gzy0HSm)、[Balm 版本 API](https://api.modrinth.com/v2/version/KgypwTqX)、[Waystones 项目 API](https://api.modrinth.com/v2/project/waystones)。

这已核实目标游戏版本和加载器有官方版本；本轮没有下载 JAR，因此未验证该二进制声明的精确 NeoForge 最低补丁号，也没有以当前 21.1.248 实际启动测试。

| 比较点 | 改进现有传送阵 | 引入 Waystones |
|---|---|---|
| 现有体验与地点 | 保留原 9 点、语音数字、书页和统一罗盘 | 需要迁移/桥接旧 JSON，模组不会自动读取当前传送簿 |
| 探索玩法 | 发现标志、公共/私人规则需按需增加 | 作者已有到访激活、实体传送石和公共传送石玩法，适合以后探索据点扩展 |
| 规则 | 集中执行入口补维度、限流与安全拒绝 | 作者提供跨维度限制、费用和冷却规则；仍需本服角色/宠物/维度实际验证 |
| AI 与兼容 | 复用已有 world / botgate / CLI 路径 | 需要把 Agent 权限、UUID 身体、旧菜单和新模组 API 连起来；普通 NeoForge 玩家成功不等于 Mineflayer/Numen 已通过 |
| 旧世界与维护 | 本轮可不增加注册表或新方块 | 两侧新增至少 Waystones+Balm，新增世界数据/方块；必须保留备份并对导出锁和依赖重新校验 |

Waystones 官方说明支持到访激活、选择已激活目的地，以及由创造模式设置全员可见公共点；这是以后“探索发现阵台”的合适候选。[作者玩法说明](https://mods.twelveiterations.com/minecraft/waystones/waystone)

对于本服 1.21.1，应看官方规则页的 **Minecraft ≤1.21.11 / 1.20.6–1.21.11** 段落，支持跨维度条件、拒绝、费用和冷却；不要复制页首 26.1+ 的 Shogi 配置，也不应为本服额外引入 Shogi。[作者版本分段规则](https://mods.twelveiterations.com/minecraft/waystones/guides/warp-rules)

若后续选用，先在独立副本禁用自然生成、只放两个 QA 传送石验证，再决定新探索区的生成策略。官方有野外与村庄生成开关，但不能保证兼容所有模组村庄；配置字段必须按选定 1.21.1 版本核对，不照抄最新页面默认值。本文不承诺旧区块自动补生阵台。[作者生成说明](https://mods.twelveiterations.com/minecraft/waystones/guides/worldgen)

## 本轮实现范围与后续回归门槛

1. 所有入口归一：真人按钮、数字、CLI、Agent 请求最终走同一主体授权和执行函数。使用真实 UUID 定位唯一身体；公共点与当前主体私人点取自同一存储。
2. 点击稳定引用、菜单可翻页：传送独立页显示维度/公共或私人标识，至少验证第 9–13 点；旧数字入口继续指向当前列表。删除后保留着的旧按钮应明确“地点已删除”，不能传去新点。
3. 记点读取实际维度及精确 Pos；每次传送以目的维度、世界边界、身位碰撞、承重和危险方块复查。附近有限半径找安全候选；没有安全候选就失败，不自动铺地、清方块或无上限扫区块。安全检查与传送应尽量在同一服务端执行任务内完成。
4. 明确成功与失败：跨维度成功后检查目标 UUID 的实际维度/坐标，才发成功粒子和纪事；离线、失效维度、危险地点、越界、权限错误均给具体失败。冷却覆盖每一种入口。
5. 实测只用新 QA 人物与专用临时点：主世界↔下界、障碍/无承重/危险落点拒绝、重复名字选择、第 9 点点击、旧按钮删除后点击、私人隔离、失败不扣代价。先备份 QA 数据并在结束恢复，不访问老角色聚集地区。

## 最终真实验收

2026-09-07 的 [skill-compass-smoke.json](../reports/skill-compass-smoke.json) **10 组全部通过**。由专用 Mineflayer 玩家 QDCatalogProbe 实际手持带 `custom_data.skillbox` 的罗盘右键打开 27 格界面，验证了 8 个独特精选图标、归档只读与拒绝施放、shift 不取走虚拟物品，以及点击原生入口真正打开 54 格菜单。罗盘的非传送步骤也通过了第 8 技能槽移动去重和一次烟花施法的真实实体、魔力与防重复证据。

传送页实际显示 **3 个原公共点 + 10 个临时 QA 私人点，共 13 项**。脚本点击全局第 **9** 项，即稳定引用 **`personal:6`**、名称“验收路标6”；收到了 Goddess 对该地点的到达回执，并以 `qdlocation` 按 QA UUID 复核实际位置：主世界 **(-544.5, 63, 863.5)**。该位置是服务端在登记坐标附近选出的安全落点。未点击任何原公共点，未召唤原角色。脚本结束已移除临时保护效果、退出 QA 并释放共享锁。

[waypoint-travel-smoke.json](../reports/waypoint-travel-smoke.json) **8 组全部通过**：

| 实测内容 | 实际结果 |
|---|---|
| UUID 查询专用 Numen 身体 | 返回真实主世界位置 |
| 安全村落落点 | 到达主世界 (-544.5, 63, 863.5)，服务端回执确认 |
| 统一 3 秒冷却 | 冷却内重复传送被拒绝 |
| 危险落点拒绝 | 本次样本为高空无承重点；拒绝后身体未移动 |
| 不存在的维度 | 请求被拒绝 |
| Numen 跨维度 | 实际到达 `minecraft:the_nether` (0.5, 128, 0.5)，随后返回主世界 |
| QA 清理 | 本次临时 Numen 身体已 dismiss |

已确认的是上述真实场景。**物理手柄未实测**；此次输入使用 Mineflayer 真实物品/容器协议及已有 NeoForge 界面截图。没有遍历末地、全部模组维度、所有流体/火焰/碰撞组合或历史传送点，也没有实测超过当前 13 项的多页切换。QA 进度和人物备份的最终恢复由主任务统一处理，以上 smoke 报告只证明其各自列明的退出、效果清理及身体 dismiss，不单独证明离线备份已恢复。
