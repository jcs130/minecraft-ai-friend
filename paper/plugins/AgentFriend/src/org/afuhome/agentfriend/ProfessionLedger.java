package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;

/** A UUID ledger. A failed atomic write never replaces the last in-memory state. */
final class ProfessionLedger {
    private final Path file;
    private JsonObject data;
    private boolean ready;
    private String error = "";
    ProfessionLedger(Path file) {
        this.file = file;
        try {
            if (Files.exists(file)) {
                if (Files.size(file) > 16_777_216) throw new IllegalArgumentException("ledger too large");
                data = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
                if (data.get("schemaVersion").getAsInt() != 1 || !data.has("players") || !data.has("uniqueOwners"))
                    throw new IllegalArgumentException("ledger schema");
                for (var entry : data.getAsJsonObject("players").entrySet()) {
                    UUID.fromString(entry.getKey()); JsonObject p = entry.getValue().getAsJsonObject();
                    if (!p.has("combat") || !p.get("combat").isJsonPrimitive() || !p.get("combat").getAsJsonPrimitive().isString()
                            || !p.get("combat").getAsString().matches("[a-z0-9_]{0,40}")) throw new IllegalArgumentException("profile combat");
                    if (!p.has("unlocked")) p.add("unlocked", p.getAsJsonObject("learned").deepCopy());
                    if (!p.has("basicLearned")) p.add("basicLearned", new JsonObject());
                    if (!p.has("points")) p.add("points", new JsonObject());
                    for (String key : List.of("earned", "spent", "levelHighWater")) {
                        if (!p.getAsJsonObject("points").has(key)) p.getAsJsonObject("points").addProperty(key, 0);
                        if (!finitePositive(p.getAsJsonObject("points").get(key), 1_000_000)
                                || p.getAsJsonObject("points").get(key).getAsDouble() != p.getAsJsonObject("points").get(key).getAsInt()) throw new IllegalArgumentException("point balance");
                    }
                    if (p.getAsJsonObject("points").get("spent").getAsInt() > p.getAsJsonObject("points").get("earned").getAsInt()) throw new IllegalArgumentException("point overspend");
                    for (String key : List.of("unlocked", "learned", "basicLearned")) {
                        if (!p.get(key).isJsonObject() || p.getAsJsonObject(key).size() > 64) throw new IllegalArgumentException("learning rows");
                        for (var item : p.getAsJsonObject(key).entrySet()) {
                            if (!item.getKey().matches("[a-z0-9_]{2,40}") || !item.getValue().isJsonObject()) throw new IllegalArgumentException("learning record");
                            JsonObject record = item.getValue().getAsJsonObject();
                            if (record.has("level") && (!finitePositive(record.get("level"), 3) || record.get("level").getAsInt() < 1 || record.get("level").getAsDouble() != record.get("level").getAsInt())) throw new IllegalArgumentException("skill rank");
                        }
                    }
                    validateStrings(p, "life", 2); validateStrings(p, "prepared", 5);
                    if (p.getAsJsonObject("learned") == null || p.getAsJsonObject("cooldowns") == null || p.getAsJsonObject("metrics") == null)
                        throw new IllegalArgumentException("profile objects");
                    if (!p.getAsJsonObject("learned").keySet().containsAll(strings(p, "prepared"))) throw new IllegalArgumentException("unlearned preparation");
                    for (var grant : p.getAsJsonObject("learned").entrySet()) {
                        if (!grant.getKey().matches("[a-z0-9_]{2,40}") || !grant.getValue().isJsonObject()
                                || !grant.getValue().getAsJsonObject().has("source")) throw new IllegalArgumentException("profile grant");
                    }
                    for (var cooldown : p.getAsJsonObject("cooldowns").entrySet())
                        if (!cooldown.getKey().matches("[a-z0-9_]{2,40}") || !finitePositive(cooldown.getValue(), 9_007_199_254_740_991d)) throw new IllegalArgumentException("profile cooldown");
                    for (var metric : p.getAsJsonObject("metrics").entrySet())
                        if (!finitePositive(metric.getValue(), 1e12)) throw new IllegalArgumentException("profile metric");
                }
                for (var owner : data.getAsJsonObject("uniqueOwners").entrySet()) {
                    UUID.fromString(owner.getValue().getAsString());
                    JsonObject p = data.getAsJsonObject("players").getAsJsonObject(owner.getValue().getAsString());
                    if (p == null || !p.getAsJsonObject("unlocked").has(owner.getKey()) && !p.getAsJsonObject("learned").has(owner.getKey())) throw new IllegalArgumentException("unique ownership");
                }
            } else { data = new JsonObject(); data.addProperty("schemaVersion", 1);
                data.add("players", new JsonObject()); data.add("uniqueOwners", new JsonObject()); data.add("raids", new JsonObject()); }
            if (!data.has("raids")) data.add("raids", new JsonObject());
            if (!data.get("raids").isJsonObject() || data.getAsJsonObject("raids").size() > 32) throw new IllegalArgumentException("raids");
            for (var raid : data.getAsJsonObject("raids").entrySet()) {
                JsonObject row = raid.getValue().getAsJsonObject(); validateStrings(row, "rewards", 20);
                JsonObject participants = row.getAsJsonObject("participants");
                if (participants == null || participants.size() > 64) throw new IllegalArgumentException("raid participants");
                for (var player : participants.entrySet()) {
                    UUID.fromString(player.getKey());
                    for (var metric : player.getValue().getAsJsonObject().entrySet())
                        if (!Set.of("damage", "healing", "mitigation").contains(metric.getKey()) || !finitePositive(metric.getValue(), 1e12))
                            throw new IllegalArgumentException("raid metric");
                }
            }
            if (!data.has("legacyPlayers")) data.add("legacyPlayers", new JsonObject());
            if (!data.get("legacyPlayers").isJsonObject()) throw new IllegalArgumentException("legacy snapshot");
            for (String id : data.getAsJsonObject("legacyPlayers").keySet()) UUID.fromString(id);
            ready = true;
        } catch (Exception invalid) { error = invalid.toString(); data = new JsonObject(); }
    }
    boolean ready() { return ready; }
    private static boolean finitePositive(JsonElement value, double maximum) {
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return false;
        double number = value.getAsDouble(); return Double.isFinite(number) && number >= 0 && number <= maximum;
    }
    private static void validateStrings(JsonObject object, String key, int limit) {
        if (!object.has(key) || !object.get(key).isJsonArray() || object.getAsJsonArray(key).size() > limit) throw new IllegalArgumentException(key + " array");
        List<String> values = strings(object, key);
        if (new HashSet<>(values).size() != values.size() || values.stream().anyMatch(s -> !s.matches("[a-z0-9_]{2,40}"))) throw new IllegalArgumentException(key + " values");
    }
    String error() { return error; }
    JsonObject data() { return data; }
    static JsonObject empty() {
        JsonObject p = new JsonObject(); p.addProperty("combat", ""); p.add("life", new JsonArray());
        p.add("prepared", new JsonArray()); p.add("learned", new JsonObject()); p.add("cooldowns", new JsonObject());
        p.add("metrics", new JsonObject()); p.add("unlocked", new JsonObject()); p.add("basicLearned", new JsonObject());
        JsonObject points = new JsonObject(); points.addProperty("earned", 0); points.addProperty("spent", 0); points.addProperty("levelHighWater", 0);
        p.add("points", points); return p;
    }
    JsonObject profile(UUID id) {
        if (!ready) return empty(); JsonElement p = data.getAsJsonObject("players").get(id.toString());
        return p == null ? empty() : p.getAsJsonObject();
    }
    static JsonObject profile(JsonObject data, UUID id) {
        JsonObject players = data.getAsJsonObject("players");
        if (!players.has(id.toString())) players.add(id.toString(), empty()); return players.getAsJsonObject(id.toString());
    }
    boolean write(Consumer<JsonObject> edit) {
        if (!ready) return false;
        JsonObject next = data.deepCopy();
        try {
            edit.accept(next); byte[] bytes = next.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 16_777_216) throw new IllegalArgumentException("ledger size limit");
            Path temp = file.resolveSibling(file.getFileName() + ".tmp");
            try (FileChannel channel = FileChannel.open(temp, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true);
            }
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            data = next; error = ""; return true;
        } catch (Exception failed) { error = failed.toString(); return false; }
    }
    static List<String> strings(JsonObject p, String key) {
        List<String> result = new ArrayList<>(); p.getAsJsonArray(key).forEach(value -> result.add(value.getAsString())); return result;
    }
    static void strings(JsonObject p, String key, Collection<String> values) {
        JsonArray array = new JsonArray(); values.forEach(array::add); p.add(key, array);
    }
}
