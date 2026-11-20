package org.qiandengji.villagerquests;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.qiandengji.villagerquests.core.Area;
import org.qiandengji.villagerquests.core.Board;
import org.qiandengji.villagerquests.core.Commission;
import org.qiandengji.villagerquests.core.Policy;
import org.qiandengji.villagerquests.core.QuestType;
import org.qiandengji.villagerquests.core.Templates;

/**
 * {@code /vq} (aliases {@code /委托}, {@code /villagerquests}):
 * list | accept &lt;id&gt; | abandon [id] | status | deliver; admin: trigger &lt;villager&gt; | handoff &lt;id&gt; | cancel &lt;id&gt; | reload | info.
 */
final class QuestCommand implements TabExecutor {
    private static final List<String> PLAYER = List.of("list", "accept", "abandon", "status", "deliver");
    private static final List<String> ADMIN = List.of("trigger", "handoff", "cancel", "reload", "info");
    private final VillagerQuestsPlugin plugin;

    QuestCommand(VillagerQuestsPlugin plugin) { this.plugin = plugin; }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String sub = args.length == 0 ? (sender instanceof Player ? "menu" : "list") : args[0].toLowerCase(Locale.ROOT);
        boolean admin = sender.hasPermission("villagerquests.admin");
        Player p = sender instanceof Player pl ? pl : null;
        switch (sub) {
            case "menu" -> openMenu(plugin, p, null);
            case "list" -> list(sender);
            case "accept" -> {
                if (p == null || args.length < 2) { sender.sendMessage("用法：/" + label + " accept <委托编号>"); return true; }
                Board.Quest q = plugin.board.resolve(args[1]);
                if (q == null) { plugin.tell(p, "没有找到这个委托编号。用 /" + label + " list 查看。"); return true; }
                accept(plugin, p, q.id);
            }
            case "abandon" -> {
                if (p == null) return true;
                List<Board.Quest> mine = plugin.board.activeFor(p.getUniqueId().toString());
                Board.Quest q = args.length >= 2 ? plugin.board.resolve(args[1]) : mine.size() == 1 ? mine.get(0) : null;
                if (q == null) { plugin.tell(p, "请指定要放弃的委托编号。"); return true; }
                try {
                    plugin.board.abandon(q.id, p.getUniqueId().toString());
                    plugin.markDirty();
                    plugin.say(q.commission.issuer(), Templates.abandoned(plugin.name(q.commission.issuer())));
                } catch (Policy.Violation v) { plugin.tell(p, "这不是你接下的委托。"); }
            }
            case "status" -> status(sender, p);
            case "deliver" -> {
                if (p == null) return true;
                deliver(p);
            }
            case "trigger" -> {
                if (!admin) return deny(sender);
                if (args.length < 2 || plugin.villagers.spot(args[1]) == null) { sender.sendMessage("用法：/" + label + " trigger <村民ID>  可选：" + plugin.villagerIds()); return true; }
                var t = plugin.getConfig().getConfigurationSection("villagers." + args[1] + ".triggers");
                sender.sendMessage("触发结果：" + plugin.trigger(args[1], t, true));
            }
            case "handoff" -> {
                if (!admin) return deny(sender);
                Board.Quest q = args.length < 2 ? null : plugin.board.resolve(args[1]);
                sender.sendMessage(q != null && plugin.handoff(q.id, System.currentTimeMillis()) ? "已交给英雄桥接层。" : "无法转交（不存在、已被接取、类型不支持或剩余时间不足）。");
            }
            case "cancel" -> {
                if (!admin) return deny(sender);
                Board.Quest q = args.length < 2 ? null : plugin.board.resolve(args[1]);
                if (q == null) { sender.sendMessage("没有找到这个委托。"); return true; }
                boolean hero = q.status == Board.Status.HERO;
                plugin.board.cancel(q.id);
                plugin.markDirty();
                plugin.taskCards.closed(q);
                sender.sendMessage("已取消 " + q.id + (hero ? "（桥接层没有取消通道，英雄侧会在期限到时自行过期）" : ""));
            }
            case "reload" -> {
                if (!admin) return deny(sender);
                sender.sendMessage(plugin.reloadAll() ? "已重新加载配置。" : "配置有误，保留原设置，详情见控制台。");
            }
            case "info" -> {
                if (!admin) return deny(sender);
                sender.sendMessage("村民 " + plugin.villagerIds() + "；Citizens " + (plugin.villagers.citizens() ? "已接入" : "未接入")
                        + "；故事生成 " + (plugin.author() == null ? "仅模板" : plugin.author().name()) + "；英雄转交 " + (plugin.heroesEnabled ? "开" : "关")
                        + "；spool " + plugin.spool().root + "；待发奖励 " + plugin.board.owed().size());
            }
            default -> sender.sendMessage("用法：/" + label + " [list|accept <编号>|abandon|status|deliver]" + (admin ? " 管理：trigger|handoff|cancel|reload|info" : ""));
        }
        return true;
    }

    private static boolean deny(CommandSender s) { s.sendMessage("需要 villagerquests.admin 权限。"); return true; }

    static String shortId(Board.Quest q) { return q.id.substring(3, 9); }

    static String describe(VillagerQuestsPlugin plugin, Board.Quest q) {
        Commission c = q.commission;
        long minutes = Math.max(0, (q.deadlineAt - System.currentTimeMillis()) / 60_000L);
        return "[" + shortId(q) + "] " + plugin.name(c.issuer()) + "：" + c.title() + " —— " + Templates.ask(c) + "（剩 " + minutes + " 分钟，" + c.difficulty() + "）";
    }

    private void list(CommandSender sender) {
        List<Board.Quest> open = plugin.board.open();
        List<Board.Quest> heroes = plugin.board.all().stream().filter(q -> q.status == Board.Status.HERO).toList();
        if (open.isEmpty() && heroes.isEmpty()) { sender.sendMessage("现在没有村民委托。"); return; }
        for (Board.Quest q : open) sender.sendMessage("§e可接 §f" + describe(plugin, q));
        for (Board.Quest q : heroes) sender.sendMessage("§7英雄处理中 §f" + describe(plugin, q));
        sender.sendMessage("§7用 /vq accept <编号> 接取。");
    }

    private void status(CommandSender sender, Player p) {
        if (p == null) { sender.sendMessage("开放 " + plugin.board.openCount(null) + "，待发奖励 " + plugin.board.owed().size()); return; }
        List<Board.Quest> mine = plugin.board.activeFor(p.getUniqueId().toString());
        if (mine.isEmpty()) { plugin.tell(p, "你现在没有接下的委托。"); return; }
        for (Board.Quest q : mine) plugin.tell(p, describe(plugin, q) + " 进度 " + q.progress + "/" + q.commission.quantity());
    }

    private void deliver(Player p) {
        for (Board.Quest q : plugin.board.activeFor(p.getUniqueId().toString())) {
            if (q.commission.type() != QuestType.GATHER) continue;
            Location at = plugin.villagers.location(q.commission.issuer());
            if (at == null || at.getWorld() != p.getWorld() || at.distanceSquared(p.getLocation()) > plugin.deliverRadius * plugin.deliverRadius) {
                plugin.tell(p, "请到" + plugin.name(q.commission.issuer()) + "身边再交付。");
                continue;
            }
            Material m = Material.matchMaterial(q.commission.target());
            if (m == null) continue;
            boolean any = false;
            var inv = p.getInventory();
            for (int i = 0; i < 36; i++) {
                ItemStack stack = inv.getItem(i);
                if (stack == null || stack.getType() != m) continue;
                if (plugin.board.get(q.id) == null || plugin.board.get(q.id).status != Board.Status.ACCEPTED) break;
                if (plugin.listeners.deliver(p, q.commission.issuer(), stack)) {
                    any = true;
                    inv.setItem(i, stack.getAmount() > 0 ? stack : null);
                }
            }
            if (!any) plugin.tell(p, "背包里没有" + Templates.targetName(q.commission.target()) + "。");
            return;
        }
        plugin.tell(p, "你没有需要交付物品的委托。");
    }

    static void accept(VillagerQuestsPlugin plugin, Player p, String questId) {
        try {
            Board.Quest q = plugin.board.accept(questId, p.getUniqueId().toString(), p.getName(), System.currentTimeMillis());
            plugin.markDirty();
            plugin.say(q.commission.issuer(), Templates.accepted(plugin.name(q.commission.issuer()), p.getName()));
            plugin.tell(p, "已接下 " + describe(plugin, q) + "。用 /vq status 查看进度，/vq abandon 放弃。");
            Area a = q.commission.area();
            if (a != null) plugin.tell(p, String.format("有效区域：(%.0f, %.0f, %.0f) 附近 %.0f 格内。", a.x(), a.y(), a.z(), a.radius()));
        } catch (Policy.Violation v) {
            plugin.tell(p, switch (v.code) {
                case "taken_by_hero" -> "这件委托已经交给英雄们了。";
                case "not_open" -> "这件委托已经有人接了。";
                case "expired" -> "这件委托已经过期。";
                case "player_limit" -> "你手上的委托已经够多了，先完成或放弃一个吧。";
                case "hero_uses_bridge" -> "英雄通过任务桥接层接委托。";
                default -> "现在无法接取：" + v.code;
            });
        }
    }

    /** Chest board of open commissions (optionally one villager's). Click to accept. */
    static final class Menu implements InventoryHolder {
        final Map<Integer, String> slots = new HashMap<>();
        Inventory inventory;
        @Override public Inventory getInventory() { return inventory; }
    }

    static void openMenu(VillagerQuestsPlugin plugin, Player p, String villager) {
        if (p == null) return;
        List<Board.Quest> open = new ArrayList<>(plugin.board.open().stream()
                .filter(q -> villager == null || q.commission.issuer().equals(villager)).toList());
        Menu menu = new Menu();
        menu.inventory = Bukkit.createInventory(menu, 27, villager == null ? "村民委托" : plugin.name(villager) + "的委托");
        int slot = 0;
        for (Board.Quest q : open) {
            if (slot >= 27) break;
            ItemStack item = new ItemStack(Material.PAPER);
            ItemMeta meta = item.getItemMeta();
            meta.setDisplayName("§e" + q.commission.title());
            List<String> lore = new ArrayList<>();
            lore.add("§f" + plugin.name(q.commission.issuer()) + "：" + Templates.ask(q.commission));
            if (!q.commission.story().isEmpty()) lore.add("§7" + q.commission.story());
            lore.add("§7编号 " + shortId(q) + " · " + q.commission.difficulty() + " · 剩 " + Math.max(0, (q.deadlineAt - System.currentTimeMillis()) / 60_000L) + " 分钟");
            lore.add("§a点击接取");
            meta.setLore(lore);
            item.setItemMeta(meta);
            menu.inventory.setItem(slot, item);
            menu.slots.put(slot, q.id);
            slot++;
        }
        if (open.isEmpty()) plugin.tell(p, villager == null ? "现在没有可接的村民委托。" : plugin.name(villager) + "现在没有委托。");
        else p.openInventory(menu.inventory);
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) {
            List<String> out = new ArrayList<>(PLAYER);
            if (sender.hasPermission("villagerquests.admin")) out.addAll(ADMIN);
            return out.stream().filter(s -> s.startsWith(args[0].toLowerCase(Locale.ROOT))).toList();
        }
        if (args.length == 2 && List.of("accept", "handoff", "cancel").contains(args[0].toLowerCase(Locale.ROOT)))
            return plugin.board.all().stream().filter(q -> q.status.open()).map(QuestCommand::shortId).toList();
        if (args.length == 2 && "trigger".equalsIgnoreCase(args[0])) return plugin.villagerIds();
        return List.of();
    }
}
