# 桐人的多会话、后台复盘与记忆

2026-10-20；QwenPaw 2.2.2，千灯纪插件 0.2.0。**候选已实现，正式仍使用旧 Console 桥；尚未切换。** 本文替代初版候选中“所有会话都转交身体会话”的设计，原验证记录保留。

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

每个后台调用最多180秒、6个原生 ReAct 循环；批次最多两个、不递归创建子任务、不 fork Git。现场保留原12个内层循环及3回合/64000 token的短目标预算。候选模型并发3，原QPM12和模型不改。框架的额度按 `provider:model` 共享，**不是为每个角色预留三个名额，也不保证响应时间**。

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

同一个角色的现场、复盘、规划和子任务共用这个 scope。其他角色与公开世界资料保持分离，不把私人对话自动复制到公共空间。ReMe原配置、笔记和索引保留；本候选切换长期后端，**尚未把历史 ReMe 笔记批量迁入新空间**。原始会话仍由 Scroll 跨会话查询；不能宣称两个长期后端同时在写入。

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
