# 千灯河湾镇原址重建与西郊入口

状态：2026-09-20 22:15:43（北京时间）正式部署与原调度恢复完成。生产 25 个地块、道路、桥、池塘和矿口已建成，30 处旧物资设施已迁置，实读 44 张床；80 个原实体回迁的保存后和重启后原生检查均通过。桐人返还脚位 `(-554.5,64,866.5)`，858 格临时玻璃已拆除，生产建筑保护四项健康通过。原角色/Cron 已恢复，Qwen 随后自然恢复 healthy；13 个默认服务 running，已配置 Docker 探针 healthy，恢复后的 PawApps 与原生语音工具复查也通过。全量 health_mon 原报告仍失败，不宣称面板或全项目全绿。用户已把“保留老镇、向外扩建”调整为“用新镇覆盖老镇”。下文分开保留隔离 QA 与实际生产证据。第一期记录见 [TOWN-RENEWAL.md](TOWN-RENEWAL.md)。

本轮复用现有 Minecraft 1.21.1 原生结构、已安装模组资源、Numen 图纸能力和有限施工数据包。没有新增建造引擎、Agent 循环或社会经济系统。管理员整修不扩大 Agent 建造权限，不改变村民人格、职业、原身份或现有安全区。

## 最终空间组织

保留河道、北部大型建筑及其连续石砌基座、高空地标。旧地面街区按自然岸线和局部基座重建，不把整个河湾填成一块平地。暖木、浅墙、深色坡屋顶和石基连接公会酒馆、工坊、居民屋、四个玩家小院、农庄与庭园。

地块的 `floorY` 是地板方块高度，不是模板原点。谷仓地板在模板局部 Y1，故原点应为 `floorY - 1`。旋转使用原生命令实际支持的 `none` / `180`，不能把 Java 枚举名当命令参数。

| 用途 | 地块 | 实际落点概述 |
|---|---|---|
| 公会酒馆 | T01 | X -535..-523，Z 823..835，地板 Y70，朝向 180 |
| 复合工坊、箭匠屋、鱼铺 | W01/W02/W03 | 东岸三处，地板分别 Y71/Y70/Y63；鱼铺保留河岸尺度 |
| 居民住宅 | H01/H02/H03/H04/H05/H07/H08/H09/H10/H11/H12/H14 | 四栋 lodge、八栋小屋，共 28 床；H04/H10 门向已按实地路口调整 |
| 农庄谷仓、物资保管谷仓 | B01/B02 | B01 最小角 (-586,929)、地板 Y70；B02 最小角 (-425,799)、地板 Y72 |
| 麦田 | F01/F02 | 最小角 (-677,946)/(-657,952)，地板 Y71/Y72 |
| 庭园 | G01 | 最小角 (-674,888)，地板 Y70 |
| 玩家住宅 | P01/P02/P03/P04 | 西岸四院，与居民床位分账；P04 门向为 180 |

12 栋居民屋的 28 床，加酒馆 4、箭匠屋 1、鱼铺 1、两谷仓各 2，共 **38 张非玩家床**。33 名原居民每人建议分配一床，余 5 张备用；四个玩家住宅的 6 床不计入居民容量。最终 QA 保存世界实读 44 张完整床；原生夜间观测有 19 名村民处于睡眠。没有强写 `Brain` 或床位占领，尚不能声称 33 人都已找到指定床或全部床路由均实测。

原 431×401 格扩建总图及北岸住宅、温室等远期地块不属于此次 25 地块施工。[plan.json](../assets/town-expansion/plan.json) 已同步本轮 25 地块、保护矩形、QA 和实际生产状态；[结构选型](../assets/town-expansion/structure-selection.json) 保留来源核查用途。旧总图不能替代当前坐标及真实施工回执。

## 原设施、旧壳与身份

地面清理仅针对冻结前像中明确的旧人工结构。五个特殊设施庭园始终保留：神龛 X[-546,-538]/Z[849,857]、墓碑 X[-554,-547]/Z[821,828]、西岸模组小设施 X[-612,-602]/Z[861,872]、原展示亭 X[-565,-556]/Z[890,900]、发光物品框 X[-471,-461]/Z[936,950]。营火 (-486,64,949) 及其周围也保留。

旧 F06/F10 木屋按逐层墙屋顶证据纳入清理；北部 F01 的大量连续石砖属于大地标基座，不因其低于 Y90 就拆除。F36 树木、F37 树木石台和明确旧道路保留。F01/F06 重叠的 24 个石砌块已归入基座保护，不能按相邻旧屋重复拆除。

最终旧壳清单为 **2,660 个精确 before→air 点、14 个有界阶段**，包括 90 个冗余工作台和完整旧床对；15 个其他旧工作台由新地块写集接管，1 个位于保留亭。新建筑、地下物资库 2,200 个最终施工坐标、水/含水块、模组设施及非床方块实体均排除。普通功能块与含库存设施分开处理；没有整矩形清空或把自然石头、树木统称旧屋。

30 处旧箱/桶/讲台等方块实体先通过原生迁置保存到物资库，再允许处理原址支撑。QA `phase6-after-migration` 对 30 项均确认原址为空、目标持久化 NBT 一致：比较只忽略根坐标 x/y/z，保留物品组件等内容；80 个暂存实体的完整存档 NBT 保持。真实物品及原始 NBT 只留本机私有证据，不随文档或源码发布。QA 回执不能当作生产已搬迁。

隔离 QA 保存的 80 个原实体包括 33 村民、4 铁傀儡、3 女仆和 40 其他动物；正式生产即时清点为 **33 村民、6 铁傀儡、3 女仆和 38 其他动物，共 80 个**，两份世界的傀儡数量不能混用。现有 35 份人物档案只有六名原版村民具有明确 UUID＋npc 标签绑定及 `preservePosition=true`。另外 27 名实际村民虽可按唯一名字作观察关联，却没有对应 npc 标签；现役未绑定选择器只按类型和标签匹配，不能仅凭名字把它们强行接入旧档案。生产人物档案本轮不改出生点、绑定、人格或职业，不补生未观察到的同名角色。

六名绑定者按新场地安排释放点：岚在 T01 公会门前，石磊靠 W01 工坊，禾叔、小满靠 B01 农庄。居民使用不同坐标并检查真实支持方块和三格净空。三位女仆与其他动物优先原位返回；只有最终建筑碰撞点另选附近安全位置。早期 `phase5-22buildings` 中，33 个预测居民落点仅 25 个通过、8 个受未建建筑或旧壳影响，该失败保留。最终 QA 使用完整新镇重新编译释放清单，`phase11-released` 对全部 80 个原 UUID 的存档 NBT 同类型比较通过，实际变化仅为 `Pos`，没有改变 AI、物品、交易、职业或其他身份数据；临时 858 格玻璃平台已移除。正式生产随后独立核对并释放，证据见后文。

## 西郊真实矿道入口

原两处天然洞候选没有证明通向矿井：O15 只回到地表，O17 是小型封闭洞。不能给它们挂“地下城入口”并宣称接通。

当前保存世界确认西矿井 start (-53,48) 共 166 个结构 piece，联合范围 X[-929,-768]、Y[16,38]、Z[698,817]。东端实际二宽三高通道位于 (-768,28,785/786)，静态步行模型只确认 24 格局部分支；再向西有原生熔岩和蛛网。因此本包只接入这个真实分支，不宣称全矿打通，不连接试炼密室，不清除原熔岩、轨道、支撑木、箱子或刷怪笼，也不生成战利品。

矿口采用原创木石门面与石砖阶梯。表层双开口 X[-761,-760]、Z817，高侧脚面 Y66；门面内收在岸上，南侧 X[-763,-760]/Z818..819 的短挑台由道路包负责，原水保持。直向东挖掘会穿过水体，已拒绝；最终阶梯先向东上升，再经 2×2 阶梯转角折南接地面。

矿口包包含 360 个最终写格、910 个完整前像及邻格守卫、76 块石阶、5 处侧壁暖灯、9 个精确落砂顶盖，水/含水接缝、BE 和旧设施冲突为 0。实际写界 X[-767,-759]、Y[28,70]、Z[784,818]。静态半格碰撞检查的 320 个节点连通，双门高侧可达，最大步高 0.5、净空三格；QA 已实际放置并保存，随后原生角色完成矿口上行及下述独立下行试验。没有据此声称整个矿井可达或所有自然危险已清除。

现役安全区仍为 X[-715,-375]、Z[695,1035]、全高度。本矿口在西侧边界之外，施工不扩大安全区或 Agent 权限，也不把探险区描述为无危险。

## 原生施工与失败语义

每个施工阶段保留完整源快照、输入哈希、精确前像、最终后像、区块加载范围和实体占位检查。`prepare` 与 `apply` 使用同一同步前置核查，未加载、原像不符或有实体时不写世界。只有运行所需函数全部存在并返回正确结果才能进入施工；子函数返回槽先清零，避免缺依赖时误用旧成功分数。

施工一旦写入永久 `attempt` 锁，部分失败或未知不自动重放、不假回滚。目标方块已存在时跳过写入，再验证实际后像；原生 `setblock air` 因邻居更新返回零不等于失败，也不能因忽略返回值而跳过后像检查。矿口完整调用链 2,406 条，低于原生 65,536 限制。没有自动 load/tick 入口、自动区块强加载、传送、召唤或清实体指令。

生产需要新完整备份及重新编译的真实前像。QA 使用独立保存副本、frozen/flush 回执与文件哈希；正式备份使用 complete/save-on 确认。编译器接受显式 snapshot 参数，固定 DataVersion3955（Minecraft 1.21.1），不把旧设计快照直接当作未来现场空地证明。

## 验收边界与当前进度

| 项目 | 当前证据 | 仍待完成 |
|---|---|---|
| 25 个建筑地块及基础设施 | QA 与正式生产均对 50,034 格保存后检查通过；113 项派生状态单列，五处保护体积零变化；生产已重启并恢复 tick | 更长时间自然运行观察 |
| 30 处旧物资设施 | 正式生产即时及存档核验均为 30/30 完整 NBT 相等、原址空；双箱整对迁置 | 恢复运营后的使用观察 |
| 旧壳清理 | 正式生产精确清理已完成并纳入最终后像；失败锁及独立修复记录保留 | 自然运行后的观察 |
| 居民住房与身份 | 生产 44 床，80 原 UUID 回迁保存比对全部通过、unexpected=0；重启后每个 UUID/type/Health>0 均通过；QA 曾观测 19 村民睡眠 | 不宣称生产睡眠或全部居民指定床已验证 |
| 道路、桥、池塘、矿口 | 正式生产均已建成保存，151 个原水/含水格不变；五类原生导航成功仍仅为 QA 证据 | 生产原生通行及更长时间自然运行观察 |
| 建筑保护 | 最终组合隔离服 26 原生项通过；正式文件哈希、原生 enabled/全高范围/无 OP 豁免与四项健康均通过 | 任意第三方模组直接写块不属于完整对抗边界 |
| 小社会与 RSI | 沿用既有公会、交易、QwenPaw 角色和真实回执 | 自主生产—入库—交付闭环、收益及 L3 对照证据 |

原生导航使用 Numen 候选 `5e913b2ffb1a39b199333f768526537867be726bf27c451e7a1a507cc8a35da0`，与 bridge `361636f64e201bbf5cd11cf9963d9051d2a9562c1e3d157c804782f6a897af4a` 配对。复用真实 `goto`，参数为 `spec.alter=none`、`alter_budget=0`；只传送至试验起点，途中没有传送或改地形。临时 QA 观察器只读取原生 TaskRecord 终态，不是新生产导航接口。

- 第一组五次：物资库下行 4.28 秒、上行 4.17 秒、矿口上行 12.57 秒、桥面通行 6.38 秒达到物理目标且原生 SUCCESS。
- 第一组矿口下行失败保留：原生近目标降级仍报 SUCCESS，但停在 Y32，距离请求的 Y29 目标约 4.19 格，物理验收判失败；不能用任务终态覆盖位置事实。
- 根任务另行授权的 `stair-v1-fresh10` 下行，起点保持不动并实际经过 12 个 tick 后再发新任务，12.53 秒到达，后续站稳在 Y29、离目标 0.166 格、生命 20、未入水，原生返回 exact-cell SUCCESS。该名称指等待至少 10 tick，不是十次重试。共六次试验五次通过，覆盖五类路线；首个失败未删除，也没有继续循环重试。缓存时序是与源码和现象一致的解释，不是唯一已证原因。

早期 B01/F01 三格农作物后像失败，以及物资库 access 因已是目标块而将 `setblock` 零返回误当失败，均保留原 attempt/失败记录，之后通过独立严格前像修复取得后像通过；没有重置旧锁或宣称首次全部成功。测试路径与后像成功不代表全部玩法、所有自然更新或自主 RSI 效果已验证。

## 真实生产施工与恢复验收

本轮原生 pause/drain 的 ready 全部通过，world/NPC 停止、游戏冻结后按实际生产快照重新编译并分阶段施工，现已恢复。以下十份完整备份的 stage 回执均为 `complete`、`saveOn=confirmed`；目录和时间来自 `runtime/town-rebuild-20260920/production/*-backup.json`，不能使用 QA 快照替代。

| 生产阶段 | 完整备份目录 |
|---|---|
| initial | `D:/backups/mc-neoforge-auto/2026-09-20T132211.0195850Z-06afceb6` |
| after-holding | `D:/backups/mc-neoforge-auto/2026-09-20T132630.4897819Z-807ba3a9` |
| empty-room | `D:/backups/mc-neoforge-auto/2026-09-20T133449.9514382Z-9e9eb032` |
| after-migration | `D:/backups/mc-neoforge-auto/2026-09-20T133958.8050845Z-65430dc4` |
| after-buildings | `D:/backups/mc-neoforge-auto/2026-09-20T134638.2207740Z-8196b97d` |
| after-cleanup | `D:/backups/mc-neoforge-auto/2026-09-20T134925.0627613Z-4279b931` |
| final-held | `D:/backups/mc-neoforge-auto/2026-09-20T135209.8061201Z-cb595f8d` |
| after-release | `D:/backups/mc-neoforge-auto/2026-09-20T135541.6672242Z-21d1f2a6` |
| before-restart | `D:/backups/mc-neoforge-auto/2026-09-20T140359.5435857Z-2bea106a` |
| after-restoration | `D:/backups/mc-neoforge-auto/2026-09-20T141133.6146792Z-25448c7f` |

`production/final-verification/world-verification.json` 明确 `environment=production`、`status=passed`：50,034 个组合施工格无未解释差异，113 项邻接派生属性单列，实读 44 张完整床，五个保留体积零差异，151 个原水/含水格全部保持。该结果证明保存后建筑几何，回迁和恢复运营由后续独立回执证明。

`production/migration-verify/migration-verified-final.json` 对 30 处资产逐项确认即时完整 NBT 与保存后完整 NBT 均相等、30 处原址为空；仅忽略根坐标，保留物品、组件和其余字段。其间 80 个 holding 实体的完整存档 NBT 不变；回执明确没有借静态走格检查冒充原生通行试验。

从 initial 移至 holding 时，原严格身份报告发现 42 个 yaw 与原值不同，故保留为 failed。`production/holding-rotation-review/conclusion.json` 随后以现役 `TeleportCommand`/`Mth.wrapDegrees` 字节码和 Java/Python float32 位级运算证明这 42 项均是原生整周角度归一化，pitch 未变，160 个角度分量位级不匹配为 0；38 个实体旋转原值不变，其他所有非 movement 字段完全相同。该补充只解释这一对正式快照，原 failed 报告未修改，也没有放宽未来身份验证器。

随后生产 33 村民、6 铁傀儡等全部 80 个原 UUID 已回迁。`production/release-identity/identity-verification.json` 对 final-held→after-release 保存快照的 80/80 项检查通过，unexpectedChanges=0，未重招身份。`production/15-body-return.json.journal.jsonl` 完成桐人守卫返还，原生读回 `(-554.5,64,866.5)`、on_ground=true、未入水；随后精确撤除 858 格临时玻璃并 save-all flush。原早期 Y65 草案未直接用于最终落点，脚 Y64 来自正式世界 Y63 gravel 支撑和 Y64..67 空气的实读。

B01/F01 首次 apply 在三格农作物后像处失败。根任务根据正式世界实读，分别用 `08-b01-crop-reconcile.json.journal.jsonl`、`10-f01-crop-reconcile.json.journal.jsonl` 的独立受控操作补回；原失败 apply 和永久 attempt 保持。`11-all-buildings-post.json.journal.jsonl` 此后对全部 25 地块得到明确 post returned 1，不能改写为首次 25 次 apply 全通过。

正式 `deployments/reviewed-final-files-v2/journal.jsonl` 于北京时间 22:06:30 完成 29 个显式文件写入/哈希核验及 1 个 mirror 只备份，绑定计划 SHA256 `ca66625f832a3c17ce1e3fa5061df10d0c10276d811e5d0512e9d23abc7d023a`。bridge `361636f64e201bbf5cd11cf9963d9051d2a9562c1e3d157c804782f6a897af4a`、Numen `5e913b2ffb1a39b199333f768526537867be726bf27c451e7a1a507cc8a35da0` 实际目标哈希与 QA 一致。原 Minecraft 正常停止、exitCode=0，随后 MC/world/NPC 均 healthy。

`production/body-initial-to-before-restart.json` 确认原身体身份及背包/末影物品严格一致，但其他字段差异仍以 `differences_require_review` 保留；不把局部相等写成整份报告全通过。旧部署计划保留未执行，本轮没有通过清锁重复部署。

`production/runtime-restoration-verification.json` 七项全过：43 个相关文件精确一致、原三份配置不变、primary/mirror waypoint 正常、原五个容器 ID/image/restart 配置保持且 running，以及生产保护四项全过。原生状态确认 enabled=true、固定全高范围正确、manualOpBypass=false。`16-original-actors` 对重启后全部 80 个原 UUID、实体类型和 Health>0 逐项通过；生产仍为 33 村民、6 铁傀儡，未借 QA 数量代替现场检查。

桐人只通过一次 existing restore 恢复原身体，女神由原进程恢复原 UUID。`production/body-after-restoration/preservation-proof.json` 状态为 `identity_inventory_experience_permanent_abilities_preserved`，确认原身份、物资、XP、永久 abilities、健康、registry 和 advancements 保持。女神 attributes 完整类型化多重集合相同，仅列表顺序变化；桐人的唯一修饰值变化是既有临时 speed 效果，原 world 实际 ON 日志与 skill-events 配置证明五种已解锁被动效果正常重新施加，没有新永久解锁。正常时间计数变化不计为游戏产出或 RSI 收益。`BODY-AFTER-RESTORATION-REVIEW.md` 逐字段说明，两份 strict comparison 仍保留 `differences_require_review`，不改为 PASS、不放宽未来校验。223 个本轮 owned forceload 已全部释放，主世界查询无遗留强加载。

`20-resume-game-ticks` 的 unfreeze 一次成功，但测试把预期文案写成 `unfrozen`，收到真实 `The game is running normally` 后断言失败；未重投。`21-observe-resumed-ticks` 独立确认正常 tick、目标 20 TPS、当次 100 样本平均 7.8ms，Kirito/Goddess 原 UUID 均在线。

`resumed.json` 的实际时间为 `2026-09-20T14:15:43.653358Z`（北京时间 22:15:43），profilesAndCronsExactlyRestored=true；原 10 角色、16 班次与 session 原样，原禁用班次仍禁用，admission 恢复原状态。可以记录本轮部署和运营恢复完成。Qwen 在早期恢复校验中因维护 DNS 断路器 unhealthy，随后未重启、未改配置即自然恢复；UTC 14:16:54–14:17:49 的原 Docker 探针 exit0/ok=true，10 角色/99 技能绑定通过，FailingStreak=0。13 个默认服务均 running，全部已配置 Docker 探针 healthy，gate 本来无 healthcheck。UTC 14:18:31 survivor heartbeat 为 thinking/ok=true，原 memoryEpoch 保持；这是恢复认知活动，不等于某个游戏目标已完成。

全量 health_mon 于 UTC 14:17:35 开始采样、14:20:53 输出，exit1，原报告 `production/full-health-after.stdout.json` 的 14 个顶层失败原样保留：operations_inventory、services、architecture、panel_smoke、rcon_protocol、character_speech、maid_bridge、maid_perception、survival_practice、pawapps、agent_learning、world_operations、numen_autonomy、world_team。服务项的采样早于 Qwen 自然恢复；`production/final-health-closure.json` 新只读采样 currentServices.ok=true，原全量中的 town_protection 和 panel_smoke.game_qwenpaw 子项通过，fullHealthOriginalOk 仍为 false，不能宣称整个面板或全项目全绿。

恢复后的针对性复查保留为新旁证：UTC 14:23:58 原 PawApps helper 单次得到 8 项及既有 behavior 全通过，发现接口 0.047 秒、两处 SDK 0.203/0.078 秒、board 6.453 秒；UTC 14:24:05 原生 MCP 工具 GET 200、0.547 秒，48 个工具中 speak/speech_status/stop_speaking 均启用。对应 `production/pawapps-recheck-after-recovery.json` 与 `production/character-speech-tools-recheck.json`。未延长 timeout、未改源码、未调模型或实际播放语音；旧 character_speech 错误没有异常类型证据，不能武断说是超时。world_team 清单中的 13 项含合法 withdrawn 1、blocked 7、published 5，旧健康白名单缺 withdrawn，属于现有检查契约问题，本次没有修改检查器。其余失败按各自证据保留判断边界，不统一标为历史失败或借专项复查改绿原报告。 分类详见 `production/FULL-HEALTH-AFTER-CLASSIFICATION.md` 与 `production/full-health-after-classification.json`，分别记录采样窗口、临时读取问题、旧来源不匹配和检查契约差异；当前语音、队伍通信、女仆原生行为未做新的行为验收，不能统称纯历史或全部通过。

## 可提交内容与私有证据

公开提交适合保留本项目自有的布局和保护矩形、模板资源 ID/版本/哈希/尺寸、可重建的原创矿口几何源、有限编译器、静态回归与操作者说明。原生图纸格式和 Numen 接口继续复用现有实现。公开布局须与最终实际方向及地板语义同步，不能继续把历史“老镇保留”总图标成实际交付。

模组建筑本体、提取或民用化处理后的第三方 NBT、JAR、运行存档、实体原始 NBT、库存、命令凭据和私有执行报告不进入公开提交。T&T 现役资源元数据与部分模组资源许可存在限制，因此只记录资源技术事实；本次没有重新分发其派生建筑文件。原创矿口源可以单独整理到 `assets/town-rebuild/mine-entry/`，但提交前应拆开自有几何与本机生产前像，不能直接把整个 runtime 目录加入 Git。

本机证据：`runtime/town-rebuild-20260920/` 下的 `site-audit`、`build-qa-phase1b`、`qa-snapshots`、`archive/qa-migration`、`cleanup`、`exploration`、`mine-entry`；最终组合后像为 `verify-phase10/world-verification.json`，80 原实体为 `release/phase11-identity-verification.json`，五次导航及追加下行为 `qa/nav-recorder/summary.json`、`fresh10-summary.json`。居民建议单独位于 **`runtime/resident-plan/`**。矿口冻结源 manifest 为 `b109a9f9161a222dd31e633b7c17c7ae7aaa103c62f74271c9bd2601995de0ac`，旧壳源 manifest 为 `4538a94722d92cc03e307130d13f890cc8ec18a3fe7aac6942f08e86c6456556`。这些输入与 QA 记录不是生产成功回执。
