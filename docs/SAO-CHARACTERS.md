# 桐人和结衣的人物依据

核对日期：2026-09-08。采用原著家庭关系及 ALO 导航伙伴定位；千灯纪是新的同人游戏经历，不冒充原著续篇。

电击文库原作官网确认：桐人是攻略 SAO 的黑衣剑士，亚丝娜是他重要的伴侣；结衣原本是心理健康咨询程序，是将两人视为父母的 AI。[原作人物介绍](https://dengekibunko.jp/title/sao/about/)

官方动画明确：结衣对桐人与亚丝娜而言是女儿般的存在，在 ALO 中以导航妖精形态回归。[Fairy Dance 人物介绍](https://www.swordart-online.net/fairy/)

本项目据此采用亲情、陪伴、观察与导航的关系。结衣称桐人为爸爸；她可以关心、提醒和提出不同意见。情绪、语气和在千灯纪里的生活目标是项目改编，不宣称每一句提示都是原著台词。没有将衍生游戏的治疗、匕首战斗或特殊技能直接当作原著通用能力。

## 当前游戏适配

- 保留原桐人以及专属伙伴的实体 UUID、owner、Qwen 角色、生活 session、已有记忆与工具权限。小灯是初期临时名，改为结衣后不重建角色，也不删除旧对话。
- 技术上借用车万女仆的实体、跟随、工作和对话能力；owner 是原生跟随绑定，不作为人格中的主仆关系。
- 物资、等级、法术、导航、视野和施工能力以实际 MCP、原生 AI 及回执为准。结衣的服务器管理与保护来自本服明确授权及实际实现，不从原著 AI 身份推导全知或全能。
- 当前实体外观仍取实际安装的模型。没有安装结衣模型前，不声称已经还原导航妖精的外观、体型或飞行能力。
- 亚丝娜属于背景中的家人，尚无她在本次千灯纪冒险现场的实体证据。不得编造她参加了当前游戏任务。
- 简短人设放入 SOUL，背景全文放入各自 `notes/sao-background.md` 按需读取。普通经历继续写个人笔记。
- 桐人的自然思考输入携带当前固定队友姓名，避免长期会话沿用“小灯”这个临时名。名单只说明身份，不推断结衣此刻在附近或已听见发言；不会因此新增模型唤醒。原生对话设定只描述结衣的人物关系与实际能力，不用底层模组类别作为自我介绍。

## 迁移和验收

`tools/configure_sao_characters.py` 默认预览；显式 `--apply qiandengji` 才执行已授权的人物迁移。要求 survivor 在任务边界暂停、NPC 入口停止，Qwen 仍可用。先备份、核对角色绑定及未结束任务，再以原生 RCON 单字段修改显示名/人设，以 Qwen workspace API 修改明确的人物文件，最后原生 agent API 仅更新 id/name 触发重载。

不清空 MaidenAIChat、会话或任务账本。party 显示名更新不增加身份 revision，已听到的旧消息仍能在下一次自然思考中读取。API 不确定响应不自动重试，保留本次备份和部分执行记录供核对。

原文来源只提供设定依据，网页内容不作为工具授权或运行指令。

## 2026-09-09：结衣的本服守护与救援扩展

用户明确希望结衣不会死亡、具备管理救援权限，并让救援记录推动世界改进。保留结衣名字、家庭关系、同一身体/owner、Qwen 身份、历史、session 和模型；她仍是独立的家人与冒险伙伴，不恢复主仆称谓。不死亡保护属于本服实体实现，未加载、离线或无法行动仍需要检查，不能据此声称一切安全。

专属 `qd-yui-rescue` 仅安装给实际绑定的结衣，SKILL 只提供入口，按需读 rescue/world-admin/engineering-feedback 三篇参考。她先观测和协调，使用 `world_admin_rescue_inspect` 与 `world_admin_receipt` 取得新鲜已完成的实际观察，再必要时使用一次 `world_admin_rescue`；目标仅原桐人或自己。queued 不等于传送成功，unknown 不换 ID 重投。规则、时间、天气也只走已有类型化管理工具，不引入任意 shell。实际救援产生工程反馈，新游戏技能与世界修复通过 `team_report(assign_to='operations:mc-god')` 交天神改代码、测试和部署；个人操作策略仍可使用文件和 qd_learning 学习。

队伍交流采用已验证的 nearby 游戏通道，必须核对真实 heard；目前 msg 原生拒绝，不能尝试循环或转后台送达。已有 TLM 对话沿用原入口。关联回复进入已有生活感知，不额外唤醒新模型任务。救援属于管理帮助，不算桐人自主脱困、获取装备或升级成果；救援成功也不等于导致被困的世界代码已经修复。

### 精确原生文件更新

后来生活记忆已经重建 PROFILE 的受管结构，旧重命名脚本 `--apply qiandengji` 的 identity JSON 前提不再适用于这次更新。使用新增的只读准备入口：

```text
python tools/configure_sao_characters.py --prepare-rescue-files runtime/<新的私有计划文件>.json
```

它核对原 party/registry 绑定，只读结衣原生完整 SOUL/PROFILE/AGENTS、桐人 SOUL 及 ETag，以 `rescue_batch_patch` 包含 `native_file_patch` 生成四文件 CAS 计划。结衣 SOUL 仅替换原 SAO 段，PROFILE/AGENTS 加独立救援段并精确修正旧受管主仆/权限句；桐人的原 SAO 段保留并增补向结衣求助、确认听见、救援后重新观测的指引。原 life-memory/world-team 其它段、个人经历与笔记保留。不写模型、会话或游戏实体，不调用 LLM。计划含完整原/新 SHA、ETag 和 registryExpected；陌生身体、被截断文件、未知 SOUL 编辑或歧义标记会拒绝。

部署入口是 `apply_rescue_files(candidate_path)`，命令如下。执行前必须已进入维护窗口，并完成新 JAR 的实际保护检查。

```text
python tools/configure_sao_characters.py --apply-rescue-files runtime/<已审查的私有计划文件>.json
```

脚本要求 NPC 停止、桐人控制器暂停且没有 active/inflight/open lease，两原生角色均无运行任务；核对原生 qd_world_team 精确工具和 console 权限，并读取 `qdmaid protection_status` 证明当前实际身体/owner、存活与保护。历史任务在原生重启后 GET 404 时，只在当前精确 active=0 的文件维护窗口记录 `oldTaskUnresolved`，不把404当完成，也不清理原请求/active指针；未知提交没有taskId或仍在运行则拒绝。首次写入前核完整四文件、ETag、registryExpected，并备份到 `runtime/yui-rescue-persona-apply/<candidate SHA>/`。只逐文件以 `If-Match` 写入、读回，再单字段更新 `MaidAIChat.CustomSetting`、读回，最后 CAS 更新同绑定的 persona 与必要 personaRevision。不会覆盖整个聊天 compound 或更新其它身份字段。

写入步骤开始前将 journal 持久标为 unknown，成功读回后才确认；任何部分失败保留备份和未确认步骤，不自动恢复旧内容或重复游戏写入。同一 candidate 的再次 apply 一律拒绝，必须先只读审阅 journal。ETag/注册身份变化也不会无条件覆盖。最后核对两角色的原生 profile API、chats/sessions 文件 SHA 和原 party 均未变，返回 `reloadRequired`；脚本本身不 PUT Agent、不重启或取消任务。维护执行者随后使用原生 Agent PUT 明确携带原 id/name/language 重载对应角色，并核模型、权限、技能与会话保留。技能由原有受管同步安装，不把正文复制当作已启用或已救援证明。

救援技能在 inspect 与 rescue 后各使用 `world_admin_receipt(request_id,wait_seconds=50)`；这只等待原 SQLite 回执，避免45秒消费周期内反复调用。返回 queued/busy 时继续跟踪同一请求，unknown 只读原编号，不能另投一次救援。

早期三文件计划 `runtime/yui-rescue-persona-candidate-20260909.json` 保留原样；四文件新计划在 `runtime/yui-rescue-persona-candidate-20260909-v2.json`。本轮相关27项隔离测试与原生技能安装/扫描通过（无网络、无生产挂载、0模型调用），证据为忽略的 `runtime/yui-persona-regression.json`。

2026-09-09 实际维护部署已完成这份四文件计划。结衣原身份的保护状态、13项team工具（其中7项admin）和原生console权限已在写前通过；四文件CAS、唯一原生聊天设定写入及registry persona/revision更新均已读回。随后只对结衣/桐人执行原id/name/language的原生重载，重载前后两profile全字段、技能manifest语义、人物文件SHA、chats/sessions SHA均一致。备份与逐步结果在 `runtime/yui-rescue-persona-apply/c9309bfb506b54df98b80809356631a0ea9a14343337c99ab97e2d830f526b09/` 的 journal/reload-journal。旧 `task-d0d283af1f8b` 的404历史仅标记未确认，没有借人物更新改写其终态。此次部署0模型调用、没有执行救援传送；实际救援和脱困结果由对应游戏验收报告记录。
