package dev.qiandeng.controls;

import dev.isxander.controlify.api.ControlifyApi;
import dev.isxander.controlify.api.bind.ControlifyBindApi;
import dev.isxander.controlify.api.bind.InputBinding;
import dev.isxander.controlify.api.bind.InputBindingSupplier;
import dev.isxander.controlify.bindings.BindContext;
import dev.isxander.controlify.bindings.input.ButtonInput;
import java.util.function.BooleanSupplier;
import net.minecraft.client.KeyMapping;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

/** Loaded only when the desktop controller mod is present. */
final class ControlifyBindings {
    private ControlifyBindings() {}

    static BooleanSupplier bind(String name, KeyMapping key, String button) {
        InputBindingSupplier binding = ControlifyBindApi.get().registerBinding(builder -> builder
                .id(QiandengControls.ID, name)
                .name(Component.translatable(key.getName()))
                .description(Component.translatable("binding.qiandeng_controls." + name + ".description"))
                .category(Component.translatable("key.categories.qiandeng_controls"))
                .defaultInput(new ButtonInput(ResourceLocation.fromNamespaceAndPath("controlify", "button/" + button)))
                .addKeyCorrelation(key).allowedContexts(BindContext.IN_GAME));
        return () -> ControlifyApi.get().getCurrentController().map(controller -> {
            InputBinding input = binding.onOrNull(controller);
            return input != null && input.digitalNow();
        }).orElse(false);
    }
}
