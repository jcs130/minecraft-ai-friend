# 桐人按需图像感知与供应商限流恢复

2026-09-14。已部署原 survivor 的 autonomy23 镜像，增加原有 QwenPaw 生活会话中的真实图片输入，并让明确的短时供应商限流进入有界等待，继续保留身体回执、未知结果和人工暂停的约束。具体部署与云端验证边界见末节。

## 图像使用原生观测，不增加视觉服务

链路为：**本人 Numen `look_around` → survivor 内 Pillow 编码 → 原生 MCP 图片结果 → game QwenPaw 当前生活会话 → 已配置的云端模型**。采集和绘图本身没有模型调用；图片由模型按需选择的 `view_scene` 工具返回，不建立第二个视觉 Agent、模型直连或定时截图任务。

[SceneView](../world/survival/scene_view.py) 固定使用当前 gateway 绑定的身体，工具仅接受 `radius`，默认8，范围4–12。调用者不能指定另一个角色、自由坐标、相机朝向或远方区块。原生网格的头部提供中心格和四向朝向，每个字符表示一个水平格的通行类别：平地、上一级、下降一两级、深落差、阻挡、水、岩浆/危险、邻近危险的谨慎区、树或未加载。图内保留原字符和完整图例。

实现直接读取完整原生网格，不从 `observe()` 的截短摘要补全，也不进行逐像素 RCON 查询。它在读取前后核对同一身体、维度及网格位置关系，再在 Python 中编码；这些是多次受限读取，元数据明确 `atomicSnapshot=false`，不能宣称来自同一服务器 tick。Numen 的脚位采用自身台阶/半砖规则，显示高度以原网格头为准。

| 约束 | 当前实现 |
| --- | --- |
| 原生输入 | 最多4096字节；严格验证头、图例、方格行列数、字符集及唯一中心 `@` |
| 图片 | Pillow 输出 `image/png`，每边不超过640像素、编码不超过256 KiB |
| 未知数据 | `?` 保持未加载；没有实体叠层，不推断未给出的方块ID或几何 |
| 新鲜度 | 每次重新观察世界；采集检查超过5秒期限则无图，不返回旧帧兜底 |
| 并发与缓存 | 一个 `SceneView` 同时一个采集；忙时返回 `scene_busy`，无积压任务；最多缓存两帧编码 |
| 缓存身份 | 键包含身体名字/UUID、维度、前后位置、范围、中心、朝向和原网格哈希；命中也有新的世界读取与观测时间 |
| 错误 | 格式、身体变化、超时等返回固定错误码及 `png=None`，不把原始异常或残留图片当结果 |

[MCP 入口](../world/survival/mcp_server.py) 返回 `CallToolResult`：第一块是带身份、时间、范围、局限的 `TextContent`，第二块是装载实际 PNG 字节的 `ImageContent`。失败只有文本错误块且 `isError=true`。这与返回文件路径或 JSON 中的 base64 字符串不同；现有 Qwen 原生适配器可以把图片保留为模型请求中的图像内容。新增工具使源码清单从45项变为46项，部署时还需实际验证角色工具重载。

这张图是**语义俯视图，FOV为 `null`**。它没有第一视角、透视投影、精确视线遮挡、方块材质、YSM人物外观、粒子或GUI；格子类别也不等于导航成功证明。原用户的 FOV110 要求仍保留在[透视图设计](SURVIVOR-VISION-DESIGN.md)中，本次没有实现。遇到空间判断需要时再调用 `view_scene`；具体方块、附近实体与动作结果继续用 `inspect_block`、`look`、`status` 等工具核实。

渐进指南为 [vision.md](../world/ops/skills/qd-survivor-practice/references/vision.md)。原生 Scroll/记忆继续管理生活会话历史；本次不新增图像历史服务，也不把每帧图片、整张网格或“看图了”抄成已完成的游戏成果。

## 短时限流不等于套餐用尽

`MODEL_QUOTA_EXCEEDED` 这类封装代码本身不能确定额度是否耗尽。本实现读取**已确认失败的原生任务 `result.error`** 中的明确原因，不根据模型答复、日志关键词或通用429状态猜测。

[阿里云 Coding Plan 官方 FAQ](https://help.aliyun.com/zh/model-studio/coding-plan-faq) 区分了请求/资源峰值触发的短时限流、平台动态并发限制，以及小时、周、月窗口额度耗尽。因此遇到 `usage` 原因时，应显示短时限流；不能仅因文本含 `quota` 就判定套餐用完。以下对应关系于2026-09-14核对官方说明。

| 原生明确原因 | 本地分类 | 原循环的处理 |
| --- | --- | --- |
| `usage allocated quota exceeded` | `provider_throttled` | 持久退避后，再按当前事实开始下一生活轮 |
| `concurrency allocated quota exceeded` | `provider_concurrency` | 同一退避机制，等待供应商并发恢复 |
| `hour` / `week` / `month` 的额度超限原因 | `provider_window_exhausted` | 保留窗口信息，沿用原有重复失败停机处理；不冒充短时恢复 |
| 原生 `_AcquireTimeoutError` | `local_queue_timeout` | 本地队列等待失败，保留独立分类；不归因为供应商套餐 |
| 不明确、相互冲突或结构不合法 | `unknown` | 不猜恢复时点，不授权自动短时重试 |

[inference_errors.py](../world/survival/inference_errors.py) 是无I/O的分类与状态校验模块。供应商分类还必须同时具有原生 `code=MODEL_QUOTA_EXCEEDED`；工具错误或缺失代码即使碰巧含同样短语也不授权恢复。它限制原因文本长度；对外投影只含固定描述、任务标识与有限时间字段，不暴露原始错误正文、凭证或模型内容。

## 恢复仍由原生活循环负责

[Controller](../world/survival/controller.py) 只对已确认的 `provider_throttled` / `provider_concurrency` 终态保存 `inferenceBackoff`。等待序列为 **60、120、240、480、960、1920、3600秒**，随后上限保持3600秒。这里的60..3600秒是本项目调度策略，不是供应商承诺的恢复时长。

原任务先完成终态收束、动作回执收集及租约关闭；如有队伍回复回执，还要等待该回执结算。之后才进入等待。到期由已有 `submit_model()` 在同一生活 session 内创建新的 task/turn，重新读取当前世界事实；不会重发旧任务或重放旧身体动作。成功完成一轮后清除退避；下一次新的短时失败从60秒开始。

截止时间与次数保存在原控制器状态，重启会保留。事件、新目标或普通心跳不能跳过期限；无效或未来伪造的退避状态会明确暂停。人工暂停、维护排空、身体离线/变化、在途动作及未知执行结果仍按现有规则处理，不能被“限流恢复”解除。其他失败保留原有累计两次后的 `repeated_model_failure` 行为；本次也不会自动解除此前已经发生的停机。

等待不增加宿主进程、容器、模型 daemon 或外部重试脚本。现有 survivor 服务持续负责状态读取和调度，game QwenPaw 仍是唯一 LLM 入口。身体原生快系统不因图片或供应商等待而更换执行器。

## 验证与部署界限

[test_survival_scene_view.py](../tests/test_survival_scene_view.py) 的15项测试已在原 survivor 镜像的断网、只读隔离容器通过，覆盖实际原生协议样例、可解码 PNG、全部字符逐格保留、未知格、身份/位置/维度、输入范围、失效缓存、并发及失败。另一次将新模块仅加载到现有容器 Python 内存的**只读实验**获得620×616、19,411字节 PNG，已本地解码和查看；无角色动作、模型调用或容器文件写入。原始运行证据留在本地忽略目录 `runtime/survivor-vision-20260914/`，不作为公开仓库资产。

原生端到端协议测试入口为 [test_survival_scene_mcp.py](../tests/test_survival_scene_mcp.py)：验证 FastMCP 真正返回图片块，以及安装的 Qwen/AgentScope 适配后图片字节、工具身份仍进入模型请求。限流测试入口为 [test_survival_inference_errors.py](../tests/test_survival_inference_errors.py)：覆盖原因分类、退避阶梯、重启持久化、同session新轮次、成功清除、原始动作回执保留及暂停/未知结果不越过。最终运行数量与结果以主维护流程实际报告为准。

心跳新增 `visionProtocol=1` 和 `inferenceFailureVersion=1`，原有 survivor 健康探针检查协议版本。协议就绪不证明模型已看图，更不证明自主游戏目标完成；上线后还需验证生产原生工具、云端图片请求和真实行动回执。

## 部署与运行验收记录

23:19 已部署 `qiandengji-survivor:2.2.0-autonomy23`，镜像 SHA256 `54eaa98afcd75cffa48155caccfc4fc895fba382f2628f6a7df4529b4474e0dd`，36项源文件与当前镜像逐项一致。此前桐人被两次真实短时限流触发旧版停机；维护核对那两个任务均明确失败后，暂停其2项原Cron、备份1,174个原状态文件，再只替换 survivor，重载原panel。游戏主服、游戏Qwen2.2.1和宿主Qwen没有重启。

原生API同步原实践技能正文与新的 vision.md，并将原 MCP 白名单45→46项；其他driver字段、模型、人格、身体、生活session、长期使命与其变更时间保持原值。23:20恢复原自主循环与班次。30项部署检查通过：13服务运行、12探针健康、10角色/16原Cron及两原生活会话保留；游戏Qwen完整检查通过，10角色96技能绑定均在。现役模型文档元数据 qwen3.5-plus 的 image/video/multimodal 均为true，这本身还不是云端图片推理证据。

测试通过：106项错误恢复/原控制器/规划/上下文回归、15项图像、3项实际 game Qwen2.2.1 原生 MCP→formatter 测试、20项健康测试、11项面板测试（包含浏览器状态标签）。34项实践和19项结衣收件箱按当前源码重新运行，旧报告原字节归档。完整 panel-smoke 内的 survivor（含两新增协议与错误投影）、game_qwenpaw、survival_practice、maid_perception 均通过；全项目历史来源与若干其他功能探针仍非全绿，未修改历史hash凑绿。

现服 `/mcp` 经认证的 Streamable HTTP 实际返回46项工具及 `view_scene` 的文本+PNG两块内容：620×616、19,233字节，采集窗口约91ms；角色为原Kirito，中心(-641,64,1049)。该次是单次只读测量，不是性能分位数。安装版Qwen格式化测试确认图像字节进入后续user image_url且tool_call_id保留。

23:22:42 `task-51fb8c502d13`、23:23:46 `task-4c2831fe9cdd` 在原 `life-e5222596680d4720ba79d8527eae078d` 会话先后实际 completed，无云端错误，并有导航、采收/补种、面包合成及remember回执。由此确认云端已重新接受原模型调用、旧自主阻断已解除；本窗没再发生429，所以生产退避分支的等待/恢复仍以隔离回归为证明，不能拿成功轮冒充真实限流复现。两个自然轮均未调用view_scene；随后的一次原会话只读读图验收另行记录。

本地证据、逐项备份及维护回执在 `runtime/agent-vision-20260914/`（不入Git）。其中游戏RCON私聊只证明Minecraft送达，未在当前模型感知通道找到该标记，不能冒称模型收到或修复了任意私聊输入。

### 实际模型读图与驱动权限修复

第一次在原会话进行只读测试的 `task-8978fc95e9c0` 正常结束，但 view_scene 被 `driver_policy_denied` 拒绝。这暴露了真正的配置遗漏：官方 `/mcp/tools/numen_survival` 只更新工具发现名单，原native card仍只有45条允许规则；早期健康检查又在比较两份旧45清单，因此未检出。失败原样保留。

随后经官方 `/mcp/policy/numen_survival` 仅追加 `view_scene` 的allow工具规则，保持default deny、原45规则、连接/凭据引用及名单；该API会同步更新现役handler，无需重启游戏Qwen。其派生 `access_summary` 会随权限计数变化，不属于连接参数变更。配置工具 [configure_survivor_vision.py](../tools/configure_survivor_vision.py) 默认只读预览，只在原角色、控制器和班次全idle时应用；同策略再次调用无写入。健康检查已改为按当前源码工具清单校验native card及每项调用规则，另加6项策略回归测试。

第二次只读测试 `task-61cb28994743` 在同一原生活session正常completed，**唯一工具调用为 view_scene(radius=8)，返回state=success与真实图片块**。该PNG为20,036字节，SHA256 `72543682d972a2a0efa0bcaf26be0da9b2c8857cb2e8b9303bd6c359f87484c7`；从原回执解码看图，四邻格确实均为flat，与模型按东、西、南、北回答一致。元数据没提供四邻格答案，模型同时正确区分俯视图与第一视角。这个单例确认云端能用原工具图片，不代表所有视觉推断或自主看图时机都已验证。

两次测试通过原Qwen官方任务入口进入原会话，维护期间身体租约关闭，没有发放新动作权限或改长期使命；成功测试未调用身体/文件/记忆/队伍工具。验收后已恢复原自主控制及两Cron，并再验30部署检查全过。第二次任务报告input_tokens=116697/output_tokens=545，这是整个原会话请求统计，不能当成单张PNG的token成本；未提供cache字段，不能记作0命中。后续仍应按需取图、使用原Scroll和渐进技能，不默认每轮追加图片。

最终恢复后 `task-5fea64f3c6a8` 于23:39:12在原会话自然completed，继续导航查询和remember；这里没有把每次move调用均算成成功移动。最终完整panel-smoke的四项相关分组仍通过，原循环保持启用，16项原Cron全部恢复。新版策略配置工具再次 `--apply` 明确 changed=false/applied=false，未重复写入或重放模型实验。
