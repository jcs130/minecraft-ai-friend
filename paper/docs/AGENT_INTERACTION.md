# Agent 入门、任务进度与可靠背包操作

后续0.4.29候选统一 `status` / 技能只读查询、短迎新、`--help` / `--json` 和无损分页，**尚未部署**。`status` 默认回执有兼容变化，旧详细输出改用 `status full`；见 [当前观察与兼容说明](AGENT_CLI_OBSERVATIONS.md)。本页保留0.4.27已上线能力及测试边界。

2026-10-12：AgentFriend **0.4.27已正式部署**。原维护任务预告、E/F完整冷备份后正常重启上线，包含此前交易板、特色道具说明和完整引导线。远端Agent客户端模块仍须接入方自行同步；发布与回退见[联合发布](COMPLETED_FEATURES_RELEASE_20261012.md)。

## 最小入门闭环

| 入口 | 返回与含义 |
| --- | --- |
| `/mycli`、`/mycli help`、`/mycli intro` | 简短中文入门、本人状态、规则、能力目录、进度和基于实际账本的下一步；不报名、不接单 |
| `/mycli rules [页码]` | 普通已登录玩家可读的8条规则，4条/页；`MC_RULES` |
| `/mycli capabilities [list [分类或命令或all] [页码]]` | 默认顶层能力，再按兴趣查分类；`MC_CLI_LIST/ITEM/NEXT`；发现不记实练证明 |
| `/mycli capabilities info <ID>` | 参数、身份条件、副作用、资源消耗和结果查询；`MC_CLI_DETAIL` |
| `/mycli progress [all或main或training或guild]` | 主线、专项、公会进度分项；不报名、验收、交付、领奖或释放过期任务 |
| `/mycli coach lessons` | 只读查看六项特色实练 |
| `/mycli coach enroll`、`coach cancel` | 明确报名/取消，`MC_COACH type=feature_enrollment status=success`；取消保留证明 |
| `/mycli coach menu` | 原版入门界面，查看、报名、取消是独立按钮，支持Geyser翻译 |

新登录默认在安全时发送入门回执，遵守原有个人暂停、关闭、战斗安静与限频设置；主动查询可用。基础`/help`、`/rules`、`/bukkit:help`权限通过默认父节点开放，不授管理权限。显式权限组拒绝仍按原系统处理，`/mycli rules`另提供独立可读路径。规则来自首次启动创建的`agent-guide.yml`，没有增加新的强制保护区。

推荐先读`intro → rules → capabilities info progress → progress`，再自主选择建议动作。目录默认不要求翻完251项命令，按分类及`MC_CLI_NEXT`继续即可。普通连接把查询间隔保持约一秒，避免原版聊天防刷屏踢出；动作等回执后再继续。

## 统一进度与只读边界

每条`MC_PROGRESS`含`schemaVersion=1/scope=self/playerUuid/snapshotId/observedAt/readOnly/page/pages/progress`。按同一`snapshotId`收齐分页，不能把第一条当作整个列表。正常all为10条：

- `section=main`：`stage/stageTitle`、六项清单、`missingConditions/nextCommand`、三证实习和独立`graduated`。
- `section=training`：六项专项的`id/title/enrolled/done/stage/missingConditions/nextCommand`。
- `section=guild`：冒险、生活、能力认证的实际条件、进度、缺项与下一步；市场任务另含`market.stage/stages/stageTitle`。工程必须主动验收，查询不能替代施工或交付。

例如背包专项`done=true`而主线`stage=guide_start, graduated=false`是有效状态：仍需主动报名三证实习。无任务不等于任务完成，缺失在途定义会显示不可用并保留原任务。

新查询不调用旧的带刷新路径：生活房屋即时检查不写缓存，认证等级只读映射，不触发迁移；通行完成清理放回实际动作事件。旧`guild status/board`、`life status`及部分考试查询保留兼容的刷新，目录会说明。`guild verify`属于主动验收，会更新证据，不能按旧`mode=read`判断只读。

## 能力语义与兼容

`MC_CLI_DETAIL`保留原字段，新增`semantics`：

- `operation=query/enroll/execute/cancel/group`，命令组不代表所有子动作只读。
- `readOnly/sideEffects`，包含证明、报名、物品、位置、界面、追踪和报价ID的状态变化。
- `parameters`列参数及必填性，完整分支/枚举保留在`usage`。
- `permission/requirements`分清普通本人、角色/领地/活动前提及仅控制台/RCON入口。
- `consumption`说明资源；学习升级用`skills info <ID>`读取本人当前价格。
- `resultQuery/completionPolicy`说明核对方式，发出/submitted/pending不算完成。

`discoveryReadOnly=true`说明读取目录本身不执行目标、不记证明，和目标命令的`semantics.readOnly`分别理解。

兼容变化：`coach lessons`改为只读，新报名调用`coach enroll`，旧报名和证明保留。明确开始原生操作考试仍会报名相应实练，属于主动动作。旧`list/explain/help <ID>/status/skills list/explain`保留已报名时的阅读证明机制，不自动报名；纯发现用`capabilities`。旧完整帮助移到`help full`，旧help带ID继续有效。原中文`/mycli 入门`是补领工具别名，继续保留；新的中文只读入口是`/mycli 入门状态`。

## 可靠大背包客户端模块

代码：`paper/ops/mineflayer-inventory-session.mjs`。第三方机器人的实际启动源码不在本机，因此交付可移植模块，**不宣称远端已接入**。使用原版协议及现有`/mycli inventory refresh`，无需新增服务端数据包，P0可先对现役支持refresh的服务器接入。

1. 每连接一条队列，串行打开、查询、存取、核对和关闭。目前仅验证Java **1.20.6**，其他协议明确拒绝，不能把多版本代理范围当作模块验收。
2. 只用服务器`open_window/window_items/set_slot`建立镜像，同时核对容器、玩家36格储物及光标；收到服务器数据才同步Mineflayer缓存，不用本地预测或click Promise报成功。
3. 普通点击不提交预测槽位，等真实变化；光标兼容`-1/255`。物品组件按无序映射计算身份，描述、书页等有序内容仍完整核对，不排序。
4. 真实打开包创建新连接/窗口代次；重复高层回调不触发动作，不跨关闭缓存未知窗口包，不把复用编号或相同标题当成同一窗口。
5. 稳定`operationId`最近128条有界去重。可能发出点击后的超时、窗口变更或断线返回`unknown`并冻结后续写入，不补偿、不丢光标、不重放。未发送的参数/容量错误为`not_executed`。
6. `reconcile()`取新的整窗及光标，核对原始/最终预期状态，只有`confirmed/not_applied`才解除冻结；部分变化继续未知。`not_applied`不等于自动重试授权。
7. 跨重连防重放必须为每UUID启用独立本地journal并复用operationId；不启用journal只保证当前连接。首个点击前保存意图，完成后保存回执，重连载入未决状态。损坏、错主人、写失败会停止写入。不要删journal来恢复。
8. 跨连接/窗口默认不解除未知。显式重开同UUID本人的Minepacks后，`reconcile({allowPersonalReopen:true})`分别核对整个包、本人库存、光标的所有完整物品身份/数量，允许关闭时换槽或合并。其他物品变化、不同容器或无法确认归属仍未知，需人工核对。
9. `close()`返回`close_requested`，仅代表关闭已发送；重开核对才验证持久化。支持普通9列储物，单次一个源槽、1–64件、一个可容纳目标槽；不用它操作交易/合成/菜单或批量搬运。

同连接的所有存取均走此模块，不混用`bot.deposit/withdraw/clickWindow`或其他执行器。外部玩家/插件同期改物品会导致未知；装备、制作网格、掉落物和其他插件窗口不属于这次36格/光标核对范围。

### 接入示例

在首次spawn后、已有登录成功门禁确认之后初始化；认证流程及密码不改。配方绕过仍需在createBot后立即按[客户端兼容](MINEFLAYER_CLIENT_COMPAT.md)安装。

```js
import {installInventorySession, createInventoryJournal} from './mineflayer-inventory-session.mjs';
if (!process.env.AGENT_STATE_DIR) throw new Error('请配置AGENT_STATE_DIR到私人可写目录');
const bag = installInventorySession(bot, {
  Item: require('prismarine-item')(bot.registry),
  journal: createInventoryJournal(`${process.env.AGENT_STATE_DIR}/${bot.player.uuid}.inventory.json`),
  onReceipt: r => logger.info({inventoryReceipt: r})
});
const opened = await bag.open();
if (opened.status !== 'opened') return stopThisTask(opened);
if (opened.blocked) return reportAndReplan(await bag.reconcile({allowPersonalReopen: true}));
const s = opened.snapshot;
const slot = s.slots.findIndex((i, n) => n >= s.inventoryStart && i?.name === 'paper');
if (slot < 0) return reportMissingPaper();
// operationId和任务一起保存，不能重试时重新生成。
const r = await bag.transfer({operationId: task.operationId, direction: 'deposit', slot, count: 1});
if (r.status !== 'confirmed') return reportAndPause(r);
await bag.close();
const reopened = await bag.open(); // 核对目标数量、身份与空光标后，再继续。
```

`AGENT_STATE_DIR`需客户端指定可写私人目录；同UUID由单个进程使用journal。日志含物品，留在私人目录，不放Git。上述报告/暂停函数代表调用方自己的任务控制，不是另一个自动重试器。

## 验证

Paper1.20.6克隆、Java21、Node22、loopback Java25644/RCON25645/Geyser19155；不是生产压测或自主LLM长期测试。脚本校验隔离路径和地址，要求`MC_STAGE_PAPER/MC_TEST_REPORT_DIR`；Mineflayer用`MF_REQUIRE_FROM`指定依赖，基岩用`MC_TEST_BEDROCK_REQUIRE_FROM`。

| 测试 | 结果 |
| --- | --- |
| `node --test paper/probe/mineflayer-inventory-session.test.mjs` | 17项通过：串行、延迟、重复回调、编号复用、未知/查询恢复、断线、journal错主人/失败、组件换序与描述顺序 |
| `paper/ops/tests/agent-interaction.integration.mjs` | 原始Mineflayer4.39最终38项通过：普通权限、纯查询账本、完整251项分页、语义、真实Eye私有转发、真实背包闭环、原生存档及正常重启保留 |
| `paper/ops/tests/inventory-session.integration.mjs` | 原始4.39最终13项通过，4.37.1也通过13项：每方向180ms TCP延迟、隐藏最终光标确认、实际断线、重连只查询恢复，原生存档仍8张纸，无重放 |
| `paper/ops/tests/agent-entry-bedrock.integration.mjs` | 基岩协议1.26.51/Geyser2193共13项通过，中文入口/规则/分页/报名取消/独立按钮；未验手机或Xbox真机 |

完整证据私存E/F `repairs/agent-interaction-20261012`。Mineflayer4.39使用从官方npm包重新解压的原始源码及本仓库显式兼容模块；未把旧本地inventory补丁当作官方行为。初轮查询太快踢出、无符号光标未识别、断线夹具源槽数量不足、跨重连组件换序误判均保留失败回执，最终另存。

最终JAR SHA256：`179D20A48761EFD8BB73FFCECA1ADBEC19F8ED946B3454F6EE181D95EBA0F719`。最终`native-f.json`、`inventory-native-4.json`、`entry-bedrock-2.json`记录同一摘要；故障17项、原生38项、网络故障13项、基岩13项分别统计。隔离服已正常停机，正式0.4.23 JAR前后摘要保持。

## 改动文件与回退

- 客户端：新增`paper/ops/mineflayer-inventory-session.mjs`。
- 测试：新增`paper/probe/mineflayer-inventory-session.test.mjs`及`paper/ops/tests/`三个联机脚本。
- 入口与目录：新增`AgentEntry.java`；修改`AgentFriendPlugin.java/AgentCliCatalog.java/AgentCoach.java/OnboardingGuide.java`。
- 只读状态与报名：修改`FeatureTutorials.java/GuildManager.java/LifeGuildManager.java/TaskMarketManager.java/SkillAssessments.java/NativeTraversalPractice.java`。
- 资源/构建：新增`resources/agent-guide.yml`；修改`resources/plugin.yml/resources/onboarding.yml/paper/config/AgentFriend/onboarding.yml/build.ps1`。
- 文档：本文件、`MYCLI_AGENT_CLI.md/AI_WORLD_OPERATIONS.md/paper/AGENTS.md`。

生产部署和重启另行确认，按既有预告、真人/副本检查、双盘完整备份和固定摘要流程；本轮未创建维护排队计划。不要先把修订7欢迎热更到仍缺新命令的0.4.23。

客户端接入不要求重启Paper；回退先暂停存取、核对未知和光标，保留journal及实际物品，关闭bot后撤下模块，不重放队列。服务端回退只恢复原JAR和变更配置前像；保留世界、背包库、新证明、技能与奖励，不整库回滚玩家进度。

参考实际安装源码及[官方inventory插件](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/inventory.js)、[官方clickWindow接口](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md#botclickwindowslot-mousebutton-mode)。
