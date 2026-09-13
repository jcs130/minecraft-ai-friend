# Qwen 原生进程重启后的桐人任务归档

`tools/recover_survivor_orphan.py` 是一次性维护工具，没有新守护进程或模型循环。
用于原 `submitted` 任务仍在控制器、Qwen 重启后原生任务表已丢失的情况。
404 本身不证明任务结束，也不证明模型或游戏目标完成。

## 执行

在项目根目录运行只读预览，必须显式给出原任务 ID：

```powershell
python tools/recover_survivor_orphan.py --task-id task-bd14f3422df7
```

确认预览的身体、会话、task、turn、回执数量和当前原生角色状态后，停止已有
survivor 容器，再运行同一命令加 `--apply`。工具不会停止或启动任何服务。
默认只操作本项目 `qiandengji-survivor-1`、`qiandengji-qwenpaw-1`，并验证
Compose 项目/服务标签及 survivor 的 `/state` 实际绑定路径。

宿主 Windows 锁与容器 Linux flock 不互通，因此 **必须让 survivor 容器 exited**，
不能只设置暂停后与仍运行的 controller 竞争写入。正常服务收尾的 `stopped` 状态可接受。

## 证据和结果

应用要求控制器 disabled、原身份与生活 session 完全匹配，并同时满足：

- 当前 Qwen 容器启动时间晚于旧模型提交，原 task 原生 GET 精确返回缺失；
- 已部署 console 源码的任务存储确为进程内字典，记录其 SHA256；
- 当前 `qd-survivor` 原生 agent-status 为 idle、running_task_count 为 0；
- 旧 lease 仍在、closed 且过期，unknown/inflight 标记不存在；
- 旧 turn 每个已使用动作均有收尾回执，last-action 回执亦已收尾，技能无待执行步骤；
- 归档前后容器身份与启动时点不变，实际应用前再次读取原生状态并比较原文件字节。

先在 `survival/orphaned-tasks/<task>-<id>/` 保存原 controller、control、lease、
life-session、设置、原 turn 索引和动作回执原字节。`recovery.json` 的 phase 固定为
prepared，包含证据、文件 SHA256 和拟更新 controller。随后仅原子修改 controller，
读回验证后另写 `applied.json` 和实际 controller SHA256。

新审计事件是 `decision_interrupted`，`nativeTaskCompleted=null`，取消状态为
`native_runtime_interrupted`。原任务最终输出仍无法核实；历史已完成的具体游戏动作
继续沿用其原回执，不推广为整轮任务成功。旧 active 完整保存在归档；会话、旧 lease、
决策用量、上一轮结果、动作日志、review/感知/伙伴消息消费水位均不改写。

工具保持 disabled，不发送模型、游戏、伙伴消息或任何旧动作。之后由维护者启动已有
survivor，再使用原 `control.py resume`：原控制器先观察当前世界、按既有身份恢复身体，
使用新的 turn 和原生活 session 继续。新一轮是否实际开始、身体是否恢复、动作结果
必须分别读取真实回执验收，不能把归档成功说成自主生活恢复成功。
