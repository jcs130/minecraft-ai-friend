# 千灯纪四阶段验收与客户端证据请求

2026-11-08 只读审计。代码合并、候选验证、正式部署、真实游戏验收分别记录；本次文档修正不部署、不升级远端客户端、不切换驾驶权、不操作真实角色。

## 版本证据

原 `current-deployment.json` 保留11月6日批次的历史字段，不再作为全局现役清单；新增范围标识和[逐组件采样](../manifests/runtime-evidence-20261108.json)。制品路径、完整SHA256、内部元数据与已知部署记录在该文件；不知道的实际加载版本明确为null，未映射源码提交不能填成最新提交。

- 女仆PR109：合并dcc06400，69项候选检查与6CI，11月7日加载0.1.10-harness；这是历史专项，不是现役最高版本。
- 女仆PR116：合并3d43e2cf，233项候选与6CI，11月8日09:37正式加载桥0.1.12-conversation/扩展0.1.1/语音0.1.4；21项正式只读检查，不代表原主人格自主操作已验。
- 本机托管核心PR102：11月7日10:02部署preview.26，17个变更文件本轮摘要匹配。目录文件匹配不替代当前宿主加载路径回执。
- [客户端PR16](https://github.com/jcs130/cortico-world-qiandengji/pull/16)：已合并52372ea0，消费preview.28，但明确未发布npm/Market、未做新的现场加载。World、core、server pack的原可米现役版本均须回读。
- 客户端后续主干为 [PR19](https://github.com/jcs130/cortico-world-qiandengji/pull/19) 合并提交 `ad7cd5fb117299f296c3b18501f99c39f9653697`（11月8日11:21:35北京时间）；声明 World `0.4.1-rc.71-preview.29`、core `0.5.7-rc.160-preview.30`、server pack `0.5.0-rc.50-preview.25`，仍是源码/本地候选，不能替换上面的历史采样或填成原宿主加载版本。
- [客户端补证候选PR21](https://github.com/jcs130/cortico-world-qiandengji/pull/21) 提供原连接只读取证与恢复事件关联修复；498项World测试、类型、构建及独立SDK/MCP/API6/API5包级检查通过。本轮未访问原可米宿主，实际加载、真实查询、主模型输入回执均未取得，14项真实验收未关闭。

## 逐项验收台账

| 编号 | 当前结论 | 已有证据及缺失门槛 |
|---|---|---|
| C01 | 源码/取证候选已核；加载回读仍缺 | 历史范围保持，新增PR19/PR21源码信息；工具分别读取磁盘清单、原加载回执和完整制品摘要。仍缺原宿主三组件路径/PID/启动时间/提交/摘要；磁盘版本不算加载。 |
| C02 | 四个只读入口与候选probe已核；真实回执缺 | 原女仆及主人归属已有服务端证据；未取得原连接list完整回执。原协议查询ID为requestId，保留recipientUuid/requestId/sampledAt，不伪造queryId；未加载不推断删除。 |
| C03 | 服务端已有证据；客户端恢复关联修复候选 | 原实体生命20、保护/旧death resolved/原UUID recovery见证为既有服务端证据。本候选补list先alive、context后recovery时漏通知及原eventId；仍缺原context现场回读，观察不是实际复活时间。 |
| C04 | 六槽/背包检查候选；真实inventory缺 | 原生映射与现场物品旧证据保持；工具检查六槽、slotCount和精确原slot，不做物品转移。inventory原生不带ownerId，保留缺失，只与同probe原context所有权关联；不补造字段或把截断当空。 |
| C05 | tasks只读复用；原终态关联缺 | 14份原女仆动作回执索引保持；需原tasks/旧任务待复核/operationId终态统一对应。follow=applied、idle、目录读取均不证明目标完成，未知原ID不重放。 |
| C06 | 同轮配对检查候选；原观察对缺 | 工具拒绝不同observationId/run/connection及矛盾生命摘要。仍缺原mc_observe与supervisor overview及原UUID/名字/生命事实；空间readout的revision/时间不能改名充当observationId。 |
| C07 | sourceReceipt/恢复eventId候选；持久及主输入链缺 | 死亡/恢复/摘要保留原查询回执定位。当前连接内存去重不能称持久；仍缺原始收件→持久去重→observationId→实际main input→decisionId/原provider请求关联，源码或插件账本不能替代。 |
| C08 | 原主人格自然理解仍缺 | 工具保留原自然输出定位供人工语义审查，本地linked不算理解。chat=replied、follow=applied、静止近距采样不能替代；新增付费模型/移动跟随实测另需授权。 |
| C10 | 既有模块源码已核；原身份投递链仍缺 | 未新增现场证据；仍需原incoming类型及账号元数据到收件/投递关联，公屏/未知类型不能获得私聊权限。 |
| C11 | 原服务端自然会话部分证据保持；客户端关联缺 | 原女神最终silent JSON及后续答复为既有证据。本轮未取得原客户端requestId/接收回执；时间对齐或发送调用成功不足。 |
| C12 | 真实交接未验；另需授权 | 原台账采样时正式托管业务表为空，本轮未重采该表。隔离单驾驶测试不算真实交接；原客户端离线→托管→暂停保存下线→原客户端恢复须独立方案与授权。 |
| C13 | 本人Key/真实设备未验；另需授权 | 本轮模型调用0。BYOK、手机、麦克风及耳听分别验收；视口、模拟供应商、TTS/UDP/ASR不能替代，密钥不入证据包。 |
| C14 | 不重放策略保持；原请求/取消/暂停关联缺 | 工具不取消、重启或执行旧任务。仍缺真实待定请求/取消/重启暂停关联；unknown只查原ID不换ID。主动取消或重启实测另需授权。 |
| C15 | 原87份归档结论保持；全量现场前像仍缺 | 四批E/F代码前像与摘要为既有证据；本轮只校验客户端候选源码与包，不冒称官网/原客户端/全部历史组件重验。仅代码回退，保留最新世界/角色/库存/墓碑/生命账本/认证/脑选择/动作回执。 |

没有C09：沿用审查原编号，不擅自补号。正式自然会话原文和模型思考不进Git；私有索引位于服务器 `E:/MC/ops/audits/acceptance-20261108-r1/`。

## 原客户端只读证据包

使用原可米现有宿主和连接，不创建替代身体，不更新/重载插件，不抢占当前动作。各条数据保存时间和SHA256；字段不存在须明确missing，不能伪造ID或拼接不同轮次。

1. **loaded-components**：World/core/server pack各自实际路径、version、commit（无法确定则null）、制品SHA256、PID/启动时间、加载日志位置。仓库main/package.json不是加载回执。
2. **maid-queries**：从原本人连接只读list/context/inventory/tasks；保留完整原响应、recipientUuid、maidId、原ownerId、原requestId（查询ID）、sampledAt、版本。原inventory/tasks未返回ownerId时保留缺失，只按同连接原context精确关联，不填造字段。结果截断或不可用明确标记，不解释成空背包/已删除。
3. **observe-pair**：同一轮mc_observe与supervisor overview，保留原observationId、命名实体UUID、生命事实和伴随摘要。
4. **lifecycle-chain**：查既有死亡/恢复事件，不触发新事件。附eventId、原始收件定位、持久去重结果、observationId、decisionId、主模型实际输入的审查定位/摘要及既有自然回应。只提供已有链，缺一环就列缺口。
5. **task-ledger**：原operationId/状态/goalCompleted/取消回执、重启暂停理由。pending不算答复、applied不算目标完成；不以新operationId重试动作、不执行旧任务。
6. **delivery**：已有女神私聊原始incoming类型和账号元数据、原收件、模型决策/发送/收到关联；只取必要片段，不公开整段私聊或密钥。

截图、版本标签或助手口头“已成功”不能替代原始回执。聊天正文仅按必要范围留在私有证据包；公开只放摘要和关联ID，不上传登录凭据、API Key、模型思考正文。

## 客户端补证工具交付

[客户端PR21](https://github.com/jcs130/cortico-world-qiandengji/pull/21)，候选提交 `7d72943ed535b27504f49d23536f45dd0a27ae5f`。运行方式和现场字段见[只读runbook](https://github.com/jcs130/cortico-world-qiandengji/blob/codex/original-client-evidence-20261108/docs/original-client-acceptance-20261108.md)，[Node标准库脚本](https://github.com/jcs130/cortico-world-qiandengji/blob/codex/original-client-evidence-20261108/scripts/original-client-evidence.mjs)可单独放在原宿主执行，无需安装候选World。

默认只读取明确指定的既有JSON/JSONL证据及可选原Cortico本机GET历史接口；原宿主已有进程内运维接缝时，可传入现有MaidPort和只读观察入口做四次有限查询。没有该接缝时不新建World、MaidPort或第二身体，不臆造跨进程工具API，现场查询继续保持缺口。不同ID/原连接/角色、持久去重缺失、主会话历史冒充真实模型输入均不能通过关联检查。只生成新私有目录和摘要，不自动判14项通过。

本轮未访问原宿主或原连接，未触发真实死亡/恢复、模型、移动、物品、托管或未知动作；没有部署、重载或重新发布包。新增回归中的事件均是隔离fixture，不计真实验收。

## 另需授权的验收

真实托管驾驶权交接、移动跟随实测、本人模型调用、手机/麦克风/听感，以及新增正式审计日志的部署都需单独列方案。本次只读请求不授权这些操作。若发现越权、重复动作或物品映射异常，先停止对应写入/接管计划并报告；不自动重启、转移驾驶权或回灌备份。
