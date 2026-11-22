package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** Real persistence in a caller-supplied temporary directory; no Bukkit, network or audio. */
public final class NpcVoiceEnvelopeTest {
    private static final UUID MAID = UUID.fromString("10000000-0000-0000-0000-000000000011");
    private static final UUID OTHER_MAID = UUID.fromString("10000000-0000-0000-0000-000000000012");
    private static final UUID SPEAKER = UUID.fromString("20000000-0000-0000-0000-000000000021");
    private static final UUID OTHER_SPEAKER = UUID.fromString("20000000-0000-0000-0000-000000000022");
    private static final UUID WORLD = UUID.fromString("30000000-0000-0000-0000-000000000031");
    private static final UUID OTHER_WORLD = UUID.fromString("30000000-0000-0000-0000-000000000032");
    private static final String KEY = "minecraft:overworld", EVENT = "qdvoice:" + SPEAKER + ":voice_test";
    private static final long NOW = 200_000;
    private static int checks;
    private static void check(boolean yes, String reason) {
        checks++;
        if (!yes) throw new AssertionError(reason);
    }
    @FunctionalInterface private interface Attempt { void run() throws Exception; }
    private static void refused(Attempt attempt, String reason) throws Exception {
        boolean denied = false;
        try { attempt.run(); } catch (IOException expected) { denied = true; }
        check(denied, reason);
    }
    private static JsonObject envelope(UUID maid, String event) {
        JsonObject row = new JsonObject();
        row.addProperty("schema", 1); row.addProperty("eventId", event); row.addProperty("listenerId", maid.toString());
        row.addProperty("speakerId", SPEAKER.toString()); row.addProperty("speaker", "SyntheticSpeaker");
        row.addProperty("channel", "voice"); row.addProperty("occurredAt", NOW - 5000); row.addProperty("receivedAt", NOW);
        row.addProperty("deliveryScope", "nearby"); row.addProperty("world", KEY); row.addProperty("worldId", WORLD.toString());
        row.addProperty("trusted", false);
        return row;
    }
    private static JsonObject validate(JsonObject row, long now) {
        return NpcVoiceEnvelopeStore.validate(MAID, SPEAKER, EVENT, row.toString(), KEY, WORLD, KEY, WORLD, now);
    }
    private static JsonObject snapshot(UUID maid, UUID sender, String event) {
        JsonObject root = new JsonObject(), message = new JsonObject();
        root.addProperty("maidId", maid.toString());
        message.addProperty("eventId", event); message.addProperty("senderUuid", sender.toString());
        message.addProperty("senderName", "OriginalSender"); message.addProperty("text", "original inbox text");
        message.addProperty("receivedAt", "2026-11-23T00:00:00Z");
        JsonArray messages = new JsonArray(); messages.add(message); root.add("messages", messages);
        return root;
    }
    private static JsonObject message(JsonObject snapshot) { return snapshot.getAsJsonArray("messages").get(0).getAsJsonObject(); }

    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[0]);
        NpcVoiceEnvelopeStore store = new NpcVoiceEnvelopeStore(directory);
        JsonObject input = envelope(MAID, EVENT);
        input.addProperty("text", "must-not-be-persisted"); input.addProperty("tokens", "synthetic-secret-not-stored");
        input.addProperty("audio", "synthetic-audio-not-stored");
        JsonObject validated = validate(input, NOW);
        check(validated != null, "fresh original envelope rejected");
        store.put(MAID, validated);
        Path file = directory.resolve(MAID + ".json");
        byte[] committed = Files.readAllBytes(file);
        String disk = Files.readString(file);
        check(!disk.contains("must-not-be-persisted") && !disk.contains("tokens") && !disk.contains("audio") && !disk.contains("\"text\""),
            "payload or tokens copied into metadata");
        check(JsonParser.parseString(disk).getAsJsonObject().get("schema").getAsInt() == 1, "missing disk schema");
        check(store.get(OTHER_MAID, EVENT, SPEAKER) == null, "metadata leaked across maid");
        check(store.get(MAID, EVENT, OTHER_SPEAKER) == null, "metadata leaked across speaker");
        NpcVoiceEnvelopeStore restarted = new NpcVoiceEnvelopeStore(directory);
        check(restarted.get(MAID, EVENT, SPEAKER).equals(validated), "restart lost committed metadata");
        JsonObject retrieved = restarted.get(MAID, EVENT, SPEAKER);
        retrieved.addProperty("occurredAt", 0);
        check(restarted.get(MAID, EVENT, SPEAKER).get("occurredAt").getAsLong() == NOW - 5000, "returned metadata mutable");
        JsonObject retry = envelope(MAID, EVENT); retry.addProperty("receivedAt", NOW + 10);
        check(validate(retry, NOW + 10) != null, "fresh explicit retry rejected");
        restarted.put(MAID, retry);
        check(Arrays.equals(committed, Files.readAllBytes(file)), "retry rewrote original time or metadata");
        for (String field : List.of("world", "worldId", "speaker", "occurredAt", "channel")) {
            JsonObject conflict = envelope(MAID, EVENT);
            switch (field) {
                case "world" -> conflict.addProperty(field, "minecraft:the_nether");
                case "worldId" -> conflict.addProperty(field, OTHER_WORLD.toString());
                case "speaker" -> conflict.addProperty(field, "AnotherSpeakerName");
                case "occurredAt" -> conflict.addProperty(field, NOW - 4999);
                case "channel" -> conflict.addProperty(field, "npc_chat");
            }
            refused(() -> restarted.put(MAID, conflict), "same event changed " + field);
            check(Arrays.equals(committed, Files.readAllBytes(file)), "conflict overwrote committed file");
        }
        JsonObject identityConflict = envelope(MAID, EVENT);
        identityConflict.addProperty("speakerId", OTHER_SPEAKER.toString());
        check(validate(identityConflict, NOW) == null, "changed event speaker accepted");
        refused(() -> restarted.put(OTHER_MAID, validated), "wrong maid path accepted");
        JsonObject other = envelope(OTHER_MAID, EVENT);
        restarted.put(OTHER_MAID, other);
        check(restarted.get(OTHER_MAID, EVENT, SPEAKER).get("listenerId").getAsString().equals(OTHER_MAID.toString()),
            "other maid could not isolate same original event");
        check(Arrays.equals(committed, Files.readAllBytes(file)), "other maid changed first maid file");

        JsonObject original = snapshot(MAID, SPEAKER, EVENT), joined = original.deepCopy();
        restarted.enrich(MAID, joined);
        check(message(joined).get("occurredAt").getAsLong() == NOW - 5000 && message(joined).get("receivedAt").getAsLong() == NOW,
            "original envelope times not joined");
        check(message(joined).get("worldId").getAsString().equals(WORLD.toString()) && !message(joined).get("trusted").getAsBoolean(),
            "world or untrusted observation lost");
        check(message(joined).get("text").equals(message(original).get("text")) && !message(original).has("world"),
            "original inbox rewritten");
        for (JsonObject unmatched : List.of(snapshot(MAID, OTHER_SPEAKER, EVENT), snapshot(MAID, SPEAKER, "legacy_event"),
                snapshot(OTHER_MAID, SPEAKER, EVENT))) {
            JsonObject before = unmatched.deepCopy();
            restarted.enrich(MAID, unmatched);
            check(unmatched.equals(before), "metadata joined by event alone or across maid");
        }
        check(NpcVoiceEnvelopeStore.matchesPending(original, MAID, EVENT, SPEAKER), "original pending identity not matched");
        check(!NpcVoiceEnvelopeStore.matchesPending(snapshot(MAID, OTHER_SPEAKER, EVENT), MAID, EVENT, SPEAKER),
            "conflicting old inbox sender upgraded");
        check(!NpcVoiceEnvelopeStore.matchesPending(original, OTHER_MAID, EVENT, SPEAKER), "wrong snapshot maid upgraded");
        JsonObject legacy = snapshot(MAID, SPEAKER, "qdvoice:" + SPEAKER + ":voice_legacy");
        JsonObject beforeLegacy = legacy.deepCopy(); restarted.enrich(MAID, legacy);
        check(legacy.equals(beforeLegacy), "legacy pending voice gained invented metadata");
        restarted.remove(MAID, EVENT);
        check(new NpcVoiceEnvelopeStore(directory).get(MAID, EVENT, SPEAKER) == null, "ack metadata removal not durable");
        check(restarted.get(OTHER_MAID, EVENT, SPEAKER) != null, "ack deleted another maid metadata");
        restarted.remove(MAID, EVENT); // missing legacy metadata is compatible
        try (var files = Files.list(directory)) {
            check(files.noneMatch(path -> path.toString().endsWith(".tmp")), "atomic commit left temporary file");
        }

        JsonObject edge = envelope(MAID, EVENT); edge.addProperty("occurredAt", NOW - 120_000);
        check(validate(edge, NOW) != null, "120 second boundary rejected");
        edge.addProperty("occurredAt", NOW - 120_001);
        check(validate(edge, NOW) == null, "expired original occurrence accepted");
        edge.addProperty("occurredAt", NOW + 1); edge.addProperty("receivedAt", NOW + 1);
        check(validate(edge, NOW) == null, "future occurrence accepted");
        check(NpcVoiceEnvelopeStore.validate(MAID, SPEAKER, EVENT, input.toString(), "minecraft:the_nether", WORLD, KEY, WORLD, NOW) == null,
            "source dimension change accepted");
        check(NpcVoiceEnvelopeStore.validate(MAID, SPEAKER, EVENT, input.toString(), KEY, WORLD, "minecraft:the_nether", WORLD, NOW) == null,
            "target dimension change accepted");
        check(NpcVoiceEnvelopeStore.validate(MAID, SPEAKER, EVENT, input.toString(), KEY, OTHER_WORLD, KEY, WORLD, NOW) == null,
            "source world UID change accepted");
        check(NpcVoiceEnvelopeStore.validate(MAID, SPEAKER, EVENT, input.toString(), KEY, WORLD, KEY, OTHER_WORLD, NOW) == null,
            "target world UID change accepted");
        for (String channel : List.of("voice", "chat", "npc_chat")) {
            JsonObject row = envelope(MAID, EVENT); row.addProperty("channel", channel);
            check(validate(row, NOW) != null, "allowed channel rejected");
        }
        for (String channel : List.of("whisper", "global", "public")) {
            JsonObject row = envelope(MAID, EVENT); row.addProperty("channel", channel);
            check(validate(row, NOW) == null, "private/global channel accepted");
        }
        for (String field : List.of("listenerId", "eventId", "trusted", "schema", "occurredAt", "receivedAt", "deliveryScope")) {
            JsonObject row = envelope(MAID, EVENT);
            switch (field) {
                case "listenerId" -> row.addProperty(field, OTHER_MAID.toString());
                case "eventId" -> row.addProperty(field, "qdvoice:" + OTHER_SPEAKER + ":voice_test");
                case "trusted" -> row.addProperty(field, true);
                case "schema" -> row.addProperty(field, 2);
                case "occurredAt" -> row.addProperty(field, 1.5);
                case "receivedAt" -> row.addProperty(field, NOW + 1);
                case "deliveryScope" -> row.addProperty(field, "addressed");
            }
            check(validate(row, NOW) == null, "invalid envelope field accepted: " + field);
        }
        check(NpcVoiceEnvelopeStore.validate(MAID, SPEAKER, EVENT, null, KEY, WORLD, KEY, WORLD, NOW) == null, "null V2 accepted");
        check(NpcVoiceEnvelopeStore.validate(MAID, SPEAKER, EVENT, "{broken", KEY, WORLD, KEY, WORLD, NOW) == null, "malformed V2 accepted");
        JsonObject huge = envelope(MAID, EVENT); huge.addProperty("text", "x".repeat(NpcVoiceEnvelopeStore.MAX_ENVELOPE_BYTES));
        check(validate(huge, NOW) == null, "unbounded input envelope accepted");

        UUID futureMaid = UUID.randomUUID(); Path futureFile = directory.resolve(futureMaid + ".json");
        String future = "{\"schema\":2,\"maidId\":\"" + futureMaid + "\",\"envelopes\":{}}";
        Files.writeString(futureFile, future);
        refused(() -> restarted.put(futureMaid, envelope(futureMaid, EVENT)), "future schema overwritten on put");
        refused(() -> restarted.remove(futureMaid, EVENT), "future schema overwritten on ack");
        check(Files.readString(futureFile).equals(future), "future schema bytes changed");
        UUID corruptMaid = UUID.randomUUID(); Path corruptFile = directory.resolve(corruptMaid + ".json");
        Files.writeString(corruptFile, "{broken");
        refused(() -> restarted.put(corruptMaid, envelope(corruptMaid, EVENT)), "corrupt metadata silently overwritten");
        check(Files.readString(corruptFile).equals("{broken"), "corrupt evidence changed");
        Files.write(corruptFile, new byte[NpcVoiceEnvelopeStore.MAX_FILE_BYTES + 1]);
        refused(() -> restarted.get(corruptMaid, EVENT, SPEAKER), "oversized metadata file read");
        refused(() -> restarted.put(corruptMaid, envelope(corruptMaid, EVENT)), "oversized metadata file overwritten");
        UUID boundedMaid = UUID.randomUUID();
        for (int i = 0; i < NpcVoiceEnvelopeStore.MAX_RECORDS; i++)
            restarted.put(boundedMaid, envelope(boundedMaid, "qdvoice:" + SPEAKER + ":voice_" + i));
        Path boundedFile = directory.resolve(boundedMaid + ".json"); byte[] bounded = Files.readAllBytes(boundedFile);
        check(bounded.length <= NpcVoiceEnvelopeStore.MAX_FILE_BYTES, "persisted file exceeds byte bound");
        refused(() -> restarted.put(boundedMaid, envelope(boundedMaid, EVENT)), "record count unbounded");
        check(Arrays.equals(bounded, Files.readAllBytes(boundedFile)), "full store pruned or replaced existing events");
        String grouped = "qdvoice:" + UUID.randomUUID() + ":voice_group_" + UUID.randomUUID() + "_" + UUID.randomUUID();
        check(grouped.length() > 128 && MaidBodyControl.dialogueEventId(grouped), "a grouped microphone event can be acknowledged under its original identifier");
        check(MaidBodyControl.dialogueEventId("a".repeat(192)), "the event envelope bound is accepted");
        check(!MaidBodyControl.dialogueEventId("a".repeat(193)), "oversized event identifiers remain rejected");
        check(!MaidBodyControl.dialogueEventId("bad/event") && !MaidBodyControl.dialogueEventId("bad\nevent"), "event identifiers never become paths or control text");
        System.out.println("NpcVoiceEnvelopeTest: " + checks + " checks passed (persistence/restart/isolation/conflict/age/world/bounds)");
    }
}
