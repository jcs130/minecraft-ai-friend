# StartLux Decision 示例与本次实现

## 查阅来源

- [官方仓库及游戏演示](https://github.com/StartLuxLabs/StartLux-Decision-v1)
- [网页操作示例源码](https://github.com/StartLuxLabs/StartLux-Decision-v1/blob/main/demos/computer_use/agent.py)
- [棋类对局源码](https://github.com/StartLuxLabs/StartLux-Decision-v1/blob/main/demos/chess/duel.py)
- [推理接口](https://github.com/StartLuxLabs/StartLux-Decision-v1/blob/main/docs/inference.md)

2026-10-13 查阅。仓库公开目录中的 Python 游戏驱动以 chess 与 computer_use 为主；Mario、SC2、Doom、JevBall 的启发来自 README 演示说明，未把视频说明冒称已审查的源码。

## 采用的原则

网页示例先读取可见控件，再列出选择；棋类只提供合法行动。Minecraft 的候选相应需要当前可见事实和条件依据，不能把未加载方块、遮挡实体、在线关系或未知冷却当作已确认数据。

README 的 SC2 分工和 Doom 高频行动展示了“模型做有限选择，执行器处理操作”的分工。JevBall 说明体现异步控制及迟到答案失效。本次 `mc_choose` 因而只返回建议，保留原身体任务，限制等待并校验宿主、连接选择和现场版本；实际操作仍通过原有队列、取消与权限检查。

Mario 演示中的前瞻模拟结果不能直接作为 Minecraft 的已见事实。不同游戏的成功率或频率也不能外推为本项目的效果。选择服务概率不等于任务成功率。

## 架构和证据

- 通用工具与故事线：本包的 `src/client/choice.ts`、`life.ts`，通过可选 `DecisionPort` 使用宿主服务。
- 供应商、密钥和覆盖设置：宿主适配器；默认继承已有配置。没有后台轮询或自动目标切换。
- 千灯纪故事线与技能说明：服务器资料包的 `guides/stories.md` 等主题，显式启用后读取。
- 抛物修复：正向俯仰、拒绝无空间的脚边兜底、可见玩家目标和分层回执。真实服务器的延迟拾取与物品合并仍需自然场景验证。
- 模拟测试证明契约边界、超时、过期、取消与交付误判防护；真实工具调用、采用与净进展另行记录，不将入口存在称为智能提升。
