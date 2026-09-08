package dev.qiandeng.controls;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/** Standard Minecraft buttons give Controlify its normal focus and A/B navigation. */
public final class FieldGuideScreen extends Screen {
    public FieldGuideScreen() {
        super(Component.translatable("screen.qiandeng_controls.title"));
    }

    @Override
    protected void init() {
        int totalWidth = Math.min(420, width - 24);
        int columnWidth = (totalWidth - 10) / 2;
        int left = (width - totalWidth) / 2;
        int top = Math.max(74, height / 2 - 42);
        button("wheel", left, top, columnWidth, () -> QiandengControls.send("skillchest self", false));
        button("panel", left + columnWidth + 10, top, columnWidth, () -> {
            if (minecraft.player != null) QiandengControls.send("skillchest panel " + minecraft.player.getGameProfile().getName() + " 0", false);
        });
        button("status", left, top + 29, columnWidth, () -> QiandengControls.send("mycli status", true));
        button("help", left + columnWidth + 10, top + 29, columnWidth, () -> QiandengControls.send("myhelp", true));
        button("iron", left, top + 58, totalWidth, () -> QiandengControls.send("qdspell self menu", false));
        addRenderableWidget(Button.builder(Component.translatable("gui.back"), button -> onClose())
                .bounds(left, top + 87, totalWidth, 20).build());
    }

    private void button(String action, int x, int y, int buttonWidth, Runnable run) {
        Button button = addRenderableWidget(Button.builder(Component.translatable("screen.qiandeng_controls." + action), ignored -> run.run())
                .bounds(x, y, buttonWidth, 22).build());
        button.active = minecraft != null && minecraft.player != null;
    }

    @Override
    public void render(GuiGraphics gui, int mouseX, int mouseY, float partialTick) {
        // Screen.render draws the background in 1.21.1; text must be drawn after it.
        super.render(gui, mouseX, mouseY, partialTick);
        gui.drawCenteredString(font, title, width / 2, 20, 0xFFFFF3D6);
        gui.drawCenteredString(font, Component.translatable("screen.qiandeng_controls.navigation"), width / 2, 39, 0xFFCCD7D7);
        if (minecraft.player != null) {
            gui.drawCenteredString(font, Component.translatable("screen.qiandeng_controls.vitals",
                    Math.round(minecraft.player.getHealth()), Math.round(minecraft.player.getMaxHealth()),
                    minecraft.player.getFoodData().getFoodLevel(), minecraft.player.experienceLevel), width / 2, 56, 0xFFB9E8CF);
        }
        gui.drawCenteredString(font, Component.translatable("screen.qiandeng_controls.fallback"), width / 2, height - 21, 0xFFCCD7D7);
    }

    @Override
    public boolean isPauseScreen() { return false; }
}
