import com.mojang.serialization.Codec;
import dev.god.botgate.VanillaItemComponents;
import net.minecraft.advancements.Advancement;
import net.minecraft.advancements.AdvancementHolder;
import net.minecraft.advancements.AdvancementRequirements;
import net.minecraft.advancements.AdvancementRewards;
import net.minecraft.advancements.AdvancementType;
import net.minecraft.advancements.DisplayInfo;
import net.minecraft.SharedConstants;
import net.minecraft.core.NonNullList;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientboundContainerSetContentPacket;
import net.minecraft.network.protocol.game.ClientboundContainerSetSlotPacket;
import net.minecraft.network.protocol.game.ClientboundUpdateAdvancementsPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Runs against MC 1.21.1 base classes from the installed server, without a world. */
public class VanillaItemComponentsTest {
    private static int assertions;
    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        ItemStack original = new ItemStack(Items.PAPER, 2);
        original.set(DataComponents.CUSTOM_NAME, Component.literal("skill icon"));
        check(VanillaItemComponents.sanitize(original) == original, "vanilla identity");
        DataComponentType<String> unknown = DataComponentType.<String>builder()
                .persistent(Codec.STRING).networkSynchronized(ByteBufCodecs.STRING_UTF8).build();
        original.set(unknown, "mod payload");
        ItemStack clean = VanillaItemComponents.sanitize(original);
        check(clean != original, "copy required");
        check(original.has(unknown), "server stack unchanged");
        check(!clean.has(unknown), "unknown codec removed");
        check(clean.getCount() == 2 && clean.is(Items.PAPER), "item and count preserved");
        check(clean.get(DataComponents.CUSTOM_NAME).getString().equals("skill icon"), "name preserved");
        check(VanillaItemComponents.sanitize(clean) == clean, "idempotent recursion guard");
        ItemStack lateInitialized = clean.copy();
        lateInitialized.set(unknown, "constructor reinsertion");
        VanillaItemComponents.sanitizeOwned(lateInitialized);
        check(!lateInitialized.has(unknown), "final-copy constructor additions removed");
        check(lateInitialized.getCount() == 2 && lateInitialized.get(DataComponents.CUSTOM_NAME)
                .getString().equals("skill icon"), "final-copy vanilla fields retained");
        Method copy = Class.forName("dev.god.botgate.mixin.ItemPacketGateForNonNeoForgeMixin")
                .getDeclaredMethod("botgate$copyPacket", Packet.class);
        copy.setAccessible(true);
        var slot = new ClientboundContainerSetSlotPacket(8, 97, 4, original);
        var cleanSlot = (ClientboundContainerSetSlotPacket) copy.invoke(null, slot);
        check(cleanSlot.getContainerId() == 8 && cleanSlot.getStateId() == 97
                && cleanSlot.getSlot() == 4, "slot coordinates preserved");
        check(!cleanSlot.getItem().has(unknown), "set_slot filtered");
        check(slot.getItem().has(unknown), "source packet unchanged");
        check(copy.invoke(null, cleanSlot) == cleanSlot, "slot resend terminates");

        NonNullList<ItemStack> items = NonNullList.of(ItemStack.EMPTY, clean, original, ItemStack.EMPTY);
        var content = new ClientboundContainerSetContentPacket(9, 98, items, original);
        var cleanContent = (ClientboundContainerSetContentPacket) copy.invoke(null, content);
        check(cleanContent.getContainerId() == 9 && cleanContent.getStateId() == 98,
                "container version preserved");
        check(cleanContent.getItems().size() == 3 && cleanContent.getItems().get(2).isEmpty(),
                "slot count and empty slots preserved");
        check(cleanContent.getItems().stream().noneMatch(s -> s.has(unknown))
                && !cleanContent.getCarriedItem().has(unknown), "inventory and carried item filtered");
        check(content.getItems().get(1).has(unknown), "inventory packet source unchanged");
        check(copy.invoke(null, cleanContent) == cleanContent, "container resend terminates");

        DisplayInfo display = new DisplayInfo(original, Component.literal("A"), Component.literal("B"),
                Optional.of(ResourceLocation.parse("minecraft:test.png")), AdvancementType.CHALLENGE,
                true, false, true);
        display.setLocation(1.5f, 2.5f);
        Advancement advancement = new Advancement(Optional.of(ResourceLocation.parse("minecraft:parent")),
                Optional.of(display), AdvancementRewards.EMPTY, Map.of(),
                new AdvancementRequirements(List.of()), true);
        ResourceLocation id = ResourceLocation.parse("probe:test");
        var packet = new ClientboundUpdateAdvancementsPacket(true,
                List.of(new AdvancementHolder(id, advancement)), Set.of(ResourceLocation.parse("probe:removed")), Map.of());
        var cleanPacket = (ClientboundUpdateAdvancementsPacket) copy.invoke(null, packet);
        var value = cleanPacket.getAdded().getFirst().value();
        var cleanDisplay = value.display().orElseThrow();
        check(cleanPacket.shouldReset() && cleanPacket.getAdded().getFirst().id().equals(id)
                && cleanPacket.getRemoved().equals(packet.getRemoved())
                && cleanPacket.getProgress().equals(packet.getProgress()), "advancement envelope preserved");
        check(value.parent().equals(advancement.parent()) && value.requirements().equals(advancement.requirements())
                && value.sendsTelemetryEvent(), "advancement semantics preserved");
        check(!cleanDisplay.getIcon().has(unknown) && display.getIcon().has(unknown), "icon copy only");
        check(cleanDisplay.getX() == 1.5f && cleanDisplay.getY() == 2.5f
                && cleanDisplay.getTitle().equals(display.getTitle())
                && cleanDisplay.getDescription().equals(display.getDescription())
                && cleanDisplay.getBackground().equals(display.getBackground())
                && cleanDisplay.getType() == display.getType()
                && cleanDisplay.shouldShowToast() && !cleanDisplay.shouldAnnounceChat() && cleanDisplay.isHidden(),
                "display presentation preserved");
        check(copy.invoke(null, cleanPacket) == cleanPacket, "advancement resend terminates");
        System.out.println("VanillaItemComponents: " + assertions + " assertions passed");
    }
    private static void check(boolean value, String label) {
        assertions++;
        if (!value) throw new AssertionError(label);
    }
}
