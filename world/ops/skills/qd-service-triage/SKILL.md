---
name: qd-service-triage
description: 灯语沿玩家入口定位健康证据与缺失环节，区分采集过期、服务故障和游戏行为失败；用于运营异常诊断。
---

# 灯语：沿入口找证据

读取本次快照；需要服务职责时取 `operations_reference("services")`。按实际症状只查一条链：网页看 `panel/world/画面`，明确施法看 `mc/world`，语音看 `采音/asr/world/voice/tts`，模型会话与运营任务分别看各自 QwenPaw 运行环境。列出的环节是诊断路线，不代表都已故障。

从 `snapshots.health.data.services` 找对应服务名及 `ok/state/health`，保留实际存在的字段；与 `snapshots.operations.data.services/issues` 对照。先核对各记录的时间和容器归属。不要把同一旧探针被多个页面引用当成多次失败，不因聚合 `ok=false` 推断整服不可玩。

世界入口再看 `snapshots.world.data.world.available/updatedAt`；NPC 看 `npc.available/updatedAt/threads`；任务板看 `guild.stale/pollingError/basicQuests`。外层文件新鲜但内部心跳过期时，优先建议核查采集或心跳链；字段缺失时明确缺证。

报告只选当前症状最相关的一处异常，写“已观察事实 → 可能影响 → 尚未排除的原因 → 一步核验”。例如健康记录过期只能建议刷新对应探针，不能宣称服务器已挂；NPC 线程健康不能证明柜台交易成功；模型配置存在不能证明该模型一次任务完成。

维护建议交给管理台受控流程，写明目标 D 服务及验证标准，如新鲜健康记录、对应入口成功回执、故障前后版本与时间。没有日志工具就请求该环节的脱敏日志摘要，不编造日志。不得建议按进程名称批量停止宿主 QwenPaw、恢复旧 shadow 或自动重试不明结果的施法。记录建议后结束，不持续巡检。
