package dev.god.godvoice;

import de.maxhenkel.voicechat.api.audiochannel.AudioChannel;
import de.maxhenkel.voicechat.api.opus.OpusEncoder;
import de.maxhenkel.voicechat.plugins.impl.audiochannel.AudioPlayerImpl;
import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Runs the installed SVC AudioPlayer thread with fake encoder/channel: no audio/network output. */
public class SpeechAudioPlayerContractTest {
    static int n;
    static void check(boolean value, String label) { n++; if (!value) throw new AssertionError(label); }
    public static void main(String[] args) throws Exception {
        var sends = new AtomicInteger(); var callback = new AtomicBoolean(); var closed = new AtomicBoolean();
        var channel = (AudioChannel) Proxy.newProxyInstance(AudioChannel.class.getClassLoader(), new Class<?>[]{AudioChannel.class}, (p, m, a) -> {
            if (m.getName().equals("send")) sends.incrementAndGet();
            if (m.getReturnType() == boolean.class) return false;
            return null;
        });
        var encoder = (OpusEncoder) Proxy.newProxyInstance(OpusEncoder.class.getClassLoader(), new Class<?>[]{OpusEncoder.class}, (p, m, a) -> {
            if (m.getName().equals("encode")) { check(((short[]) a[0]).length == 960, "native encoder gets one full frame"); return new byte[]{1}; }
            if (m.getName().equals("close")) closed.set(true);
            if (m.getName().equals("isClosed")) return closed.get();
            return null;
        });
        var frames = new SpeechFrames(new short[1921]);
        var player = new AudioPlayerImpl(channel, encoder, frames);
        player.setOnStopped(() -> callback.set(true));
        player.startPlaying(); player.join(2000);
        check(player.isStopped() && callback.get() && frames.completed(), "installed SVC confirms natural completion");
        check(sends.get() == 3 && closed.get(), "three padded frames sent and encoder closed");
        callback.set(false); sends.set(0); closed.set(false);
        var interrupted = new SpeechFrames(new short[48000]);
        var second = new AudioPlayerImpl(channel, encoder, interrupted);
        second.setOnStopped(() -> callback.set(true)); second.startPlaying();
        long deadline = System.nanoTime() + 1_000_000_000L;
        while (sends.get() == 0 && System.nanoTime() < deadline) Thread.sleep(1);
        interrupted.cancel(); second.stopPlaying(); second.join(2000);
        check(second.isStopped() && callback.get(), "native cancellation also invokes stopped callback");
        check(!interrupted.completed() && sends.get() < 50, "native interrupted callback is not speech completion");
        System.out.println("{\"ok\":true,\"assertions\":" + n + ",\"liveAudio\":false}");
    }
}
