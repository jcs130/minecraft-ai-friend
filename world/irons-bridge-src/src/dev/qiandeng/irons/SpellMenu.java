package dev.qiandeng.irons;

import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemLore;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;

/** Ordinary chest protocol: no client mod, key binding or draggable display items. */
final class SpellMenu extends ChestMenu {
    private static final int PAGE_SIZE = 45;
    private final ServerPlayer owner;
    private final SimpleContainer display;
    private final List<String> displayedIds = new ArrayList<>();
    private int page;
    private int pages = 1;
    private boolean dispatched;

    SpellMenu(int id, Inventory inventory, ServerPlayer owner) {
        this(id, inventory, owner, new SimpleContainer(54));
    }

    private SpellMenu(int id, Inventory inventory, ServerPlayer owner, SimpleContainer display) {
        super(MenuType.GENERIC_9x6, id, inventory, display, 6);
        this.owner = owner;
        this.display = display;
        refresh();
    }

    private static ItemStack icon(Item item, String title, List<String> lore) {
        var stack = new ItemStack(item);
        stack.set(DataComponents.CUSTOM_NAME, Component.literal(title));
        stack.set(DataComponents.LORE, new ItemLore(lore.stream().map(Component::literal).map(c -> (Component)c).toList()));
        return stack;
    }

    private void refresh() {
        // ID-only native cast chooses the first native source; don't show duplicate buttons
        // that imply the CLI can secretly override source selection.
        var unique = new LinkedHashMap<String, QiandengIronsBridge.Option>();
        for (var option : QiandengIronsBridge.options(owner)) unique.putIfAbsent(option.id(), option);
        var options = new ArrayList<>(unique.values());
        pages = Math.max(1, (options.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        page = Math.max(0, Math.min(page, pages - 1));
        display.clearContent();
        displayedIds.clear();
        for (int i = page * PAGE_SIZE; i < Math.min(options.size(), (page + 1) * PAGE_SIZE); i++) {
            var option = options.get(i);
            var detail = QiandengIronsBridge.spellJson(owner, option);
            String label = detail.get("name").getAsString();
            // The dedicated server may not have a Chinese language catalog; title uses
            // the native translation component so each normal client localizes it.
            var stack = icon(Items.ENCHANTED_BOOK, label, List.of(option.id(),
                "等级 " + detail.get("level") + " · 法力 " + detail.get("mana"),
                "冷却剩余 " + detail.get("cooldownMs").getAsLong() / 1000.0 + " 秒",
                "施法时间 " + detail.get("castTimeTicks").getAsInt() / 20.0 + " 秒",
                "来源 " + detail.get("source").getAsString() + " / " + option.slot(),
                detail.get("ready").getAsBoolean() ? "点击开始施法（遵循原生目标与消耗）" : "当前不可施法：" + detail.get("reasonKey").getAsString()));
            stack.set(DataComponents.CUSTOM_NAME, option.data().getSpell().getDisplayName(owner));
            display.setItem(displayedIds.size(), stack);
            displayedIds.add(option.id());
        }
        if (options.isEmpty()) display.setItem(22, icon(Items.BOOK, "尚无可用原生法术", List.of(
            "装备已镌刻的法术书或法术装备", "或在主手/副手持有原生卷轴", "菜单不会解锁或发放法术")));
        display.setItem(45, icon(Items.ARROW, "上一页", List.of("第 " + (page + 1) + " / " + pages + " 页")));
        display.setItem(47, icon(Items.CLOCK, "刷新法力与冷却", List.of("重新读取当前装备和原生状态")));
        var status = QiandengIronsBridge.describe(owner, "status");
        display.setItem(49, icon(Items.EXPERIENCE_BOTTLE, "原生法术状态", List.of(
            "法力 " + status.get("mana") + " / " + status.get("maxMana"),
            "原版经验等级 " + status.get("level"), "法术由原生装备决定")));
        display.setItem(50, icon(Items.BARRIER, "取消当前施法", List.of("调用原生取消规则")));
        display.setItem(51, icon(Items.OAK_DOOR, "关闭", List.of()));
        display.setItem(53, icon(Items.ARROW, "下一页", List.of("第 " + (page + 1) + " / " + pages + " 页")));
        broadcastChanges();
    }

    @Override public boolean stillValid(Player player) { return player == owner && owner.isAlive(); }
    @Override public ItemStack quickMoveStack(Player player, int index) { return ItemStack.EMPTY; }

    @Override public void clicked(int slot, int button, ClickType type, Player player) {
        // Ignore shift, number-key swaps, drops, double click, drag, and outside clicks.
        // Never invoke the chest's item-transfer implementation, including player slots.
        if (player != owner || owner.containerMenu != this || dispatched || type != ClickType.PICKUP || button != 0) return;
        if (slot >= 0 && slot < displayedIds.size()) {
            dispatched = true;
            String id = displayedIds.get(slot);
            owner.closeContainer(); // Opening a container can cancel casts; close before start.
            try {
                var result = QiandengIronsBridge.cast(owner, id);
                owner.sendSystemMessage(Component.literal(result.get("summary").getAsString()));
            } catch (Exception e) {
                owner.sendSystemMessage(Component.literal("施法结果待核实，请查询状态，不要自动重发"));
            }
        } else if (slot == 45) { page--; refresh(); }
        else if (slot == 53) { page++; refresh(); }
        else if (slot == 47) refresh();
        else if (slot == 50) {
            var result = QiandengIronsBridge.cancel(owner);
            owner.sendSystemMessage(Component.literal(result.get("summary").getAsString()));
            refresh();
        } else if (slot == 51) owner.closeContainer();
    }
}
