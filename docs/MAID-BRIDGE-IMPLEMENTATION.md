# 女仆原生 AI 与独立角色桥接

实现位于 `world/maid-bridge-src` 和 `world/sidecar/maid_*`。扩展复用 Touhou Little Maid 1.5.3 的聊天回调与原生工作状态，让 QwenPaw 接收真实女仆身份并控制自身工作模式。原生 Brain 持续负责寻路和工作，Qwen 负责低频对话与目标判断；两边不分别运行一条模型工具循环。

## 身份与工具

服务端桥从真实实体取得 UUID、主人 UUID、模型和加载状态，以请求签名传给内部 NPC 适配器。人物注册表将同一女仆稳定映射到一个真实 Qwen Agent，名字和外观不作为身份依据。每个角色独立会话、人格和记忆；女仆用途共享 24 次任务/滚动 24 小时、60 秒间隔，数量增加不会翻倍额度。

第一批原生 MCP 为 `identity`、`context`、`task_catalog`、`sit`、`follow`、`schedule`、`work`。凭据固定绑定自身 UUID 与主人，模型不能选择其他女仆；每次写操作重新检查主人、实体与区块加载状态。请求先记账后执行，未知结果不重放。工作模式设置成功不能解释为已经收获或建成房屋。

没有主人的现有女仆等待正常收养，不自动变更主人。已绑定但未加载的原有女仆可以注册资料并保留休眠状态，不强行加载旧区域。普通区块卸载后原生工作 AI 不继续执行。当前桥接提供常驻角色的基础，尚未验收主动接任务、跨天经营农场的完整慢系统。

## 声音

女仆原生事件语音继续由模组播放。AI 回复复用原生 TTS 请求和回调；本地 TTS 的 `/tts/maid` 返回原生 MP3 解码器支持的音频。GodVoice 的角色发声队列另支持桐人等 Numen 身体：固定人物声音、代次取消、过期丢弃、排队回执以及播放时字幕。原生队列和解码测试与真人实际听到声音分开验收。

## 部署与验证

Minecraft 停止后先备份完整存档，再用 `deploy_character_extensions.py` 部署客户端/服务端配套 JAR；`configure_maid_bridge.py` 保留原站点 ID 与模型显示名，生成内部身份密钥。客户端也需要新的女仆桥 JAR 才能识别聊天站点编解码器。`prepare_maid_settings.py` 只补已有模型缺失的原生设置文件，不覆盖原人物设定。

TLM 的资源包重载会清空此前从 config 读入的设置。通用设置还需放入独立的原生 settings 包；本轮已通过 `tlm pack reload` 验证重载后两位已加载女仆仍能识别设置，原站点、主人和人物模型保持不变。

独立 NeoForge 测试世界验证过双人物隔离、真实原生聊天回调、工作状态、保存重启和幂等回执；没有调用模型或修改生产实体。生产检查由 `maid_bridge_health.py` 读取实际原生指令、签名适配器与注册表，不用测试世界结果冒充原人物已经自主完成任务。

## 桐人专属伙伴接入

专属新女仆使用控制台 `qdmaid companion_adopt <requestId> <maidUuid> <numenOwnerUuid>` 进行三格以内、有视线的正常原生持物交互；不增加人物 MCP 权限，不自动寻路或赠予物资。认领保留 TLM 蛋糕消耗、数量限制和事件，并提供持久一次性回执。随后 `qdmaid companion_chat <maidUuid> <numenOwnerUuid>` 只设置现有桥接站点与模型字段。命令边界、初始化记录和失败后的处理见[女仆桥 README](../world/maid-bridge-src/README.md#numen-专属女仆接入)。

最终候选桥 JAR（SHA-256 `e66178ad6bcc12b025af74d02411d6ae6560459dbfe6a016587a2828eb4972b9`）通过 99 个离线检查、51 项伙伴实机检查（`runtime/maid-bridge-qa-6fafd13572fa/result.json`）和原桥 20 项回归（`runtime/maid-bridge-qa-f7431df1a2ea/result.json`）。包含原生认领、跟随、附近游戏发言回执、重启防重，以及旧 deepseek 禁用时正确选取已启用 codingplan；全部隔离测试零真实模型调用。生产已完整备份当前存档、同步女仆模组两端并受控重启；原桐人经同 UUID 原生恢复，专属新女仆小灯已正常蛋糕认领，初始化蛋糕账目为 0→1→0。小灯 NoAI 已解除、follow 开启、sit 关闭；生产 `companion_chat` 返回 `already_configured`，原生站点为 codingplan、模型标签为 qd-maid-dialogue，不启用旧站点。最终本机证据在 `runtime/maid-companion-production-20260908/site-selection-acceptance.json`，主线使用的新旧人物均未换 UUID。人工步行没有派发；这些身体状态与隔离验证不等于双方已自主完成旅行或协作产出，真实后续见[旅行伙伴联调记录](SURVIVOR-MAID-PARTY.md#联调记录)。

## 原生女仆对话接口核查与后续接线

2026-09-08 核查确认，用户指出的“车万女仆有专门的对话接口”可以直接复用。以下结论来自当前安装的 TLM 1.5.3 / NeoForge 1.21.1 JAR 字节码、项目桥接源码，以及官方固定提交 `207647c85740b1d0971de6040d6dd57cea62528c`。原版 `/msg` 对实体的限制不代表 TLM 原生对话不可用。本节记录接口与待办，不表示已经给桐人接入原生女仆对话输入工具。

### 已确认的入口与现有 Qwen 桥

真人看向自己拥有的女仆并按聊天键，客户端先通过 `OpenMaidAIChatPacket` 获得服务端鉴权和资料同步，再由聊天界面发送 `SendUserChatPackage(maidId, message, clientInfo)`。服务端在主线程从发送者所在 level 查找实体，确认女仆存活并且 `maid.isOwnedBy(sender)` 后调用下列接口。`manager.chat` 自身不重复这些身份检查，服务器适配入口必须保留鉴权，不能仅凭任意 UUID 调用。[打开界面的原生鉴权](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/network/message/ai/OpenMaidAIChatPacket.java#L33)、[原生消息接收](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/network/message/SendUserChatPackage.java#L42)。

```java
// 只在 MC 主线程、验证当前实体和真实主人之后调用。
maid.getAiChatManager().chat(
    text,
    new ChatClientInfo("zh_cn", maid.getName().getString(), List.of()),
    numenOwner
);
```

`NumenPlayer` 继承 `ServerPlayer`，满足这个接口的参数类型。这里使用 `ChatClientInfo` 的普通构造器；它的 `fromMaid` 方法依赖客户端资源，不能在专用服务器上调用。姓名和描述属于游戏资料，不提供 Qwen 身份或权限。[ChatClientInfo 原生契约](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/manager/entity/ChatClientInfo.java#L15)。

现有调用链已经是 `MaidAIChatManager → BridgeClient.chat(LLMCallback) → 签名 /v1/maid/chat/completions → MaidAdapter.complete_signed → QwenTasks → callback.onSuccess(ResponseChat)`。`BridgeClient` 从实际女仆取身份和原生上下文，异步 HTTP 完成后回到 MC 线程重新核验实体和主人。`MaidAdapter` 将其路由到该女仆已注册的 Qwen 角色，沿用 `maid-<实体 UUID>-<绑定代次>` 会话及角色串行门；不因聊天来自伙伴而另建女仆人格。Qwen 负责唯一的工具推理过程，BridgeClient 不传递 TLM 工具调用列表。相关实现为 [BridgeClient.java](../world/maid-bridge-src/src/dev/qiandeng/maid/BridgeClient.java)、[maid_agent_api.py](../world/sidecar/maid_agent_api.py)、[qwen_tasks.py](../world/sidecar/qwen_tasks.py)。

**已实测范围：** `MaidQa.java` 的 `chat` 分支通过上述完整 `manager.chat` 接口向两位由真实 NumenPlayer 拥有的女仆发送测试输入，确定性假 HTTP 服务返回后，回复进入各自原生历史。历史隔离报告 `runtime/maid-bridge-qa-366e269d15a2/result.json` 的 `real-native-chat-callback`、`signed-two-identity-isolation` 等 20 项通过。该报告没有真实 Qwen 推理、真人客户端或物理音频验收；不能用它证明新候选 JAR 已在生产完成桐人对话。[原生入口测试代码](../world/maid-bridge-src/qa/MaidQa.java)、[隔离验收工具](../tools/smoke_maid_bridge.py)。

### 回复显示与当前缺口

原生 `LLMCallback.onSuccess` 先记录 assistant 历史，再选择 TTS 或文字气泡。`ChatBubbleManager.addLLMChatText` 更新实体气泡，并通过 `owner.sendSystemMessage` 给主人显示带女仆名字的文字；TTS 成功则向主人发送 `TTSAudioToClientPackage`。这些都是可复用的原生呈现机制。[原生成功回调](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/manager/entity/LLMCallback.java#L157)、[聊天气泡和主人消息](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/chatbubble/ChatBubbleManager.java#L93)、[TTS 接收者](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/manager/entity/TTSCallback.java#L42)。

以下部分仍待实现或单独验收：

- **桐人接收回复：** Numen 的 `FakeConnection.send` 明确丢弃客户端包。向假玩家发送原生聊天或音频包，不等于桐人的模型已经收到，也不能记为真人已经听到。需要在 MC 端关联这次对话的原生回复事件，确认当前实体、主人、绑定代次仍一致后，才允许桐人的持久生活会话读取。
- **迟到答案恢复：** 当前 `MaidAdapter` 最多等待 48 秒，Qwen 原生任务最长 180 秒。HTTP 返回 504 会让 Java 回调进入失败路径，随后完成的答案不会自动重新投递。后续应持久保存游戏事件与既有 Qwen 任务的关联，只查询该任务并回传一次，不能通过再次 `manager.chat` 获得答案。
- **重复输入与串行：** 原生 `normalChat` 在调用 BridgeClient 前已添加用户历史。BridgeClient 的内存 busy 检查不足以防止重复历史，因此持久事件认领、同一女仆的串行检查必须在调用 `manager.chat` 之前完成。认领后结果未知不能再次发送。
- **隐含的额外推理：** 原生 `HistorySummaryManager` 达到阈值后可能先通过 `site.client().chat(HistorySummaryCallback)` 请求摘要，再继续普通对话；空设定也可能触发自动生成设定。现桥不按 callback 类型区分这些用途。伙伴接线应要求已有设定，并明确处理摘要 callback，不能把摘要请求混入女仆正常对话或绕过预算。当前 BridgeClient 没有更新原生 token 用量，不代表所有旧存档都永远不会触发摘要。持久模型上下文压缩应统一留给 Qwen；不再启用 TLM `onFunctionCall` 内部的重复模型调用链。[原生摘要触发与再次调用](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/manager/entity/summary/HistorySummaryManager.java#L92)。
- **对话可见范围：** 原生主人聊天栏和 AI TTS 面向主人，但头顶气泡写入同步实体数据，客户端气泡渲染不检查所有权，附近玩家可能看见。因此原生女仆对话不等于严格保密的私聊。对话已写入游戏、Agent 已接收、音频已播放应分别记录，不相互替代。

### 最小后续实现与验收

沿用现有女仆桥和 NPC 服务，新增一个固定双方身份、有限文本、持久 `eventId` 的原生对话入口，在 MC 主线程检查双方存活、同维度、项目规定的近距条件和真实所有权后调用 `manager.chat`。只由现有 BridgeClient/MaidAdapter 提交该次 Qwen 任务；Party 队列负责记录游戏输入与原生回复，不能为同一消息再直接派遣第二份 Qwen 任务。回复应重新核验绑定，写入游戏确认的定向对话事件，再进入桐人现有生活会话。正文在对应接收事件确认前不公开给对方模型；超时、卸载或换主人不能自动改为附近广播。

可在现有隔离世界中先用确定性假 HTTP 服务验证：正常原生输入和回调、两位女仆身份隔离、事件重放不新增历史与任务、忙时不污染历史、48 秒以后任务完成的单次回传、换主人或卸载后拒绝迟到回复、游戏未确认接收时收件箱不泄漏正文。再由受现有预算约束的一次真实 Qwen 任务验证任务 ID、工具轨迹与原生回执关联；物理客户端看到或听到另行验收。完成这些检查之前，状态应继续标记“原生链路可复用，桐人输入与异步回执待接入”。
