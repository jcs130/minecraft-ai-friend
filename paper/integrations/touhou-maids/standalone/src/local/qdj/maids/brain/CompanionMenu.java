package local.qdj.maids.brain;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemLore;

/** A vanilla chest menu: no extra client payload or dependency; every click rechecks its contract. */
final class CompanionMenu extends ChestMenu {
    private final UUID viewer;
    private final Map<Integer, Runnable> clicks = new HashMap<>();

    static void open(ServerPlayer player, MaidCompanions service, UUID maid, int page) {
        player.openMenu(new SimpleMenuProvider((id, inv, ignored) ->
                new CompanionMenu(id, inv, service, maid, page), Component.literal(maid == null ? "冒险伙伴 · 招募名册" : "冒险伙伴 · 同行约定")));
    }

    @SuppressWarnings("unchecked")
    private CompanionMenu(int id, Inventory inventory, MaidCompanions service, UUID maid, int page) {
        super(MenuType.GENERIC_9x6, id, inventory, new SimpleContainer(54), 6);
        var player = (ServerPlayer) inventory.player;
        viewer = player.getUUID();
        if (maid == null) {
            var list = (List<Map<String, Object>>) service.roster(player).get("companions");
            int start = Math.max(0, Math.min(page, (Math.max(1, list.size()) - 1) / 45)) * 45;
            for (int i = start; i < Math.min(start + 45, list.size()); i++) {
                var row = list.get(i);
                UUID target = UUID.fromString((String) row.get("maidId"));
                card(i - start, Items.PAPER, row.get("name") + " · " + row.get("role"),
                        List.of(String.valueOf(row.get("description")), "状态：" + label(String.valueOf(row.get("status"))),
                                "走近后聊聊，可以邀请多位同伴。"), () -> open(player, service, target, 0));
            }
            if (start > 0) card(45, Items.ARROW, "上一页", List.of(), () -> open(player, service, null, page - 1));
            if (start + 45 < list.size()) card(53, Items.ARROW, "下一页", List.of(), () -> open(player, service, null, page + 1));
            card(49, Items.BOOK, "同行约定", List.of("菜单选项也是聊天，伙伴可以答应或婉拒。", "多位伙伴可同行，各自保留性格与经历。", "断线保留队伍，超时或解散后返岗。"), null);
        } else {
            var row = service.view(player, maid, System.currentTimeMillis());
            UUID expected = service.contract(maid);
            card(4, Items.BOOK, row.get("name") + " · " + row.get("role"),
                    List.of(String.valueOf(row.get("description")), "状态：" + label(String.valueOf(row.get("status")))), null);
            if (Boolean.TRUE.equals(row.get("mine"))) {
                action(20, Items.LEAD, "跟我来", "跟随你，守卫会迎战敌对怪物。", "follow", player, service, maid, expected);
                action(22, Items.OAK_SIGN, "原地等候", "在当前位置等你，暂停工作。", "stay", player, service, maid, expected);
                action(24, Items.IRON_HOE, "在此工作", "按原生专长工作，需要合适的装备和场地。", "work", player, service, maid, expected);
                action(40, Items.OAK_DOOR, "结束同行", "退出队伍并尝试回到原驻地。", "dismiss", player, service, maid, expected);
                card(42, Items.BARRIER, "直接退出队伍", List.of("不等待回应，结束你自己的同行关系。"), () -> {
                    MaidCompanions.reply(player.createCommandSourceStack(), service.execute(player, maid, "dismiss", expected, true), false);
                    player.closeContainer();
                });
            } else if ("available".equals(row.get("status")))
                action(22, Items.EMERALD, "聊聊 · 邀请同行", "让伙伴结合个性与当前安排作出回答。", "recruit", player, service, maid, expected);
            else card(22, Items.CLOCK, "暂时无法招募", List.of(label(String.valueOf(row.get("status")))), null);
            action(31, Items.WRITABLE_BOOK, "你好，认识一下", "了解她的性格、喜好和专长。", "hello", player, service, maid, expected);
            card(49, Items.ARROW, "返回名册", List.of(), () -> open(player, service, null, 0));
        }
    }

    private void action(int slot, Item icon, String name, String detail, String action, ServerPlayer player,
                        MaidCompanions service, UUID maid, UUID expected) {
        card(slot, icon, name, List.of(detail), () -> {
            var result = java.util.Objects.equals(expected, service.contract(maid)) ?
                    service.ask(player, maid, CompanionCommands.phrase(action), 0) :
                    Map.<String,Object>of("status", "rejected", "reason", "stale_contract");
            MaidCompanions.reply(player.createCommandSourceStack(), result, false);
            player.closeContainer();
        });
    }
    private void card(int slot, Item item, String name, List<String> lore, Runnable action) {
        var stack = new ItemStack(item);
        stack.set(DataComponents.CUSTOM_NAME, Component.literal(name));
        stack.set(DataComponents.LORE, new ItemLore(lore.stream().map(s -> (Component)Component.literal(s)).toList()));
        getContainer().setItem(slot, stack);
        if (action != null) clicks.put(slot, action);
    }
    @Override public void clicked(int slot, int button, ClickType type, Player player) {
        if (!stillValid(player) || type != ClickType.PICKUP || button != 0 || !clicks.containsKey(slot)) return;
        clicks.get(slot).run();
    }
    @Override public ItemStack quickMoveStack(Player player, int slot) { return ItemStack.EMPTY; }
    @Override public boolean stillValid(Player player) { return player.isAlive() && viewer.equals(player.getUUID()) && !player.isSpectator(); }

    static String label(String state) {
        return switch(state) {
            case "available" -> "可以同行";
            case "follow" -> "正在跟随";
            case "stay" -> "原地等候";
            case "work" -> "按专长工作";
            case "returning" -> "正在返岗";
            case "waiting_for_reconnect" -> "等待队长重连";
            case "waiting_for_leader" -> "等待队长恢复";
            case "waiting_in_other_dimension" -> "与队长不在同一维度";
            case "body_unavailable" -> "实体暂未加载";
            case "resident_not_ready" -> "驻地尚未就绪";
            case "dead" -> "已阵亡，需按原生方式救援";
            case "path_needs_attention" -> "道路可能受阻，请靠近或检查路线";
            default -> "需要检查：" + state;
        };
    }
}
