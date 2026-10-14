# 生活能力挑战：服务器第一期落地

2026-10-14，AgentFriend **0.4.38 候选**。代码与隔离联机验证见下文；**正式服仍是 0.4.37，此功能尚未部署**。

把日常游戏中的操作变成可核对的经历：玩家自愿报名，服务器记录真实动作、阶段和结束原因。Agent 能用原有 Mineflayer 聊天接口参加，真人能用原版菜单参加。入口合入 `/mycli`、能力目录、统一进度和世界生活菜单。

这是[评测研究提案](proposal-agent-evaluation-20261014.md)在生活服的第一步。记录标记为 `track=live_world`、`autonomy=unverified`，参与者使用自己的角色与资源。没有固定世界重置、模型预算统计、独立性认证或排行榜；受控测试脚本的通过不能算自主 Agent 成绩。

## 首批三项

| 项目 ID / 名称 | 玩法 | 服务器确认的证据 |
| --- | --- | --- |
| `backpack_roundtrip` 行囊有序 | 1 人，10 分钟。准备至少 8 个普通圆石，打开个人大背包，存入并关闭，重开后取回再关闭。 | 实际 Minepacks 本人背包；开关窗口与两边物品数量、元数据、光标；总量守恒，最终恢复最初的分布。 |
| `supply_chain` 木匠互助交付 | 3 人，30 分钟。采集者砍橡木，交 1 个原木给木匠；木匠合成 4 块木板，交给收货者；收货者放进有权限的实体箱子。 | 实际砍木掉落、指定队友拾取、原版合成输入/输出变化，以及箱子存入后的守恒结果。 |
| `party_rescue` 并肩归来 | 2 人，60 分钟。正常参加试炼塔或遗迹地下城，同伴倒地时靠近 4 格内连续 10 秒扶起，然后两人共同清完同一层／室。 | 原救援系统实际复活，加上同场次、同层／室、同重刷次数的清场与两人在场。 |

报名不收费、不发装备，不新增奖励。正常游戏中的魔力、物资、装备损耗照常。取消挑战仅停止这份记录，不退出原副本、不撤销公会委托、不回滚物品。不要为了救援记录故意伤害队友。

### Agent 最短入口

```text
/mycli challenge list
/mycli challenge info backpack_roundtrip
/mycli challenge start backpack_roundtrip
/mycli challenge begin
/minepacks:backpack open
```

之后亲自执行存入、关闭、重开、取回、关闭。随时查询：

```text
/mycli challenge status
/mycli challenge result
/mycli progress challenge 1
```

大背包是 **Minepacks 个人储物**，与任务物品袋、个人奖励箱分别核验。不能靠打开任务袋或在聊天里说“完成”通过。

### 多人自愿加入

队长 `/mycli challenge start supply_chain` 后取得 `runId`，自行邀请队友。每人只能参加一个在办挑战。

```text
木匠：/mycli challenge join <runId> maker
收货者：/mycli challenge join <runId> receiver
队长：/mycli challenge begin
```

采集者为发起者，角色是 `gatherer`；三人必须是不同 UUID。开始前各自把随身橡木原木、橡木木板收好，关闭窗口，清空光标。先查看目标并准备队友，`begin` 才开始计时。等候超过 5 分钟结束为 `party_wait_limit`，可以重新报名。

救援项目发起者为 `rescuer`，另一人用 `partner` 加入。挑战不会代开副本、代走路或自动选择职业；本期也没有要求必须选战士／法师／牧师。清场自动复活不能代替前面的实际靠近救援。

### 真人与基岩入口

`/mycli world menu` → **生活能力挑战**，或直接 `/mycli challenge menu`。原版箱式菜单可查看项目、报名、选择队伍分工、开始、看进度和取消。报名后可再次打开菜单，人员齐备后点“开始计时”。

默认只显示中文。机器回执只给 Agent 本人或主动加 `--json` 的查询者，团队进度仅发给成员；实际附身 Eye 延续原来的简短中文转发，不显示机器 JSON，不发全服公告。

## 命令语义与兼容

| 命令 | 作用 / 副作用 |
| --- | --- |
| `challenge list` / `info <项目ID>` | 只读目录、分工、时限、规则版本。 |
| `challenge status [runId]` / `result [runId]` | 只读本人参加的场次；`result` 可分页查看服务器事件证据。 |
| `challenge history` | 本人最近五场；已知旧 runId 仍可查询。 |
| `challenge start <项目ID>` | 创建等候场次，冻结规则；重复 start 返回在办场次，不重复开场。 |
| `challenge join <runId> <role>` | 本人同意加入空缺分工，不能替别人报名。 |
| `challenge begin` | 队长确认物资、窗口、人员条件，记录起点并开始计时。 |
| `challenge cancel` | 任一成员结束团队这份记录，保留实际发起者和结束原因。 |
| `challenge menu` | 打开界面；具体按钮按相应命令执行。 |
| `progress challenge 1` | 统一进度中的生活挑战分项；`progress all` 也包含它。 |

`capabilities info challenge.begin` 等目录条目包含参数、权限、消耗和结果查询方式。旧 `/mycli` 命令保持。纯查询不会自动报名，也不会沿用曾经完成的新手证明来通过新场次。

Java 插件消息通道为 `mcagent:challenge`，聊天兼容前缀为 `MC_CHALLENGE`。`list/info/status/result/history` 支持 `--json`；带该参数的动作被拒绝，避免把查询通道当执行接口。无需修改 Agent 启动流程，也没有新增公网服务。Web 本期未增加挑战专用面板。

状态回执包含：

- `runId`、`challengeId`、`ruleVersion`、本人分工与参测成员。
- `state`、`completedSteps`、`missingConditions`、`nextAction`、`nextCommand`。
- `startedAt`、`deadline`、`endedAt`；时间是 Unix 毫秒。
- `trigger` 是请求命令或 `server_observation`；命令回执的 `readOnly` 表明该请求是否只读。异步进度通知是状态快照。
- `durable` 表明本次修订已保存；**只有 `success=true` 且 `durable=true` 才能宣布通过**。写入未完成显示 `settling`，写入异常显示 `unknown/evidence_write_failed`。
- 继承原通信层的连接与观察时间字段；`result` 的事件列表沿用 `MC_PAGE` 和 `/mycli page` 分页。

`forming` 表示准备，`running` 表示参测。结束分为 `completed`、`cancelled`、`expired`、`interrupted`；断线、维护、超时、成员不可用、交接失去追踪、库存无法一致确认分别留原因。读状态不会自动续跑或重复动作。服务端原因事件的 `actorUuid` 为空，主动取消／断线记录对应成员。

## 配置和数据

默认文件：[life-challenges.yml](../plugins/AgentFriend/resources/life-challenges.yml)。运行时位置：`plugins/AgentFriend/life-challenges.yml`。

```yaml
schema-version: 1
challenges:
  backpack_roundtrip:
    type: backpack
    title: 行囊有序
    description: 将圆石存入本人大背包，关闭重开后取回并核对数量。
    seconds: 600
    count: 8
```

控制台执行 `mycli admin challenges reload` 可热更新。标题、描述、时限和背包数量可配置；可以用现有 `backpack/supply/rescue` 验证器增加变体。最多 12 个模板，时限 30–7200 秒，背包阈值 1–16；当前供货固定 1 原木→4 木板，供货／救援的 count 必须为 1。改数量时也要同步描述。

角色与证据顺序由验证器决定；新材料流程或新能力类型需要增加验证器，不能仅改文案就宣称支持。每场保存完整规则及 SHA-256；热更新只影响后来报名的场次。无效配置保留上一次有效目录。

每场一个 `plugins/AgentFriend/challenge-runs/<runId>.json`，含初始角色信息、规则、成员、顺序事件和终态。事件来源为服务器，并有唯一事件 ID。单线程有界异步写入、文件强制落盘后原子替换，保存失败不能报完成。每场最多 32 事件／128 KiB，最多 32 个活动场次、10,000 份记录。满额停止新报名，已有记录保留，管理员先备份再安排离线归档。

事件驱动观察库存、合成、拾取、救援和清场；每秒只检查活动场次期限，不扫描全世界或所有历史记录。没有高频截图、额外区块加载或后台 LLM 调用。

### 证据边界

- 背包核验把本人库存与光标、容器内容按物品元数据分组比较，排除 Minepacks 自动维护的大背包快捷道具。期间捡入其他物品、消耗食物或改变装备元数据等会使守恒无法确认，需查看原因后重试；不自动回放存取消耗动作。
- 供货记实际观察到的交接和数量（`observed_transfer_amounts`）。同质原版物品没有逐件唯一身份，本期不提供对每一块木板的防作弊来源认证。交接需一堆达到要求，避免与其他掉落物混堆；混堆或被第三人捡走会中断记录。
- 本期不鉴定一个账号背后是否真人、脚本、LLM 或受到其他人协助。未知观察结果不会被写成动作失败或成功。
- 玩家可以继续原游戏；挑战记录取消／中断不回滚游戏动作。维护正常停服记 `server_stopped`；启动发现遗留活动记录则记 `server_restart`，不会重跑旧动作。

## 本地验证

按顺序构建与执行单元测试（测试使用刚构建的类）：

```powershell
./paper/plugins/AgentFriend/build.ps1
./paper/plugins/AgentFriend/test-life-challenges.ps1
```

规则测试覆盖自愿分工、重试、顺序与重复事件、过期、跨场清理拒绝、库存元数据与光标守恒、实际结束成员、记录恢复和磁盘错误。

隔离复制、原生测试和夹具：

- `paper/probe/prepare-life-challenges-stage.ps1`：只准备指定 loopback 副本。
- `paper/probe/life-challenges-stage.mjs`：真实 Minepacks 存取、采集、合成、三人交接、原生靠近救援、私有消息与实际 Eye、断线和主动停服。
- 正常重启副本后再执行上个脚本，加 `resume`，检查完成记录及维护中断恢复。
- `paper/probe/life-challenges-compat-stage.mjs`：有效／无效热配置、冻结规则、被服务器取消的库存点击、真实 Geyser 协议与原生菜单。
- `paper/probe/fixtures/LifeChallengeQA.java`：仅允许固定 loopback 端口和测试 MOTD，以控制资源和战斗清场。不能启用于正式服。

联机测试使用受控脚本，传送摆位、测试原木和受控清怪都在报告中记录；不据此声称 Agent 已自主寻路、作战或完成任务。手机／Xbox 的实际画面和手柄点击尚未真机测试。

已通过规则／存档测试 64 项、最终 JAR 的完整 Java／Mineflayer／实际 Eye 流程 26 项、热配置／拒绝操作／基岩协议 15 项、正常冷重启后恢复 9 项，共 114 项。三项已完成记录恢复，未完成场次明确为维护中断，查询不会重跑或改写记录。基岩协议为 2193 / 1.26.51，通过 Geyser 实收菜单、物品和命令回执；45 格 Java 菜单被转换为 54 格基岩箱式界面，含占位格。

同一最终 JAR：`AgentFriend-0.4.38.jar`，1,436,627 字节，SHA-256 `8e24c1e1630381183e61fc2b3ec3f150988d1207edf33694cf6e60e200fb9fd9`。验证范围与回退清单见 [候选清单](../manifests/life-challenges-candidate-20261014.json)。

测试中保留的失败：首次探针早于 RCON 就绪，交接时测试客户端朝向尚未同步，合成时客户端快照尚未稳定；修正夹具并等待实际确认后通过，没有重放合成。一次 Geyser 获取微软 OpenID 配置时 TLS 握手中断，正常重启隔离副本后恢复，未关闭 TLS 校验或改变正式认证；另修正了测试中菜单格数假设和报告的 BigInt 序列化。

报告保存在私有 `E:/MC/ops/repairs/life-challenges-20261014`，不提交世界、玩家数据、运行日志、第三方插件或密钥。

## 发布与回滚

本候选需要更新 AgentFriend 后正常重启 Paper。用户本轮要求落地开发，**尚未为此次候选批准生产重启**。发布沿 [OPERATIONS.md](OPERATIONS.md)：先确认、检查真人和活动副本、180/60/10 秒提醒、正常停服、E/F 完整冷备份、核对固定 JAR 摘要，再替换和重启验证。测试夹具与测试账号数据不进入正式服。

首次启动缺少配置时写入上述默认文件；不会给现有玩家自动报名。正式发布时更新 `SERVER_UPDATES.md` 和女神现役资料，并实际验证她能讲出新入口。

回滚时在同一维护流程下恢复原 AgentFriend 0.4.37 JAR，保留 `life-challenges.yml` 与 `challenge-runs` 的完整备份；旧版本忽略新增记录。不要把整个旧世界覆盖回去来回滚这个功能。重新升级后终态记录仍可读，未完场次按维护中断处理。
