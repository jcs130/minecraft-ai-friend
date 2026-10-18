package org.afuhome.agentfriend;

import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.UUID;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;

/** One explicit paused expedition per player. Active state and its frozen rules
 * move in the same durable replacement; never split save/delete into two writes. */
final class ExplorationPauseStore {
    static String root(UUID id) { return "guild-players." + id; }
    static YamlConfiguration read(FileConfiguration config, UUID id) {
        String raw = config.getString(root(id) + ".paused-exploration.snapshot", "");
        if (raw.isEmpty() || raw.length() > 1024 * 1024) throw new IllegalArgumentException("paused exploration unavailable");
        try { var saved = new YamlConfiguration(); saved.loadFromString(raw); return saved; }
        catch (Exception invalid) { throw new IllegalArgumentException("paused exploration invalid", invalid); }
    }
    static boolean present(FileConfiguration config, UUID id) { return config.contains(root(id) + ".paused-exploration"); }
    static boolean move(FileConfiguration config, Path file, UUID id, boolean pause) {
        String before = config.saveToString(), base = root(id);
        Path temporary = file.resolveSibling(file.getFileName() + ".exploration-pause.tmp");
        try {
            if (pause) {
                if (present(config, id)) throw new IllegalArgumentException("paused slot occupied");
                ConfigurationSection active = config.getConfigurationSection(base + ".active");
                if (active == null || active.getString("id", "").isEmpty()) throw new IllegalArgumentException("no active task");
                var snapshot = new YamlConfiguration(); copy(active, snapshot, "");
                String raw = snapshot.saveToString();
                if (raw.length() > 1024 * 1024) throw new IllegalArgumentException("snapshot capacity");
                config.set(base + ".paused-exploration.snapshot", raw);
                config.set(base + ".paused-exploration.id", active.getString("id"));
                config.set(base + ".paused-exploration.paused-at", System.currentTimeMillis());
                config.set(base + ".active", null);
            } else {
                if (config.contains(base + ".active")) throw new IllegalArgumentException("active slot occupied");
                var snapshot = read(config, id);
                copy(snapshot, config, base + ".active.");
                config.set(base + ".paused-exploration", null);
            }
            byte[] bytes = config.saveToString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 16 * 1024 * 1024) throw new IllegalArgumentException("config capacity");
            try (var channel = FileChannel.open(temporary, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true);
            }
            try { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException unsupported) { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING); }
            return true;
        } catch (Exception failed) {
            try { config.loadFromString(before); } catch (Exception broken) { throw new IllegalStateException("cannot restore in-memory state", broken); }
            return false;
        } finally {
            try { Files.deleteIfExists(temporary); } catch (Exception ignored) { }
        }
    }
    private static void copy(ConfigurationSection from, ConfigurationSection to, String prefix) {
        from.getValues(true).forEach((key, value) -> { if (!(value instanceof ConfigurationSection)) to.set(prefix + key, value); });
    }
    private ExplorationPauseStore() { }
}
