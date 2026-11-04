package org.afuhome.cortieye;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolManager;
import com.comphenix.protocol.events.ListenerPriority;
import com.comphenix.protocol.events.PacketAdapter;
import com.comphenix.protocol.events.PacketContainer;
import com.comphenix.protocol.events.PacketEvent;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.network.protocol.game.ClientboundRemoveMobEffectPacket;
import net.minecraft.network.protocol.game.ClientboundUpdateMobEffectPacket;
import org.afuhome.eye.EyePairs;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.potion.CraftPotionEffectType;
import org.bukkit.craftbukkit.potion.CraftPotionUtil;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Vanilla lights use the local player; Iris uses the attached camera entity. */
final class EyeNightVision {
    private static final PotionEffect OVERLAY = new PotionEffect(PotionEffectType.NIGHT_VISION, 600, 0, true, false, false);
    private record Binding(UUID world, int eyeEntity, UUID subject, int subjectEntity) { }
    private final ProtocolManager protocol;
    private volatile Map<UUID, Binding> bindings = Map.of();

    EyeNightVision(CortiEyeMirrorPlugin plugin, ProtocolManager protocol) {
        this.protocol = protocol;
        protocol.addPacketListener(new PacketAdapter(plugin, ListenerPriority.HIGHEST,
                PacketType.Play.Server.ENTITY_EFFECT, PacketType.Play.Server.REMOVE_ENTITY_EFFECT) {
            @Override public void onPacketSending(PacketEvent event) {
                if (event.isCancelled() || event.isPlayerTemporary() || event.getPlayer() == null) return;
                var binding = bindings.get(event.getPlayer().getUniqueId());
                var entityIds = event.getPacket().getIntegers();
                if (binding == null || entityIds.size() == 0 || entityIds.read(0) != binding.subjectEntity()) return;
                Object packet = event.getPacket().getHandle();
                var effect = packet instanceof ClientboundUpdateMobEffectPacket update ? update.getEffect()
                        : ((ClientboundRemoveMobEffectPacket) packet).effect();
                if (CraftPotionEffectType.minecraftHolderToBukkit(effect).equals(PotionEffectType.NIGHT_VISION)) event.setCancelled(true);
            }
        });
    }

    void tick(List<EyePairs.Pair> pairs, boolean refresh, String primaryCamera, boolean primaryEnabled) {
        Map<UUID, Binding> next = new HashMap<>();
        for (var pair : pairs) {
            if (!primaryEnabled && pair.eye().equalsIgnoreCase(primaryCamera)) continue;
            Player eye = Bukkit.getPlayerExact(pair.eye()), target = Bukkit.getPlayerExact(pair.agent());
            if (!CortiEyeMirrorPlugin.isAttached(target, eye)) continue;
            next.put(eye.getUniqueId(), new Binding(eye.getWorld().getUID(), eye.getEntityId(), target.getUniqueId(), target.getEntityId()));
        }
        var previous = bindings;
        if (!previous.equals(next)) {
            bindings = Map.copyOf(next);
            previous.forEach((id, binding) -> {
                if (!binding.equals(next.get(id))) restore(id, binding);
            });
        }
        next.forEach((id, binding) -> {
            if (refresh || !binding.equals(previous.get(id))) {
                Player eye = Bukkit.getPlayer(id);
                if (eye == null) return;
                // Both packets are client-only. Never add the effect to the subject on the server.
                send(eye, binding.eyeEntity(), OVERLAY);
                send(eye, binding.subjectEntity(), OVERLAY);
            }
        });
    }

    void stop() {
        var previous = bindings;
        bindings = Map.of();
        previous.forEach(this::restore);
    }

    private void restore(UUID id, Binding old) {
        Player eye = Bukkit.getPlayer(id), subject = Bukkit.getPlayer(old.subject());
        if (eye == null || eye.getEntityId() != old.eyeEntity() || !eye.getWorld().getUID().equals(old.world())) return;
        send(eye, old.eyeEntity(), eye.getPotionEffect(PotionEffectType.NIGHT_VISION));
        if (subject != null && subject.getEntityId() == old.subjectEntity() && subject.getWorld().getUID().equals(old.world())) {
            send(eye, old.subjectEntity(), subject.getPotionEffect(PotionEffectType.NIGHT_VISION));
        }
    }

    private void send(Player eye, int entityId, PotionEffect effect) {
        if (effect == null) {
            protocol.sendServerPacket(eye, new PacketContainer(PacketType.Play.Server.REMOVE_ENTITY_EFFECT,
                    new ClientboundRemoveMobEffectPacket(entityId, CraftPotionEffectType.bukkitToMinecraftHolder(PotionEffectType.NIGHT_VISION))), false);
        } else {
            protocol.sendServerPacket(eye, new PacketContainer(PacketType.Play.Server.ENTITY_EFFECT,
                    new ClientboundUpdateMobEffectPacket(entityId, CraftPotionUtil.fromBukkit(effect), false)), false);
        }
    }
}
