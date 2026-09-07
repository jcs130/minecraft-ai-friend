package dev.qiandeng.chanting;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/** No target field: a client can cancel only its own gesture. */
public record StaffStopPayload() implements CustomPacketPayload {
    public static final Type<StaffStopPayload> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath(QiandengChantingItems.MOD_ID, "stop"));
    public static final StreamCodec<RegistryFriendlyByteBuf, StaffStopPayload> CODEC = StreamCodec.unit(new StaffStopPayload());
    public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
