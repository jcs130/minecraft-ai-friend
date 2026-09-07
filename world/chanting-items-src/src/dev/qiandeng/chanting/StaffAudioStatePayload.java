package dev.qiandeng.chanting;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/** kind 0 is a server gesture nonce; kind 1 acknowledges the exact recorder fence. */
public record StaffAudioStatePayload(int kind, String gestureId, int revision, long floor, boolean accepted) implements CustomPacketPayload {
    public static final Type<StaffAudioStatePayload> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath(QiandengChantingItems.MOD_ID, "audio_state_v1"));
    public static final StreamCodec<RegistryFriendlyByteBuf, StaffAudioStatePayload> CODEC = new StreamCodec<>() {
        public StaffAudioStatePayload decode(RegistryFriendlyByteBuf b) { return new StaffAudioStatePayload(b.readVarInt(), b.readUtf(96), b.readVarInt(), b.readVarLong(), b.readBoolean()); }
        public void encode(RegistryFriendlyByteBuf b, StaffAudioStatePayload p) { b.writeVarInt(p.kind()); b.writeUtf(p.gestureId(), 96); b.writeVarInt(p.revision()); b.writeVarLong(p.floor()); b.writeBoolean(p.accepted()); }
    };
    public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
