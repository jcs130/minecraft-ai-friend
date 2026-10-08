# Create 风车自主建造任务

Minecraft 1.21.1 / NeoForge 21.1.248 / Create 6.0.10；普通玩家 MawNeko 经本人 Mineflayer 连接，由 mc-agent-neko 的线上 qwen3.7-plus 决策。不连接 QwenPaw API，没有 OP 或直接生成机械部件。原家庭服和已暂停 MawExplorer 保持各自状态。

本轮从**提供原料**开始，不能称为自然采集的完整生存闭环。管理员提供湖上照明、围栏和地板（x=-403..-391，y=63，z=409..421），原料箱在 (-401,64,411)：安山岩、铁锭、羊毛、原木、石头、圆石、面包、普通工具。没有预制 Create 零件。布局、配方、取料、合成、摆放和启动由模型选择。

## 通用操作

SDK 56 项操作、19 个频道；任何普通玩家均按本人连接/UUID 使用，未特判 MawNeko。Neko 先 `!modList()` / `!modExplain("操作 ID")`，再 `!modCall("操作 ID", "转义的 JSON 字符串")`。操作 ID 不是独立的 !world.place 命令。Project N.E.K.O. 的 minecraft_mod 接受对象参数。

| 操作 | 实际行为 |
| --- | --- |
| native.recipes | 查询服务端真实配方，普通合成过滤 minecraft:crafting，从结果选择 recipeId，不猜前缀。 |
| native.craftRecipe | 将选定原生 shaped/shapeless 配方映射到当前 2×2 或已打开工作台的 3×3 网格，实际点击并合成一次。clearInputs:true 明确归还旧输入，输出核对完整 SNBT。不会自动生成或打开工作台。 |
| native.craft | 手工网格合成一次。2×2 竖列是 1/3，3×3 竖列是 1/4/7；配方 ingredient index 不能直接当菜单槽号。 |
| inventory.equip | 从本人 inventory 菜单 sourceSlot 移整堆到空 hotbarSlot 并持有，expectedId 核对来源，逐次完整 SNBT CAS。 |
| inventory.select | hotbarSlot 为 0–8，expectedId=minecraft:air 选空手，可显式 expectedSnbt；内部始终核对完整组件。 |
| world.lookAt | 转动本人真实视角，读取绝对坐标处首个可见方块，不穿墙查询。 |
| world.place | 真实物品放一格，核对支撑 ID/全部属性、手持完整组件、放置后原生方块及数量减少 1。不自动走路或重试。 |
| world.interact | 原生 useItemOn。可省略 expectedHeldSnbt，由本人新鲜手持快照提供；空手是空字符串，不是空气物品。接受交互仍需验证效果。 |
| world.dig | 可见近处单格，工具/方块完整校验及服务端移除证据；不声称已拾取掉落。 |

inventory 菜单的 1–4 是合成输入，9–35 是背包，36–44 才是快捷栏 0–8；工作台快捷栏在 37–45。!inventory 使用玩家规范槽位，并在已知窗口提供 currentMenuSlot；menu.click 必须使用当前窗口索引。模型摘要保留真实槽位、数量、SNBT、权限和光标，省略仅供画面的注册表/实体几何；网页仍收到完整原生状态。

这些是通用玩家工具，不是风车建造脚本，不绕过权限、材料消耗和原生合成。可读配方不等于任意机器生产链已实现。

## 实际运行判据

最低风帆数、每 RPM 风帆数均取服务端实际配置，本服均为 8。相邻风帆沿其 facing 轴所在平面连接，由原生 bearing 装配；模型仍须检查实际 facing、可达性和空间。

空手右键后，world.lookAt 返回 block.windmill。要求 source=native_visible_block_entity、running=true、sailCount≥minimumSails、generatedSpeed≠0、stalled=false；两次同坐标、同 contraptionUuid、间隔至少 250ms 的 angleDegrees 必须变化。失败保留实际 assemblyError。模型宣称完成、一个已存在的风车或交互 SUCCESS 均不能代替此证据。

WindmillTaskEvidence 只接受本人已完成且结果明确的回执，轴承来自本任务的真实 world.place 消耗与原生方块验证。重启从 command-results.jsonl 自 task.startedAt 恢复证据，不重新执行历史操作。私有运行证据不入 Git。

## 维护

Neko 生物群系使用当前连接实际注册表，缺数据明确 unavailable。记忆摘要等待完成，模型请求单并发、有界排队，未知不重投。自设调用上限与供应商配额不同；调整上限保留累计账本。

本账号私有运行目录可放 task-feedback.txt（≤8192 字节），每次决策读取，任务轮开始记录应用事件；仅供本机操作者澄清任务或工具，不能由游戏聊天改写。任务目标和经真实回执确认的进度固定加入每次决策的系统上下文，避免上游 500 字记忆摘要删掉目标；不是自动建造脚本。停止只用本账号 stop.requested，等待在途推理与原生动作结束、正常断开及自有锁释放。未知操作必须核对，不能删 journal 或重连后重投。

寻路约束在真实 spawn 后安装，覆盖 getPathTo/getPathFromTo/setMovements，防止上游重新创建 destructive movements 后自动挖路或垫方块。早期安装过早造成的地板改动保留在审计中。模型文字和调试输出在 native 模式且 chat_ingame=false 时不再发私聊；上游原 private 分支无视此配置，曾将长回复拆成大量 /msg，实际触发 disconnect.spam。仅关聊天输出，不放宽服务端防 spam。未启用适配器的上游行为保持。

测试经历了有记录的工具澄清和多次正常重新连接；低血量 6 时停止，操作者仅对 MawNeko 定位并瞬时治疗后继续。受伤来源未取得可靠证据，不归因为特定怪物。重连不清零模型/原生账本，不生成机械部件；本次不能称全程无人干预的长期生存。

本次任务由独立看门狗和时限托管。接口测试、资源完整性不能当作长期自主生活或完整像素一致已验收。

### 已完成的实机任务（2026-10-09 01:42）

普通非 OP MawNeko（UUID `9309e057-a745-3dd6-958c-486cb7b1c466`）已从所提供原料实际取料、制作工作台、安山合金、传动轴、风车轴承和 8 面白帆，并真实放置。轴承在 **(-395,64,415)，朝西**，转子在 x=-396。最后由线上模型选择空手原生右键启动，随后本人两次实际读取确认：

| 数据 | 第一次 | 第二次 |
| --- | --- | --- |
| 时间（UTC） | 2026-10-08 17:42:53.933 | 17:42:58.357 |
| running / sailCount / RPM | true / 8 / 1 | true / 8 / 1 |
| contraptionUuid | 548b384d-115b-4640-ad43-86a34fae931d | 同一个 UUID |
| angleDegrees / stalled | 21.599993 / false | 48.299927 / false |

`windmill-completion-native.json` 保存全部本人合成、放置和角度回执索引；累计模型账本 529 次包含先前界面测试、工具修复和任务重连，不能称为一次无指导自主任务的调用数。任务确已完成，但中途多次由操作者澄清槽位/方块属性/遮挡问题，并有前述一次定位和治疗；不是“任意模组均可自主游玩”或从零自然采集的验收。风车是可运行的最小八帆原型，没有接磨石或建成装饰塔楼。

新增通用处理：`world.lookAt` 未指定 aimOffset 时按最多 7 个表面瞄准点依次请求真实服务端射线，每次之间等待 2 tick；明确指定瞄准点则不改。`world.interact` 未指定点时先确认可见表面，再次核对菜单/手持，然后只派发一次实际交互。不会穿墙查询或自动重试已派发的未知动作。手持不匹配回执提供本人实际菜单/快捷栏/光标和说明；同参数、同身体/手持上下文的已知失败三次后不再派发，须改变操作或状态。已知失败不解除 unknown 阻断。

本轮自行设置的累计模型预算经核对从 512 增至 576，仍保留所有旧意图/结果；供应商没有报告额度耗尽。代码允许的最大配置为 1024、默认仍 24。任务完成后模型停止继续行动，仅保留限时观察连接。

最终相关回归：91 项 Agent/原生协议 Node、53 项网页/真实资源 Node、8 项 Python 全通过，0 失败/0 跳过；真实安装 Neko 的命令/身体互斥/私有 WebSocket/关闭长私聊检查通过，模型调用为 0。Java 使用实际安装依赖编译，完整 Java 客户端场景仍未对照。

## 同账号网页

`http://127.0.0.1:28990/third/` 只监听本机，在限时 MawNeko 连接结束后关闭。风车轴承使用 Create 6.0.10 原 blockstate、shaft_half、bearing/top_wooden 模型和原 PNG；转子使用服务端本人已跟踪实体的真实方块列表、anchor、轴和角度。只接受同 UUID/维度/epoch，最多 4 个实体、每个 96 方块，陈旧或超预算明确 unavailable。没有假齿轮或替代方块；尚未完成与匹配 Java 客户端的全场景像素对照。

01:49 浏览器实机已显示八帆原模型随真实角度转动。修复了对整个已跟踪转子做中心点视线判断而误隐藏全部帆的问题：渲染快照复用本人实际原生实体跟踪，交由正常深度遮挡；`native.entity/world.look` 的可见性查询规则保持。新服正常冷备/重启后同一转子 UUID 仍在运行，entityId 从 1061 变为 9，不复用旧连接实体 ID。MawNeko 仍是同一账号，未新增观察玩家、未由管理员代为启动。
