# 女仆运行方式选择已上线

2026-11-07：PR109合并为 `dcc064006f6879356f35700578880564b484e939`，正式桥 **0.1.10-harness**、服务端扩展 **0.1.0** 和独立Harness网关已加载。源功能见[接线说明](../integrations/touhou-maids/harness/README.md)，上线前证据见[候选记录](MAID_HARNESS_20261107.md)。

主人先 `/qdmaid list` 取得原女仆ID，再用 `/qdmaid brain <maidId>` 查询；按返回的choice，用独立保留的requestId切换。原生、DSH、Codex共用原女仆的身份、记忆、装备和工具。真人可用 `/qdmaid brain-menu <maidId>`；Agent适配器使用 `mc_maids action:"brain"`，省略choice查询，写入时增加choice及requestId。对话仍按 `chat → receipt` 取最终结果，不重投不确定动作。

DSH配置为qwen3.7-plus，Codex配置为qwen3.7-plus-responses；Harness名称不是模型名称。正式启动后只读确认原肥鱼仍选原生CodingPlan，并保留原主人、存活和常规伤害保护。共享站点仅绑定这一原女仆；原DeepSeek入口没有服务器共享Key，其他女仆未启用新的共享模型或TTS。

发布按180/60/10秒预告、真人/副本门禁、原JVM正常退出及E/F当前游戏和认证冷备执行。安装期间798份角色相关文件一致、76条原认证记录保持；女神7项原任务恢复，相机回到ready。正式10项启动检查、7项原女仆/网关只读检查通过，服务器恢复20TPS。源码69项专项检查和全部6项CI此前通过；两份JAR重复构建一致，40项无关桥接内容保持。

首轮验收器把TLM对 `llm.json` 的格式重排判为文件变化。保留原失败回执后，逐项比较全部字段和值类型，确认完全相等；只读验收器r2通过，没有为此再次重启或改写运行配置。当前配置摘要为 `e7eb170ebae95c46e2cdb6b5622042773e1b219760443a4cd0e8609dbd132e87`；回退前应验证这个已确认状态及后续主人更改，不能沿用初始候选摘要强行替换。

网关为SYSTEM独立进程，使用现有Windows独立启动助手；已注册开机和一分钟守护，守护只检查进程，不发起推理或重放游戏动作。Windows虚拟环境有启动器及实际Python子进程，管理器已按父子关系、PID、创建时间、固定可执行文件和专用参数核验真正监听者。发布前实测重复Ensure保留同一进程、Stop只结束自己的网关；模型调用0次。

E/F私有发布目录为 `repairs/maid-harness-release-20261107-r1`，以 `completion.json`、`postflight-r2.json`、`original-harness-postflight.json` 为最终证据。原 `postflight.json` 及首次失败维护结果保留。维护入口已消费，不得重放；长期网关在 `integrations/maid-harness-0.1.0`，私有配置目录不是可清理的旧试验缓存。回退只处理本次代码/站点，先核对原女仆选择并回到原生；不回灌世界、物品、生命账本或认证数据。

远端宿主和公共Skill没有自动更新，客户端协调见[PR11联调留言](https://github.com/jcs130/cortico-world-qiandengji/pull/11#issuecomment-6705075176)。原可米/肥鱼客户端自主闭环、完整原生与手机画面仍待对端验收；不能以服务端已部署称作主人格已掌握全部操作。附近聊天/ASR自动触发、主动社交和TTS声线统一仍未接入，本次没有启用这些功能。
