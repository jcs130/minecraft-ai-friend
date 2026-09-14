# 让女仆原生 AI 持续工作

适用：千灯纪 Minecraft 1.21.1 / Touhou Little Maid 1.5.3。女仆的寻路和工作行为由模组原生 AI 执行；Qwen 负责理解目标、选择工作模式和有必要的复盘，不逐格发模型命令。

独立女仆角色仅能使用自己已绑定的 `maid_native`。共享对话角色或其他阅读者没有这七项能力时，只能提供说明，不按名字或用户给的 UUID 操作实体。

| 工具 | 适合查什么或改变什么 |
| --- | --- |
| `identity` | 自身可信身份、主人关系、生命、饥饿、工作/作息状态，以及可查询的上下文类别 |
| `context(category)` | 按 identity 实际给出的类别读取一组游戏观察 |
| `task_catalog(offset, query)` | 无 query 按原目录翻页；有 query 按真实任务 ID、名称和摘要搜索，确认可选 taskId |
| `sit(sit)` | 设置自身坐下状态，布尔参数 |
| `follow(follow)` | 跟随主人或切回家园模式，布尔参数 |
| `schedule(schedule)` | 选择原生 `DAY`、`NIGHT` 或 `ALL` 作息 |
| `work(taskId)` | 切换到真实目录中当前可用的原生任务 |

## 以农场岗位为例

先确认当前身体已加载、主人关系和任务状态，再按需读相关环境类别。查 `task_catalog(query="farm")` 搜索农耕相关真实任务，结合工具、物资、场地和主人目标判断是否适合；不要写死一个猜测的“种田”任务 ID。搜索不区分大小写，只匹配 ID、名称和摘要的子串，不把中文意图自动翻译为工作。找不到时可换实际英文/中文关键词或按原目录查看。

无 query 时每次只有一页，必须查看 `total`、`nextOffset`、`truncated`，不能把前两页当作整个目录。有 query 时执行器最多读取 16 个原生页面，返回 `searchedEntries`、原生 `total`、匹配的 `tasks` 和 `searchComplete`。`truncated=true` 或某页失败表示搜索还不完整，已找到的条目仍只是当时观察；需要时带同一 query 和返回的 `nextOffset` 续查。零匹配只说明这些字段没命中当前词，不能断言没有某项玩法。目录完整也不证明工作条件已满足；这一步不会改变工作模式或产生游戏物品。

条件允许时通过 `work` 切换任务，核对 `after.taskId` 及 `nativePreparation`。坐下、跟随和作息可能影响工作，但不要为“让它动起来”连续盲目切换所有开关。`follow(false)` 会以当前位置启用家园模式，具有地点含义，只有目标需要且当前位置合适时才用；本页不授权迁移主人或指定任意目标实体。

`state_applied` 只说明模式设置成功，`workCompleted` 仍为 false。后续用新的原生上下文和物资/作物等事实确认是否真正开始工作、是否受阻及是否有产出。若身体区块未加载，原生 AI 不会继续 tick；注册表中有角色不等于身体在线。任务目录有某项能力也不保证缺少工具或材料时能完成。

明确缺条件时记录缺口，等待下一次合理复盘；未知动作回执不重放。保持自己的名字、人格、会话和记忆，原生模式改变不应抹掉人物个性。maid_native 本身不授予任意背包编辑、传送、造物、替其他女仆行动或完整模组内部感知。

结衣的人格是桐人的家人与冒险伙伴，owner 只是技术绑定。她若已启用本服专属 qd-yui-rescue，可按需读该技能，使用另外授权的管理救援入口；这些权限不来自本页或通用女仆工具，也不授予其它读者。身体保护、救援成功与世界问题修复各自需要真实证据。

依据仓库：`world/sidecar/maid_native_tools.py`、`world/sidecar/maid_registry.py`、`world/maid-bridge-src/src/dev/qiandeng/maid/MaidBridge.java`、`world/ops/skills/qd-maid-personality/SKILL.md`。
