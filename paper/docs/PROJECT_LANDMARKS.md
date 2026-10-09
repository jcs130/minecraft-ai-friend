# 工程委托、建筑管理与公共地标

**0.4.7 候选待发布：**工程完工主人可通过 `land trust/untrust` 管理协作者，`land members` 和实体公告牌公开名单；成员不能转授权或更改公共地标。范围、保存与原版菜单见 [玩家领地](LANDS.md)。正式服仍0.4.5，候选尚未上线。

**部署状态：2026-10-08 13:04 已生效。**CortiLan 的河畔观景塔已按原验收账本交接，礼物箱 `(-558,85,-572)` 公共；其余储物私有。正式验收时主人尚未登记落点，公共目录为 0，须由主人到场公开。41+13 项隔离/重启与 25 项正式只读通过；发布与边界见 [维护记录](OPERATIONS.md)。


AgentFriend 0.3.91 将建造委托与玩家领地连接起来：**接单 → 实际施工 → 全阶段验收与交付 → 完成者管理建筑 → 主人登记安全落点 → 大家付魔力到访**。未配置交接的桥梁、道路和其他公共工程保留原有规则。

## 玩家使用

在公会任务市场查看「完工交接」说明，接单并完成全部阶段。交付后按真实玩家 UUID 登记管理权：主人/受信任玩家可改建和管理私人储物；访客可参观、使用允许的公共设施，到访不会获得拆建或私人储物权限。

主人亲自站进建筑的安全落点，打开技能罗盘 → 传送地点 → **公共地标与建筑 → 管理我的地标**，选择建筑，再点「登记或更新公共落点」输入名字。名字支持 1–24 位中文、字母、数字、`_`、`-`；输入仅发服务器，不进公屏，60 秒内有效，「取消」退出。所有人可在公共地标菜单查看管理者并传送。

登记、更新和撤回免费；**实际成功传送每次 6 魔力**，有标题、粒子、音效。地标不占私人传送点配额。文字入口：

```text
/mycli guild engineering <任务ID>
/mycli guild accept <任务ID>
/mycli guild claim
/mycli land here
/mycli landmark mine
/mycli landmark publish <领地ID> 星河观景台
/mycli landmark list
/mycli goto landmark:<领地ID>
/mycli landmark update <领地ID>
/mycli landmark unpublish <领地ID>
```

只有**当前领地主人**可登记、更新或撤回；受信任施工伙伴和游戏内 OP 不能代替主人。转让领地、撤销地块、关闭地标资格或将范围改到落点之外，立即停用旧点；新主人须自己到场重新登记。重放工程交接不会夺回已转让地块。

落点地板、脚部和头顶须在领地内，脚下为完整实心平面，头顶两格净空，无水、岩浆、火、传送门等危险。传送前再次检查落点、当前管理权、边界、WorldGuard 出入规则及试炼/PvP 限制；等待时移动、点被撤回、魔力不足或不安全均不扣费。不会挖开障碍或生成新地形。

## 配置新委托，无需改代码

在既有 `plugins/AgentFriend/task-market.yml` 的 project / BUILD 委托上增加 handover：

```yaml
tasks:
  lake_view:
    scope: project
    title: 湖畔观景平台
    description: 按已登记场地建平台，完成者负责日后维护。
    icon: OAK_PLANKS
    reward: {fame: 18, emeralds: 8, bonus: LANTERN, bonus-count: 2}
    handover: {land-id: lake_view_platform, site: lake_view_site, landmark: true}
    steps:
      - {title: 建平台, description: 在场地内新增至少32格合规方块。, goal: build, site: lake_view_site, target: 32}
```

`lake_view_site` 须按 [任务市场](TASK_MARKET.md) 先勘察、定义并登记快照。交接范围严格采用这个 BUILD 场地的已登记 min/max，不扩大为全高度、不覆盖其他领地；给屋顶落点预留足够高度。`land-id` 为 1–40 位小写字母/数字/`_`/`-` 的稳定 ID，不得复用其他地块、已删除墓碑或另一交接任务的 ID。`site` 必须是本任务的 BUILD 步骤，不能借道路或不相关场地认领。

```text
mycli admin market reload
mycli admin market register lake_view_site
mycli admin market list
```

任务在接单时冻结，热修改交接 ID 或开关不改写在途责任约定。新工程用新任务/场地 ID，原项目只结算一次；日常、远征、静态 37 项和个人点保留原有账本。首次安装代码需正常备份重启，后续内容与地标运营在线完成。

**归属依据是验收通过的接单完成者。** 增量验收证明新增合规方块，不证明每块都是同一个人放的，也不评审审美、完整楼梯或留言内容。合作施工可由负责人接单，随后通过领地 members 授权伙伴维修；不要把完成者记录说成逐块作者鉴定。

## 礼物箱与私人储物

新交接默认实体储物私有。运营者可在对应 `lands.yml` 地块下明确公开最多 16 格储物方块，然后 `mycli admin land reload`：

```yaml
    public-containers:
      - [100, 71, 100]
      - [101, 71, 100] # 双箱须登记两半，不能借一半打开未公开的一半
```

仅这些位置允许访客取放，拆建仍归主人/受信任玩家；邻近私人箱、木桶、展示物及地面私产不随之开放。WorldGuard 的单格 `qd_public_container_<领地ID>_<序号>` 区域优先级 51，地块 `qd_land_<ID>` 仍为 50；跨领地漏斗仍拒绝。**冒险者公会不允许这个例外**，门内萌萌私产与门口原公共箱规则保持。

## 历史完工补交接与恢复

对上线前已完成建筑，给原任务补 handover、热加载后执行 `mycli admin market handover tm_<原任务ID>`。服务器要求 completed、真实 completed-by UUID、匹配完成时间的 completed history、对应 BUILD 新增方块证据及完成场地快照。只给原验收负责人交接，**不重发奖励、不重置施工基准、不允许未完工认领**。历史缺失时拒绝自动迁移，服主须另行核实，不能凭名字猜主人。

正常完工将收据与完成账本一起保存到 `config.yml` 的 `task-market.projects.<任务ID>.handover`，随后原子写入 `lands.yml` 并同步 WorldGuard。异常返回 `MC_PROJECT_HANDOVER status=pending`，不假报交接成功。正常重启重试 pending；修复冲突或磁盘问题后，也可执行 `mycli admin market handovers`。重试幂等，不重复奖励，不撤销之后合法转让。领地文件存在未重载编辑时阻止自动写入，避免覆盖修改。

## Agent 回执与持久化

- `MC_LANDMARK_LIST` 分页头与逐条 `MC_LANDMARK_ITEM`；本人管理目录 `scope=own`，未公开建筑仅有 ID 与 published=false。
- `MC_LANDMARK_RESULT` 的 action/status/reason/id/manaCost/spentMana。pending 仅表示加载，必须等最终 success/denied；成功还应有 `MC_TRAVEL id=landmark:<ID> mana=6`，并核实实体位置。
- `MC_LANDMARK_INFO` 完整字段含 ownerUuid、builderUuid、projectTask、projectRun、范围与资格。聊天过长时省略描述；完整 UTF-8 JSON 单播在 **mcagent:landmark**，有 type 与 schemaVersion=1。其他玩家不接收本人的操作结果；实际附身的授权 Eye 接收原版消息和菜单镜像。
- `plugins/AgentFriend/landmarks.yml` 按领地 ID 保存公共点，`waypoints.yml` 独立保存私人点/分享码。枚举目录不加载世界区块，实际传送仅异步加载已生成的目的区块。

备份/回退需一起考虑世界、config.yml 完成与奖励账本、lands.yml、landmarks.yml 及 WorldGuard 三维度 regions。不要只回退已领奖者完成字段或重置基准，否则可能重复支付。发布遵循 [维护流程](OPERATIONS.md)。菜单和特效使用原版协议；基岩/Xbox 真机画面仍需实际设备验收。
