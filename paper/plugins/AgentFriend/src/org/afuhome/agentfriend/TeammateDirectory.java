package org.afuhome.agentfriend;

import org.bukkit.Bukkit;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** One live directory for compass buttons, commands, tracking and teleport revalidation. */
final class TeammateDirectory {
    record Target(LivingEntity body, String name) {
        UUID id() { return body.getUniqueId(); }
        List<String> aliases() {
            var plugin = Bukkit.getPluginManager().getPlugin("AgentFriend");
            return plugin == null ? List.of() : plugin.getConfig().getStringList("character-directory.aliases." + id())
                    .stream().filter(s -> !s.isBlank() && s.length() <= 48 && s.codePoints().noneMatch(Character::isISOControl)).limit(8).toList();
        }
        String displayName() {
            if (body instanceof Player player) return PlainTextComponentSerializer.plainText().serialize(player.displayName());
            return name;
        }
    }

    private static Map<UUID, String> companions() {
        var result = new LinkedHashMap<UUID, String>();
        var residents = NativeResidentIdentities.all();
        var voice = Bukkit.getPluginManager().getPlugin("QiandengVoice");
        if (voice != null && voice.isEnabled()) {
            try {
                var names = voice.getClass().getMethod("publicCompanionNames").invoke(voice);
                if (names instanceof Map<?, ?> map) for (var e : map.entrySet()) {
                    if (e.getKey() instanceof UUID id && e.getValue() instanceof String name && !residents.containsKey(id))
                        result.put(id, name);
                }
            } catch (ReflectiveOperationException | LinkageError unavailable) {
                // Optional companion registry. Regular players and public residents remain available.
            }
        }
        result.putAll(NativeResidentIdentities.visible());
        return result;
    }

    static LivingEntity registeredActor(UUID id) {
        if (!(Bukkit.getEntity(id) instanceof LivingEntity actor) || !actor.isValid() || actor.isDead()) return null;
        if (actor instanceof Player player) return player.isOnline() ? player : null;
        return companions().containsKey(id) ? actor : null;
    }

    private static boolean visible(LivingEntity viewer, LivingEntity body) {
        if (body == null || !body.isValid() || body.isDead() || body.isInvisible()
                || body.getUniqueId().equals(viewer.getUniqueId())
                || body.getMetadata("vanished").stream().anyMatch(v -> v.asBoolean())) return false;
        if (body instanceof Player player) {
            if (!player.isOnline() || !(Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin)
                    || plugin.isObserver(player)) return false;
        }
        return viewer instanceof Player player ? player.canSee(body) : body.isVisibleByDefault();
    }

    static List<Target> list(Player viewer) { return list((LivingEntity)viewer); }
    static List<Target> list(LivingEntity viewer) {
        var result = new LinkedHashMap<UUID, Target>();
        for (Player player : Bukkit.getOnlinePlayers()) if (visible(viewer, player))
            result.put(player.getUniqueId(), new Target(player, player.getName()));
        companions().forEach((id, name) -> {
            if (Bukkit.getEntity(id) instanceof LivingEntity body && !(body instanceof Player) && visible(viewer, body))
                result.putIfAbsent(id, new Target(body, name));
        });
        var ordered = new ArrayList<>(result.values());
        ordered.sort(Comparator.comparing(Target::name, String.CASE_INSENSITIVE_ORDER).thenComparing(Target::id));
        return ordered;
    }

    static Target find(Player viewer, UUID id) { return find((LivingEntity)viewer, id); }
    static Target find(LivingEntity viewer, UUID id) {
        var player = Bukkit.getPlayer(id);
        if (player != null) return visible(viewer, player) ? new Target(player, player.getName()) : null;
        if (!(Bukkit.getEntity(id) instanceof LivingEntity body) || !visible(viewer, body)) return null;
        String name = companions().get(id);
        return name == null ? null : new Target(body, name);
    }

    static List<Target> named(List<Target> visible, String key) {
        try {
            UUID id = UUID.fromString(key);
            if (id.toString().equalsIgnoreCase(key)) return visible.stream().filter(t -> t.id().equals(id)).toList();
        } catch (IllegalArgumentException ignored) { /* ordinary character name */ }
        return visible.stream().filter(t -> t.name().equalsIgnoreCase(key) || t.displayName().equalsIgnoreCase(key)
                || t.aliases().stream().anyMatch(key::equalsIgnoreCase)).toList();
    }
}

