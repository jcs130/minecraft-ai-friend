package dev.god.godvoice;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.events.PlayerStateChangedEvent;
import de.maxhenkel.voicechat.api.opus.OpusDecoder;
import net.minecraft.server.level.ServerPlayer;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 天耳：捕获配置名单内玩家（默认 MengMeng）的游戏内语音，
 * 段落切分（1.2s 无包）后落盘 16kHz wav 到 data/godvoice/mic/inbox/
 * 供外部 ASR 管线识别 → 转成"她说的"进世界管道。
 */
public final class MicCapture {

    private static final long SEGMENT_SILENCE_MS = 1200L;
    private static final int SRC_RATE = 48000;
    private static final int DST_RATE = 16000;
    private static final int DOWN_FACTOR = SRC_RATE / DST_RATE;

    private static final MicCapture INSTANCE = new MicCapture();

    public static MicCapture get() {
        return INSTANCE;
    }

    private final File inboxDir;
    private final File config;
    private volatile List<String> listenNames = List.of("MengMeng");
    private Thread flusher;
    private volatile boolean running = false;

    // === 说话状态（只在 SVC 事件线程写，flusher 线程读快照） ===
    private UUID activeSpeaker;
    private String activeSpeakerName;
    private final List<Short> buffer = new ArrayList<>();
    private volatile long lastPacketAt = 0L;
    private OpusDecoder decoder;

    private MicCapture() {
        File base = new File("data", "godvoice");
        this.inboxDir = new File(base, "mic" + File.separator + "inbox");
        this.config = new File(base, "config.json");
    }

    public synchronized void start() {
        if (running) return;
        running = true;
        inboxDir.mkdirs();
        loadConfig();
        initDecoder();
        flusher = new Thread(this::flushLoop, "godvoice-mic-flusher");
        flusher.setDaemon(true);
        flusher.start();
        GodVoiceLog.info("Mic capture started, listening: " + listenNames);
    }

    private void initDecoder() {
        try {
            if (GodVoicePlugin.SERVER_API != null) {
                decoder = GodVoicePlugin.SERVER_API.createDecoder();
            }
        } catch (Throwable t) {
            GodVoiceLog.warn("opus decoder init failed", t);
        }
    }

    synchronized void stop() {
        running = false;
        if (flusher != null) {
            flusher.interrupt();
            flusher = null;
        }
    }

    private void loadConfig() {
        try {
            if (config.isFile()) {
                JsonObject o = new Gson().fromJson(Files.readString(config.toPath(), StandardCharsets.UTF_8), JsonObject.class);
                if (o.has("listen")) {
                    List<String> names = new ArrayList<>();
                    o.getAsJsonArray("listen").forEach(e -> names.add(e.getAsString()));
                    listenNames = List.copyOf(names);
                }
            } else {
                JsonObject o = new JsonObject();
                com.google.gson.JsonArray arr = new com.google.gson.JsonArray();
                arr.add("MengMeng");
                o.add("listen", arr);
                Files.writeString(config.toPath(), new Gson().toJson(o), StandardCharsets.UTF_8);
            }
        } catch (Throwable t) {
            GodVoiceLog.warn("config load failed, default listen=[MengMeng]", t);
        }
    }

    void onMicPacket(MicrophonePacketEvent e) {
        try {
            if (GodVoicePlugin.SERVER_API == null || decoder == null) return;
            de.maxhenkel.voicechat.api.VoicechatConnection sender = e.getSenderConnection();
            if (sender == null) return;
            de.maxhenkel.voicechat.api.ServerPlayer apiPlayer = sender.getPlayer();
            if (apiPlayer == null) return;

            // 只处理"投递给说话者本人"的那份，避免按接收者重复采集
            de.maxhenkel.voicechat.api.VoicechatConnection receiver = e.getReceiverConnection();
            if (receiver != null && receiver.getPlayer() != null) {
                if (!receiver.getPlayer().getUuid().equals(apiPlayer.getUuid())) return;
            }

            // 判定监听名单（vanilla 侧拿干净名）
            Object vanillaObj = apiPlayer.getPlayer();
            String name;
            if (vanillaObj instanceof ServerPlayer sp) {
                name = sp.getGameProfile().getName();
            } else {
                name = apiPlayer.getUuid().toString();
            }
            if (!listenNames.contains(name)) return;

            short[] pcm = decoder.decode(e.getPacket().getOpusEncodedData());
            if (pcm == null || pcm.length == 0) return;

            synchronized (this) {
                if (activeSpeaker == null) {
                    activeSpeaker = apiPlayer.getUuid();
                    activeSpeakerName = name;
                    buffer.clear();
                }
                for (short s : pcm) buffer.add(s);
                lastPacketAt = System.currentTimeMillis();
            }
        } catch (Throwable t) {
            GodVoiceLog.warn("mic packet failed", t);
        }
    }

    void onStateChanged(PlayerStateChangedEvent e) {
        // 掉线/关麦立即切段
        if (e.isDisconnected() || e.isDisabled()) {
            synchronized (this) {
                if (activeSpeaker != null && e.getPlayerUuid().equals(activeSpeaker)) {
                    snapshotSegment();
                }
            }
        }
    }

    private void flushLoop() {
        while (running) {
            try {
                Thread.sleep(200L);
                synchronized (this) {
                    if (activeSpeaker != null
                            && lastPacketAt > 0
                            && System.currentTimeMillis() - lastPacketAt > SEGMENT_SILENCE_MS) {
                        snapshotSegment();
                    }
                }
            } catch (InterruptedException ie) {
                return;
            } catch (Throwable t) {
                GodVoiceLog.warn("flush loop error", t);
            }
        }
    }

    /** 取当前 buffer 成段（在锁内调用），转 16k 后入落盘队列。 */
    private void snapshotSegment() {
        if (buffer.isEmpty()) {
            activeSpeaker = null;
            activeSpeakerName = null;
            return;
        }
        short[] segment = new short[buffer.size()];
        for (int i = 0; i < segment.length; i++) segment[i] = buffer.get(i);
        buffer.clear();
        String name = activeSpeakerName;
        activeSpeaker = null;
        activeSpeakerName = null;
        writeSegment(segment, name);
    }

    private void writeSegment(short[] segment, String name) {
        short[] down = downsample(segment);
        try {
            long ts = System.currentTimeMillis();
            File wav = new File(inboxDir, ts + ".wav");
            File meta = new File(inboxDir, ts + ".txt");
            WavWriter.write16kMono(wav, down);
            Files.writeString(meta.toPath(),
                    "{\"player\":\"" + name + "\",\"ts\":" + ts + ",\"samples\":" + down.length + "}",
                    StandardCharsets.UTF_8);
            GodVoiceLog.info("segment saved: " + wav.getName() + " player=" + name
                    + " (" + (down.length / DST_RATE) + "s)");
        } catch (Throwable t) {
            GodVoiceLog.warn("segment write failed", t);
        }
    }

    static short[] downsample(short[] src) {
        int n = src.length / DOWN_FACTOR;
        short[] out = new short[n];
        for (int i = 0; i < n; i++) {
            out[i] = src[i * DOWN_FACTOR];
        }
        return out;
    }

    /** 最简 PCM16 mono wav 写入器。 */
    static final class WavWriter {
        static void write16kMono(File f, short[] pcm) throws IOException {
            int dataLen = pcm.length * 2;
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write("RIFF".getBytes(StandardCharsets.US_ASCII));
                writeLe32(out, 36 + dataLen);
                out.write("WAVE".getBytes(StandardCharsets.US_ASCII));
                out.write("fmt ".getBytes(StandardCharsets.US_ASCII));
                writeLe32(out, 16);
                writeLe16(out, 1);            // PCM
                writeLe16(out, 1);            // mono
                writeLe32(out, DST_RATE);     // sample rate
                writeLe32(out, DST_RATE * 2); // byte rate
                writeLe16(out, 2);            // block align
                writeLe16(out, 16);           // bits
                out.write("data".getBytes(StandardCharsets.US_ASCII));
                writeLe32(out, dataLen);
                for (short s : pcm) {
                    writeLe16(out, s & 0xFFFF);
                }
            }
        }

        private static void writeLe32(FileOutputStream o, int v) throws IOException {
            o.write(v & 0xFF);
            o.write((v >> 8) & 0xFF);
            o.write((v >> 16) & 0xFF);
            o.write((v >> 24) & 0xFF);
        }

        private static void writeLe16(FileOutputStream o, int v) throws IOException {
            o.write(v & 0xFF);
            o.write((v >> 8) & 0xFF);
        }
    }
}
