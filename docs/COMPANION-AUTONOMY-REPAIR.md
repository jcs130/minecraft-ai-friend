# 桐人、结衣自主运行修复（2026-09-14）

本次在原 D 盘 Compose 项目恢复运行，保留人物 UUID、背包、Qwen 角色、即时模型、人格和生活会话。游戏 Qwen 仍为 18089，宿主 8088 未改；没有新增宿主守护进程。服务健康、模型回合完成、实体移动及共同任务产出分别验收。

## 实际故障与改动

1. **桐人被误暂停。** 控制器先在共享动作锁内读取状态，之后又在锁外检查临时 `unknown.json`。此时另一个普通动作提交会短暂创建该文件；等暂停请求获得锁时，动作已经结束并清理占位，但控制器仍把自主开关持久关闭。本次使用锁内状态结果；兼容无动作回执的路径也取得相同锁。真实未知仍然暂停，正在提交则等待，不重发动作。线程和实际文件锁交错回归覆盖该竞争。
2. **结衣已加载却不执行跟随。** 桐人原 Numen 区域票外围只加载，不更新实体。新桥只为配置中原结衣与当前在线、同维度的原 Numen 主人续一个有界、短时区域票，使原 TLM Brain 自己跟随和回归，不重新实现寻路。详见 [原生身体更新](COMPANION-BODY-TICKING.md)。
3. **进食缺少可归属的终态。** 新食物请求保留原 Numen TaskRecord，按唯一 actionId 查询；首响应丢失只读原请求，重启不再次吃。新增食物 60 秒外部总等待，复用一次精确停止机制，以处理原生自卫反射冻结任务预算的问题。旧 `t48` 保持 `observed_ended`，不根据背包变化补造历史成功。详见 [食物回执](NATIVE-FOOD-RECEIPTS.md)。
4. **结衣只有被动对话入口。** 她现在用 Qwen 原生固定 Cron 每 10 分钟产生一个零模型生活信号，NPC 现有队伍线程在原角色、原 session 中处理。模型自主决定观察、工作、协商和学习，真实游戏回复只在原定轮次中消费，不单独唤醒。详见 [持续自主生活](YUI-AUTONOMOUS-LIFE.md)。
5. **NPC 读日志偶发退出。** 三条真实崩溃均为 Docker bind 上 `readline()` 的 `OSError: [Errno 61] No data available`。新读取器在最后一条完整行之后重新打开同一文件；半行、UTF-8 分片、轮转及截断不回放历史聊天。故障持续时健康状态显示 `log_reader_unavailable`，其它维护线程仍可运行。
6. **天神周期被原生限流遗留占位阻塞。** 实际 Qwen 2.2 原生 trace `b8b9e708-caa8-40b6-a9fc-a90c457cd393` 记录 `_AcquireTimeoutError('Rate limit exceeded')` 并结束，但项目此前把它归为未知、永久保留执行占位。现仅对安装版本的准确异常类识别为本轮失败；其它异常仍保留未知。旧周期经 job/session/user/时间范围和原生终态核验归档，明确不重放旧工作，下一原定班次可继续。

## 部署与回滚资料

在既有自主控制器暂停、全部 10 个原生角色空闲后，保存世界并停止 MC、NPC、world、survivor、Qwen。备份 `runtime/backups/companion-autonomy-20260913T231205Z` 包含 21,022 个文件、2,435,410,622 字节，每份拷贝逐项读取核验 SHA-256；覆盖世界、相关配置、旧桥、原人物运行账本及 Qwen 工作资料。私有资料不进入 Git。

安装记录为 `runtime/companion-repair-20260914/installed.json`：

| 组件 | 本次版本或 SHA-256 |
| --- | --- |
| Survivor | 首次部署 `2.2.0-autonomy6`，后续记忆检索修复为 `qiandengji-survivor:2.2.0-autonomy7` |
| Maid bridge | `b47940211aecd26ca164e580b482c382f60dc61d93b2369166baa5f1da3eacef` |
| Iron bridge | `1f3c18027ee921827cbe06e34edfed3d811867043f5b484d48e886a4ce3a4dbd` |
| Qwen | 原 `2.2.0-autonomy3` 镜像，启动时实际加载挂载中的 Cron guard 3 |

新跟随配置安装为 `server/mc/config/qiandeng-companion-ticking.json`。本地准备客户端与桥缓存同步同一 Maid JAR，模组 ID、version、客户端 serializer 与注册表未增加。此次没有远端客户端重连证据，也没有重发整合包。历史 `deployed-server.lock.json` 与旧源码验收报告没有重写。

所有服务恢复后，通过原 `control.py resume` 恢复桐人，原身体重连验证成功；结衣 Cron 经原生 API 启用并只手动运行一次零模型信号，没有额外提交重复模型任务。四项运营 Cron 按维护前精确配置恢复，下一次天神班次为 07:25、策划 07:33、司灯日报 09:10。备份开关记录在 `runtime/companion-repair-20260914/operations-crons.json`。

## 已取得的验证

- 13 个默认 Compose 服务运行；其中 12 个配置了 Docker healthcheck 并为 healthy，gate 没有 healthcheck，不能称它通过了不存在的检查。
- 新进程严格 Qwen 健康检查通过：10 个启用角色、94 项技能绑定、原生工具策略、人物与团队 Driver、Cron guard、无限额策略均核验。
- 跟随隔离全模组实机 10 项、离线 145 项通过；食物及交互隔离实机 35 项通过。具体结果和失败修正记录见各组件文档。
- 锁竞争 4 项、控制器 68 项、食物回执 11 项、食物截止 8 项、原导航截止 8 项、网关 31 项、世界动作 52 项通过；最终新生活周期 22 项、队伍相关 140 项通过。NPC 日志 Windows/Linux 各 4 项及健康自检 3 项通过；运营周期 13 项、旧周期恢复 9 项通过。
- 07:21 生产原结衣 bodyTickCount 601→616，实际位置持续变化；同窗口原桐人在线，二人距离约 3 格。
- 桐人新回合 `task-89c48a2d29a3` 使用原 `life-e5222596680d4720ba79d8527eae078d`，已取得真实进食 `8bc7705b55fe4596b73540634846516c` / `t3` 的原生 `SUCCESS`：面包 8→7，饥饿 12→17。随后 `t4/t5/t6` 导航分别正常完成。此处不能替代整轮结束或共同目标完成的证据。
- 结衣首个新信号 `qd-life-review-5swvhK:600:2982236` 已由原 NPC 线程提交为 `task-c6a0cd92fae8`，原角色与原生活 session 不变。

后续只读 `runtime/companion-repair-20260914/life-after.json` 已验证两轮独立原生任务在原 session 完成、12 份可归属动作回执及本轮实际模型用量，未知结果为 0。第二轮真实 `craft` 产出铁锄，下一轮 `farm till` 在 `(-639,63,1055)` 验到 `minecraft:farmland`，`farm plant` 实际种植；07:29 快照共 16 个新动作全部 completed。不是根据模型总结推测种田成功。

结衣首轮实际完成 identity、读目标、party_status、追加日记四项工具调用，没有发言或救援。她误把 9 月 9 日旧救援写成本轮日记，这份原文和工具证据保留在 `runtime/party-life-live-20260914/first-round-false-claim.json`，不当成协作成功。随后每轮上下文增加现实时间、原生只读游戏时钟及最近消息日期/年龄，要求比较历史、依据新观察追加纠正并保留旧记录；新增三项回归。07:30 在 NPC 相关原生角色空闲、无待处理队伍任务后仅重启 NPC 加载，未重启 MC/Qwen。07:27 原生 Cron 已自然产生同 slot 的合并回执，没有重复调用首轮；下一不同 slot 为 07:37。

完整健康审计仍保留旧架构/技能/队伍/隔离证明的源码漂移红项；当前角色技能与工具通过不等于旧整项目报告覆盖了这些新增实现。新增身体 tick 与原生生活周期/信号检查已接入现有 `health_mon.py` / `party_health.py`，旧报告没有改哈希。新增生活上下文后 Party 系列共 140 项回归通过。

## 持续观察后的修复与协作

07:37 结衣原生 Cron 自动启动 `task-85a4b5e98704`，实际游戏时钟 day=528、daytime=15736。07:38 她通过原生 `append_file` 自行追加 343 字节纠正，明确旧救援发生于 9 月 9 日，保留此前误记，记录当前原身体位置与 HP20。证据 `runtime/party-life-live-20260914/second-round-correction.json`。

桐人后续 `task-b815dbf5e9b2` 出现四次相同 `memory_search`，Qwen 最后输出 `Doom loop: agent stuck after 4 consecutive repetitions`，却给了普通 completed 元数据。实际安装源确认 ReMe 仅取输入前 50 字符，原生发送者前缀加项目通用标题恰好占满检索词，因此不断召回旧矿坑资料。已将真实目标放到首行，并提示已有成功检索即可继续，当前事实优先；原官方 Memory/Dream、人物、模型及会话保留。新回执把精确 Doom 终止记录为 `completed=false / native_doom_loop`，真实已执行动作不受影响；NPC 公用回执同样阻止这类框架文字作为人物回复。新增原生 ReMe 回归等 4 项、生活会话 41 项、控制器 68 项通过，NPC 回执 17 项通过。旧任务原回执未重写。

autonomy7 构建记录为 `runtime/qwenpaw-recovery-20260913T234609Z-0354c432/build-result.json`，固定镜像 ID `sha256:2d0931c1eb653741c5f38edec7faedfb0dd6ebad3f00d8a64cc55f6a4fcfe99a`。原控制器 drain 在真实安全边界完成后替换，MC/Qwen 未因此重启。

随后通过原控制器设置“与结衣商量并合作完成营地耕作小目标”，旧目标完整保存于 `runtime/companion-repair-20260914/cooperation-mission-before.json`，没有直接再投第二个模型任务。这是用户目标驱动的协作实测，不称无目标自发发言。

第一轮 `task-af728cce953e` 实际完成两次 `party_send`、三次导航和三项农耕。请求 `9b2b3c9b-e823-5ea1-993d-654c06a1e684` 与 `d4dcabf5-dfa2-546e-b9ee-425481030e7b` 及两条结衣回复均有游戏 heard 回执，实际听距分别约 1.58/5.13、3.00/4.94 格。后续原生活轮 `task-0a801e42309d` 已带入两条精确回复事件，继续执行新的翻土动作。结衣回复愿意协助，且原生跟随已验证；回复任务没有身体工具调用，不能称她已经亲手松土或浇水。

本次新 JAR 的全部非 class 资源与旧版字节一致，当前 4336 方块/116650 状态的注册表语义与渲染映射一致。通过既有严格 provenance 工具刷新当前来源记录后，网页管理 9 项实时检查通过；未重建纹理、重启服务或改旧 smoke 哈希。详见 [渲染兼容](WEB-RENDER-COMPATIBILITY.md)。

天神的候选环境已完成有记录的维护迁移：保留原 Git 历史与全部引用、添加纯模式纠正子提交、将新增回归移入独立可发现文件并保留四份批准测试原字节，测试改用真实存在的固定镜像。120 次测试执行保留两项新测试失败，业务代码未部署。原测试/提交的通过要求不变；Qwen 与 control 容器均实际读取到新组合计划，工程与学习两项原 Cron 已原样恢复，下一工程班次 07:55。详见 [工程候选恢复](ENGINEERING-CANDIDATE-RECOVERY.md)。

07:54 后续 `task-0a801e42309d` 在原 session 自然完成，两条回复实际写入 `reply_consumptions`，并记录 `party_replies_consumed`。本轮实际装备的是小麦种子，随后两次 `farm plant` 各消耗一粒种子；不能把它误记成装备锄头。新通信与消费证据单独保存在 `runtime/party-life-live-20260914/goal-driven-cooperation-proof.json`。

07:58 确认桐人 drain 完成、结衣与两个原生对话角色 idle、队伍无 pending/submitted/unknown、生活 active 为空后，仅重启 NPC 加载公用 Doom 过滤；健康通过后已恢复桐人。08:00 原生循环重新 thinking，本窗口已有 28 个动作全部 completed。结衣 07:57 的自然生活回合也已完成，仍使用原 session。

本轮最后重新只读采集 `reports/survivor-life-smoke.json` 与 `reports/survivor-party-smoke.json`，两者通过；旧文件原字节及 SHA 先完整保存于 `runtime/companion-repair-20260914/historical-reports/`。新采集没有提交模型或世界动作。19 项当前 party 健康检查全部通过，包括自然 Cron 信号、已加载消费者、原角色工具及新游戏通信证明。其余旧整项目报告的源码漂移不因此消失。

07:55 天神自然班次已排入真实工程测试，随后暴露正式 runner 继承镜像服务 ENTRYPOINT 的问题。已明确使用批准 argv 的可执行项和参数，保持原隔离与批准哈希，9 项 runner 回归通过；在无管理操作/测试在途时仅重启 control 加载。另在原班次自然结束后修正候选新测试的首次创建前置及精确拒绝异常断言，批准的四份测试原字节未动。正式新 job `maintenance-20260914-runner-entrypoint-01` 于 08:08:58 返回 passed/exitCode=0，120 次测试执行全部通过，容器已移除；源 SHA 为 `798fa1db8e827f2ab1a611cc9634c7edef4a605c2314011963db123055289452`。这次验证由维护者经原工程队列发起，不能冒充天神自己修完测试。原工程 Cron 已恢复，下一班次 08:15，候选业务仍未部署。

截止机制的 60 秒食物取消分支已通过隔离回归，尚不能因正常吃成功就宣称该分支在生产被触发。更长期的采矿、建房和共同任务成果应继续依据各自实际回执验收。最新实时管理检查全部通过，keepInventory 实际读回 true；历史整项目源码证明漂移仍按原状记录，不能将所有旧报告说成全绿。
