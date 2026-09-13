package dev.qiandeng.chanting.client;

import dev.isxander.controlify.api.ControlifyApi;
import dev.isxander.controlify.api.bind.ControlifyBindApi;
import dev.isxander.controlify.api.bind.InputBinding;
import dev.isxander.controlify.api.bind.InputBindingSupplier;
import dev.isxander.controlify.bindings.BindContext;
import dev.isxander.controlify.bindings.ControlifyBindings;
import dev.isxander.controlify.bindings.input.ButtonInput;
import net.minecraft.client.KeyMapping;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

/** Loaded reflectively only when the optional Controlify client mod is present. */
public final class ControlifyStaffInput implements StaffController {
    private final InputBindingSupplier previous, next;
    public ControlifyStaffInput(KeyMapping[] keys) {
        previous = register("previous_slot", "left_shoulder", keys[0]);
        next = register("next_slot", "right_shoulder", keys[1]);
    }
    private InputBindingSupplier register(String id, String button, KeyMapping key) {
        return ControlifyBindApi.get().registerBinding(builder -> builder.id("qiandeng_chanting", id)
                .name(Component.translatable("key.qiandeng_chanting." + id))
                .description(Component.translatable("binding.qiandeng_chanting." + id + ".description"))
                .category(Component.translatable("key.categories.qiandeng_chanting"))
                .defaultInput(new ButtonInput(ResourceLocation.fromNamespaceAndPath("controlify", "button/" + button)))
                .addKeyCorrelation(key).allowedContexts(BindContext.IN_GAME));
    }
    private InputBinding current(InputBindingSupplier supplier) {
        return ControlifyApi.get().getCurrentController().map(supplier::onOrNull).orElse(null);
    }
    private boolean down(InputBindingSupplier supplier) {
        InputBinding binding = current(supplier);
        return binding != null && binding.digitalNow();
    }
    private Component glyph(InputBindingSupplier supplier, String fallback) {
        InputBinding binding = current(supplier);
        return binding == null ? Component.literal(fallback) : binding.inputGlyph();
    }
    public boolean previousDown() { return down(previous); }
    public boolean nextDown() { return down(next); }
    public Component previousGlyph() { return glyph(previous, "LB / L1"); }
    public Component nextGlyph() { return glyph(next, "RB / R1"); }
    public boolean usePhysicallyHeld() {
        return ControlifyApi.get().getCurrentController().map(controller -> {
            InputBinding binding = ControlifyBindings.USE.onOrNull(controller);
            return binding != null && controller.input().map(input ->
                    binding.boundInput().state(input.stateNow()) >= input.settings().buttonActivationThreshold).orElse(false);
        }).orElse(false);
    }
}
