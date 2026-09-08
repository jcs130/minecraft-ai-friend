package dev.god.godvoice;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Small, strict disk contract. No entity lookup and no world access. */
record SpeechJob(int schema, String id, UUID entity, Path file, String text, String voiceId,
                 String speakerName, long generation, long createdAt, long expiresAt,
                 String dimension, String scope, UUID recipientUuid, float radius,
                 String priority, Path claimed) implements SpeechLane.Item {
    static final long MAX_AUDIO_BYTES = 4 * 1024 * 1024;
    static final int MAX_SECONDS = 120;

    static SpeechJob read(Path claimed, Path queue, long now) throws IOException {
        if (Files.size(claimed) > 32768) throw new IllegalArgumentException("job_too_large");
        JsonObject row = JsonParser.parseString(Files.readString(claimed)).getAsJsonObject();
        long version = integer(row, "schema", 1);
        if (version != 1 && version != 2) throw new IllegalArgumentException("unsupported_schema");
        int schema = (int) version;
        String id = string(row, "id", "");
        if (!id.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")) throw new IllegalArgumentException("invalid_id");
        if (!claimed.getFileName().toString().equals(id + ".json.processing"))
            throw new IllegalArgumentException("id_filename_mismatch");
        UUID entity = UUID.fromString(string(row, "entity", ""));
        Path file = Path.of(string(row, "file", "")).toAbsolutePath().normalize();
        if (!file.getParent().toRealPath().equals(queue.toRealPath()) || !file.getFileName().toString().equals(id + ".mp3")
                || Files.isSymbolicLink(file))
            throw new IllegalArgumentException("invalid_audio_file");
        String text = string(row, "text", "").replaceAll("[\\p{Cntrl}§]", " ").strip();
        if (text.length() > 1000) throw new IllegalArgumentException("text_too_long");
        String voice = string(row, "voiceId", string(row, "voice", "legacy"));
        if (schema == 2 && (!row.has("voiceId") || !voice.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,79}")))
            throw new IllegalArgumentException("invalid_voice_id");
        String name = string(row, "speakerName", "");
        long generation = integer(row, "generation", schema == 1 ? 0 : -1);
        long created = integer(row, "createdAt", schema == 1 ? Files.getLastModifiedTime(claimed).toMillis() : -1);
        long expires = integer(row, "expiresAt", schema == 1 ? now + MAX_SECONDS * 1000L : -1);
        if (generation < 0 || created < 0 || created > now + 5000 || expires <= created)
            throw new IllegalArgumentException("invalid_timestamps_or_generation");
        String dimension = string(row, "dimension", "");
        if (schema == 2 && !dimension.matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))
            throw new IllegalArgumentException("invalid_dimension");
        String scope = string(row, "scope", "nearby");
        if (!scope.equals("nearby") && !scope.equals("recipient")) throw new IllegalArgumentException("invalid_scope");
        UUID recipient = row.has("recipientUuid") && !row.get("recipientUuid").isJsonNull()
                ? UUID.fromString(string(row, "recipientUuid", "")) : null;
        if (scope.equals("recipient") && recipient == null) throw new IllegalArgumentException("missing_recipient");
        float radius = number(row, "radius", 24);
        if (!Float.isFinite(radius) || radius <= 0 || radius > 32) throw new IllegalArgumentException("invalid_radius");
        String priority = string(row, "priority", "normal");
        if (!priority.equals("normal") && !priority.equals("urgent")) throw new IllegalArgumentException("invalid_priority");
        return new SpeechJob(schema, id, entity, file, text, voice, name, generation, created, expires,
                dimension, scope, recipient, radius, priority, claimed);
    }

    /** Missing/malformed/mismatched fences never authorize schema 2, including after async decoding. */
    String fence(Path base, long now) {
        if (now >= expiresAt) return "expired";
        if (schema == 1) return null;
        try {
            Path path = base.resolve("speech-state").resolve(entity + ".json");
            if (Files.isSymbolicLink(path) || Files.size(path) > 4096) return "generation_unavailable";
            JsonObject state = JsonParser.parseString(Files.readString(path)).getAsJsonObject();
            if (integer(state, "schema", -1) != 1 || !entity.toString().equals(string(state, "entity", "")))
                return "generation_unavailable";
            return integer(state, "generation", -1) == generation ? null : "generation_changed";
        } catch (Exception failure) { return "generation_unavailable"; }
    }
    static String string(JsonObject row, String name, String fallback) {
        if (!row.has(name)) return fallback;
        var value = row.get(name);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException("invalid_" + name);
        return value.getAsString();
    }
    static long integer(JsonObject row, String name, long fallback) {
        if (!row.has(name)) return fallback;
        var value = row.get(name);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()
                || !value.getAsString().matches("-?(0|[1-9][0-9]*)")) throw new IllegalArgumentException("invalid_" + name);
        return Long.parseLong(value.getAsString());
    }
    static float number(JsonObject row, String name, float fallback) {
        if (!row.has(name)) return fallback;
        var value = row.get(name);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException("invalid_" + name);
        return value.getAsFloat();
    }
}
