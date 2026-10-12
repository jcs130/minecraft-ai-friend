# 千灯纪 Agent CLI说明（当前0.4.32）

以下为0.4.31首次CLI发布记录；现行0.4.32 / Eye0.1.15继承这些语义。已提前提醒、正常停启 Paper/登录代理/模型服务；E/F 完整冷备份 `20261012-184302` 均在替换前完成。正式联机13项和备份/配置/身份/服务状态22项通过；Goddess、可米、NEKO原UUID回连。普通难度、三维度死亡保留物品、既有密码与背包保持。首轮E/F `20261012-182554` 保存更新前0.4.28/Guard0.1.0；本轮快照保存修正前0.4.30/Guard0.1.1，完整回退CLI时优先使用首轮稳定原件。

## 0.4.32后续已上线

AgentFriend 0.4.32 / CortiEyeMirror 0.1.15 已正式上线。提前180/60/10秒通知、真人和活动副本门禁通过，原维护任务正常停启，E/F完整冷备份 `20261012-211001` 均在替换前完成。正式认证/背包/观战联机17项、备份/身份/服务状态29项通过；登录、原UUID、保护权限、普通难度与三维度keepInventory保持。yubeen重连到代理但未/login，已登录超时；远端须使用既有密码完成登录，未重置密码，不宣称所有客户端已恢复。

protect命令可选--json；私有MC_*回执仍给Agent本体，Eye/live隐藏机器回执，维护只广播中文。其余0.4.31CLI语义保留，见[聊天范围](CHAT_AUDIENCE.md)。

## 可直接转发给 Agent

```text
千灯纪 Agent 使用说明（0.4.31）

1. 登录成功后再行动
等待私有提示 [MC_AUTH_SUCCESS] 登录成功，可以开始游戏。
/authstatus：查询本次登录状态。unknown/null 表示暂时无法确认，不等于密码错；不要反复登录刷屏。原有密码与正版/Eye规则保持。

2. 统一入门与帮助
/mycli：简短入口
/mycli rules：规则
/mycli capabilities：能力目录
/mycli capabilities info <ID>：参数、权限、消耗、副作用、结果查询
/mycli skills learn night --help：只看学习说明，不会学习/扣点

3. 当前状态与任务
/mycli status：只读当前状态，返回 MC_STATUS
/mycli status --json：同一结构化状态
/mycli status full：原来的详细输出/实练证明；依赖旧输出的客户端用这个
/mycli progress all 1：分页查看主线、专项实练、公会委托
/mycli skills status：本人技能资格、魔力成本和实际冷却
/mycli skills status all 1：分页查看全部技能
只完成专项不等于主线毕业；以 mainlineGraduated 或主线 graduated=true 为准。

4. 分页与时效
MC_PAGE 有后页时，复制 nextCommand 继续；不要自己猜页数。能力目录保留 MC_CLI_LIST/ITEM，按 MC_CLI_NEXT 续页，不强行当作 MC_PAGE。
分页是本连接5分钟内的冻结快照；要最新进度重新发起查询。
重连后 sessionId 会变，丢弃旧状态与旧分页。
--json 支持 status、progress、skills status、page、capabilities、protect；其他命令不支持，不能统一追加。

5. 新手实练与背包
/mycli coach lessons：只看课程
/mycli coach enroll：主动报名
/mycli coach next：查下一步
/minepacks:backpack open：54格普通大背包
/questbag：剧情任务袋
/mycli arena stash：个人奖励箱
三者独立。背包操作串行执行，等槽位和光标确认；超时是结果未知，先查询，不能自动重复存取/消费/领奖。可靠客户端适配模块仍须开发者接入。

6. 其他常用入口
/mycli arena status：试炼塔状态
/mycli dungeon status：遗迹地下城状态，和试炼塔分开
/mycli photo menu：女神相机菜单，无需截图上传

命令发出不等于完成，以本人实际回执和结果查询为准。私有 MC_* 状态不要转发公屏；公共公告不作为自己的任务指令。
```

## 本次发布与兼容

- 0.4.29 的短引导、只读状态、技能状态、无损分页、帮助与真实认证观察合入0.4.31。欢迎修订8；既有实练与主线资格保留。
- 状态默认语义改变：旧详细状态及状态实练证明入口改用 `status full`；未带页码的 `progress` 保留旧流式回执，显式页码或 `--json` 使用 `MC_PAGE`。
- LoginGuard0.1.1复用真实原子心跳，Paper按UUID和当前连接校验，不写密码或哈希到回执；不知道时返回未知，不猜测失败或成功。
- Java/Web文字气泡改为半透明白底，默认背景180/255，文字仍不透明。基岩仍为亮色标签，无背景框；未做手机/Xbox实际画面验收。
- 远端Web和第三方Agent须运行端同步代码；本次没有宣称另一台电脑的页面已更新，也没有上线注册门户。

## 验证与回退

发布前：原CLI候选35项真实Mineflayer、8项基岩协议、9项重启回读；CLI分页/认证124断言、可移植客户端37项；真实Velocity→LibreLogin→Paper组合15项；气泡28项原生/Web桥与8项Web单元；实际待部署维护助手在PowerShell5.1通过5项（校验摘要、拒绝第三方移除、服务未停拒绝）。上述隔离证据不能替代真人设备验收。正式上线后：认证联机13项，状态22项。

首次维护派发在停服前发现准备文件字符串替换损坏，已恢复并修复。0.4.30上线实际验证又发现未知冷却被Java自动拆箱的异常；0.4.31改为显式分支保留null，增加give未知冷却和完整技能目录分页回归，隔离真实Mineflayer39项通过后再按完整备份流程维护。两轮失败回执保存在E/F repairs/cli-bubbles-release-20261012；本次最终回执位于cli-cooldown-fix-20261012。

AgentFriend0.4.31 SHA256：`793707fc352bc2add5747766b05bfe18987ad5e7930fdab418c5e0ef904ad13d`。LoginGuard0.1.1 SHA256：`127f4a789bdf51b48c0cb3fd4fc9562af8908986084009693d833b3bff1a70bd`。

私有完整证据位于E/F `repairs/cli-cooldown-fix-20261012`；玩家说明不含密码和玩家审计。代码/配置回退按OPERATIONS提前通知、正常停启，使用该目录deployment-rollback的两项修正前原文件；若要完整退回本次CLI更新前的稳定0.4.28，使用cli-bubbles-release-20261012/deployment-rollback的六项原文件及维护助手原件；优先只恢复JAR/配置，保留玩家最新进度。全量快照包含原世界与模型/登录私有服务，仅在确需整体恢复时成套使用，并告知快照之后的进度会回退。
