package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.levelgen.structure.StructureStart;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.World;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.craftbukkit.generator.structure.CraftStructure;
import org.bukkit.entity.Player;
import org.bukkit.generator.structure.Structure;

/** Bounded, loaded-chunk-only survey evidence. No locate calls or world generation. */
final class ExplorationObjectives {
    static final Set<GuildManager.Goal> GOALS = Set.of(GuildManager.Goal.DIMENSION,
            GuildManager.Goal.STRUCTURE, GuildManager.Goal.BIOME, GuildManager.Goal.RETURN);
    record Target(GuildManager.Goal goal, String dimension, List<String> keys, int zoneSize,
            int minDistance, int minSeconds, int minParts, int minBiomes, int minHeightSpan) {
        JsonObject json() {
            JsonObject j = new JsonObject(); j.addProperty("dimension", dimension);
            JsonArray a = new JsonArray(); keys.forEach(a::add); j.add("keys", a);
            j.addProperty("zoneSize", zoneSize); j.addProperty("minDistance", minDistance);
            j.addProperty("minMovingSeconds", minSeconds); j.addProperty("minSections", minParts);
            j.addProperty("minBiomes", minBiomes); j.addProperty("minHeightSpan", minHeightSpan); return j;
        }
        String conditions(int count) {
            if (goal == GuildManager.Goal.RETURN) return "返回 " + dimension + "，服务器核查当前维度";
            return dimension + (keys.isEmpty() ? "" : " / " + String.join(" 或 ", keys))
                    + "；走查 " + count + " 个不同的 " + zoneSize + " 格区域，行进 ≥" + minDistance
                    + " 格、有效行进 ≥" + minSeconds + " 秒；建筑区段 ≥" + minParts + "，生物群系 ≥" + minBiomes + "，探索高差 ≥" + minHeightSpan
                    + "。原地等待、重复绕圈和传送位移不增加探索证据。";
        }
    }
    static Target parse(GuildManager.Goal goal, ConfigurationSection row, int count) {
        if (!GOALS.contains(goal)) return null;
        String dimension = row.getString("dimension", "").toLowerCase(Locale.ROOT);
        if (!Set.of("overworld", "nether", "end").contains(dimension)) throw new IllegalArgumentException("exploration dimension");
        List<String> keys = new ArrayList<>();
        String field = goal == GuildManager.Goal.STRUCTURE ? "structure" : "biome";
        if (goal == GuildManager.Goal.STRUCTURE || goal == GuildManager.Goal.BIOME) {
            List<String> input = row.isList(field + "s") ? row.getStringList(field + "s") : List.of(row.getString(field, ""));
            if (input.isEmpty() || input.size() > 8) throw new IllegalArgumentException("exploration keys (1..8)");
            for (String raw : input) {
                NamespacedKey key = NamespacedKey.fromString(raw);
                if (key == null || (goal == GuildManager.Goal.STRUCTURE ? Registry.STRUCTURE.get(key) : Registry.BIOME.get(key)) == null)
                    throw new IllegalArgumentException("unknown " + field + " " + raw);
                if (!keys.contains(key.toString())) keys.add(key.toString());
            }
        }
        int size = row.getInt("zone-size", goal == GuildManager.Goal.STRUCTURE ? 4 : 16);
        int distance = row.getInt("min-distance", goal == GuildManager.Goal.STRUCTURE ? 24 : 128);
        int seconds = row.getInt("min-seconds", goal == GuildManager.Goal.STRUCTURE ? 15 : 30);
        int parts = row.getInt("min-sections", goal == GuildManager.Goal.STRUCTURE ? 1 : 0);
        int biomes = row.getInt("min-biomes", 1);
        int height = row.getInt("min-height-span", 0);
        if (goal == GuildManager.Goal.RETURN) {
            if (count != 1) throw new IllegalArgumentException("return target must be 1");
            return new Target(goal, dimension, List.of(), 0, 0, 0, 0, 0, 0);
        }
        if (count < 2 || count > 128 || size < 4 || size > 64 || distance < 8 || distance > 8192
                || seconds < 5 || seconds > 900 || height < 0 || height > 128 || parts < 0 || parts > 32 || biomes < 1 || biomes > 16
                || goal != GuildManager.Goal.STRUCTURE && parts != 0 || goal == GuildManager.Goal.STRUCTURE && parts < 1
                || goal == GuildManager.Goal.BIOME && biomes > keys.size())
            throw new IllegalArgumentException("exploration needs distinct zones, distance and moving time");
        return new Target(goal, dimension, List.copyOf(keys), size, distance, seconds, parts, biomes, height);
    }
    private static String dimension(World world) {
        return switch (world.getEnvironment()) { case NETHER -> "nether"; case THE_END -> "end"; default -> "overworld"; };
    }
    private record Place(String instance, String key, List<String> parts, String bounds) { }
    private static Place structure(Location at, Target target) {
        var source = ((CraftWorld) at.getWorld()).getHandle().getChunkSource();
        int cx = at.getBlockX() >> 4, cz = at.getBlockZ() >> 4;
        LevelChunk current = source.getChunkAtIfLoadedImmediately(cx, cz);
        if (current == null) return null;
        for (String key : target.keys) {
            Structure type = Registry.STRUCTURE.get(NamespacedKey.fromString(key));
            if (type == null) continue;
            var nms = CraftStructure.bukkitToMinecraft(type);
            Set<Long> starts = new LinkedHashSet<>(); starts.add(ChunkPos.asLong(cx, cz));
            var references = current.getReferencesForStructure(nms);
            if (references.size() > 128) continue;
            for (long packed : references) starts.add(packed);
            for (long packed : starts) {
                LevelChunk startChunk = source.getChunkAtIfLoadedImmediately(ChunkPos.getX(packed), ChunkPos.getZ(packed));
                if (startChunk == null) continue; // Never synchronously load a remote structure start.
                StructureStart start = startChunk.getStartForStructure(nms);
                if (start == null || !start.isValid() || start.getPieces().size() > 4096) continue;
                var box = start.getBoundingBox();
                if (!box.isInside(at.getBlockX(), at.getBlockY(), at.getBlockZ())) continue;
                List<String> parts = new ArrayList<>(); int index = 0;
                for (var piece : start.getPieces()) {
                    var b = piece.getBoundingBox();
                    if (b.isInside(at.getBlockX(), at.getBlockY(), at.getBlockZ())) parts.add(Integer.toString(index));
                    index++;
                }
                if (parts.isEmpty()) continue;
                return new Place(at.getWorld().getUID() + ":" + key + ":" + packed, key, parts,
                        box.minX() + "," + box.minY() + "," + box.minZ() + ":" + box.maxX() + "," + box.maxY() + "," + box.maxZ());
            }
        }
        return null;
    }
    private static final class Survey {
        final String token;
        final Set<String> zones = new LinkedHashSet<>(), parts = new LinkedHashSet<>(), biomes = new LinkedHashSet<>(), trail = new LinkedHashSet<>();
        String instance = "", structure = "", bounds = "";
        double distance, movingMs;
        int minY = Integer.MAX_VALUE, maxY = Integer.MIN_VALUE;
        boolean ready;
        Location previous;
        long previousAt;
        JsonObject position = new JsonObject();
        Survey(String token, String json) {
            this.token = token;
            if (json.isBlank()) return;
            JsonObject j = JsonParser.parseString(json).getAsJsonObject();
            if (!token.equals(j.get("token").getAsString())) return;
            for (String name : List.of("zones", "parts", "biomes", "trail")) {
                Set<String> values = name.equals("zones") ? zones : name.equals("parts") ? parts : name.equals("trail") ? trail : biomes;
                for (var value : j.getAsJsonArray(name)) { if (values.size() >= (name.equals("trail") ? 2048 : 256)) break; values.add(value.getAsString()); }
            }
            instance = j.get("instance").getAsString(); structure = j.get("structure").getAsString(); bounds = j.get("bounds").getAsString();
            distance = j.get("distance").getAsDouble(); movingMs = j.get("movingMs").getAsDouble(); ready = j.get("ready").getAsBoolean();
            position = j.getAsJsonObject("position");
            minY = j.get("minY").getAsInt(); maxY = j.get("maxY").getAsInt();
        }
        JsonObject json() {
            JsonObject j = new JsonObject(); j.addProperty("token", token);
            j.addProperty("instance", instance); j.addProperty("structure", structure); j.addProperty("bounds", bounds);
            j.addProperty("distance", distance); j.addProperty("movingMs", movingMs); j.addProperty("ready", ready);
            j.add("position", position);
            j.addProperty("minY", minY); j.addProperty("maxY", maxY);
            for (String name : List.of("zones", "parts", "biomes", "trail")) {
                JsonArray a = new JsonArray(); (name.equals("zones") ? zones : name.equals("parts") ? parts : name.equals("trail") ? trail : biomes).forEach(a::add);
                j.add(name, a);
            }
            return j;
        }
    }
    private final AgentFriendPlugin plugin;
    private final Map<UUID, Survey> surveys = new HashMap<>();
    private boolean dirty;
    private final java.util.function.Function<Player,String> pathProvider;
    ExplorationObjectives(AgentFriendPlugin plugin) { this(plugin,p->"guild-players." + p.getUniqueId() + ".active.market.exploration"); }
    ExplorationObjectives(AgentFriendPlugin plugin,java.util.function.Function<Player,String> pathProvider) { this.plugin=plugin;this.pathProvider=pathProvider; }
    private String path(Player p) { return pathProvider.apply(p); }
    void resetMovement(Player p) { Survey s = surveys.get(p.getUniqueId()); if (s != null) s.previous = null; }
    void clear(Player p) { surveys.remove(p.getUniqueId()); plugin.getConfig().set(path(p), null); }
    void forget(Player p) { surveys.remove(p.getUniqueId()); }
    void quit(Player p) { surveys.remove(p.getUniqueId()); flush(); }
    void flush() { if (dirty) { dirty = false; plugin.saveConfig(); } }
    EngineeringSites.Result observe(Player p, Target target, int required, String token) {
        Survey s = surveys.get(p.getUniqueId());
        if (s == null || !s.token.equals(token)) {
            try { s = new Survey(token, plugin.getConfig().getString(path(p), "")); }
            catch (RuntimeException invalid) { s = new Survey(token, ""); plugin.getLogger().warning("Invalid survey retained; fresh survey for " + p.getUniqueId()); }
            surveys.put(p.getUniqueId(), s);
        }
        Location at = p.getLocation(); long now = System.currentTimeMillis();
        boolean valid = p.getGameMode() == GameMode.SURVIVAL && !p.isDead() && !p.isFlying()
                && target.dimension.equals(dimension(at.getWorld()));
        if (!valid) { s.previous = null; return result(s, target, required, "outside_survey_target"); }
        if (!s.ready && !at.getWorld().isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4)) {
            s.previous = null; return result(s, target, required, "current_chunk_unloaded");
        }
        if (s.ready) return result(s, target, required, "ready");
        if (target.goal == GuildManager.Goal.RETURN) {
            s.ready = true; s.position = position(at, now); persist(p, s);
            return result(s, target, required, "ready");
        }
        Place place = null;
        if (target.goal == GuildManager.Goal.STRUCTURE) {
            place = structure(at, target);
            if (place == null) { s.previous = null; return result(s, target, required, "structure_unobserved_or_start_unloaded"); }
        }
        String biome = at.getWorld().getBiome(at).getKey().toString();
        if (target.goal == GuildManager.Goal.BIOME && !target.keys.contains(biome)) {
            s.previous = null; return result(s, target, required, "outside_survey_biome");
        }
        String instance = place == null ? at.getWorld().getUID().toString() : place.instance;
        if (!s.instance.isEmpty() && !s.instance.equals(instance)) {
            s.previous = null; return result(s, target, required, "different_structure_or_world");
        }
        Location previous = s.previous; long elapsed = now - s.previousAt;
        s.previous = at.clone(); s.previousAt = now;
        if (previous == null || !previous.getWorld().equals(at.getWorld()) || elapsed < 150 || elapsed > 3000)
            return result(s, target, required, "survey_incomplete");
        double moved = previous.distance(at);
        if (moved < 0.2 || moved > 24 * elapsed / 1000.0 + 2) return result(s, target, required, "survey_incomplete");
        // Only new spatial coverage earns distance/time: repeatedly walking the same cells cannot finish a survey.
        String zone = Math.floorDiv(at.getBlockX(), target.zoneSize) + ","
                + (target.goal == GuildManager.Goal.STRUCTURE ? Math.floorDiv(at.getBlockY(), target.zoneSize) : 0)
                + "," + Math.floorDiv(at.getBlockZ(), target.zoneSize);
        String point = at.getBlockX() + "," + at.getBlockY() + "," + at.getBlockZ();
        boolean fresh = s.trail.size() < 2048 && s.trail.add(point);
        if (fresh) {
            if (s.zones.size() < 256) s.zones.add(zone);
            s.instance = instance; s.distance = Math.min(10000, s.distance + moved); s.movingMs = Math.min(3600000, s.movingMs + elapsed);
            if (place != null) { s.structure = place.key; s.bounds = place.bounds; }
            s.minY = Math.min(s.minY, at.getBlockY()); s.maxY = Math.max(s.maxY, at.getBlockY());
            if (s.biomes.size() < 64) s.biomes.add(biome);
            if (place != null) for (String part : place.parts) if (s.parts.size() < 128) s.parts.add(part);
            s.position = position(at, now);
            s.ready = s.zones.size() >= required && s.distance >= target.minDistance && s.movingMs >= target.minSeconds * 1000.0
                    && s.parts.size() >= target.minParts && s.biomes.size() >= target.minBiomes && s.maxY - s.minY >= target.minHeightSpan;
            persist(p, s);
        }
        return result(s, target, required, s.ready ? "ready" : "survey_incomplete");
    }
    private void persist(Player p, Survey s) { plugin.getConfig().set(path(p), s.json().toString()); dirty = true; }
    private static JsonObject position(Location at, long time) {
        JsonObject j = new JsonObject(); j.addProperty("world", at.getWorld().getName()); j.addProperty("worldUuid", at.getWorld().getUID().toString());
        j.addProperty("x", at.getX()); j.addProperty("y", at.getY()); j.addProperty("z", at.getZ()); j.addProperty("observedAt", time); return j;
    }
    private EngineeringSites.Result result(Survey s, Target target, int required, String reason) {
        JsonObject j = new JsonObject(); j.addProperty("source", "server_exploration_survey"); j.add("requirements", target.json());
        j.addProperty("distinctZones", s.zones.size()); j.addProperty("requiredZones", required);
        j.addProperty("distance", Math.round(s.distance * 10) / 10.0); j.addProperty("movingSeconds", Math.round(s.movingMs / 100) / 10.0);
        j.addProperty("distinctSections", s.parts.size()); JsonArray biomes = new JsonArray(); s.biomes.forEach(biomes::add); j.add("biomes", biomes);
        j.addProperty("heightSpan", s.minY == Integer.MAX_VALUE ? 0 : s.maxY - s.minY);
        j.addProperty("structure", s.structure); j.addProperty("structureInstance", s.instance); j.addProperty("bounds", s.bounds); j.add("lastSurveyPosition", s.position);
        // Completed survey evidence survives leaving the landmark to make a return journey.
        boolean ready = s.ready && target.goal != GuildManager.Goal.RETURN || s.ready && reason.equals("ready");
        j.addProperty("ready", ready); j.addProperty("validCurrentTarget", !reason.startsWith("outside") && !reason.startsWith("different")
                && !reason.equals("structure_unobserved_or_start_unloaded") && !reason.equals("current_chunk_unloaded"));
        int progress = ready ? required : Math.min(required - 1, s.zones.size());
        return new EngineeringSites.Result(ready, progress, ready ? "ready" : reason, j);
    }
}
