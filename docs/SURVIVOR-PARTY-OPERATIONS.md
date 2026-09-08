# 旅行小队部署与恢复

2026-09-08 当前版本：角色正式名结衣，人设与实际迁移见 [SAO-CHARACTERS.md](SAO-CHARACTERS.md)。自主服务 qd12 接入被动回复感知：普通世界/目标/原定复盘启动后才取最多8条未消费的真实 heard 回复，单独回复不唤醒；已知原生终态只确认本任务实际带入的事件，晚到或结果未知仍保留。当前模型使用无人工额度策略，有限额记录属于下文历史测试阶段。

额度迁移必须保留身份代际。`party_messages` 仅允许同revision下更新 `dailyDispatchCap` 与 `cooldownSeconds` 两个推理策略字段，其余身份/结构变化仍拒绝；不要把revision提高来绕过旧回执不可见问题。部署曾暴露原same-revision整文档比较误挡null/0的情况，已加入保留pending/heard/reply/unknown的迁移回归。

适用于游戏 QwenPaw 2.2、现有 NPC/survivor 容器和固定两人小队。这里的步骤不操作宿主 QwenPaw、运营组模型、真人女仆主人或 Minecraft 存档。生产协作是否通过，以当次本机报告为准；配置成功不是行为验收。

## 配置前

1. 保留桐人原身体、存档物资和 `life-session.json`。新伙伴必须经过正常蛋糕认领，实际 owner UUID 为桐人身体。`configure_survivor_party.py` 只读发现/核验身体，不负责召唤、传送或认领。
2. 暂停受管新任务投递，等待已有任务的原生终态并核对身体动作回执，再变更服务。不能通过取消整个共用 chat 来猜测停止某一任务。Qwen 控制台额外手工聊天不经过 QwenTasks 的角色账本；本系统只承诺受管自主、伙伴消息及 TLM 对话入口的串行安排。桐人额外聊天没有控制器动作租约，只能提交目标请求。
3. 备份本轮精确 compose/源码版本、两位角色配置与加密凭据、人物绑定、生活会话、控制器账本和 NPC `qwen-tasks`。队伍 SQLite 在仍打开时使用 SQLite backup API，不能只复制主数据库而忽略尚未完成的事务。备份留在被忽略的本机目录，不加入 Git。

## 安装顺序

1. 让 NPC 运行包含 `/party/mcp` 的版本，并挂载固定 party 状态目录及公开状态目录。保持桐人的受管模型调度暂停。运行只读预检：

   ```powershell
   python tools/configure_survivor_party.py --maid-uuid <实际女仆UUID>
   ```

2. 核对本次身体后，运行同一脚本的 `--apply qiandengji`。它复用已注册角色或创建一个独立角色，并持久保存六项收发身份及两份随机凭据。已有身份不匹配时停止，不自动换主人、换会话或创建替代角色。
3. 脚本使用原生 `POST /mcp` 的 `client_key`/`client` 结构创建 `qd_party`，或原生 `PUT /mcp/qd_party` 修复同一受管入口。Qwen 的 GET 响应会脱敏凭据；脚本不能据此比较明文 token。重跑以本地固定 binding 为准，经原生 API 重对齐同一 token，并先备份原加密凭据和 DriverCard。不同地址、传输协议或未管理的权限规则不会被覆盖。
4. 两位成员的 `qd_party` 均须只有三个工具、默认拒绝、console 显式允许。两人配置全部完成后才发布 `party/public/roles.json`。如果首次创建的响应丢失，保留 binding；修正失败原因后显式重跑会先 GET 已有 driver，不重新生成 token 或复制另一个角色。
5. 发布注册女仆及 party 公开清单后，同步原生技能：先停止游戏 Qwen，在离线同步工具中运行 `python tools/sync_role_learning.py --runtime game --execute qiandengji`，然后启动游戏 Qwen。该工具保留模型选择、历史、笔记和既有合法周任务；不会自动修复 `maid_native` 的权限。
6. Qwen 的 `PARTY_ROLES_MANIFEST_FILE`、只读 manifest 挂载和实际公开清单必须一起就绪。配置了该环境变量却没有文件时，健康检查会失败；survivor 又依赖 Qwen 健康，因此不能先用缺失清单等待 survivor 启动来修配置。
7. 核对两位角色的原生工具/技能、角色文件 guard、身份和会话之后，再启动新版 survivor；恢复之前记录的受管暂停/运行意图。不能为了通过健康检查重置预算、会话或历史。

## 正常启动目标与实测

2026-09-08 功能联调期间，女仆原12次/24h共享额度已由既有签名游戏对话和一次新伙伴启动任务用满。依据用户“CodingPlan可以多用、功能优先”的要求，当前上限为所有女仆合计24次/24h，60秒任务间隔保留；小灯仍QPM4、并发1、最多4轮模型迭代。原预约和用量不清零，已经在游戏听见的 pending 消息由原队列继续处理，不发第二条消息绕过预算。签名TLM输入的具体触发事件尚未逐项归因，不能仅凭key把它说成人工聊天或自动闲聊。

可向新伙伴提交一次普通 `QwenTasks.submit('maid_dialogue', ...)` 启动目标，让她自己感知、认识桐人并决定是否交流。使用固定 `maid_uuid`、`owner_uuid`、六字段 `expected_binding`、稳定 request key 和稳定 prompt；不直接另发原生模型 POST。普通生活任务的 `allowed_tools=None` 沿用角色已有工具，因此可以主动 `party_send`。这是一次受管任务，不是另一个常驻模型循环；仍消耗所有女仆共享的用途预算。

处理游戏中已听见的伙伴发言时，任务继续使用受限名单，不能再次发送或派生 Agent。`nearby` 由实际游戏核验活着且已加载的桐人/自有女仆、同维度和24格距离；只有 MC 回执 `heard` 才公开文字并进入对方固定生活会话。`msg` 目前保留协议但明确返回未接通或目标不支持，不转后台私信或附近广播。普通启动目标也不能覆盖一个尚未解决的来信任务。先看角色门与队伍状态，忙就等待；不能通过新 key 绕开未确认提交。

Minecraft 需要带 `qdmaid party_say` / `party_speech_status` 的女仆桥版本；NPC 和 survivor 复用已有 RCON 凭据，不新增对外端口。仅更新 Python 队列或播放 TTS 不能作为游戏交流上线。

模型完成后先保存私有回复草稿，身体再通过相同游戏通道说出完整的160字以内单段文字。MC 未确认接收前，对方看不到回复正文、当前任务也不被算作已送达；明确拒绝会结束本次尝试但不伪装成功。附近 TTS 只是游戏 `heard` 之后的附加播放，不能代替接收证明，私聊不作公共播放。

在模型任务开始前保存只读用量基线：

```powershell
python tools/smoke_survivor_party.py --capture-usage --output runtime/party-usage-before.json
```

同时按 `smoke_survivor_life.py` 的说明保存生活实验基线并采集结果。完成真实交流后采集队伍证据：

```powershell
python tools/smoke_survivor_party.py --before runtime/survivor-life-before.json --usage-before runtime/party-usage-before.json
python tools/party_health.py
```

队伍 collector 只读取 SQLite、原生任务/会话/工具和真实女仆身份，不发模型任务、不执行游戏动作。报告把 reply 对齐到原预约 task ID、原生最终回答和接收者 chat 三项身份；同时核对女仆已加载且 owner 在线。生活报告必须与当前 agent/body/user/channel/chat/session 全部一致。`party_health` 还核对当前 private/public/registry 绑定、实际工具、精确 console policy，以及报告的 party ID、revision 和两位成员。

原生 `/token-usage/details` 的行按 `agent_id` 过滤，记录 `call_count`、`prompt_tokens`、`completion_tokens` 的前后快照和差值。一次受管任务可包含多次模型请求；同角色在窗口内的其他任务也会计入，不能把总差值伪装成某条消息的独占费用。没有基线、查询失败、计数缺失或倒退时差值为 `null`，不是零。模型用量接口不直接证明人民币费用。

一条成功回复只证明一次固定会话交流；不能据此声称双方均已主动发起、多轮/重启连贯、共同采集完成或附近真人听到声音。回复语音仅处理五分钟内、绑定仍一致的记录，并复用原语音去重账本。

## 旧女仆权限规范化

已核查的旧独立女仆差异是 `maid_native.policy.default_effect=allow`，其七条 console 显式允许规则已经存在。可以通过原生 `GET /mcp/policy/maid_native` 保存现状，确认无 client overrides、tool defaults 或未管理规则，仅将 `default_effect` 改为 `deny` 后原生 PUT，再核对七项规则和模型选择未变。此操作只规范该角色的身体 driver，不重写人物、技能、endpoint 或其他角色，也不需要重启 Minecraft。

`MaidRegistry.ensure()` 对 ready 角色不会重新写 policy，`sync_role_learning.py` 只管理学习 driver；不能反复运行它们并假设旧差异已修复。

## 暂停、失败与回滚

- **暂时不可观测**：RCON 读取或解析失败返回 `online: null / observation_unavailable`，保留异常类型和读取阶段，不能推断角色离线。控制器进入 `observation_wait`，不恢复身体或创建新决策；已有原生任务按原截止时间继续查询，动作工具仍须实时预检。下一次正常快照会自然恢复。完整名单确认缺失或原生明确 `no companion` 才是 `online: false`；真实离线和已有未知动作仍沿用暂停保护。
- **只暂停功能**：暂停受管新任务，保留全部绑定、队伍消息、QwenTasks 预约和身体回执。已确认的原生 task ID 可以继续 GET；停止网页或声音不会把模型任务自动变成取消成功。
- **未知提交**：`unknown` / `submission_uncertain` 或原生 task 404 不等于“未调用”。Qwen 的后台 task 查询状态是进程内数据，重启可能使其不可查询。不要新建 key 重投、删除 active-role 指针、清空 SQLite 或退款预算。先对照两个账本及原生会话证据；仍无法确认则保留待人工核对状态。
- **游戏发言未知**：SQLite `world_speech` 在调用 RCON 之前先记录 unknown。超时、丢失回执或游戏 `not_found` 都只允许查询原 event ID，不能再次 `party_say`。远距、异维度、身体未加载等明确拒绝是本次终态，不等角色走近后重放旧话。人工暂停期间 survivor 只能查询已经发出的回复；不能首次说出尚未发送的草稿。
- **已知忙或预算阻塞**：仅在外部明确没有提交时 `mark_deferred` 可回到 pending，保留延迟与审计。不能把超时、断连或任意 HTTP 错误推断成可重试。
- **回退代码/镜像**：先停止新投递并等待已知任务终态，再恢复本轮备份的精确服务版本与 compose。角色模型、会话、个人笔记、物资和已发生的动作不回滚；保留新产生的消息与任务账本。
- **彻底撤下队伍入口**：在受管调用已停止后，仅对绑定两角色用原生 API 移除 `qd_party`，原生禁用 `qd-party-cooperation`，精确移除其说明段；保留 `maid_native`、`qd_learning` 和个人资料。一起恢复原 compose 的 party 环境/挂载和相应健康探针版本，避免“manifest 仍宣告启用而 driver 已删除”的混合状态。清单先归档而不是删除历史队列，新女仆角色和她的真实身体无需销毁。
- **恢复凭据**：先确认受管 driver 的本机 binding 和备份。通过原生 MCP API 恢复该 driver；不要把旧的整个 `credentials.yaml` 或 `agent.json` 覆盖进正在运行、已经有新改动的工作区。加密文件备份用于精确离线恢复时也须核对角色与版本。

恢复后先做只读身份/原生工具/队列/会话检查。没有真实的新验收证据时保持对应探针未通过，不用清空历史或复用别的小队报告制造绿色状态。

## 稳定性修复：语音健康文件阻塞

2026-09-08 20:51:49 的 MC 看门狗报告显示，服务器主线程停在 `GodVoice TtsQueueWatcher.writeHealth:368 → Files.writeString → UnixNativeDispatcher.open0`，正在写挂载目录里的 `.speech-health.json.tmp`。随后 Java 以 137 退出并由既有容器策略重新启动；137 不能单独证明 OOM，目前证据没有确认内存耗尽或底层 Docker/存储卡顿的具体原因，也没有指向新女仆桥的异常调用栈。

21:22 受管保存并停启 MC，将健康文件写入移到现有 `godvoice-tts-watcher`。主线程只发布容量为一的最新不可变样本，保留 MC 实际采样时间，后台每秒限流并原子落盘；没有新进程或线程。GodVoice 的服务端、D 客户端与恢复缓存均同步为 `b23d72da9c6d83a1557538af4bb7db6a73c8ada5469d14f1d1861238b2c44e99`。114 项 JVM 断言、11 项 collector 测试以及上线后的六项语音冒烟与实时健康通过；未播放测试声音或调用模型。其它 generation/动作回执路径仍有主线程 IO，不宣称已经消除所有慢盘风险。

重启后只读核查：原桐人仍有相同 UUID、主人及无死亡标记的登记，存档保留移动后位置、饥饿 11、面包 9；小灯已加载且主人仍为桐人，原生聊天设定存在。桐人当时尚未在线，交由现有 controller 按同身份恢复，不重放吃饭/步行动作或回滚物资。本机脱敏诊断为 `runtime/reports/mc-watchdog-20260908-205149.json`，含崩溃文件摘要、时间与保存状态；恢复后的自主交流另以新的真实回执验收。
