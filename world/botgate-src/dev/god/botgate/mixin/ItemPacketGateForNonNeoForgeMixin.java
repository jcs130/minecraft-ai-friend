package dev.god.botgate.mixin;

import dev.god.botgate.VanillaItemComponents;
import net.minecraft.advancements.Advancement;
import net.minecraft.advancements.AdvancementHolder;
import net.minecraft.advancements.DisplayInfo;
import net.minecraft.core.NonNullList;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientboundContainerSetContentPacket;
import net.minecraft.network.protocol.game.ClientboundContainerSetSlotPacket;
import net.minecraft.network.protocol.game.ClientboundUpdateAdvancementsPacket;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.common.extensions.ICommonPacketListener;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * NeoForge data-component codecs are not known to vanilla/Mineflayer clients.
 * Unknown types have no payload length prefix, so one mod component misaligns
 * every later item in a window or advancement packet. Filter only those entries
 * in an outgoing copy, preserving slot/state IDs, vanilla components and progress.
 * NeoForge connections take the original packet path without any conversion.
 */
@Mixin(ServerCommonPacketListenerImpl.class)
public class ItemPacketGateForNonNeoForgeMixin {
    @Unique private int botgate$itemPacketCopies;
    @Unique private Packet<?> botgate$sanitizedItemPacket;

    @Inject(method = "send(Lnet/minecraft/network/protocol/Packet;)V", at = @At("HEAD"), cancellable = true)
    private void botgate$sanitizeItems(Packet<?> packet, CallbackInfo ci) {
        if (((ICommonPacketListener) (Object) this).getConnectionType().isNeoForge()) return;
        if (packet == botgate$sanitizedItemPacket) return;
        Packet<?> clean = botgate$copyPacket(packet);
        if (clean == packet) return;
        if (++botgate$itemPacketCopies <= 3) {
            System.out.println("[ITEM-GATE] non-NeoForge component copy: " + packet.getClass().getSimpleName());
        }
        ci.cancel();
        // An explicit identity guard also bounds resend if another mod attaches
        // components during send. It affects only this exact outgoing packet.
        botgate$sanitizedItemPacket = clean;
        try { ((ServerCommonPacketListenerImpl) (Object) this).send(clean); }
        finally { botgate$sanitizedItemPacket = null; }
    }

    @Unique
    private static Packet<?> botgate$copyPacket(Packet<?> packet) {
        if (packet instanceof ClientboundContainerSetContentPacket content) {
            if (!content.getItems().stream().anyMatch(VanillaItemComponents::needsSanitizing)
                    && !VanillaItemComponents.needsSanitizing(content.getCarriedItem())) return packet;
            NonNullList<ItemStack> items = NonNullList.create();
            items.addAll(content.getItems());
            // This constructor calls ItemStack.copy() again. Clean its OWN stacks
            // after that final copy, or constructor mixins reinsert mod components.
            ClientboundContainerSetContentPacket copy = new ClientboundContainerSetContentPacket(
                    content.getContainerId(), content.getStateId(), items, content.getCarriedItem());
            copy.getItems().forEach(VanillaItemComponents::sanitizeOwned);
            VanillaItemComponents.sanitizeOwned(copy.getCarriedItem());
            return copy;
        }
        if (packet instanceof ClientboundContainerSetSlotPacket slot) {
            if (!VanillaItemComponents.needsSanitizing(slot.getItem())) return packet;
            ClientboundContainerSetSlotPacket copy = new ClientboundContainerSetSlotPacket(slot.getContainerId(),
                    slot.getStateId(), slot.getSlot(), slot.getItem());
            VanillaItemComponents.sanitizeOwned(copy.getItem());
            return copy;
        }
        if (packet instanceof ClientboundUpdateAdvancementsPacket advancements) {
            List<AdvancementHolder> added = new ArrayList<>(advancements.getAdded().size());
            boolean changed = false;
            for (AdvancementHolder holder : advancements.getAdded()) {
                Advancement value = holder.value();
                if (value.display().isPresent()) {
                    DisplayInfo display = value.display().get();
                    ItemStack icon = VanillaItemComponents.sanitize(display.getIcon());
                    if (icon != display.getIcon()) {
                        DisplayInfo copy = new DisplayInfo(icon, display.getTitle(), display.getDescription(),
                                display.getBackground(), display.getType(), display.shouldShowToast(),
                                display.shouldAnnounceChat(), display.isHidden());
                        copy.setLocation(display.getX(), display.getY());
                        value = new Advancement(value.parent(), Optional.of(copy), value.rewards(),
                                value.criteria(), value.requirements(), value.sendsTelemetryEvent(), value.name());
                        holder = new AdvancementHolder(holder.id(), value);
                        changed = true;
                    }
                }
                added.add(holder);
            }
            return changed ? new ClientboundUpdateAdvancementsPacket(advancements.shouldReset(), added,
                    advancements.getRemoved(), advancements.getProgress()) : packet;
        }
        return packet;
    }
}
