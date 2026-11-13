package org.afuhome.agentfriend;

import io.netty.buffer.Unpooled;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;

/** Selects the envelope accepted by the kernel's Bukkit play-channel encoder. */
final class SkillPayload {
    private static final String YOUER = "com.mohistmc.youer.bukkit.messaging.PluginsDiscardedPayload";
    private record YouerCodec(Constructor<?> constructor, Method getType) { }

    private final YouerCodec youer;
    private boolean warned;

    SkillPayload() {
        Class<?> payloadType = null;
        try {
            payloadType = Class.forName(YOUER, false, CustomPacketPayload.class.getClassLoader());
        } catch (ClassNotFoundException paper) {
            // Paper's discard payload accepts the original byte buffer.
        }
        if (payloadType == null) {
            youer = null;
        } else {
            try {
                youer = new YouerCodec(payloadType.getConstructor(CustomPacketPayload.Type.class, byte[].class),
                        payloadType.getMethod("getType", ResourceLocation.class));
            } catch (ReflectiveOperationException changed) {
                throw new IllegalStateException("Youer skill event envelope is incompatible", changed);
            }
        }
    }

    CustomPacketPayload create(String channel, byte[] bytes) throws ReflectiveOperationException {
        var id = ResourceLocation.tryParse(channel);
        if (youer == null) return new DiscardedPayload(id, Unpooled.wrappedBuffer(bytes));
        return (CustomPacketPayload) youer.constructor().newInstance(youer.getType().invoke(null, id), bytes);
    }

    boolean firstFailure() {
        if (warned) return false;
        warned = true;
        return true;
    }
}
