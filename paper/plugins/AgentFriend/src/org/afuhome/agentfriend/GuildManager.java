package org.afuhome.agentfriend;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

/** Per-player adventurer guild contracts backed by the same save as dungeon rewards. */
final class GuildManager implements Listener {
    private static final ZoneId GUILD_ZONE = ZoneId.of("Asia/Shanghai");
    private static final String[] RANKS = {"青铜", "黑铁", "白银", "黄金", "白金", "钻石"};
    private static final int[] THRESHOLDS = {0, 10, 30, 70, 150, 350};
    private enum Goal { FLOOR, KILLS, PARTY_FLOOR, CLAIMS, EXPLORE }
    private record Contract(String id, String title, String description, Material icon,
            Goal goal, int target, int floor, int minRank, int fame,
            int emeralds, Material bonus, int bonusCount, String siteId) {
        Contract(String id, String title, String description, Material icon, Goal goal, int target,
                int floor, int minRank, int fame, int emeralds, Material bonus, int bonusCount) {
            this(id, title, description, icon, goal, target, floor, minRank, fame,
                    emeralds, bonus, bonusCount, null);
        }
    }
    private static final List<Contract> CONTRACTS = List.of(
            new Contract("first_step", "初探苔穴", "通关地下城第 1 层", Material.MOSS_BLOCK,
                    Goal.FLOOR, 1, 1, 0, 5, 2, Material.BREAD, 2),
            new Contract("pest_control", "洞窟讨伐", "击败 5 只试炼地下城怪物；同层队友共享进度",
                    Material.IRON_SWORD, Goal.KILLS, 5, 0, 0, 5, 3, Material.IRON_INGOT, 2),
            new Contract("deep_explorer", "深层远征", "通关地下城第 3 层", Material.DEEPSLATE_BRICKS,
                    Goal.FLOOR, 1, 3, 1, 10, 5, Material.GOLDEN_APPLE, 1),
            new Contract("treasure_vault", "宝库守护者", "通关地下城第 6 层", Material.DIAMOND,
                    Goal.FLOOR, 1, 6, 2, 20, 8, Material.DIAMOND, 1),
            new Contract("desert_scout", "遗迹前哨", "通关地下城第 2 层", Material.SANDSTONE,
                    Goal.FLOOR, 1, 2, 0, 6, 3, Material.ARROW, 8),
            new Contract("party_oath", "结伴试炼", "至少两名队友共同通关地下城第 2 层", Material.SHIELD,
                    Goal.PARTY_FLOOR, 1, 2, 0, 8, 4, Material.GOLDEN_APPLE, 1),
            new Contract("ember_hunter", "烈焰讨伐", "累计击败 12 只试炼地下城怪物", Material.BLAZE_POWDER,
                    Goal.KILLS, 12, 0, 1, 12, 5, Material.LAPIS_LAZULI, 4),
            new Contract("ocean_guard", "海渊守望", "通关地下城第 5 层", Material.PRISMARINE_BRICKS,
                    Goal.FLOOR, 1, 5, 1, 15, 6, Material.GOLDEN_APPLE, 1),
            new Contract("treasure_keeper", "宝箱整理师", "从个人试炼箱领取 3 次战利品", Material.CHEST,
                    Goal.CLAIMS, 3, 0, 0, 4, 2, Material.EXPERIENCE_BOTTLE, 2),
            new Contract("undead_explorer", "亡灵墓穴调查", "找到自然生成的亡灵墓穴入口", Material.BONE,
                    Goal.EXPLORE, 1, 0, 0, 7, 3, Material.GOLDEN_APPLE, 1, "undead_crypt"),
            new Contract("creeping_explorer", "蔓生墓穴调查", "找到自然生成的蔓生墓穴入口", Material.MOSS_BLOCK,
                    Goal.EXPLORE, 1, 0, 1, 10, 4, Material.LAPIS_LAZULI, 4, "creeping_crypt"),
            new Contract("desert_explorer", "沙漠遗迹调查", "找到自然生成的沙漠遗迹入口", Material.CHISELED_SANDSTONE,
                    Goal.EXPLORE, 1, 0, 1, 12, 5, Material.DIAMOND, 1, "desert_ruins"),
            new Contract("camp_scout", "营地侦察", "找到掠夺者营地，注意结伴应对袭击", Material.CROSSBOW,
                    Goal.EXPLORE, 1, 0, 0, 8, 4, Material.SHIELD, 1, "illager_camp"),
            new Contract("lost_town", "失落古镇", "调查古镇废墟并寻找遗留的宝箱", Material.MAP,
                    Goal.EXPLORE, 1, 0, 0, 8, 4, Material.EXPERIENCE_BOTTLE, 3, "ruin_town"),
            new Contract("bunker_explorer", "地下堡垒", "找到堡垒入口，深入地下探索", Material.STONE_BRICKS,
                    Goal.EXPLORE, 1, 0, 1, 12, 5, Material.IRON_SWORD, 1, "bunker"));
    static int contractCount() { return CONTRACTS.size(); }

    private final AgentFriendPlugin plugin;
    private final DungeonManager dungeon;
    private final DungeonExpeditions expeditions;

    GuildManager(AgentFriendPlugin plugin, DungeonManager dungeon) {
        this.plugin = plugin;
        this.dungeon = dungeon;
        expeditions = new DungeonExpeditions(plugin);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    private String base(UUID id) { return "guild-players." + id; }
    private String today() { return LocalDate.now(GUILD_ZONE).toString(); }
    private boolean member(Player p) { return plugin.getConfig().contains(base(p.getUniqueId()) + ".joined"); }
    private int fame(Player p) { return plugin.getConfig().getInt(base(p.getUniqueId()) + ".fame", 0); }
    private int rankIndex(int fame) {
        int rank = 0;
        for (int i = 1; i < THRESHOLDS.length; i++) if (fame >= THRESHOLDS[i]) rank = i;
        return rank;
    }
    int adventurerRank(Player player) { return rankIndex(fame(player)); }
    String adventurerRankName(Player player) { return RANKS[adventurerRank(player)]; }
    private Contract contract(String id) {
        for (Contract quest : CONTRACTS) if (quest.id().equals(id)) return quest;
        return null;
    }
    private Contract active(Player p) {
        return contract(plugin.getConfig().getString(base(p.getUniqueId()) + ".active.id", ""));
    }
    private int progress(Player p) { return plugin.getConfig().getInt(base(p.getUniqueId()) + ".active.progress", 0); }
    private boolean doneToday(Player p, Contract quest) {
        return today().equals(plugin.getConfig().getString(base(p.getUniqueId()) + ".daily." + quest.id()));
    }

    void command(Player player, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "board";
        switch (action) {
            case "hall", "大厅" -> plugin.guildHallTeleport(player);
            case "board", "list", "看板" -> board(player);
            case "menu", "菜单" -> plugin.openGuildMenu(player);
            case "join", "register", "注册" -> join(player);
            case "status", "rank", "状态", "等级" -> status(player);
            case "accept", "接单" -> {
                if (args.length < 3) player.sendMessage(ChatColor.YELLOW + "用法：/mycli guild accept <任务ID>");
                else accept(player, args[2].toLowerCase(Locale.ROOT));
            }
            case "abandon", "放弃" -> abandon(player);
            case "claim", "交付", "领取" -> claim(player);
            case "rewards", "箱子" -> dungeon.command(player, new String[]{"arena", "rewards"});
            case "stash", "储物" -> dungeon.openStash(player);
            case "trader", "商人" -> {
                plugin.guildHall().traderInfo(player);
                if (plugin.guildHall().nearTrader(player)) plugin.guildHall().openReceptionMenu(player);
            }
            case "shared", "storage", "共享箱" -> plugin.guildHall().storageInfo(player);
            case "travel", "远征" -> {
                if (args.length < 3) player.sendMessage(ChatColor.YELLOW
                        + "用法：/mycli guild travel <遗迹ID>；可选 "
                        + String.join("、", DungeonExpeditions.SITES.stream().map(DungeonExpeditions.Site::id).toList()));
                else expeditions.travel(player, args[2].toLowerCase(Locale.ROOT));
            }
            default -> player.sendMessage(ChatColor.RED + "用法：/mycli guild hall|board|menu|join|status|accept <ID>|abandon|claim|rewards|stash|trader|shared|travel <遗迹ID>");
        }
    }

    private void join(Player player) {
        if (player.getGameMode() == GameMode.SPECTATOR) {
            player.sendMessage(ChatColor.RED + "旁观者不能接公会任务。"); return;
        }
        if (member(player)) { status(player); return; }
        String path = base(player.getUniqueId());
        plugin.getConfig().set(path + ".joined", today());
        plugin.getConfig().set(path + ".fame", 0);
        plugin.getConfig().set(path + ".completed", 0);
        plugin.saveConfig();
        player.sendMessage(ChatColor.GOLD + "欢迎加入千灯纪冒险者公会！当前等级：青铜。输入 /mycli guild board 看任务。");
        plugin.getLogger().info("Guild joined: player=" + player.getUniqueId());
    }

    private void board(Player player) {
        status(player);
        player.sendMessage(ChatColor.GOLD + "【今日公会看板 · " + today() + "】");
        for (Contract quest : CONTRACTS) {
            String gate = quest.minRank() > rankIndex(fame(player)) ? "需" + RANKS[quest.minRank()] : "可接";
            String state = doneToday(player, quest) ? "今日已完成" : gate;
            player.sendMessage(ChatColor.YELLOW + quest.id() + ChatColor.WHITE + " " + quest.title()
                    + " · " + quest.description() + " · 声望+" + quest.fame()
                    + " / 绿宝石×" + quest.emeralds() + " [" + state + "]");
        }
        player.sendMessage(ChatColor.GRAY + "用 /mycli guild accept <ID> 接单；完成后 /mycli guild claim 交付，打不过可 /mycli guild abandon。手柄可打开罗盘公会看板。");
    }

    private void status(Player player) {
        if (!member(player)) {
            player.sendMessage(ChatColor.YELLOW + "尚未加入冒险者公会；/mycli guild join 注册，接单也会自动注册。"); return;
        }
        int fame = fame(player), rank = rankIndex(fame);
        int completed = plugin.getConfig().getInt(base(player.getUniqueId()) + ".completed", 0);
        String next = rank + 1 < RANKS.length ? "；还需 " + (THRESHOLDS[rank + 1] - fame)
                + " 声望升" + RANKS[rank + 1] : "；已达最高等级";
        player.sendMessage(ChatColor.GOLD + "冒险者等级：" + RANKS[rank] + " · 声望 " + fame
                + " · 已完成 " + completed + " 单" + next);
        Contract quest = active(player);
        player.sendMessage(quest == null ? ChatColor.GRAY + "当前没有在办的委托。"
                : ChatColor.AQUA + "正在进行：" + quest.title() + " [" + progress(player) + "/"
                + quest.target() + "]" + (progress(player) >= quest.target() ? "；可交付领取" : ""));
    }

    private void accept(Player player, String id) {
        Contract quest = contract(id);
        if (quest == null) { player.sendMessage(ChatColor.RED + "没有这个任务 ID；/mycli guild board 查看精确名称。"); return; }
        if (player.getGameMode() == GameMode.SPECTATOR) { player.sendMessage(ChatColor.RED + "旁观者不能接单。"); return; }
        if (!dungeon.isBuilt()) { player.sendMessage(ChatColor.RED + "地下城暂未建成，不能接此任务。"); return; }
        if (active(player) != null) { player.sendMessage(ChatColor.YELLOW + "先完成并交付当前任务。"); return; }
        if (doneToday(player, quest)) { player.sendMessage(ChatColor.YELLOW + "这张委托今日已经完成，明天再来。"); return; }
        if (rankIndex(fame(player)) < quest.minRank()) {
            player.sendMessage(ChatColor.RED + "需要" + RANKS[quest.minRank()] + "级（声望 "
                    + THRESHOLDS[quest.minRank()] + "）；当前是" + RANKS[rankIndex(fame(player))] + "。"); return;
        }
        if (!member(player)) join(player);
        String path = base(player.getUniqueId()) + ".active";
        plugin.getConfig().set(path + ".id", quest.id());
        plugin.getConfig().set(path + ".progress", 0);
        plugin.getConfig().set(path + ".accepted", today());
        plugin.saveConfig();
        player.sendMessage(ChatColor.GREEN + "已接公会委托：" + quest.title() + "。" + quest.description()
                + "；完成后用 /mycli guild claim 领取声望与箱中物资。");
        if (quest.siteId() != null) player.sendMessage(ChatColor.AQUA
                + "用传送罗盘选择「" + DungeonExpeditions.site(quest.siteId()).name()
                + "」或输入 /mycli guild travel " + quest.siteId() + "；落点在遗迹外约 70 格。");
        plugin.getLogger().info("Guild accepted: player=" + player.getUniqueId() + ", contract=" + quest.id());
    }

    void onDungeonMobDefeated(Player player) {
        Contract quest = active(player);
        if (quest == null || quest.goal() != Goal.KILLS) return;
        advance(player, quest);
    }

    void onDungeonFloorCleared(Player player, int floor, int partySize) {
        Contract quest = active(player);
        if (quest == null || quest.floor() != floor) return;
        if (quest.goal() != Goal.FLOOR && !(quest.goal() == Goal.PARTY_FLOOR && partySize >= 2)) return;
        advance(player, quest);
    }

    void onDungeonRewardClaimed(Player player) {
        Contract quest = active(player);
        if (quest != null && quest.goal() == Goal.CLAIMS) advance(player, quest);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onExplore(PlayerMoveEvent event) {
        if (event.getTo() == null || event.getFrom().getBlockX() == event.getTo().getBlockX()
                && event.getFrom().getBlockZ() == event.getTo().getBlockZ()) return;
        checkExplore(event.getPlayer(), event.getTo());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onExploreTeleport(PlayerTeleportEvent event) {
        if (event.getTo() != null) checkExplore(event.getPlayer(), event.getTo());
    }

    private void checkExplore(Player player, org.bukkit.Location destination) {
        Contract quest = active(player);
        if (quest == null || quest.goal() != Goal.EXPLORE || quest.siteId() == null) return;
        if (DungeonExpeditions.reached(destination, quest.siteId())) advance(player, quest);
    }

    private void advance(Player player, Contract quest) {
        int current = progress(player);
        if (current >= quest.target()) return;
        int next = current + 1;
        plugin.getConfig().set(base(player.getUniqueId()) + ".active.progress", next);
        plugin.saveConfig();
        if (next >= quest.target()) player.sendMessage(ChatColor.GOLD + "公会委托「" + quest.title()
                + "」已达成！/mycli guild claim 交付，奖励进入个人试炼箱。");
        else player.sendMessage(ChatColor.AQUA + "公会委托「" + quest.title() + "」进度 " + next + "/" + quest.target());
    }

    private void abandon(Player player) {
        Contract quest = active(player);
        if (quest == null) { player.sendMessage(ChatColor.YELLOW + "当前没有可放弃的任务。"); return; }
        plugin.getConfig().set(base(player.getUniqueId()) + ".active", null);
        plugin.saveConfig();
        player.sendMessage(ChatColor.YELLOW + "已放弃「" + quest.title() + "」，本次进度清零；可重新接单。");
        plugin.getLogger().info("Guild abandoned: player=" + player.getUniqueId() + ", contract=" + quest.id());
    }

    private void claim(Player player) {
        Contract quest = active(player);
        if (quest == null) { player.sendMessage(ChatColor.YELLOW + "当前没有可交付的任务。"); return; }
        if (progress(player) < quest.target()) {
            player.sendMessage(ChatColor.YELLOW + "还需完成「" + quest.title() + "」：" + progress(player)
                    + "/" + quest.target()); return;
        }
        if (doneToday(player, quest)) {
            player.sendMessage(ChatColor.RED + "今日奖励已结算；请联系服主核对异常记录。"); return;
        }
        int oldRank = rankIndex(fame(player));
        String path = base(player.getUniqueId());
        if (!dungeon.queueGuildRewards(player.getUniqueId(), quest.emeralds(), quest.bonus(), quest.bonusCount())) {
            player.sendMessage(ChatColor.RED + "个人奖励箱数据异常，交付未执行；请联系服主核对。");
            plugin.getLogger().warning("Guild reward refused: player=" + player.getUniqueId()
                    + ", contract=" + quest.id());
            return;
        }
        int nextFame = fame(player) + quest.fame();
        plugin.getConfig().set(path + ".fame", nextFame);
        plugin.getConfig().set(path + ".completed", plugin.getConfig().getInt(path + ".completed", 0) + 1);
        plugin.getConfig().set(path + ".daily." + quest.id(), today());
        plugin.getConfig().set(path + ".active", null);
        plugin.saveConfig();
        player.sendMessage(ChatColor.GREEN + "委托交付成功！声望 +" + quest.fame()
                + "，绿宝石 ×" + quest.emeralds() + "及额外奖励已存入个人试炼箱。");
        if (rankIndex(nextFame) > oldRank) player.sendMessage(ChatColor.GOLD + "冒险者等级提升："
                + RANKS[oldRank] + " → " + RANKS[rankIndex(nextFame)] + "！");
        plugin.getLogger().info("Guild claimed: player=" + player.getUniqueId() + ", contract=" + quest.id()
                + ", fame=" + nextFame);
    }

    void fillBoard(Player player, Inventory inventory) {
        int rank = rankIndex(fame(player));
        inventory.setItem(0, icon(Material.BOOK, "§6冒险者档案", "等级：" + RANKS[rank],
                "声望：" + fame(player), member(player) ? "点击查看当前任务" : "点击注册入会"));
        for (int i = 0; i < CONTRACTS.size(); i++) {
            Contract quest = CONTRACTS.get(i);
            String state = doneToday(player, quest) ? "今天已完成"
                    : quest.minRank() > rank ? "需要" + RANKS[quest.minRank()] : "点击接单";
            inventory.setItem(10 + i, icon(quest.icon(), "§e" + quest.title() + " §7(" + quest.id() + ")",
                    quest.description(), "声望 +" + quest.fame() + " / 绿宝石 ×" + quest.emeralds(), state));
        }
        Contract quest = active(player);
        inventory.setItem(27, icon(Material.BARRIER, "§c放弃当前委托", quest == null ? "没有在办的任务"
                : "放弃「" + quest.title() + "」；进度清零"));
        inventory.setItem(28, icon(Material.EMERALD, "§a交付已完成委托", quest == null ? "没有在办的任务"
                : quest.title() + " " + progress(player) + "/" + quest.target(), "点击领取声望与箱中物资"));
        inventory.setItem(29, icon(Material.CHEST, "§6个人试炼箱", "任务与地下城奖励自动入箱", "可像普通箱子一样取放物品"));
        inventory.setItem(30, icon(Material.IRON_SWORD, "§c前往地下城", "六层试炼；与队友共同挑战"));
        inventory.setItem(31, icon(Material.ARROW, "§7返回技能", "返回技能罗盘"));
    }

    private ItemStack icon(Material material, String title, String... lines) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(title);
        meta.setLore(List.of(lines));
        item.setItemMeta(meta);
        return item;
    }

    void click(Player player, int slot) {
        if (slot == 0) { if (member(player)) status(player); else join(player); }
        else if (slot >= 10 && slot < 10 + CONTRACTS.size()) accept(player, CONTRACTS.get(slot - 10).id());
        else if (slot == 27) abandon(player);
        else if (slot == 28) claim(player);
        else if (slot == 29) dungeon.command(player, new String[]{"arena", "rewards"});
    }

    String bookPage(Player player) {
        if (!member(player)) return "§6冒险者公会§r\n\n尚未注册。\n\n在技能罗盘打开公会看板，或输入 /mycli guild join 加入。";
        int reputation = fame(player), rank = rankIndex(reputation);
        Contract quest = active(player);
        return "§6冒险者公会§r\n\n等级：" + RANKS[rank] + "\n声望：" + reputation
                + "\n完成：" + plugin.getConfig().getInt(base(player.getUniqueId()) + ".completed", 0)
                + " 单\n\n当前任务：" + (quest == null ? "无" : quest.title() + " " + progress(player) + "/" + quest.target())
                + "\n\n打开罗盘公会看板接单，地下城奖励在个人箱子里。";
    }
}
