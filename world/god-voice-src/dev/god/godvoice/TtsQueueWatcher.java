package dev.god.godvoice;

import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.audiochannel.AudioPlayer;
import de.maxhenkel.voicechat.api.audiochannel.EntityAudioChannel;
import de.maxhenkel.voicechat.api.mp3.Mp3Decoder;
import de.maxhenkel.voicechat.api.opus.OpusEncoder;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.neoforged.neoforge.server.ServerLifecycleHooks;
import javax.sound.sampled.AudioFormat;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Disk delivery and decoding run off-thread; entity, audience and playback lifecycle run on MC. */
public final class TtsQueueWatcher {
    private static final int TARGET_RATE = 48000;
    private static final TtsQueueWatcher INSTANCE = new TtsQueueWatcher();
    public static TtsQueueWatcher get() { return INSTANCE; }
    private final Path base = Path.of("data", "godvoice").toAbsolutePath().normalize();
    private final Path queue = base.resolve("tts-queue");
    private final Path done = queue.resolve(".done");
    private final SpeechReceipts receipts = new SpeechReceipts(base);
    // All lane and caption mutations occur on the Minecraft server thread.
    private final Map<UUID, SpeechLane<SpeechJob>> lanes = new HashMap<>();
    private final Map<UUID, String> captions = new HashMap<>();
    private final ConcurrentHashMap<UUID, Playback> active = new ConcurrentHashMap<>();
    private final AtomicBoolean tickQueued = new AtomicBoolean();
    private volatile boolean running;
    private volatile long runId;
    private Thread worker;
    private ThreadPoolExecutor decoders;

    private static final class Playback {
        final SpeechJob job;
        final long run;
        final long decodeStartedAt = System.currentTimeMillis();
        String dimension;
        String name;
        volatile AudioPlayer player;
        OpusEncoder encoder;
        EntityAudioChannel channel;
        volatile SpeechFrames frames;
        final AtomicReference<String> externalStop = new AtomicReference<>();
        volatile Set<UUID> audience = Set.of();
        final Set<UUID> captioned = new HashSet<>();
        volatile boolean stoppedCallback;
        String stopStatus;
        String stopCode;
        Long startedAt;
        long lastCaptionAt;
        Playback(SpeechJob job, long run) { this.job = job; this.run = run; }
    }
    private TtsQueueWatcher() {}

    public synchronized void start() {
        if (running) return;
        try { Files.createDirectories(done); }
        catch (IOException error) { GodVoiceLog.warn("speech queue unavailable", error); return; }
        running = true;
        long epoch = ++runId;
        decoders = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(16), task -> {
            Thread thread = new Thread(task, "godvoice-mp3-decoder"); thread.setDaemon(true); return thread;
        }, new ThreadPoolExecutor.AbortPolicy());
        SpeechHealth health = new SpeechHealth();
        worker = new Thread(() -> loop(epoch, health), "godvoice-tts-watcher");
        worker.setDaemon(true); worker.start();
        GodVoiceLog.info("speech schema 2 watcher started; per entity: one player + four waiting");
    }
    public synchronized void stop() {
        running = false;
        if (worker != null) { worker.interrupt(); worker = null; }
        if (decoders != null) decoders.shutdownNow();
        // Stop the audio thread immediately, even when SVC stops off the Minecraft thread.
        for (Playback playback : active.values()) {
            playback.externalStop.compareAndSet(null, "server_stopped");
            playback.audience = Set.of();
            if (playback.frames != null) playback.frames.cancel();
            if (playback.player != null) playback.player.stopPlaying();
        }
        MinecraftServer server = ServerLifecycleHooks.getCurrentServer();
        if (server != null) {
            Runnable cleanup = () -> {
                for (Playback playback : new ArrayList<>(active.values())) requestStop(server, playback, "cancelled", "server_stopped");
                for (var lane : lanes.values()) for (SpeechJob job : lane.removeWaiting(row -> true))
                    terminal(job, "cancelled", "server_stopped", null);
            };
            if (server.isSameThread()) cleanup.run(); else server.execute(cleanup);
        }
    }

    private void loop(long epoch, SpeechHealth health) {
        boolean recovery = true;
        while (running && runId == epoch) {
            try {
                // Disk generations and TTL need no Minecraft entity access. They can silence a
                // stale stream even when the main thread is temporarily busy or a decode is slow.
                for (Playback playback : active.values()) {
                    String invalid = playback.job.fence(base, System.currentTimeMillis());
                    if (invalid != null && playback.externalStop.compareAndSet(null, invalid)) {
                        playback.audience = Set.of();
                        if (playback.frames != null) playback.frames.cancel();
                        if (playback.player != null) playback.player.stopPlaying();
                    }
                }
                MinecraftServer server = ServerLifecycleHooks.getCurrentServer();
                if (server != null && tickQueued.compareAndSet(false, true)) {
                    // A stalled MC tick cannot build an unbounded backlog of claimed jobs/tasks.
                    List<SpeechJob> claimed = scan(recovery);
                    recovery = false;
                    server.execute(() -> {
                        try {
                            if (!running || runId != epoch) {
                                for (SpeechJob job : claimed) terminal(job, "cancelled", "server_stopped", null);
                                return;
                            }
                            tick(server, claimed, epoch, health);
                        } catch (Exception error) { GodVoiceLog.warn("speech main-thread tick failed", error); }
                        finally { tickQueued.set(false); }
                    });
                }
                // Health IO stays on this existing disk watcher, never on the MC tick.
                // Its capacity-one sample cannot accumulate work during a slow filesystem.
                if (running && runId == epoch) {
                    try {
                        health.flush(epoch, System.currentTimeMillis(), sample ->
                                SpeechHealth.writeAtomic(base, sample, () -> running && runId == epoch));
                    } catch (IOException error) { GodVoiceLog.warn("speech heartbeat write failed", error); }
                }
                Thread.sleep(200);
            } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return; }
            catch (Exception error) {
                tickQueued.set(false);
                GodVoiceLog.warn("speech delivery loop failed", error);
                try { Thread.sleep(1000); } catch (InterruptedException stopped) { return; }
            }
        }
    }
    private List<SpeechJob> scan(boolean recovery) throws IOException {
        if (recovery) {
            // An interrupted process may have sent audio. Never replay its .processing file.
            try (var files = Files.list(done)) {
                for (Path path : files.filter(p -> p.getFileName().toString().endsWith(".json.processing")).toList()) {
                    try { terminal(SpeechJob.read(path, queue, System.currentTimeMillis()), "cancelled", "interrupted_restart", null); }
                    catch (Exception bad) { quarantine(path, "invalid"); }
                }
            }
        }
        var result = new ArrayList<SpeechJob>();
        try (var files = Files.list(queue)) {
            for (Path path : files.filter(p -> p.getFileName().toString().endsWith(".json"))
                    .sorted().limit(64).toList()) {
                Path claimed = done.resolve(path.getFileName() + ".processing");
                boolean owned = false;
                try {
                    if (Files.isSymbolicLink(path) || !Files.isRegularFile(path)) { quarantine(path, "invalid"); continue; }
                    if (Files.exists(claimed)) { quarantine(path, "duplicate"); continue; }
                    Files.move(path, claimed); // No replacement: collisions are never replayed.
                    owned = true;
                    SpeechJob job = SpeechJob.read(claimed, queue, System.currentTimeMillis());
                    String previous = receipts.status(job.id());
                    if (previous != null && (previous.equals("started") || SpeechReceipts.TERMINAL.contains(previous))) {
                        if (previous.equals("started")) terminal(job, "cancelled", "interrupted_restart", null);
                        else quarantine(claimed, "duplicate");
                    } else result.add(job);
                } catch (Exception bad) {
                    GodVoiceLog.warn("invalid speech delivery: " + path.getFileName() + " (" + bad.getClass().getSimpleName() + ")");
                    if (owned && Files.exists(claimed)) quarantine(claimed, "invalid");
                }
            }
        }
        result.sort(Comparator.comparingLong(SpeechJob::createdAt).thenComparing(SpeechJob::id));
        return result;
    }

    private void tick(MinecraftServer server, List<SpeechJob> incoming, long epoch, SpeechHealth health) {
        if (!server.isSameThread()) throw new IllegalStateException("speech world access requires Minecraft thread");
        long now = System.currentTimeMillis();
        for (SpeechJob job : incoming) {
            String invalid = job.fence(base, now);
            if (invalid != null) { terminal(job, statusFor(invalid), invalid, null); continue; }
            var lane = lanes.computeIfAbsent(job.entity(), key -> new SpeechLane<>());
            String offered = lane.offer(job);
            if (!offered.equals("queued")) terminal(job, "cancelled", offered, null);
            // Reserve the earliest job immediately: a fresh lane can accept 1 current + 4 waiting.
            else if (lane.current() == null) lane.begin();
        }
        for (var entry : new ArrayList<>(lanes.entrySet())) {
            var lane = entry.getValue();
            for (SpeechJob job : lane.removeWaiting(row -> row.fence(base, now) != null)) {
                String code = job.fence(base, now);
                terminal(job, statusFor(code), code == null ? "generation_changed" : code, null);
            }
            Playback playback = active.get(entry.getKey());
            if (playback != null) {
                LivingEntity entity = findEntity(server, playback.job.entity());
                String invalid = invalid(playback, entity, now);
                if (invalid != null && playback.stopStatus == null) requestStop(server, playback, statusFor(invalid), invalid);
                if (playback.player != null) {
                    if (playback.stopStatus == null && playback.channel.isClosed()) requestStop(server, playback, "failed", "channel_closed");
                    if (playback.stopStatus == null && entity != null) updateAudience(server, playback, entity);
                    if (playback.player.isStopped()) {
                        String status = playback.stopStatus != null ? playback.stopStatus
                                : playback.stoppedCallback && playback.frames.completed() ? "completed" : "failed";
                        String code = playback.stopCode != null ? playback.stopCode : status.equals("completed") ? "audio_completed" : "audio_thread_failed";
                        finish(server, playback, status, code);
                    }
                } else if (playback.stopStatus != null) finish(server, playback, playback.stopStatus, playback.stopCode);
                else if (now - playback.decodeStartedAt > 30000) finish(server, playback, "failed", "decode_timeout");
            }
            // Do not release a playing/draining player until SVC confirms it stopped.
            if (active.containsKey(entry.getKey())) continue;
            SpeechJob next = lane.begin();
            if (next == null) { lanes.remove(entry.getKey()); continue; }
            Playback selected = new Playback(next, epoch);
            active.put(entry.getKey(), selected);
            LivingEntity entity = findEntity(server, next.entity());
            selected.dimension = entity == null ? null : dimension(entity);
            selected.name = entity == null ? "" : cleanName(entity.getName().getString());
            String invalid = invalid(selected, entity, System.currentTimeMillis());
            if (invalid != null) { finish(server, selected, statusFor(invalid), invalid); continue; }
            try {
                decoders.execute(() -> {
                    short[] pcm = decodeMp3(next.file().toFile());
                    server.execute(() -> decoded(server, selected, pcm));
                });
            } catch (RuntimeException rejected) { finish(server, selected, "failed", "decoder_busy"); }
        }
        health.publish(epoch, now, active.size(), lanes.values().stream().mapToInt(SpeechLane::waitingCount).sum());
    }
    private String invalid(Playback playback, LivingEntity entity, long now) {
        if (playback.externalStop.get() != null) return playback.externalStop.get();
        String fence = playback.job.fence(base, now);
        if (fence != null) return fence;
        if (!running || playback.run != runId || !GodVoicePlugin.serverUp) return "server_stopped";
        if (entity == null || entity.isRemoved() || !entity.isAlive()) return "entity_unloaded";
        String actual = dimension(entity);
        if ((playback.job.schema() == 2 && !actual.equals(playback.job.dimension()))
                || (playback.dimension != null && !actual.equals(playback.dimension))) return "dimension_changed";
        return null;
    }
    private void decoded(MinecraftServer server, Playback playback, short[] pcm) {
        if (active.get(playback.job.entity()) != playback) return; // Cancelled decode result is inert.
        LivingEntity entity = findEntity(server, playback.job.entity());
        String invalid = invalid(playback, entity, System.currentTimeMillis());
        if (invalid != null) { finish(server, playback, statusFor(invalid), invalid); return; }
        if (pcm == null || pcm.length == 0) { finish(server, playback, "failed", "decode_failed"); return; }
        try {
            playback.channel = GodVoicePlugin.SERVER_API.createEntityAudioChannel(UUID.randomUUID(), GodVoicePlugin.SERVER_API.fromEntity(entity));
            playback.channel.setDistance(playback.job.radius());
            // SVC invokes this on its audio thread: read only a volatile immutable UUID set.
            playback.channel.setFilter(player -> playback.audience.contains(player.getUuid()));
            updateAudience(server, playback, entity);
            if (playback.audience.isEmpty()) { finish(server, playback, "failed", "no_voicechat_listeners"); return; }
            playback.frames = new SpeechFrames(pcm);
            playback.encoder = GodVoicePlugin.SERVER_API.createEncoder();
            playback.player = GodVoicePlugin.SERVER_API.createAudioPlayer(playback.channel, playback.encoder, playback.frames);
            playback.player.setOnStopped(() -> playback.stoppedCallback = true);
            // Read the fence after decoding and channel setup, just before sending any audio.
            invalid = invalid(playback, entity, System.currentTimeMillis());
            if (invalid != null) { requestStop(server, playback, statusFor(invalid), invalid); return; }
            playback.player.startPlaying();
            playback.startedAt = System.currentTimeMillis();
            receipts.write(playback.job, "started", "audio_started", playback.startedAt, playback.startedAt);
            showCaptions(server, playback);
            GodVoiceLog.info("speech started id=" + playback.job.id() + " entity=" + playback.job.entity());
        } catch (Exception error) {
            GodVoiceLog.warn("speech playback failed id=" + playback.job.id(), error);
            requestStop(server, playback, "failed", "playback_failed");
        }
    }
    private void requestStop(MinecraftServer server, Playback playback, String status, String code) {
        if (playback.stopStatus != null) return;
        playback.stopStatus = status; playback.stopCode = code;
        playback.audience = Set.of();
        if (playback.frames != null) playback.frames.cancel();
        if (playback.player != null && playback.player.isStarted() && !playback.player.isStopped()) {
            playback.player.stopPlaying();
            // Native stop is interrupt-only. Keep the lane occupied until isStopped() is true.
            endCaptions(server, playback, status);
            // Persist the explicit cancellation even if the server stops ticking during shutdown.
            terminal(playback.job, status, code, playback.startedAt);
        } else finish(server, playback, status, code);
    }
    private void finish(MinecraftServer server, Playback playback, String status, String code) {
        if (active.get(playback.job.entity()) != playback) return;
        if (playback.player != null && playback.player.isStarted() && !playback.player.isStopped()) {
            requestStop(server, playback, status, code); return;
        }
        playback.audience = Set.of();
        try { if (playback.encoder != null && !playback.encoder.isClosed()) playback.encoder.close(); }
        catch (RuntimeException error) { GodVoiceLog.warn("speech encoder cleanup failed", error); }
        endCaptions(server, playback, status);
        terminal(playback.job, status, code, playback.startedAt);
        active.remove(playback.job.entity(), playback);
        var lane = lanes.get(playback.job.entity());
        if (lane != null) lane.finish(playback.job);
    }
    private void updateAudience(MinecraftServer server, Playback playback, LivingEntity entity) {
        var allowed = new HashSet<UUID>();
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player.level() != entity.level() || player.distanceToSqr(entity) > playback.job.radius() * playback.job.radius()) continue;
            if (playback.job.scope().equals("recipient") && !player.getUUID().equals(playback.job.recipientUuid())) continue;
            VoicechatConnection connection = GodVoicePlugin.SERVER_API.getConnectionOf(player.getUUID());
            if (connection != null && connection.isInstalled() && connection.isConnected() && !connection.isDisabled()) allowed.add(player.getUUID());
        }
        playback.audience = Set.copyOf(allowed);
        if (playback.startedAt != null) showCaptions(server, playback);
    }
    private void showCaptions(MinecraftServer server, Playback playback) {
        long now = System.currentTimeMillis();
        boolean sent = false;
        for (UUID id : playback.audience) {
            boolean first = playback.captioned.add(id);
            if (!first && (now - playback.lastCaptionAt < 2000 || !playback.job.id().equals(captions.get(id)))) continue;
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            if (player != null) {
                player.displayClientMessage(Component.literal(playback.name + "：" + playback.job.text()), true);
                captions.put(id, playback.job.id());
                sent = true;
            }
        }
        if (sent) playback.lastCaptionAt = now;
    }
    private void endCaptions(MinecraftServer server, Playback playback, String status) {
        for (UUID id : playback.captioned) {
            if (!playback.job.id().equals(captions.get(id))) continue;
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            if (player != null) player.displayClientMessage(Component.literal(playback.name + (status.equals("completed") ? " · 说完了" : " · 语音已停止")), true);
            captions.remove(id);
        }
    }
    private void terminal(SpeechJob job, String status, String code, Long startedAt) {
        try {
            receipts.write(job, status, code, System.currentTimeMillis(), startedAt);
            Path target = done.resolve(job.id() + ".json" + (status.equals("completed") ? "" : "." + status));
            if (Files.exists(job.claimed())) Files.move(job.claimed(), target, StandardCopyOption.REPLACE_EXISTING);
            GodVoiceLog.info("speech " + status + " id=" + job.id() + " code=" + code);
        } catch (IOException error) { GodVoiceLog.warn("speech receipt persistence failed id=" + job.id(), error); }
    }
    private void quarantine(Path path, String reason) {
        try { Files.move(path, done.resolve(path.getFileName() + "." + reason), StandardCopyOption.REPLACE_EXISTING); }
        catch (IOException error) { GodVoiceLog.warn("speech quarantine failed", error); }
    }
    private static String statusFor(String code) { return "expired".equals(code) ? "expired" : "cancelled"; }
    private static String dimension(LivingEntity entity) { return entity.level().dimension().location().toString(); }
    private static String cleanName(String text) { String result = text.replaceAll("[\\p{Cntrl}§]", " ").strip(); return result.substring(0, Math.min(80, result.length())); }
    private static LivingEntity findEntity(MinecraftServer server, UUID uuid) {
        if (!server.isSameThread()) throw new IllegalStateException("entity lookup off server thread");
        for (ServerLevel level : server.getAllLevels()) {
            var entity = level.getEntity(uuid);
            if (entity instanceof LivingEntity living) return living;
        }
        return null;
    }
    /** Decoding and resampling are bounded, and never access a Minecraft entity. */
    static short[] decodeMp3(File mp3) {
        if (!mp3.isFile() || mp3.length() <= 0 || mp3.length() > SpeechJob.MAX_AUDIO_BYTES) return null;
        try (FileInputStream in = new FileInputStream(mp3)) {
            Mp3Decoder decoder = GodVoicePlugin.SERVER_API.createMp3Decoder(in);
            short[] raw = decoder.decode();
            AudioFormat format = decoder.getAudioFormat();
            int rate = Math.round(format.getSampleRate()), channels = format.getChannels();
            if (raw == null || raw.length == 0 || rate < 8000 || rate > 192000 || channels < 1 || channels > 2
                    || raw.length % channels != 0 || raw.length / channels > (long) rate * SpeechJob.MAX_SECONDS) return null;
            if (channels == 2) {
                short[] mono = new short[raw.length / 2];
                for (int i = 0; i < mono.length; i++) mono[i] = (short) (((int) raw[i * 2] + raw[i * 2 + 1]) / 2);
                raw = mono;
            }
            return rate == TARGET_RATE ? raw : resample(raw, rate, TARGET_RATE);
        } catch (Exception error) { GodVoiceLog.warn("speech MP3 decode failed", error); return null; }
    }
    static short[] resample(short[] src, int srcRate, int dstRate) {
        if (srcRate <= 0 || dstRate <= 0 || src.length == 0) return new short[0];
        int length = (int) Math.min((long) src.length * dstRate / srcRate, (long) TARGET_RATE * SpeechJob.MAX_SECONDS);
        short[] out = new short[length];
        double ratio = (double) src.length / length;
        for (int i = 0; i < length; i++) {
            double position = i * ratio;
            int left = (int) position, right = Math.min(left + 1, src.length - 1);
            double fraction = position - left;
            out[i] = (short) Math.round(src[left] * (1 - fraction) + src[right] * fraction);
        }
        return out;
    }
}
