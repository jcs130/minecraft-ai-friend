package dev.qiandeng.controls;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.MenuAccess;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** The same server-owned menu and slot clicks, drawn as a wheel on a modded client. */
final class SpellWheelScreen extends Screen implements MenuAccess<ChestMenu> {
    static final String TITLE_KEY = "screen.qiandeng_controls.spell_wheel";
    private static final int[] SKILLS = {10, 11, 12, 13, 14, 15, 16, 19};
    private static final int[] NAVIGATION = {27, 28, 30, 33, 31, 35};
    private static final double SECTOR = Math.PI / 4.0;
    private final ChestMenu menu;
    private final List<SkillButton> buttons = new ArrayList<>();
    private int cx, cy, radius;
    private boolean populated;
    private boolean submitted;

    SpellWheelScreen(ChestMenu menu, Component title) {
        super(title);
        this.menu = menu;
    }

    @Override public ChestMenu getMenu() { return menu; }
    @Override public boolean isPauseScreen() { return false; }

    @Override protected void init() {
        cx = width / 2;
        cy = (height - 12) / 2;
        radius = Math.max(50, Math.min(120, Math.min((width - 86) / 2, (height - 92) / 2)));
        populated = false;
        buttons.clear();
        populate();
    }

    @Override public void tick() { populate(); }

    private void populate() {
        if (populated || slot(4).isEmpty()) return;
        populated = true;
        int buttonWidth = Math.min(94, Math.max(52, radius - 2));
        for (int index = 0; index < SKILLS.length; index++) {
            int cell = SKILLS[index];
            ItemStack item = slot(cell);
            if (item.isEmpty()) continue;
            double angle = -Math.PI / 2.0 + SECTOR * index;
            int x = cx + (int) Math.round(Math.cos(angle) * radius) - buttonWidth / 2;
            int y = cy + (int) Math.round(Math.sin(angle) * radius) - 11;
            buttons.add(addRenderableWidget(new SkillButton(index, cell, item.copy(), x, y, buttonWidth)));
        }
        List<Integer> navigation = new ArrayList<>();
        for (int cell : NAVIGATION) if (!slot(cell).isEmpty()) navigation.add(cell);
        int navWidth = Math.min(82, (width - 20) / Math.max(1, navigation.size()) - 4);
        int x = (width - (navWidth + 4) * navigation.size() + 4) / 2;
        for (int cell : navigation) {
            Component label = slot(cell).getHoverName();
            Component shortLabel = Component.literal(font.plainSubstrByWidth(label.getString(), navWidth - 6));
            addRenderableWidget(Button.builder(shortLabel, button -> select(cell)).bounds(x, height - 29, navWidth, 20).build());
            x += navWidth + 4;
        }
    }

    private ItemStack slot(int cell) {
        ItemStack item = menu.getSlot(cell).getItem();
        return item.is(Items.GRAY_STAINED_GLASS_PANE) ? ItemStack.EMPTY : item;
    }

    private void select(int cell) {
        if (submitted || minecraft.player == null || minecraft.gameMode == null
                || minecraft.player.containerMenu != menu || slot(cell).isEmpty()) return;
        submitted = true;
        minecraft.gameMode.handleInventoryMouseClick(menu.containerId, cell, 0, ClickType.PICKUP, minecraft.player);
    }

    private SkillButton sector(double mouseX, double mouseY) {
        double dx = mouseX - cx, dy = mouseY - cy, distance = Math.hypot(dx, dy);
        if (distance < radius * .54 || distance > radius + 23) return null;
        int index = Math.floorMod((int) Math.floor((Math.atan2(dy, dx) + Math.PI / 2.0) / SECTOR + .5), SKILLS.length);
        for (SkillButton button : buttons) if (button.index == index) return button;
        return null;
    }

    @Override public boolean mouseClicked(double x, double y, int button) {
        if (super.mouseClicked(x, y, button)) return true;
        if (button != 0) return false;
        SkillButton sector = sector(x, y);
        if (sector == null) return false;
        select(sector.cell);
        return true;
    }

    @Override public void renderBackground(GuiGraphics gui, int mouseX, int mouseY, float partialTick) {
        super.renderBackground(gui, mouseX, mouseY, partialTick);
        circle(gui, radius + 10, 0xD51A2931);
        circle(gui, radius / 2 + 3, 0xFA121A21);
        gui.drawCenteredString(font, title, cx, 12, 0xFFFFE2AA);
    }

    @Override public void render(GuiGraphics gui, int mouseX, int mouseY, float partialTick) {
        super.render(gui, mouseX, mouseY, partialTick);
        SkillButton selected = null;
        for (SkillButton button : buttons) if (button.isHovered() || button.isFocused()) {
            selected = button;
            if (button.isHovered()) break;
        }
        if (selected == null) selected = sector(mouseX, mouseY);
        if (selected == null) {
            ItemStack header = slot(4);
            String label = header.isEmpty() ? "" : header.getHoverName().getString();
            gui.drawCenteredString(font, font.plainSubstrByWidth(label, radius + 14), cx, cy - 4, 0xFFE3EFEE);
        } else {
            gui.drawCenteredString(font, font.plainSubstrByWidth(selected.getMessage().getString(), radius + 14), cx, cy - 15, 0xFFFFE2AA);
            var lore = selected.item.get(DataComponents.LORE);
            if (lore != null) for (int i = 0; i < Math.min(3, lore.lines().size()); i++) {
                String row = font.plainSubstrByWidth(lore.lines().get(i).getString(), radius + 18);
                gui.drawCenteredString(font, row, cx, cy - 2 + i * 10, 0xFFCCE0DF);
            }
        }
    }

    private void circle(GuiGraphics gui, int size, int color) {
        gui.drawManaged(() -> {
            for (int y = -size; y <= size; y++) {
                int half = (int) Math.sqrt(size * size - y * y);
                gui.fill(cx - half, cy + y, cx + half + 1, cy + y + 1, color);
            }
        });
    }

    @Override public void onClose() {
        if (minecraft.player != null && minecraft.player.containerMenu == menu) minecraft.player.closeContainer();
        else super.onClose();
    }

    private final class SkillButton extends Button {
        final int index, cell;
        final ItemStack item;

        SkillButton(int index, int cell, ItemStack item, int x, int y, int width) {
            super(x, y, width, 22, item.getHoverName(), button -> select(cell), DEFAULT_NARRATION);
            this.index = index;
            this.cell = cell;
            this.item = item;
        }

        @Override protected void renderWidget(GuiGraphics gui, int mouseX, int mouseY, float partialTick) {
            int x = getX(), y = getY();
            boolean highlighted = isHoveredOrFocused() || sector(mouseX, mouseY) == this;
            gui.fill(x, y, x + width, y + height, highlighted ? 0xFFE2BC79 : 0xFF667A79);
            gui.fill(x + 1, y + 1, x + width - 1, y + height - 1, highlighted ? 0xFF354950 : 0xFF213039);
            gui.renderItem(item, x + 4, y + 3);
            gui.drawString(font, font.plainSubstrByWidth(getMessage().getString(), width - 24), x + 23, y + 7, 0xFFF4F2E5);
        }
    }
}
