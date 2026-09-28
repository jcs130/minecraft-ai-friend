# 桐人持续站定：完整目标的执行与接续

## 本轮重新复现

用户再次指出“桐人还是老不动”。上一轮几秒撤离、单个进食和服务健康不能证明持续游玩；本轮重新以完整时间窗检查。

- 18:27–18:34 连续追击使原生撤离离开 `maxZ=1400` 工作区，最远约 z1774，中间发生过真实死亡与原身体恢复。威胁消失后的当前停顿并非防御槽锁死。
- 随后回程每次只走十几格，再等待 Qwen 决策。5 分钟有 92 个新鲜身体样本，84 个空闲、8 个普通任务、0 个防御反射；最长完全同点 **90.499 秒**，净回程仅 34.37 格。
- `outside_work_area` 分支只接受逐条 goto，把普通技能退役；原 `base_goto` 是单段动作。已有快慢异步主循环仍正常，但没有承载完整返程目标的持续程序。
- `goalState=blocked` 的实质进展不能提前唤醒；已完成技能的 motor 回执也未进入进展唤醒分支。隔离重现完整 4 段结束后仍等待约 44.7 秒。
- t97 显式指定 y72，原生勘察已指出碰撞并给出 y73 候选，网关仍派发，真实结果 `TERRAIN-BLOCKED`。另一次模型重复第 7 个请求 4 次，触发原生 Doom loop，控制器按原规则等待 60 秒。

## 修复设计

1. 沿原技能库加入 `base_navigate`。慢模型一次选区内已知完整目标，或显式 `return_to_work_area`；快层逐段读取真实落点、派发有界 goto、核对原动作身份及实际进展。没有新增模型、调度器或身体通道。
2. 越界只给已晋升且经当前内核测试的显式返程程序续接。输出机械限制为导航观察和 goto；每段仍由原网关核查工作区、距离与身份。未知动作不重放，目标替换在已确认的动作边界取消。
3. 导航观察下个快 tick 可消费，避免通用观察的 15 秒等待。明确不可站立的显式高度在派发前拒绝，保留原请求与候选，不悄悄改坐标。
4. 已确认实质进展可以唤醒 blocked 的下一轮；技能完成必须有已结算实践、精确回执关联和实测进展才提前接续一次。
5. 6 请求额度耗尽返回明确未入队、未派发与收尾说明；不增加额度、不伪称回合已关闭。现有指南改为完整目标与技能委托。

## 验证原则与范围

真实只读预演先发现生产 `navigationEpoch=null`，首版程序错误拒绝。保留该失败证据，使用实服实际提供的身份、原生 tick 与时间信息修订兼容；不伪造 epoch，也不把观察到达写成上游并未提供的原生保存终态。

本程序是局部分段导航。没有可站立且更接近目标的候选、发生身份/运行连续性变化、失败或无进展时交回规划；没有证明跨山或任意地形的全局寻路。

原生威胁瞬失的 40 tick grace 另有红绿测试和冻结 JAR，**本轮 Python 部署不包含该 JAR**。连续站定主因与此补丁分开记录。

## 本机证据

运行文件受忽略，不随 Git 发布：

- `runtime/native-standing-analysis-1790246280.json`：站定窗口及原生追击/越界证据。
- `runtime/slow-idle-timeline-20260924.json`：原生任务、工具与回程时间线；usage 原值未冒充任务总成本。
- `runtime/continuous-navigation-20260924/live-planning-preflight-before.json`：真实身体只读预演，零世界动作，首版 epoch 不兼容。
- `runtime/continuous-navigation-20260924/model-recovery-wait.json`：重复超额度请求与 60 秒恢复等待。
- `runtime/navigation-completion-wake-review-20260924.md`：完整技能结束后的接续缺口与回归。
- `runtime/continuous-navigation-20260924/{world-adapter-baseline-a42c4e7,kernel-boundary-baseline-a42c4e7}`：隔离基线旧失败，未以删测试或改证明消除。

## 首次部署及未通过的自然验收

19:15 仅通过原管理器重载 survivor，19:16:31 恢复自主与 NPC 准入。源码隔离镜像真实执行 797 项具身、34 项实践测试；原 38 个晋升版本共 200 个 fixtures 重测，新增 `base_navigate` 版本 `2ce23ed720cb84109da24e95fd0b43f1e31740f830d6c5104b91dfd0d0a5d869` 的 9 个 fixtures 通过。角色配置与原 16 条关闭 Cron 精确保持。维护 `continuous-navigation-20260924` 已结束，不得重放。

随后自然运行没有通过持续移动验收：模型仍每轮移动约 3 格，确认完成至下一次派发有 23–89 秒间隔，出现连续约 105 秒同点。原生每段执行约 2–3 秒，进展唤醒也实际生效；但模型从未选择新连续程序，并多次沿用当前位置高度请求下一处坡地，被真实站位预检拒绝。不能将回归通过、单步移动或实际发声替代连续游玩证据。

再次追踪发现：原生 Qwen 每轮确实重新加载最新版 AGENTS，实践参考则按需读取；实际生产 `brainProtocol=1` 的 `embodiment.wake` 没有携带程序目录、新能力或精确版本。新增能力仅在长篇常驻指南中，而真实 `move`/`skill_catalog` 工具说明未指向连续导航。后续修正需在真实输入链增加小型、可验证版本的能力提示，并在工具说明中区分单步与完整导航；不自动指定目标或替模型提交动作。

首窗证据：`runtime/continuous-navigation-live-1790248591/`，其中 `analysis.json` 与 `PHASE-FAILURE-NOTE.md` 固定完整失败窗口。8 个慢任务共提出 15 个请求，5 次短步完成，6 次站位拒绝、3 次越界拒绝、1 次过远拒绝；2 次自然发言文字发送与原生音频完成，但未测物理听感。19:25 起的原生防御位移单列，没有记作连续程序收益。

## 补齐实际能力发现

`Controller.navigation_capability` 复用现有目录缓存，仅在实际 `base_navigate` 有准确 activeVersion、当前内核测试索引有效且目录无读取异常时提供调用模板。具身输入、普通生活输入和旧规划输入都接入同一字段；区外提供返程模式，区内只提供明确待填写的已知目标模板，不虚构坐标。原 `behavior_context.prepare` 负责增量发送，版本/模式变化会更新，资格失效会删除，普通小位移不重发这段说明。

新卡片约 1 KB，直接提供可执行版本，避免再查整个目录。目标、启动与讲话仍由模型选择；卡片构造不派发动作。`move`、`skill_catalog`、`skill_start` 描述同步明确单步和持续导航的用途，并纠正 queued 模式本来允许同轮动作后排程序、共用原 6 请求额度的说明。

原生每请求会重建 system prompt；参考技能 `preload=false`，参考正文只在主动读取时出现。工具描述来自原 DriverManager，缓存 10 秒，到期重新 `tools/list`；不需要改 profile 或切换工具权限。只读证据见 `runtime/navigation-discovery-20260924/native-discovery-audit.{json,md}`。真实身体与目录构造卡片的零动作预演见同目录 `capability-preflight.json`。

补充修改的实际镜像回归为 **806 项具身测试、34 项实践测试全部通过**，117 项具身来源哈希与 16 项实践来源哈希匹配。证据 `runtime/continuous-navigation-source-qa-f9c66808a6/`；本机缺 `quickjs-ng` 的组合检查保留为环境错误，没有冒充该组合全通过。

维护 `navigation-discovery-20260924` 于 19:26 后开始，原任务自然完成并取得 drain `a5f6e420b1ab4113a97a5e594a292ee6`；3485 个 JSON/SQLite 文件备份于 `runtime/component-backup-20260924T112742399490Z/`。19:36:37–19:36:46 原管理器只重载 survivor，既有内核和已晋升程序没有改变，不重复晋升或改测试证明。两个相关健康检查通过；原生 GET 确認 52/52 工具启用，三个新说明与源码逐字一致。

19:37:42.247 已恢复自主，NPC 准入也恢复。该维护已结束，不得重放。16 角色完整 profile、16 原关闭 Cron 与其它容器启动时间精确保持，见 `runtime/navigation-discovery-20260924/own-boundary-preservation.json`。第二窗口由只读等待器在恢复后 97 ms 检出并开始，完整自然运行结果继续追加。

## 第二窗口仍未通过与进一步追踪

19:37:42–19:47:42 的完整自然窗口仍没有启动连续导航。600 个宿主采样、228 个新鲜身体观测中，Qwen 有四个慢任务，motor 记录 10 个完成、6 个失败；普通短步、原生防御、进食分别归因，不混算导航收益。真实证据见 `runtime/continuous-navigation-live-1790249862/analysis-discovery.json` 与 `PHASE-NOTE.md`。

窗口证实快慢异步本身能工作：Qwen 原任务尚未结束，官方 Jev 1.13.0 选择 `base_eat`，对应精确动作和已结算实践使饥饿值 12→17。另一次慢任务却耗时约 231 秒、调用 22 次工具，其中 8 次 status；持续导航仍未被选择。三次治疗施法均收到 `not_equipped`，模型还尝试了其它治疗别名。相关失败在回执中确实存在，查询成功的顶层 `ok` 不能代表动作成功。

进一步修正集中在真实接口：提供直接 `navigate`，内部解析当前已测试程序，复用原单身体队列；支持只有 XZ 的已知地面目标，以脚下真实支撑观测验收到达，仍不证明具体建筑楼层。brief 状态将精确 `actionOutcome` 放在前面，保留查询成功与动作失败的区别；只压缩历史已知说明，不省略未知结果、在途身份和重试限制。8 条真实输出包含新增摘要后的净字节减少约 7.7%，不能称为大幅上下文优化。

20:08 的新增自然证据：模型终于自主调用旧版 `base_navigate` 返程，第一段实际移动约 14.31 格；下一次 16 格探测支撑不足、候选为空，程序以 `navigation_no_supported_progress` 交回。随后继续出现原生受击撤离。远处缺落脚点就直接退出过于脆弱，需要先尝试有界的较近探测；无效观测或未知动作仍立即交回，不尝试重放。

原生收尾调用链还发现第二个真实缺口：异步 `skill_start` 返回 `motor_queued`，旧 Qwen 收尾钩子只认同步 `skill_queued`；新增 `navigate` 名称也不在支持列表。这使程序已经开始后模型仍可能继续轮询。补丁必须用真实异步排队回执测试，而不是仅模拟同步成功；部署需要同时重载原 game Qwen 进程。

本轮中途两次离线完整回归因上述新发现被主动停止，退出 137 记录保留，不能计作通过：`runtime/continuous-navigation-source-qa-5367f166e2/`、`runtime/continuous-navigation-source-qa-a97dc62581/`。修改冻结后重新执行真实完整回归。测试期间未主动暂停生产；源码绑定使 Docker 健康检查提前看到新工具列表而出现配置失配，当前模型任务和身体执行仍另行核实，不能用源码修改当作已部署。

### 实践结算把已结束的导航永久留在队列中

20:08 的首个连续程序暴露了更直接的阻塞：动作 `3cc54fbb…` 是精确原请求的已确认完成回执，原生没有保存可读导航终态时，网关用实际身体位置产生 `navigation_mode=observed_from_body`、`state=ended`。现役身体的 `navigationEpoch` 为 null。导航执行器已兼容这一实际契约，实践记录器却仍要求非空 epoch 和旧原生终态枚举，抛出 `practice_native_identity_mismatch`。

于是 job 虽已 `replan`，实践始终不能 finalized；motor 请求 `34f9d60c…` 仍为 claimed，之后的移动和进食都停在 queued。当前失败不是“模型完全没想好”或“goto一直在原地运行”。使用生产 SQLite 的只读备份和原始回执逐字重现了该错误，见 `runtime/navigation-interface-20260924/practice-contract-reproduction/result.json`。修复必须让这些旧原始回执经正常流程重新结算；不能直接标记成功、删除 claim 或重放动作。

另一条已确认的生存阻断是越界恢复通道只允许朝区内 goto，eat 也经过工作区拒绝。随后查到 20:06:42 原请求 `f930eb10…` 吃面包确实因 `outside_work_area` 被拒；它没有派发，也没有消耗库存。后面的进食又叠加实践 claim 堵塞。补丁只让原 eat 路径在区外消耗自身背包食物，继续验证身份、模式、单身体槽、授权、库存与精确原生食物回执；其它位置操作和程序授权保持原范围。定向 117 项实际隔离回归通过，原失败和测试夹具修正过程保存在 `runtime/navigation-interface-20260924/outside-eat-qa.json`。

### 原生逃跑的近点回退没有覆盖寻路失败

20:20:58 原 UUID 短暂恢复后，原生自卫确实接管，但连续出现 NO_PATH，20:21:14 再次被 Witch 魔法击杀。不能把缓存 `bodyReconnect.online` 当成持续存活。实际源码的 16/8 格回退仅在 32 格落点选择为空时触发；落点存在而 PlayerNav 返回 FAILED 时清空目标，下一次又从 32 格开始，三次预算都可能用在远点。

“search burned its whole budget”是空搜索失败的固定诊断文本，上游没有暴露搜索器统计，不能据此声称已测得耗尽何种预算。修复针对 FAILED 后的有界 32→16→8 尝试，保留正在运行的路径与原三次上限；不通过增加预算、补血或传送掩盖。原生候选仍须独立编译、测试、发布和自然观察，Python 回归不能替代其验证。

## 最终冻结源码的离线验证

### Python 完整门禁

`runtime/continuous-navigation-source-qa-91e011f7fa/summary.json` 记录实际隔离镜像执行退出码 0：**876 项具身测试、38 项实践测试全部通过**。具身报告的 122 项源码哈希在执行后仍匹配；实践报告的 16 项源码哈希也保持一致。两份原始报告分别为同目录 `embodied-agent-smoke.json`、`survival-practice-smoke.json`，源码输入保存在 `source.tar`。测试没有调用生产模型或派发世界动作。这是修订后的完整批次，前述中止批次仍保留，不能合并计作成功。

### 原生撤离缩距候选

现役 `2075c5ac…` JAR 的实际 `AttackCompanionTask` 字节码在新回归中出现 **5 项失败**；修复候选通过 **16 项导航断言及原有 26 项防御断言，共 42 项**。新场景明确包含“32 格落点存在但寻路失败，随后尝试 16、8 格”，并验证运行中的短路线不被重建、RUNNING 不清除失败预算、实际到达中继后恢复正常距离、三次失败后释放身体。该层使用真实任务、Haven 与 Menace 字节码，Minecraft 环境和 PlayerNav 状态受夹具控制，不是生产地形中的移动实测。

Fabric/NeoForge 标准构建通过；原生单测命令通过，共 **1068 项、零失败**，其中受改动影响的 `core/common` **367 项本次重新执行**，其余三个未变模块的 701 项由 Gradle 复用结果。随后本次独立测试世界的 `named_ranged_attacker_makes_idle_body_retreat` 通过：身体移动超过 2 格、离静止远程攻击者更远、具名攻击者未受伤，威胁移除后身体控制释放。完整 GameTest 为 **102 项中 98 项通过、4 项既有失败**，原生进程退出 4、Gradle 退出 1，未描述成全套通过。保留的失败是 `safe_block_entity_data_is_a_datapack_tag`、`blueprint_block_entity_contents_survive`、`blueprint_handiwork_is_not_free`、`creative_pillar_out_empty_handed`。本次实际移动测试没有重建生产女巫及其地形，不能据此宣称该处已经脱困。

最终候选位于 `runtime/native-defense-short-retreat-20260924/candidate-v2/numen-neoforge-1.21.1-0.1.3-ranged-defense-v1.jar`，SHA256 为 `496545426a63ff61545f0796491bde1b602f61b5e2e48edcfb1fa812012994bd`。与现役 `2075c5ac…` 比较，仅 `AttackCompanionTask.class` 及其 `$1.class` 两项改变，另外 564 项逐字相同，没有新增或删除条目。另行试验的“威胁瞬失后继续 40 tick 撤离”候选未采用；现有无路退避与新伤害唤醒规则保持。

完整证据在 `runtime/native-defense-short-retreat-20260924/verification.json`，原始构建记录为 `candidate-v2/build-record.json`，本次实际游戏测试报告为 `native-gametest-report.json`，报告明确 `rangeFallbackPhysicalVerified=false`。旧候选、旧报告和首次测试夹具错误记录均保留。本节记录的是冻结源码与候选验证；维护中的发布和后续自然运行窗口尚未在此获得通过结论。
## 第三次维护：原始回执正常结算

维护 `navigation-interface-20260924` 于 20:35 暂停新模型准入，等待原 `task-a2179ccebdb3` 自然结束。原 drain `2e3027584b184a3182696287f56bc048` 被旧实践 claim 阻住后，先备份 3542 个 JSON/SQLite 文件与原回执，再通过管理器仅重载 survivor。20:41:31 修复后的正常循环将旧 job 结算为 `replan`、`practiceFinalized=true`，原 motor 结束为 `failed`；下一 tick 正常完成 drain，未删除 claim、伪造成功或重放动作。证据 `runtime/navigation-interface-20260924/normal-practice-settlement.json`。

这次 survivor 的进程确已重载，但管理器严格健康等待仍超时：原生工具权限只有 52 项，而新服务提供 53 项，实际错误为 `native_survivor_tools_unavailable`。该失败记录保留；随后在同一个已完成 drain 下同步 `navigate` 的原生权限与工具白名单、AGENTS 和实践参考，没有降低健康条件。

20:45:09 新导航版本 `569ad3072c3fe0cca1f13e79ad3809d0ec5932db801931f93e0b1122819e404e` 经实际 12 个 fixtures 测试后晋升。发布前核对原 121 个技能存储文件，只更新导航 head、追加本次版本/测试与对应目录项；其余 active 版本、旧导航证据和受保护文件逐字保持。实际 source SHA `5ad5eaf0…`、kernel `3bf94933…`，发布记录位于 `server/survival-agent-state/survival/maintenance/navigation-interface-20260924-1790253882441161022-ad794d19/result.json`。

20:46:25–20:46:36 管理器完成 MC 存档确认及六服务停机，准备安装上述原生候选。后续启动与自然观察另记，不以晋升或安装成功替代持续游玩验收。

### 第三次维护完成

20:59:26 完成原生候选发布，实际 Numen SHA 为 `496545426a63ff61545f0796491bde1b602f61b5e2e48edcfb1fa812012994bd`。备份及四个精确目标的写入记录在 `runtime/navigation-native-range-deployment/20260924T124707089977Z-78b5ee35/deployment.json`；世界快照按完整清单引用前次逐字备份，两个目录必须一起保留，没有恢复或修改世界。WorldBridge 用新 Numen 依赖实际重建并运行 179 项验证，JAR 与现役逐字相同，只发布新的真实构建记录，见 `runtime/navigation-interface-20260924/worldbridge-record-1790254778177616200-8a5d5196/publication.json`。

21:00:14–21:05:43 原管理器依次恢复 MC、gate、world、NPC、voice、game Qwen 与 survivor。首次 Qwen 健康检查超时保留，下一次完整只读检查通过；实际加载收尾钩子版本 6、53 项工具全部可用。21:06:07.235 恢复桐人自主，21:06:14.740 恢复 NPC 准入。本次维护 `navigation-interface-20260924` 已结束，不得重放。

前后 16 个完整角色 profile、16 条原关闭 Cron 的规格精确一致，其它服务启动时间保持。证据 `runtime/livestream-loop-maintenance-20260924/20260924T130650776845Z/navigation-interface-preservation.json`；工具权限只追加 `navigate`，AGENTS 与参考文件的变更另有逐字备份。观察者客户端重新入服，后续实际状态为 `following`、双方在线、观察者模式且同维度距离 0，失焦暂停保持关闭。

## 第三窗口：接口修复有效，持续游玩仍未通过

**21:06:07.235–21:16:07.235 的十分钟自然窗口仍未通过。** 没有管理员移动、补血、赠送物品或注入测试目标。600 个宿主采样对应 138 个新鲜身体观测，最长同点约 152.273 秒；发生 4 次女巫击杀、5 次登录，26 次防御接管中记录 22 次 NO_PATH。首末约 2.985 格位移跨越死亡恢复，不能计作完整目标进展。

本窗已经验证的接口收益如下：

- 模型自主使用两次新版连续导航，每次按 16→8→4 格只读探测后明确返回 `navigation_no_supported_progress`；两次都正常结算实践、释放 motor，后续模型轮继续。旧 claim 死锁没有重现，但两次都没有找到可走的落点。
- 两个实际 Qwen 任务以 `navigate` 为最后工具，收到 `motor_queued` 及 `turnCompletion.requested=true` 后自然结束，没有再追加 remember 或轮询。证明版本 6 接上真实异步回执，排队仍不等于目标完成。
- 区外吃腐肉的原动作 `e8fdc9ab82aa43fdac2c8375a84781b4`、原生任务 `t27` 于 21:10:44–21:10:47 完成；饥饿值 6→10，HP 保持 15，原慢任务仍在运行。它单独证明区外进食与异步执行恢复。
- 两次自然发言的文字均已发送、音频任务均完成，未进行实际听感验收。

冻结证据位于 `runtime/continuous-navigation-live-1790255167/`：`analysis-final/analysis.json` SHA `077929269104351e80f2f53f9f0265bfa15eaeec15242a9010113ffca9c8316e`，`final-review.json` SHA `0e69129341ade699fca680276f7d121f1274003f0c1572d36a7fc4854ff04c4f`，`navigate-hook-evidence.json` SHA `0c1270ab4e1c60766959635158211472e8a3189ef9097f723ba054e2bddd83c6`。窗后观测不能混入这十分钟的统计。

### 尚未解决的真实地形与死亡恢复回归

桐人当前位于工作区外 z1421–1434 的石壁凹槽。保存区块的局部几何分析与 12 项实服只读方块断言一致：南端有三格高台阶及低树冠，其余方向有多层石壁；槽内有可站立和移动的位置，目标方向没有普通一格跳跃可达的出口。当前身体脚下有支撑、脚部为空气、着地且不在水/岩浆中。这些证据还不能代替完整原生 A* 测试，真实地形隔离测试继续单列。

实际接口没有传入 RouteSpec，原生默认 `Alter.NONE`，防御撤离也沿用此默认，因此不会自动挖掘或搭阶。原生诊断 `carrying no scaffolding blocks` 使用的条件同时包含是否允许改地形；NONE 下即使背包有方块也会出现，不能当成真实缺材料证据。直接改为 NATURAL 还会绕过现有 Python 工作区/施工区合同，尚未采用。

同时确认迁移回归：现役 actuator 的 `numen_restore_existing` 使用普通 `Companions.summon`，没有处理 `entry.diedAt`。对已登记 UUID，该路径实际按当前 `.dat` 的死亡位置登录，连续把原身体放回凹槽；缺少 `.dat` 时甚至可能先生成不同 UUID 才在后置检查失败。旧实现已有严格的自主角色死亡恢复分支，此次迁移遗漏了它。修复候选移植原身份校验、当前死亡后数据、已加载安全出生点、持久单次恢复记录和旧任务清理；普通下线继续原位置，未知结果不重试。目前记录为候选与隔离验证，不能提前宣称生产已修复。

### 死亡恢复迁移修复的隔离验证

21:40 完成候选的独立服务器验证。严格恢复类从原 `world/numen-patches/restore-src/.../ExistingBodyRestore.java` 移入 actuator，仅更改包名；命令入口改为调用该类。现役 actuator `9271e615…` 的反汇编确认调用普通 summon 且没有死亡分支；提取其原方法、使用生命周期桩的红测复现了“死亡走普通召唤、旧任务未清理、缺档后可能先创建替代 UUID”三项失败。该红测不是物理服务器测试，原始报告与反汇编分别保存在 `runtime/death-restore-regression-20260924/red-contract-report.json` 和 `read-only-evidence.json`。

正式候选使用当前 Numen `49654542…` 及其嵌入 API 编译，**532 项身份、存档与落点契约断言通过**。随后以完整现役模组启动独立新世界、内部 Docker 网络且不开放宿主端口，**21 项真实服务器检查全部通过，进程退出 0，测试服务已移除**。其中验证了普通离线恢复的原位置、原 UUID，以及恢复命令同一个服务端 tick 内的完整 Inventory Tag、food 和 XP 与当前 `.dat` 相等；真实原生死亡后改用已加载的安全世界出生点，保留死亡后数据，清除中断任务，重复请求只观察已有身体。`keepInventory=false` 的实际掉落没有被返还；持久 reserved 记录经过真正停服、启动后仍为 unknown，两次查询均未创建身体或新 UUID。没有使用生产世界、生产身份存档或模型。

此前两次夹具失败完整保留：第一轮把普通恢复后的异步观测直接与旧背包哈希比较，未考虑既有 `godfix-enchant` 下一 tick 自动补回命格书与技能罗盘；同 tick 结构比较随后证明原库存、food 与 XP 正确加载。第二轮新增的完整 SNBT 诊断含彩色物品名，`rcon-cli` 将格式码转换为 JSON 控制字符，导致夹具解析失败；最终诊断改为 Base64 保存精确字节。这两次报告没有被改写成通过，最终完整绿报告为 `runtime/actuator-death-qa-8477285f7e23/result.json`，SHA256 `93810966a0dfffaf2690098277f00f5a6e3787762881d524d4d97dd3c2d6abc9`。

Python 同时移除了 `BodyReconnect` 中被后定义覆盖的重复方法，并修复确定性死亡预检拒绝的限额问题。原逻辑在三次 `death_safe_spawn_unavailable` 后会等待约 23.8 小时；修复仅对完整身份信封中 `ok=false`、`phase=rejected` 且为 `death_respawn_delay` 或 `death_safe_spawn_unavailable` 的精确尝试记录 `attemptAt/rejectedAt`，保留原历史和 `verifiedAt`，不计入可能发生副作用的派发限额。退避仍按本次失败序列保持 120、240、480、最多 900 秒；unknown、矛盾回执和身份不匹配均不减额度、不重放。实际 Linux 镜像中的 **32 项定向测试全部通过**。本次完整具身门禁由主维护流程另跑，不能用这 32 项替代。

候选 `runtime/death-restore-regression-20260924/candidate/numen_act-neoforge-1.21.1-0.1.3.jar` 的 SHA256 为 `32b4ea6b4d14a24286fd7f68136d5028a52720a495aa703e0d618017e0dbf789`，构建记录 SHA256 为 `137ba990b5d45a192a337968e19e33e569f298aef00b215919fac1ba5b92c729`。逐项 ZIP 比较只有 `NumenActCommand.class` 改变、新增 `ExistingBodyRestore.class`，其它 10 项字节相同，无删除；Numen 与 WorldBridge 不变。冻结证明 `runtime/death-restore-regression-20260924/verification.json`（SHA256 `c805ab79d70970014a04e91e189bb1f2faa436a0364ed4174492837ec09b283c`）绑定候选、构建记录、源码、原始测试报告和日志。此处只记录已冻结候选，尚未部署；只支持已加载且安全的原世界出生点，不声称床复活支持，也不改变普通离线位置或用旧存档返还死亡损失。

## 真实地形隔离复现

21:32 的独立原生 GameTest 使用生产区域文件的只读副本，保持原坐标；开测前逐格核对局部 97,838 个方块状态。测试调用真实 TaskDispatch、PlayerNav、A* 和挖掘执行器，相关十个编译 class 与现役 `496545426a63ff61545f0796491bde1b602f61b5e2e48edcfb1fa812012994bd` JAR 逐字一致，没有替换寻路或身体物理。Haven 不参与此测试，目标采用实际失败方向与已知出口，不能把固定目标试验说成自动落点选择已经修复。

| 隔离场景 | 原生结果 | 实际变化 |
| --- | --- | --- |
| `Alter.NONE` 北向、南向出口 | 均 `FAILED` | 零位移、零改块；两次真实统计均为 `exhausted nodes=59/2000000` |
| `Alter.NONE` 槽内正对照 | `ARRIVED` | 实走约 5.58 格，零改块 |
| `NATURAL`、规划参数 `alter_budget=4`、有效脚手架列表为空 | `ARRIVED` | 182 ticks，实走约 19.46 格；仅挖两块草方块，无放置 |

被挖的精确位置为 `(-232,71,1433)`、`(-232,71,1434)`，均从 `grass_block` 变为空气。身体从槽内 Y67 到出口外约 Y73，原有木板 4、安山岩 1、橡木 1 的数量均保持；未证明掉落物是否被拾取。北向、南向失败是可达集合耗尽，不是两百万节点预算用尽，增加预算不能解决这份地形的普通步行出口。空列表下已有挖掘路线也说明本处不需要先接通垫方块才能脱困。

实服另有独立材料缺口：21:23 的只读 `scaffold_materials` 返回 `materials=[]`；21:29 只读登记 NBT 的 `scaffold` 字段实际缺省，并非显式清空。源码默认引用 `#numen:scaffolds`，现役 JAR 却没有标签资源，不能归因为角色主动不愿使用已有材料。21:38 第二次隔离运行尝试调用原生 `ScaffoldMaterials.store`，但临时身体没有登记到 CompanionRegistry，调用未生效，日志中的有效列表仍为空。该运行原始 GameTest 通过和两块挖掘结果照留，审查层明确 `effectiveMaterialConfigurationVerified=false`；它不构成“显式允许材料”的有效对照，没有继续追加变体。

证据统一冻结在 `runtime/retreat-native-reproducer-20260924/native-terrain-final-proof.json`，SHA256 `616a68ca0a61b702a8667317c0353427f37680793bca454d149120fc82a486fa`，引用两份原始日志、各自测试源码、region/局部方块哈希及逐 tick 位移。前两次夹具失败也保留：第一次截断地形底部导致砂砾与植被变化；第二次局部导出早于完整区域快照，海带状态不一致，开测前即被拒绝。最终有效基线由同一份完整区域生成预期状态，没有修改失败证据。

**这不是生产脱困验收。** 隔离环境为 Minecraft 1.21.1、NeoForge 21.1.233，生产为 21.1.248；采用和平难度、禁随机方块更新以隔离地形因素，没有验证受击期间的存活。只复制地形，没有复制生产角色、Town 或玩家放置方块的持久权限记录；原生权限代码未改，也未授予额外权限，但这不能证明生产中的两格允许破坏。若接入有限自然挖掘自救，仍须单独保留建筑保护、命令总预算、身体所有权和精确回执。本次对生产世界零写入、零模型调用，没有放开现役地形修改权限。

## 死亡恢复正式部署

最终 Python 批次 `runtime/continuous-navigation-source-qa-a085af5daa/` 在实际 survivor 镜像通过 **908 项具身和 38 项实践**，124/16 项来源在执行后仍逐字匹配。新具身报告 SHA `894bc27d6d17d48a63851f87c7382b5126b8e07a54de67b4dfcb708df36c1c17`，实践报告 SHA `67302a7b73a6ec7c7eab18458728e9d02ef7fbdde023dc7d72f023c0a26c152d`。前一冻结批次 `038567f7d2` 的 905 项也通过，但之后发现死亡预检三次停一天的问题并修订源码，因此该批次的 `sourceHashesStillMatch=false`，没有用它发布最终证明。

维护 `death-restore-migration-20260924` 于 21:46 暂停新准入，原任务 `task-12f3661d1549` 自然完成，drain `b250e825ee9b450bb551a25be702fd15` 于 21:47:19.194 完成，没有取消模型任务或重放动作。3688 个 JSON/SQLite 状态文件备份于 `runtime/component-backup-20260924T134833365353Z/`。管理器 21:49:13–21:49:27 保存世界并停止必要六服务，21:49:49 安装候选；只变更实际 actuator JAR、server-extensions 对应条目和新的真实构建记录，Numen/WorldBridge 及关键角色存档字节保持。发布记录 `runtime/death-restore-deployment/20260924T134949945112Z/deployment.json`，部署助手默认只读，额外 11 项隔离维护边界回归通过。

管理器于 21:50:17–21:54:11 恢复六服务，实际具身和实践健康检查通过。原 game Qwen 没有重启，53 项工具权限及原模型保持。21:54:42.859 恢复桐人，21:54:44.202 恢复 NPC 准入，本次维护已结束，不得重放。前后 16 个完整角色 profile、16 条原关闭 Cron 精确一致，未重载其它服务；记录 `runtime/livestream-loop-maintenance-20260924/20260924T135530507022Z/death-restore-preservation.json`，SHA `6e9f175b349e3bc5b03f65962395ecc4fd38c29d5d065322249677e82bbc713e`。原观察者客户端重新入服，实际跟随、距离 0、同维度，失焦暂停关闭。

正常循环于 21:54:43.724–21:54:43.898 自动完成原身体的真实死亡恢复，持久记录为 `server/mc/shadow/data/qd-numen-restores/d4ac9523-4962-43ed-98c5-19b49e104048-35546478.json`。死亡原因为 Creeper，选择了旧判据认可的出生点 `(-539.5,63,868.5)`（后续确认是浅水死角），当前死亡后背包、饥饿和经验三项匹配均为 true；新鲜身体观测和下一模型任务也证实原 UUID 在线。日志中首次登录旧 `.dat` 坐标发生在 factory 最终放置之前，不代表仍留在死亡点。持久 audit 的终态看 `status=completed`，其中继承的旧回复头 `ok=false/phase=rejected` 没有同步更新，不能把这两个字段误当成该次最终命令回执。

代码提交 `0a3ee5e`、`c09f19c`、`d4ca44a` 已正常合入并推送 main `ac8dfcadf9bb773954b6b922b30a405c0c4c8579`，保留原主干内容。唯一合并冲突是 move 工具说明，采用已测试的连续导航说明，124 项相关来源的 Git 内容与已测代码一致。原主干额外 formatter 测试在实际 game Qwen 2.2.1 镜像 **7/7 通过**；第一次误用 survivor 2.2.0 镜像产生的 API 参数签名错误没有被称为代码修复。

第四自然窗口为 **21:54:42.859–22:04:42.859**，原始样本在 `runtime/continuous-navigation-live-1790258082/`。恢复出生点证明死亡流程纠正，不代表自主步行进展；完整游玩验收须继续按窗口内真实工具、动作与下一目标分别判断。

## 第四窗口完整结果：恢复接续有效，持续游玩仍未通过

本次 600 秒窗口取得 599 个宿主样本、229 个不同的新鲜身体观测；采样进程比恢复晚 1.865 秒开始，初始 11 个离线样本属于恢复基线。原 UUID 恢复后没有新死亡或身体 tick 回退，HP 保持 20，不能计作治疗。首末水平净位移只有 **0.986 格**，最长连续同点约 **147.188 秒**。采样中的身体持有者以 idle 为主，没有证据将站定归因于防御反射。

三个原生 Qwen 任务中，`task-7dbde97af9e2` 于 21:57:17 完成，`task-d6e60efbbcdb` 于 22:01:58 完成；`task-27e2400c53e8` 在窗口结束时仍活跃，未把窗后终态算入本窗。第一个任务最后工具是 `navigate`，实际收到 `motor_queued` 和 `turnCompletion.requested=true` 后结束，没有再调 remember，证明异步收尾钩子真实生效。相同任务活跃期间有身体派发与结算，只能证明快慢任务重叠，不能据此断言供应商正在推理等待。

唯一 `base_navigate` 实践为 `91a1bf52766cc23ed155984ee4276e287707e811e9e24dccceda5743a4f31265`。它自主接到 XZ 目标 `(-539,863)`，真实勘察后只派发了一段 goto：action `6bc37e0e2d534a75b4d57e65ef7a9df9`、原生 `t3`，21:57:29.140–21:57:31.594 确认未到达。随后正常进入 `replan/navigation_completion_not_confirmed`，21:57:39 正常结算实践并释放 motor，新慢任务继续；没有重现旧 claim 永久占用，但也没有实现连续走到目标。

本窗共确认 **9 个不同的实际原生动作：7 次 goto、2 次 eat**。其中只有一次 goto 确认到达，实际移动约 1.590 格；其余 goto 失败不能全部归为同一个原因，既有原生日志的 `TERRAIN_BLOCKED`，也有水平接近但高度仍不匹配的观测。另有放工作台 `outside_construction_area`、造物术和通用交互 `protected_area`、四次 `walk_height_unverified` 在派发前拒绝，不能把这些工具调用算成身体动作。

两次进食分别是幻翼膜和鸡蛋，原 action `296da4e6e60b4c84a5c7e184d5b315af`、`a04c361a51ee442987d685c44264c3e9` 的持久原生回执均明确“can't be eaten or drunk”，没有消耗成功。饥饿值 **8→7**。原模型公开提交的意图是前往公会工作台合成面包；到该目标的水平距离 **6.331→7.314 格**，本窗没有补给或目标推进成功证据。

21:59:23.804 的自然发言为“饿得头昏……公会区就在前面，但路好像被什么挡住了。让我慢慢摸过去！”。文字 `say-4e7bf3b0506b2f7e110bf5d0792d99025f030ddd` 已发送，音频 `speech-7b2eccc46a1abdd74fa315ddd744af67c91cb421` 于 21:59:26.090 开始、21:59:34.342 以 `audio_completed` 结束。它证明服务端发送及音频任务完成，不代表真人听感或足够的直播互动频率。

冻结证据：`runtime/continuous-navigation-live-1790258082/final-review.json` SHA `bebfd6081a769c9944e8441496322712cdaf665d27a50ada59886887e26ae070`；`analysis-final/analysis.json` SHA `2b9dd883faa455c54bd6b5c381444106a459f830e2ba3356878dbac91cbaf95f`；`native-task-metadata-final.json` SHA `65eb8f8cfc29b0c5eba57df13698706cd54a12ba6be612981e1991f1f6a553e4`。分析只读取工具、回执与任务元数据，没有导出模型内部推理或注入动作。后续落脚地形与接口修正的候选、部署及新窗口应另记，不能覆盖本窗失败事实。

## 第四窗后的具体修订

### 出生高度与真实地形

旧死亡选择器先查出生高度下一格，`(-540,63,868)` 的脚部流水竟通过站立判据。现场 12 项方块断言、4 项候选列断言和存档局部图均确认这里是水景与玻璃旁的小片干地；保守干地步行图仅连通三格，不能由此断言所有原生水路都不存在。上方 `(-538,65,869)` 平台有通向外侧的干燥路线。

第一个候选尝试原版全高地表算法，但随后正式救援勘察返回了 Y179/Y183 的高空结构。实际存档列也确认 Y165–182 有悬空木方块，因此该候选 `619347c5…` 被弃用，不能以只复制 Y61–71 的测试证明真实整柱适用。最终选择器改为原世界出生高度至上方八格、原小邻域内的已加载干燥站立点，先取高度偏差最小者，再按水平距离选择；不向下一格找流水，也不取高空建筑。保留身份、死亡后当前存档、单次持久记录及未知不重放规则；这不是任意地形出口可达的保证。

### 自身补给与终态反馈

项目的 `give` 是现有造物术，原 world 服务要求等级 2、20 法力，限定物品及数量，目标强制为发起者；没有材料消耗规则。旧网关误将它归为城镇内禁止的地形法术。本次只将它纳入自身效果，参数只接受原有 item/count，仍经相同租约、world 规则、实际派发与回执结算；没有授予角色物品或等级。

两次失败进食的原生回执早已明确不可食用，顶层动作投影却漏掉了错误详情。本次只提升已确认 eat 终态的真实文字，最多 360 字；不猜食物名单，也不改变未知状态。审查中发现 goto 的同名字段仍可能是最初受理文字，因此撤下了泛用投影版本并中止独立 QA `cf59026196`（退出 137，未发布），最终版本明确不提升 goto、其它动作或未确认结果的这类文字。

实际 survivor 镜像三个相关模块 **104/104**，原 world 法术模块 **33/33** 通过；证据 `runtime/self-give-feedback-20260924/verification-final.json`。另确认公会交付/领取、eat、craft 并非都被城镇圈拒绝；通用 `interact_at` 仍存在过宽的城镇拒绝，未在本批放宽，位置类法术亦不能简单当作自身效果。完整回归、生产发布与新自然窗口结果在后续记录，以上定向验证不能替代自主补给成功。

### 地形与补给候选的完整验证

最终 actuator 候选 `759c088089c30eaaf6309dd0a83dc6db699a35962442d09acd8632d286f49a79` 通过 153 项编译契约、真实隔离 MC 28 项检查。实际出生向量为 `(-537.5,65,869.5)`，对应脚部方块 `(-538,65,869)`；原生行走约 5.383 米到干燥出口，1624 个原实心坐标在行走前后无变化。真实高列和额外整片高空天台反例均未改变近地选址。JAR 只改变 `ExistingBodyRestore.class`，其它 11 项逐字保持。报告 `runtime/actuator-death-qa-f577033855da/result.json` SHA `ea4045ea83c23b49d1525a345e225e3fe460f09e0ea382ac09775696931c5e33`。

测试夹具的失败也保留：第一次将粘贴地形前的状态当作行走前基线，复制边界外缺少支撑，134 块沙子/砂砾自然掉落；第二次把完整差异塞进旧测试 RCON 返回体，超过单包限制而截断。最终在行走前保存已稳定地形的实际基线，完整差异写到隔离证据文件，返回体只含有限计数；没有豁免任何被检查的实心坐标，也没有修改生产候选来迁就夹具。正式生产 RconClient 原本已拼接多包，这次失败来自测试工具的旧单包入口。

补给与反馈批次 `runtime/continuous-navigation-source-qa-7fa2e6ff9c/` 完整 **914/38** 通过，124/16 项来源一致；具身报告 SHA `d5923ac8b5c456ea8dcb10099afee0618ed9330de159ba9fd129aa06a7d46640`。代码分别提交为 `181ac2c` 和 `22f03b6`。随后现场维护又发现以下竞态，因此该批次不能充当后续 controller 修改的最终源码证明。

### 维护时暴露的认知准入竞态

新操作 `death-surface-landing-20260924` 于 **22:43:23.659** 暂停 NPC 新准入，**22:43:29.280** 请求 drain `c6528bd5d3cd4d77965c608e91222ccd`。该请求在慢回合上下文准备与认知租约建立之间到达；22:43:31.697 的 `open_cognition` 明确抛出 `cognition_admission_closed`，22:43:32.060 服务把它当普通 ValueError，写为永久暂停。旧 `drain_at_boundary` 又要求 enabled=true，使已暂停的原请求永远停在 requested。服务进程和心跳仍在，重复 drain、等待或只重启旧代码都不能修复这一条件。

原模型任务在 22:42:38 已自然完成，最后原生身体动作 t32 在 22:41:30.857 已明确结束。异常处理确实进入 `stop_actions`，审计没有发现已知任务被取消；日志没有逐条 task_stop RPC 记录，不能宣称独立证明从未调用该接口。原始审计见 `runtime/death-surface-landing-20260924/drain-race-cancellation-audit.json`。此时尚未纠偏位置、停止 MC 或安装新 JAR。

最小修复只识别这一确定未提交的准入拒绝，保留其它错误的保护行为；已暂停但有原 operator 请求的 drain 可以正常核实空闲并结算，继续阻断未知、占用、未完成技能及实践。旧代码两项实证重放均失败，新代码 25 项相关回归通过，见 `runtime/drain-admission-race-20260924/green-report.json`。3730 个状态 JSON/SQLite 已备份于 `runtime/component-backup-20260924T145010131952Z/`；后续管理器重载必须让原请求自行完成，不能手写完成标志或重新提交原动作。

### 第五次维护实际执行

最终完整回归 `runtime/continuous-navigation-source-qa-16fe47cfe6/` 为 **919 项具身、38 项实践全部通过**，124/16 项来源逐字一致。正式发布的具身报告 SHA `11e126d967c97b52afe6cc01b883c4f29407f28ebbbc6d5bb898fca4def7eac5`，实践报告 SHA `c534b926c451bb69861df60e873c724bdf6f0c4705104e7d7bd1390a381b20d5`。竞态修复提交 `1adf140`。

管理器于 23:01:11–23:01:21 仅重启 survivor，原 drain `c6528bd5d3cd4d77965c608e91222ccd` 于 **23:01:18.689** 被正常循环确认完成；enabled 仍为 false，pauseReason 转为 operator_drain，无动作重放或模型取消。没有改写完成标志、建立新请求或提前 resume。

第一次纠偏只读预览遇到 `body_action_busy`，未取得共享锁、未创建 claim、未发世界命令。正常排空后的 survivor 仍采集状态并短时持锁，因此管理器先停止该控制器，再以相同已完成 drain 和新鲜全角色快照重做只读预览，通过后执行一次固定纠偏命令。原生 ACK、已核验支撑格和14项原始字段全部确认一致，sendCount=1、executionConfirmed=true，记录 `runtime/death-surface-landing-20260924/correction-apply.json`。位置从旧恢复造成的水景死角纠正至 `(-554.5,64,866.5)`；这是维护者纠正旧恢复错误，**不算自主逃生**，不计为自然窗口位移。

管理器于 23:03:24–23:03:35 保存原世界并停止必要六服务。全16角色空闲、16条原关闭 Cron 保持，23:04:35 发布最终 actuator `759c088…`，只改 JAR、清单对应条目和构建记录三个目标。Numen、WorldBridge、原世界和关键角色存档的发布前后字节保持；证据 `runtime/death-surface-deployment/20260924T150435221608Z/deployment.json`。旧观察者 PID80288 经进程名、精确启动时间和原客户端目录核验后关闭，等待原服务恢复后重新启动。

六服务于23:04:52–23:08:51经管理器健康启动，实际具身与实践健康检查通过。23:09:07.393恢复桐人、23:09:15.403恢复NPC准入，本维护已结束，禁止重放。新快照证明16个完整profile、16条Cron全视图/规格及原关闭状态逐字保持，未重载其它服务（包括原game Qwen）；记录 `runtime/livestream-loop-maintenance-20260924/20260924T151009562147Z/death-surface-preservation.json` SHA `0ebb99d0c12c7d533e129dd7994803c70e1c244e7dbb59e3bbe14f6b9364deb2`。观察者新PID31348已上线、spectator跟随、同维度距离0，pauseOnLostFocus=false。

第五窗口 `runtime/continuous-navigation-live-1790262547/` 指定23:09:07.393–23:19:07.393；因准入恢复与检测，实际首样本晚9.223秒，必须如实计缺口。启动离线状态、恢复与维护纠偏均不是自主动作。

代码 `181ac2c`、`22f03b6`、`1adf140` 及发布清单 `af209be` 已正常合入并推送main `6e0581a00153db1cd2b39a2a5d89e87de662ad85`，远端精确核验相同。合并无冲突，124项相关源码的Git规范化内容全部与已测根提交匹配；这不代表第五窗口已通过。

### 第五窗口中复现的快循环等待

第一自主慢任务真实选择了 `navigate(-544,865)`，但连续程序还没派发goto就以 `navigation_survey_unusable` 结束。实际原生观察为 ok/available、有125个已加载方块和5个候选，不能归因为地形无路。取得观察后同一主tick又同步准备/提交新慢任务；记录 `slowHandoff=8810.43ms`，原生观察1790262624113到下一body身份1790262633459相隔9346ms，超过程序原5秒新鲜度检查。程序/实践正常收尾和下一模型成功运行只能证明失败被正常处理，不能证明快层未被慢提交阻塞。后续修复应针对这一实际调度次序与同步等待，不把无限放宽感知有效期当成解决方案。

首条自然say已发文本，但音频以no_voicechat_listeners失败：observer游戏23:09:52.019上线，voice直到23:09:55.645连接，晚于音频失败约1.434秒。事件顺序证据 `initial-speech-connection-order.json`，未用维护者主动say补造自主发声。

### 第五窗口完整结果（仍未通过）

23:09:07.393–23:19:07.393 的591个宿主样本/203个新鲜身体观测包含首9.223秒缺口。HP20、hunger7保持，无新死亡、防御接管或unknown；净位移约1.903格、最长同点118.307秒。五个原模型任务中四个窗内结束、最后一个仍运行；实际工具为16move、19status、2navigate、3say、1scan_blocks、2remember，0give/0eat。

10个不同原生goto中，9个普通动作有5完成/4失败，另一个程序动作完成。第二次base_navigate实际移动约7.675米到 `(-555.309,64,864.777)`，随后脚下落点观察仍以 `navigation_arrival_stance_unconfirmed` 收尾，不能将原生goto完成当成整个程序done。两次程序均完成失败结算并释放队列，后续慢回合接续。

3次自然文本发送对应2次音频completed、1次连接就绪之前的no_listener失败；没有操作者主动发言补验。第五窗改善了局部身体移动与声音接续，但没有完成持续导航或补给目标。`summary.json` SHA `6789b42a09e4f4e5a78c4adf4e909ec0c8f7b5d06dbf47be4cda193373b3f5b2`，独立完整报告将补充精确口径。

第五窗独立工具审查 `final-tool-review.json` SHA `22ed6b740bbf9ae4f35afc0cb2611825e96a82ad57d7eaa50ab78596d6c687b1`；独立物理审查 `physical-review.json` SHA `cc064586d26e91568f47bd47528e27887c8df2d39e100aa60e6a245db2a45332`。16move调用实际只形成14请求（2次额度拒绝明确未派发），其中5次站位预检拒绝、9次真实goto；另外2个技能请求共派发1次真实goto。首次排队身体动作前的约2.343米位移无法归因于自主动作，另列排除。最初完整目标(-544,865)距离10.607→最近4.169→末11.311米；后来模型改局部目标(-555,865)，终点距离0.381米但程序未确认，不能声称已到公会。

239条去重时序显示attentionAndLife中位979ms、p95约4747ms、最大9337ms，slowHandoff最大8810ms。原四段计时尚不能证明具体函数归因。纯源码审查发现社交候选查询走SQLite写事务/绑定更新，以及原native submit/poll/resolve_chat同步HTTP都在motor主线程；这些是待分阶段计时验证的阻塞来源，不能直接归因为提示词过长。

另外只读复核通用交互误拒：interact_at在区分左右键/目标前就套身体周边5格及目标保护圈，会挡普通门/工作台使用；但craft已有不套该保护圈且可自动找到/打开可达工作台的路径，所以不能将所有合成失败归因于interact_at。原生默认use_block许可也不能替代现有仓储所有权规则，本批不笼统移除保护。

模型原生任务末次usage另显示76k–91k输入token级别；现役envelope在每个MODEL_CALL_END覆盖response.usage，因此这些不是整任务总量，不能相加冒充精确花费。正在按实际元数据与原输入结构分析历史/工具/常驻说明的份额；尚不能仅凭输入长度断言它造成某个同步阶段的延迟。

### 新导航调度修复与提交异常

第一条有效16格勘察结果在旧主循环中延至下一次快层调用。该tick又同步准备并提交新慢任务，`slowHandoff=8810.43ms`，超过导航证据的5秒有效期。新代码在同一tick有界消费导航勘察：最多3次观察、4次程序评估、1次身体动作；保留原新鲜度、租约、队列和原生落点核验。并将 `prepareContext`、`nativeSubmit`、`taskPoll`、`resolveChat`、`attention`、`dialogue`、`life`、`confirmOnline` 分阶段计时，以便实测同步阻塞来源。`status` 的原单一文本块改为无多余空白的同一JSON；按第五窗19条回包测算，254121字节可降至164967字节，但这不是供应商token或响应时长的实测收益。

隔离无网真实镜像执行 **942项具身、38项实践测试全部通过**，125/16项来源哈希与当前源码相符；报告 `runtime/continuous-navigation-source-qa-ecd81dbd47/summary.json`，正式报告 SHA `8bbba0b3a6b4101bff0c3eff46b71e7d9cad962b6006a39be24ceef03d565b9c` / `f840a082053c4c60e969b69340bb4e3b8df46ca00cdc874adb72738a106174f2`。此前完整QA的旧测试解码助手未接受显式 `CallToolResult`，真实失败保留，改助手后重跑整组；不是删除断言。

23:55另发生独立的提交异常：控制器为 `survival-4bc4a4f105164fb28d4f2430ffa7c5fc` 保留了回合，原生 durable receipt 停在 `phase=unknown`、无taskId，模型提交结果无法证实；旧控制器随后停在 `cancellation_uncertain`。原会话23:55:00已有12字节外部用户输入，直到23:55:21才完成；新提交23:55:08发生在这段活动中。原生源码对同chat并发明确返回409，**这使409高度可疑，但原HTTP响应未保存，不能宣布该提交已被拒绝**。当前自动控制与外部手动聊天复用 `life-*` 会话，存在可复现的竞争入口。

新维护 `navigation-freshness-20260924` 暂停NPC准入，请求精确新drain `6590d1545e754600a4c5a3e8f69f5a5c`。在16角色空闲、16条Cron仍禁用、完整配置快照后仅重启Qwen和survivor；管理器的最终健康等待超时，记录 `runtime/operations-actions/`，不把该操作报为成功。新Qwen进程时间晚于原unknown receipt；专用只读预览与10项离线夹具通过。管理器停survivor后，固定身份/CAS/两次原生idle/新鲜身体与无未结算动作均通过，**仅**将原保留槽位记为 `operator_retired_unverified` 并清除active，原receipt、额度和记忆水位原样保留，不重发原POST。然后管理器启动survivor，新源码正常完成原drain；维护者恢复自主与NPC准入。原提交是否执行依旧未知。

重启期间原生技能清单曾与学习索引不符，三项旧技能被启用，导致Qwen健康检查短时失败。保存原清单后仅通过原生disable端点将这三项恢复到索引状态；随后运行配置检查与Docker健康均通过。外部手动会话又在00:18:23触发一次新原生任务并于00:20:40结束，还激活一项新导航学习技能；这些动作没有算作桐人自主窗口收益。第六个自然600秒窗口由 `runtime/watch_navigation_freshness_resume.py` 在00:24:10.151恢复后启动，结果待满窗汇总。
