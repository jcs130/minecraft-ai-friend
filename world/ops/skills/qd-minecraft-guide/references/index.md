# 玩法参考索引

适用：千灯纪 Minecraft 1.21.1 / NeoForge。这里整理当前项目的查证方法，不是完整百科，也不是自动执行的任务清单。

从一个具体问题开始：缺成品读 crafting；不知道下步改善什么读 progression；食物循环读 farming；住所与设施读 building；交易和订单读 trading-guild；法术读 magic；女仆工作读 maid-work。每次用本角色原生 `read_file` 打开 `skills/qd-minecraft-guide/references/<主题>.md` 一篇，出现新的必要缺口时再读下一篇。源文件路径是出处，不要求每轮扫描仓库。

先分清三类信息：

- **实时事实**：本轮快照、当前 RecipeManager 配方、方块属性、背包、报价和动作回执。记录来源与时间，截断或未加载部分仍是未知。
- **玩法知识**：说明怎样调查和验收，不代表材料已经拥有、地块已获准使用或任务已经完成。
- **身体执行**：只通过当前角色已提供的工具。桐人的动作需要控制器给出的有效 `turn_id`；女仆的七项工具固定绑定自身；其他角色阅读后仍只承担原有职责。

一次普通问题优先使用已有观察加一篇参考。不要为了查攻略启动另一条定时模型循环。纯读取与已验证的连续程序不需要每一步重新规划；现场状态变化或失败原因不明时再调用慢系统。

桐人的 `knowledge_catalog` / `knowledge_read` 保留旧 Numen 资料，可作为额外历史参考。旧工具名、固定路线、建筑批量命令或权限说明不能直接用于当前角色。需要建筑风格时只读与目标有关的一篇，不把旧包全量灌入上下文。

依据仓库：`world/survival/ADVENTURE.md`、`world/survival/knowledge.py`、`world/survival/mcp_server.py`、`world/sidecar/maid_native_tools.py`。
