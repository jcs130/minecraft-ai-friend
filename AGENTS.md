2026-09-21 11:31 Jev快慢控制已部署：原survivor内异步单槽+持久HTTP连接，目标/作业/身体绑定、5秒过期与最多2次重新观察，未接通原始WASD/任务内抢占。真实容器影子交替各6样本冷连接中位816.55ms→复用278.50ms（约-66%），不是游戏成功率。112具身/34实践生产字节通过，9晋升版本62 fixtures真重测；10profile/16Cron精确恢复，48/3和7/3工具可用，只重启survivor。现指南已官方同步；新补给实践在原生任务观察中，未确认前不得冒称官方执行成功。相关panel通过，全局旧来源/资产不匹配保留。见docs/JEV-FAST-SLOW-CONTROL.md；runtime/jev-fastslow-20260921一次性维护脚本勿重放。

2026-09-21 10:34 起系统1已按用户要求改用TypeSafe官方Jev，默认https://api.typesafe.ai/v1/systemone和jev-latest，实际jev-1.13.0；不再默认本地Decider或自动切回。密钥只从/state/secret/jev-api-key读取，宿主被忽略的server/survival-agent-state/secret目录，禁止写入源码/报告/日志。官方confidence与选中概率不同，分别校验并保留0.75阈值、2秒HTTP超时和5秒新鲜度；只允许固定官方HTTPS接收认证，拒绝跳转/代理，无自动重试。生产103具身/34实践、9晋升版本62fixtures通过。原6合成案例官方选项6/6但最终均回退，不是游戏成功率；真实身体1721字节影子约1224ms、confidence0.79/概率0.86通过，无派发动作。仅survivor重启，10profile/16Cron恢复；共享本地模型与其他服务保持。既有探针从实际容器调用官方GET models，无推理。当前设计见docs/SYSTEM-ONE-OFFICIAL-JEV.md，旧本地记录保留为历史；runtime/system-one-official-20260921一次性脚本勿重放。

2026-09-21 系统1配置/感知优化已部署：原Decider权重固定b37f7e1，修复Hub路径丢失配套配置，现v10/温度1.3并报告revision/configSha；保留B=1图、compile/FP8关闭。compact_state补有限装备/候选物品优先库存/空气/饱和度，未知与截断明确，仍非增量KV。生产99具身/34实践、9晋升版本62fixtures真重测通过；6合成对照前后均4/6，有高置信误选，不称策略收益。真实身体1720字节影子输入低置信正确回退，无新增动作成功证明。仅survivor与原计划任务管理的Decider重启，10profile/16Cron已精确恢复；Windows拒绝修改Decider任务自动重启设置，原设置保持，不能宣称已补齐该守护。初次端口占用与宿主缺依赖测试失败保留。补丁patches/decider，证据runtime/system-one-optimize-20260921勿重放；详见docs/SYSTEM-ONE-NATIVE-CONTINUITY.md。

2026-09-21 系统1已实地取得装备与进食两条成功动作链：prepare_for_task由桐人经原draft/test/promote/start创建，人工诊断反馈后两次同名refinement；Decider92.15/68.76ms，苹果-1、hunger5→9，最终practice ae855857为done且objectiveObserved/evidenceComplete均true。首版invalid_equip与第二版误判replan保留，不伪称完全自主RSI或策略收益；后者源于维护者混淆receipt completed和程序lastExecution succeeded，指南已明确两层状态、完整equip参数和objective AND。既有只读audit新增systemOne严格回执关联，不能用health/影子选择冒充执行。运行证据runtime/system-one-live-20260921不入Git，不重放一次性目标请求。详见docs/SYSTEM-ONE-NATIVE-CONTINUITY.md。

2026-09-21 原生持续运行与系统1首阶段：已修复已知失败永久停机、原生task句柄丢失占道、MCP失效handler刷新不重连，以及Qwen完整健康→survivor启动的互锁。沿用原生tracker/Cron/DriverManager和Docker守护；2.2.1兼容钩子仅同值白名单PUT、固定自有端点、idle且卡片未变时reload，不写Client DTO/凭据。系统1接用户已有Mapika/decider-2b的/v1/systemone，仅已测试程序choose候选，失败回Qwen；真实身体367ms影子推理已验，未证明逐帧WASD/策略收益。97具身、34实践、94控制器、80相关、37管理回归通过（组间有重叠），6旧晋升版本35用例真重测。原10profile/16Cron精确恢复，MC/world未重启；额外control一次重启修启动互锁，原失败回执保留。维护system-one-native-20260921已恢复，勿重放。见docs/SYSTEM-ONE-NATIVE-CONTINUITY.md。

2026-09-21 桐人/结衣持续运行修复：已有 task 的临时 GET 失败在原期限内退避查询，不重投；结衣 9/18 丢失任务经现有 operator-reconciliations 释放通道，原 unknown 记录/身份/会话保留。10 profiles/16 Cron 精确恢复，原禁用班次不改；桐人显式恢复。仅停启 NPC/survivor，首次启动 readiness_timeout 回执保留，后续官方 MCP toggle 重连并恢复原环境凭据引用后健康。不要用 Client DTO 写回覆盖自定义凭据别名。实测公会讨伐 criteria 冒号误写已修复，4 个缺失计数器原生创建、未改玩家分数。84 项生产字节具身冒烟、73 控制器和 9 女仆对账通过；完整 panel-smoke 仍有其他证据失配，勿假称全绿。维护 agent-continuity-20260921 已恢复，勿重放；见 docs/AGENT-CONTINUITY-REPAIR.md。

2026-09-20 23:45 技能部署收尾：NPC重启后的4条原生HTTP连接inactive已通过同值官方API重连（桐人qd_party、两人物maid_native、结衣qd_party），工具3/7/7/3与配置/权限全等；numen_survival原已正常。新维护skill-system-reconnect-20260920已结束，10profiles/16Cron再次精确恢复，无二次服务重启。今后依赖服务恢复后再同步角色技能，并实际读工具清单。

2026-09-20 23:36 技能罗盘与CLI修复已部署：默认我的技能、学习图鉴分离、不可用原生法术禁用、铁魔法三步指引与按需help；目录实服8→35（9秘术/26主题别名，对应21原生法术），不授予装备/重写进度。旧平衡层拒绝原生映射无效调参与非有限数值。botgate8f669d9f，Java285/Node97/独立原生7项/实服只读4项通过；未做真人画面手柄或证明平衡性能收益。10角色两套指引通过官方API同步，原profile/16Cron精确恢复，工程Cron原关闭保持，后续case-ad416b71edb9e6d6d43a要求先补固定技能测试覆盖。新skill_system和主城保护探针通过；旧验收来源失配保留，练习34项Linux重新执行后旧报告归档。13服务/12健康恢复，无新增daemon。维护已结束，勿重放；详见docs/SKILL-SYSTEM-REVIEW.md。

2026-09-20 23:02 主城悬空残块已实服清理：正式存档扫描后清除1,245格残块，两盏新路灯从(-726,66,898)→(-726,64,898)、(-562,68,880)→(-562,68,883)落地。1,256坐标保存后严格验收通过，城区/矿道周边低空孤立组53→0，144组斜角连接结构及5,051格完整空岛保留。初次post=0仅两节栅栏南向连接派生状态，原attempt=1/post=0及失败回执保留；未重投，独立只读验收verified=1。53临时forceload全释放，正式前/中/后备份save-on确认，保护4项健康通过。未改实体/物品/角色/调度、未停服。勿清锁重跑；旧重建50,034格及保留体积报告属于此前阶段。本轮西岸设施区仅清41格孤立树冠，不触及功能块。详见docs/TOWN-FLOATING-CLEANUP.md。

2026-09-20 22:16 原址扩建与主城保护已部署：25处建筑、44床、8街区、道路/河桥/池塘/矿口建成，正式存档50,034目标格无未解释差异；原80实体（33村民、6铁傀儡等）同UUID回迁，30原资产完整NBT迁入可达档案库。主世界X[-715,-375]/Z[695,1035]全高保护已启用：普通拆建、爆炸、火焰、流体和活塞破坏受限，门/仓储/交易及成熟农作物收获补种保留，管理员原有维护命令仍有权限。既有bridge361636f6与Numen楼梯修复5e913b2f已精确部署，152离线/26隔离原生保护验收与生产4项探针通过；不把副本试验冒充真人客户端实测。桐人/女神原UUID、完整背包、XP及能力保留，公共返还点(-554.5,64,866.5)，个人传送点保持；原10角色16Cron恢复，原禁用任务保持禁用。223施工forceload已逐个释放，临时平台撤除，正式备份与单次命令回执保留，勿重跑施工或恢复身体。全局历史验收失败不重写。详见docs/TOWN-EXPANSION-DESIGN.md、docs/TOWN-PROTECTION.md。

2026-09-20 主村木石城镇改造已部署并保存：一处集市、四栋五床住宅、196列连接路、29盏建筑/路灯与15格河岸木桥，原33村民/4傀儡身份及既有设施保留。复用原生结构与现役Numen图纸能力，无新建造引擎/Agent守护进程；主城Agent施工权限不扩大。完整前像、实体占位和原生模板加载范围保护，生产等村民自行离开后单次施工，勿清锁重投。施工包与图纸在assets/town-renewal；记录见docs/TOWN-RENEWAL.md。Guard Villagers仅在独立副本实战与重启测试，已修装备读取耐久丢失（22项通过，6→6），源码补丁在patches/guardvillagers，未安装生产/客户端；不可转换公会六居民或宣称社会经济/RSI已跑通。

2026-09-20 16:43备份补充：原D:/ops/world-backup.ps1同时指向旧世界、旧25575端口与旧凭据，已用纳管tools/world-backup.ps1替换现役入口；原文件前像保留。新入口复用当前RconClient、唯一目录、明确退出码、确认拥有save-off后finally save-on，无历史删除/静默离线拷贝。7离线分支/只读检查通过，已实际生成2026-09-20T084316.4728094Z-35679c65完整新快照，save-on确认、robocopy=1。计划任务定义读取被Windows拒绝，未改调度且不宣称自动调度已验证。详见docs/VILLAGE-RECOVERY.md。

2026-09-20 主村庄已实际恢复：全维度70实体region核对33具名原UUID，保留3存活并恢复30缺失、救回4只原地下铁傀儡，无随机身份补生。30恢复交易/物品/职业已读回、33村民原生AI及保护验证，MC已save-all flush；来源备份实为9/7（5公会角色交易取9/8），不是死亡前最新状态。InControl主村XZ不变，Y扩至-64..320，position/finalize/onjoin三入口已实服重载；清理40精确现存残留，四高度加入测试无目标实体，13类常见敌对复查未检出。绑定NPC双入口禁止旧随机UUID补生，启动沿既有流程补保护；spawn_missing=false保持。NPC仅单次stop/start，原准入/桐人/三角色Cron已恢复；24回归、NPC/路由/相关panel通过，13历史全局red保留。勿重跑恢复/维护或旧backup脚本，详见docs/VILLAGE-RECOVERY.md及runtime/village-recovery-20260920。

# 千灯纪整合项目

2026-09-20 最后接线补充：read-model已接通原NPC轮询/公会身份子健康字段，既有team_context不再只看笼统unhealthy；19跨语言Python/25Node核心通过，浏览器环境限制如实保留。15:56:54女神/命令/语音空闲复核后仅world普通重启一次，15:57:42启动、15:58:51真实公开快照→生产原helper通过，guild_lan在线/hesu未定位/整体false均保留，不改健康绿灯。错误guild-claim-precision已15:55:55精确撤回共享索引，6→5且其余条目不变，旧正文/草稿/反馈保留，未发现其他角色安装。首批59a7b3f已推main，最后接线另提交；勿把接线和维护纠错当自主RSI成功。详见docs/GUILD-FEEDBACK-REPAIR.md及runtime/guild-feedback-20260920/npc-health-projection。

2026-09-20 同轮15:49补充：当前L2技能qd-learned-guild-claim-precision把未验证的“先右键柜台”写成领取前置，服务端无此条件，上版也同错；已在角色idle时通过原LearningTools锁/官方SkillService/索引保存/reload精确停用该revision并标reviewPending，未rollback、未伪造失败凑阈值。仅追加1条unverified事实反馈；49份技能/草稿/验证/激活文件、failures0、previous、revision、action-precheck、profile/Cron均保持。生产角色学习校验通过（learned2/enabled1）。这属于维护纠正错误规则，不是已证明自主RSI；“NPC unhealthy导致所有领取失败”的模型推断仍须在真实行动中检验，不能改整体告警凑绿。证据runtime/guild-feedback-20260920/guild-skill-review。

2026-09-20 用户要求直接修复、实际部署并提交main。公会拒绝现附实时接待员位置/同维度距离，精简回执保留quest_id及claimContext；实机只读确认接待员离旧柜台44.828格、原领取门槛8格。保护区预检补准确边界与未派发说明，不放宽权限。原生修复9角色学习Cron旧模板、关闭桐人2旧epoch失效技能绑定（54文件保持）；校验允许明确禁用历史项，当前L2索引校验仍严格。补收现役standing-task守卫/学习预算分类入库，并加固所有权未知不stop与空闲清理。维护guild-feedback-20260920于15:36:08结束：原NPC重启1次、survivor2次，Qwen/MC/宿主未重启，10profiles/16Cron恢复全等、原工程Cron仍关闭。生产77具身/34实践smoke及源hash通过，111网关回归、19预算、22学习、16角色契约通过；Qwen完整健康/路由/PawApp/具身实践探针通过，旧全局red保留。15:40原生复盘与后续行动两真实轮终态；review/action分session正常，行动brief+增量3822bytes，但模型仅观察和记忆，仍误把NPC聚合unhealthy当领取原因，没有新goto/guild_claim，不能宣称已验证纠正导航或RSI收益。勿重跑维护或旧记忆归档。详见docs/GUILD-FEEDBACK-REPAIR.md与本机runtime/guild-feedback-20260920。

2026-09-20 PawApp 已按官方 QwenPaw2.2.1 SDK/原生安装上线：evolution-board 与 gods-eye v1.1.0 在应用中心可实际打开，前者官方作用域只读GET投影现役10角色/当前memoryEpoch动作分类、拒绝未知和小时趋势，后者真实村庄canvas已验。页面60秒读取，既有行为统计300秒生成/360秒新鲜度边界，不把动作确认率当目标或RSI成功率。旧14目录混角色、旧代混分母及旧48.2%不可与新66.7%比较。64相关测试、生产真实20具身/34实践smoke通过，PawApp panel项通过，旧全局健康失败保留。实地13:00–14:39观测13轮12正常完成1因turn-actions瞬时ENOENT自动暂停，brief已真实3次；新增只读50/100/200ms有限重试，持续缺失仍失败、不重投。仅原游戏Qwen/survivor各重启一次，15:02:21维护结束，10profiles/16Cron全等、原工程Cron关闭保持；勿重跑本轮pause/安装/旧记忆归档。恢复原session task-aee503afbcba于15:06:24真实completed，15:06:29控制器结案，2导航确认+2公会拒绝，另1交互保护区拒绝；有限窗口无ENOENT再发，仍未证明RSI收益，跨轮重复公会失败仍是问题。详见docs/PAWAPPS-OBSERVATION.md及忽略目录runtime/pawapp-observation-20260920。

2026-09-20 RSI 第一阶段已部署：L1 status可选brief（默认full）、按需读取、policy_draft证据持久化及提交失败诊断已上线；20具身/34实践smoke与实际源hash一致，相关探针通过。40条历史输出投影字节-34.35%，实时只读full9121/brief6211；13:00–14:02:49九个已完成回合共43次工具调用，八次status均未选brief（采用0），增量正常；模型轮次完成不等于游戏目标成功，不能称已实际节省token/时延或提高成功率。原工程工作区已升级base67283d9/迁移HEADb4b9a04，双亲保留旧36de676，原11dirty及42unknown保留；331团队/456组合固定测试、24恢复工具回归通过。维护已结束，勿重跑旧归档/升级/锁恢复或自动开启原qd-team-engineer Cron。十角色profile保持；13:04十六Cron相同，13:22桐人原学习工具重复enable刷新自己旧模板，其余十五条未变。原生工单case-a7b7f2916f0992c04101的_pending_publications候选已完成修订，test-03绑定源9f15483c…74c47，482测试通过且容器已删；commit-02在read-tree失败（EngineeringGitError/128），原unknown保留。现场空index.lock隔离复现只解释此次失败，不归因旧42条unknown；无主锁已受控归档，工程角色profile/Cron精确恢复。新事务commit-03成功提交81c41e95（父b4b9a04），task-bbb8d3c78dbe completed，工单v10 needs_review；工程HEAD与回执一致、工作树干净。12个提交路径包含原11dirty保留内容及1个新测试，不能全算本轮新创；候选pushed=false、未部署，旧42条及本轮commit-02 unknown原字节保持。最终交付以docs/RSI-AGENT-DESIGN.md最新记录为准。L3独立世界A/B与保留场景尚未验证，旧全局健康问题不冒充已修复。

2026-09-20 RSI 研究附带最小源码修复：policy_draft 沿用 TeamStore case 去重，持久保留有界校验回执/原 changes/因果未验证标记；请求标识绑定提交内容，同样重试幂等，新证据追加同案。新增5回归通过；Linux learning 唯一旧账本测试失败已用 b1db1ce 基线复现，TeamStore10通过；未部署到运行服务。此修复仅补证据链，不代表完成 L3。

2026-09-20 最新 RSI 方向：采用 L1 感知/决策/行动/反馈/短反思，L2 有条件的经验/规则/可执行技能，L3 跨任务证据驱动的模块化 harness 演化。ModularRSI 五模块是 L3 的修改面，不新增五套 Agent；复用 QwenPaw 原工单、司灯/女神与 qd-engineer。只读核查时工程师角色/工具启用但 qd-team-engineer Cron 关闭，独立源码 base600ffa3/HEAD36de676 缺当前具身模块，固定计划不覆盖 world/survival；不能称 L3 已自主运行或重跑旧初始化器。Plan4MC 借技能条件/效果与执行后重规划；MineDojo/MCEnv 基于1.11.2，作为另一研究环境，不能替代本服1.21.1独立存档验收；MineCLIP 是视觉表征/相关信号，现语义俯视图不是第一视角视频，相关分数不等于完成。详见 docs/RSI-AGENT-DESIGN.md 与 docs/OPEN-SOURCE-AGENT-CODE-STUDY.md。旧归档无需重做，本次研究不启用工程班次或自动晋升。

2026-09-20 具身重构已按用户要求部署，覆盖下文“本次方向没有部署新接口”：桐人 brainProtocol=1/contextProtocol=2，旧经验、会话、Scroll/ReMe 索引已完整校验归档到 Qwen 检索目录之外，新 memoryEpoch 隔离默认工作记忆。身份、人设、模型、身体、物资、用量和原始回执保留。原控制器承担感知/程序/认知/只读交流，不新建 daemon；sense 共用原 WorldAdapter/Numen，接通已有菜单和机器 capability 读取，未改 Java。旧强制草稿配额/停滞提示不进入具身路径；RSI 仍须真实对照和独立场景证明。107 相关测试、13 具身 smoke、34 实践 smoke 通过，新代首轮已真实终态并写入经验；维护结束，勿重跑归档或旧维护脚本。原 mc-god Cron 提示词与健康模板不一致及其他历史 panel 失败保留，不能宣称全项目全绿。详见 docs/EMBODIED-AGENT.md。

2026-09-20 用户确认项目核心目标是落地 RSI：Agent 应能从真实执行经验中自主创造、测试、修订和继承技能，并逐步改进感知、工具、上下文与执行策略。后续架构以扩大可组合的游戏内能力、可归因的效果提升为准；不能把“复用现有系统”解释为永久锁死现有高层动作白名单，也不能用不断新增硬编码玩法替代 Agent 学习。原生控制应先盘点并接通 Numen 已有交互/输入能力，保留高层工具供选择，按需补齐稳定的控制原语；高频输入由本地执行层处理，模型负责生成/修订程序和关键决策。身体所有权、物理规则、终态回执与独立验收仍须有效。仅增加技能数量或开放接口不代表 RSI 已完成；候选改进须有基线对照、未参与改进的场景验证及可回退版本。具体缺口和建议见 docs/RSI-AGENT-DESIGN.md 顶部补充及 docs/PREIMPLEMENTATION-REUSE-AUDIT.md。本次方向记录没有部署新接口。

2026-09-15 儿童陪伴模式（阶段1，仅离线验证）：新增"儿童模式"让白名单小朋友（当前 `MengMeng`/萌萌，6岁）直接对麦克风说话，灯语女神用适龄温暖语音回应、陪聊、陪玩文字小游戏，并可要东西入包。复用现有 mc-herald 语音管道（voice-command-inbox→spoken-intent→goddessChat→speakViaGodVoice），不新建角色、不碰施法/馈赠服务端规则、不动结衣/自主/工程Cron。新增 `world/src/gameplay/child-companion.ts`（resolveChildCompanion/buildGoddessChatPrompt/sanitizeChildReply 纯函数）；`mc-god.ts` 的 Config 加可选 childCompanion，goddessChat 走儿童人设并对儿童回复过兜底网，语音 conversation 对儿童免 vipChatGate 点名准入并按 allowGifts（默认true）开启馈赠（物品仍受原 give 白名单+冷却约束），成人语音路径行为不变。`bootstrap-world.mts` 读 `CHILD_COMPANION_FILE`，缺失/损坏按关闭处理。新增 `config/child-companion.json` 与 compose 世界服务 env+只读挂载。家长可改 json 控制开关/称呼/是否给东西，不用动代码。触发方式由玩家在 SVC 客户端设置自选（PTT 或语音激活），项目不硬改 voicechat-client.properties；陪伴聊天不需举杖。隐私：录音→ASR 本机，但儿童对话转写仍走云端 CodingPlan 模型。离线证据：新增 tests-ai/child-companion.test.mjs 7/7、相关回归 39/39、tsc gameplay 0 错；全仓 tsc 152 错为既有基线、落点不在本次改动行。**未做**真人麦克风/SVC 实采/云端模型对儿童人设实际输出质量/游戏内真实 give 入包的任何实测；主动搭话（进服+安静后）与事件触发/导航为阶段3/4，未实现。部署需 `docker compose up -d world` 重建容器以加载新挂载与 env，本次未重启任何服务。设计与验收边界见 docs/CHILD-COMPANION.md。

2026-09-14 多模态与限流修复覆盖下文22:40状态：原survivor现为autonomy23（54eaa98a…74e0dd），game Qwen仍2.2.1原进程、主服/宿主未重启。原生明确usage allocated quota exceeded按阿里官方FAQ是短时请求/Token峰值限流，不能判成套餐耗尽；原封装MODEL_QUOTA_EXCEEDED本身不够。现原controller仅对已确认的usage/concurrency失败持久退避60→3600秒后同session新轮，成功清除，人工暂停/未知动作不越过。已解除经核实的两旧失败停机，23:22与23:23两原生活轮真实完成，导航/农耕/面包合成有回执。

view_scene已原生MCP上线：本人Numen局部语义网格→Pillow PNG→Qwen原生图片输入，4–12格按需取图，非FOV110第一视角/贴图/实体渲染。不新增daemon/模型直连，QPM0/迭代关闭/原角色模型、人设、两session和16原Cron保持。首次只读模型测试暴露legacy /mcp/tools只更新发现名单、未增加policy；已用原生/mcp/policy/numen_survival只增加view_scene允许规则（默认拒绝、原45规则保持），现役handler同步更新，无Qwen重启。新健康检查按源码46工具验证native card及policy，不再拿两份旧45清单相互证明。工具tools/configure_survivor_vision.py默认preview，应用需原idle维护边界。

task-61cb28994743在原life-e522…会话真实调用一次view_scene成功，PNG20,036字节，模型正确辨认东/西/南/北四邻格均flat；未执行身体/文件工具。此前失败task-8978fc95e9c0原样保留，不改成功。只读测试后原loop和两Cron已恢复；30检查全过、13服务/12健康、96技能绑定保留。相关panel探针通过，旧全项目历史仍非全绿。游戏RCON msg仅有送达回执，未在当前模型感知中找到该测试标记，不能宣称任意私聊已接通。详见docs/SURVIVOR-MULTIMODAL-RECOVERY.md及runtime/agent-vision-20260914；维护已结束，勿重跑旧pause/模型测试。

22:40历史：桐人原task-9a2ac3024dff及task-4899179f7e3f连续被qwen3.5-plus短时限流拒绝；原转储明确openai.RateLimitError HTTP429 throttling / usage allocated quota exceeded，不能套用下文21:13本地AcquireTimeout结论。任务891f33ca98b6已制作装备铁剑的实际成果保留，后两失败轮无动作。旧controller随后因两次失败暂停；其后恢复与分类更正见上文。

2026-09-14 22:37 自主规划覆盖下文旧survivor镜像/临时农耕使命：已部署autonomy22，game Qwen仍2.2.1-memory1，只排空桐人2原Cron与survivor后重建并恢复；13服务运行、12健康，16原Cron启用。config/survival-agent.json保存人格/经历驱动的长期使命，经原submit_goal应用到当前身体；旧农耕调试不再是使命。规划用原生memory/goals.md和现有qd-survivor-practice的2按需参考页，不加调度器或固定任务轮换。检索subject从真实remember.history[-1].turnId关联原decision.startedAt，旧轮迟到记忆不能抢新使命。原模型、人设、body、life session、QPM0与迭代关闭保留。task-891f33ca98b6在原会话自主选基础装备阶段，22:36:51已实际导航/合成/装备铁剑，不只写计划；未称据点探索或全部玩法完成。129相关测试+34实践+19收件箱、30部署检查通过，相关panel探针green，旧全项目历史smoke仍非全绿。详见docs/SURVIVOR-SELF-DIRECTED-PLANNING.md；runtime/self-directed-adventure-20260914已完成维护，勿重跑旧pause/goal脚本。

2026-09-14 21:55 原生能力实施覆盖下文旧native上下文：游戏Qwen2.2.1-memory1、survivor aut21镜像保持，已排空原16Cron/NPC准入与两生活/记忆任务、备份7604文件后重启原npc/qwenpaw/survivor并恢复。Minecraft/宿主Qwen未重启。两角色light_context.strategy=scroll、history_retention_days=0，原tool offload_retention_days=30保留（原生API只准1..365，曾422明确拒绝0，读回未变后才修正重提）。官方startup按chats回填桐人53session338行、结衣1session89行，原session/chats逐字保留；实际原生活session已构建Scroll并只注册structured recall_history，无Python工具，无新daemon。配置工具tools/configure_life_context.py默认preview；勿重跑旧初始化器或用旧session覆盖新Scroll经历。

ReMe证据VERSION2已加载，skill_read.practice同演员/版本/绑定验证进入原AutoMemory/Dream，programReportedDone、objectiveObserved、身体动作和掌握分开；stepCount不是观察次数，false/null不改成功。72324f4农耕原run确证done/目标false/身体动作0/熟练度false；两工作区notes+当天memory+结衣旧digest9文件经nativeETag追加纠正和原生能力渐进入口，旧来源保留。运营工单与lead spawn白名单已按实际版本复用MakeSkill2.0四脚本，原guard仍限本角色路径/命令/完整包hash，未扩大人格权限或直接人物私聊。10原角色96技能绑定、16原Cron、模型/persona/body/session不变，QPM0与迭代关闭保留。针对性同版隔离测试与实时Qwen健康通过，旧宽泛健康fixture/全项目历史smoke仍非全绿；不改历史hash冒充验收。详见docs/QWENPAW-NATIVE-LIFE.md，本机证据runtime/native-capabilities-20260914，配置前原档runtime/life-context-configuration/20260914T135202581114Z。

2026-09-14 21:25 自主吞吐更新覆盖下文旧周期/镜像：survivor最终为 `qiandengji-survivor:2.2.0-autonomy21`，QwenPaw仍游戏2.2.1-memory1，已重启加载原生收尾 VERSION4；NPC重载，Minecraft和其余服务未重启，宿主Qwen未改。原16Cron/NPC准入/自主已恢复，10角色名称模型、2原session不变，13服务运行/12有探针服务健康。桐人/结衣人工每日预算null、模型QPM0、iteration.disabled本就无上限，继续身体串行、未知不重放，旧max_iters12不是有效限制。本地LLM并发1实际按provider:model共享（不是身体单飞锁），本轮没有改大该容量。结衣原life Cron改每3分钟（不是新增），新slotSeconds180兼容旧600信号/在途任务，忙时只取最新。详见docs/AUTONOMY-THROUGHPUT.md。

skill_start可传模型summary，只有实际skill_queued且原name/version/turnId及总结一致才原生结束，不额外模型收尾；旧remember路径保留。实际工具schema及原角色两页SKILL已同步，内核文件未动。58原生接口/收尾/缓存测试、34新镜像实践测试、19收件箱测试通过，原报告归档后真实重跑；最终30只读部署检查全过。本次game_qwenpaw、survival_practice、maid_perception探针通过，全项目历史证据仍非全绿，不得修改旧hash假通过。结衣party_send的换行错误已明确field/reason及未入队/未发送，不代改文本或重发。

21:13 task-d7273f4104e3 的MODEL_QUOTA_EXCEEDED实为本地_AcquireTimeoutError，供应商调用前30秒等槽超时，无真实429/额度耗尽证据，21:15下一轮自然成功。21:24用tools/configure_survivor_queue_wait.py --apply仅把桐人原生running.llm_acquire_timeout30→120，原生GET全profile只变该字段，Yui300保持；相关8项Windows/同版隔离测试通过。最后只排空survivor与其2原Cron，部署aut21同步离线初始化120默认，随后恢复，勿重跑旧初始化器。新版Qwen健康检查等待>=120，profile备份/回执在runtime/survivor-queue-wait/20260914T132430240013Z。

桐人首个farm程序已实际跑29观察/0身体步后维护停止，不能说完全没运行或成功；原因是读取memory.obsResult而真实入口state.execution.observation.result。21:08恢复后已自行直接harvest/replant，再用summary排队旧程序；已通过原目标队列给出准确实践反馈，让其自行修订而非代写技能。结衣仍为原生动作+ReMe/Markdown学习，尚未接同等QuickJS实践账本。缓存当日结衣记录约64%，桐人记录0但适配器缺字段也会记0，不可断言供应商零命中或把缓存比等同套餐费用节省。

2026-09-14 持续实践已部署：survivor 更新为 `qiandengji-survivor:2.2.0-autonomy19`，原任务自然排空、1,067文件备份后仅换该容器，原身体/生活session/聊天保留；QwenPaw仍游戏18089的2.2.1，Minecraft/NPC/Qwen及宿主8088未重启。`skill_start`可附固定objective，`skill_draft`可附refinement关联真实原run_ids；同一原控制器把步骤/回执/首次终态观察持久写入practice.sqlite3，补采失败暂缓下一模型、只读原动作不重放。旧skill_library内核未改，旧晋升版本仍有效，旧已完成运行不补造实践。program done、客观观察、动作确认与掌握分开，masteryVerified始终false。34独立实践测试、237相关回归通过；新运行和panel探针通过，全项目历史smoke仍有旧证据漂移，不以改旧hash凑绿。详见docs/SURVIVOR-CONTINUAL-PRACTICE.md。

桐人实践正文/渐进参考页已通过原生API部署并扫描启用；共享qd-skill-evolution官方写文件/MakeSkill2.0说明同步全部10原角色，按各自自然idle更新，模型/人设/原enable/16Cron均保留。完整Qwen检查确认10角色96绑定与unrestricted策略。新增学习里程碑通过原目标队列进入原会话，角色自行选择当前生存工作中的可复用程序练习，不另起Prime daemon或反思模型；实际完成与改进仍须用具体生产run和回执验收。

20:45原task-2be59ef73469已自主读指南、draft/test修复expectedMemory、6/6通过并晋升farm_harvest_replant版本2ad6b78f…965f0f。未代写其程序；原输出/源码测试与独立副本一致。角色当时等作物成熟、计划下一正常轮start，practice台账仍0，不能称收割重种或长时间自主进化已实测。此前invalid_fixture来自旧额外字段description/expectedDone/expectedMemoryStep，已由模型按新合法例修正。结衣旧Python报告仅health_mon哈希因本次接线漂移，已备份后真实19用例重跑发布，未手改旧hash。

2026-09-14 19:32 当前覆盖下文“结衣busy尚未排队”：正常TLM结衣输入已接入持久私有感知收件箱，Java仅最后user+HMAC→七字段202收件→原PartyLife十分钟signal/原session精确批次消费。新输入不POST模型、不立即唤醒、不复制全部历史；speaker无法从TLM callback证明，不能冒认主人说话或把私有原文转party公开广播。普通其他人物及设定/摘要callback保留同步；不宣称真人已收到延迟逐条回答。新JSON转义长度/只读SQLite快照/精确ID消费/失败未知不自动重放已覆盖，详见docs/YUI-DIALOGUE-INBOX.md。

现役maid bridge为b4b94edb…d0e7e，MC/NPC正常退出0、21,242文件2,425,392,752字节备份后部署到server/client/cache/X盘，Qwen仍原18:31的2.2.1进程与模型。原16Cron/准入/自主19:26:56恢复，19:27桐人task-5c1d5c714608与结衣task-04fcb73faa1b启动；19:32结衣已完成原生活轮，桐人已接续task-777601769e41。13正式服务已恢复正常，网页观察者靠原退避重连恢复；不再暂停或重复resume。新收件probe独立要求生产契约+19新Python用例+19真实隔离Java行为及安装源码一致，原桥20实机回归/211Java断言另验，旧QA失败与旧smoke原字节保留，不能改历史hash凑绿；全项目其他历史证明过期不在本次收件修复中被宣称解决。

2026-09-14 18:39 最新运行：游戏18089已升级QwenPaw2.2.1/ReMe0.4.1.11，正式image为qiandengji-qwenpaw-game:2.2.1-memory1（41ddc296…408c4）；宿主8088、Minecraft、survivor aut18未随包升级重启。原10角色/96技能绑定/16Cron、即时模型、人设、会话记忆全部保留，18:33已恢复自主。官方MakeSkill2.0完整脚本及公共技能池已更新；基础工具6项，旧materialize_skill已移除，勿恢复旧工具凑计数。原生ReMe统计修复已采用，生活真实回执扩展继续保留，AutoMemory5外部回合/小时Dream/native上下文参数原样，Scroll/AutoFin/第三方插件未启用。升级及复用研究见docs/QWENPAW-221-UPGRADE.md与docs/QWENPAW-CAPABILITY-REUSE.md，旧初始化器不可重跑。

本次先排空原生任务和18点Dream，Qwen/NPC正常退出0，5910文件335MB逐字节备份；最小迁移先副本后正式，工具SHA23e9f83d…b7dd，仅130预期工作文件变化，其他4637原字节不动；幂等再执行4767工作文件全等。维护已结束，不要再次暂停/重放；NPC新增operator admission需相同维护ID恢复，stop_signal=SIGINT。结衣task-256878865747执行后未被NPC收取终态，新进程404/idle0/NPC停机核验后仅独立released_without_result证明，原结果未核实、原记录/预算/session不改。今后停Qwen前须收取所有active-roles指向的原任务终态，不能只看native active=0。

新版首轮实机：桐人task-3cb90737680e在原life-e522…会话自主进食、4次导航、remember，18:38:18控制器确认completed/nativeTaskCompleted，18:38:33自然进入task-96294f6eb6f9。结衣同原session已有两轮完成，第三轮继续；各自并发1，未发现升级阻断。101次原生健康GET/10角色/96绑定通过，13服务运行正常；全项目旧architecture/skillbar等历史验收仍有来源过期，不能改旧hash凑绿或把这次升级说成全部游戏玩法验收完成。

2026-09-14 17:42 最终实机：结衣新signed输入task-b0f72dabda12已在原session真实completed，旧占位修复已线上覆盖；游戏callback无独立持久回执，不能称本条已heard。17:37:30另一个新输入被正在运行的party-life正常busy拒绝，未入模型；旧错误未复发，忙时排队尚未实现，不能将笼统桥接日志当成同一请求。17:41:53桐人已自动接续task-e10b556f9053、无新unknown，13服务健康、16原Cron/模型保留，自主保持enabled。不要重新暂停或重投旧请求；最终证据见下述文档。

2026-09-14 17:37 最新恢复：17:22仅为结衣对话适配维护暂停原16Cron，原桐人回合17:26:48自然drain、天神长任务自然结束后，仅NPC17:34:20重载（主服/Qwen/survivor不再重启）。MaidAdapter现接受QwenTasks对原9/9占位严格核验的released_without_result，只供不同新输入；旧task-d0d283af1f8b保持poll_unavailable、不重投、不改成功。94相关测试过；1042文件/1043047字节NPC状态备份，原maid与两party持久MCP session重载后3次只读tools/list全200，身份/请求/证明原字节保留。17:36:11恢复原16Cron和自主控制，17:37确认13服务健康、16班次完整spec及10角色即时模型/名称相同；桐人task-71dbd4226e58和结衣原会话新任务自然开始、无unknown。之前aut18两轮已自然完成并确认7导航成功/2进食和真实游戏heard回复，结衣主动工作/装备建造与模型总结准确性不能因此称全部完成。当前继续运行，不要按下文旧维护状态再次resume/重放；完整证据见docs/AUTONOMY-PROGRESS-REPAIR.md。

2026-09-14 17:10 最新覆盖下文aut17暂停状态：MC现役botgate为6ca6c1ed…15022a，修复多个RCON客户端共享控制台缓冲区竞争，完整原生命令私有锁串行，无新代理/客户端变更；旧版真实96请求11串线，新版96/96，227 Java断言、6健康回归与正式主服17:08协议12/12、健康5/5通过。survivor为2.2.0-autonomy18（70e2ee83…f3ef），Qwen仍autonomy16但本次停服后重启。16:32原goto未知已16:58人工按原身体/t554到达/原Qwen终态审核，仅关闭旧lease及活动阻断；原未知/无ACK/effectAttributionVerified=false全部保留，不可改成功或重放。新网关保存后续实际私有回执，种植预检返回原请求空气格/支撑格，不改坐标；152生存回归过。完整停服备份36193文件/3054644179字节SHA核验，原16Cron、模型与自主控制17:10:37恢复。world_team_health现役10与历史4分开，旧18090不查；当前批准工程计划原生runner新baseline current-plan-01已145测试通过/容器删除，显式迁移health且旧证据不覆盖，候选业务未部署。最终aut18实机窗口须看docs/AUTONOMY-PROGRESS-REPAIR.md后续证据，不借旧aut16两轮当证明；不得称装备/住房/结衣农耕闭环全部已完成。

2026-09-14 16:27 最终提示增量：survivor为2.2.0-autonomy17（3ae13724…9ff15），Qwen保持autonomy16原进程。aut16首轮真实remember成功后47.806ms将模型自己的summary流式保存，无后续模型思考；第二轮真实4导航/2进食，但6次漏summary被拒，已将错误回执改为字段原因及未保存/未结束，不自动编摘要、不补ID、不续租；57次相关回归过，survivor原轮自然drain/完整备份后单独重启，原班次未停。原生压缩真实提前flush3旧+1新回合，64调用精确配对16动作观察（10成功，失败/拒绝/在途不计功），新日记正确记录吃饭/导航及失败放置，仍有旧推断不能称知识全正确。aut17新窗口必须另验，不把aut16或旧报告换hash当新窗口；结衣工作产出与装备建造仍未获实机证明。详见docs/AUTONOMY-PROGRESS-REPAIR.md。

2026-09-14 16:15 当前覆盖旧版本：游戏 Qwen 与 survivor 均已部署 2.2.0-autonomy16，主服和宿主8088未重启。277次生活/原生回复/请求上下文/伙伴/记忆回归、81次工程回归、11次Windows共享锁与3项独立原生组合检查通过。finish v3须绑定官方_request_context的外部life会话/qd-survivor/console/survival-controller，内部AgentState.session_id是随机ID，不能改名或据此判生活身份；request v1保留本次调度引用应对压缩，不查状态补ID、不改参数、不续期/重发。真实自动学习使用memory evidence v1，但Dream仍有旧资料过度泛化，不能称学习质量全修。司灯今日日报已15:58真实补出并请求次日公会，刚完成ledger现按完成时间保留；女神16:01巡查与天神16:05原轮真实成功，天神393秒自然收尾后才做第二维护。工程A2A无总截止/单并发已部署，未有新生产长A2A验收。原16Cron、模型、UUID、背包、会话/原生3/5学习计数保留并16:15:44恢复。最终窗口不能借用aut15的旧finish成功替代v3省模型调用证明，伙伴资料入上下文不等于自主耕作/打造装备已完成。详见docs/AUTONOMY-PROGRESS-REPAIR.md，原始证据与两次逐字节备份在runtime/autonomy-repair-20260914/，历史来源hash不改写。

2026-09-14 13:15 最终实测补充：autonomy14原会话两轮正常（无Doom/lease_invalid），正确remember一次；新错误说明分支本窗未触发。桐人自主采收成熟小麦，补种首次top_face_unreachable后自行move再补种成功，同株age5→6→7、采收air、重种0→1。桐人背包未增小麦，但结衣前后种子3→5、小麦0→1，确认团队资源回收（未采集具体掉落实体UUID）。新life/party smoke均通过，旧报告原字节归档后发布，party健康22/22。仍不能称结衣自主farm/武装建造全部完成。日报补跑提交前遇13:15天神正常占位，原预算检查实际全局串行，POST0；不以取消天神任务解锁，也不伪称今日日报已补。此全局准入是另一个明确待修问题。见docs/AUTONOMOUS-SURVIVAL-ROLLOUT.md。

2026-09-14 13:07 最终增量覆盖下条autonomy13版本：survivor现为2.2.0-autonomy14（2a8409a4…276819），Qwen仍autonomy11。延长观察aut13四轮为3正常/1错误编号反复remember触发Doom，随后自然恢复；mainInventory已在真实原生用户输入落盘确认。aut14仅补租约失败的静态恢复说明，未执行/未写入仅在预检成立，不返回正确ID、不补ID、不放宽、不暴露status租约；63回归通过，原会话与MC/Qwen未重启。结衣原功能实机20/20与健康10/10另验通过，原26项world-tick/drop记录仍保留。完整健康旧审计32/37通过，司灯今日日报09:10实际被operations_task_unresolved跳过且modelCalls0，尚未补跑；其余历史来源证明不能改hash凑绿。正常无武器退避不是传送/永久死锁，仍缺正式attack租约入口与Enemy分类修正；不得宣称装备/建造/耕作自主闭环全完成。见docs/AUTONOMOUS-SURVIVAL-ROLLOUT.md的最新实际窗口。

2026-09-14 12:51 自主生存增量已上线：survivor为2.2.0-autonomy13（49b46d19…86173），游戏Qwen为autonomy11，宿主8088未改。天神原qd-team-engineer取消总截止，原GLM-5.3/会话/单并发保留；12:15原轮453.62秒正常完成，12:25另起新轮，提交/测试仍因候选源码变化与计划覆盖被拒，不能称工程部署完成。Numen与结衣精确身份周围3×3区块原生force/entity ticking，v3组合实机26/26过；旧v1/v2源码归档并精确可重建。新增drop_items第45工具及组件完整/未知不重发回执，原生scope已同步；task_catalog支持分页搜索farm，10角色96技能绑定。修复重复remember的幂等/收尾、实际life_context漏主包槽位/精确turn_id说明、survivor长RCON回执截断。12:35后两原会话轮正常结束无Doom，真实10导航+1进食，第二轮正确租约记忆保存一次；结衣真实游戏heard交流，尚无自主耕作/丢物/建造证据。最后12:51只重启survivor补实际输入与RCON，MC/Qwen没重启，原UUID/session/模型/背包保留，后续须用新的观察窗口验收；不要拿前两轮替代最终增量证明。源码与新证据见docs/AUTONOMOUS-SURVIVAL-ROLLOUT.md，旧报告原字节保留，不改hash凑绿。

2026-09-14 11:21 思考配置核实：游戏Qwen的天神qd-engineer确为智谱Coding Plan/glm-5.3。官方5.3始终思考、默认max且不支持disabled；角色thinking_level=off因当前用户追加模型缺少映射没有进入SDK请求，不能当作关闭思考。禁网原生factory/SDK拦截确认未发thinking/reasoning_effort，合成reasoning_content会被正常接收并续流超时。11:05、11:15自然轮实际均到360秒总截止且有推理/工具活动；10:55的约202秒/30秒idle是另一类故障，未证明由思考导致。本次只读，无生产修改/模型调用/重启；详见docs/AUTONOMY-OPTIMIZATION.md新增核实段。

2026-09-14 11:10 优化已部署：默认13个Compose服务运行，survivor为2.2.0-autonomy9（7eb8e44f…29b4b），游戏Qwen仍autonomy3并已重载ops，原16项Cron恢复，宿主8088未动。工程完整字节快照44.740→3.888秒且字典全等；原生工程班次status1.772秒读到progress。新增只读Numen控制者/落脚点证据，原桐人session两轮真实含新上下文并完成5次goto、放置及进食，捕获mob_defense。修复成功恢复被计入3次失败重试上限：旧attempts全保留，原loop一次恢复后只读确认上线，无手工清状态/重投。结衣两轮完成且新问答heard，21项party健康通过；没有work产出，多段回复仅离线验证，唯一线上长回复实验因模型输出工具XML被正确拒绝。天神10:55轮因GLM5.3原生30秒stream idle提前失败，不能称360秒总截止或工程闭环完成；近距move拒绝仍缺当时原点证据。新原生验收替换前归档旧报告原字节，完整panel仍有旧来源证明失败，不能改哈希凑绿。见docs/AUTONOMY-OPTIMIZATION.md。

2026-09-14 08:00 当前运行覆盖下文旧暂停/候选环境结论：13 个默认 Compose 服务运行；survivor 为 2.2.0-autonomy7，游戏 Qwen 仍 autonomy3 加已加载 Cron guard3，宿主8088未动。已修复动作锁外检查引发的误暂停、原结衣外围区块不 tick、食物原生回执与截止、NPC 日志 ENODATA、ReMe 通用前缀检索及 Doom 终止识别。原 UUID/session/背包/人物模型保留。结衣新增原生10分钟生活信号，由既有NPC线程消费，无新守护进程。两次新请求/回复均在游戏实际heard，下一原生活轮精确消费两条回复，桐人实际种植两株小麦；结衣随行与交流已验，未验她亲自耕作。最新生活/队伍只读 smoke 及19项party健康检查通过，旧报告原字节已归档而非改哈希凑绿。NPC最后安全重启后已resume；详见docs/COMPANION-AUTONOMY-REPAIR.md。

原工程候选环境已按清单迁移，历史/引用及四份批准测试字节保留，纯模式纠正子提交30f04f5、固定可用镜像和组合测试计划已生效。07:55天神自然读取新回归并真实排队，暴露正式runner继承服务ENTRYPOINT的问题；现已修复并单独重启control，9项runner回归通过。两项新增候选测试前置/异常断言已修正，正式job maintenance-20260914-runner-entrypoint-01真实120次执行全部通过，源SHA798fa1db…9452，测试容器已移除；候选业务未部署。工程/学习原Cron均恢复，下一工程08:15。不能改批准hash或重放旧未知模型任务，候选后续提交需重新核对源字节。详见docs/ENGINEERING-CANDIDATE-RECOVERY.md。

最终实机补充：autonomy4第五轮task-9753bd8c52cd的t23在5分钟内正常到达营地边缘，第六轮task-82eb6573e214已自动接续，未知0，仍原session；未触发自动stop，不能冒称自动截止分支已实机覆盖。工程01:05轮尝试test被engineering_fixed_checks_changed拒绝，固定tests/test_world_team.py与tests/test_world_team_schedule.py字节不匹配；未入队/执行/提交，01:11超时正常释放。工程验收仍待处理，不能改受管hash凑绿。

2026-09-14 最终增量：survivor现为2.2.0-autonomy4，Qwen保持autonomy3进程加/ops挂载补丁。连续原会话模型回合及放置/导航已实测；第四回合后发现原生自卫反射freeze会无限延长goto时间。原t22经一次精确停止取得同epoch的cancelled终态，原controller自然结算failed，不冒充自动超时触发。新增只由controller驱动的goto总等待5分钟：准确身体/维度/epoch/taskId匹配、持久停止意图后发一次task_stop，真实终态才结算，未知不重发也不泛停；其它任务不类推。导航8/controller68/Linux网关31/生活伙伴41项通过。原UUID/session/背包保留，无MC/Qwen重启；详见docs/AUTONOMY-RECOVERY.md。

最终团队增量：team_context公共投影不构造旧OperationsTools身份，10实际注册卡协议与10生产driver重连均验证；女神已3轮自然完成，修复后真实context0.236秒。工程status默认不扫描工作树，paths定向查询才展示该范围，dirty/sourceSha256为null表示未验；capture_source/test/commit仍完整新鲜字节。真实自然轮status1.364秒、定向diff1.758秒；工程师改了独立候选代码但未测试/提交，不能当线上修复。00:55超时正常释放，01:05下轮自然启动。10角色工程引用已原生同步，引用更新会原样ETag保存SKILL.md使扫描缓存失效再enable；角色配置不变，Qwen完整10角色/94技能检查通过。

2026-09-14 自主运行恢复覆盖下文暂停/旧路由状态：用户已确认客户端可以进入。已按当前Qwen原生进程与逐动作证据归档旧桐人孤儿任务、旧运营周期和共享占位，不能把404改成完成或重投旧动作。游戏Qwen与survivor现用2.2.0-autonomy3镜像，原UUID、背包、生活session和角色即时模型均保留；新增原控制器drain，在当前回合及物理动作收尾后暂停，resume保留lastDrain。宿主8088未动，无新增宿主循环。部署/历史恢复见docs/AUTONOMY-RECOVERY.md与docs/SURVIVOR-DRAIN-AND-INTERACTION-RECEIPTS.md。

服务端Iron桥98aead6d…efa7668新增Numen原TaskRecord交互回执。放置/农耕/开容器每个actionId只提交一次，初始RCON响应缺失或损坏后只读同ID查询；确认点击终态仍须另验实际效果，效果未验证返回带观察的普通失败，真实未知保留阻断。已受理请求跨重启不重放，预检拒绝暂不持久化。独立72mod实机23项通过，包含真实Python正常/丢首ACK两场景各一次物品消耗；生产曾明确日志拒绝的木板与迟到验收成功的泥土各自原始证据归档，不能混淆。新增只读world_interaction_health探针，旧全项目源码证明不改写。

运营四条旧用途路由已并入现役天神/策划/桐人，默认司灯与工程MCP、手工CLI均按精确宿主选择/operations-state，不依赖MCP未继承的自定义环境变量。原生Cron guard2对明确timeout/cancelled释放当前执行占位，其它unknown仍须核对。team_case默认最近3条完整事件并可向前分页；女神每轮一个事项、480秒，其余工程/策划仍360秒，原节奏与模型不变。10角色技能引用已原生同步。司灯日报及专业策划任务已真实完成，9月14日日切发布石磊/烛九两张货单，禾叔仍草案，不能宣称三张全发布或玩家已完成。详见docs/OPERATIONS-AUTONOMY-RECOVERY.md。

2026-09-13 客户端注册表报错：远端实际运行实例未识别两支 qiandeng_chanting 法杖。D项目两端staff SHA一致b867…f9e5；旧分发0.1.0～0.1.3未打包staff，0.1.4还缺当前maid-bridge且god-voice已旧。已从严格client锁导出0.1.5-local完整mrpack（88mods/164覆盖文件）及staff+精确voicechat依赖的小补丁；无服务端/存档改动。外机须安装并完整重启，不能把包校验成功当成已进服；此前用户“能连接”只证明网络/服务器可见，不覆盖这次模组同步失败。详见docs/CLIENT-REGISTRY-COMPATIBILITY.md。

2026-09-13 局域网入口按用户要求改为默认 TCP 25565（对外 0.0.0.0），当前 LAN 为 192.168.3.133；Simple Voice Chat 对外 UDP24455，voice_host=24455 沿用客户端连接主机。原127.0.0.1:25567只作宿主脚本兼容入口，内部mc:25599和管理/RCON回环边界保留。无专用服LAN广播，玩家应手动添加192.168.3.133；不增宿主广播进程。此条覆盖旧“游戏仅本机25567”说明。

默认127.0.0.1:25565真实协议握手通过；用户已回复确认另一台局域网电脑能看到并连接。本机经自身192.168.3.133回连超时仍如实记录，当前WSL mirrored未启用experimental.hostAddressLoopback；不能把自回连限制等同远端LAN失败，也不把用户确认冒充自动化客户端登录。全局WSL/防火墙未改，详见docs/GAME-RUNTIME-LAYOUT.md的LAN说明。

2026-09-13 最新 D 盘服务整理覆盖下文空引擎/双运营实例记录：已从固定依赖真实重建缺失镜像，项目仍为 `D:\Projects\QiandengJi`，Docker Desktop 实际 WSL 镜像磁盘已迁到 `D:\docker-data\DockerDesktopWSL\disk\docker_data.vhdx`，迁移后原镜像 ID/标签/容器挂载核验通过。默认 13 个活动 Compose 服务（新增容器 inventory，包含 survivor），原 `qwenpaw-ops` 归档到 legacy-operations profile；10 个启用角色/94 项技能绑定均在游戏 QwenPaw 18089，宿主 8088 保持原用途。公开状态每 120 秒由容器采集，旧 Windows 游戏任务保持 Disabled。恢复前备份 27,157 文件且逐项校验。原 shadow 世界已加载，两个游戏协议入口、keepInventory=true、本机免密码管理、观察者及 GPU Kokoro 健康通过实际检查。桐人仍按原 cancellation_uncertain 暂停，旧任务不可因服务恢复而重投/清除，游戏可连接不代表自主生存已恢复。详见 docs/GAME-RUNTIME-LAYOUT.md；历史源码哈希和旧验收不改写。

公开库存唯一写者为 inventory 容器：宿主 status/doctor 读当前快照，snapshot 和完整 health 刷新通过已验证容器 ID 执行固定 --once，完整审计只写 reports。实测 Windows msvcrt 与 Docker bind 上 Linux flock 不互通，不能恢复为宿主和容器各自加锁写同一公开文件；Linux 发布者间互斥已验证。见 docs/INVENTORY-CONTAINER.md。

恢复后的完整审计不是全绿：除历史源码证明漂移外，15 条模型用途路由中 diagnostics/events/controls/exploration 仍指向已停用的 qd-diagnostics/mc-priest/mc-guard-kirito/mc-guard-naruto，旧 operations_native_tasks.SPECIALISTS 也仍允许委派这些目标，是实际待修问题；不得把 probe 放绿或重新激活重复角色来遮掩。当前日报回执、桐人持续 tick/伙伴通信亦未重新验收。本轮只完成 D 盘容器服务恢复与守护，不能说自主世界闭环全部完成。详见 docs/GAME-RUNTIME-LAYOUT.md。

2026-09-13 语音实时性最新方向覆盖下文 IndexTTS 启用记录：用户指定复用 C 盘 Kokoro，游戏 Compose 的 `tts` 改用本地 Kokoro 82M v1.1-zh（Kokoro/Misaki 0.9.4），GPU 推理、运行时离线，全部生成式 LLM 仍走 QwenPaw 云端。旧 47 个音色 ID 映射到已安装的 `zf_001` / `zm_010`，不宣称仍具备克隆效果或 IndexTTS 情感控制。桐人 `cosy_male` 用男声，结衣 `cosy_female` 用女声。只替换既有 Docker TTS，不新增宿主常驻进程；旧 Index 镜像、资产、来源清单保持可回滚。部署和实际延迟证据见 docs/KOKORO-TTS.md。

2026-09-13 硬件与推理部署方向：本机为 i9-13900K、64GB 内存、RTX 3090 24GB。用户明确本机不运行通用 LLM，游戏生成式推理全部由 QwenPaw 角色调用云端；当前启用角色为八个阿里云 CodingPlan、女神与天神两个智谱 CodingPlan，保留即时模型选择。GPU 可用于游戏专属 IndexTTS 2.5，保留本地 ASR 与语音链路；TTS 显式 `use_qwen_emo=False`，不加载额外文本情感 LLM。宿主 QwenPaw 8088 保持原用途，不能因进程名或端口猜测而停止其它服务。旧 Docker 引擎中镜像和容器已不可见，恢复必须使用真实重建记录，不能冒充原不可变镜像；D 盘世界、角色会话和技能数据保留。

2026-09-09 最新世界团队迁移已完成：既有“天神 · 世界工程师”现位于游戏Qwen18089，原生ID为 `qd-engineer`；实际浏览器确认游戏9人、运营18090五人，仍是原14个团队身份，宿主8088保持其他用途。天神的逻辑署名仍为 `operations:mc-god`，由active的 `/team/runtime-hosts.json` 精确映射到 `game:qd-engineer`，保留原会话、工单、学习与工程repo/回执，不改写历史作者。旧运营 `mc-god` 及其两项Cron已停用并完整备份；目标四个MCP、原两项Cron、游戏9人/80项技能绑定与运营5人严格健康检查均通过，司灯 `qiandeng_operations` 已原生重载新路由。工程status确认新路径下仍是原HEAD `5de7f8af`、分支与仓库，其他既有角色模型、名称和语言未变。证据在runtime/engineer-host-migration-20260909/与reports/world-team-smoke.json。游戏 `mc-god` 仍是“灯语女神 · 世界管理”，`mc-herald` 仍是“灯语女神 · 玩家交流”，与天神工程师区分。原模型、SOUL、人物UUID及生活记忆保留，新角色绑定自己的learning/team身份，不能继承模板工具身份。见 docs/WORLD-TEAM-ARCHITECTURE.md。

女神10分钟巡查、天神错开4分钟、策划30分钟班次已启用原生Cron；其它角色沿用原事件/生活任务/日常班次，不为每个人额外起模型循环。角色可署名写反馈，女神/司灯分派，天神原生文件工具修改独立engineering/repo、固定隔离容器测试并提交候选；本地commit不等于推送、部署或工单验收。Boss/宝箱仍缺专属实体与结算回执，明确blocked。旧world review/dailyReport/evolveReview自动模型入口保持关闭，新班次复用已有Qwen和worker，不添加野生守护进程。

实机：女神已诊断并派工程工单；“秋灯祭”content-fd5881ee422e68c006ecc176已由策划生成、女神批准、原NPC worker发布并读到真实看板，沿用当日No1/2/4原合同，不代表玩家已完成。工程师前两轮超时后，第三次原生scheduled轮真实修改候选并通过24项固定隔离测试，候选交付/上线须另验。只读入口tools/world_team_health.py；全项目历史快照漂移不能通过重写旧哈希冒充全部绿色。

桐人最新运行：原240秒任务超时后，单轮时长已改600。2026-09-09修复spring空RCON回执：同requestId的MC原生storage占位、单次setblock的success/result与sourcewater后置检查共同确认成功，已有水不收费，未知不重放。旧unknown仅按原任务/call_id/turn_id与现场观察归档为resolved_effect_observed，保留当时未知事实，不补扣/补学。后续task-703ae05b4ad6真实完成新spring，beforeWater=0、success=1、result=1、afterSource=1并扣12法力；原已学，不能称新学会。它与task-cd43d244f0d3均正常结束，仍在矿坑Y49，未验收脱困。天神迁移验收后只恢复一次，task-c7bfbc0e08bc在原session自然running，原生采矿t37已受理并结束，未见autonomy_disabled且unknown=false；原UUID/session保留，仍不表示已脱困。天神02:55原生qd-team-engineer也已在18089自动开始，未手动run，尚无这轮终态验收。用途operations.priority保留旧ID但已指向game/qd-engineer，15条路由健康全绿。证据在runtime/spring-recovery-20260909/与runtime/engineer-host-migration-20260909/，不因清理显示而改写旧动作记录。

2026-09-09 最新生活记忆：游戏 QwenPaw 2.2.0/ReMe 0.4.1.10 的桐人、结衣启用原生 memory_search（含动态 MemorySearch 权限）、每5个外部完成回合 Auto-Memory、每小时 Dream；不是5分钟提炼。SOUL原样保留，PROFILE/AGENTS按官方职责精确整理，根MEMORY.md不在ReMe索引，memory/与digest/按需检索。长期目标在memory/goals.md普通文件；原生/goal是有边界子任务、会话目标仅进程内，不能当跨重启人生账本。详见 docs/QWENPAW-LIFE-MEMORY.md。

survivor qd15 增加真实sleep回执/原生10分钟Cron复盘信号队列（MCP44项），由原控制器在安全边界合入原生活session，按精确终态确认水位；不另开模型循环。sleep成功只证明进入睡眠，不证明睡醒。原生Heartbeat固定main会话，保持关闭。配置工具tools/configure_life_memory.py使用原生Agent/File/Cron API，固定Cron ID须用PUT、Agent更新须id+name、工具白名单还要同步legacy mirror。严格健康检查不放宽。记忆状态API原生Dependency元数据统计bug以锁版本/源SHA兼容补丁修复，只跳过统计元数据，不改变检索或组件初始化。

本轮首个复盘 task-c55d625759a0 已在原聊天真实edit_file写入目标和MEMORY；00:10原生Cron自动成功，结衣AutoMemory已真实生成日期日记与来源mem_session。模型总结可能错误，不能据此宣称法术、装备或玩法全部掌握。后续矿坑受阻不是旧tick故障：同原营地XZ范围的施工minY已精确从62补到55，角色仍用自己的44泥土，需自行搭阶并按回执验收；不传送救场、不把单格预检说成整条脱困成功。

2026-09-08 最新故障修复：桐人“树冠死锁”根因是 owner 离线后原生加载票停止而 brain 仍运行。现有 Numen JAR 的自主 tick 增量已部署为 47cc11d6…，只为 config/numen-autonomous-bodies.json 中原 UUID/owner/name 精确匹配的自主角色复用原生半径2、20tick续/40tick过期加载器；不全局forceload、不手工tick实体。实际同身体自然落地、原背包保留、5次原生导航成功到营地并继续建营/采矿。详见 docs/NUMEN-AUTONOMOUS-TICK.md。死亡保留装备/背包/经验采用原生 keepInventory=true，已在重启后读回。survivor qd14 还修复 Windows bind mount 短暂占用导致的原子状态发布失败：只重试同一已fsync文件的rename，不重投模型/游戏动作。

`/mycli` 已有真实法术工具，桐人并非没有技能：Lv15旧精选已学5项，部分旧战斗术归档或由Iron替代。新版game_skills增加按需archive分页与现有执行边界说明；主动等级足可首次合法施放收录，game_learn验证真实技能书但原规则不扣书，Iron仍要实际装备来源。不得把入口可用说成新技能已学会，也不得为实测解除保护/赠书。共享qd-minecraft-guide引用更新后必须同步所有持有角色，保留原生严格健康断言。

本轮同一生活会话任务 task-2a8d114c61f4 已实际成功调用旧 feather_boots 和 give bread 4，面包实物8→12；背包36格满，靴子未验到随身或装备栏，不能说已穿上。spring学习因无技能书被拒绝；该任务不算新学技能。证据见 runtime/mycli-practice-one-task-native-proof.json 与 docs/NUMEN-AUTONOMOUS-TICK.md；后续自主任务的学习结果必须另按回执归属，不能混入这次验收。

2026-09-08 最新人物与运行方向（覆盖下文历史额度/小灯称谓）：伙伴正式名为 **结衣**，是桐人的家人与冒险伙伴，按 SAO 原著心理健康咨询 AI、亲子关系及 ALO 导航伙伴定位适配，不以女仆自称。原专属身体 e6ef6001-47c6-4f13-823c-1b724520d164、owner、Qwen角色5swvhK、generation、生活session与经历保留。人物依据/原生迁移见 docs/SAO-CHARACTERS.md。外观仍为实际已有模型，不能说已装结衣专属模型。

用户本阶段以自主运作为主：游戏/运营 Qwen 本地 QPM=0，iteration gate关闭并有锁版本的 AgentScope 同步适配，保留并发1/实际供应商限流/超时。survivor dailyPlanningLimit=null、decisionCooldownSeconds=0，NPC三个用途与party/运营派工的人工次数额度均撤下；用量仍记录。不是999999代替无限，也不是无限重试未知动作。旧世界对话入口的节流和旧evolve-retry遗留见 docs/LLM-LIMIT-REMAINDERS.md，不能宣称全项目所有旧入口已重构。

收到队友回复只记入感知，不能单独触发模型：下一次世界/目标事件或原定复盘才带入未消费回复。按精确task终态确认消费，晚到回复保留、unknown不消费。party同身份revision允许只改两项推理额度字段；身份/消息容量等其它变化仍须原碰撞检查，不能为改显示名/额度丢掉旧听见回执。

世界日常运营已用原生Qwen司灯每日09:10班次接到现有专业公会策划/日切发布；首次班次真实完成，保留已有次日5份草案，未到日期不假称已发布。见 docs/WORLD-DAILY-OPERATIONS.md、tools/world_operations_health.py。村民长期实物生产尚未验收，不用粒子/台词或空routines冒充完成。完整Qwen健康会读取survivor MCP，因此compose让survivor依赖qwen service_started，模型仍由现有原生工具readiness gate阻止过早提交。

目标优先级：保持 Rapid Optimization 基础，让原 shadow 存档及玩家进度可继续使用；在此基础上检查并补齐遗留的群系、世界多样性、村民、怪物与探索内容（用户 2026-09-07 后续要求）。

2026-09-08 伙伴实施最新进度覆盖下文旧“仅设计”时点：原桐人已正常死亡恢复，同UUID/owner，保留原生死亡后物资、饥饿和经验；专属新女仆小灯 e6ef6001-47c6-4f13-823c-1b724520d164 已走原生蛋糕认领，owner为桐人，NoAI解除、原生follow启用，独立Qwen角色5swvhK。真实旧女仆不转主人。稳定life session和连续六步动作已实现；规划上限现96/24h（保留旧48记录）、冷却180秒、QPM8，女仆用途仍共享12/24h。生产模型与交流联调证据以本机两份survivor smoke为准，不能只凭角色创建或隔离世界测试宣布自主协作完成。

用户最新通信要求：游戏Agent不能后台直接互聊，可走游戏私聊，优先复用女仆专用对话。当前party nearby由MC真实身体、主人、同维度24格验证后生成发言/听见事件，heard才进入模型；回复也需实际heard，不公开未送达草稿；unknown只查原event不重发。原版msg尚未接通，不能把女仆冒充玩家或悄悄改公开广播。现有TLM manager.chat→BridgeClient→Qwen原生对话桥可复用，但桐人输入工具/Numen无客户端回包/迟到回复恢复仍需完整接线，不重复提交第二份Qwen任务。详见docs/MAID-BRIDGE-IMPLEMENTATION.md与docs/SURVIVOR-PARTY-OPERATIONS.md。

本轮实机暴露并修复：Qwen异步MCP重载可能写回旧ask权限，配置需用mcp_configuration辅助按原生active顺序处理。首轮模型6次迭代耗尽的框架文字曾误发，保留历史标记系统中断；最终消息是框架哨兵或无有效文本时现在失败收口，不回退上一条、不发声、不算成功任务。桐人模型迭代现12（实体动作仍6），QPM8/并发1/240秒/96规划不变，女仆仍4迭代。只读验收须检查nativeAnswerVerified，旧错误不计入两次有效生活会话。

生存状态读取失败必须区分未知和真实离线：`observation_unavailable / online:null` 进入暂时等待，继续查询已有任务，不永久暂停或恢复身体；完整原生名单或 no companion 才确认离线。已有未知动作不重放。survivor qd11 已部署此修复和收尾/伙伴工具提示，436项生存测试及后续41项会话测试通过；不要为恢复循环删除历史租约/回执或重投旧模型任务。

用户此前明确允许CodingPlan多用以实现功能，本轮发现女仆共享12次/24h已耗尽，当前统一调整为所有女仆共享24次/24h、60秒间隔，保留原账本；小灯QPM4/并发1/4迭代不变。下文旧12记录属于调整前时点。GodVoice主线程健康文件IO阻塞已最小修复并同步两端/恢复缓存b23d72da…44e99，使用现有watcher写容量1样本，无新进程/线程；114项JVM、11项collector和上线实时语音探针通过，其它主线程generation/回执IO仍保留。

2026-09-08 女仆队友需求：桐人与女仆各自拥有 Qwen 人格、生活会话、记忆和学习能力，通过现有桥交流协作。已核对专属女仆可让 NumenPlayer 走原生蛋糕认领流程复用跟随，无需先开发领队 Brain；实际认领/同游未测试，不能直接调用基类 tame 冒充完整认领。现有真人女仆不转主人；新伙伴具体身体、名字和性格未定。Qwen 原生通信还需稳定接收身份、统一串行入口、预算和禁止递归回调的适配；女仆 TTS 仅发主人连接，需另接现有附近播放通道。方案见 docs/SURVIVOR-MAID-PARTY.md，本轮未部署组队、召唤人物或调用模型。

2026-09-08 多模态视觉最新方向：用户要求图像输入/FOV110，随后明确完整客户端太重，采用服务端优先：Numen结构化感知→现有MCP→Qwen持久主会话，局部地图/切片按需编码；透视图优先复用现有共享渲染，仍重再评估CPU语义投影。图形客户端不作为自主生存前提，不重启旧RenderBot或新增视觉LLM。FOV沿用垂直110°，地图没有FOV；Goddess跟随/QA截图不能冒充Kirito相机。Qwen原生图像序列化8项通过、0模型调用，未验证供应商看图/生产图像工具。详见 docs/SURVIVOR-VISION-DESIGN.md，本轮未部署视觉服务或新模型循环。

2026-09-08 连续生存方向：用户要求参考旧Numen策略，让Agent在持久主session里主动MCP感知、连续行动、编程和学习，尽量把生活决策交给LLM。研究确认当前turn_id兼作session_id导致每轮新会话；设计见 docs/LLM-SURVIVAL-SESSION-DESIGN.md，本轮尚未部署。后续应同时处理稳定会话键、取消、重启恢复、统一串行入口、逐动作回执和按需感知，不能只替换session常量或增大actionLimit；原生身体执行、身份/物资/防重边界继续保留。

2026-09-08 个人资料授权：游戏与运营角色可用 Qwen 原生文件工具在各自工作区保存、追加、修订经验、参考材料及代码草稿；普通记录无须再次请求写入许可。清理旧提示中含糊的文件禁用描述，保持人物身份与用户资料。notes/index.md 短索引→相关笔记按需读取；方法见 qd-skill-evolution/references/notes.md，不额外启动模型循环。文件保存与执行技能验收分开，Numen 程序内核无文件访问的边界仍保留。

2026-09-08 玩法资料后续要求：使用 QwenPaw 原生渐进披露，`qd-minecraft-guide` 简介→Skill短正文→read_file单篇references；不能把百科、所有配方和旧路线塞进上下文。桐人 MCP 新增只读 lookup_recipe，总计43项，复用当前Numen RecipeManager，仅覆盖标准配方类型而非所有机器。详见 docs/PROGRESSIVE-GAME-KNOWLEDGE.md。用户允许当前功能验证多用 CodingPlan；真实模型实验必须记录实际调用与结果，不因预算优先级放宽就制造无任务的高频循环。实测QPM4会在渐进查阅第5轮前本地超时，现桐人QPM8、并发1、单任务6迭代；自主48次/24h与180秒间隔保留。Qwen限流器进程缓存需重启游戏Qwen才能应用新QPM。

2026-09-08 后续阶段覆盖下文旧的“仅设计/工具全禁”限制：用户要求技能优先复用官方与市场，已采用 QwenPaw 官方 make-skill、file_reader、cron，普通技能原生创建，游戏可执行程序仍须测试。游戏6个基础角色加注册女仆独立角色、运营6角色均按自身工作区管理；官方工具检查需读取当前workspace角色，不能只改agent.json却保留全局guard。原生周任务复用现有预算，无额外Agent守护进程。具体边界见 docs/ROLE-LEARNING.md。

人物桥接本轮已部署：GodVoice角色语音、TLM真实身份签名/MCP及原生设置包，见 docs/MAID-BRIDGE-IMPLEMENTATION.md。有主的旧女仆注册为独立Qwen角色，未加载区块仍休眠，无主的两位不自动收养。Numen恢复补丁已让原桐人同UUID重新上线，48次/24h决策额度保留；不能把budget_wait说成正在继续新目标。MCP现42项，新增speak/speech_status/stop_speaking。声音解码、队列及隔离世界测试不等于真人听到或女仆跨天自主经营已验收。

用户阶段决定（2026-09-07）：先复用已有 Agent、拆分架构和推进玩家玩法。2026-09-08 新授权：开始一个 QwenPaw + Numen 自主生存 Agent，使用原桐人，支持自主规划、执行、反思及可编程技能学习；这取代此前“Agent 新功能先不做”的阶段限制。当前边界见 docs/AUTONOMOUS-SURVIVOR.md。

后续补充：保留 QwenPaw，但会话接口支持替换，管理台独立运行。D 项目管理台为 19091，游戏 QwenPaw 为 18089，运营 QwenPaw 为 18090，网页天神之眼为 19092。用户 2026-09-08 明确要求前三个网页入口本机免密码，仅绑定 127.0.0.1；宿主 QwenPaw 8088 保持原用途和配置，旧 9090 不再保活。最新边界见 docs/SERVER-MANAGEMENT.md。

2026-09-08 用户要求在游戏 QwenPaw 看见桐人并持续自主生活：真实 qd-survivor 角色现迁入本机免密码 18089，与 mc-god/mc-herald 共用游戏 QwenPaw 2.2；18091 独立控制台退役。survivor 容器仅负责世界感知、持久调度、受限 JS 技能与内部 Bearer 鉴权 MCP（8089，不发布宿主端口），身体/学习状态仍在 server/survival-agent-state，模型配置/会话/历史用量在 server/agents。共享迁移保留69次历史请求、旧技能/身份和另两角色的即时模型选择；后续源码同步用 tools/migrate_survivor_to_game.py --sync qiandengji，须先暂停并停止这两个容器，不能重跑迁移覆盖历史。19091/#survivor 展示状态，服务管理保留预览确认。复用 Kirito 的旧 UUID d4ac9523-4962-43ed-98c5-19b49e104048、物资及 qiandengji_kirito YSM，不启用旧守卫驱动、不改宿主8088或运营六角色。

桐人默认持续自主：15秒身体/事件观察、60秒周边观察；任务完成后自主选择后续目标，空闲按模型提出的180–3600秒间隔复盘（默认1800秒），仍遵守滚动24小时48次决策、180秒冷却、模型并发1/QPM4/6迭代。世界聊天、指向自身的神谕/系统消息与施法回执作为不可信环境数据，有持久游标和提交确认；不能宣称感知所有模组任意内部状态。纯观察与已验证程序执行不逐步调用模型。JS行为技能必须草拟→测试→晋升；实际游戏技能通过原 /mycli 查询、施放和用背包内技能书学习，保留等级/法力/冷却规则。未知动作不重放；Numen 寻路/采矿边界是预检，不能宣称硬隔离或长期自主生存已经验收。

2026-09-08 用户进一步要求自主公会、采矿、装备、建造、农耕和交易：现在39项MCP、17种程序动作，复用Qwen与Numen及原公会。新增有界同步方块扫描、实体容器身份、一次原生交易和实际库存结算；六位现有公会NPC精确绑定，不能重新召唤、套用旧坐标传送或恢复旧分身。每日任务只选已绑定且职业匹配的角色。建设区须勘察后在本机配置，源码默认空；当前村外营地与实机范围见 docs/SURVIVOR-ADVENTURE.md，参考项目见 docs/MINECRAFT-AGENT-REFERENCES.md。程序内核变化会使旧测试失效，必须重测原技能版本后复用，不能直接改测试通过标记。保留预算与历史，不能把39项加载或只读扫描成功当作全部生活目标已完成。

后续执行：普通玩家命令已提取到 application/player-commands.ts；world 不再以 QwenPaw 健康作为启动前提。保留旧授权、回执和队列去重，不把可信进程内端口暴露为无鉴权管理 API。当前证据与仍保留的历史问题见 docs/PLAYER-COMMAND-SERVICE.md；用户最新优先级是“语言即接口”：真人按住说话施法，CLI 供 Agent 与内部执行；语音接线与边界见 docs/LANGUAGE-INTERFACE.md，先验证语音再推进实物工会合同。

2026-09-08 用户要求所有生成式模型调用归 QwenPaw Agent 管理：用途目录为 config/model-task-routes.json。游戏18089共6角色，新增 qd-villager-dialogue、qd-guild-planner、qd-maid-dialogue；运营18090原6角色、宿主8088保持原用途。禁止业务侧直连供应商、未知提交重投、失败跨角色重复请求。新角色首次沿用mc-herald当前模型，之后同步保留即时选择、历史和用量。公会每日整批1次规划预案，已存在合同不重写；村民对话4次/24h（环境开关仍关），女仆12次/24h，均是用途共享预算而非每人物翻倍。女仆兼容线程只迁移文本，不宣称已迁移模组全部工具；ASR/TTS和本地向量服务不属于生成式任务。角色注册、接口边界、部署与验收见 docs/MODEL-TASK-ROUTING.md。

- Minecraft 1.21.1 / NeoForge 21.1.248 / Java 21。
- 快慢分工（2026-09-08）：QwenPaw承担目标/编程/必要复盘的慢系统，Numen原生AI与已测试多步程序承担快系统。显式waitSeconds与inspect_block/inspect_container只读提议不消耗动作步骤；共享预算不变，不能自动启动模型未选的技能。程序内核变化须实测重跑原晋升版本fixture。原生当前没有自动进食反射，TLM Brain不能直接装到Numen玩家；实现与边界见 docs/FAST-SLOW-AGENT-SYSTEM.md。
- 女仆后续方向（2026-09-08）：每位女仆独立 QwenPaw 人格、名字、会话和记忆，模型供应商与女仆用途预算仍共享。复用已装 TLM 1.5.3 Tool/Context/原生工作 AI，不能按名字或提示词猜实体 UUID，不能让模组和 QwenPaw 各跑一条推理循环。核查与待实施边界见 docs/MAID-AGENTS-DESIGN.md；本轮只完成可行性与架构，独立人物 MCP 未上线，现有共享文本入口保持运行。
- GitHub 主仓库是 https://github.com/jcs130/minecraft-ai-friend；D 项目沿用其历史，原世界源码位于 world/。2026-09-20 用户明确要求实际部署并提交主干：完成并验证的代码应正常合入并推送 main，说明提交号与同步状态；codex/* 可用于隔离开发，保留原历史、不强推。生产未提交代码须逐项核对保留，不强制切分支或覆盖。公开提交范围和本机资源恢复见 docs/GITHUB-WORKFLOW.md，不能把存档、密钥、运行报告或第三方资源产物加入源码提交。
- D:\Projects\QiandengJi 是开发项目。原 C 盘客户端与生产服务仅作为来源；用户明确授权的旧游戏退役是例外，精确改动/备份见 reports/legacy-game-retirement.json。不要把退役入口重新启用，也不要改动宿主 QwenPaw 的非游戏工作。
- 客户端、服务端和世界/Agent 服务分别构建。botgate 的技能箱、飞行、附魔及光环不可遗漏；Numen 本地改版不能换成同名旧副本。
- 不以删除未知内容模组、重建世界或绕过依赖检查来掩盖启动错误。
- 存档迁移保持 region、entities、poi、playerdata、advancements、stats、dimensions、datapacks、serverconfig，以及世界外部的技能状态/账本。
- 生产密钥仅能存在被忽略的本地运行配置，不能进入源码、报告或分发包。
- 测试使用本项目独立存档副本与端口；明确区分静态验证、启动、联机和实际技能效果验证。
- 用户随后明确允许精简/合并无用旧技能。默认目录以 config/skill-catalog.json 为准；保留历史进度与既有永久奖励，不意味着继续开放所有旧主动施法。保留传送阵与指南针右键入口。
- 最新真人交互：自研法杖长按使用举起，非阻塞小窗口默认语音；左右肩键循环语音及 8 槽，松开使用才施放。不要恢复 B 单独选择屏、额外确认或默认单独直放键的复杂流程。槽位在原技能罗盘编辑、保存在原 skillbar。录音必须保留 schema 2 首/末音包时间，不能把落盘时间当采音时间。
- 运营组最新要求：QwenPaw 原团队承担世界运营，先治理现有进程与配置，保留可替换架构。公开清单由 tools/operations.py 采集，19091/#operations 展示；19091/#services 本机免密码访问，保留维护预览确认和执行回执。内部 control Bearer、浏览器 CSRF 与 Host/Origin 校验继续保留；此前网页登录凭据仅为兼容机器调用保留，不再要求用户读取密码或解锁页面。游戏会话两角色与原六角色运营组分开；迁移方案不等于已启用。旧游戏容器/入口已精确停用，TTS 已迁入 D；宿主 QwenPaw、通用模型、共享记忆服务保留，不能按 Python 或 shadow 名称批量停止。最新证据见 docs/SERVER-MANAGEMENT.md。
- 新内容模组必须同步网页注册表与纹理模型，并进行持续 WebGL 实测；生成资产不等于成功渲染。网页内存预算、来源限制和后端鉴权不能为了兼容而移除。首页面向日常使用，不默认显示渲染器版本和内部调试面板。
- 模组可扩展原版方块状态（当前 note_block 多 150 个），后续 minecraft 状态编号也会偏移。网页必须按实际注册表名称/属性匹配，不能只校正 mod namespace，不能给现代画面统一套用旧版近似块映射。性能与场景核对见 docs/EYE-PERFORMANCE.md。
- 运营组页面只显示千灯纪新项目角色：不列宿主或旧环境角色、不提供跨环境筛选。qiandengji-ops 的 default 是正式司灯，必须统计；游戏会话的 default 和所有 QA 辅助配置不统计。保留完整 CLI 审计和所有环境配置，不能因展示范围而删除或停用其他 Agent。
- 运营组已独立升级 QwenPaw 2.2.0：18090，六角色、七份职责技能、12项绑定。使用原生后台任务及项目MCP限额适配，30分钟/4次每24小时派工；模型并发1/QPM6/迭代5，关闭周期模型任务与重试。详情和实测边界见 docs/OPERATIONS-TEAM.md。版本升级阶段只涉及运营容器；2026-09-08 本轮用户另已授权为本机免密码访问修改并重建游戏 QwenPaw 容器的登录环境变量，不升级其模型或改角色配置，不得重启 Minecraft、world 或宿主 QwenPaw。登录改造不改变既有模型限额，不新增模型任务；模型或技能已配置不能声称全角色均已实测。
- 2026-09-08 用户另外明确授权升级游戏 QwenPaw，可使用 `qwenpaw update`。游戏镜像更新为 `qiandengji-qwenpaw-game:2.2.0-qd1`（含禁用 default 时的就绪兼容补丁），仅重建游戏 QwenPaw；保留即时模型选择、会话、角色身份和已有生成限额，不按历史模型文档覆盖用户设置。升级与回退见 `world/ops/QWENPAW-LOCAL.md`。Minecraft、world、运营容器和宿主 QwenPaw 不随游戏容器升级重启。
- 快照需要短时关闭源服自动存盘时必须 try/finally 恢复，不停止原服；SQLite 用 backup API。
- **体系谕（造物主 2026-09-09，工程师与验收角色时刻记得）**：打造的是 **Agent-LLM 自主驱动的体系**，不是写一大堆规则。优先给角色可核实的工具、真实回执与清晰职责，让模型自己观察、判断、行动、复盘；硬规则只收敛在安全与权限的最小边界（身份绑定、授权面、不可逆操作闸门），不以静态断言山替代角色自主。验收看真实回执与自主闭环是否转起来，新增一层规则前先问：能不能改成给 Agent 一份证据或一个工具？
