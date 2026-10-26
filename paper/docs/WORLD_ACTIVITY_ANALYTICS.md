# 世界活动统计 v1（内部采集契约）

定位：让Agent自主生活、探索、合作和创造。统计用来发现内容供给、入口、难度与奖励问题；不是强制职业轮换或代玩家接单。玩家原始聊天、密码、私人库存不进入本数据。

生产采集入口：`python -X utf8 E:/MC/ops/world-activity.py --server E:/MC/server --out E:/MC/ops/state/world-activity/snapshot.json`。使用原QwenPaw Python及已有PyYAML，只读Paper保存记录、限定成功日志、CoreProtect公共共享箱流水，不调用RCON或写游戏配置。默认最近30个上海自然日。原网站同步器以已有内部Token读取该文件上传，不新增公网采集端口。

输出UTF-8 JSON：

```json
{"schemaVersion":1,"serverId":"qiandengji","observedAt":"2026-10-26T02:00:00Z","available":true,"window":{"from":"2026-09-27","through":"2026-10-26","timezone":"Asia/Shanghai","days":30},"coverage":{},"categories":[{"id":"exploration","label":"探索"}],"players":[],"commissions":[],"donations":[],"active":[],"notices":[]}
```

- `coverage` 各源有 `available/complete/reason` 及来源范围；`complete`仅表示本轮该范围读取未截断，不证明服务器从未漏记历史。顶部available表示核心委托源可读，某项不可用时看其coverage，不能当0。记录的时间有独立精度，不拿采集时间冒充完成时间。
- `coverage.logs`有`completeDays/partialDays/unreadDays/missingDays/dayFiles`。完整天只指发现的现存文件全部读取；缺失天仍未知。按日期和同日数字轮转序号从新到旧，整文件读取；默认200文件/64MiB解压总预算/16MiB单文件。7日页面应按对应7天判断，不能因为30日部分返回就称7日全缺，反之也不能隐藏30日缺口。
- `players[]`：`playerUuid,name,cumulativeGuildCompleted`（冒险者公会保存的累计完整交付，**不含生活公会**；无值为null）。UUID只供原网站归属/可见性过滤，不能用于认证；未知名字为null，不猜人名。
- `commissions[]`：`id,playerUuid,system,taskId,title,category,status,occurredAt,day,source`。system为guild/life；status为accepted/completed/abandoned。完成仅来自服务端成功结算日志或市场已保存completed历史，查询、阶段推进、发奖失败不计。一个完整任务只归一个主category，多个不同玩法归mixed；未知other。历史冻结步骤优先于当前模板分类，具体模板分类有version说明。
- 类别：farming/crafting/construction/exploration/combat/fishing/trade/culture/logistics/magic/mixed/other。农业+贸易的混合任务可保留tags，但不重复计入两个类别的总数。
- `active[]`：`playerUuid,system,taskId,title,category,acceptedAt`，仅是当前保存的在途快照，不当历史接单总量。缺历史接单/结束记录时，网页不展示“完成率”；可展示完整交付数、参与人数、在途数及已知放弃数。
- `donations[]`：`id,playerUuid,name,day,occurredAt,source,material,deposited,withdrawn,net,transactions`。source为public_chest/commission_delivery/admin_transfer；物品数量单位为件，按material分别比较。公共箱是存入/取出/净流入，**不是无条件等同自愿捐赠**，不把取出负数叫欠债。三种来源分别展示，不直接合并成总捐赠价值。
- 只统计明确登记的公会共享箱。CoreProtect直接玩家存取由其SQLite真实rowid追踪，排除回滚、漏斗/系统用户；不读metadata私人物品详情。任务交付仅使用已核验阶段里的donate/material/target，不把“需求数”当实际交付。管理员代转与自主存入分别标注；缺失归属不猜。
- `notices[]`说明保留历史、来源边界和缺失。日志只认Server thread/INFO里的AgentFriend固定成功语句，玩家聊天中的伪造文本不能记账。

接收方按每份快照**整体替换该窗口**，不要把每轮数组累加；重复上传不增加计数，旧observedAt拒绝。最多5000条委托、10000条捐赠，超限标partial并显示边界，不截断后算完整率。默认只公开原门户准许的居民，隐藏/Eye/测试身份规则沿用。所有计数与排名在过滤身份后计算，不能漏出被隐藏者贡献。

建议网站入口“世界活动”：7/30日选择、分类完整交付及人数、在途、已知放弃；公共贡献分任务交付/自主仓库存取/服主代转，物品可展开。显示资料时间和数据范围，不发布原始日志。女神读取同一采集快照，先分析任务供给与实际卡点，再试验剧情、入口或奖励调整，并记录基线与复查结果。

## 常驻采集与维护

部署`ops/world-activity.py`、`world-activity-catalogue.json`、`world-activity-run.ps1`与`register-world-activity.ps1`到`E:/MC/ops`。静态目录由`build-world-activity-catalogue.py`从本服Java任务字面定义生成，现为44项；动态任务定义只读现役YAML。使用已有QwenPaw Python/PyYAML，不安装全局环境。

首次执行`register-world-activity.ps1 -Python <现有python.exe>`建立`Qiandengji-World-Activity`计划任务：每60秒及当前Windows用户登录后采集，隐藏窗口、互斥、45秒任务上限。沿现有Portal任务的Interactive/Limited模型，需要运维Windows账号已登录；**不是无人登录时的SYSTEM服务**。不写游戏、不停服、不改防火墙。

`state/world-activity/snapshot.json`原子替换，`health.json`记录上次执行与耗时；失败保留旧快照并写error，页面须把旧observedAt标陈旧。停止用`Disable-ScheduledTask -TaskName Qiandengji-World-Activity`；恢复用Enable/Start，不重放游戏操作。升级先禁用并等原轮退出，备份源码/任务XML/快照到E/F，再替换精确文件、单轮验收后恢复；不删游戏源数据。

2026-10-26实际计划任务首轮返回0，约1.34秒，输出约612KB。近30日读取75个日志文件，10月13–26日现存文件全部读到，较早日期因预算未读取；CoreProtect只读16个登记位置。重复轮按事件ID替换，不把存量翻倍。19项采集回归覆盖真实成功识别、伪造聊天拒绝、结算去重、阶段/放弃区别、分类与公共箱白名单、只读数据库、预算与逐日缺失；原女神工具17项、任务计划5项通过。生产是只读投影，**未新增游戏侧完整审计事件**，旧供货交付/活动中的早期阶段仍可能缺失。

## 门户投影接口（待接路由/发布）

`integrations/agent-portal/src/world-activity.mjs`提供纯函数：

- `validateActivitySnapshot(raw,{now})`核对版本、时间、窗口、数量与记录结构；不接受未来时间、负数量或净额矛盾。
- `activityReplacement(previous,incoming,{now})`用于内部同步整份替换，拒绝旧时间和相同时间不同内容；幂等重发changed=false。
- `projectWorldActivity(snapshot,roster,{days:7|30,excludedNames,now})`返回可公开汇总，以及每位居民按来源/物品分组的存取明细；只捐物而未接单的居民也收录。roster必须来自门户已验证的当前居民来源，excludedNames合并hiddenPlayers与archived_test_roles；源里的名字不能自行取得可见性。排除观察者/管理员/测试/历史冲突身份后，才汇总分类、居民、公共物资与在途。输出没有原始UUID、私有source字段或日志路径。

空源/不可用返回totals=null；180秒以上标stale。分类的accepted/completed/abandoned为各自观察数，不计算完成率。contributions始终按source及material分别计数，不生成混合货币值。13项门户投影回归已通过，包括隐藏者贡献不泄漏、源名字冒充拒绝、重复同步/旧包/冲突时间、窗口、来源和未知状态；**纯模块通过不等于网页入口已上线**。网站线负责原同步渠道、路由、页面与匹配发布，本工作区不重启其在途发布。
