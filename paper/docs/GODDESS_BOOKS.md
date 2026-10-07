# 女神附魔书发放与修复

## 2026-10-06 排查结果

正式服的修补书问题有两个来源：

- AgentFriend 0.3.83 的 `mycli admin gift` 只构造裸 `ItemStack`。批准 `minecraft:enchanted_book` 不能生成指定附魔，实际得到空白附魔书。
- 女神后续人工补发脚本把修补写进 `minecraft:enchantments`。这是装备附魔字段；书的可转移附魔应写进 `minecraft:stored_enchantments`。收到物品、闪光或附魔说明都不足以证明铁砧可用。格式依据：[Mojang 1.20.5 组件说明](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-20-5)。

10-06 00:31–00:32 的正式服日志记有 AdeleFelice 报告“修补附魔书不能附魔”“铁砧也不行”。其补发脚本确实使用错误字段；女神关于试炼剑刻印保护的猜测没有证据。试炼塔 `DungeonLoot` 使用 `EnchantmentStorageMeta.addStoredEnchant`，该发书路径正确。

此次只筛查玩家存档的附魔书，没有导出其他背包物品。82 份存档中有 3 本附魔书，发现 1 本有装备附魔且没有存储附魔：feiyu_bot，NBT 槽位 12，修补 I，数量 1。正式服在线查询再次确认后，已用原版 `item modify` 就地迁移，保持数量和其他数据。AdeleFelice 的当前存档背包和末影箱没有附魔书；未盲目重复补发。

## 现在怎么发

正式 **0.3.84 已上线**，书/药水统一用服务器目录工厂和持久回执，详见 [礼物校验](GODDESS_GIFTS.md)。下列修补书动作已接入新入口；原版 `give` 语法只说明正确组件格式，正式插件会阻止女神和控制台直接这样发书或药水。

修补书使用有目标校验、固定物品、冷却和审计的运维动作：

```powershell
node E:\MC\ops\goddess-act.mjs mendingbook <玩家>
node E:\MC\ops\goddess-act.mjs mendingbook <玩家> --commit
```

默认只预览；提交一次发 1 本修补 I，并验证真实库存与回执。其他附魔书选择目录预设，不能临时拼发放命令。正确组件格式如下，仅供历史排查与物品修复参考：

```text
minecraft:give <玩家> minecraft:enchanted_book[stored_enchantments={levels:{"minecraft:mending":1}}] 1
```

私聊及 JSON 造物通道现在可以选择 `mending_book/protection_book` 等目录预设，药水也选择真实类型预设；目录可热更新。裸附魔书/药水、未知字段、非法等级和不支持的状态物品会被拒绝。超时查原请求 ID，不盲目重复补发；只有 `phase:verified` 且目标、物品、数量吻合才说到账。

目标查询用 `minecraft:list uuids` 提取真实账号名，因此公会等级与 Agent 铭牌不再导致“目标不在线”的误判。装备自身仍使用 `enchantments`。

## 最初在线修复记录（0.3.83）与回退

- `node --test ops/goddess-creation.test.mjs ops/goddess-books.test.mjs`：6 项通过，覆盖空白书拒绝、发书预览和带铭牌目标解析。
- `ops/goddess-books-stage.mjs` 只连接本机隔离服 25567。真实 Mineflayer 1.20.6 客户端验证：错误字段无铁砧产出；迁移后制成修补钻石剑，经验 30→27，书消耗 1；原书名称、`custom_data`、铁砧惩罚及数量保留；再次迁移不生效。
- 测试准备时修正了空 RCON 响应、未加载区块、初始菜单物品和命令槽位映射；失败回执保留，最终通过后正常停止隔离服。
- 玩家 NBT 的槽位 12 对应命令槽位 `inventory.3`，不是 `inventory.12`；NBT 0–8 对应 `hotbar.0–8`。修复命令有同一服务端 tick 内的物品类型、两个附魔组件及数量条件，且使用完整 `minecraft:item` 名称，避免 Essentials 覆盖。
- 正式服已原子替换女神桥及运维脚本，并更正其知识；通过既有控制接口停止旧桥、Watchdog 恢复唯一女神连接，任务结果 0，新桥 PID 16272，Goddess 原版游戏模式 3。运行解析器拒绝空白书、实际带铭牌账号检测通过。Minecraft/AgentFriend 没有重启或替换 JAR。真实 Java/基岩手柄和远程 Eye 没有在本轮现场操作铁砧，客户端显示体验仍需现场反馈。
- E/F 备份：`E:\MC\ops\repairs\goddess-books-20261006`、`F:\MC-backups\repairs\goddess-books-20261006`。保留原运行脚本、相关女神知识、隔离服回执以及实际修复前后的单本物品记录；这些运行证据不入 Git。

脚本回退可恢复 `runtime-before` 中的三个文件并通过已有生命周期控制重连女神桥；不应恢复错误附魔书的知识规则。物品回退必须先核对原玩家当前槽位和物品，不能覆盖后续已完成的铁砧结果或其他物品；禁止重新运行历史补发脚本造成重复发放。
