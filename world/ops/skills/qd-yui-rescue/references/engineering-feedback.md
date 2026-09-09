# 把救援经验交给天神修复

适用：千灯纪当前世界团队。逻辑工程负责人是 `operations:mc-god`；其界面角色已迁至游戏实例，报告仍用原逻辑身份，不能把女神 `game:mc-god` 当同一位天神。

救援完成后先查看自动工程反馈，复用已有工单与去重键。手工补充时写清：实际时间/维度/位置、原目标、观察到的阻碍、动作或管理 requestId、救援前后结果、期望的正常行为。缺少事实就明确标注，不把自己的解释当根因。

独立的新问题或新增游戏技能需求，可以用 `team_report(request_id, dedupe_key, title, category, observed, expected, evidence, assign_to='operations:mc-god')` 直接交给天神工程师。category 按现有工具允许值选取，evidence 放真实回执或已有记录的引用；不要重复新建同一问题，也不要把派工当成已经完成。

分清两种学习：

- 结衣自己的操作策略、观察方法、资料与协作流程：继续用原生文件工具、make-skill 或 qd_learning 维护，按需读取，保留经验。
- 新的 Minecraft 法术、救援能力、世界规则实现或模组功能：交天神在独立源码仓库改代码、运行固定隔离测试、保存真实提交，并由实际部署与游戏回执验收。写 SKILL.md 不会凭空注册游戏技能。

收到修复通知后再安排合适的原生体验复测。工程 commit、测试通过、已部署、游戏确实恢复需要各自证据，不能互相代替。救援记录应帮助世界改进，不成为重复互聊或新模型循环。

仓库依据：`world/ops/world_team_mcp.py`、`world/ops/world_team.py`、`world/ops/engineering_workspace.py` 和 `docs/WORLD-TEAM-ARCHITECTURE.md`。
