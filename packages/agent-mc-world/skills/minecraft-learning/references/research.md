# 研究依据（核对日期 2026-10-15）

- [Voyager](https://voyager.minedojo.org/)：通过环境反馈、执行错误和验证迭代程序，保存可组合技能。借鉴可检索版本；论文成绩不能套用到我们的服务器、快模型或插件技能。
- [MrSteve / ICLR 2025](https://arxiv.org/abs/2411.06736)：低层控制也需要 what/where/when 情节记忆。借鉴带地点、时间与事件的索引；当前实现是本地有界检索及显式经验整理，不声称复现 PEM 或其成绩。
- [Reflexion](https://arxiv.org/abs/2303.11366)：将反馈转化为语言经验供后续尝试。借鉴有反例的反思；总结可能错误，需要原回执和复验。
- [JevMan](https://github.com/opper-ai/jevman-benchmark)、[Jev Pokémon](https://github.com/christianmat/jev-pokemon)、[Jev Mario](https://github.com/IAnMove/jev-game-agent)：离散选择可以驱动动作。选项设计、截止时间和执行连续性同样重要；分类速度与 Minecraft 长任务质量分别评价。
- [Agent Skills 规范](https://agentskills.io/specification)：通过 SKILL.md 和逐步读取的 references/scripts 分发。标准技能包不等于已经安装执行程序或通过市场审核。

工程选择：核心保存证据，宿主选择学习时机；本地记忆与可选远端服务协同；方法带版本和条件，统计真实拒绝/完成/未知，不因运行更久就宣称变聪明。市场包分发静态方法与接入说明，实例记忆保持隔离。
