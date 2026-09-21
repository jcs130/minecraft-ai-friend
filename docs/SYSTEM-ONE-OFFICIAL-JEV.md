# 官方 Jev 切换（2026-09-21）

同日后续已部署[异步快慢控制与连接复用](JEV-FAST-SLOW-CONTROL.md)，下文保留初次切换的证据和当时延迟，不能用旧冷连接测量代表当前复用连接性能。

按用户要求，项目系统 1 默认从本地 Decider 切换到 TypeSafe 官方 `https://api.typesafe.ai/v1/systemone`，请求模型 `jev-latest`，实际响应模型为 `jev-1.13.0`。这次没有改身体控制器、引入新守护进程或自动降低执行阈值。宿主的共享本地 Decider 保留供其他用途，游戏链路不再默认依赖它，也不在官方故障时偷偷改用它。

协议依据：[官方 API](https://docs.typesafe.ai/api)、[Confidence](https://docs.typesafe.ai/confidence)。沿用 HTTP JSON 适配器；无需再安装 SDK。API Key 从 `/state/secret/jev-api-key` 读取，宿主对应被 Git 忽略的 `server/survival-agent-state/secret/jev-api-key`，文件 ACL 限于当前账户、SYSTEM 和管理员。密钥不写入环境变量、模型请求体、源码或报告。已有 `/state` 挂载承载该文件，无需重建容器。可通过 `SURVIVOR_SYSTEM_ONE_KEY_FILE` 指定其他受保护文件。

`SURVIVOR_SYSTEM_ONE_URL` 默认固定官方 HTTPS 地址，`SURVIVOR_SYSTEM_ONE_MODEL` 默认 `jev-latest`。代码只允许该精确官方地址，以及供显式研究使用的原本地地址；认证头仅附到官方请求。禁用环境代理、HTTP 重定向与自动重试，401、429、超时、错误格式、超大响应都沿原 replan 回 QwenPaw。保留 2 秒 HTTP 阶段超时、返回后 5 秒身体新鲜度复核、8192 字节局部状态及原身体租约/回执逻辑。

官方 `confidence` 是从整个概率分布得到的统计量，不等于 `probabilities[choice]`。原本地检查直接比较两者，切换后会误拒绝官方有效响应；现分别验证：confidence 有限且在 0–1，选项概率完整且归一，选中项为概率最大项。仍以官方 confidence ≥ 0.75 允许提交非空候选。记录 `provider`、实际 `model`、`selectedProbability`、confidence 与有限 token 用量，不生成或发送思考链。

既有 `system_one` 健康探针改为读取 survivor 容器实际配置，并调用官方 `GET /v1/models`，不消耗模型推理、不操作游戏。健康可用与策略质量分开；密钥缺失或 API 不通不会被静默报告成“本地正常”。

## 验证证据

- 官方模型列表和单次协议请求成功，实际模型 `jev-1.13.0`；验证输出不含凭据。
- 延用上轮原封不动的 6 个合成案例与期望值。官方选项命中 6/6，本地基线 4/6。官方 HTTP 往返约 584–661 ms；两个可行动案例的 confidence 为 0.24、0.67，均低于原阈值，另外四个选择交回慢系统，因此六次最终都回退，没有游戏动作。小样本且非独立游戏场景，不能报告 100% 游戏成功率、自动执行率提升或总体速度提升。
- 新增官方 confidence 与选中概率不同、最大项校验、认证文件读取、拒绝其他目标/重定向、401/429/超大响应/缺钥不重试、健康只查模型等回归。网络隔离的生产同款镜像测试中，源码具身 103 项通过；实际部署字节的具身/实践测试及晋升技能重测结果见本节后续部署记录。

原维护方式保持：drain 等现有回合结束、官方 Cron 暂停与配置快照、原容器管理 stop/start，只重启 survivor。原角色、记忆、技能历史及世界不重置。私有证据在 `runtime/system-one-official-20260921/`，密钥文件不复制进该目录；不要重放其中一次性维护或探测脚本。

部署字节的 103 项具身、34 项实践测试及 9 个晋升版本 62 个用例全部通过，原 7 项动作回执关联回归通过。真实身体快照从部署后的容器发往官方，输入状态 1721 字节，返回 `jev-1.13.0`、选择铁剑、confidence 0.79、选中概率 0.86、输入/输出 token 1123/46，本机端到端约 1224 ms，满足原新鲜度边界。这次仅为影子核验，没有实际派发装备动作，不增加成功动作链计数；旧“confidence=选中概率”的检查会错误拒绝这个有效响应。官方模型健康与桐人/结衣 48/3、7/3 项原工具入口均通过。

10:34 已逐项恢复原 10 个角色配置、16 个 Cron 和准入，原禁用任务保持禁用。后续桐人/结衣各完成新原生回合。技能参考文档也已按官方语义修订，通过现有 Qwen 官方文件/技能扫描流程在桐人回合结束后同步，读回、角色与 Cron 保持检查通过，临时 drain 已解除，无二次服务重启。面板检查中 runtime、operations、game_qwenpaw、survivor、system_one、embodied_agent、survival_practice 等通过；完整面板仍有既有来源不匹配和发布证据等失败，不宣称全项目全绿。
