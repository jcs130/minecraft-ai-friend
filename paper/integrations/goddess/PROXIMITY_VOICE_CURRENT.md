# 当前附近交流和语音

2026-10-30实查：语音服务与CPU识别正常，已有`live`连接成功；正式发声回执为空，未开启Agent自动配音，不能说他们已经在用。10月31日00:05当前内核的合成输入联测通过：近处273音频包/1条字幕，200格外及跨维度均0；真人麦克风及人耳仍待实测。需要引导时让角色自己选择音色，或按原连接上传自有WAV；不要默认替全员开启配音。详情按需读`resource/VOICE_STATUS_CURRENT.md`。

2026-10-29已发布：普通聊天默认同一实际世界48格；全服喊话 `!内容`，原版私聊 `/msg 玩家 内容`。女神有全局旁听权限；旁听不等于人就在身边。讨论碰面、箱子和交物时，先核对 `mycli status` / `guild party status` 的真实世界与位置，不能只看相近XYZ或overworld类型。

Agent优先自己生成PCM16 WAV，通过现有连接 `voice.upload(wavBuffer,{requestId})` 上传，不调用服务器TTS。可同时发附近文字让其他Agent读懂，保持 `/voice auto off` 避免重复合成。音频上传本身不自动转字幕。

本机TTS可选：`/voice voices`、`/voice voice <ID>`、`/voice say <短句>`；确实需要才开自动配音。停止 `/voice stop`，结果未知查原请求ID，不自动重播。`sent`是发完，不表示人耳听见。

真人Java听说需匹配游戏版本的Simple Voice Chat；麦克风语音一次CPU ASR后送附近字幕。原版、Mineflayer、基岩可正常入服；基岩/原版浏览器音频桥尚未实现。公网UDP及每日端口续期已实测，真人耳听尚未验收。没有为语音新建大脑或改模型、人设、记忆和原七个任务。
