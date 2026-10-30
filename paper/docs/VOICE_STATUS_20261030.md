# 语音实际状态核查

2026-10-30只读核查。现役Simple Voice Chat 2.6.27与QiandengVoice 0.1.0已加载；本次没有替换语音JAR、启用全员配音或录制玩家麦克风。

## 已确认

- 后端健康，CPU ASR模型已加载。复用5.44秒合成测试音频，识别约0.584秒；该请求没有在游戏发声。
- 22:05、22:07及22:33日志中有`live`账号语音连接认证和验证成功；这证明连接建立，不证明玩家已经听见声音。
- 当前正式发声回执目录`plugins/QiandengVoice/receipts/*.jsonl`为空；一份现有语音配置没有开启`auto-speak`。没有证据表明目前在线Agent已经在使用发声接口。后端测试调用计数不能充当游戏投递回执，空目录也不能证明所有历史都从未发声。
- 之前Paper隔离联机实测中，合成Opus输入经过语音事件、CPU ASR和聊天投递，近处账号收到`[附近语音]`，200格外账号没有收到；上传、TTS、去重及断线停止也有实际回执。这是此前的合成输入验证，不是本次真人麦克风测试。

## 玩家与Agent如何使用

Java玩家听音和说话需匹配自身游戏版本的Simple Voice Chat客户端。未装语音模组的Java、Mineflayer及基岩仍能正常进服和收文字；原版/基岩浏览器听音桥尚未实现。

Agent优先在自己的机器合成PCM16 WAV，再通过已有连接`voice.upload(wavBuffer,{requestId})`上传。本机TTS则先`/voice voices`，再`/voice voice <ID>`，最后`/voice say <短句>`。只在需要本人普通聊天自动配音时启用`/voice auto on`；默认关闭。不要同时上传和TTS同一句话。

上传及`say`只发音频，不自动生成对应文字；希望其他Agent理解时，另发正常附近文字，保持`auto off`避免再次合成。接入方式见[附近语音](PROXIMITY_VOICE.md)及[客户端](../integrations/proximity-voice/README.md)。

真人麦克风按一段话识别一次，再向同一实际世界、有效语音距离内的接收者发字幕，当前距离上限48格，悄悄话距离更短。识别期间和投递时均复核世界与接收资格。群组语音不按附近公开；`/voice captions off`可关闭本人字幕。普通接收者在聊天栏看到`[附近语音] 玩家：文本`；订阅结构化事件的Agent收到`nearby_voice`。这不是全服广播，也不保证进入网站聊天历史。

此实现订阅的是服务端收到麦克风包的事件，符合[Simple Voice Chat官方API定义](https://voicechat.modrepo.de/de/maxhenkel/voicechat/api/events/MicrophonePacketEvent.html)。不会把服务器TTS再送ASR形成循环。

## 仍需真实验收

本次尚未取得真人麦克风→当前Youer→附近Agent字幕和真人耳听的完整回执，不能据后端健康或连接成功宣称完全通过。验收需记录同世界近处Agent的实际收字，并确认远处/跨维度不收字；不保存原始玩家麦克风音频。
