package org.qiandengji.villagerquests.core;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * The bridge's MVP file transport (intake.py / feedback.py), seen from the Bukkit side:
 * <ul>
 *   <li>{@code inbox/<commissionId>.json}: one commission per file, written to {@code *.json.tmp} then atomically renamed;</li>
 *   <li>{@code signals.jsonl}: append-only server evidence, one complete line per write, fsynced;</li>
 *   <li>{@code outbox.jsonl}: append-only feedback from the bridge, read incrementally (partial last line is left for later).</li>
 * </ul>
 * Plain {@code java.nio}; callers run these off the main thread.
 */
public final class Spool {
    private static final Gson GSON = new Gson();
    public static final int MAX_OUTBOX_READ = 256 * 1024;

    public final Path root, inbox, signals, outbox;

    public Spool(Path root) {
        this.root = root;
        this.inbox = root.resolve("inbox");
        this.signals = root.resolve("signals.jsonl");
        this.outbox = root.resolve("outbox.jsonl");
    }

    /** Returns false if a file for this commission is already in the inbox (the bridge dedupes by id anyway). */
    public boolean writeCommission(Commission c) throws IOException {
        Files.createDirectories(inbox);
        Path target = inbox.resolve(c.commissionId() + ".json");
        if (Files.exists(target)) return false;
        Path tmp = inbox.resolve(c.commissionId() + ".json.tmp");
        byte[] bytes = GSON.toJson(c.toWire()).getBytes(StandardCharsets.UTF_8);
        try (FileChannel ch = FileChannel.open(tmp, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
            ch.write(ByteBuffer.wrap(bytes));
            ch.force(true);
        }
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
        return true;
    }

    /** Bridge {@code QuestSignal} for one piece of hero evidence. */
    public static JsonObject signal(Board.Evidence e, int count) {
        JsonObject o = new JsonObject();
        o.addProperty("signalId", e.id());
        o.addProperty("kind", e.kind() == Board.EvidenceKind.KILL ? "mob_kill" : "item_delivered");
        o.addProperty("actor", e.actor());
        o.addProperty("target", e.target());
        o.addProperty("count", Math.max(1, Math.min(64, count)));
        if (e.kind() == Board.EvidenceKind.KILL) {
            JsonObject p = new JsonObject();
            p.addProperty("x", e.x());
            p.addProperty("y", e.y());
            p.addProperty("z", e.z());
            o.add("position", p);
        }
        if (e.recipient() != null) o.addProperty("recipient", e.recipient());
        o.addProperty("at", Instant.ofEpochMilli(e.at()).toString());
        return o;
    }

    public void appendSignal(JsonObject signal) throws IOException {
        Files.createDirectories(root);
        byte[] line = (GSON.toJson(signal) + "\n").getBytes(StandardCharsets.UTF_8);
        try (FileChannel ch = FileChannel.open(signals, StandardOpenOption.CREATE, StandardOpenOption.APPEND, StandardOpenOption.WRITE)) {
            ByteBuffer buf = ByteBuffer.wrap(line);
            while (buf.hasRemaining()) ch.write(buf);
            ch.force(true);
        }
    }

    /** One bridge {@code Feedback} line. Text is cleaned here; the reward amount in the line is deliberately not read. */
    public record OutboxLine(String questId, String villager, String npcId, String kind, String text,
                             String grantKey, String recipientAgent, String recipientBody) {}

    public record Batch(List<OutboxLine> lines, long offset, int bad) {}

    /** Reads complete lines after {@code offset}. A file shorter than the offset was rotated: start again at 0. */
    public Batch readOutbox(long offset) throws IOException {
        List<OutboxLine> out = new ArrayList<>();
        if (!Files.exists(outbox)) return new Batch(out, offset, 0);
        int bad = 0;
        try (RandomAccessFile f = new RandomAccessFile(outbox.toFile(), "r")) {
            long size = f.length();
            if (size < offset) offset = 0;
            int len = (int) Math.min(MAX_OUTBOX_READ, size - offset);
            byte[] buf = new byte[len];
            f.seek(offset);
            f.readFully(buf);
            int start = 0;
            for (int i = 0; i < len; i++) {
                if (buf[i] != '\n') continue;
                String line = new String(buf, start, i - start, StandardCharsets.UTF_8).strip();
                start = i + 1;
                if (line.isEmpty()) continue;
                OutboxLine parsed = parseOutbox(line);
                if (parsed == null) bad++; else out.add(parsed);
            }
            if (start == 0 && len == MAX_OUTBOX_READ) { // one line longer than the read window: skip it
                return new Batch(out, offset + len, bad + 1);
            }
            return new Batch(out, offset + start, bad);
        }
    }

    public static OutboxLine parseOutbox(String line) {
        try {
            JsonObject o = JsonParser.parseString(line).getAsJsonObject();
            String questId = o.get("questId").getAsString(), villager = o.get("villager").getAsString(), kind = o.get("kind").getAsString();
            if (!questId.matches("^vq_[0-9a-f]{16}$") || !Commission.LOCAL_ID.matcher(villager).matches() || !kind.matches("^[a-z_]{1,20}$")) return null;
            String npcId = o.has("npcId") && !o.get("npcId").isJsonNull() ? Text.clean(o.get("npcId").getAsString(), 64) : null;
            String text = o.has("text") ? Text.clean(o.get("text").getAsString(), 200) : "";
            String key = null, agent = null, body = null;
            if (o.has("rewardGrant") && o.get("rewardGrant").isJsonObject()) {
                JsonObject g = o.getAsJsonObject("rewardGrant");
                key = g.has("idempotencyKey") ? Text.clean(g.get("idempotencyKey").getAsString(), 80) : null;
                agent = g.has("recipientAgent") ? Text.clean(g.get("recipientAgent").getAsString(), 64) : null;
                body = g.has("recipientBody") && !g.get("recipientBody").isJsonNull() ? Text.clean(g.get("recipientBody").getAsString(), 64) : null;
            }
            return new OutboxLine(questId, villager, npcId, kind, text, key, agent, body);
        } catch (RuntimeException e) {
            return null;
        }
    }
}
