# 结衣保护与原生救援

本服为结衣现有身体提供不死保护；这是游戏设定与管理员功能，不是原作事实。保护只绑定 `config/companion-protection.json` 的单一身体和桐人归属。结衣 UUID、人物身份、Qwen 角色 `5swvhK`、会话和背包均不重建。

## 原生实现

TLM 1.5.3 的 `EntityMaid.setEntityInvulnerable(true)` 同时更新 Minecraft 无敌字段、TLM 同步字段；TLM 自身以 `Invulnerable` NBT 保存/加载。单独调用父类 `setInvulnerable` 会遗漏 TLM 保存使用的字段。此结论已检查本服安装 JAR 的字节码，并核对[官方 EntityMaid 源码](https://github.com/TartaricAcid/TouhouLittleMaid/blob/1.21/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/passive/EntityMaid.java)。官方分支可能继续变化，具体运行依据为构建记录中的本地 1.5.3 依赖。

新增 `CompanionProtection` 在服务启动读取一次 `config/qiandeng-companion-protection.json`；不会在 tick 或伤害回调反复读取磁盘。加载到匹配、存活身体时调用 TLM setter；取消该身体的 TLM `MaidAttackEvent`，并在 TLM/NeoForge 死亡事件提供最后一道保护。进入死亡事件且生命已为零时只恢复到 1 点，不定时回血、不赠装备或等级，也不改变 Brain、工作和跟随模式。

本服 Minecraft 1.21.1 的普通 `Invulnerable` 仍允许绕过无敌的伤害与创造玩家伤害；原生 `/kill` 对 LivingEntity 走 `genericKill → hurt`。上述事件保护覆盖这条伤害/死亡路径和虚空伤害。直接调用 `remove/discard`、其他模组绕过事件删除身体、损坏/手工删除存档等不在保证内；虚空中不掉血不意味着自动返回地面。已删除实体不会被此功能重新生成。

## 管理员救援协议

所有命令只允许 level 4 的服务器控制台，前缀 `QD_RESCUE_JSON `。普通人物工具不直接开放 RCON；现有世界管理员队列核准后调用。目标固定为现有桐人、结衣，必须真实加载、存活、同维度且结衣仍归属桐人。

- `qdmaid rescue_inspect <quoteUUID>`：只读世界，保存原位置与安全地表候选。响应 `phase=observed`、`pair`、`safeLandings`、`expiresAt`；无安全落点时对应候选为 null。quote 180 秒有效，同 ID 不重新观察覆盖。
- `qdmaid rescue <actionUUID> <quoteUUID> <kirito|yui>`：目标源位置偏移超过 0.75 格即拒绝；再次检查原候选的已加载区块、世界边界、实际身体碰撞箱、完整支撑、天空可见、无危险方块/流体及其他实体占位。先优先 16 格内上方安全地表；后备允许水平距离至少 4 格、明显更低的安全地表，避免换到原坑底。不会生成方块或加载新区域。
- `qdmaid rescue_status <actionUUID>`：只读原回执；未知不补发。

动作先落持久 claim，再停止结衣旧导航、清零目标速度并执行一次原生传送。仅真实返回成功且原身体实际到达才 `phase=completed, executionConfirmed=true`；拒绝或不确定不能报成功。`before/after` 均为 `{bodyUuid, dimension, position:[x,y,z]}`。同 action 重复仅返回原回执；同 quote 的同目标不可经新 action 重复使用。两个目标分别确认，不将部分成功说成双方完成。

原生 quote/action 账本位于 MC 工作目录 `data/qiandeng-maid-bridge/rescue/`。claim 中断后只显示 unknown，不用当前位置倒推本次执行成功、不自动重放。上层跨服务动作锁、在途检查和模型串行仍由既有管理员入口执行。

## 部署和验收

2026-09-09 已将 `2b9fd77ef84db55281242aa0c2be224e058a73bef4e108edf91070526f650e99` 同步到 D 项目的服务端、客户端和缓存，三份锁定清单随之更新。停服完整世界备份位于 `runtime/character-integration-backups/20260908T192636520839Z`；原世界未替换。132 项离线断言、27 项真实救援/保护检查以及 20 项原有桥接检查全部通过，两组隔离测试容器已清理。

生产重启后，只读 `protection_status` 验证原结衣 UUID/owner，所有保护标记和 alive 为 true；桐人的装备、背包槽、生命、饥饿、模式、维度和位置与维护前观察一致。实际证据位于 `runtime/yui-support-deployment-20260909/`。新原生只读勘察已找到两位身体附近 Y64 的合法地表，勘察本身不等于救援。

上层使用原 NPC 的 45 秒收集周期，不增加进程、定时器或模型循环。`world_admin_receipt(..., wait_seconds=50)` 在当前 MCP 调用里只读等待同一队列回执；身体动作、技能任务或未知动作未结束时不发送传送。结衣只有匹配原队伍身份时才得到管理工具，游戏内来信轮也带相同工具权限；其他角色不继承。结衣特定管理来信单轮 600 秒，其余用途保持既有时长；原来的角色、生活会话和模型保持不变。

每个救援原请求的 completed/rejected/unknown 都由既有 worker 幂等生成天神工程工单，工单状态不会因救出自动变为“已修复”。崩溃遗留的 claimed 仍作为 unknown 记录，只有原生持久回执可以确认完成；不会用位置接近倒推成功，不换 ID 重放。回执可附已经落库的 `engineeringFeedback`，Qwen 可按 caseId 继续补充原因与改进建议。

候选编译：`python tools/build_maid_bridge.py`。隔离实机：`python tools/smoke_maid_bridge.py --run-isolated --rescue`。后者只创建独立内部网络、全新 fixture 世界，生成式模型关闭，结束删除其容器；绝不对生产角色施加测试伤害。离线测试不等于生产验收。

部署时备份原双端 JAR、生产保护配置；将构建记录对应 JAR 同步到原服务端与实际客户端的既有 bridge 路径，将 `config/companion-protection.json` 复制到 `server/mc/config/qiandeng-companion-protection.json`，与管理员入口升级合并一次受控 MC 重启。保留所有存档和外部账本。

生产只读验收：`qdmaid protection_status e6ef6001-47c6-4f13-823c-1b724520d164` 必须同时报告 `configState=enabled`、`configMatched/nativeInvulnerable/tlmInvulnerable/damageGuard/deathGuard/alive=true`。再按已有身份读取确认 owner、身体 UUID、人物资料没有变化；不在生产用 `/kill` 验证。

回滚先停止相关管理员入口并保留 unknown/回执，恢复原 JAR/配置。已保存的 `Invulnerable` NBT 不会因移除插件自动清除；若确需撤销保护，须在备份和精确身份检查后通过原生 NBT/setter 仅还原该字段，不覆盖整实体 NBT。不得用重新生成角色回滚。

## 已知后续：MiniMax 工具格式

2026-09-09 只读核验：结衣当前选择为 `aliyun-codingplan / MiniMax-M2.5`。原生任务 `task-fd98ad4dbc59` 已有真实工具调用，但最后一条普通消息残留 `<invoke name="qd_party__party_send">` 与 `</minimax:tool_call>`；`task-5c99335732fe` 的最后一条消息同样以普通文本输出 `memory_search` 的 invoke，不能视为实际检索或发言。两次仍是原生活会话。诊断只保存类型、工具名和文本 SHA，不导出推理全文，见本机 `runtime/yui-minimax-tool-format-diagnostic.json`。

安装源码 `/usr/local/lib/python3.11/site-packages/qwenpaw/providers/openai_provider.py:489–549` 使用 `OpenAIChatModelCompat`；`openai_chat_model_compat.py:906–979` 的恢复分支只在没有结构化 tool_use/tool_call 时扫描文本。它调用的 `local_models/tag_parser.py:26–37,315–317` 只识别字面 `<tool_call>`，XML 内部语法为 `<function=...>`，没有 MiniMax 的 `<minimax:tool_call>/<invoke name=...>` 适配。上述输出甚至缺少配套开始标签，不能用替换标签然后执行的方式修复，也不能由文本确定供应商原始流为何失去结构。

最小处理先修正当前任务的原生工具白名单（真实工具名为 `memory_search`，不能用治理别名 `MemorySearch`），并要求来信任务以最终纯文本答复、由现有游戏回执通道发声。未确认文本继续被拒绝；此前已确认的救援动作不得重放。安装包内另有直连 MiniMax 的 Anthropic provider 目录项，但它不证明阿里 CodingPlan 路由应该改协议或端点。本轮未实现 MiniMax XML 兼容，也未变更模型/供应商或执行这些伪调用。

## 2026-09-09 收尾核验补充

上文“已勘察”是部署初始时点。随后已有真实生产救援：原请求 `yui-rescue-kirito-001` 由结衣 `game:5swvhK` 提交，原生回执 `fbb6c634-889a-5f34-b7c2-3ee426e8238b` 为 `completed / native_teleport_confirmed / executionConfirmed=true`。同一桐人身体 `d4ac9523-4962-43ed-98c5-19b49e104048` 从 `[-642.6999999880791,49,1057.699999988079]` 到达 `[-644.5,64,1055.5]`。这是一次管理员救援，不能归为桐人自主脱困，也不表示结衣自己的传送已经验收。原生产回执保存在 `runtime/yui-support-deployment-20260909/actual-yui-admin-receipt.json`。

该次救援已自动形成工程反馈 `case-16a730d55bfa4b2660f2`，复用原请求并由逻辑身份 `operations:mc-god` 负责；该身份现路由到游戏 18089 的 `qd-engineer`。证据为同目录 `actual-engineering-feedback.json`。救援完成不会自动关闭工程问题，不重发这次已完成动作。

北京时间 12:05 的只读原生 API 核对确认，游戏 Docker 18089 中结衣的名称已是“结衣”；SOUL 人设、PROFILE 救援职责、AGENTS 操作说明与 `config/characters/sao.json` 精确一致，桐人 SOUL 的救援指引也已部署。原生文件应用及两角色重载均有 `verified` 日志，身份、模型和原生活会话保留。结衣 `/api/skills` 返回 9 项启用技能，包括 `qd-yui-rescue`、`qd-world-team` 和 `qd-party-cooperation`；桐人返回 8 项。结衣 `qd_world_team` 驱动的 13 项实际工具全启用，含救援勘察、救援和等待回执。脱敏证据为 `runtime/closeout-audit/current-native-audit.json`。技能页面按当前选择的角色显示，宿主 8088 不是这些配置的部署目标。

本次另跑六组现有离线 Python 测试，共 73 项通过：结衣身份授权 14、救援协议 10、非阻塞回执等待 1、SAO 人设迁移 16、队伍桥 24、原生 MCP 重载 8。它们不替代当前线上状态核验。此次全量只读健康仍未通过：首次 `qwenpaw_health` 在另一人物 `2PZ2gA` 的原生 learning 工具端点遭遇 HTTP 错误，随后该端点已能列出 10 项；桐人与结衣的 `qd_party` 工具端点当时均为 HTTP 502，尽管管理台队伍投影显示 running。生产 `protection_status` 当时仅返回通用命令异常，没有可验收的当前保护回执；现命令未捕获 `maid_not_loaded`，不能据此判断身体已死亡或保护已被撤销。历史保护真回执仍有效地记录当时事实，不能代替本次在线确认。桐人控制器保留 `action_outcome_unknown` 暂停原因，须先查询原动作，不能为收尾重投或删除记录。

受管技能的后续同步可使用 `tools/sync_team_skills.py --actor game:5swvhK --skill qd-world-team` 预览；逻辑天神使用 `--actor operations:mc-god`，工具按当前映射定位。多角色、技能可重复参数。在已安排的空闲维护边界加 `--apply qiandengji` 才写入：备份旧文件和 ETag、每次写前检查原生任务数、旧文件 If-Match、新参考页以原生独占上传防止覆盖、更新期间禁用该技能、原生完整扫描后重新启用并逐文件读回。未选文件和个人资料不删除，当前被用户关闭的旧技能需另审，不擅自启用；新技能连同参考页通过原生创建。已有技能如果还没有 references 目录则预检停止，不用无条件写入模拟独占创建。异常保留 `requires-review` 日志，避免未知写入自动重放。新增 9 项同步边界测试已通过，生产仅运行过预览，没有执行该新工具的写入。
