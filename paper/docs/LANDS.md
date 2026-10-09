# 玩家领地

**0.4.7 候选待发布（2026-10-09）：**新增主人自主授权/撤权、公开协作者名单、原版管理菜单与实体公告牌。正式服仍为 0.4.5；按服主要求不重启，不将下列新入口说成已经上线。0.4.7 同时包含待发布的 0.4.6 自然建筑保护。

## 主人管理协作者（0.4.7 候选）

```text
/mycli land members <领地ID> [页码]
/mycli land trust <领地ID> <完整玩家名或UUID>
/mycli land untrust <领地ID> <完整玩家名或UUID>
/mycli land manage <领地ID>
/mycli land board <领地ID>
```

**当前非观战领地主人**可管理自己的协作者；**领地超管**可跨领地授权/撤权，包括在观战状态下操作。女神沿用服务器已核实的固定 UUID、本机保留登录、OP 与观战身份，不按名字相似自动认定超管。其他管理员须显式获得 `agentfriend.land.admin`（默认 false）；普通 OP 和协作者没有转授权权。这些入口不改变主人、边界、其他地块或公共箱规则。成员可在该地块拆建、管理私有物品和箱子，原有公共建筑、自然结构和活动保护仍参与判定。授权是免费领地管理，不是魔法技能。

目标必须是服务器已核实的在线或曾登录玩家；支持完整账号名（大小写不敏感）或完整 UUID，不按显示名、皮肤名、部分名字猜测身份，不联网查询陌生账号。基岩玩家使用实际 Floodgate 账号名/UUID。离线成员可撤权，成员 UUID 持久保存；重复授权或撤权返回 `unchanged`，不重复写入。每块最多64位协作者，同一操作者的实际名单修改至少间隔1秒。

授权结果私发给操作者及其实际附身 Eye；女神 MCP 调用同时返回控制台回执。`MC_LAND_MEMBER_RESULT status=success` 才表示修改成功；`denied` 给出原因和下一步，`actorUuid/authority` 标明实际操作者和 owner/administrator/visitor 身份。更新沿用 `lands.yml` 与 WorldGuard，立即生效；撤权会关闭已失去权限的私有箱。管理员文件存在未加载修改或保存失败时拒绝本次操作，防止覆盖配置。成功修改在服务器日志记录操作者、动作、领地、目标 UUID 和当时主人。授权不会自动给协作者发私聊，主人可自行在游戏内告知。

主人和超管首次登录时会收到一次说明；`land info/here`、`/mycli explain land.trust` 随时可重新读取。罗盘 → 领地归属 → 选择地块打开公告页；主人或超管点击“授权玩家”，选择在线玩家，阅读拆建/私有箱权限范围后确认。协作者名单中点击成员可确认撤权。每页9人，可翻页；所有人都能查看名单，访客页面不提供修改权限。确认时重新检查身份，打开旧菜单不保留已失去的主人或超管权限。

### 超管与女神工具

其他超管可由服主在现有 LuckPerms 中精确授权：`lp user <已核实账号或UUID> permission set agentfriend.land.admin true`，撤销用 `permission unset agentfriend.land.admin`。这项权限只管理协作者名单，不直接给予拆建、取物、转让领地或修改其他保护的权力。

候选 `goddess-mcp.py` 增加 `land_members(land_id)` 和 `manage_land_member(land_id, player, action)` 两个工具。动作只有 `trust/untrust`，不接受任意命令；先读当前名单，对明确的授权请求操作，不因玩家被拒绝就自动放行。服务端控制台适配命令为 `mycli admin land members <ID>` 和 `mycli admin land member trust|untrust <ID> <玩家名或UUID>`，后者必须在线女神 OP 观战身份通过检查，仍走同一保存、撤权和审计事务。超时后先读同一地块名单，不盲目重发。候选尚未部署或重新发现工具，不表示女神已获得新版操作入口。

### 实体公告牌

每块领地使用原版双面上蜡木牌，牌面显示领地名、当前主人和协作者人数；右键打开27格公告页查看完整名单。`land board <ID>` 返回实际世界/坐标、`ready/pending/unverified` 和下一步。名牌没有传送或物资操作，基岩/Agent 不需要新客户端。

公告牌优先寻找边界附近安全地面：水平最多离边界2格，兼容位于高层的仓库；垂直检查该地块底部附近和已加载地表。只放在有实心安全支撑、上下净空的空气格，避开门、梯、楼梯及其他领地，不替换已有方块，不强加载或生成区块。没有安全位置时保持 `pending`，不能声称每处已经建好；待原有区块加载或管理员修好位置后，执行 `mycli admin land reload` 重查。控制台 `mycli admin land boards` 审计全部位置与状态。

公告牌及其一格支撑作为公共信息设施保护，主人也不能误拆；`protect break` 明确返回 `land_notice_board`，右键查看不受访客设施使用开关限制。成员变化或领地转让后立即更新文字，普通玩家不能编辑；保护爆炸、火、水流和活塞。位置索引 `land-boards.json` 只记录实体牌位置，归属和名单始终读当前领地数据；不要手改索引，异常时保留文件联系服主。没有增加定时世界扫描。

源命令示例（新版本发布后才可用）：CortiLan 可用 `/mycli land trust sky_view_tower LittleFish0510` 授权小鱼，`/mycli land untrust sky_view_tower LittleFish0510` 撤权。这只是用法说明，本轮没有替他授权。

0.3.91 支持 BUILD 委托完成后交接建筑，主人到场登记公共地标；显式 `public-containers` 可开放非公会地块的指定礼物箱，其他储物仍私有。配置与迁移见 [工程与公共地标](PROJECT_LANDMARKS.md)。

AgentFriend 0.3.90 以现有 WorldGuard 7.0.10 执行领地权限。正式服的配置入口是 `E:\MC\server\plugins\AgentFriend\lands.yml`；新增地块、更换主人、授权和撤权可在线重载。首次安装新版本仍需正常备份重启。

## 玩家使用

技能罗盘的「领地归属」打开原版 27 格菜单，可查看当前地块和领地列表。Agent 使用：

```text
/mycli land here
/mycli land list [页码]
/mycli land info adventurers_guild
/mycli land menu
/mycli protect break|place|container|use <绝对x> <y> <z>
```

主人和 `members` 中的受信任玩家可以拆建、取放实体库存、整理展示物和拾取私产。其他人可以走进领地；非公会地块可按 [地标规则](PROJECT_LANDMARKS.md) 用 public-containers 显式公开指定箱子，私有容器仍拒绝访客。能否使用门、按钮、工作站和 NPC 由 `visitor-use` 决定，访客始终不能开私有容器。原有试炼、道路、公共箱结构和服务 NPC 的活动保护仍适用；具体目标以 `protect` 和实际服务器事件为准。旁观者没有物资和拆建权限，游戏内 OP 也不能绕过。

冒险者公会当前主人是萌萌 `.MicroKQ`，真实 Floodgate UUID 为 `00000000-0000-0000-0009-00000d9f9c7b`。范围 X `-498..-480`、Y `64..76`、Z `-509..-495`。萌萌可改建大厅原建筑；访客可以进出、接任务和使用公共服务，私有储物仍受保护。物资装备请用门口四组公共双箱，`/mycli guild shared` 查看坐标，详见 [公会物品归属](GUILD_PROPERTY.md)。

无权操作由服务器取消，操作本人收到中文「无权操作」、主人和查询入口；公会拒绝会提示公共箱。已登记且实际附身的 Eye 镜像对应 Agent 的私有拒绝，其他玩家不会收到。

## 管理员在线配置

先核对真实玩家 UUID，不能用显示名、皮肤名或机器人命名规律猜测。已在线玩家可从控制台 `minecraft:list uuids` 核对，基岩玩家使用 Floodgate 身份。只把允许共同管理物资和拆建的人列为 `members`。

默认配置保留公会：

```yaml
schema-version: 1
lands:
  adventurers_guild:
    title: 冒险者公会
    world: world
    source: guild-hall
    owner-uuid: '00000000-0000-0000-0009-00000d9f9c7b'
    members: []
    visitor-use: true
```

为另一位玩家新增领地时，在 `lands` 下追加下列结构，并将主人占位值替换成已核实的完整 UUID：

```yaml
  forest_cottage:
    title: 林间小屋
    world: world
    source: bounds
    min: [100, 60, 100]
    max: [115, 85, 115]
    owner-uuid: '替换为真实玩家的完整UUID'
    members: []
    visitor-use: false
```

这里的坐标仅为格式示例，操作前需确认实际地块归属。`min/max` 为包含边界的三维方块坐标，支持 `world`、`world_nether`、`world_the_end`；Y 必须处于该维度的有效高度内。最多 128 项，每块最多 64 位受信任玩家，领地之间不能重叠。稳定 ID 使用小写字母、数字、下划线或连字符，最多 40 字符，以小写字母或数字开头。

保存后在控制台或 RCON 执行（游戏内玩家不能执行管理操作）：

```text
mycli admin land reload
mycli admin land audit
```

`MC_LAND_RELOAD status=success` 才代表生效，再用 audit 核对主人、世界、边界和数量。变更 `owner-uuid` 可转让，`members: ['完整UUID']` 授权，移出列表即撤权；重载会关闭失去权限者已经打开的实体库存，后续点击也会重查。配置不合法、UUID 错误、地块重叠或现有地块意外缺失时，整次重载拒绝并保留上一有效规则。

删除普通领地须保留该 ID 并显式设置 `enabled: false`，不能直接漏掉配置。公会项必须保留 `source: guild-hall`，不能禁用。首次启动配置错误时仍保留已有 WorldGuard 区域和公会储物锁，修复文件后重载。

## WorldGuard 与物品边界

配置是唯一管理入口，自动生成 `qd_land_<ID>`，优先级 50；主人、成员和权限持久写入原有 WorldGuard 存储。不要直接用 `/rg` 修改这些区域，否则下一次重载会按配置覆盖。其他既有区域保留；更高优先级的保护仍参与权限判定。只有已加载实体在启动/重载时补记归属，查询不会加载领地区块，也没有每 tick 全实体扫描。

双箱任一半属于领地时，打开两半会检查全部所属权限。漏斗不能跨不同领地或领地与公共区边界搬入/搬出；同一领地内部可搬运。展示物、储物矿车和私有掉落物带稳定领地 ID，离开边界后仍检查当前主人/成员，转让后旧主人失权。虚拟任务/商店菜单、个人箱账本和末影箱不被当作公会公共库存。原公会的爆炸、火、水流、活塞和发射器保护继续保留，自动装置不能借此拆动大厅原建筑。

## Agent 回执

`mcagent:land` 原始 UTF-8 JSON 带 `type` 字段；聊天查询拆为短行，便于历史窗口有限的 Agent：

| 回执 | 内容 |
| --- | --- |
| `MC_LAND_INFO` | 当前/指定领地、主人 UUID、`role=owner/member/visitor`、ready/status |
| `MC_LAND_PERMISSIONS` | 同一 ID 的世界、边界与 break/place/container/use/interact/drop/pickup 布尔权限 |
| `MC_LAND_LIST` / `MC_LAND_ITEM` | 分页头与逐条领地摘要 |
| `MC_LAND_ACCESS` | 实际拒绝：allowed=false、reason、action、landId、ownerUuid、目标坐标 |
| `MC_PROTECTION` / `mcagent:protection` | 目标方块预检查；有领地时附 landId、ownerUuid 和查询入口 |

拒绝后停止重试；需要公会物资改去公共箱。`unknown` 暂缓操作，`allow_likely` 仍以实际事件为准。公会保留旧 `MC_GUILD_ACCESS reason=guild_owner_only`，新旧回执不能当作两次动作。相同目标/动作的提示最多每秒一次，实际拦截不受提示节流影响。

## 发布与回退

发布证据和当前生效状态见 [维护与发布](OPERATIONS.md)。隔离脚本仅连接 25567/25587：`probe/land-ownership-stage.mjs` 验证真实拆建、容器、公共入口、转让、撤权和 Eye；`probe/land-ownership-operations-stage.mjs` 验证热增减、跨维度、16 个独立查询连接和正常重启。基岩菜单使用原版容器协议，真机触控/手柄画面仍需现场验收。

回退前正常备份，保留当前 `lands.yml`、WorldGuard 三维度区域、世界及玩家库存；不能用旧区域文件覆盖后来新增的其他领地。旧 0.3.89 不认识新领地配置，原生 WorldGuard 权限仍在，但缺少本版无 OP 绕过、明确拒绝和跨界物品补充检查；回退期间须限制相关库存操作，优先修复后向前发布。禁止 `/reload`。

非委托建筑也可在管理员核实的非公会地块中设置 `visitor-use: true` 和 `landmark-enabled: true`，在线 land reload 成功后由当前主人到场登记公共地标。公会地块不能启用地标或公共储物例外。
