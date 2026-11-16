package dev.qiandeng.controls;

import com.mojang.blaze3d.platform.InputConstants;
import java.util.function.BooleanSupplier;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.inventory.ContainerScreen;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModList;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
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
    private final BooleanSupplier wheelPad;
    private final BooleanSupplier guidePad;
    private final ClientQaBridge qa = new ClientQaBridge();

    public QiandengControls(IEventBus modBus) {
        modBus.addListener(this::registerKeys);
        NeoForge.EVENT_BUS.addListener(this::tick);
        NeoForge.EVENT_BUS.addListener(this::openWheelScreen);
        boolean controlify = ModList.get().isLoaded("controlify");
        wheelPad = controlify ? ControlifyBindings.bind("wheel", WHEEL, "dpad_up") : () -> false;
        guidePad = controlify ? ControlifyBindings.bind("guide", GUIDE, "dpad_right") : () -> false;
        LOG.info("[qiandeng-controls] registered F6 wheel and F7 guide; Controlify bindings={}", controlify);
    }

    private void registerKeys(RegisterKeyMappingsEvent event) {
        event.register(WHEEL);
        event.register(GUIDE);
    }

    private void tick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        // Always update latches, even inside a menu; holding a button must not reopen it.
        boolean wheel = wheelEdge.update(WHEEL.isDown() || wheelPad.getAsBoolean());
        boolean guide = guideEdge.update(GUIDE.isDown() || guidePad.getAsBoolean());
        while (WHEEL.consumeClick()) { }
        while (GUIDE.consumeClick()) { }
        if (mc.player != null && mc.screen == null) {
            if (wheel) openWheel();
            else if (guide) mc.setScreen(new FieldGuideScreen());
        }
        qa.tick(mc);
    }

    static void openWheel() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.getConnection() == null) return;
        var commands = mc.getConnection().getCommands().getRoot();
        if (commands.getChild("skillchest") != null) send("skillchest self", false);
        else if (commands.getChild("mycli") != null) send("mycli menu wheel", false);
    }

    static boolean legacyWorld() {
        var connection = Minecraft.getInstance().getConnection();
        return connection != null && connection.getCommands().getRoot().getChild("skillchest") != null;
    }

    private void openWheelScreen(ScreenEvent.Opening event) {
        if (event.getNewScreen() instanceof ContainerScreen container
                && container.getMenu().getRowCount() == 4
                && container.getTitle().getContents() instanceof TranslatableContents title
                && SpellWheelScreen.TITLE_KEY.equals(title.getKey()))
            event.setNewScreen(new SpellWheelScreen(container.getMenu(), container.getTitle()));
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
