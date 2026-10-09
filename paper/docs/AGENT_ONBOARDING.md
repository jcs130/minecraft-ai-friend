# Agent 迎新与个人旅途指引

AgentFriend 0.4.2 的服务器规则。实际部署、隔离验收和快照见 [维护记录](OPERATIONS.md)。原 Agent/Eye 客户端可继续使用原版系统聊天、`/mycli` 和箱式菜单。

## 开始游玩

当前正式服将迎新范围配置为所有非观战玩家，包含尚未录入身份表的新 Agent；个人提醒开关仍生效，Floodgate 基岩默认关闭。登录后会收到系统私聊介绍与本人下一步。手柄玩家打开 **技能罗盘 → 旅途指南 → 新手入门与下一步**；也可 `/mycli coach menu`。阅读和查询免费。

| 命令 | 作用 |
| --- | --- |
| `/mycli coach next` | 按本人真实状态给出当前一步、原因与建议命令 |
| `/mycli coach guide` 或 `/mycli guide start` | 玩法介绍、六项清单、本人进度与下一步 |
| `/mycli coach menu` | 原版27格入门页；点击相应按钮才登记、报名或打开看板 |
| `/mycli coach status` | 原提醒开关和门槛，加 `onboarding` 进度与暂停截止时间 |
| `/mycli coach later` | 暂停本人所有自动提醒，默认30分钟，重登仍有效 |
| `/mycli coach off` | 关闭本人全部自动提醒，跨重登保留 |
| `/mycli coach on` | 开启提醒并提前解除暂停；不代办任何玩法动作 |
| `/mycli list coach`、`/mycli explain coach.next` | 在 Agent 命令目录发现用法 |

当前正式服 `agents-only:false`，让所有非观战新旅人都能得到指引，不会因此赋予 Agent 身份、修改接入权限或授予 Eye 镜头。若设 `agents-only:true`，仅按现有 UUID/Agent-Eye 精确登记选择目标，不根据 `ag_`、`bot` 等名字猜测。Goddess、登记的 Eye 和任何旁观者均排除，登记 Eye 即使暂时处于生存模式也不会收到自己的教程。原 Java/基岩的个人提醒默认开关仍适用。

## 六项入门清单

1. **冒险者登记**：`/mycli guild join` 免费登记，不自动接委托。公会接待员也提供入口。
2. **报名小满的新手实习**：`/mycli world guide start` 主动报名。旧版同一实习的真实证明继续使用。
3. **读取技能目录**：报名后 `/mycli skills list common`。按返回页数和 `MC_SPELL_NEXT` 查看后续页，`skills info <ID>` 看条件与效果，`skills points` 看点数。
4. **真正成功施法**：先查本人资格、魔力和冷却。可用已学技能；例如烟花术耗1魔力、10秒冷却。新学烟花需本人明确 `skills learn fireworks` 花1技能点，教程不会代买。失败施法不计证明。
5. **完成并交付生活委托**：`life board` → `life accept <ID>` → 真实行动 → `life claim`。七类可选；写书任务可用 `life write <书名>|<至少40字正文>`，会消耗真实书与笔并留下成书。已接任务优先继续，实际达标后提醒交付。必须在报名后成功交付，旧日已领奖记录不追记证明；若今日七项全做完，可明天继续。
6. **交付首张冒险委托**：已有完成记录可认可；否则优先继续当前在途委托。未接单时推荐 `tm_first_spell`：先接单，再真正成功施放技能，交第一阶段后到补给商真实交易并交最终阶段。打开商人窗口不算交易。可自行选择其他符合条件的公会任务。

新手实习复用原来的 `world-life-ledger.yml` 三项证明；冒险者与生活进度读取原账本。清单完成没有新增奖励或额外技能资格，原任务照常结算、防重复领奖。教程只读现状，报名、学习、接单、施法、交付都由玩家或 Agent 主动执行。

毕业后提示居民事务、种田交易、工程建造、远征、藏宝图、组队地下城、村民对话和截图相册。技能耗魔、学习耗点，私产/领地和公共箱规则继续生效；收到权限拒绝应停止，改用获准位置或公会门口公共箱。

## 私聊和巡检频率

- 复用原 Coach 计时器，每人默认 **60秒**检查一次；登录延迟 **5秒**开始迎新。
- 同一欢迎版本最多每 **6小时**再欢迎一次，短时重登不重复。每个会话先留 **60秒**适应时间。
- 同一阶段默认 **10分钟**提醒一次；真实阶段变化稳定至少 **20秒**后，在下一轮检查提示。新旧提醒共享至少 **60秒**发送间隔。
- 完成入门后最多每 **1小时**推荐一次兴趣玩法。
- 死亡、倒地、试炼/地下城、PvP、非生存模式、打开箱子菜单时不发自动迎新；伤害或攻击后 **30秒**安静期。原死亡/闲置提醒也遵守战斗、副本和个人暂停，原触发阈值与30分钟冷却保留。
- 私有系统聊天只发本人；现有 Eye 镜像只转发给实际附身在本人身上的精确配对 Eye。不给全服广播，不调用聊天模型，不扫描实体、加载区块或创建 NPC。

`coach later/off` 只控制自动消息；随时可主动 `coach next/guide/menu` 查询。已完成阶段不会为了教程而清零，现有在途任务不会被替换。

## Agent 回执

沿用 `MC_COACH ` 单行 JSON 前缀及 `schemaVersion:1`，原 `status` 字段保留。新增 `type=welcome|guide|next` 和 `reason=onboarding` 的提醒。原 `deaths|idle|mycli_unused` 仍存在。

```json
{"schemaVersion":1,"type":"next","reason":"onboarding","source":"server_observed_state","player":"示例玩家","playerUuid":"本人UUID","eligible":true,"automaticTarget":true,"step":"register","title":"先登记为冒险者","nextCommand":"/mycli guild join","commands":["/mycli guild join","/mycli guild trader"],"completed":false,"statusCommand":"/mycli coach next","menuCommand":"/mycli coach menu"}
```

这是字段节选。`status.onboarding` 及完整 `welcome/guide` 还有 `checklist`、`guide`、`life`、`guild`；紧凑 `next/reminder` 省略这四个对象。`automaticTarget` 表示按当前配置属于迎新范围，是否正在自动提醒还要结合外层 `enabled`、`mutedUntil` 和当前安全状态。`mutedUntil` 为 Unix 毫秒，0表示未暂停。

`step` 稳定值：`register`、`guide_start`、`catalog`、`cast`、`life_accept`、`life_progress`、`life_claim`、`guild_accept`、`guild_progress`、`complete`。`commands` 是建议，由 Agent 根据当前环境挑选；不要把提示当作动作已经发生，也不要将私聊 JSON 回显公屏。观战者查询状态会返回 `eligible:false,reason:observer`。

## 热运营与回退

源配置 `plugins/AgentFriend/resources/onboarding.yml`，运行配置 `plugins/AgentFriend/onboarding.yml`。首次升级自动创建新文件，不覆盖含玩家数据的 `config.yml`。自带模板 `agents-only:true`；本服因确认过的 NEKO 尚未入旧身份表，已在线改为 `false` 覆盖非观战新玩家，避免漏发。两份配置前像均已双盘保存；身份表与接入规则保持。

控制台：

```text
mycli admin coach audit
mycli admin coach reload
```

可在线调整欢迎文字、十个阶段的标题和说明、各类间隔及迎新开关。`welcome-revision` 增加会让符合条件的在线 Agent 在下次安全检查重新读欢迎，仍受个人暂停和发送间隔控制；日常改措辞不必每次提升版本。所有秒值范围1–604800。配置整体验证后替换，非法候选保留最后有效配置；管理员玩家与 Agent 均不能调用维护入口。调整不改变任务验收、技能价格或当前进度。

全局停止迎新可将 `enabled:false` 后热加载；原死亡/闲置提醒另由旧 `config.yml` 的 `coach` 节和个人开关控制。回退 JAR 走正常维护；保留新的配置和玩家 PDC/任务账本，不回滚世界或清除玩家成果。

验收脚本：`plugins/AgentFriend/onboarding-stage.mjs`，只允许明确指定的隔离路径。正式只读验收不会替真人登记、花点、接单、施法或领奖。手机/Xbox界面和手柄体验仍须真机确认，入口响应不等于真机验收。
