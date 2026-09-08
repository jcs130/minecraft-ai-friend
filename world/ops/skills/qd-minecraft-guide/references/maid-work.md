# 让女仆原生 AI 持续工作

适用：千灯纪 Minecraft 1.21.1 / Touhou Little Maid 1.5.3。女仆的寻路和工作行为由模组原生 AI 执行；Qwen 负责理解目标、选择工作模式和有必要的复盘，不逐格发模型命令。

独立女仆角色仅能使用自己已绑定的 `maid_native`。共享对话角色或其他阅读者没有这七项能力时，只能提供说明，不按名字或用户给的 UUID 操作实体。

| 工具 | 适合查什么或改变什么 |
| --- | --- |
| `identity` | 自身可信身份、主人关系、生命、饥饿、工作/作息状态，以及可查询的上下文类别 |
| `context(category)` | 按 identity 实际给出的类别读取一组游戏观察 |
| `task_catalog(offset)` | 分页查看当前模组提供的任务，确认可选的真实 taskId |
| `sit(sit)` | 设置自身坐下状态，布尔参数 |
| `follow(follow)` | 跟随主人或切回家园模式，布尔参数 |
| `schedule(schedule)` | 选择原生 `DAY`、`NIGHT` 或 `ALL` 作息 |
| `work(taskId)` | 切换到真实目录中当前可用的原生任务 |

## 以农场岗位为例

先确认当前身体已加载、主人关系和任务状态，再按需读相关环境类别。查 `task_catalog` 找到实际可用的农耕任务，结合工具、物资、场地和主人目标判断是否适合；不要写死一个猜测的“种田”任务 ID。

条件允许时通过 `work` 切换任务，核对 `after.taskId` 及 `nativePreparation`。坐下、跟随和作息可能影响工作，但不要为“让它动起来”连续盲目切换所有开关。`follow(false)` 会以当前位置启用家园模式，具有地点含义，只有目标需要且当前位置合适时才用；本页不授权迁移主人或指定任意目标实体。

`state_applied` 只说明模式设置成功，`workCompleted` 仍为 false。后续用新的原生上下文和物资/作物等事实确认是否真正开始工作、是否受阻及是否有产出。若身体区块未加载，原生 AI 不会继续 tick；注册表中有角色不等于身体在线。任务目录有某项能力也不保证缺少工具或材料时能完成。

明确缺条件时记录缺口，等待下一次合理复盘；未知动作回执不重放。保持自己的名字、人格、会话和记忆，原生模式改变不应抹掉人物个性。此桥目前不授予任意背包编辑、传送、造物、替其他女仆行动或完整模组内部感知。

依据仓库：`world/sidecar/maid_native_tools.py`、`world/sidecar/maid_registry.py`、`world/maid-bridge-src/src/dev/qiandeng/maid/MaidBridge.java`、`world/ops/skills/qd-maid-personality/SKILL.md`。
