package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.TTSCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.ai.service.tts.TTSClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.tts.TTSConfig;
import com.github.tartaricacid.touhoulittlemaid.ai.service.tts.TTSSite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.tts.siliconflow.TTSSiliconflowSite;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;

/** Original TLM chat UI provider. The model shown in its menu follows the body's live sound pack. */
final class MaidPackTtsSite extends TTSSiliconflowSite implements AutoCloseable {
    static final String MODEL = "selected_sound_pack";
    // TLM may serialize provider metadata. A serialized template cannot call the media API.
    private static final String MARKER = "http://127.0.0.1:1/qiandengji/selected-sound-pack";
    private final HybridMaidPlugin plugin;
    private final MaidSpeechMedia media;
    private final Path encoder;
    private final TTSSite previous;
    private boolean closed;
    private final ThreadPoolExecutor jobs = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(8), r -> new Thread(r, "maid-native-tts"), new ThreadPoolExecutor.AbortPolicy());

    MaidPackTtsSite(HybridMaidPlugin plugin, MaidSpeechMedia media, Path encoder) {
        super(PersonalMaidDialogue.SITE, ResourceLocation.fromNamespaceAndPath("touhou_little_maid", "textures/gui/ai_chat/siliconflow.png"),
            MARKER, true, "", new LinkedHashMap<>(), new LinkedHashMap<>(Map.of(MODEL, "跟随当前声音包")));
        this.plugin = plugin;
        this.media = media;
        this.encoder = encoder;
        if (!Files.isRegularFile(encoder)) throw new IllegalArgumentException("Native audio encoder missing");
        previous = AvailableSites.getTTSSite(id());
        if (previous != null && !MARKER.equals(previous.url())) throw new IllegalArgumentException("TTS site id in use");
        AvailableSites.TTS_SITES.put(id(), this);
    }

    @Override public TTSClient client() { return this::play; }

    private void play(String text, TTSConfig config, TTSCallback callback) {
        if (!Bukkit.isPrimaryThread()) {
            if (plugin.isEnabled()) Bukkit.getScheduler().runTask(plugin, () -> play(text, config, callback));
            return;
        }
        EntityMaid maid = callback.getMaid();
        var owner = maid.getOwner();
        if (closed || !plugin.personalDialogue(maid) || owner == null || maid.isSilent()
            || !id().equals(maid.getAiChatManager().ttsSite) || !MODEL.equals(config.model())) {
            callback.onFailure(null, new IllegalStateException("当前女仆未启用按声音包合成"), 409);
            return;
        }
        String pack = maid.getSoundPackId();
        String voice = plugin.personal.selectedVoice(maid);
        if (voice == null) {
            callback.onFailure(null, new IllegalStateException("此声音包还没有对应的服务器音色"), 404);
            return;
        }
        UUID body = maid.getUUID();
        var level = maid.level();
        try {
            jobs.execute(() -> {
                try {
                    byte[] audio = nativeAudio(encoder, media.wav(body, UUID.randomUUID(), voice, text));
                    if (plugin.isEnabled()) Bukkit.getScheduler().runTask(plugin, () -> {
                        // Discard an outstanding reply if the original selection, body or connection changed.
                        if (closed || maid.getOwner() != owner || maid.level() != level || !plugin.personalDialogue(maid)) return;
                        if (!maid.isSilent() && id().equals(maid.getAiChatManager().ttsSite)
                            && pack.equals(maid.getSoundPackId()) && voice.equals(plugin.personal.selectedVoice(maid))) callback.onSuccess(audio);
                        else callback.onFailure(null, new IllegalStateException("合成期间声音包或女仆状态已改变"), 409);
                    });
                } catch (Exception error) {
                    if (plugin.isEnabled()) Bukkit.getScheduler().runTask(plugin, () -> {
                        if (!closed && maid.getOwner() == owner && maid.level() == level && plugin.personalDialogue(maid))
                            callback.onFailure(null, new IOException("服务器未能生成本次语音"), 503);
                    });
                }
            });
        } catch (RejectedExecutionException busy) {
            callback.onFailure(null, new IllegalStateException("服务器语音正忙"), 429);
        }
    }

    static byte[] nativeAudio(Path encoder, byte[] wav) throws Exception {
        // The native 1.5.3 client reads MP3, Opus and Vorbis. The SVC media service returns PCM WAV.
        Path input = Files.createTempFile("qdj-maid-tts-", ".wav");
        Path output = input.resolveSibling(input.getFileName() + ".mp3");
        Process process = null;
        try {
            Files.write(input, wav);
            process = new ProcessBuilder(encoder.toString(), "-nostdin", "-loglevel", "error", "-i", input.toString(),
                "-map", "0:a:0", "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "64k", output.toString())
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            if (!process.waitFor(12, TimeUnit.SECONDS) || process.exitValue() != 0)
                throw new IOException("Native audio encoding failed");
            long size = Files.size(output);
            if (size < 128 || size > 950_000) throw new IOException("Invalid native audio size");
            return Files.readAllBytes(output);
        } finally {
            if (process != null && process.isAlive()) process.destroyForcibly().waitFor(3, TimeUnit.SECONDS);
            Files.deleteIfExists(output);
            Files.deleteIfExists(input);
        }
    }

    @Override public void close() {
        closed = true;
        jobs.shutdownNow();
        if (previous == null) AvailableSites.TTS_SITES.remove(id(), this);
        else AvailableSites.TTS_SITES.replace(id(), this, previous);
    }
}
