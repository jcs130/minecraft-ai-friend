package dev.god.botgate.chest;

import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemLore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** Vanilla chest protocol: virtual icons, primary confirmation only, one action per opened menu. */
public class SkillChestMenu extends ChestMenu {
    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-skillchest");
    private final ServerPlayer player;
    private final List<SkillChestLayout.Entry> entries;
    private final int page;
    private final SkillChestLayout.ActionGate actionGate = new SkillChestLayout.ActionGate();
    private final Consumer<Integer> pageTurner, itemPanelOpener, waypointOpener, archiveOpener;
    private final Runnable homeOpener;

    public SkillChestMenu(int id, net.minecraft.world.entity.player.Inventory inv, ServerPlayer player,
                          List<SkillChestLayout.Entry> entries, int page, long debounceMs, Consumer<Integer> pageTurner) {
        this(id, inv, player, entries, page, debounceMs, pageTurner, null);
    }
    public SkillChestMenu(int id, net.minecraft.world.entity.player.Inventory inv, ServerPlayer player,
                          List<SkillChestLayout.Entry> entries, int page, long debounceMs,
                          Consumer<Integer> pageTurner, Consumer<Integer> items) {
        this(id, inv, player, entries, page, debounceMs, pageTurner, items,
                target -> SkillChestCommands.openWaypointsFor(player, target),
                target -> SkillChestCommands.openArchiveFor(player, target),
                () -> SkillChestCommands.openFor(player, 0));
    }
    public SkillChestMenu(int id, net.minecraft.world.entity.player.Inventory inv, ServerPlayer player,
                          List<SkillChestLayout.Entry> entries, int page, long debounceMs,
                          Consumer<Integer> pageTurner, Consumer<Integer> items, Consumer<Integer> waypoints,
                          Consumer<Integer> archive, Runnable home) {
        super(MenuType.GENERIC_9x3, id, inv, buildContainer(entries), 3);
        this.player = player; this.entries = List.copyOf(entries); this.page = page;
        this.pageTurner = pageTurner; this.itemPanelOpener = items;
        this.waypointOpener = waypoints; this.archiveOpener = archive; this.homeOpener = home;
    }

    private static SimpleContainer buildContainer(List<SkillChestLayout.Entry> entries) {
        SimpleContainer container = new SimpleContainer(SkillChestLayout.SIZE);
        for (int i = 0; i < Math.min(SkillChestLayout.SIZE, entries.size()); i++) container.setItem(i, iconStack(entries.get(i)));
        return container;
    }
    static ItemStack iconStack(SkillChestLayout.Entry entry) {
        try {
            Item item = BuiltInRegistries.ITEM.get(ResourceLocation.parse(entry.icon));
            if (item == null || item == Items.AIR) item = Items.GRAY_STAINED_GLASS_PANE;
            ItemStack stack = new ItemStack(item);
            ChatFormatting color = switch (entry.kind) {
                case NATIVE -> ChatFormatting.LIGHT_PURPLE;
                case WAYPOINT, WARP_HUB -> ChatFormatting.AQUA;
                case SKILL, ITEM, SKILLBAR_SLOT, SKILLBAR_EDIT -> ChatFormatting.GOLD;
                case ARCHIVED, INFO, EMPTY -> ChatFormatting.GRAY;
                default -> ChatFormatting.WHITE;
            };
            stack.set(DataComponents.CUSTOM_NAME, Component.literal(entry.name.isEmpty() ? " " : entry.name)
                    .withStyle(style -> style.withColor(color).withItalic(false)));
            List<Component> lore = new ArrayList<>();
            if (!entry.lore.isEmpty()) for (String line : entry.lore.split("\\n"))
                lore.add(Component.literal(line).withStyle(ChatFormatting.GRAY));
            String instruction = switch (entry.kind) {
                case SKILL -> "give".equals(entry.id) ? "A / 左键：选择物品" : "A / 左键：确认释放";
                case WAYPOINT -> "A / 左键：确认传送";
                case ITEM -> "A / 左键：确认造物";
                case NATIVE, WARP_HUB, ARCHIVE_HUB, SKILLBAR_HUB, SKILLBAR_SLOT -> "A / 左键：打开";
                case SKILLBAR_EDIT -> "A / 左键：确认配置（不会施法）";
                case MORE, BACK -> "A / 左键：翻页";
                case HOME -> "A / 左键：返回罗盘";
                case REFRESH -> "A / 左键：刷新";
                case CLOSE -> "A / 左键：关闭";
                case ARCHIVED -> "只读档案";
                default -> "";
            };
            if (!instruction.isEmpty()) lore.add(Component.literal(instruction).withStyle(ChatFormatting.DARK_GRAY));
            if (!lore.isEmpty()) stack.set(DataComponents.LORE, new ItemLore(lore));
            return stack;
        } catch (Exception ex) { return new ItemStack(Items.GRAY_STAINED_GLASS_PANE); }
    }

    @Override public boolean stillValid(Player who) { return who == player && player.isAlive(); }
    @Override public ItemStack quickMoveStack(Player who, int index) { return ItemStack.EMPTY; }

    @Override public void clicked(int slotId, int button, ClickType clickType, Player who) {
        // Never call super: swap, shift, drag, throw, clone and player-inventory clicks cannot move icons.
        if (slotId < 0 || slotId >= Math.min(entries.size(), SkillChestLayout.SIZE)) return;
        SkillChestLayout.Entry entry = entries.get(slotId);
        if (!actionGate.accept(who == player && player.isAlive(), player.containerMenu == this,
                clickType == ClickType.PICKUP && button == 0, entry.actionable())) return;
        // Latch before closing or dispatching. A repeated packet cannot cast from this menu twice.
        player.closeContainer();
        try {
            switch (entry.kind) {
                case SKILL, WAYPOINT, ITEM, NATIVE, SKILLBAR_EDIT -> {
                    if (entry.command != null) {
                        player.server.getCommands().performPrefixedCommand(player.createCommandSourceStack(), entry.command);
                        if (entry.kind == SkillChestLayout.Kind.SKILLBAR_EDIT)
                            player.sendSystemMessage(Component.literal("快捷栏配置请求已提交，请等待世界服务回执；重新打开编辑页可核对结果").withStyle(ChatFormatting.GRAY));
                        GODFIX.info("[skillchest] {} slot{} -> {}", player.getGameProfile().getName(), slotId, entry.id);
                    } else if ("give".equals(entry.id) && itemPanelOpener != null) itemPanelOpener.accept(0);
                }
                case MORE, BACK, REFRESH -> { if (pageTurner != null) pageTurner.accept(SkillChestLayout.navTarget(entry)); }
                case WARP_HUB -> { if (waypointOpener != null) waypointOpener.accept(0); }
                case ARCHIVE_HUB -> { if (archiveOpener != null) archiveOpener.accept(0); }
                case SKILLBAR_HUB -> SkillChestCommands.openSkillbarFor(player);
                case SKILLBAR_SLOT -> SkillChestCommands.openSkillbarChoicesFor(player, SkillChestLayout.navTarget(entry), 0);
                case HOME -> { if (homeOpener != null) homeOpener.run(); }
                default -> { }
            }
        } catch (Exception ex) {
            GODFIX.warn("[skillchest] click failed: {}", ex.toString());
            player.sendSystemMessage(Component.literal("罗盘操作未完成，请重新打开后查看状态").withStyle(ChatFormatting.RED));
        }
    }
    public int page() { return page; }
}
