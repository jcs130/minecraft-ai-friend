2026-09-21 公屏/剧情收尾补验：源码与生产各181具身测试在实际Linux镜像重跑通过并更新真实报告，Windows缺依赖失败保留。原女神16:51定时班次自然成功。收尾桐人越界X约2.9导致outside_work_area退避/旧心跳，原女神任务task-d4e64bc70fbc以新鲜检查和单次原生救援rescue-20260921-mcgod-kirito-01确认回位(-2.5,69,951.5)，原gateway与具身健康恢复通过；未放宽边界、未知不重投。工程case-b05603e6b0a2590e325e留存越界无法自主回位根因，未称根治。Jev/Qwen/模型路由相关panel通过，全局其他旧验收问题保留。

2026-09-21 公屏NPC与剧情已接通并部署：world单次Jev选择女神/已有NPC/忽略，复用npc-inbox与原人物/公会路由；真人日志入口让位不抢答，公屏保持交易教学。档案版本、加载/同维度距离与SQLite事件去重，未知不重发；仍点对点文本、重启不补历史聊天。剧情复用qd-guild-planner（旧mc-priest已合并）、mc-god审批、原content tick；NPC读取当天已发布的自己的阶段/合同状态，不把预设结局当完成。源码141 Python+30 Node、生产135+30通过，官方合成8/8 270–910ms；离线QA入口实服被正确拒绝，未做真人窗口/音频验收。两原生任务实际发布《秋夜四境》content-4b35f797da9a4587cdf1bd72，引用4既有合同、目标/奖励哈希不变，四NPC投影读回。仅world/NPC各重启一次，10角色指南官方同步、完整Qwen健康通过；原配置/准入已恢复，按用户要求启用两条旧剧情/女神Cron，工程原关闭保持。Cron恢复必须读取未来next_run_at；POST resume可能仅翻标志或保留过期时间，应沿既有operations_cron_maintenance同spec PUT重登记，不新建任务。桐人结衣恢复新轮，完整RSI/剧情质量未验收。runtime/public-npc-20260921与public-npc-guides-20260921均结束，勿重放；见docs/PUBLIC-NPC-STORY.md。

2026-09-21 交流与进度衔接已部署：社交pending纳入250ms轮询、原生认知1秒查终态；Jev真实693.88ms/控制器1124.22ms未过期，仍shadow，不称80ms或整体准确率提升。原消息SQLite同伙伴最多三条合批，实服3→1与2→1原生任务/世界heard均验，未知不重发。原生POST入口保存精确turn/session/task回执供未知对话只读接回，旧无回执请求人工归档非自动恢复。复盘具名增量指导恢复，最终Agent实际更新goals当前阶段，但文末仍有旧目标和未证实推断，非记忆质量/自主RSI全部解决。最终源码/生产181具身、生产34实践通过，此前169通信通过；相关panel通过，其他历史失配保留。第二次维护就绪检查失败后shell分号误执行停止，结衣原任务失败保留，新任务已恢复；所有依赖维护动作须先确认退出码。10profiles/16Cron及准入精确恢复，桐人/结衣新轮运行。runtime/social-progress-20260921、social-ack-20260921、review-order-20260921均已结束，勿重放。见docs/EMBODIED-SOCIAL-SCHEDULING.md。

2026-09-21 女神意图与城镇方块保护已部署：完整技能名/CLI 零推理，私聊 Jev 固定候选施法/答疑/祈愿，公屏仅判断女神是否接话；否定/问句不施法，低置信回原路径，2 槽/2 秒/过期丢弃，无新服务。保护名单 88,134 格，空位可放床/建设、新方块可拆；建筑道路与全区火焰/流体规则保留。源码/生产各 95 Node、167 Java 断言、9 健康测试、隔离原生 13 项通过；生产两项探针通过，未证明真人准确率或 LLM 节省。旧 goal_agenda 缺授权已由原生策略 API 补齐至 49 条，凭据与 Qwen 完整健康验证通过，10 profiles/16 Cron/准入及桐人恢复。首次 QA 夹具、MC 180 秒启动超时及 DTO 相等断言失败照留；全局其他旧验收失配不改哈希冒充通过。见 docs/JEV-SPELL-ATTENTION.md；runtime/intent-town-20260921 维护已结束，勿重放。

2026-09-21 系统1实战补验：桐人原生创建prepare_for_task并依据人工反馈两次refinement，真实装备/进食回执已关联Decider（92.15/68.76ms）；最终苹果-1、hunger5→9、实践ae855857为done且目标观察true。首版参数拒绝、第二版错误终止判断保留；程序执行视图成功为succeeded，原始receipt为completed，勿混淆；equip_item必须含action:"equip"，objective.checks为AND。既有audit补关联验收，不把两次异质实验当A/B或完全自主RSI。证据runtime/system-one-live-20260921，勿重放目标提交脚本。详见docs/SYSTEM-ONE-NATIVE-CONTINUITY.md。

2026-09-21 后续持续运行根因修复与系统1已部署：原生task准确404且tracker idle/0才把丢失推理记failed；无结果不重放、不算动作成功。普通IO和已知推理失败退避，人工pause/drain/未知动作保持保护。自有MCP同值白名单PUT触发限定2.2.1 DriverManager reload，完整凭据卡保持；结衣新轮先检查工具。服务管理启动Qwen进程后先拉起survivor，最后严格核验Qwen完整健康，失败照留。用户已有Decider接技能choose候选入口，367ms真实状态影子推理，未做WASD训练。97具身/34实践、6旧晋升版本35用例实测通过；10profiles/16Cron原样恢复，MC/world未重启，control更新后一次重启。维护system-one-native-20260921已恢复勿重放；详见docs/SYSTEM-ONE-NATIVE-CONTINUITY.md。

2026-09-21 持续运行修复已部署：桐人已有模型 task 的临时查询故障按原期限退避、不重复提交；结衣旧丢失任务复用显式对账机制释放，旧 unknown 回执保留。公会四个讨伐统计条件修正为 minecraft.killed:minecraft.<mob>，缺失 objective 已原生创建，不清零玩家分数。原 10 profiles/16 Cron 恢复，仅 NPC/survivor 停启；原禁用班次保持。MCP 熔断需官方 PATCH toggle 重连，完整 Client DTO 写回可能丢自定义凭据别名，不可覆盖原环境引用。84 项生产字节冒烟、73 控制器和 9 女仆对账通过；其他历史健康失败照实保留。维护已结束，不重放恢复脚本，详见 docs/AGENT-CONTINUITY-REPAIR.md。

2026-09-20 23:45 技能部署收尾：NPC重启后的4条原生HTTP连接inactive已通过同值官方API重连（桐人qd_party、两人物maid_native、结衣qd_party），工具3/7/7/3与配置/权限全等；numen_survival原已正常。新维护skill-system-reconnect-20260920已结束，10profiles/16Cron再次精确恢复，无二次服务重启。今后依赖服务恢复后再同步角色技能，并实际读工具清单。

2026-09-20 23:36 技能罗盘与CLI修复已部署：默认我的技能、学习图鉴分离、不可用原生法术禁用、铁魔法三步指引与按需help；目录实服8→35（9秘术/26主题别名，对应21原生法术），不授予装备/重写进度。旧平衡层拒绝原生映射无效调参与非有限数值。botgate8f669d9f，Java285/Node97/独立原生7项/实服只读4项通过；未做真人画面手柄或证明平衡性能收益。10角色两套指引通过官方API同步，原profile/16Cron精确恢复，工程Cron原关闭保持，后续case-ad416b71edb9e6d6d43a要求先补固定技能测试覆盖。新skill_system和主城保护探针通过；旧验收来源失配保留，练习34项Linux重新执行后旧报告归档。13服务/12健康恢复，无新增daemon。维护已结束，勿重放；详见docs/SKILL-SYSTEM-REVIEW.md。

2026-09-20 23:02 主城悬空残块已实服清理：正式存档扫描后清除1,245格残块，两盏新路灯从(-726,66,898)→(-726,64,898)、(-562,68,880)→(-562,68,883)落地。1,256坐标保存后严格验收通过，城区/矿道周边低空孤立组53→0，144组斜角连接结构及5,051格完整空岛保留。初次post=0仅两节栅栏南向连接派生状态，原attempt=1/post=0及失败回执保留；未重投，独立只读验收verified=1。53临时forceload全释放，正式前/中/后备份save-on确认，保护4项健康通过。未改实体/物品/角色/调度、未停服。勿清锁重跑；旧重建50,034格及保留体积报告属于此前阶段。本轮西岸设施区仅清41格孤立树冠，不触及功能块。详见docs/TOWN-FLOATING-CLEANUP.md。

2026-09-20 22:16 原址扩建与主城保护已部署：25处建筑、44床、8街区、道路/河桥/池塘/矿口建成，正式存档50,034目标格无未解释差异；原80实体（33村民、6铁傀儡等）同UUID回迁，30原资产完整NBT迁入可达档案库。主世界X[-715,-375]/Z[695,1035]全高保护已启用：普通拆建、爆炸、火焰、流体和活塞破坏受限，门/仓储/交易及成熟农作物收获补种保留，管理员原有维护命令仍有权限。既有bridge361636f6与Numen楼梯修复5e913b2f已精确部署，152离线/26隔离原生保护验收与生产4项探针通过；不把副本试验冒充真人客户端实测。桐人/女神原UUID、完整背包、XP及能力保留，公共返还点(-554.5,64,866.5)，个人传送点保持；原10角色16Cron恢复，原禁用任务保持禁用。223施工forceload已逐个释放，临时平台撤除，正式备份与单次命令回执保留，勿重跑施工或恢复身体。全局历史验收失败不重写。详见docs/TOWN-EXPANSION-DESIGN.md、docs/TOWN-PROTECTION.md。

# AGENTS.md — B 仓(minecraft-ai-friend)工程纪律

## 功能上线三件套(Definition of Done,2026-08-29 立)

> 背景:守卫桥暴死三天、背包卡被顶出视口、numen craft 坏、成就通道挂空目录——
> 全部是造物主使用时撞见,无一主动发现。功能「写完」不等于「完成」。

一个功能只有配齐三样才算上线:

1. **健康探针**:在 `ops/health/health_mon.py` 的 manifest 里加探针
   (HTTP/进程/容器/文件新鲜度/协议应答任一适用形式);
2. **看门狗**:常驻进程必须被某种守护覆盖(schtasks 幂等拉活 / 容器 restart 策略 /
   health_mon --auto 恢复动作),不允许裸进程;
3. **冒烟断言**:改动的用户可见行为(UI 页面、API 应答)在 `health_mon.py` 的
   `probe_panel_smoke` 模式下有断言,改完跑一遍绿了才算完。

改 UI/面板:跑 `python ops/health/health_mon.py` 看 panel-smoke。
新常驻进程:登记到 CONTAINERS 或进程探针。

## 已固化的工程铁律(踩坑沉淀,详录 LESSONS.md)

- cmd.exe 内联多行 python(heredoc/`python -c` 带中文与引号)= 转义黑洞,一律落 .py 文件再跑。
- Windows GBK stdout 下的中文比对会假阴性:比对落文件,`io.open(utf-8)`。
- bind-mount 只读挂载的服务(web-panel.mjs / bootstrap-world.mts):改 B 仓源码后须重启对应容器才生效。
- 镜像 COPY 的资产(资产/worker/bundle):Dockerfile 必须显式 COPY,重建镜像会丢「只活在旧镜像层」的文件。
- RCON 探针/脚本:Source RCON 响应包按 request-id 匹配读取,双读会卡到超时假红。
- 页签/满高不滚布局里,卡片顺序=可见性:后加的卡必须显式排位并加冒烟断言。
