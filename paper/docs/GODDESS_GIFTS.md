# 女神礼物的生成、核验与回执

## 状态

2026-10-06 13:34 正式服已继续更新为 **0.3.85**，完整继承本页的礼物目录、库存核验与持久去重；当前 12 项目录 ready=true。本轮只更新村庄警报和支援传送插件，女神发放桥与 MCP 脚本保持，未再次发物品或重绑工具。新 JAR、双盘快照及验证见 [维护与发布](OPERATIONS.md)。下文 09:09 的 0.3.84 记录保留为此能力首次发布证据。

2026-10-06 **正式发布 AgentFriend 0.3.84**，SHA256 为 `984AE0773B3EB9345DB024FFB2F66769B686B9929EE27B06D864EB936668D69F`。服主明确确认 `feiyu_bot` 是 bot 并授权重启后，将此精确账号加入运维已核实服务账号例外；其他未登记名字的保护仍保留，不按名字含 bot 泛化授权。

2026-10-06 接入复核：仅确认机器人身份不等于确认其来源 IP。新增 feiyu_bot 配对时发现私有访问清单缺少该账号的可信来源，已撤销本轮新增配对并恢复发布前清单，避免网关把其原有重连拦截；已核实的维护服务账号例外保留。后续建立 Agent/Eye 配对须同时登记各自可信来源。

无活动副本、只有已核实服务账号时，既有 `Afu-MC-DailyBackup` 于 09:09 正常停服备份，在 E/F 两盘生成 `20261006-090906/.complete`，校验哈希并启用唯一 0.3.84，任务结果 0。新 Java PID 34740；配套七文件原子替换并校验哈希，女神桥通过控制接口/Watchdog 重连为唯一 PID 29836，原版模式 3。版本、12 项目录 `ready:true`、修补/力量真实属性、只读预览及原请求查询均已正式读回。

MCP 工具白名单更新后，旧 stdio 连接仍只返回五工具；仅对 `afu-goddess-server` 原生停用/启用完成重连，随后实际发现八工具。初始化第一次查询短暂 502，后续读回全部启用。访问策略逐字段保持原值：默认 deny，游戏桥身份只允许 `server_status`，发物品工具没有向游戏请求开放。

正式临时非 OP 客户端通过 `/mycli goddess pray` 请求“只解释校验，不发物品”，实收女神最终私聊答复，账本未变，随后退出。初始探针把加入/外发文本误当最终回复，已否定其结论；最后的 `prayer-smoke-GoddessGiftAudit.json` 严格匹配女神入站私聊并排除等待提示，才记录通过。真实授予物品/铁砧/饮用仍取下述隔离测试，不给正式玩家随意加物品。

Java、Agent LAN 网关、本机及 LAN Geyser Pong 均通过；AuraSkills `startup-verified` 的 transform/behavior 成功，MSPT 最近一分钟平均/最大 7.1/33.5 ms（两个常驻账号窗口，不能代替 16 个 LLM 长期负载）。CortiLan/Goddess/CortiEye 已恢复，`cortieye` 读回 camera=online、attached=true；feiyu_bot 原客户端也已回连，重启前四个账号均恢复。运行证据及原件在 E/F `repairs/goddess-gift-safety-20261006`。

此前错误附魔书的排查和已实施修复见 [女神附魔书](GODDESS_BOOKS.md)。本次新增的是日后发放的校验机制。

## 发放流程

1. 女神桥读取服务器验证过的礼物目录。模型只选择目录 ID 或少量普通材料，输出严格 JSON；不写 NBT、命令或脚本。
2. 服务器检查精确玩家账号、数量、当前配方哈希和背包空间。附魔书、药水等带属性物品不能使用裸物品 ID 发放。
3. Bukkit 工厂生成物品：书用 `EnchantmentStorageMeta` 的存储附魔；药水用 `PotionMeta` 的基础药水类型。检查合法等级、冲突和物品适用性，完成原生序列化后再次核对属性。
4. 先写入并同步 `prepared` 回执，再一次性填入背包；比较完整计划与实际库存，并核对增加数量。背包放不下时不部分发放、不丢在地上。
5. 保存玩家数据和 `verified` 回执以后，由服务器发出礼物名称、数量和到账提示。桥再读取同一回执，不能以模型自述或聊天中的假回执宣布成功。
6. 请求 ID 持久化去重。同 ID、同内容的已确认请求只返回旧回执；同 ID 换内容拒绝。超时只查询原回执，不重发；`prepared`、损坏账本或结果不确定时停止发放并人工核对。

桥保留模型选择时的配方哈希；思考期间目录改变，发放会拒绝，避免同一 ID 的属性悄悄改变。不认识的物品属性必须拒绝，不能静默丢弃字段或拿相近物品替代。

## 可热更新的目录

运行文件为 `E:\MC\server\plugins\AgentFriend\goddess-gifts.yml`，初始模板在 `plugins/AgentFriend/resources/goddess-gifts.yml`。12 项预设包括修补、保护、耐久、锋利、效率、时运、精准采集书，以及力量、延长力量、治疗、抗火药水和水瓶。

```yaml
schema-version: 1
gifts:
  mending_book:
    title: 修补 I 附魔书
    item: minecraft:enchanted_book
    max-amount: 4
    enchantments: {minecraft:mending: 1}
  strength_potion:
    title: 力量药水
    item: minecraft:potion
    max-amount: 4
    potion: minecraft:strength
```

只允许 `title/item/max-amount/enchantments/potion`。附魔、药水使用完整原版命名空间；数量上限 1–16；管理方块、刷怪蛋、空书、未知药水、非法等级和冲突附魔会被拒绝。可配置合法附魔装备及普通物品；成书、地图、烟花、玩家头等其他带状态物品暂不支持，不能用裸 ID 伪装支持。

编辑 UTF-8 文件后执行：

```text
mycli admin giftcatalog reload
```

无需重启。每次发放也检查文件修改时间。无效目录返回 `ready:false` 并阻止发放，不继续使用旧目录假装更新成功；先恢复正确文件再 reload。

## 管理接口

仅限固定 UUID、精确名且 OP 的 Goddess、控制台及 RCON。普通玩家不能调用。

```text
mycli admin giftcatalog
mycli admin gift <16位小写十六进制请求ID> <精确玩家名> gift:mending_book 1 <目录中的64位哈希>
mycli admin gift <请求ID> <精确玩家名> minecraft:stone 4
mycli admin giftstatus <请求ID>
```

目录输出 `MC_GIFT_CATALOG` JSON；发放及查询输出 `MC_GIFT_RESULT` JSON。原 `QDJ-GIFT` 文本仅保留兼容，不能替代属性回执。实际发放以 `phase:verified`、目标、选项、物品、数量及 `after-before` 均吻合为成功。

推荐主机入口（默认预览）：

```powershell
node E:\MC\ops\goddess-delivery.mjs catalog
node E:\MC\ops\goddess-delivery.mjs --player <玩家> --gift mending_book --amount 1 --request <请求ID>
# 同一预览经批准后，加 --commit 执行。超时保留同一请求ID，先查回执。
node E:\MC\ops\goddess-act.mjs mendingbook <玩家>
```

女神 MCP 的 `gift_catalogue/deliver_gift/gift_receipt` 已重新发现并启用，仅原有维护身份可写；游戏身份仍没有发物品 MCP 权限。游戏私聊与造物申请由桥调用同一验证入口。现有固定运维礼包等其他 `goddess-act` 动作仍是原有固定字面量通道，不属于本次统一回执迁移。

## 验证与边界

- `node --test ops/goddess-creation.test.mjs ops/goddess-books.test.mjs ops/goddess-delivery.test.mjs`：11 项通过。覆盖元数据不能被静默丢弃、严格目标/数量、回执内容、失败不重试、超时只查原回执和配方变化拒绝。
- `ops/goddess-gift-safety-stage.mjs before/after` 只连接 127.0.0.1:25567/25587 隔离服。最终 JAR 下实测新书通过铁砧制成修补剑、消耗书和经验；力量药水喝下后原版 `active_effects` 出现力量；错误等级/未知药水/未知字段/冲突附魔全被拦截；满背包和容量不足没有部分发放；重复请求与换数量拒绝。
- 正常停止并重启同一隔离服后，已消耗的书不会因重复旧请求补回来；模拟未完成的 `prepared` 回执也阻止重发。测试后正常停止隔离服。回执在 `E:\MC\ops\repairs\goddess-gift-safety-20261006`，不进 Git。
- 此次发现 minecraft-data 3.112.0 在协议 766 的药水组件中误加入 `customName`，导致 Mineflayer 无法解码有效药水。`ops/minecraft-1206-potion.mjs` 在进程首次编译协议前校验字段形状，仅移除多余字段，不改依赖文件。女神桥和测试客户端使用此修正；其他主机 Agent 须在各自进程接入后才能声称已修正。字段是在 [Mojang 1.21.2](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-2) 新增的。
- 物品与菜单沿用原版协议，Geyser 可转换；本轮实际操作来自 Mineflayer。普通 Java、基岩真机和 Eye 现场铁砧/饮用画面没有操作验证，不能用服务端回执代替目视验收。
- 校验确保选定物品的属性、目标、数量及发放结果；不能保证模型理解任何含糊自然语言。含糊愿望先询问，目录未涵盖的属性拒绝。Goddess 的常见 `give/i/item/enchant` 指令会被拦截；控制台直接给书/药水也拦截，但这不是隔离所有 OP 或主机文件权限的沙箱。管理员原版 `item modify` 修复路径仍保留。

## 发布、备份与回退

首次启用须按 [维护与发布](OPERATIONS.md) 检查在线身份和活动副本，完成 E/F 停服快照后只启用最终 0.3.84 JAR；随后协调替换 `goddess-bridge/creation/delivery/act/mcp/rcon-client/minecraft-1206-potion` 脚本，通过既有控制接口与 Watchdog 恢复唯一女神桥。同步 PROFILE/MEMORY，核对目录 `ready:true` 和版本哈希。不要先用新桥连接旧插件。

`goddess-gifts.jsonl` 账本随运行数据备份。只回退 JAR/脚本时保留当前账本、目录、世界和玩家进度；禁止删账本、把 `prepared` 改为 `verified` 或换请求 ID 补发。0.3.83 不认识新目录，应恢复已修复的旧桥和固定修补书动作，并继续阻止裸附魔书；不能恢复历史错误书知识或重放旧补发脚本。
