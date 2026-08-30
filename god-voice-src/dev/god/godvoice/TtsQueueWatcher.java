package dev.god.godvoice;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import de.maxhenkel.voicechat.api.Entity;
import de.maxhenkel.voicechat.api.audiochannel.AudioPlayer;
import de.maxhenkel.voicechat.api.audiochannel.EntityAudioChannel;
import de.maxhenkel.voicechat.api.mp3.Mp3Decoder;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.LivingEntity;
import net.neoforged.neoforge.server.ServerLifecycleHooks;

import javax.sound.sampled.AudioFormat;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Comparator;
import java.util.UUID;

/**
 * 天音引擎：轮询 data/godvoice/tts-queue/*.json 任务。
 * 任务格式：{"id":"..","entity":"<实体UUID>","file":"<mp3路径>","text":".."}
 * 流程：领取任务（移出 queue 防重复消费）→ Mp3Decoder 解码 → 重采样到 48kHz
 * → EntityAudioChannel（跟随实体位置发声）→ AudioPlayer 播放 → 播完回执 .done。
 */
public final class TtsQueueWatcher {

    private static final int TARGET_RATE = 48000;

    private static final TtsQueueWatcher INSTANCE = new TtsQueueWatcher();

    public static TtsQueueWatcher get() {
        return INSTANCE;
    }

    private final File queueDir;
    private final File doneDir;
    private Thread worker;
    private volatile boolean running = false;

    private TtsQueueWatcher() {
        File base = new File("data", "godvoice");
        this.queueDir = new File(base, "tts-queue");
        this.doneDir = new File(base, "tts-queue" + File.separator + ".done");
    }

    public synchronized void start() {
        if (running) return;
        running = true;
        queueDir.mkdirs();
        doneDir.mkdirs();
        worker = new Thread(this::loop, "godvoice-tts-watcher");
        worker.setDaemon(true);
        worker.start();
        GodVoiceLog.info("TTS watcher started at " + queueDir.getAbsolutePath());
    }

    public synchronized void stop() {
        running = false;
        if (worker != null) {
            worker.interrupt();
            worker = null;
        }
    }

    private void loop() {
        while (running) {
            try {
                File[] jobs = queueDir.listFiles((d, n) -> n.toLowerCase().endsWith(".json"));
                if (jobs != null && jobs.length > 0) {
                    Arrays.sort(jobs, Comparator.comparingLong(File::lastModified));
                    for (File job : jobs) {
                        if (!running) break;
                        playJob(job);
                    }
                }
                Thread.sleep(300L);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            } catch (Throwable t) {
                GodVoiceLog.warn("tts loop error", t);
                try {
                    Thread.sleep(1000L);
                } catch (InterruptedException ie) {
                    return;
                }
            }
        }
    }

    private void playJob(File job) {
        // 先把任务移出 queue，避免播放期间被下一轮轮询重复消费
        File processing = new File(doneDir, job.getName() + ".processing");
        if (!job.renameTo(processing)) {
            GodVoiceLog.warn("cannot claim job " + job.getName() + ", skipping this round");
            return;
        }
        JsonObject spec;
        try {
            spec = new Gson().fromJson(Files.readString(processing.toPath(), StandardCharsets.UTF_8), JsonObject.class);
        } catch (IOException e) {
            GodVoiceLog.warn("bad job json " + job.getName() + ", skipping", e);
            processing.renameTo(new File(doneDir, job.getName() + ".bad"));
            return;
        }
        String id = spec.has("id") ? spec.get("id").getAsString() : job.getName();
        String entityUuid = spec.has("entity") ? spec.get("entity").getAsString() : null;
        String fileRel = spec.has("file") ? spec.get("file").getAsString() : null;
        if (entityUuid == null || fileRel == null) {
            GodVoiceLog.warn("job missing entity/file: " + job.getName());
            processing.renameTo(new File(doneDir, job.getName() + ".bad"));
            return;
        }

        File mp3 = new File(fileRel);
        // fileRel 为容器 CWD（/data）相对路径；绝对路径直接用。
        if (!mp3.isFile()) {
            GodVoiceLog.warn("mp3 missing: " + mp3 + " for job " + id);
            processing.renameTo(new File(doneDir, job.getName() + ".bad"));
            return;
        }

        LivingEntity vanilla = findEntity(UUID.fromString(entityUuid));
        if (vanilla == null) {
            GodVoiceLog.warn("entity offline: " + entityUuid + " for job " + id);
            processing.renameTo(new File(doneDir, job.getName() + ".bad"));
            return;
        }

        short[] pcm = decodeMp3(mp3);
        if (pcm == null || pcm.length == 0) {
            GodVoiceLog.warn("mp3 decode empty: " + mp3);
            processing.renameTo(new File(doneDir, job.getName() + ".bad"));
            return;
        }

        try {
            Entity e = GodVoicePlugin.SERVER_API.fromEntity(vanilla);
            UUID channelUuid = UUID.randomUUID();
            EntityAudioChannel channel = GodVoicePlugin.SERVER_API.createEntityAudioChannel(channelUuid, e);
            AudioPlayer player = GodVoicePlugin.SERVER_API.createAudioPlayer(
                    channel, GodVoicePlugin.SERVER_API.createEncoder(), pcm);
            player.setOnStopped(() -> {
                processing.renameTo(new File(doneDir, job.getName()));
                GodVoiceLog.info("tts done: " + id + " entity=" + vanilla.getName().getString()
                        + " samples=" + pcm.length);
            });
            player.startPlaying();
            GodVoiceLog.info("tts playing: " + id + " entity=" + vanilla.getName().getString()
                    + " samples=" + pcm.length);
        } catch (Throwable t) {
            GodVoiceLog.warn("playback failed for job " + id, t);
            processing.renameTo(new File(doneDir, job.getName() + ".bad"));
        }
    }

    /** 服务端全维度找实体（优先在线玩家）。 */
    private LivingEntity findEntity(UUID uuid) {
        MinecraftServer server = ServerLifecycleHooks.getCurrentServer();
        if (server == null) return null;
        LivingEntity found = null;
        for (ServerLevel level : server.getAllLevels()) {
            net.minecraft.world.entity.Entity e = level.getEntity(uuid);
            if (e instanceof LivingEntity le) {
                found = le;
                break;
            }
        }
        return found;
    }

    /**
     * 解码 mp3 → 重采样到 SVC 要求的 48kHz mono short[]。
     * SVC Mp3Decoder.decode() 单次调用即解全文件；edge-tts 输出 24kHz，需上采样。
     */
    static short[] decodeMp3(File mp3) {
        try (FileInputStream in = new FileInputStream(mp3)) {
            Mp3Decoder decoder = GodVoicePlugin.SERVER_API.createMp3Decoder(in);
            short[] raw = decoder.decode();
            if (raw == null || raw.length == 0) return new short[0];

            int srcRate;
            try {
                AudioFormat fmt = decoder.getAudioFormat();
                srcRate = (int) fmt.getSampleRate();
            } catch (Throwable t) {
                srcRate = TARGET_RATE;
            }
            if (srcRate == TARGET_RATE) return raw;
            return resample(raw, srcRate, TARGET_RATE);
        } catch (Throwable t) {
            GodVoiceLog.warn("mp3 decode failed: " + mp3, t);
            return null;
        }
    }

    /** 线性插值重采样（mono）。 */
    static short[] resample(short[] src, int srcRate, int dstRate) {
        if (srcRate <= 0 || dstRate <= 0 || src.length == 0) return src;
        long dstLenL = (long) src.length * dstRate / srcRate;
        int dstLen = (int) Math.min(dstLenL, Integer.MAX_VALUE - 1);
        short[] out = new short[dstLen];
        double ratio = (double) src.length / dstLen;
        for (int i = 0; i < dstLen; i++) {
            double pos = i * ratio;
            int i0 = (int) pos;
            int i1 = Math.min(i0 + 1, src.length - 1);
            double frac = pos - i0;
            double v = src[i0] * (1 - frac) + src[i1] * frac;
            long clamped = Math.round(v);
            if (clamped > Short.MAX_VALUE) clamped = Short.MAX_VALUE;
            if (clamped < Short.MIN_VALUE) clamped = Short.MIN_VALUE;
            out[i] = (short) clamped;
        }
        return out;
    }
}
