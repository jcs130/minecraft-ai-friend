package dev.qiandeng.chanting;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/** 0 = spoken input; 1..8 = the player's existing saved shortcut slots. */
public record StaffModePayload(int slot) implements CustomPacketPayload {
    public static final Type<StaffModePayload> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath(QiandengChantingItems.MOD_ID, "mode"));
    public static final StreamCodec<RegistryFriendlyByteBuf, StaffModePayload> CODEC = new StreamCodec<>() {
        public StaffModePayload decode(RegistryFriendlyByteBuf buffer) { return new StaffModePayload(buffer.readVarInt()); }
        public void encode(RegistryFriendlyByteBuf buffer, StaffModePayload value) { buffer.writeVarInt(value.slot()); }
    };
    public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
