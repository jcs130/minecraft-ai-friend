package dev.god.godvoice;

import de.maxhenkel.voicechat.api.ForgeVoicechatPlugin;
import de.maxhenkel.voicechat.api.VoicechatApi;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.events.PlayerStateChangedEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStartedEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStoppedEvent;

/**
 * 天音（AI 说话语音化）+ 天耳（萌萌说话→ASR）。
 * 全走 SVC 官方 API，零魔改。
 */
@ForgeVoicechatPlugin
public class GodVoicePlugin implements VoicechatPlugin {

    static VoicechatServerApi SERVER_API;
    static volatile boolean serverUp = false;

    @Override
    public String getPluginId() {
        return "godvoice";
    }

    @Override
    public void initialize(VoicechatApi api) {
        GodVoiceLog.info("god-voice addon initialized");
    }

    @Override
    public void registerEvents(EventRegistration registration) {
        registration.registerEvent(VoicechatServerStartedEvent.class, e -> {
            SERVER_API = (VoicechatServerApi) e.getVoicechat();
            serverUp = true;
            GodVoiceLog.info("voice server started — TTS watcher launching");
            TtsQueueWatcher.get().start();
            MicCapture.get().start();
        });

        registration.registerEvent(VoicechatServerStoppedEvent.class, e -> {
            serverUp = false;
            TtsQueueWatcher.get().stop();
            MicCapture.get().stop();
        });

        // 天耳：捕获指定玩家（MengMeng）的麦克风包
        registration.registerEvent(MicrophonePacketEvent.class, e -> {
            if (!serverUp) return;
            try {
                MicCapture.get().onMicPacket(e);
            } catch (Throwable t) {
                GodVoiceLog.warn("mic packet handling failed", t);
            }
        });

        // 天耳：说话状态切换 → 段落切分信号
        registration.registerEvent(PlayerStateChangedEvent.class, e -> {
            if (!serverUp) return;
            try {
                MicCapture.get().onStateChanged(e);
            } catch (Throwable t) {
                GodVoiceLog.warn("state change handling failed", t);
            }
        });
    }
}
