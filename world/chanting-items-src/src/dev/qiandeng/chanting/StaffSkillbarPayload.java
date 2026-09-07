package dev.qiandeng.chanting;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

public record StaffSkillbarPayload(String json) implements CustomPacketPayload {
    public static final Type<StaffSkillbarPayload> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath(QiandengChantingItems.MOD_ID, "skillbar"));
    public static final StreamCodec<RegistryFriendlyByteBuf, StaffSkillbarPayload> CODEC = new StreamCodec<>() {
        public StaffSkillbarPayload decode(RegistryFriendlyByteBuf buffer) { return new StaffSkillbarPayload(buffer.readUtf(8192)); }
        public void encode(RegistryFriendlyByteBuf buffer, StaffSkillbarPayload value) { buffer.writeUtf(value.json(), 8192); }
    };
    public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
