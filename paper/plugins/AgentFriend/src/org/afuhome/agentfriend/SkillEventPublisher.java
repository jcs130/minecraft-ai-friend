package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import java.nio.charset.StandardCharsets;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;

/** One private, server-authoritative event per skill that actually took effect. */
final class SkillEventPublisher {
    static final String CHANNEL = "mcagent:event";
    private final AgentFriendPlugin plugin;

    SkillEventPublisher(AgentFriendPlugin plugin) { this.plugin = plugin; }

    void start() { Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL); }

    void stop() { Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL); }

    void publish(Player caster, String id, String body, Location position) {
        if (caster == null || !caster.isOnline() || position == null || position.getWorld() == null
                || !Double.isFinite(position.getX()) || !Double.isFinite(position.getY())
                || !Double.isFinite(position.getZ())) return;
        String normalized = id.startsWith("conjure_") ? "conjure" : id;
        String title = title(normalized);
        if (title == null && plugin.professions() != null && plugin.professions().skill(normalized) != null)
            title = plugin.professions().skill(normalized).title();
        if (title == null) return;
        JsonObject root = new JsonObject();
        root.addProperty("schemaVersion", 1);
        root.addProperty("kind", "skill");
        root.addProperty("id", id);
        root.addProperty("title", title);
        root.addProperty("body", body == null ? "生效" : body);
        root.addProperty("tone", tone(normalized));
        JsonObject at = new JsonObject();
        at.addProperty("x", position.getX());
        at.addProperty("y", position.getY());
        at.addProperty("z", position.getZ());
        root.add("position", at);
        byte[] bytes = root.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 16_384) {
            plugin.getLogger().warning("Skill event exceeded 16 KiB: " + id);
            return;
        }
        if (caster.getListeningPluginChannels().contains(CHANNEL)) {
            caster.sendPluginMessage(plugin, CHANNEL, bytes);
        } else {
            // Mineflayer need not register channels. Send the same raw UTF-8 JSON
            // directly to this player's connection, never to chat or nearby players.
            ((CraftPlayer) caster).getHandle().connection.send(new ClientboundCustomPayloadPacket(
                    new DiscardedPayload(new ResourceLocation(CHANNEL), Unpooled.wrappedBuffer(bytes))));
        }
    }

    private static String title(String id) {
        return switch (id) {
            case "starbolt" -> "星芒箭";
            case "frostnova" -> "霜环术";
            case "flamewave" -> "焰浪术";
            case "prospect" -> "探矿术";
            case "leap" -> "跃空术";
            case "flight" -> "飞行术";
            case "golem" -> "守护傀儡";
            case "sense" -> "探敌术";
            case "home" -> "归乡术";
            case "travel" -> "传送术";
            case "storage" -> "远程储物术";
            case "blink" -> "闪现术";
            case "selfheal" -> "圣愈术";
            case "heal" -> "治疗术";
            case "food" -> "饱食术";
            case "conjure" -> "造物术";
            case "fireworks" -> "烟花术";
            case "starlight" -> "星尘术";
            case "feather" -> "羽落术";
            case "night" -> "夜视术";
            default -> null;
        };
    }

    private static String tone(String id) {
        return switch (id) {
            case "selfheal", "heal", "food", "feather" -> "healing";
            case "frostnova" -> "frost";
            case "flamewave", "fireworks" -> "fire";
            case "leap", "flight", "home", "travel", "blink" -> "movement";
            default -> "arcane";
        };
    }
}
