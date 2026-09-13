package dev.god.godvoice;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.UUID;

/** Uses a temporary directory only; verifies persisted fence and receipt contracts. */
public class SpeechContractTest {
    static int n;
    static void check(boolean value, String label) { n++; if (!value) throw new AssertionError(label); }
    interface Attempt { void run() throws Exception; }
    static void reject(Attempt action, String label) throws Exception {
        try { action.run(); } catch (IllegalArgumentException expected) { n++; return; }
        throw new AssertionError(label);
    }
    public static void main(String[] args) throws Exception {
        Path base = Files.createTempDirectory("godvoice-speech-test-");
        try {
            Path queue = Files.createDirectories(base.resolve("tts-queue"));
            Path done = Files.createDirectories(queue.resolve(".done"));
            Path audio = queue.resolve("utterance.mp3"); Files.write(audio, new byte[]{1}); // Metadata only, never decoded.
            Path claimed = done.resolve("utterance.json.processing");
            UUID actor = UUID.randomUUID();
            long now = System.currentTimeMillis();
            JsonObject row = new JsonObject();
            row.addProperty("schema", 2); row.addProperty("id", "utterance"); row.addProperty("entity", actor.toString());
            row.addProperty("file", audio.toString()); row.addProperty("text", "测试正文不进回执"); row.addProperty("voiceId", "kirito");
            row.addProperty("generation", 4); row.addProperty("createdAt", now - 1); row.addProperty("expiresAt", now + 90000);
            row.addProperty("dimension", "minecraft:overworld"); row.addProperty("scope", "nearby");
            Files.writeString(claimed, row.toString());
            SpeechJob job = SpeechJob.read(claimed, queue, now);
            check(job.schema() == 2 && job.radius() == 24 && job.voiceId().equals("kirito"), "schema two and role voice preserved");
            check(job.fence(base, now).equals("generation_unavailable"), "missing fence forbids playing");
            Path states = Files.createDirectories(base.resolve("speech-state")); Path state = states.resolve(actor + ".json");
            Files.writeString(state, "{\"schema\":1,\"entity\":\"" + actor + "\",\"generation\":4,\"updateAt\":" + now + "}");
            check(job.fence(base, now) == null, "matching generation accepts updateAt alias");
            check(job.fence(base, now + 90000).equals("expired"), "expiry wins even with matching fence");
            Files.writeString(state, "{\"schema\":1,\"entity\":\"" + actor + "\",\"generation\":5,\"updatedAt\":" + now + "}");
            check(job.fence(base, now).equals("generation_changed"), "late decode rejected after interrupt");
            Files.writeString(state, "{\"schema\":1,\"entity\":\"" + UUID.randomUUID() + "\",\"generation\":4}");
            check(job.fence(base, now).equals("generation_unavailable"), "fence cannot authorize another entity");
            Files.writeString(state, "{\"schema\":1,\"entity\":\"" + actor + "\",\"generation\":4.0}");
            check(job.fence(base, now).equals("generation_unavailable"), "fractional/coerced generations rejected");
            row.addProperty("scope", "recipient"); Files.writeString(claimed, row.toString());
            reject(() -> SpeechJob.read(claimed, queue, now), "recipient cannot become broadcast by omission");
            row.addProperty("recipientUuid", UUID.randomUUID().toString()); Files.writeString(claimed, row.toString());
            check(SpeechJob.read(claimed, queue, now).recipientUuid() != null, "explicit recipient accepted");
            row.addProperty("radius", 33); Files.writeString(claimed, row.toString());
            reject(() -> SpeechJob.read(claimed, queue, now), "oversized radius rejected");
            row.addProperty("radius", "24"); Files.writeString(claimed, row.toString());
            reject(() -> SpeechJob.read(claimed, queue, now), "string radius rejected");
            row.remove("radius"); row.addProperty("generation", "4"); Files.writeString(claimed, row.toString());
            reject(() -> SpeechJob.read(claimed, queue, now), "generation string rejected");
            row.addProperty("generation", 4); row.addProperty("schema", 4294967297L); Files.writeString(claimed, row.toString());
            reject(() -> SpeechJob.read(claimed, queue, now), "schema overflow cannot alias legacy");
            row.addProperty("schema", 2); row.addProperty("id", "other"); Files.writeString(claimed, row.toString());
            reject(() -> SpeechJob.read(claimed, queue, now), "id cannot impersonate another claimed file");
            row.addProperty("id", "utterance"); Path outside = base.resolve("utterance.mp3"); Files.write(outside, new byte[]{1});
            row.addProperty("file", outside.toString()); Files.writeString(claimed, row.toString());
            reject(() -> SpeechJob.read(claimed, queue, now), "audio outside queue rejected");
            row.addProperty("file", audio.toString()); row.remove("schema"); row.remove("dimension"); row.remove("generation");
            row.remove("createdAt"); row.remove("expiresAt"); Files.writeString(claimed, row.toString());
            SpeechJob legacy = SpeechJob.read(claimed, queue, now);
            check(legacy.schema() == 1 && legacy.fence(base, now) == null, "legacy files remain playable without generation state");
            Files.delete(audio);
            check(SpeechJob.read(claimed, queue, now).id().equals("utterance"), "missing audio keeps valid job identity for persistent decode_failed receipt");
            var receipts = new SpeechReceipts(base);
            receipts.write(job, "started", "audio_started", now, now);
            check(receipts.status(job.id()).equals("started"), "started is persistent, not completed");
            receipts.write(job, "cancelled", "generation_changed", now + 1, now);
            receipts.write(job, "completed", "late_callback", now + 2, now);
            check(receipts.status(job.id()).equals("cancelled"), "late completion cannot overwrite cancellation");
            String saved = Files.readString(base.resolve("speech-receipts/utterance.json"));
            check(!saved.contains("正文") && !saved.contains("text") && !saved.contains("file"), "receipt excludes speech content and path");
            var receipt = JsonParser.parseString(saved).getAsJsonObject();
            check(receipt.get("schema").getAsInt() == 2 && receipt.get("generation").getAsInt() == 4
                    && receipt.get("startedAt").getAsLong() == now, "receipt binds original generation and timing");
            System.out.println("{\"ok\":true,\"assertions\":" + n + "}");
        } finally {
            // A known, freshly-created temporary test directory only.
            try (var paths = Files.walk(base)) { for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path); }
        }
    }
}
