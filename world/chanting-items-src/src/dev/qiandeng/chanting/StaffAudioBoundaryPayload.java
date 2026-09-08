package dev.qiandeng.chanting;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/** Separate from instantaneous mode selection: this only unlocks additional voice PTT. */
public record StaffAudioBoundaryPayload(String gestureId, int revision, long floor) implements CustomPacketPayload {
    public static final Type<StaffAudioBoundaryPayload> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath(QiandengChantingItems.MOD_ID, "audio_boundary_v1"));
    public static final StreamCodec<RegistryFriendlyByteBuf, StaffAudioBoundaryPayload> CODEC = new StreamCodec<>() {
        public StaffAudioBoundaryPayload decode(RegistryFriendlyByteBuf b) { return new StaffAudioBoundaryPayload(b.readUtf(96), b.readVarInt(), b.readVarLong()); }
        public void encode(RegistryFriendlyByteBuf b, StaffAudioBoundaryPayload p) { b.writeUtf(p.gestureId(), 96); b.writeVarInt(p.revision()); b.writeVarLong(p.floor()); }
    };
    public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
