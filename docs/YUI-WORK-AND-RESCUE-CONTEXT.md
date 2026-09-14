# 结衣的工作发现、交流与新鲜救援观察

2026-09-14 候选改进。本文的离线验证不等于已部署，也不证明结衣已经开始自主农耕。

13:20:46 至约 15:10 的只读审计看到结衣原会话结束 13 轮，未见框架 Doom。她确实写了 6 次记忆、发出 3 次队伍消息，也持有更多小麦和种子，但没有调用 work、task_catalog 或农耕能力。库存增加能证明持有物资，不能把原生拾取写成亲自种地。一次来信回复是工具 XML，被游戏发送校验拒绝；两次救援分别被旧观测过期和源位置改变拒绝，均未实际传送。原始证据保存在本机 `runtime/yui-party-audit-20260914-1507/`，不提交运行资料。

## 变化

`PartyBridge.work_context` 在既有生活轮和来信轮提供少量可核实的资料：只在原生身份列出 equipment 类别时读取一次自身装备，标明观察时间、截断与不可用状态；同时给出本角色工作指南和协作技能的工作区路径。它不会查完整资料库、选择工作、修改物品或发模型请求。生活轮的资料随原 claim 冻结，重启或忙碌恢复不会改写原请求。

模型通过实际 task_catalog 查询选择自己的工作，仍能选择探索、调整分工或休息。技能说明区分 idle、原生工作模式、工作效果和物品归属；说明合适地点的家园模式、准备回执与缺少操作时的真实分工。结衣的名字、人物关系、模型、原身体和原会话都不变。

已精确绑定并在当前工具 scope 中开放三项救援能力的结衣，会获得本轮新 inspect/rescue 请求的建议名称。名称随原会话与原 claim 确定，同 claim 稳定，不同 claim 不复用历史名称；它只是尚未提交的标签，不授予权限、不证明新鲜、不清除旧未知请求。实际队列、租约、过期时间、位置和原生检查全部沿用现有实现。技能明确：未知只查原 ID，明确拒绝后根据新事实判断，不能把 queued 当成死锁或 completed 的 inspect 当成救援完成。

来信仍使用原游戏听见事件。提示明确要求自然语言正文，并区分自动发送的来信最终答复和不会自动广播的生活小结。原工具 XML 拒绝和分段语音校验保留；没有额外模型纠错、文本伪调用执行或后台通信。

## 验证

离线实际运行：

- `test_party_life.py`：28 项通过，包含装备实际进入原请求、claim 冻结、读失败不造空背包、建议标签稳定且只给精确身份与 scope、没有原生写。
- `test_party_bridge.py`：26 项通过，包含真实听见后原会话投递、装备与纯文本回复契约、工具 XML 不执行不重试、身份变化及未知提交保护。
- `test_party_reply_segments.py`：8 项通过，保持完整游戏听见回执与未知不重发。

这些测试使用既有离线 fixture，不调用生产模型或游戏动作。它们证明接线与边界，不能保证模型必然选择农耕或再也不输出 XML。

## 由主线程部署与验收

NPC 服务需加载更新后的 `world/sidecar/party_bridge.py` 与 `party_life.py`。沿项目既有空闲维护流程处理当前任务，保留原 request/session/角色资料，不清除未知请求或重新提交历史任务。本候选不需要修改 Minecraft JAR、客户端、宿主 Qwen 或角色模型。

在游戏 Qwen 18089 的原角色空闲边界，使用既有原生技能同步工具先预览，再由主线程应用：

```powershell
.\run-python.bat tools/sync_team_skills.py --actor game:5swvhK --skill qd-party-cooperation --skill qd-yui-rescue --skill qd-minecraft-guide
.\run-python.bat tools/sync_team_skills.py --actor game:5swvhK --skill qd-party-cooperation --skill qd-yui-rescue --skill qd-minecraft-guide --apply qiandengji
```

共同协作指南若同步给桐人，另选原 `game:qd-survivor` 和 `qd-party-cooperation`/`qd-minecraft-guide`；不把结衣专属救援技能推广给其它角色。参考文件单独变化也必须让原生技能重新扫描；`sync_team_skills.py` 已处理 ETag、同内容主文件保存、enable 和最终读取核验，不直接覆盖工作区配置。

上线后在新时间窗观察原任务：确认 workSupport 确实进入请求、目录和资料是否被使用、角色自主选择及原生回执。选择农耕时分别核对工作模式和实际作物/库存变化；选择休息则保留她的理由。救援错误或 XML 分支没有自然出现时，只报告离线验证，不为补齐验收主动制造受困、喂食、切模式或发送测试消息。旧验收证据原字节保留，新源码和新窗口证据由主线程统一发布。
