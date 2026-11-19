package org.afuhome.agentfriend;

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
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

    private static boolean visible(Player viewer, LivingEntity body) {
        if (body == null || !body.isValid() || body.getUniqueId().equals(viewer.getUniqueId())) return false;
        if (body instanceof Player player)
            return player.isOnline() && player.getGameMode() != GameMode.SPECTATOR && !player.getName().equals("Goddess") && viewer.canSee(player);
        return !body.isDead() && !body.isInvisible() && viewer.canSee(body);
    }

    static List<Target> list(Player viewer) {
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

    static Target find(Player viewer, UUID id) {
        var player = Bukkit.getPlayer(id);
        if (player != null) return visible(viewer, player) ? new Target(player, player.getName()) : null;
        if (!(Bukkit.getEntity(id) instanceof LivingEntity body) || !visible(viewer, body)) return null;
        String name = companions().get(id);
        return name == null ? null : new Target(body, name);
    }

    static List<Target> named(List<Target> visible, String key) {
        return visible.stream().filter(t -> t.id().toString().equalsIgnoreCase(key) || t.name().equalsIgnoreCase(key)).toList();
    }
}

