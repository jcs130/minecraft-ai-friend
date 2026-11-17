# 三位服务端 NPC 的语音候选，2026-11-18

本批补齐肥鱼、Numen 桐人和结衣的双向语音。代码合并、候选验证、正式部署、真人听感分别记录；本文是候选说明，不能代替正式加载记录。

原缺口：语音只绑定原肥鱼；第二位女仆被单例原音钩子拒绝；Numen 的 `say` 写入原生文字出站队列，却没有接到 SVC；语音识别也没有进入 Numen 的结构化原生收件箱。不是再启动一套模型或额外玩家连接。

## 路径与边界

- 真人 SVC 麦克风 → 原 CPU ASR，每段识别一次 → 带原发言 UUID、事件 ID、频道与接收者的原生收件箱 → 统一主模型及系统一回复判断 → 原身体 `chat`／`say` → 已有本机 TTS → SVC 附近音频。
- NPC 相互理解使用同一条已发出文字的事件，不把合成声音重新识别。`listenerId` 仅表示观察者，不表示对方点名；附近发言、群体寒暄、NPC 客套结束语沿用共享注意策略，可以沉默。
- Maid 原伙伴24格／访客8格保持，且不超过麦克风实际传播范围。Numen 使用登记范围；跨维度、私密语音组、不可见来源不公开转写。说话中途才靠近的角色不能收到整段文字。
- 只对明确登记的原身体 UUID 与主人 UUID 生效。Numen 还校验原生实体类型和账号名；普通同名玩家不能冒充，其他女仆不会因此启用共享 TTS。
- 每次发声映射到稳定原请求 ID，重复、断线或重启不自动重播。`submitted`、`sent`、实际收包、解码、人耳听见是不同证据；未知结果只查原请求。

## 配置与构建

在 `plugins/QiandengVoice/npc-voices.json` 放置[登记文件](../integrations/proximity-voice/npc-voices.example.json)，换成已经核验的实体身份和已有音色。示例是隔离身份，不可原样安装正式服。Maid 共用现有 `companion-speech.json` 的本机媒体地址与私有令牌；每个角色独立音色和回执。备用角色不继承肥鱼的预录音包，避免混声。Numen 复用 QiandengVoice 的现有媒体服务。配置不含模型密钥，客户端也不拿到服务令牌。

候选使用已有音源：肥鱼保留纳西妲，桐人使用 Yunxi 男声，结衣使用既有 `neko-yui-cn`。这里不重新克隆音源、不迁移 TTS 服务、不改系统一或相机。云端 TTS 可接在同一受限媒体后端；本批只验现有本机后端，不声称云端故障回退已实现。

组件：QiandengVoice 0.1.8、MaidBridge 0.1.47-npc-voice、合并脑内 qd adapter 0.1.2（TLM agents 仍0.3.11）、Hosted native bridge 0.1.2，以及三个 Python 输入／注意策略文件。使用：

```powershell
python paper/integrations/proximity-voice/build.py --paper <verified-runtime> --svc <svc.jar> --jdk <jdk21> --out <candidate-directory>
python paper/integrations/proximity-voice/build-npc-bridges.py --server <verified-runtime> --jdk <jdk21> --out <candidate-directory>
```

第二项只接受11月17日已核验前像 SHA，输出候选，不修改传入服务器目录。它保留合并脑的其他类，不能另装一份脑扩展。`NpcVoiceQA.jar` 仅为 loopback54848、带隔离标记的测试服使用，绝不能部署正式服。

## 验证与发布

旧正式 JAR 的新接口反射检查先失败，候选通过；旧 Numen 输入适配器无法保留语音元数据，回放同组回归先失败后通过。Python定向回归68项通过，Java覆盖身份、同请求去重、距离、迟到听众及已有语音账本／上传边界。真实隔离服务器使用独立 SVC UDP 客户端收加密包、真实 Opus 解码，并将合成测试句作为麦克风上行交给现有 CPU ASR，核对三位原生收件箱、远处听众、私密组、不同维度和重复包。

SVC 连接对象是快照，切换组后重新获取连接验证，不能用旧对象的 `isInGroup()` 当结果，见[官方 API](https://voicechat.modrepo.de/de/maxhenkel/voicechat/api/VoicechatConnection.html)。正式真人麦克风、原观战客户端耳听、自然多人对话及长期负载仍须分别验收；程序收包不能代替这些验收。

发布需要正常停服和新维护入口，只在 F 盘备份当次世界、身份、背包、认证、生命／动作／语音账本和当前运行配置。安装前重新检查真人／活动门禁及180/60/10预告。仅更换冻结代码和新增登记文件，正常启动后回读所有原身份与四组件版本，再恢复唯一 NPC 执行器。回退先暂停执行器，仅回退本批代码及登记配置，保留最新世界和全部账本；有未知发声结果不重播，也不回灌旧角色或旧记忆。
