package org.afuhome.agentfriend;

import java.io.IOException;
import java.util.*;
import org.bukkit.block.Block;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;

/** One durable source of actual actor placements for both housing contracts and exams. */
final class HouseEvidence {
    static final int LIMIT = 2048;
    private static final String ROOT = "house-evidence";
    // Failed invalidations must fail closed until a subsequent durable commit.
    private static final Set<AgentFriendPlugin> UNAVAILABLE = Collections.newSetFromMap(new IdentityHashMap<>());
    private HouseEvidence() { }

    record Placement(String position, String material, UUID actor, long timestamp) {
        String proof() { return position + "|" + material; }
        String encode() { return proof() + "|" + actor + "|" + timestamp; }
    }
    static Placement decode(String raw) {
        try {
            String[] fields = raw.split("\\|", -1), pos = fields[0].split(":", -1);
            if (fields.length != 4 || pos.length != 4 || !fields[1].matches("[A-Z][A-Z0-9_]*")) return null;
            UUID.fromString(pos[0]);
            for (int i = 1; i < 4; i++) Integer.parseInt(pos[i]);
            long time = Long.parseLong(fields[3]);
            return time > 0 ? new Placement(fields[0], fields[1], UUID.fromString(fields[2]), time) : null;
        } catch (RuntimeException invalid) { return null; }
    }
    static List<String> select(List<String> records, UUID actor, long startedAt) {
        var found = new LinkedHashMap<String, Placement>();
        for (String raw : records) {
            Placement p = decode(raw);
            if (p != null && p.actor().equals(actor) && p.timestamp() >= startedAt) {
                Placement previous = found.get(p.position());
                if (previous == null || p.timestamp() >= previous.timestamp()) found.put(p.position(), p);
            }
        }
        return found.values().stream().limit(LIMIT).map(Placement::proof).toList();
    }
    static List<String> invalidate(List<String> records, Set<String> positions) {
        return records.stream().filter(raw -> !positions.contains(raw.split("\\|", 2)[0])).toList();
    }
    static List<String> append(List<String> records, List<Placement> placed) {
        Set<String> positions = new HashSet<>();
        for (Placement p : placed) positions.add(p.position());
        var out = new ArrayList<>(invalidate(records, positions));
        var unique = new LinkedHashMap<String, Placement>();
        for (Placement p : placed) unique.put(p.position(), p);
        for (Placement p : unique.values()) out.add(p.encode());
        return List.copyOf(out.subList(Math.max(0, out.size() - LIMIT), out.size()));
    }
    static boolean available(AgentFriendPlugin plugin) {
        return !UNAVAILABLE.contains(plugin) && !Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown"));
    }
    static List<String> placementsSince(AgentFriendPlugin plugin, Player p, long startedAt) {
        if (!available(plugin) || startedAt <= 0) return List.of();
        return select(plugin.getConfig().getStringList(ROOT + "." + p.getUniqueId() + ".placements"), p.getUniqueId(), startedAt);
    }
    static List<String> allRecords(AgentFriendPlugin plugin, Player p) {
        if (!available(plugin)) return List.of();
        return select(plugin.getConfig().getStringList(ROOT + "." + p.getUniqueId() + ".placements"), p.getUniqueId(), 0);
    }
    /** MONITOR caller passes all MultiPlace cells once. Overwrites invalidate every owner, even if not recording. */
    static boolean placed(AgentFriendPlugin plugin, Player actor, List<Block> blocks, boolean recording) {
        return update(plugin, actor, blocks, recording);
    }
    static boolean broken(AgentFriendPlugin plugin, Block block) {
        return update(plugin, null, List.of(block), false);
    }
    private static boolean update(AgentFriendPlugin plugin, Player actor, List<Block> blocks, boolean recording) {
        FileConfiguration config = plugin.getConfig();
        Set<String> positions = new HashSet<>();
        for (Block block : blocks) positions.add(StarterHouseInspection.key(block));
        boolean changed = false;
        var section = config.getConfigurationSection(ROOT);
        if (section != null) for (String owner : section.getKeys(false)) {
            String path = ROOT + "." + owner + ".placements";
            var before = config.getStringList(path); var after = invalidate(before, positions);
            if (!before.equals(after)) { config.set(path, after); changed = true; }
        }
        // Untimed legacy records remain usable only by their original ordinary contract.
        section = config.getConfigurationSection("life-guild");
        if (section != null) for (String owner : section.getKeys(false)) {
            String path = "life-guild." + owner + ".active.house-placed";
            var before = config.getStringList(path); var after = invalidate(before, positions);
            if (!before.equals(after)) { config.set(path, after); changed = true; }
            String lamp = "life-guild." + owner + ".active.lamp";
            if (positions.contains(config.getString(lamp, ""))) {
                config.set(lamp, null); config.set("life-guild." + owner + ".active.progress", 0); changed = true;
            }
        }
        String actorPath = actor == null ? "" : ROOT + "." + actor.getUniqueId() + ".placements";
        List<String> invalidated = recording ? config.getStringList(actorPath) : List.of();
        if (recording) {
            long now = System.currentTimeMillis();
            var placed = blocks.stream().map(b -> new Placement(StarterHouseInspection.key(b), b.getType().name(), actor.getUniqueId(), now)).toList();
            config.set(actorPath, append(invalidated, placed)); changed = true;
        }
        if (!changed && !UNAVAILABLE.contains(plugin)) return true;
        try {
            DurableConfigStore.persist(plugin); UNAVAILABLE.remove(plugin); return true;
        } catch (IOException | RuntimeException failure) {
            // Keep removals, but never allow uncommitted additions into proof or a later incidental save.
            if (recording && !Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown"))) config.set(actorPath, invalidated);
            UNAVAILABLE.add(plugin);
            plugin.getLogger().warning("House evidence commit failed; housing proof unavailable: " + failure.getClass().getSimpleName());
            return false;
        }
    }
}
