package dev.qiandeng.maw.numencompat.mixin;
import dev.qiandeng.maw.numencompat.OptionalTlmAttachments;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import net.neoforged.neoforge.attachment.AttachmentSync;
import net.neoforged.neoforge.network.payload.FrozenRegistryPayload;
import net.neoforged.neoforge.registries.RegistrySnapshot;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(ServerCommonPacketListenerImpl.class)
public abstract class OptionalTlmRegistryMixin {
    @ModifyVariable(method="send(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketSendListener;)V",at=@At("HEAD"),argsOnly=true,require=1)
    private Packet<?> maw$optionalOutfitRegistry(Packet<?> packet) {
        var self=(ServerCommonPacketListenerImpl)(Object)this;
        if(OptionalTlmAttachments.capable(self)||!(packet instanceof ClientboundCustomPayloadPacket p)||
            !(p.payload() instanceof FrozenRegistryPayload frozen)||!OptionalTlmAttachments.REGISTRY.equals(frozen.registryName())||
            !frozen.snapshot().getIds().containsValue(OptionalTlmAttachments.OUTFIT))return packet;
        // Never mutate the shared server snapshot, registry or another peer's mapping.
        var copy=new RegistrySnapshot(AttachmentSync.SYNCED_ATTACHMENT_TYPES,false);
        if(!copy.getIds().equals(frozen.snapshot().getIds())||!copy.getAliases().equals(frozen.snapshot().getAliases()))
            throw new IllegalStateException("optional_outfit_registry_snapshot_changed");
        ((RegistrySnapshotAccessor)(Object)copy).maw$mutableIds().int2ObjectEntrySet().removeIf(e->OptionalTlmAttachments.OUTFIT.equals(e.getValue()));
        return new ClientboundCustomPayloadPacket(new FrozenRegistryPayload(frozen.registryName(),copy));
    }
}
