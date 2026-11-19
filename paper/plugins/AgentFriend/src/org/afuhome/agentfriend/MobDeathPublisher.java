package org.afuhome.agentfriend;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.UUID;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDeathEvent;

/** Private observations of the final damage. Does not grant loot or quest credit. */
final class MobDeathPublisher implements Listener {
    static final String CHANNEL = "mcagent:mob_death";
    private final AgentFriendPlugin plugin;

    MobDeathPublisher(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDeath(EntityDeathEvent event) {
        if (!(event.getEntity() instanceof Mob victim)) return;
        var source = event.getDamageSource();
        Entity causing = source.getCausingEntity();
        Entity direct = source.getDirectEntity();
        var witnesses = new HashSet<>(victim.getTrackedBy());
        if (causing instanceof Player attacker && attacker.isOnline() && attacker.getWorld() == victim.getWorld()) {
            witnesses.add(attacker);
        }
        String json = null;
        byte[] bytes = null;
        for (Player viewer : witnesses) {
            boolean subscribed = viewer.getListeningPluginChannels().contains(CHANNEL);
            if (!subscribed && !plugin.isRegisteredAgent(viewer)) continue;
            if (viewer.getWorld() != victim.getWorld() || !viewer.canSee(victim)
                    || (viewer != causing && !viewer.hasLineOfSight(victim))
                    || (causing != null && viewer != causing && !viewer.canSee(causing))
                    || (direct != null && viewer != direct && !viewer.canSee(direct))) continue;
            if (json == null) {
                JsonObject receipt = new JsonObject();
                receipt.addProperty("schemaVersion", 1);
                receipt.addProperty("eventId", UUID.randomUUID().toString());
                receipt.addProperty("occurredAt", System.currentTimeMillis());
                receipt.addProperty("world", victim.getWorld().getKey().toString());
                receipt.add("victim", identity(victim));
                receipt.addProperty("damageType", source.getDamageType().getKey().toString());
                receipt.add("causingEntity", identity(causing));
                receipt.add("directEntity", identity(direct));
                receipt.addProperty("indirect", source.isIndirect());
                json = receipt.toString();
                bytes = json.getBytes(StandardCharsets.UTF_8);
            }
            if (subscribed) viewer.sendPluginMessage(plugin, CHANNEL, bytes);
            else viewer.sendMessage("MC_MOB_DEATH " + json);
        }
    }

    private static JsonElement identity(Entity entity) {
        if (entity == null) return JsonNull.INSTANCE;
        var result = new JsonObject();
        result.addProperty("entityId", entity.getEntityId());
        result.addProperty("uuid", entity.getUniqueId().toString());
        // Hybrid servers can expose a mod entity to Bukkit as UNKNOWN.
        var type = entity.getType();
        result.addProperty("type", type == EntityType.UNKNOWN ? null : type.getKey().toString());
        String name = entity instanceof Player p ? p.getName() : null;
        var custom = entity.customName();
        if (name == null && custom != null) name = PlainTextComponentSerializer.plainText().serialize(custom);
        if (name != null) {
            name = name.replaceAll("[\\p{Cntrl}\\p{Cf}]", "").strip();
            if (name.codePointCount(0, name.length()) > 80) name = name.substring(0, name.offsetByCodePoints(0, 80));
        }
        result.addProperty("name", name == null || name.isBlank() ? null : name);
        return result;
    }
}
