# 世界日常运营

2026-09-08 已部署并完成首次生产班次。运营Qwen当前有6个周复盘和1个每日运营任务；NPC原工作线程已经接收新请求目录。root仅提交一次原生cron运行，22:23:55至22:24:25（Asia/Shanghai）约29.66秒结束，原生last_status=success；下次计划为9月9日09:10。

首次班次确实调用了 operations_world_planning 和 operations_request_guild_plan，均返回success。后者识别9月9日已有5条completed草案，返回existing_plan_preserved，没有重复提交公会模型任务。随后submit_operations_report实际保存了司灯的world-daily-2026-09-08报告；报告将过期健康快照与当前世界事实区分开。Qwen原生会话与当日default用量相符：4次模型调用、输入43,619 tokens、输出1,438 tokens；这些是本次完整班次的实际用量，不是“一次POST等于一次模型调用”。

生产只读验收6项全部通过，当前world_operations_health七项也全部通过；证据在本机`reports/world-operations-smoke.json`，带原生会话、回执、报告、用量、旧草案的SHA256。今日实际存在2份旧货单（Agent生成数0）；明日5份草案尚未到发布时间，因此不宣称已完成生产日切发布。原经济发布函数已在隔离文件fixture验证，真正跨日结果仍需以后按合同文件核对。额外11项只读健康测试覆盖“仅配置不能算完成”、假发布摘要、旧报告/失败任务、周复盘覆盖共用marker、源码变化和原生接口失效。

当前世界并非完全静止：world 事件观察、原公会任务看板、NPC近距互动、女仆原生跟随和桐人生活循环已经存在。此次只补运营日常请求与公会执行器之间的缺口，不新增 Agent 守护进程或模型供应商服务。调查时35份村民资料没有配置 routines；原 routine 工作表现是粒子和台词，不能据此声称物资生产已完成。四位公会人物在线，静水与小满是 missing_in_loaded_chunk，未证明死亡，不召唤或恢复。

## 原生班次与执行

运营 Qwen 18090 的司灯 default 增加 `qd-world-daily-default`，每天09:10（Asia/Shanghai）运行。原有六个周技能复盘保留，仍要求新的学习证据。每日任务的 purpose 是 world-operations，不受学习指纹误拦截。游戏 Qwen 的周任务仍是零模型维护，不额外开启游戏 agent cron。

1. 司灯通过 operations_snapshot 核对事实，通过 operations_world_planning 读90秒内的新鲜公会资料。
2. operations_request_guild_plan 仅创建次日不可变请求；已经存在的计划直接返回 existing_plan_preserved。
3. 现 NPC guild-planner 工作线程每45秒消费请求，重新检查候选真实身体的当前位置、固定UUID和职业，再调用原专业角色 qd-guild-planner。新模型请求仍由 QwenPaw 管理。
4. 原 GuildPlanner 按 purpose/day 去重并收集任务；validate_proposal 校验物品、数量、奖励和发单人。
5. 现 gen_quests 和 gen_board 在日切生成新合同。旧合同文件和已经完成的草案不重写。新货单与看板只选择实际在线的发单人，缺失者不会被模板兜底重新选中。

原 qwen_quests 在生成合同时自动提交次日模型的分支已移除，避免两套调度。现有9月9日 completed 草案保留，不为本轮上线重新调用模型。规划完成不表示玩家已接取、交付或获得奖励。

## 持久回执

- 运营请求：`server/operations-agent-state/work/operations/world-requests/YYYY-MM-DD.json`。仅此子目录以只读方式挂到 NPC。
- NPC接收与策划回执：`server/mcdata/village/world-operations-receipts/YYYY-MM-DD.json`。
- 脱敏公开资料：`server/panel-state/world-planning.json`。包含候选key、策划状态、当天实际发布数，不包含UUID、凭据或人物人格正文。
- 草案和合同：原 `agent-plans/YYYY-MM-DD.json`、`quests-YYYY-MM-DD.json` 与 `guild-YYYY-MM-DD.json`。

NPC先持久claim再提交。提交未知只收集已有原生任务，不重复POST；失去回执不能自动制造成功或重新提交。requested是排队，completed是合法草案，publication.published是合同文件实际存在，三者分别验收。

运营派工不再设每日4次或30分钟冷却，配置值为null和0；保留持久串行门、原生终态写回、未知不重投。固定司灯世界班次可拥有最多一个专员子任务，记录parentRunId；其它班次和第二个未完成子任务仍被阻止。原生任务已返回与投递成功分别记录；投递失败不计为成功。原生404、网络异常和中断不会自动释放未知占位。费用统计与历史账本保留。

## 应用顺序

先在正在运行的运营Qwen查询旧派工终态并保存回执，不要清空delegations.json。`operations_native_tasks.reconcile_pending()` 只GET已登记任务；若原生任务已404，可用此前run-reports中精确runId/role/requestId/taskId、nativeResultStatus=completed、reportRecorded=true，并有独立对应的角色报告共同收敛。回写保存两份证据SHA256和原终态时间，没有证据仍保留unknown。此兼容路径不是靠过期放行。

停止仅运营Qwen后运行下列现有compose一次性任务；helper默认只打印计划，明确`--apply qiandengji-ops`才修改。它会备份default的agent/card/jobs，只加两个固定MCP工具与一个原生任务，保留身份、模型、旧任务和后续手动暂停。

```powershell
docker compose -p qiandengji --profile operations stop qwenpaw-ops
docker compose -p qiandengji --profile operations run --rm --no-deps --entrypoint python qwenpaw-ops /ops/configure_world_operations.py --apply qiandengji-ops
```

同一个离线窗口可应用当前模型策略和学习同步；sync_role_learning现在识别并保留这个日常job。然后启动运营Qwen，并仅重建NPC以装入新增的只读挂载和环境变量：

```powershell
docker compose -p qiandengji --profile operations up -d --no-deps qwenpaw-ops npc
```

此步骤不重启Minecraft或宿主Qwen。等待公开资料fresh后，可在运营Qwen以default身份运行一次现有job，核对原生cron执行状态、司灯报告以及请求/策划/发布证据。只看cron启用不能算世界已经运转；9/9已有草案的正确结果是保留，不要求额外模型消耗。新班次的原生POST只在部署者受管验收时执行，本轮实现代理没有调用。

## 已验证范围

使用现有2.2.0运营镜像、`--network none`、项目只读挂载运行相关87项测试：世界请求到原经济发布12项、持久派工11项、公会规划13项、学习16项、公会绑定/库存14项、角色同步14项、运营MCP7项。模型与游戏写动作均为0。临时复制原生profile的configure/重复configure/CronJobSpec/DriverCard通过，实际生产文件未修改。

关键fixture包含：新鲜度失效不排队、重复请求只一次提交、加载状态变化不替补其他NPC、同UUID绑定变化拒绝、已有草案字节保留、未知提交跨实例不重投、原经济发布函数产出合法货单且重复调用不改旧日、缺失发单人不进入新看板、学习门与日常门分离、父班次最多一个专员子任务、投递失败不算成功。长期村民生产与更丰富原生女仆工作仍需按真实工作站、库存与行为回执推进。
