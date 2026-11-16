package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.ai.agent.tool.ITool;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.IntegerParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.ObjectParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.Parameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.StringParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.resources.ResourceLocation;

final class MaidEquipTool implements ITool<MaidEquipTool.Input> {
    record Input(String slot, int backpackSlot, ResourceLocation item) {}

    private static final Codec<Input> CODEC = RecordCodecBuilder.create(builder -> builder.group(
            Codec.STRING.fieldOf("equipment_slot").forGetter(Input::slot),
            Codec.intRange(0, 255).fieldOf("backpack_slot").forGetter(Input::backpackSlot),
            ResourceLocation.CODEC.fieldOf("expected_item").forGetter(Input::item)
    ).apply(builder, Input::new));

    @Override public String id() { return "equip_from_backpack"; }

    @Override public String summary(EntityMaid maid) {
        return "Equip one actual item from your own backpack. Your displaced equipment goes into that same backpack slot.";
    }

    @Override public Parameter parameters(ObjectParameter root, EntityMaid maid) {
        return root.addProperties("equipment_slot", StringParameter.create()
                        .addEnumValues("mainhand", "offhand", "head", "chest", "legs", "feet"), true)
                .addProperties("backpack_slot", IntegerParameter.create().setMinimum(0)
                        .setMaximum(Math.min(255, maid.getMaidInv().getSlots() - 1)), true)
                .addProperties("expected_item", StringParameter.create()
                        .setDescription("Exact namespaced item ID shown at this backpack slot in your current physical state"), true);
    }

    @Override public boolean trigger(EntityMaid maid, ChatCompletion completion) {
        var site = maid.getAiChatManager().getLLMSite();
        return site != null && MaidBrainControl.isRoutedSite(site.id(), maid.getUUID());
    }

    @Override public Codec<Input> codec() { return CODEC; }

    @Override public LLMCallback onCall(String callId, Input input, LLMCallback callback) {
        String result;
        if (!trigger(callback.getMaid(), null)) return callback.addToolResult("No managed equipment access", callId);
        try {
            MaidAgent.equip(callback.getMaid(), input.slot(), input.backpackSlot(), input.item());
            result = "Equipped " + input.item() + " in " + input.slot() + " from backpack slot " + input.backpackSlot();
        } catch (IllegalArgumentException refusal) {
            result = "Equipment unchanged. " + refusal.getMessage();
        }
        return callback.addToolResult(result, callId);
    }
}
