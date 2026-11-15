package org.afuhome.cortieye;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.events.PacketContainer;
import net.minecraft.network.protocol.game.ClientboundRemoveMobEffectPacket;
import net.minecraft.network.protocol.game.ClientboundUpdateMobEffectPacket;
import net.minecraft.world.effect.MobEffectInstance;

final class EyePresentationPacket {
    private EyePresentationPacket() {}

    static boolean usesNativePacket(PacketType type) {
        return type == PacketType.Play.Server.ENTITY_EFFECT
                || type == PacketType.Play.Server.REMOVE_ENTITY_EFFECT
                || type == PacketType.Play.Server.ENTITY_SOUND;
    }

    static PacketContainer capture(PacketContainer packet) {
        // These vanilla packets have immutable fields and can be sent to multiple viewers.
        // The effect ID is replaced by constructing a new packet for each viewer.
        return usesNativePacket(packet.getType())
                ? new PacketContainer(packet.getType(), packet.getHandle())
                : packet.shallowClone();
    }

    static PacketContainer retargetEffect(PacketContainer packet, int targetId, int cameraId) {
        if (packet.getHandle() instanceof ClientboundUpdateMobEffectPacket update
                && update.getEntityId() == targetId) {
            var effect = new MobEffectInstance(update.getEffect(), update.getEffectDurationTicks(),
                    update.getEffectAmplifier(), update.isEffectAmbient(), update.isEffectVisible(),
                    update.effectShowsIcon());
            return new PacketContainer(packet.getType(),
                    new ClientboundUpdateMobEffectPacket(cameraId, effect, update.shouldBlend()));
        }
        if (packet.getHandle() instanceof ClientboundRemoveMobEffectPacket remove
                && remove.entityId() == targetId) {
            return new PacketContainer(packet.getType(),
                    new ClientboundRemoveMobEffectPacket(cameraId, remove.effect()));
        }
        return null;
    }
}
