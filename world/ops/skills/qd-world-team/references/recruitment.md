# 按任务需要扩充团队

先查 team_roster 与当前工单；已有角色能够完成的工作交给该负责人。女神、天神、司灯与公会策划可以招募。

短期分析、设计比较、QA清单等可使用实际已启用的 Qwen 原生 `spawn_subagent`。明确 task、`fork=false`、`allowed_tools` 与需要的已安装 skills，例如只用 read_file/write_file/get_current_time，输出到一个独立 notes 文件。子代理不继承游戏身体、管理员MCP、任意shell或再次招募权限；它是临时任务，不是永久人物。

反复需要的职业，使用 `team_recruit(profession_key="quest-reviewer", name="星灯 · 任务体验策划", profession="核对任务可完成性、奖励节奏和探索体验，用可验证的建议协助公会策划。")`。这是调用示例，不要求每次自动创建这个人。

相同 profession_key 重复请求返回同一人。选择表达长期职责的稳定英文键，姓名与职责不能被后续同键请求悄悄改写。工具创建独立原生 Agent、SOUL/PROFILE/AGENTS、基础学习/文件/团队技能；沿用当时游戏策划正在使用的模型路由，未复制密钥、人物身体或生产管理权限。

招聘成功后读 team_roster 确认，再由女神/司灯通过 team_update 分配工单；team_request_help 可通知该专业成员开始处理。没有新工单时不添加无意义的周期模型调用。新角色可保存资料和创建自己的文档技能，代码执行及世界发布仍由对应负责人完成。

技能优先使用已安装官方与开源包，按需读取正文和references。当前选入的 game-production 用于制作取舍、玩法体验与验收设计；是否安装以本角色技能清单为准。市场技能先核对来源、许可证、文件和原生扫描结果，不能把技能建议当作执行授权。
