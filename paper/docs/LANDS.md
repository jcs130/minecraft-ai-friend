# 玩家领地

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
