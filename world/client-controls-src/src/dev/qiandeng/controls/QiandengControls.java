package dev.qiandeng.controls;

import com.mojang.blaze3d.platform.InputConstants;
import dev.isxander.controlify.api.ControlifyApi;
import dev.isxander.controlify.api.bind.ControlifyBindApi;
import dev.isxander.controlify.api.bind.InputBinding;
import dev.isxander.controlify.api.bind.InputBindingSupplier;
import dev.isxander.controlify.bindings.BindContext;
import dev.isxander.controlify.bindings.input.ButtonInput;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.common.NeoForge;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod(value = QiandengControls.ID, dist = Dist.CLIENT)
public final class QiandengControls {
    public static final String ID = "qiandeng_controls";
    public static final Logger LOG = LoggerFactory.getLogger(ID);
    public static final KeyMapping WHEEL = new KeyMapping("key.qiandeng_controls.wheel",
            InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_F6, "key.categories.qiandeng_controls");
    public static final KeyMapping GUIDE = new KeyMapping("key.qiandeng_controls.guide",
            InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_F7, "key.categories.qiandeng_controls");
    private final PressEdge wheelEdge = new PressEdge();
    private final PressEdge guideEdge = new PressEdge();
    private final InputBindingSupplier wheelPad;
    private final InputBindingSupplier guidePad;
    private final ClientQaBridge qa = new ClientQaBridge();

    public QiandengControls(IEventBus modBus) {
        modBus.addListener(this::registerKeys);
        NeoForge.EVENT_BUS.addListener(this::tick);
        wheelPad = bind("wheel", WHEEL, "dpad_up");
        guidePad = bind("guide", GUIDE, "dpad_right");
        LOG.info("[qiandeng-controls] registered F6 wheel, F7 guide and editable Controlify bindings");
    }

    private static InputBindingSupplier bind(String name, KeyMapping key, String button) {
        return ControlifyBindApi.get().registerBinding(builder -> builder
                .id(ID, name)
                .name(Component.translatable(key.getName()))
                .description(Component.translatable("binding.qiandeng_controls." + name + ".description"))
                .category(Component.translatable("key.categories.qiandeng_controls"))
                .defaultInput(new ButtonInput(ResourceLocation.fromNamespaceAndPath("controlify", "button/" + button)))
                // No key emulation: this mod consumes the digital edge exactly once.
                .addKeyCorrelation(key).allowedContexts(BindContext.IN_GAME));
    }

    private void registerKeys(RegisterKeyMappingsEvent event) {
        event.register(WHEEL);
        event.register(GUIDE);
    }

    private static boolean padDown(InputBindingSupplier binding) {
        return ControlifyApi.get().getCurrentController().map(controller -> {
            InputBinding input = binding.onOrNull(controller);
            return input != null && input.digitalNow();
        }).orElse(false);
    }

    private void tick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        // Always update latches, even inside a menu; holding a button must not reopen it.
        boolean wheel = wheelEdge.update(WHEEL.isDown() || padDown(wheelPad));
        boolean guide = guideEdge.update(GUIDE.isDown() || padDown(guidePad));
        while (WHEEL.consumeClick()) { }
        while (GUIDE.consumeClick()) { }
        if (mc.player != null && mc.screen == null) {
            if (wheel) send("skillchest self", false);
            else if (guide) mc.setScreen(new FieldGuideScreen());
        }
        qa.tick(mc);
    }

    /** Uses the signed-in player's normal command connection; no RCON/OP/network bypass. */
    public static void send(String command, boolean showChat) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.getConnection() == null) return;
        mc.setScreen(null);
        mc.getConnection().sendCommand(command);
        if (showChat) mc.setScreen(new ChatScreen(""));
        LOG.info("[qiandeng-controls] player action {}", command.split(" ")[0]);
    }
}
