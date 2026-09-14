# 生活记忆使用真实回执

2026-09-14 14:22 的桐人任务原始记录有 33 次工具调用，没有进食；原生记忆代理稍后却将其整理为“吃甜菜根 11→12”。另一次 dream 把反复失败的放泥土腾格过程强化为流程，没有纳入已提供的 drop_items。

已核对锁定版本 QwenPaw 2.2.0 / ReMe 0.4.1.10：AutoMemoryStep 的 `_format_history` 默认只调用 `get_text_content()`，不向学习模型展示工具回执；保存 mem_session 时又有意移除 tool_result，避免检索结果被当成用户事实。原生 dream 支持 CORRECT、保留来源与内联纠正。这次复用这些扩展机制，不修改原生记录格式、模型、队列、记忆开关、频率或 session。

项目新增两个模块：`world/ops/life_memory_evidence.py` 生成有限的结构化证据，`life_memory_evidence_runtime.py` 使用官方步骤 subclass 钩子和 application-local registry.add。只有经过现有 manifest 验证的桐人、结衣原 UUID 和工作区选择新步骤，其他角色配置及全局冻结注册表保持原样。入口由游戏现有 game_service 调用 `install('game')`，不创建新进程。

每次原生记忆整理保留原文本，追加配对 call_id/tool name 的回执投影：同一身体、actionId、明确 completed 与 completionConfirmed 及成功结果才能支持成功事实。拒绝、unknown、仅受理、空闲均不计功；历史 status 重读不冒充本轮新动作。回执按 actionId 去重，女仆 work 配置成功也不冒充实际工作产出。思考、工具输入租约、聊天、检索/文件正文和凭据不进入证据层。

证据写入工作区 `notes/runtime-evidence/<sha256>.md`，内容寻址、相同内容不重写，已有字节冲突则拒绝。此目录在原生 memory/digest 监视范围外，不会为每个证据文件再触发 dream。提示内给出有限摘要和文件引用，调用/结果不完整明确标记，不把缺失补成成功。原生工具结果被截断时，只能读取该结果 metadata 精确指定的本工作区 tool_results 文件，有路径和大小校验。

auto_memory 与 dream 的原生系统提示追加同一验真约定，并读当前原生 MCP 工具卡的纯工具名/启用状态及能力资料 SHA。接口存在与实际执行分开；旧坐标、体征和短期任务不升级成当前状态或永久指令。新接口和证据与旧方法矛盾时，模型仍按原生 CORRECT 流程生成带日期和来源的纠正，不规定它应该丢什么、建什么或按哪套游戏策略行动。

历史纠错由 `tools/prepare_life_memory_corrections.py --output <新的runtime目录>` 生成预览。脚本只做原生 workspace GET，校验本次完整核对记录，保存原 ETag/原字节/拟写内容。部署者先通过官方 no-overwrite upload 创建纠错来源，再按 If-Match 写入三个仅追加注释的文档。遇并发变更重新预览；不强制覆盖，不修改 dialog/mem_session，不把重新生成记忆当作原动作曾发生。本脚本没有 apply、模型请求或重建接口。

验证：专门回归覆盖 33 调用无进食、成功/拒绝/unknown/错身体、重复/缺失回执、异步历史回执、组件丢出与拾取边界、女仆工作配置、截断结果定位、不可变证据、原生配置与步骤格式化、其他角色隔离，以及原生 ETag 纠错预览。离线输入验证只能证明证据进入原生学习链，不能替代上线后检查自然产生的摘要质量。
