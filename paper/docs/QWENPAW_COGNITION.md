# 桐人的多会话、后台复盘与记忆

## 2026-10-21 自主日常与普通索敌修复

原生插件0.3.0已热更新，服主明确授权后可由两分钟心跳自行选择附近的剑士、补给、制造或探索小目标。默认仍不授权自主游玩；只有绑定文件 `autonomy.enabled` 为布尔 `true` 才启动健康状态下的日常轮次。心跳重读绑定，离线、身体忙碌或已排队时不叠加一轮；已排队的日常在执行前再次检查暂停。`daily_profile.py` 只调整原生心跳，保留模型、工具、记忆、额度和单轮预算。

正式曾实际完成引导登记、技能目录实练、花6点魔力施放归乡术，并接下“巡夜人·初试锋芒”三次僵尸/尸壳近战击杀委托。**尚未证明三次击杀或委托完成。** 随后发现原生 `numen.scan.entities` 把已加载但被地面遮挡的生物及精确坐标交给模型。桐人的日常标志、QwenPaw角色和Numen常驻均已暂停，实际原生 `numen.task.status()` 确认无身体任务；原角色不永久遣散，不回写背包或任务存档。

待上线补丁是 `patches/ordinary-entity-vision.patch`：普通实体扫描在生成列表/数量之前复用原版眼部视线判断，排除遮挡、对该玩家隐身及观战实体；自动防卫、逃跑和路线威胁场采用相同可见性口径。没有目标只表示“当前未看见”，不能断言地下无怪。声音是听觉线索；隐藏目标需要游戏内探敌技能及正常魔力、冷却，不能用旧扫描坐标继续追踪。

范围是普通实体扫描与自动索敌；本补丁没有重写所有方块、矿物、容器和寻路数据接口，也没有声称形成面对恶意脚本的完整防作弊沙箱。日常规则明确隐藏矿物应使用探矿术。普通玩家与其他Agent客户端不需修改，Numen API、Minecraft网络载荷和认证保持；仅替换Numen内容JAR，需要经过批准的Paper维护重启。

验证：79项QwenPaw单元通过，6项独立联机默认跳过；Numen内容204项JVM单元通过，最终同摘要Paper133的21项感知GameTest通过，含4条新增回归（墙后/隐身、地下与移动后复查、观战账号、隐藏僵尸的扫描及自动索敌）。成品只有3个类有指令变化，5个嵌套记录类仅调试行号变化，经javap比较确认；其余条目字节保持。

E/F候选与回退文件已核对，正式JAR尚未替换，尚未排队维护。按此前重启先确认要求，取得本次批准后再预告、检查活动与真人、正常停服并做完整双盘冷备份；安装后验证视线过滤，再按原UUID恢复QwenPaw与日常。恢复时更正旧隐藏目标观测，禁止重放先前不明结果的动作。回退也只按正常停服更换内容JAR，不恢复旧世界/背包。候选摘要见 `paper/manifests/kirito-daily-vision-candidate-20261021.json`。

2026-10-20；QwenPaw 2.2.2，千灯纪插件 0.2.1。**已正式上线，使用原生游戏频道与 PowerContext。** 本文替代初版候选中“所有会话都转交身体会话”的设计，原验证记录保留。

## 分工

| 场景 | 原生能力 | 工具与结果 |
| --- | --- | --- |
| 现场执行与回复 | 游戏频道、队列、Goal、Task Tracker | 只有固定身体会话能用原 MCP 的八工具；完整行动轮互斥 |
| 临时复盘、路线和技能分析 | `spawn_subagent(background=true)`、`check_agent_task` | 独立会话，最多两个同时运行；后台不能移动、攻击、发言或执行任意 Lua/命令 |
| 可反复交谈的复盘/规划会话 | 本机 Console API、独立 session | `request_context.qiandengji_role=review` 或 `planner`；保留自己的历史，不转交身体 |
| 跨会话原始经历 | Scroll 的 `history.db`、`recall_history` | 同角色不同会话查原文、工具结果和来源；无需模型生成 Python |
| 长期经验与任务状态 | 官方 PowerContext 插件、原生记忆生命周期 | 本角色独立 scope；`memory_search`、`memory_remember`；框架异步保存任务状态 |

后台不是第二个游戏客户端，也不持有另一份 Brain 凭据。它的结果作为建议留在原生任务结果及本角色记忆中。现场会话至少30秒后通过原生任务查询取回结果，按当前回执继续，不忙等，不把提交 task_id 当完成。

### 权限和成本

后台工具严格限制为 `qiandengji_snapshot`、`recall_history`、`memory_search`、`memory_remember`。省略白名单时也不会继承身体工具；显式传空列表仍为零工具。模型请求的白名单只取交集，技能列表为空；恢复历史中的旧工具调用也再次拦截。后台文本包装后再进入原生斜杠分派，不能启动另一个 `/goal`。

每个后台调用最多180秒、6个原生 ReAct 循环；批次最多两个、不递归创建子任务、不 fork Git。现场保留原12个内层循环及3回合/64000 token的短目标预算。部署配置的模型并发3，原QPM12和模型不改。框架的额度按 `provider:model` 共享，**不是为每个角色预留三个名额，也不保证响应时间**。

原生限流器缓存第一次取得的额度；单独热重载角色不能把已存在的1并发改为3。因此发布须正常重启 QwenPaw，并复核实际并行；不能仅凭配置文件说已生效。

## 准确读取现场

新增原生受治理工具：

```text
qiandengji_snapshot(section="status")
qiandengji_snapshot(section="tasks")
qiandengji_snapshot(section="skills", expected_revision="上次回执的revision")
```

内部只允许三条固定只读 `/mycli` 查询，沿原 MCP 驱动传输。返回服务器来源、UUID、查询时间、身体代次、是否缓存、身体是否忙碌和原回执。重复读取最多缓存5秒；动作轮及工具前后都会使旧代次失效。不同代次或查询中身体发生变化会标记 `stale`。代次不代表世界被冻结，其他玩家、怪物和自然变化仍可能发生，行动前必须重新查询真实条件。

连接失败返回 `unknown`，不假造状态，不重放行动。后台提示和记忆均明确区分事实、推测、建议；照片、背包、任务进度、坐标、冷却以服务器为准。后台不能覆盖公开的身体执行状态，也不把私聊、记忆或内部推理写进 Web 状态投影。

## PowerContext 接入

复用当前部署的 `http://127.0.0.1:8100` 和官方 `memory-powercontext` 1.0.0，不新增公网接口。本插件注册 `qiandengji-powercontext` 后端，继承官方管理器的工具、自动保存、治理、鉴权、预算和关闭逻辑，仅适配服务的搜索结果。

实测当前服务与官方插件有两处差别：

1. 服务要求先 `POST /v1/scopes` 创建空间，并使用服务实际返回的 scope_id。任意拼接 `qwenpaw:...` 字符串会404；安装器使用幂等创建键，不能自动换到默认或全局空间。
2. 搜索可以返回 `memory.text`、`memory.artifact` 及 `matched_by=[text,vector]`；旧插件仅接受含 entry_id 的旧结果。兼容层同时接受这两种结果，保留真实 family/artifact_id/revision，**不伪造 entry_id**，字段无效则明确失败。

配置通过 [候选配置构造器](../integrations/numen-paper/qwenpaw/cognition_profile.py) 生成；凭据仅由私有安装器读取，不写进源码。示意：

```json
{
  "memory_manager_backend": "qiandengji-powercontext",
  "memory_backend_configs": {
    "qiandengji-powercontext": {
      "base_url": "http://127.0.0.1:8100",
      "scope_id": "服务创建后返回的本角色空间ID",
      "token": "由受保护文件注入，不提交",
      "timeout": 3,
      "auto_memory_search_config": {
        "enabled": false,
        "max_results": 2,
        "max_context_bytes": 6000
      }
    }
  }
}
```

默认按需检索；现场不会每条消息都自动联网查记忆。后台可以显式查最多两条、总计6000字节。框架原生自动保存不额外调用总结模型，但 PowerContext 服务自身处理记忆仍会使用其已配置的模型和嵌入。

同一个角色的现场、复盘、规划和子任务共用这个 scope。其他角色与公开世界资料保持分离，不把私人对话自动复制到公共空间。ReMe原配置、笔记和索引保留；本次切换长期后端，**尚未把历史 ReMe 笔记批量迁入新空间**。原始会话仍由 Scroll 跨会话查询；不能宣称两个长期后端同时在写入。

## 调用示例

在现场使用框架原生工具：

```text
spawn_subagent(task="核对当前委托缺项，查询经验并提出下一步；只读，不执行", background=true, timeout=120)
check_agent_task(task_id="原生返回的task_id")
```

已有本机 Console API 可提交独立复盘，`X-Agent-Id` 仍选桐人；参数保留独立 session：

```json
{
  "session_id": "kirito-review-contract",
  "user_id": "local-operator",
  "channel": "console",
  "request_context": {"qiandengji_role": "review"},
  "input": [{"role":"user","content":[{"type":"text","text":"分析当前委托，给出建议"}]}]
}
```

需要异步提交可复用 `/api/console/chat/task`。停止使用原生任务/会话停止接口；超时、取消和断线不重新投递旧动作。普通 Console 现场指令仍兼容初版转交方式。

## 验证与状态

本次隔离检查与早期失败见发布候选清单；当前已验证后台与现场并行、原生子任务及真实只读工具、跨会话原文检索，以及没有对话上下文的新进程 PowerContext 召回。未验16个自主模型、完整长期生存或远端 Web消费者。

正式安装前须完成角色与全局配置的E/F双盘备份，使用正常服务生命周期停止/启动 QwenPaw。Paper、游戏客户端和原桐人UUID/物品不随此次改变。回退恢复旧控制器、角色配置、频道及旧 Console事件入口；保留新会话、账本与远程记忆，不回写旧世界或旧背包，也不自动删除新 scope。

官方资料：[多智能体及原生后台子任务](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.2/website/public/docs/multi-agent.zh.md)、[Scroll与情景记忆](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.2/website/public/docs/context.zh.md)、[PowerContext插件](https://github.com/agentscope-ai/QwenPaw/tree/v2.2.2/plugins/memory/powercontext)。以本机2.2.2代码、实际部署接口与本轮实测为准。

## 正式发布与实际复核

服主批准后正常重启QwenPaw，Paper保持在线。E/F角色及配置冷备份在安装之前逐文件核对；原桐人UUID、33条库存、末影箱、大背包和职业点数保持。较早的角色基线已有4点剑耐久差、1次近战击杀/20伤害进展及法杖外观字段变化，均记录而不回写存档。

- 70项单元通过，6项旧隔离联机默认跳过。正式沿原驱动实际收到状态、任务及技能页；技能使用 `MC_PAGE kind=skills`，不误判为缺少 `MC_SKILL`。
- 正式原生子任务实际调用快照与记忆，独立复盘实际读取任务、技能和记忆；只读白名单生效。后台快照可能因身体轮次变化标记stale，行动前仍须复核。
- 两个实际请求重叠：现场4.04秒完成，复盘14.59秒完成；这只证明本次并行，不代表三个专属模型名额或16个自主Agent负载承诺。
- 真实入门说明经原生PowerContext工具写入，在没有对话上下文的新进程召回，带真实artifact/revision。旧ReMe和全部会话保留。

上线中发现并修复QwenPaw2.2.2稍后启用/重载工作区漏掉插件工具描述符的问题：0.2.1在原生工具构建前恢复本插件快照工具，仍经过原配置禁用、治理与后台白名单；新增实际原生工具过滤回归。原工具、模型、QPM及其他角色启用状态保持。

Windows后台会话0与桌面会话的 `Local` 退出事件不相通；本机维护工具在核对唯一回环监听进程后，以管理员权限发送后台会话的原生退出事件，沿原任务恢复，无强杀。取消和早期失败记录保留。参见[微软命名空间说明](https://learn.microsoft.com/windows/win32/termserv/kernel-object-namespaces)。

本机发布证据与三次冷备份位于 `E:/MC/ops/repairs/qwenpaw-cognition-20261020/` 及F盘镜像；仓库只保存无凭据的[发布清单](../manifests/qwenpaw-cognition-release-20261020.json)。Windows下次维护使用已修正的 `resume-session0-admin.ps1` 思路并先检查当前状态，不重复运行仅适用于旧版前置条件的安装器。
