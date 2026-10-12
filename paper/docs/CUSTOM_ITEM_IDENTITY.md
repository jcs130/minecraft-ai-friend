# 特色道具名称与 Agent 识别

2026-10-12：特色道具身份说明已随 AgentFriend **0.4.27 正式部署**；见[联合发布与回退](COMPLETED_FEATURES_RELEASE_20261012.md)。下方候选说明为原测试时点。

## 状态与实际原因

2026-10-12：AgentFriend **0.4.25 候选，未部署**，包含此前 0.4.24 商旅公会交易板。正式仍为 0.4.23；本轮只读正式背包，没有改玩家物品、第三方插件或远端 Agent，也没有排队重启。

正式只读观察：`ag_CorMy` 随身槽位 33 的 `minecraft:player_head` 带有 `minecraft:custom_name="§e大背包"`。它是 Minepacks 大背包快捷道具，使用原版头颅材质和专属纹理。缺少 `item_name` 不表示名称失效：1.20.5+ 标准物品组件使用 `custom_name` 覆盖显示名，参见 [Mojang 1.20.5 说明](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-20-5)。

实测 Mineflayer 4.37.1 和 4.39.0 均收到名称与纹理；其依赖的 `prismarine-item` 仍用本地注册表填写 `item.name` 和 `item.displayName`，实际自定义名称在 `item.customName` / `components.custom_name`，参见 [官方实现](https://github.com/PrismarineJS/prismarine-item/blob/master/index.js) 和 [customName API](https://github.com/PrismarineJS/prismarine-item#itemcustomname)。只读取基础材质字段的工具会报出 Player Head。没有拿到可米远端工具的原始输出，不能断言她具体用了哪个字段。

## 服务端提供的统一说明

- 保留正确的原版材质、`custom_name`、纹理和全部组件，标准 Java / Geyser 基岩客户端继续沿原版物品协议接收。
- 登录后和首次拿到已识别特色道具时，通过普通私有系统聊天说明名称、槽位与用法；同一会话每类只自动说明一次，不添加扫描全服的后台计时器。
- `/mycli inventory` / `inventory refresh` 返回服务器本人的 36 格随身背包；每条 `MC_INVENTORY` 是完整 JSON 分页，须收齐 `pages`，最多 8 条物品且按序列化长度分包，避免 Mineflayer 4096 字符截断。旧 `schemaVersion=1`、`id`、`amount`、`slot`、`windowSlot` 保留。
- `/mycli inventory item <0–35|hand>` 私发单件中文说明和 `MC_ITEM`；`hand` 查询当前主手对应的快捷栏槽。查询只读，空槽给出重新查槽位的做法。
- 识别已覆盖真实大背包、技能罗盘、命格书、技艺研习书及灵纹法杖。其他物品优先读实际 `custom_name` / `item_name`，保留物品说明，不根据一个名字凭空授予特色道具身份。

| 字段 | 含义 |
| --- | --- |
| `id` / `baseId` | 原版协议材质，例如 `minecraft:player_head`；用于槽位操作和渲染 |
| `name` / `customName` | 展示名称 / 实际名称组件的纯文字；用户和 Agent 应按名称理解物品 |
| `kind` | `server_item`、`named_item`、`vanilla` |
| `customId` | 经真实纹理/原标记验证的服务器道具种类；普通或同名仿制物品不含此字段 |
| `usage` | 对应道具的真实用途、正确入口及原消耗规则 |
| `lore` | 单件查询的原物品说明，最多六行，每行有界 |

大背包示例：

```json
{"id":"minecraft:player_head","baseId":"minecraft:player_head","name":"大背包","kind":"server_item","customId":"minepacks:backpack_shortcut"}
```

大背包实际校验原快捷物品名称和纹理；普通头颅或只在铁砧改成「大背包」的物品不会被当作 Minepacks。服务端说明不是道具权限入口，沿用原有插件对使用、交易和所有权的判定。

机器人无须安装新的识别补丁即可接收这些中文私有消息和 `/mycli` 回执。若某工具固定把 `item.name` 当展示名并忽略原版组件及服务器消息，仍需工具侧改为读取 `customName` 或 `MC_ITEM.name`；服务器不能重写远端程序的本地字段，也不能把 `player_head` 换成未知的注册表 ID 后期望原版客户端识别。

## 验收与发布

`paper/plugins/AgentFriend/item-identity-stage.mjs` 只允许回环 staging 副本，创建及修改专用 QA 库存。验证原生名称/纹理、五类真实道具、同名仿制头颅、任意改名及 `item_name`、36 格长名称分页、只读前后完整物品数据一致、私有范围、说明去重和原54格 Minepacks 打开；基岩协议另验中文系统消息、相同身份回执与 Geyser 原生名称组件。

```powershell
$env:MC_STAGE_PAPER='<绑定127.0.0.1的staging目录>'
$env:MC_TEST_OPS='<已有兼容与RCON模块目录>'
$env:MC_TEST_REPORT_DIR='<新建私有回执目录>'
$env:MC_TEST_REQUIRE_FROM='<Mineflayer依赖的package.json>'
$env:MC_TEST_BEDROCK_REQUIRE_FROM='<bedrock-protocol依赖的package.json>'
node paper/plugins/AgentFriend/item-identity-stage.mjs java 1
node paper/plugins/AgentFriend/item-identity-stage.mjs bedrock 1
```

最终同一 JAR SHA256：`8647929232de76a634c0987f34df95f64964fcaf53b32fa9844e51e8d6ddc66d`。

| 回执 | 结果 | 范围 |
| --- | --- | --- |
| `item-identity-java-final.json` | 24 项通过 | Mineflayer 4.39.0 / prismarine-item 1.18.0，含附身 Eye 私有物品说明；只使用原有配方兼容模块，没有安装改名补丁 |
| `item-identity-bedrock-2.json` | 6 项通过 | 基岩协议1.26.51实际连隔离Geyser，含中文普通消息、完整JSON及原生名称 |
| `item-identity-java-440.json` | 23 项复验通过 | 正常停服重启、可选别名配置缺失后从JAR读取默认资源，新Java连接及真实Minepacks正常；同摘要默认别名随后正确释放 |
| `trade-live-tail.json` / `trade-bedrock-merged.json` | 20 / 8 项复验通过 | 合并版本的交易板、私有Eye报价/定位、真实原版成交、门牌/掌柜及基岩菜单 |

早一轮 Mineflayer4.37.1 的23项通过回执亦保留；复验项目包含重复检查，不合计为互不重复的案例数。详情与边界见[候选清单](../manifests/custom-item-identity-candidate-20261012.json)及私有 E/F `repairs/custom-item-identity-20261012`。基岩协议通过不等于手机/Xbox 真机排版或远端 Web 部署完成。早期启动时机与测试漏收 `inventory_slot` 的失败回执保留，不计为通过。

上线需要服主明确批准本次 Paper 重启，按原预告、真人/活动副本检查、E/F 完整停服备份和固定哈希发布；之后同步女神现役资料箱。回退正常停服换回 0.4.23 JAR；本功能不迁移背包、奖励箱、任务袋或任何玩家物品数据。
