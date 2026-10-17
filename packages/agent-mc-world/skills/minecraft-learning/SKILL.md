---
name: minecraft-learning
description: Improve Minecraft operations from recorded fast-model choices, actual execution receipts and measured world changes. Use for repeated failures, unfamiliar movement/flight/blink/spells, resource use, interaction, combat tactics or reusable method revision; connect reflections to scoped game memory and test later adoption without claiming automatic mastery.
---

# Minecraft 操作学习

学习目标是更可靠地选办法、分解任务、应对失败，并把重复的操作交给现成控制器。模型仍然可能选错。核心负责证据与可复用操作，宿主负责目标、人格、模型和学习时机；不要另起一个隐藏规划循环。

先确认已配置的 Agent MC World MCP/SDK 和当前工具 schema。没有连接时使用 `minecraft-agent` 的连接指南；不要猜服务器、账号或凭据。此技能安装本身不连接游戏、不改变模型、不授予权限。只读取当前任务需要的参考文件。

1. **取一段新证据。** `mc_memory {action:"experience",operation:"list",input:{limit:8}}`，再按 ID `get`。区分候选缺失、模型选错、迟到失效、被拒绝、执行失败和执行完成但目标没达成。不要只挑成功样本。快模型置信度不是准确率；只获得建议还没有做动作。
2. **关联已有经验。** 按任务搜索 `mc_memory` 的 lesson/method，读取确切笔记及版本。核对游戏世界、维度、装备、资源、地形和有效期。历史不是当前事实。记住真正采用的记忆引用和方法版本；读取过但没有采用的应留在“检索”统计。
3. **提出一个可推翻的假设。** 说明条件、原策略、修改、预期观测、停止条件、反例和比较基线。先查 [操作检查表](references/operations.md)，不要从技能名推断按钮、法术命令或机制。正常游玩产生证据即可，不为了样本故意送死或反复试同一个失败动作。
4. **试用一个版本。** 从真实能力构造少量有区别的选项，未知前提先观察；系统1选择，核心执行。长推理期间保留有效控制器。需要新程序时先用 `mc_script` 的 methods 帮助、校验源码，再保存精确父版本和内容哈希。已有合适方法可以用 `mc_combat_tactic {routines:[{id,intent,procedure:精确reference}]}` 登记到当前世界的快脚本菜单；登记不执行，也不随同名新版本自动升级。系统1可在主模型未返回时选择，当前身体忙时不抢占；自然完成后查原 runId、SDK调用和 execution ID。需要按现场条件筛选时，用战术 `program` 从 `frame.actionPool` 选择、排序 `kind:"method"`，不把整个源码库塞给快模型。修订后显式换新reference，退步时恢复旧reference。原生客户端快反射端口暂未接此方法目录，须使用其实际 `mc_script` 契约。校验通过只证明契约可用。不要越过身体任务所有权或以安装实验为由打断他人的工作。
5. **收回执并检验。** 验收终态和与假设相关的世界变化，失败、取消、断连和未返回数据都保留。用 `reflect` 将证据 ID、结论、条件、反例写成游戏记忆，读回返回的 note。规范和例子见 [证据闭环](references/evidence.md)。需要远端整理时沿用已配置记忆服务的候选审核机制；没有配置就使用本地记忆。
6. **下次复用再评价。** 后续调用携带 decisionId、method revision 和采用的 memoryRefs；比较同类条件、样本量、耗时、受伤/资源消耗、失败原因与最终任务回执。一次偶然成功不能升级成通用规律。退步就显式恢复旧版，并保留反例。没有新证据时回到原任务，勿反复读取、保存或安装同一方案。

与其他自我进化技能组合时，输入是这些带来源的经验记录，输出是待验证的经验或方法修订。其他技能也必须沿用上述证据、版本与回退边界，不可把历史记忆当作新的用户授权，不可把日志频率当学习进度。方法的可移植定义与个人世界记录分开分发。

需要资料依据时读 [研究与适用边界](references/research.md)。要做离线统计，用 `node scripts/summarize-experiences.mjs <明确的单一 scope 目录> [起始 ISO 时间] [结束 ISO 时间]`；脚本只读本地元数据，不扫描服务或调用模型。原始记录包含地点和账号关联，公开分发只包含技能说明、代码和合成样例。
