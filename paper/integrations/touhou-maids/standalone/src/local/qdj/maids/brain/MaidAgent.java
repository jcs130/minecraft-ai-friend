package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import java.util.StringJoiner;
import java.time.Duration;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.server.level.ServerPlayer;

final class MaidAgent {
    private static final EquipmentSlot[] GEAR = {
            EquipmentSlot.MAINHAND, EquipmentSlot.OFFHAND, EquipmentSlot.HEAD,
            EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET
    };
    private final MaidAgentsConfig.Binding binding;
    private long revision;
    private long lastPublicChatNanos;
    private MaidVisitorDialogue visitor;

    MaidAgent(MaidAgentsConfig.Binding binding) { this.binding = binding; }
    MaidAgentsConfig.Binding binding() { return binding; }
    long revision() { return revision; }
    void invalidateActions() { revision++; }

    boolean matches(EntityMaid maid) {
        return maid.isAlive() && !maid.isRemoved() && !maid.level().isClientSide()
                && binding.maidId().equals(maid.getUUID()) && binding.ownerId().equals(maid.getOwnerUUID());
    }

    String brain(EntityMaid maid) {
        var chat = maid.getAiChatManager();
        var site = chat.getLLMSite();
        if (site == null) return "unconfigured";
        for (var row : binding.choices().entrySet()) {
            if (row.getValue().site().equals(site.id()) && row.getValue().model().equals(chat.getLLMModel())) {
                return row.getKey();
            }
        }
        return "unmanaged";
    }

    void select(EntityMaid maid, String name) {
        var target = binding.choices().get(name);
        if (target == null || !MaidBrainControl.isRoutedSite(target.site(), binding.maidId())) {
            throw new IllegalArgumentException("Brain choice unavailable. Available: " + binding.choices().keySet());
        }
        if (name.equals(brain(maid))) return;
        var chat = maid.getAiChatManager();
        chat.llmSite = target.site();
        chat.llmModel = target.model();
        revision++;
    }

    void voice(EntityMaid maid) {
        var voice = binding.voice();
        if (voice == null || AvailableSites.getTTSSite(voice.site()) == null
                || !AvailableSites.getTTSSite(voice.site()).enabled()) {
            throw new IllegalArgumentException("Configure an enabled native TTS site for this maid");
        }
        var chat = maid.getAiChatManager();
        chat.ttsSite = voice.site();
        chat.ttsModel = voice.model();
        chat.ttsLanguage = voice.language();
    }

    void visit(EntityMaid maid, ServerPlayer player, String text) {
        String persona = binding.visitorPersona();
        if (persona == null) throw new IllegalArgumentException("This maid does not receive visitors.");
        if (text.isBlank() || text.codePointCount(0, text.length()) > 140 ||
                text.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Say one line of up to 140 characters.");
        }
        var site = maid.getAiChatManager().getLLMSite();
        if (site == null || !site.enabled() || !binding.choices().containsKey(brain(maid))) {
            throw new IllegalArgumentException("This maid's dialogue is temporarily unavailable.");
        }
        long now = System.nanoTime();
        if (visitor != null || (lastPublicChatNanos != 0 && now - lastPublicChatNanos < Duration.ofSeconds(8).toNanos())) {
            throw new IllegalArgumentException("The maid is finishing another conversation. Try again in a moment.");
        }
        lastPublicChatNanos = now;
        var dialogue = new MaidVisitorDialogue(maid, player, persona, text, () -> visitor = null);
        visitor = dialogue;
        try {
            site.client().chat(dialogue);
        } catch (RuntimeException failure) {
            dialogue.onFailure(null, failure, 503);
        }
    }

    static void mode(EntityMaid maid, String mode) {
        switch (mode) {
            case "follow" -> { maid.setHomeModeEnable(false); maid.setInSittingPose(false); }
            case "stay" -> maid.setInSittingPose(true);
            case "home" -> {
                maid.setInSittingPose(false);
                if (!maid.isHomeModeEnable()) {
                    maid.setHomeModeEnable(true);
                    maid.getSchedulePos().setHomeModeEnable(maid, maid.blockPosition());
                }
            }
            default -> throw new IllegalArgumentException("Use follow, stay or home");
        }
    }

    static void task(EntityMaid maid, ResourceLocation id) {
        var task = TaskManager.findTask(id).filter(value -> value.isEnable(maid) && !value.isHidden(maid))
                .orElseThrow(() -> new IllegalArgumentException("This native task is unavailable for the current body or equipment"));
        maid.setTask(task);
    }

    static String tasks(EntityMaid maid) {
        return TaskManager.getNotHiddenTaskList(maid).stream()
                .filter(task -> task.isEnable(maid)).map(task -> task.getUid().toString()).sorted()
                .collect(java.util.stream.Collectors.joining(", "));
    }

    static void equip(EntityMaid maid, String name, int sourceSlot) {
        equip(maid, name, sourceSlot, null);
    }

    static void equip(EntityMaid maid, String name, int sourceSlot, ResourceLocation expectedItem) {
        EquipmentSlot slot = null;
        for (EquipmentSlot allowed : GEAR) if (allowed.getName().equals(name)) slot = allowed;
        if (slot == null) throw new IllegalArgumentException("Use mainhand, offhand, head, chest, legs or feet");
        var bag = maid.getMaidInv();
        if (sourceSlot < 0 || sourceSlot >= bag.getSlots()) throw new IllegalArgumentException("Backpack slot is out of range");
        ItemStack item = bag.getStackInSlot(sourceSlot).copy();
        if (item.isEmpty() || item.getCount() != 1) {
            throw new IllegalArgumentException("The source slot needs one item");
        }
        if (expectedItem != null && !expectedItem.equals(BuiltInRegistries.ITEM.getKey(item.getItem()))) {
            throw new IllegalArgumentException("The observed source item changed. Read the current backpack before acting.");
        }
        if (slot != EquipmentSlot.MAINHAND && slot != EquipmentSlot.OFFHAND && !item.canEquip(slot, maid)) {
            throw new IllegalArgumentException("The item does not fit this equipment slot");
        }
        ItemStack previous = maid.getItemBySlot(slot).copy();
        if (expectedItem != null && !previous.isEmpty() && ItemStack.isSameItem(previous, item)) {
            throw new IllegalArgumentException("This item type is already equipped. Use the native menu to swap variants.");
        }
        if (!previous.isEmpty() && previous.has(net.minecraft.core.component.DataComponents.ENCHANTMENTS)
                && net.minecraft.world.item.enchantment.EnchantmentHelper.has(previous,
                        net.minecraft.world.item.enchantment.EnchantmentEffectComponents.PREVENT_ARMOR_CHANGE)) {
            throw new IllegalArgumentException("The current equipment cannot be removed");
        }
        if (!previous.isEmpty() && (!bag.isItemValid(sourceSlot, previous) ||
                previous.getCount() > Math.min(bag.getSlotLimit(sourceSlot), previous.getMaxStackSize()))) {
            throw new IllegalArgumentException("The displaced item cannot go in the source slot");
        }
        bag.setStackInSlot(sourceSlot, previous);
        try {
            maid.setItemSlot(slot, item);
        } catch (RuntimeException failure) {
            bag.setStackInSlot(sourceSlot, item);
            maid.setItemSlot(slot, previous);
            throw failure;
        }
    }

    String observation(EntityMaid maid) {
        var gear = new StringJoiner(", ", "{", "}");
        for (EquipmentSlot slot : GEAR) gear.add(slot.getName() + "=" + item(maid.getItemBySlot(slot)));
        var bag = new StringJoiner(", ", "[", "]");
        var inventory = maid.getMaidInv();
        for (int i = 0; i < inventory.getSlots(); i++) {
            ItemStack stack = inventory.getStackInSlot(i);
            if (!stack.isEmpty()) bag.add(i + "=" + item(stack));
        }
        String motion = maid.isMaidInSittingPose() ? "stay" : maid.isHomeModeEnable() ? "home" : "follow";
        return "brain=" + brain(maid) + " mode=" + motion + " task=" + maid.getTask().getUid()
                + " equipment=" + gear + " backpack=" + bag;
    }

    private static String item(ItemStack stack) {
        return stack.isEmpty() ? "empty" : BuiltInRegistries.ITEM.getKey(stack.getItem()) + "×" + stack.getCount();
    }
}
