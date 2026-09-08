# 千灯纪整合项目

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
- GitHub 主仓库是 https://github.com/jcs130/minecraft-ai-friend；D 项目沿用其历史，原世界源码位于 world/。用户要求完成开发后记得提交：每轮完成并验证的代码应提交并推送当前开发分支，说明提交号与同步状态；保留原历史，不强推。公开提交范围和本机资源恢复见 docs/GITHUB-WORKFLOW.md，不能把存档、密钥、运行报告或第三方资源产物加入源码提交。
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
