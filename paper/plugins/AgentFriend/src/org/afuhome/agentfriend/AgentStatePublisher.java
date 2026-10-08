package org.afuhome.agentfriend;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import dev.aurelium.auraskills.api.user.SkillsUser;
import io.netty.buffer.Unpooled;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRegisterChannelEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.scheduler.BukkitTask;

/** Private, change-only mana and castable-ability snapshots for Agent clients. */
final class AgentStatePublisher implements Listener {
    static final String CHANNEL = "mcagent:state";
    private static final int MAX_BYTES = 16_384;
    private static final long RECOVERY_INTERVAL_MS = 1_000L;
    private final AgentFriendPlugin plugin;
    private final AgentAbilityState abilities;
    private final Map<UUID, LastState> lastStates = new HashMap<>();
    private final Set<UUID> pendingInitial = new HashSet<>();
    private BukkitTask pollTask;

    private record LastState(String json, long sentAt) {}
    record StatePayload(String json, byte[] bytes) {}

    AgentStatePublisher(AgentFriendPlugin plugin, CombatSpells combat,
            ProspectingSpell prospecting, UtilitySpells utility) {
        this.plugin = plugin;
        this.abilities = new AgentAbilityState(plugin, combat, prospecting, utility);
    }

    void start() {
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getPluginManager().registerEvents(this, plugin);
        // Poll once per second for AuraSkills' natural recovery and changes made
        // outside /mycli. Casting publishes immediately from the spending path.
        pollTask = Bukkit.getScheduler().runTaskTimer(plugin, this::poll, 20L, 20L);
    }

    void stop() {
        if (pollTask != null) pollTask.cancel();
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL);
        lastStates.clear();
        pendingInitial.clear();
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        lastStates.remove(player.getUniqueId());
        scheduleInitial(player);
    }

    @EventHandler public void onRespawn(PlayerRespawnEvent event) {
        Player player = event.getPlayer();
        lastStates.remove(player.getUniqueId());
        scheduleInitial(player);
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        lastStates.remove(event.getPlayer().getUniqueId());
        pendingInitial.remove(event.getPlayer().getUniqueId());
    }

    @EventHandler public void onRegister(PlayerRegisterChannelEvent event) {
        if (CHANNEL.equals(event.getChannel())
                && !lastStates.containsKey(event.getPlayer().getUniqueId())) scheduleInitial(event.getPlayer());
    }

    private void scheduleInitial(Player player) {
        UUID id = player.getUniqueId();
        if (!pendingInitial.add(id)) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            pendingInitial.remove(id);
            if (player.isOnline()) publish(player, true, false);
        }, 1L);
    }

    void afterCast(Player player) {
        // MagicSpells and some /mycli casts can complete their mana mutation at
        // the end of the current tick. Read the final value on the next tick.
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (player.isOnline()) publish(player, false, false);
        });
    }

    private void poll() {
        for (Player player : Bukkit.getOnlinePlayers()) publish(player, false, true);
    }

    private void publish(Player player, boolean force, boolean recovery) {
        if (!player.isOnline()) return;
        SkillsUser user = AuraSkillsApi.get().getUser(player.getUniqueId());
        JsonObject root = new JsonObject();
        root.addProperty("schemaVersion", 1);
        if (user == null || !user.isLoaded()) {
            root.add("mana", JsonNull.INSTANCE);
        } else {
            JsonObject mana = new JsonObject();
            mana.addProperty("current", finite(user.getMana()));
            mana.addProperty("max", finite(user.getMaxMana()));
            root.add("mana", mana);
        }
        root.add("abilities", abilities.build(player));
        root.add("equipmentEffects", DungeonGearAura.effects(player));
        if (plugin.professions() != null) root.add("profession", plugin.professions().state(player));
        StatePayload payload = encodeBounded(root);
        if (payload == null) {
            plugin.getLogger().warning("Agent state exceeds 16384 bytes even without abilities; not sent.");
            return;
        }
        byte[] bytes = payload.bytes();
        String json = payload.json();
        long now = System.currentTimeMillis();
        LastState last = lastStates.get(player.getUniqueId());
        if (!force && last != null) {
            if (json.equals(last.json())) return;
            if (recovery && now - last.sentAt() < RECOVERY_INTERVAL_MS) return;
        }
        if (player.getListeningPluginChannels().contains(CHANNEL)) {
            player.sendPluginMessage(plugin, CHANNEL, bytes);
        } else {
            // Mineflayer clients currently do not register plugin channels.
            // Paper's messenger silently drops those; send the same raw payload
            // to this connection alone, as mcagent:protection already does.
            CraftPlayer craft = (CraftPlayer) player;
            craft.getHandle().connection.send(new ClientboundCustomPayloadPacket(
                    new DiscardedPayload(new ResourceLocation(CHANNEL), Unpooled.wrappedBuffer(bytes))));
        }
        lastStates.put(player.getUniqueId(), new LastState(json, now));
    }

    static StatePayload encodeBounded(JsonObject root) {
        String json = root.toString();
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        var entries = root.getAsJsonArray("abilities");
        while (bytes.length > MAX_BYTES && entries.size() > 0) {
            entries.remove(entries.size() - 1);
            json = root.toString();
            bytes = json.getBytes(StandardCharsets.UTF_8);
        }
        return bytes.length > MAX_BYTES ? null : new StatePayload(json, bytes);
    }

    private double finite(double value) { return Double.isFinite(value) ? value : 0.0; }
}
