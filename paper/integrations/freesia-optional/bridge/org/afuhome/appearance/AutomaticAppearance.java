package org.afuhome.appearance;

import com.google.gson.*;
import java.nio.file.*;
import java.nio.channels.FileChannel;
import java.util.*;

/** Initial appearances use the existing selection owner and verified native state. No new game body. */
final class AutomaticAppearance {
    record Pick(String model, String texture) {}
    record Entry(String model, String texture, String phase, long at) {}
    record Action(SelfAppearance.Selection selection, String message) {}
    private record Seen(Object connection, long epoch, long at) {}
    private static final Gson JSON = new Gson();
    private final Path config, file;
    private final Map<UUID, Entry> entries = new LinkedHashMap<>();
    private final Map<UUID, Seen> seen = new HashMap<>();
    private final Map<UUID, String> reasons = new HashMap<>();
    private List<Pick> pool = List.of();
    private Set<UUID> excluded = Set.of();
    private boolean enabled, healthy = true;
    private String error;
    private long nextDispatch;

    AutomaticAppearance(Path config) {
        this.config = config; file = config.resolveSibling("automatic-appearances.json");
        try {
            if (Files.exists(file)) {
                if (Files.isSymbolicLink(file) || Files.size(file) > 1024 * 1024) throw new IllegalArgumentException();
                JsonObject root = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
                if (root.get("schemaVersion").getAsInt() != 1 || root.getAsJsonObject("players").size() > 4096) throw new IllegalArgumentException();
                for (var row : root.getAsJsonObject("players").entrySet()) {
                    var value = row.getValue().getAsJsonObject();
                    Entry entry = new Entry(value.get("model").getAsString(), value.get("texture").getAsString(),
                        value.get("phase").getAsString(), value.get("at").getAsLong());
                    if (!valid(new Pick(entry.model, entry.texture)) || !Set.of("existing", "manual", "issued", "applied", "unknown", "restore_pending").contains(entry.phase)) throw new IllegalArgumentException();
                    entries.put(UUID.fromString(row.getKey()), entry);
                }
            }
        } catch (Exception invalid) { healthy = false; error = "AUTO_APPEARANCE_STATE_UNAVAILABLE"; }
    }
    synchronized void reload() {
        enabled = false;
        if (healthy) error = null;
        try {
            if (Files.size(config) > 64 * 1024) throw new IllegalArgumentException();
            var root = JsonParser.parseString(Files.readString(config)).getAsJsonObject();
            if (!root.has("automaticAssignment")) return;
            var options = root.getAsJsonObject("automaticAssignment");
            if (!options.get("enabled").getAsBoolean()) return;
            List<Pick> choices = new ArrayList<>(); Set<String> ids = new HashSet<>();
            for (var item : options.getAsJsonArray("models")) {
                var row = item.getAsJsonObject(); Pick pick = new Pick(row.get("model").getAsString(), row.get("texture").getAsString());
                if (!valid(pick) || pick.model.equals("default") || !ids.add(pick.model) || choices.size() >= 64) throw new IllegalArgumentException();
                choices.add(pick);
            }
            if (choices.isEmpty()) throw new IllegalArgumentException();
            Set<UUID> omit = new HashSet<>();
            for (var id : options.getAsJsonArray("excludedUuids")) omit.add(UUID.fromString(id.getAsString()));
            if (options.has("observerRegistryFile")) {
                Path registry = Path.of(options.get("observerRegistryFile").getAsString());
                if (!registry.isAbsolute() || Files.isSymbolicLink(registry) || Files.size(registry) > 128 * 1024) throw new IllegalArgumentException();
                var roles = JsonParser.parseString(Files.readString(registry)).getAsJsonObject();
                if (roles.get("schema").getAsInt() != 1 || roles.getAsJsonArray("accounts").size() > 128) throw new IllegalArgumentException();
                for (var item : roles.getAsJsonArray("accounts")) {
                    var row = item.getAsJsonObject();
                    if (row.get("kind").getAsString().equals("observer") && row.get("source").getAsString().equals("owner_confirmation"))
                        omit.add(UUID.fromString(row.get("uuid").getAsString()));
                }
            }
            pool = List.copyOf(choices); excluded = Set.copyOf(omit); enabled = true;
        } catch (Exception invalid) { error = "AUTO_APPEARANCE_CONFIG_INVALID"; }
    }
    private static boolean valid(Pick pick) {
        return ModelCatalog.validId(pick.model) && pick.texture != null && pick.texture.matches("[\\p{L}\\p{N}_.-]{1,96}");
    }
    private void put(UUID id, Entry entry) {
        entries.put(id, entry);
        if (!healthy) return;
        Path temp = null;
        try {
            if (entries.size() > 4096 || Files.isSymbolicLink(file)) throw new IllegalArgumentException();
            temp = Files.createTempFile(file.getParent(), ".automatic-appearance-", ".tmp");
            Files.writeString(temp, JSON.toJson(Map.of("schemaVersion", 1, "players", entries)) + "\n");
            try (var channel = FileChannel.open(temp, StandardOpenOption.WRITE)) { channel.force(true); }
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception failure) { healthy = false; error = "AUTO_APPEARANCE_STATE_UNWRITABLE"; }
        finally { if (temp != null) try { Files.deleteIfExists(temp); } catch (Exception ignored) {} }
    }
    synchronized void manual(UUID id, String model, String texture, long now) {
        if (valid(new Pick(model, texture))) put(id, new Entry(model, texture, "manual", now));
        seen.remove(id); reasons.remove(id);
    }
    synchronized void unknown(UUID id) {
        Entry old = entries.get(id);
        if (old != null && old.phase.equals("issued")) put(id, new Entry(old.model, old.texture, "unknown", old.at));
    }
    synchronized Action tick(UUID id, Object connection, long epoch, String name, boolean ready, int workers,
                             String model, String texture, Map<String, List<String>> catalog,
                             Collection<Map<String, Object>> observed, SelfAppearance selections, long now) {
        if (!ready || epoch < 0 || model == null || texture == null) { seen.remove(id); return null; }
        Entry old = entries.get(id);
        if (!enabled && old == null) return null;
        if (!model.equals("default")) {
            if (!valid(new Pick(model, texture))) return null;
            if (old != null && old.model.equals(model) && old.texture.equals(texture)
                    && Set.of("issued", "unknown", "restore_pending").contains(old.phase)) {
                put(id, new Entry(model, texture, "applied", now));
                return new Action(null, "已为你分配初始YSM：" + model + " / " + texture + "。可随时 /appearance list 自选，再 /appearance set <模型> [贴图] 更换。");
            }
            if (old == null || !old.model.equals(model) || !old.texture.equals(texture)) manual(id, model, texture, now);
            seen.remove(id); return null;
        }
        // Any earlier assignment or explicit selection, including default, survives reconnect/reset.
        boolean restoring = old != null && old.phase.equals("restore_pending");
        if (old != null && !restoring) { if (old.phase.equals("issued") && now - old.at > 15000) unknown(id); return null; }
        if (!enabled || !healthy || excluded.contains(id) && !restoring || workers != 1 || !SelfAppearance.validTarget(id, name)) return null;
        Seen first = seen.get(id);
        if (first == null || first.connection != connection || first.epoch != epoch) { seen.put(id, new Seen(connection, epoch, now)); return null; }
        if (now - first.at < 5000 || now < nextDispatch) return null;
        // Count each real UUID once; readback wins over an earlier assignment ledger.
        Map<UUID, Set<String>> occupied = new HashMap<>();
        entries.forEach((uuid, value) -> occupied.computeIfAbsent(uuid, unused -> new HashSet<>()).add(value.model));
        for (var row : observed) if (Boolean.TRUE.equals(row.get("available"))) {
            try { occupied.computeIfAbsent(UUID.fromString((String)row.get("playerUuid")), unused -> new HashSet<>()).add((String)row.get("modelId")); } catch (RuntimeException ignored) {}
        }
        Map<String, Integer> counts = new HashMap<>(); occupied.values().forEach(values -> values.forEach(value -> { if (value != null) counts.merge(value, 1, Integer::sum); }));
        Pick selected = restoring ? (catalog.getOrDefault(old.model, List.of()).contains(old.texture) ? new Pick(old.model, old.texture) : null) : pool.stream().filter(pick -> catalog.getOrDefault(pick.model, List.of()).contains(pick.texture))
            .min(Comparator.<Pick>comparingInt(pick -> counts.getOrDefault(pick.model, 0))
                .thenComparingLong(pick -> Integer.toUnsignedLong(Objects.hash(id, pick.model)))
                .thenComparing(Pick::model)).orElse(null);
        if (selected == null) { reasons.put(id, restoring ? "PREVIOUS_MODEL_UNAVAILABLE" : "NO_COMPATIBLE_INITIAL_MODEL"); return null; }
        var request = selections.begin(id, connection, epoch, name, ready, workers, catalog,
            new String[]{"set", selected.model, selected.texture}, now);
        if (request.selection() == null) return null;
        put(id, new Entry(selected.model, selected.texture, "issued", now));
        if (!healthy) { selections.abandon(request.selection()); return null; }
        nextDispatch = now + 3000; reasons.remove(id);
        return new Action(request.selection(), restoring ? "正在恢复原YSM选择；以实际模型回执为准。" :
            "正在分配初始YSM；以实际模型回执为准。" +
            (counts.getOrDefault(selected.model, 0) > 0 ? "兼容模型池已用满，本次选用人数较少的模型；仍可自行更换。" : ""));
    }
    synchronized Map<String, Object> status(UUID id) {
        Entry row = entries.get(id);
        Map<String, Object> out = new LinkedHashMap<>(); out.put("enabled", enabled && healthy);
        out.put("phase", row == null ? excluded.contains(id) ? "excluded" : "unassigned" : row.phase);
        if (row != null) { out.put("model", row.model); out.put("texture", row.texture); }
        if (!healthy || error != null) out.put("reason", error);
        else if (reasons.containsKey(id)) out.put("reason", reasons.get(id));
        return out;
    }
    synchronized void left(UUID id) { seen.remove(id); reasons.remove(id); }
}
