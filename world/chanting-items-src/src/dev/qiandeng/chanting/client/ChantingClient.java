package dev.qiandeng.chanting.client;

import com.mojang.blaze3d.platform.InputConstants;
import dev.qiandeng.chanting.QiandengChantingItems;
import dev.qiandeng.chanting.StaffSkillbarState;
import dev.qiandeng.chanting.StaffStopPayload;
import dev.qiandeng.chanting.StaffModePayload;
import dev.qiandeng.chanting.StaffAudioMailbox;
import dev.qiandeng.chanting.StaffAudioBoundaryPayload;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderGuiEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Non-blocking staff input; no menu, provider, microphone or cast implementation. */
@EventBusSubscriber(modid = QiandengChantingItems.MOD_ID, value = Dist.CLIENT,
        bus = EventBusSubscriber.Bus.GAME)
public final class ChantingClient {
    private static final StaffAudioGate AUDIO = new StaffAudioGate();
    public static StaffAudioGate audioGate() { return AUDIO; }
    private static final StaffPttState PTT = new StaffPttState();
    private static final StaffReleaseGate RELEASE = new StaffReleaseGate();
    private static final StaffInputEdge PREVIOUS = new StaffInputEdge(), NEXT = new StaffInputEdge();
    private static final StaffContextGuard CONTEXT = new StaffContextGuard();
    private static final Logger LOG = LoggerFactory.getLogger(QiandengChantingItems.MOD_ID);
    public static final KeyMapping[] KEYS = {
        new KeyMapping("key.qiandeng_chanting.previous_slot", InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_PAGE_UP, "key.categories.qiandeng_chanting"),
        new KeyMapping("key.qiandeng_chanting.next_slot", InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_PAGE_DOWN, "key.categories.qiandeng_chanting")
    };
    private static StaffController controller;
    private static Object connection;
    private static ItemStack gestureStack;
    private static InteractionHand gestureHand;
    private static boolean registered, wasActive, requireUseRelease;
    private static long lastSync;
    private ChantingClient() { }

    static void registerOptionalController() {
        if (registered) return;
        registered = true;
        if (!ModList.get().isLoaded("controlify")) return;
        try {
            // Keep the optional API behind a class boundary so keyboard users
            // do not link any missing Controlify classes.
            Class<?> type = Class.forName("dev.qiandeng.chanting.client.ControlifyStaffInput");
            controller = (StaffController) type.getConstructor(KeyMapping[].class).newInstance((Object) KEYS);
            LOG.info("[qiandeng-chanting] shoulder skill-selection bindings registered");
        } catch (ReflectiveOperationException | LinkageError error) {
            LOG.warn("[qiandeng-chanting] controller bindings unavailable; Page Up/Down remain available", error);
        }
    }

    private static boolean contextBlocked(Minecraft mc) {
        return mc.screen != null || mc.getOverlay() != null || !mc.isWindowActive() || mc.isPaused();
    }
    private static boolean isOurStaff(ItemStack stack) {
        return stack.is(QiandengChantingItems.WHISPERING_STAFF.get())
                || stack.is(QiandengChantingItems.RESONANCE_STAFF.get());
    }
    private static boolean usingStaff(LocalPlayer player) {
        return player != null && player.isUsingItem() && isOurStaff(player.getUseItem())
                && player.getItemInHand(player.getUsedItemHand()) == player.getUseItem();
    }

    /** Read fresh state at Controlify's two swap calls, never the prior tick's PTT snapshot. */
    public static boolean suppressControllerHotbar() {
        Minecraft mc = Minecraft.getInstance();
        return mc.getConnection() != null && !contextBlocked(mc) && usingStaff(mc.player)
                && mc.player.isAlive() && !mc.player.isSpectator();
    }

    private static void disableController(Throwable error) {
        controller = null;
        LOG.warn("[qiandeng-chanting] controller input unavailable; keyboard remains available", error);
    }
    private static boolean physicalUseHeld(Minecraft mc) {
        InputConstants.Key key = mc.options.keyUse.getKey();
        long window = mc.getWindow().getWindow();
        boolean held = key.getType() == InputConstants.Type.MOUSE
                ? GLFW.glfwGetMouseButton(window, key.getValue()) == GLFW.GLFW_PRESS
                : key.getType() == InputConstants.Type.KEYSYM && key.getValue() >= 0
                    ? InputConstants.isKeyDown(window, key.getValue()) : mc.options.keyUse.isDown();
        if (controller != null) {
            try { held |= controller.usePhysicallyHeld(); }
            catch (RuntimeException | LinkageError error) { disableController(error); }
        }
        return held;
    }
    private static void cancelGesture(Minecraft mc) {
        PTT.update(false, System.nanoTime());
        requireUseRelease = true;
        RELEASE.reset(); AUDIO.end();
        if (mc.getConnection() != null && mc.getConnection().hasChannel(StaffStopPayload.TYPE)) {
            try { PacketDistributor.sendToServer(new StaffStopPayload()); }
            catch (RuntimeException error) { LOG.warn("[qiandeng-chanting] cancellation submission failed", error); }
        }
        if (mc.player != null && mc.gameMode != null && usingStaff(mc.player)) mc.gameMode.releaseUsingItem(mc.player);
    }

    @SubscribeEvent
    public static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        long now = System.nanoTime();
        if (connection != mc.getConnection()) {
            connection = mc.getConnection(); StaffSkillbarState.clear(); AUDIO.end(); StaffAudioMailbox.clear(); CONTEXT.reset(); RELEASE.reset();
            gestureStack = null; gestureHand = null; requireUseRelease = false; wasActive = false; lastSync = 0;
        }
        LocalPlayer player = mc.player;
        boolean using = usingStaff(player);
        boolean sameHeld = player != null && gestureStack != null && gestureHand != null
                && player.getItemInHand(gestureHand) == gestureStack;
        boolean lostItem = gestureStack != null && !sameHeld;
        boolean blocked = contextBlocked(mc) || lostItem || player == null || !player.isAlive() || player.isSpectator();
        if (requireUseRelease && !physicalUseHeld(mc)) requireUseRelease = false;
        boolean valid = player != null && mc.level != null && mc.gameMode != null
                && connection != null && !blocked && !requireUseRelease;
        boolean useDown = mc.options.keyUse.isDown();
        boolean active = valid && using && useDown;
        if (CONTEXT.update(active, blocked, now)) { cancelGesture(mc); valid = false; active = false; }

        boolean prevDown = KEYS[0].isDown(), nextDown = KEYS[1].isDown();
        if (controller != null) {
            try { prevDown |= controller.previousDown(); nextDown |= controller.nextDown(); }
            catch (RuntimeException | LinkageError error) { disableController(error); }
        }
        for (KeyMapping key : KEYS) while (key.consumeClick()) { }
        boolean previous = PREVIOUS.update(active, prevDown), next = NEXT.update(active, nextDown);
        // A simultaneous pair has no direction; it cannot accidentally select a skill.
        int direction = previous == next ? 0 : previous ? -1 : 1;
        StaffReleaseGate.Result result = RELEASE.update(active ? player.getUseItem() : null,
                active ? player.getTicksUsingItem() : 0, valid, useDown, sameHeld, direction);
        if (result.began()) AUDIO.begin(now);
        for (var packet : StaffAudioMailbox.drain()) {
            if (packet.kind() == 0) AUDIO.start(packet.gestureId());
            else if (packet.kind() == 1) AUDIO.acknowledge(packet.gestureId(), packet.revision(), packet.floor(), packet.accepted(), now);
        }
        if (active) { gestureStack = player.getUseItem(); gestureHand = player.getUsedItemHand(); }
        if (result.changedMode() >= 0) {
            AUDIO.select(result.changedMode(), now);
            if (mc.getConnection().hasChannel(StaffModePayload.TYPE)) {
                try { PacketDistributor.sendToServer(new StaffModePayload(result.changedMode())); }
                catch (RuntimeException error) {
                    LOG.warn("[qiandeng-chanting] mode submission uncertain; cancelling this gesture", error);
                    cancelGesture(mc); active = false;
                }
            } else { cancelGesture(mc); active = false; }
        }
        if (active && (!wasActive || now - lastSync >= 5_000_000_000L)) {
            lastSync = now;
            try { mc.getConnection().sendCommand("mycli skillbar sync"); }
            catch (RuntimeException error) { LOG.warn("[qiandeng-chanting] skillbar refresh unavailable", error); }
        }
        if (active) {
            var request = AUDIO.takeRequest(now);
            if (request != null) {
                if (mc.getConnection().hasChannel(StaffAudioBoundaryPayload.TYPE)) {
                    try { PacketDistributor.sendToServer(new StaffAudioBoundaryPayload(request.id(), request.revision(), request.floor())); }
                    catch (RuntimeException error) { AUDIO.unavailable(); }
                } else AUDIO.unavailable();
            }
            // A missing microphone disables this voice attempt, not the user's
            // shoulder-selected shortcuts. No background retry or late revival.
            AUDIO.failed(now);
        }
        wasActive = active;
        // Default SVC PTT is unchanged. This adapter only adds capture in voice mode.
        PTT.update(active && RELEASE.mode() == 0 && AUDIO.ready(), now);
        if (result.castSlot() > 0) {
            try { mc.getConnection().sendCommand("mycli staff-cast " + result.castSlot()); }
            catch (RuntimeException error) {
                LOG.warn("[qiandeng-chanting] release submission uncertain; no automatic retry", error);
            }
        }
        if (!active) { AUDIO.end(); gestureStack = null; gestureHand = null; }
    }

    /** SVC calls from its audio thread; never read Minecraft objects here. */
    public static boolean isHoldingStaff() { return PTT.isHeld(System.nanoTime()); }

    private static String slotName(StaffSkillbarState.Slot slot) {
        if (StaffSkillbarState.receivedAt() == 0) return Component.translatable("hud.qiandeng_chanting.waiting").getString();
        return slot.id().isEmpty() ? Component.translatable("hud.qiandeng_chanting.empty").getString()
                : slot.name().isEmpty() ? slot.id() : slot.name();
    }

    @SubscribeEvent
    public static void onRenderHud(RenderGuiEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (!wasActive || contextBlocked(mc) || mc.options.hideGui || mc.player == null) return;
        int mode = RELEASE.mode();
        var slots = StaffSkillbarState.slots();
        Component title = mode == 0 ? Component.translatable("hud.qiandeng_chanting.voice")
                : Component.translatable("hud.qiandeng_chanting.selected", mode, slotName(slots.get(mode - 1)));
        Component hint = mode == 0 ? Component.translatable(AUDIO.failed(System.nanoTime()) ? "hud.qiandeng_chanting.audio_unavailable"
                : AUDIO.ready() ? "hud.qiandeng_chanting.examples" : "hud.qiandeng_chanting.audio_preparing")
                : Component.translatable("hud.qiandeng_chanting.release");
        Component left = KEYS[0].getTranslatedKeyMessage(), right = KEYS[1].getTranslatedKeyMessage();
        if (controller != null) {
            try { left = controller.previousGlyph(); right = controller.nextGlyph(); }
            catch (RuntimeException | LinkageError ignored) { }
        }
        Component footer = Component.translatable("hud.qiandeng_chanting.cycle", left, right);
        GuiGraphics g = event.getGuiGraphics();
        float scale = Math.min(0.8f, (g.guiWidth() - 24f) / 286f);
        g.pose().pushPose();
        try {
            g.pose().translate(g.guiWidth() / 2f, g.guiHeight() - 148f * scale, 0f);
            g.pose().scale(scale, scale, 1f);
            g.fill(-143, -8, 143, 93, 0xD0162028);
            g.fill(-143, -8, -141, 93, 0xFFE3B461);
            g.drawString(mc.font, mc.font.plainSubstrByWidth(title.getString(), 270), -134, 0, 0xFFFFDDA0, true);
            g.drawString(mc.font, mc.font.plainSubstrByWidth(hint.getString(), 270), -134, 13, 0xFFECEFEA, true);
            for (int i = 0; i < 8; i++) {
                int x = -134 + i % 4 * 68, y = 30 + i / 4 * 22;
                boolean selected = mode == i + 1;
                g.fill(x, y, x + 64, y + 18, selected ? 0xFF9A672B : 0xB02E3B46);
                String label = (i + 1) + " " + slotName(slots.get(i));
                g.drawString(mc.font, mc.font.plainSubstrByWidth(label, 58), x + 3, y + 5,
                        selected ? 0xFFFFEDD1 : 0xFFC8D2D7, false);
            }
            g.drawString(mc.font, mc.font.plainSubstrByWidth(footer.getString(), 270), -134, 79, 0xFFB7CFDA, true);
        } finally { g.pose().popPose(); }
    }
}
