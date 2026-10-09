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
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

/** Per-player adventurer guild contracts backed by the same save as dungeon rewards. */
final class GuildManager implements Listener {
    private static final ZoneId GUILD_ZONE = ZoneId.of("Asia/Shanghai");
    private static final String[] RANKS = {"青铜", "黑铁", "白银", "黄金", "白金", "钻石"};
    private static final int[] THRESHOLDS = {0, 10, 30, 70, 150, 350};
    enum Goal { FLOOR, KILLS, PARTY_FLOOR, CLAIMS, EXPLORE, DIMENSION, STRUCTURE, BIOME, RETURN, DONATE, CRAFT, FISH, PEAK, BIOME_BORDER,
            LANTERNS, ERUDITE, PRAYER_ROAD, PILGRIMAGE, FAST_FLOOR, NO_DEATH,
            LIGHT_FLOOR, STONE_FLOOR, WITCH_KILLS, BRIDGE, ROAD, BUILD, REDSTONE,
            MELEE_KILLS, PARRY, HEALING, MARK_KILLS, MAP_HUNT,
            HARVEST, REPLANT, TRADE, PHOTO, PHOTO_HANG, SITE_CLEAR, SKILL_CAST }
    /** 智能考核维度：0感知探索 1战斗执行 2长程规划 3社会协作 4语言理解 5约束遵守。 */
    private static final String[] DIMS = {"感知", "战斗", "规划", "协作", "语言", "约束"};
    record Contract(String id, String title, String description, Material icon,
            Goal goal, int target, int floor, int minRank, int fame,
            int emeralds, Material bonus, int bonusCount, String siteId, int dim) {
        Contract(String id, String title, String description, Material icon, Goal goal, int target,
                int floor, int minRank, int fame, int emeralds, Material bonus, int bonusCount) {
            this(id, title, description, icon, goal, target, floor, minRank, fame,
                    emeralds, bonus, bonusCount, null, 1);
        }
        Contract(String id, String title, String description, Material icon, Goal goal, int target,
                int floor, int minRank, int fame, int emeralds, Material bonus, int bonusCount, String siteId) {
            this(id, title, description, icon, goal, target, floor, minRank, fame,
                    emeralds, bonus, bonusCount, siteId, 0);
        }
    }
    private static final List<Contract> CONTRACTS = List.of(
            // —— 感知探索（dim 0）——
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
                    Goal.EXPLORE, 1, 0, 1, 12, 5, Material.IRON_SWORD, 1, "bunker"),
            new Contract("biome_border", "边界巡礼", "站上两种生物群系的交界地带", Material.MOSSY_COBBLESTONE,
                    Goal.BIOME_BORDER, 1, 0, 0, 6, 2, Material.OAK_SAPLING, 2, null, 0),
            new Contract("high_peak", "制高点", "登上高度 120 以上的山峰极目远眺", Material.SNOW_BLOCK,
                    Goal.PEAK, 1, 0, 0, 6, 2, Material.SNOWBALL, 8, null, 0),
            // —— 战斗执行（dim 1）——
            new Contract("first_step", "初探苔穴", "通关地下城第 1 层", Material.MOSS_BLOCK,
                    Goal.FLOOR, 1, 1, 0, 5, 2, Material.BREAD, 2),
            new Contract("desert_scout", "遗迹前哨", "通关地下城第 2 层", Material.SANDSTONE,
                    Goal.FLOOR, 1, 2, 0, 6, 3, Material.ARROW, 8),
            new Contract("deep_explorer", "深层远征", "通关地下城第 3 层", Material.DEEPSLATE_BRICKS,
                    Goal.FLOOR, 1, 3, 1, 10, 5, Material.GOLDEN_APPLE, 1),
            new Contract("ocean_guard", "海渊守望", "通关地下城第 5 层", Material.PRISMARINE_BRICKS,
                    Goal.FLOOR, 1, 5, 1, 15, 6, Material.GOLDEN_APPLE, 1),
            new Contract("treasure_vault", "宝库守护者", "通关地下城第 6 层", Material.DIAMOND,
                    Goal.FLOOR, 1, 6, 2, 20, 8, Material.DIAMOND, 1),
            new Contract("trial_seven", "星光深径", "通关地下城第 7 层，越深越亮", Material.AMETHYST_SHARD,
                    Goal.FLOOR, 1, 7, 4, 18, 8, Material.GOLDEN_APPLE, 2, null, 1),
            new Contract("trial_ten", "千灯之巅", "通关地下城第 10 层，登临绝顶", Material.BEACON,
                    Goal.FLOOR, 1, 10, 4, 30, 12, Material.NETHERITE_SCRAP, 1, null, 1),
            new Contract("pest_control", "洞窟讨伐", "击败 5 只试炼地下城怪物；同层队友共享进度",
                    Material.IRON_SWORD, Goal.KILLS, 5, 0, 0, 5, 3, Material.IRON_INGOT, 2),
            new Contract("ember_hunter", "烈焰讨伐", "累计击败 12 只试炼地下城怪物", Material.BLAZE_POWDER,
                    Goal.KILLS, 12, 0, 1, 12, 5, Material.LAPIS_LAZULI, 4),
            new Contract("witch_hunter", "药婆克星", "在试炼中击败 3 只女巫", Material.GLASS_BOTTLE,
                    Goal.WITCH_KILLS, 3, 0, 2, 10, 5, Material.GLOWSTONE_DUST, 4, null, 1),
            // —— 长程规划（dim 2）——
            new Contract("flower_tithe", "千灯花礼", "向公会献上 8 朵罂粟花", Material.POPPY,
                    Goal.DONATE, 8, 0, 0, 6, 2, Material.POPPY, 2, "POPPY", 2),
            new Contract("harvest_home", "丰收归仓", "向公会交付 16 个小麦", Material.WHEAT,
                    Goal.DONATE, 16, 0, 0, 6, 2, Material.BREAD, 4, "WHEAT", 2),
            new Contract("honey_tribute", "蜜糖进贡", "向公会交付 3 瓶蜂蜜", Material.HONEY_BOTTLE,
                    Goal.DONATE, 3, 0, 1, 8, 3, Material.HONEY_BLOCK, 2, "HONEY_BOTTLE", 2),
            new Contract("berry_basket", "浆果满篮", "向公会交付 16 颗甜浆果", Material.SWEET_BERRIES,
                    Goal.DONATE, 16, 0, 0, 6, 2, Material.GLOW_BERRIES, 4, "SWEET_BERRIES", 2),
            new Contract("gem_offer", "星辰之晶", "向公会交付 1 颗钻石", Material.DIAMOND,
                    Goal.DONATE, 1, 0, 3, 15, 5, Material.EMERALD, 4, "DIAMOND", 2),
            new Contract("lantern_light", "点灯人", "在世界放置 10 个火把或灯笼，照亮千灯之夜", Material.LANTERN,
                    Goal.LANTERNS, 10, 0, 1, 8, 3, Material.LANTERN, 2, null, 2),
            new Contract("erudite", "博识之证", "完成过 3 个不同维度的委托（历史累计）", Material.BOOK,
                    Goal.ERUDITE, 3, 0, 1, 12, 4, Material.EXPERIENCE_BOTTLE, 4, null, 2),
            new Contract("treasure_keeper", "宝箱整理师", "从个人试炼箱领取 3 次战利品", Material.CHEST,
                    Goal.CLAIMS, 3, 0, 0, 4, 2, Material.EXPERIENCE_BOTTLE, 2, null, 2),
            new Contract("light_pack", "轻装远行", "背包占用不超过 10 格通关第 2 层", Material.FEATHER,
                    Goal.LIGHT_FLOOR, 1, 2, 2, 12, 5, Material.ENDER_PEARL, 2, null, 2),
            // —— 社会协作（dim 3）——
            new Contract("party_oath", "结伴试炼", "至少两名队友共同通关地下城第 2 层", Material.SHIELD,
                    Goal.PARTY_FLOOR, 1, 2, 0, 8, 4, Material.GOLDEN_APPLE, 1, null, 3),
            new Contract("pair_deep", "同行深远", "至少两名队友共同通关地下城第 4 层", Material.LEAD,
                    Goal.PARTY_FLOOR, 1, 4, 2, 12, 5, Material.GOLDEN_APPLE, 2, null, 3),
            new Contract("pair_teach", "薪火相传", "与青铜或黑铁队友共同通关任意层", Material.WRITABLE_BOOK,
                    Goal.PARTY_FLOOR, 1, 0, 3, 15, 6, Material.EXPERIENCE_BOTTLE, 5, null, 3),
            // —— 语言理解（dim 4）——
            new Contract("oracle_road", "神谕问路", "先用 goddess pray 向女神问路，再走想远方（200格外）", Material.SPYGLASS,
                    Goal.PRAYER_ROAD, 1, 0, 1, 10, 4, Material.ENDER_PEARL, 2, null, 4),
            new Contract("stone_riddle", "碑文解读", "谜：沉睡千年的集市，亡者仍在列队买卖——找到它", Material.CHISELED_STONE_BRICKS,
                    Goal.EXPLORE, 1, 0, 2, 10, 4, Material.EXPERIENCE_BOTTLE, 3, "ruin_town", 4),
            new Contract("lantern_riddle", "千灯灯谜", "谜：腹中灯火，悬于门庭——把它交给公会", Material.GLOWSTONE,
                    Goal.DONATE, 1, 0, 3, 15, 5, Material.GLOWSTONE, 2, "LANTERN", 4),
            // —— 约束遵守（dim 5）——
            new Contract("stone_only", "朴素远征", "背包中无铁质以上武器，通关第 2 层", Material.STONE_SWORD,
                    Goal.STONE_FLOOR, 1, 2, 1, 12, 5, Material.IRON_INGOT, 2, null, 5),
            new Contract("pilgrimage", "徒步朝圣", "不使用传送：步行远离出发点 500 格后再返回", Material.LEATHER_BOOTS,
                    Goal.PILGRIMAGE, 1, 0, 1, 12, 5, Material.COOKED_BEEF, 8, null, 5),
            new Contract("fasting", "斋戒试炼", "接单后不进食，通关第 3 层", Material.MUSHROOM_STEW,
                    Goal.FAST_FLOOR, 1, 3, 3, 15, 6, Material.GOLDEN_APPLE, 2, null, 5),
            new Contract("flawless", "无瑕之径", "接单后零死亡，通关第 3 层", Material.TOTEM_OF_UNDYING,
                    Goal.NO_DEATH, 1, 3, 4, 20, 8, Material.EMERALD, 8, null, 5));
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
    boolean hasJoined(Player p) { return member(p); }
    private int fame(Player p) { return plugin.getConfig().getInt(base(p.getUniqueId()) + ".fame", 0); }
    private int rankIndex(int fame) {
        int rank = 0;
        for (int i = 1; i < THRESHOLDS.length; i++) if (fame >= THRESHOLDS[i]) rank = i;
        return rank;
    }
    int adventurerRank(Player player) { return effectiveRank(player); }
    String adventurerRankName(Player player) { return RANKS[adventurerRank(player)]; }
    private Contract contract(String id) {
        for (Contract quest : CONTRACTS) if (quest.id().equals(id)) return quest;
        Contract market = plugin.taskMarket() == null ? null : plugin.taskMarket().offered(id);
        if (market != null) return market;
        DailyBoardManager.Card card = plugin.dailyBoard() == null ? null : plugin.dailyBoard().card(id);
        return card == null ? null : card.contract();
    }
    private Contract active(Player p) {
        String path = base(p.getUniqueId()) + ".active";
        String id = plugin.getConfig().getString(path + ".id", "");
        if (plugin.taskMarket() != null && plugin.taskMarket().isMarket(id))
            return plugin.taskMarket().active(p);
        Contract found = contract(id);
        if (found == null && id.startsWith("db_")) {
            String beneficiary = plugin.getConfig().getString(path + ".beneficiary", "公会伙伴");
            plugin.getConfig().set(path, null);
            plugin.saveConfig();
            p.sendMessage(ChatColor.YELLOW + "给" + beneficiary + "的今日委托已过期或撤下，未交付物品不会扣除；任务槽已释放。");
        }
        if (found != null && id.startsWith("db_")) {
            java.util.Map<?, ?> snapshot = snapshot(p);
            if (snapshot != null) try {
                DailyBoardManager.Card frozen = plugin.dailyBoard().savedCard(snapshot);
                if (frozen.id().equals(id)) return frozen.contract();
            } catch (IllegalArgumentException invalid) {
                plugin.getLogger().warning("Dynamic contract snapshot invalid for " + p.getUniqueId());
            }
        }
        return found;
    }
    private java.util.Map<?, ?> snapshot(Player player) {
        Object raw = plugin.getConfig().get(base(player.getUniqueId()) + ".active.snapshot");
        if (raw instanceof org.bukkit.configuration.ConfigurationSection section) return section.getValues(false);
        if (raw instanceof java.util.Map<?, ?> map) return map;
        return null;
    }
    private int progress(Player p) {
        Contract quest = active(p);
        if (quest != null && quest.goal() == Goal.DONATE) {
            Material offer = Material.matchMaterial(quest.siteId() == null ? "" : quest.siteId());
            if (offer == null) return 0;
            return Math.min(quest.target(), countPlainStorage(p, offer));
        }
        return plugin.getConfig().getInt(base(p.getUniqueId()) + ".active.progress", 0);
    }
    int marketProgress(Player player) { return progress(player); }
    private boolean doneToday(Player p, Contract quest) {
        if (plugin.taskMarket() != null && plugin.taskMarket().onceCompleted(p, quest.id())) return true;
        if (plugin.taskMarket() != null && plugin.taskMarket().destinationRepeat(p, quest.id())) return false;
        DailyBoardManager.Card card = plugin.dailyBoard() == null ? null : plugin.dailyBoard().card(quest.id());
        String day = card == null ? today() : card.date();
        return day.equals(plugin.getConfig().getString(base(p.getUniqueId()) + ".daily." + quest.id()));
    }

    void command(Player player, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "board";
        switch (action) {
            case "hall", "大厅" -> plugin.guildHallTeleport(player);
            case "board", "list", "看板" -> board(player);
            case "menu", "菜单" -> plugin.openGuildMenu(player);
            case "join", "register", "注册" -> join(player);
            case "status", "rank", "状态", "等级" -> status(player);
            case "engineering", "market", "projects", "任务市场" -> plugin.taskMarket().command(player, args);
            case "map", "treasure", "藏宝图" -> plugin.taskMarket().mapInfo(player);
            case "commission", "commissions", "玩家委托" -> plugin.playerContracts().command(player,java.util.Arrays.copyOfRange(args,1,args.length));
            case "assessment", "能力记录" -> plugin.taskMarket().assessment(player);
            case "verify", "验收" -> {
                Contract quest = active(player);
                if (quest == null || !plugin.taskMarket().isMarket(quest.id()))
                    player.sendMessage(ChatColor.YELLOW + "先接取任务市场委托；常驻任务直接 guild status 查看进度。");
                else plugin.taskMarket().verify(player, quest, ready -> { });
            }
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
        plugin.taskMarket().list(player);
        player.sendMessage(ChatColor.GOLD + "【今日 · " + plugin.dailyBoard().boardDate() + " · 动态委托】");
        for (DailyBoardManager.Card card : plugin.dailyBoard().cards()) {
            Contract quest = card.contract();
            player.sendMessage(ChatColor.YELLOW + quest.id() + ChatColor.WHITE + " " + quest.title()
                    + " · " + quest.description() + " · 声望+" + quest.fame()
                    + " / 绿宝石×" + quest.emeralds()
                    + " [" + (doneToday(player, quest) ? "今日已完成" : "可接") + "]");
        }
        player.sendMessage(ChatColor.GOLD + "【冒险者公会 · 常驻委托】");
        int[] focus = todayFocus();
        player.sendMessage(ChatColor.GOLD + "【今日公会看板 · " + today() + " · 主考维度："
                + DIMS[focus[0]] + "、"
                + (focus.length > 1 ? DIMS[focus[1]] : "综合") + "】");
        int rank = effectiveRank(player);
        for (Contract quest : CONTRACTS) {
            if (!availableToday(player, quest)) continue;
            String gate = quest.minRank() > rank ? "需" + RANKS[quest.minRank()] : "可接";
            String state = doneToday(player, quest) ? "今日已完成" : gate;
            player.sendMessage(ChatColor.YELLOW + quest.id() + ChatColor.WHITE + " " + quest.title()
                    + " · " + quest.description() + " · 声望+" + quest.fame()
                    + " / 绿宝石×" + quest.emeralds() + " [" + DIMS[quest.dim()] + "|" + state + "]");
        }
        player.sendMessage(ChatColor.GRAY + "每日轮换开放约 " + DAILY_POOL + " 张；当日完成 3 个不同维度，声望 +20%。"
                + "用 /mycli guild accept <ID> 接单；完成后 /mycli guild claim 交付。");
    }

    private void status(Player player) {
        if (!member(player)) {
            player.sendMessage(ChatColor.YELLOW + "尚未加入冒险者公会；/mycli guild join 注册，接单也会自动注册。"); return;
        }
        int fame = fame(player), fameRank = rankIndex(fame), rank = effectiveRank(player);
        int completed = plugin.getConfig().getInt(base(player.getUniqueId()) + ".completed", 0);
        StringBuilder next = new StringBuilder();
        if (rank + 1 < RANKS.length) {
            next.append("；升").append(RANKS[rank + 1]).append("需声望 ").append(THRESHOLDS[rank + 1] - fame);
            if (fameRank > rank) {
                next.append("，并完成认证：").append(certRequirementText(rank + 1));
            }
        } else next.append("；已达最高认证");
        player.sendMessage(ChatColor.GOLD + "冒险者认证：" + RANKS[rank] + " · 声望 " + fame
                + " · 已完成 " + completed + " 单" + next);
        Contract quest = active(player);
        player.sendMessage(quest == null ? ChatColor.GRAY + "当前没有在办的委托。"
                : ChatColor.AQUA + "正在进行：" + quest.title() + " [" + progress(player) + "/"
                + quest.target() + "]" + (progress(player) >= quest.target() ? "；可交付领取" : ""));
        if (quest != null && plugin.taskMarket().engineering(quest))
            player.sendMessage(ChatColor.GRAY + "工程进度为上次验收快照；/mycli guild verify 重新验收实际结构。");
        if (quest != null && (ExplorationObjectives.GOALS.contains(quest.goal()) || quest.goal() == Goal.MAP_HUNT)) plugin.taskMarket().surveyStatus(player);
    }

    private void accept(Player player, String id) {
        Contract quest = contract(id);
        if (quest == null) { player.sendMessage(ChatColor.RED + "没有这个任务 ID；/mycli guild board 查看精确名称。"); return; }
        if (player.getGameMode() == GameMode.SPECTATOR) { player.sendMessage(ChatColor.RED + "旁观者不能接单。"); return; }
        boolean market = plugin.taskMarket().isMarket(id);
        if (!dungeon.isBuilt() && !market) { player.sendMessage(ChatColor.RED + "地下城暂未建成，不能接此任务。"); return; }
        if (active(player) != null) { player.sendMessage(ChatColor.YELLOW + "先完成并交付当前任务。"); return; }
        if (plugin.taskMarket().isMarket(plugin.getConfig().getString(base(player.getUniqueId()) + ".active.id", ""))) {
            player.sendMessage(ChatColor.RED + "在途任务快照异常，已保留记录；请联系服主修复，不能覆盖任务。"); return;
        }
        if (market && !plugin.taskMarket().canAccept(player, quest)) return;
        if (doneToday(player, quest)) { player.sendMessage(ChatColor.YELLOW + "这张委托今日已经完成，明天再来。"); return; }
        if (!availableToday(player, quest)) {
            player.sendMessage(ChatColor.YELLOW + "「" + quest.title() + "」今日看板未开放（每日维度轮换）；/mycli guild board 看今日开放清单。");
            return;
        }
        if (effectiveRank(player) < quest.minRank()) {
            player.sendMessage(ChatColor.RED + "需要" + RANKS[quest.minRank()] + "级认证（声望 "
                    + THRESHOLDS[quest.minRank()] + "）；当前是" + RANKS[effectiveRank(player)] + "。"); return;
        }
        if (quest.goal() == Goal.ERUDITE) {
            java.util.Set<Integer> doneDims = new java.util.HashSet<>();
            for (Contract done : everDoneList(player)) doneDims.add(done.dim());
            if (doneDims.size() < quest.target()) {
                player.sendMessage(ChatColor.YELLOW + "先完成 3 个不同维度的委托；当前已完成 "
                        + doneDims.size() + " 个维度。此单暂不占用任务槽。");
                return;
            }
        }
        if (!member(player)) join(player);
        String path = base(player.getUniqueId()) + ".active";
        plugin.getConfig().set(path + ".id", quest.id());
        plugin.getConfig().set(path + ".progress", 0);
        plugin.getConfig().set(path + ".accepted", today());
        if (market) plugin.taskMarket().accepted(player, id);
        DailyBoardManager.Card offered = plugin.dailyBoard().card(quest.id());
        if (offered != null) {
            plugin.getConfig().set(path + ".snapshot", offered.save());
            plugin.getConfig().set(path + ".beneficiary", offered.beneficiary());
        }
        if (quest.goal() == Goal.PILGRIMAGE) {
            org.bukkit.Location loc = player.getLocation();
            plugin.getConfig().set(path + ".origin", loc.getBlockX() + "," + loc.getBlockY() + "," + loc.getBlockZ());
            plugin.getConfig().set(path + ".far", 0);
        }
        if (quest.goal() == Goal.FAST_FLOOR || quest.goal() == Goal.NO_DEATH) {
            plugin.getConfig().set(base(player.getUniqueId()) + ".fastDirty", null);
            plugin.getConfig().set(base(player.getUniqueId()) + ".diedAt", null);
        }
        java.util.Set<Integer> dims = new java.util.HashSet<>();
        for (Contract q : everDoneList(player)) dims.add(q.dim());
        if (quest.goal() == Goal.ERUDITE && dims.size() >= quest.target())
            plugin.getConfig().set(path + ".progress", quest.target());
        plugin.getConfig().set(base(player.getUniqueId()) + ".attempts." + quest.id(),
                plugin.getConfig().getInt(base(player.getUniqueId()) + ".attempts." + quest.id(), 0) + 1);
        plugin.saveConfig();
        player.sendMessage(ChatColor.GREEN + "已接公会委托：" + quest.title() + "。" + quest.description()
                + "；完成后用 /mycli guild claim 领取声望与箱中物资。");
        if (quest.siteId() != null && quest.goal() == Goal.EXPLORE) player.sendMessage(ChatColor.AQUA
                + "用传送罗盘选择「" + DungeonExpeditions.site(quest.siteId()).name()
                + "」或输入 /mycli guild travel " + quest.siteId() + "；落点在遗迹外约 70 格。");
        if (market) plugin.taskMarket().command(player, new String[]{"guild", "engineering", id});
        plugin.getLogger().info("Guild accepted: player=" + player.getUniqueId() + ", contract=" + quest.id());
    }

    void onDungeonMobDefeated(Player player, org.bukkit.entity.EntityType type) {
        Contract quest = active(player);
        if (quest == null) return;
        if (quest.goal() == Goal.KILLS) advance(player, quest);
        else if (quest.goal() == Goal.WITCH_KILLS && type == org.bukkit.entity.EntityType.WITCH) advance(player, quest);
    }

    void onDungeonFloorCleared(Player player, int floor, int partySize) {
        Contract quest = active(player);
        if (quest == null) return;
        String path = base(player.getUniqueId());
        switch (quest.goal()) {
            case FLOOR -> { if (quest.floor() == floor) advance(player, quest); }
            case PARTY_FLOOR -> {
                if ((quest.floor() == 0 || quest.floor() == floor) && partySize >= 2
                        && (!quest.id().equals("pair_teach") || hasNoviceTeammate(player))) advance(player, quest);
            }
            case FAST_FLOOR -> {
                if (quest.floor() != floor) return;
                if (today().equals(plugin.getConfig().getString(path + ".fastDirty", "")))
                    player.sendMessage(ChatColor.RED + "斋戒被打破了：试炼中进食的记录还在，本单不能交付；"
                            + "可 /mycli guild abandon 后重接再试。");
                else advance(player, quest);
            }
            case NO_DEATH -> {
                if (quest.floor() != floor) return;
                if (today().equals(plugin.getConfig().getString(path + ".diedAt", "")))
                    player.sendMessage(ChatColor.RED + "接单后有过死亡记录，本单不能交付；"
                            + "可 /mycli guild abandon 后重接再试。");
                else advance(player, quest);
            }
            case LIGHT_FLOOR -> {
                if (quest.floor() != floor) return;
                int used = 0;
                for (ItemStack item : player.getInventory().getStorageContents())
                    if (item != null && !item.getType().isAir()) used++;
                if (used > 10)
                    player.sendMessage(ChatColor.RED + "通关时背包占用 " + used + " 格（要求 ≤10"
                            + "），本单不能交付；先清空行囊再试。");
                else advance(player, quest);
            }
            case STONE_FLOOR -> {
                if (quest.floor() != floor) return;
                String cheat = cheatWeapon(player);
                if (cheat != null)
                    player.sendMessage(ChatColor.RED + "背包中发现了" + cheat + "：朴素远征要求无铁质以上武器，"
                            + "本单不能交付；请先收好武器再试。");
                else advance(player, quest);
            }
            default -> { }
        }
    }

    void onDungeonRewardClaimed(Player player) {
        Contract quest = active(player);
        if (quest != null && quest.goal() == Goal.CLAIMS) advance(player, quest);
    }

    /** 神谕联动：pray 后由主插件调用，记录问路起点。 */
    void onPrayer(Player player) {
        Contract quest = active(player);
        if (quest == null || quest.goal() != Goal.PRAYER_ROAD) return;
        org.bukkit.Location loc = player.getLocation();
        plugin.getConfig().set(base(player.getUniqueId()) + ".prayLoc",
                loc.getBlockX() + "," + loc.getBlockY() + "," + loc.getBlockZ());
        plugin.getConfig().set(base(player.getUniqueId()) + ".prayDate", today());
        plugin.saveConfig();
        player.sendMessage(ChatColor.LIGHT_PURPLE + "女神记下了你的问路：从这里出发，走想远方吧（200 格外达成）。");
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onExplore(PlayerMoveEvent event) {
        if (event.getTo() == null || event.getFrom().getBlockX() == event.getTo().getBlockX()
                && event.getFrom().getBlockZ() == event.getTo().getBlockZ()) return;
        checkExplore(event.getPlayer(), event.getFrom(), event.getTo());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onExploreTeleport(PlayerTeleportEvent event) {
        if (event.getTo() == null) return;
        Player player = event.getPlayer();
        Contract quest = active(player);
        if (quest != null && quest.goal() == Goal.PILGRIMAGE) {
            plugin.getConfig().set(base(player.getUniqueId()) + ".active.far", 0);
            plugin.saveConfig();
            player.sendMessage(ChatColor.YELLOW + "朝圣记录：传送会重置「徒步朝圣」的远方标记，步行才算数。");
        }
        checkExplore(player, event.getFrom(), event.getTo());
    }

    @EventHandler
    public void onRespawn(PlayerRespawnEvent event) {
        Player player = event.getPlayer();
        Contract quest = active(player);
        if (quest != null && quest.goal() == Goal.PILGRIMAGE) {
            plugin.getConfig().set(base(player.getUniqueId()) + ".active.far", 0);
            plugin.saveConfig();
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(org.bukkit.event.entity.PlayerDeathEvent event) {
        Player player = event.getEntity();
        Contract quest = active(player);
        if (quest == null || quest.goal() != Goal.NO_DEATH) return;
        plugin.getConfig().set(base(player.getUniqueId()) + ".diedAt", today());
        plugin.saveConfig();
        player.sendMessage(ChatColor.RED + "「无瑕之径」记录到一次死亡；重接后今天内零死亡仍可完成。");
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEat(org.bukkit.event.entity.FoodLevelChangeEvent event) {
        if (!(event.getEntity() instanceof Player player) || event.getItem() == null) return;
        Contract quest = active(player);
        if (quest == null || quest.goal() != Goal.FAST_FLOOR) return;
        plugin.getConfig().set(base(player.getUniqueId()) + ".fastDirty", today());
        plugin.saveConfig();
        player.sendMessage(ChatColor.RED + "「斋戒试炼」记录到一次进食；重接后今天内不进食仍可完成。");
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTorchPlace(org.bukkit.event.block.BlockPlaceEvent event) {
        Player player = event.getPlayer();
        Contract quest = active(player);
        if (quest == null || quest.goal() != Goal.LANTERNS) return;
        Material type = event.getBlockPlaced().getType();
        if (type == Material.TORCH || type == Material.SOUL_TORCH || type == Material.REDSTONE_TORCH
                || type == Material.LANTERN || type == Material.SOUL_LANTERN
                || type == Material.SEA_LANTERN || type == Material.GLOWSTONE
                || type == Material.SHROOMLIGHT || type == Material.JACK_O_LANTERN) advance(player, quest);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDynamicCraft(org.bukkit.event.inventory.CraftItemEvent event) {
        if (!(event.getWhoClicked() instanceof Player player) || event.getCurrentItem() == null) return;
        Contract quest = active(player);
        if (quest != null && quest.goal() == Goal.CRAFT
                && event.getCurrentItem().getType().name().equals(quest.siteId())) advance(player, quest);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDynamicFish(org.bukkit.event.player.PlayerFishEvent event) {
        if (event.getState() != org.bukkit.event.player.PlayerFishEvent.State.CAUGHT_FISH
                || !(event.getCaught() instanceof org.bukkit.entity.Item caught)) return;
        Material type = caught.getItemStack().getType();
        if (type != Material.COD && type != Material.SALMON && type != Material.TROPICAL_FISH
                && type != Material.PUFFERFISH) return;
        Contract quest = active(event.getPlayer());
        if (quest != null && quest.goal() == Goal.FISH
                && (quest.siteId() == null || quest.siteId().equals(type.name()))) advance(event.getPlayer(), quest);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        if (member(player) && rankIndex(fame(player)) >= RANKS.length - 1
                && plugin.getConfig().getInt(base(player.getUniqueId()) + ".rituals.certified", 0) >= RANKS.length - 1)
            player.setDisplayName("✦" + player.getName());
    }

    private String cheatWeapon(Player player) {
        ItemStack[] slots = new ItemStack[player.getInventory().getSize()];
        ItemStack[] storage = player.getInventory().getStorageContents();
        System.arraycopy(storage, 0, slots, 0, storage.length);
        slots[slots.length - 1] = player.getInventory().getItemInOffHand();
        for (ItemStack item : slots) {
            if (item == null) continue;
            String name = item.getType().name();
            if ((name.endsWith("_SWORD") || name.endsWith("_AXE"))
                    && (name.startsWith("IRON_") || name.startsWith("DIAMOND_") || name.startsWith("NETHERITE_")))
                return name;
        }
        return null;
    }

    private boolean hasNoviceTeammate(Player player) {
        for (Player other : Bukkit.getOnlinePlayers()) {
            if (other == player || !dungeon.isParticipant(other) || other.isDead()
                    || other.getGameMode() == GameMode.SPECTATOR || other.getGameMode() == GameMode.CREATIVE
                    || other.getWorld() != player.getWorld()) continue;
            if (adventurerRank(other) <= 1) return true;
        }
        return false;
    }

    private void checkExplore(Player player, org.bukkit.Location from, org.bukkit.Location to) {
        Contract quest = active(player);
        if (quest == null) return;
        switch (quest.goal()) {
            case EXPLORE -> {
                if (quest.siteId() != null && DungeonExpeditions.reached(to, quest.siteId())) advance(player, quest);
            }
            case PEAK -> { if (to.getBlockY() >= 120) advance(player, quest); }
            case BIOME_BORDER -> checkBiomeBorder(player, to);
            case PRAYER_ROAD -> {
                String path = base(player.getUniqueId());
                if (!today().equals(plugin.getConfig().getString(path + ".prayDate", ""))) return;
                org.bukkit.Location origin = parseLoc(player.getWorld(),
                        plugin.getConfig().getString(path + ".prayLoc", ""));
                if (origin != null && origin.getWorld() == to.getWorld() && horizontal(origin, to) > 200)
                    advance(player, quest);
            }
            case PILGRIMAGE -> checkPilgrimage(player, to);
            default -> { }
        }
        // 顺手：from 未用，保留签名以兼容 move 事件两端比较
    }

    private void checkBiomeBorder(Player player, org.bukkit.Location to) {
        String path = base(player.getUniqueId()) + ".active";
        String biome = to.getBlock().getBiome().name();
        if (plugin.getConfig().getString(path + ".biome1", "").isEmpty()) {
            plugin.getConfig().set(path + ".biome1", biome);
            plugin.getConfig().set(path + ".biomeAt", to.getBlockX() + "," + to.getBlockY() + "," + to.getBlockZ());
            plugin.saveConfig();
            return;
        }
        String first = plugin.getConfig().getString(path + ".biome1", "");
        if (first.isEmpty() || first.equals(biome)) return;
        org.bukkit.Location firstAt = parseLoc(player.getWorld(), plugin.getConfig().getString(path + ".biomeAt", ""));
        if (firstAt != null && horizontal(firstAt, to) <= 32) advance(player, contract("biome_border"));
    }

    private void checkPilgrimage(Player player, org.bukkit.Location to) {
        String path = base(player.getUniqueId()) + ".active";
        org.bukkit.Location origin = parseLoc(player.getWorld(),
                plugin.getConfig().getString(path + ".origin", ""));
        if (origin == null || origin.getWorld() != to.getWorld()) return;
        int far = horizontal(origin, to);
        if (plugin.getConfig().getInt(path + ".far", 0) == 0 && far > 500) {
            plugin.getConfig().set(path + ".far", 1);
            plugin.saveConfig();
            player.sendMessage(ChatColor.AQUA + "已远离出发点 500 格！现在原路返回（50 格内）完成朝圣。");
        } else if (plugin.getConfig().getInt(path + ".far", 0) == 1 && far <= 50) advance(player, contract("pilgrimage"));
    }

    private org.bukkit.Location parseLoc(org.bukkit.World world, String raw) {
        if (raw == null || raw.isEmpty()) return null;
        String[] parts = raw.split(",");
        try {
            return new org.bukkit.Location(world, Integer.parseInt(parts[0]), Integer.parseInt(parts[1]),
                    Integer.parseInt(parts[2]));
        } catch (NumberFormatException ex) { return null; }
    }

    private int horizontal(org.bukkit.Location a, org.bukkit.Location b) {
        return Math.max(Math.abs(a.getBlockX() - b.getBlockX()), Math.abs(a.getBlockZ() - b.getBlockZ()));
    }

    // ==== v2.1 六维智能考核：认证 / 轮换 / 多样性 ====

    private int certified(Player player) {
        String path = base(player.getUniqueId()) + ".rituals.certified";
        if (plugin.getConfig().contains(path)) return plugin.getConfig().getInt(path, 0);
        // Existing members already earned their displayed rank before certification existed.
        // Grandfather that rank instead of silently demoting White-Gold/Diamond players.
        int init = rankIndex(fame(player));
        plugin.getConfig().set(path, init);
        org.bukkit.configuration.ConfigurationSection daily =
                plugin.getConfig().getConfigurationSection(base(player.getUniqueId()) + ".daily");
        if (daily != null) for (String key : daily.getKeys(false))
            plugin.getConfig().set(base(player.getUniqueId()) + ".everDone." + key, today());
        if (init > 0) plugin.getLogger().info("Guild v2.1 migrated: player=" + player.getUniqueId()
                + ", certified=" + init);
        plugin.saveConfig();
        return init;
    }

    /** 主插件联动入口：当前有效等级（0青铜…5钻石）。 */
    int rankOf(Player player) { return effectiveRank(player); }

    private int effectiveRank(Player player) { return Math.min(rankIndex(fame(player)), certified(player)); }

    private boolean everDone(Player player, Contract quest) {
        return plugin.getConfig().contains(base(player.getUniqueId()) + ".everDone." + quest.id());
    }

    private List<Contract> everDoneList(Player player) {
        List<Contract> done = new java.util.ArrayList<>();
        for (Contract quest : CONTRACTS) if (everDone(player, quest)) done.add(quest);
        return done;
    }

    private String certRequirementText(int rank) {
        return switch (rank) {
            case 1 -> "声望达标即自动授予";
            case 2 -> "完成过「深层远征」和 1 张约束类委托";
            case 3 -> "完成过「海渊守望」和 1 张协作类委托";
            case 4 -> "完成过「宝库守护者」、20 张不同委托和 1 张语言类委托";
            case 5 -> "完成过「千灯之巅」、25 张不同委托和 1 张感知类委托";
            default -> "无";
        };
    }

    private boolean certRequirementMet(int rank, Player player) {
        List<Contract> done = everDoneList(player);
        switch (rank) {
            case 1: return true;
            case 2: return hasId(done, "deep_explorer") && hasDim(done, 5);
            case 3: return hasId(done, "ocean_guard") && hasDim(done, 3);
            case 4: return hasId(done, "treasure_vault") && done.size() >= 20 && hasDim(done, 4);
            case 5: return hasId(done, "trial_ten") && done.size() >= 25 && hasDim(done, 0);
            default: return false;
        }
    }

    private boolean hasId(List<Contract> done, String id) {
        for (Contract quest : done) if (quest.id().equals(id)) return true;
        return false;
    }

    private boolean hasDim(List<Contract> done, int dim) {
        for (Contract quest : done) if (quest.dim() == dim) return true;
        return false;
    }

    private void checkCertify(Player player) {
        int fameRank = rankIndex(fame(player));
        int certifiedNow = certified(player);
        for (int rank = certifiedNow + 1; rank <= Math.min(fameRank, RANKS.length - 1); rank++) {
            if (!certRequirementMet(rank, player)) {
                player.sendMessage(ChatColor.YELLOW + "声望已达" + RANKS[rank] + "门槛，但晋升需要认证："
                        + certRequirementText(rank) + "。完成委托即可自动认证。");
                break;
            }
            plugin.getConfig().set(base(player.getUniqueId()) + ".rituals.certified", rank);
            player.sendMessage(ChatColor.GOLD + "⚔ 晋升认证通过：" + RANKS[rank - 1] + " → " + RANKS[rank]
                    + "！" + (rank == 1 ? "入门认证自动授予。" : ""));
            plugin.getLogger().info("Guild certified: player=" + player.getUniqueId() + ", rank=" + rank);
        }
        plugin.saveConfig();
    }

    /** 每日轮换：seed=日期 → 2 个主考维度全开 + 其他维度随机 2 张，凑 DAILY_POOL 张。 */
    private static final int DAILY_POOL = 6;
    private List<String> poolIds() {
        java.util.Random random = new java.util.Random(today().hashCode());
        int focusA = random.nextInt(DIMS.length), focusB = random.nextInt(DIMS.length);
        if (focusB == focusA) focusB = (focusB + 1 + random.nextInt(DIMS.length - 1)) % DIMS.length;
        List<Contract> focus = new java.util.ArrayList<>(), others = new java.util.ArrayList<>();
        for (Contract quest : CONTRACTS) (quest.dim() == focusA || quest.dim() == focusB ? focus : others).add(quest);
        java.util.Collections.shuffle(others, random);
        List<String> pool = new java.util.ArrayList<>();
        for (Contract quest : focus) pool.add(quest.id());
        for (int i = 0; i < others.size() && pool.size() < DAILY_POOL; i++) pool.add(others.get(i).id());
        pool.add("high_peak"); // 保底：每人每天都有一张简单感知委托可做
        return pool;
    }

    private int[] todayFocus() {
        java.util.Random random = new java.util.Random(today().hashCode());
        int focusA = random.nextInt(DIMS.length), focusB = random.nextInt(DIMS.length);
        if (focusB == focusA) focusB = (focusB + 1 + random.nextInt(DIMS.length - 1)) % DIMS.length;
        return new int[]{focusA, focusB};
    }

    private boolean availableToday(Player player, Contract quest) {
        if (plugin.taskMarket() != null && plugin.taskMarket().offered(quest.id()) != null) return true;
        if (plugin.dailyBoard() != null && plugin.dailyBoard().card(quest.id()) != null) return true;
        if (poolIds().contains(quest.id())) return true;
        // 等级特权：黑铁 +1、白金 +2 的个人追加池（seed=日期+uuid，公平可复现）
        int rank = effectiveRank(player);
        int extra = rank >= 4 ? 2 : rank >= 1 ? 1 : 0;
        if (extra > 0) {
            java.util.Random random = new java.util.Random((today() + player.getUniqueId()).hashCode());
            List<Contract> others = new java.util.ArrayList<>(CONTRACTS);
            others.removeIf(q -> poolIds().contains(q.id()));
            java.util.Collections.shuffle(others, random);
            for (int i = 0; i < Math.min(extra, others.size()); i++)
                if (others.get(i).id().equals(quest.id())) return true;
        }
        return false;
    }

    private int diversityBonus(Player player, int dim) {
        String key = base(player.getUniqueId()) + ".dailyTypes." + today();
        List<String> types = new java.util.ArrayList<>(List.of(
                plugin.getConfig().getString(key, "").split(",")));
        types.removeIf(String::isEmpty);
        if (!types.contains(String.valueOf(dim))) types.add(String.valueOf(dim));
        plugin.getConfig().set(key, String.join(",", types));
        return types.size();
    }

    private void advance(Player player, Contract quest) {
        if (plugin.taskMarket().isMarket(quest.id()) && player.getGameMode() != GameMode.SURVIVAL) return;
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
        if (plugin.taskMarket().isMarket(quest.id())) plugin.taskMarket().abandoned(player);
        plugin.getConfig().set(base(player.getUniqueId()) + ".active", null);
        plugin.saveConfig();
        player.sendMessage(ChatColor.YELLOW + "已放弃「" + quest.title() + "」，本次进度清零；可重新接单。");
        plugin.getLogger().info("Guild abandoned: player=" + player.getUniqueId() + ", contract=" + quest.id());
    }

    private void claim(Player player) {
        Contract quest = active(player);
        if (quest != null && plugin.taskMarket().isMarket(quest.id())) {
            plugin.taskMarket().verify(player, quest, ready -> { if (ready) claimVerified(player); });
            return;
        }
        claimVerified(player);
    }

    private void claimVerified(Player player) {
        Contract quest = active(player);
        if (quest == null) { player.sendMessage(ChatColor.YELLOW + "当前没有可交付的任务。"); return; }
        if (progress(player) < quest.target()) {
            player.sendMessage(ChatColor.YELLOW + "还需完成「" + quest.title() + "」：" + progress(player)
                    + "/" + quest.target()); return;
        }
        if (doneToday(player, quest)) {
            player.sendMessage(ChatColor.RED + "今日奖励已结算；请联系服主核对异常记录。"); return;
        }
        ItemStack[] playerBefore = null;
        GuildSharedStorage.Receipt delivery = null;
        int deliveryCategory = -1;
        Material deliveredMaterial = null;
        DailyBoardManager.Card dynamic = null;
        if (plugin.dailyBoard() != null && plugin.dailyBoard().card(quest.id()) != null) {
            java.util.Map<?, ?> snapshot = snapshot(player);
            if (snapshot != null) try {
                dynamic = plugin.dailyBoard().savedCard(snapshot);
            } catch (IllegalArgumentException invalid) {
                plugin.getLogger().warning("Dynamic claim snapshot invalid for " + player.getUniqueId());
            }
            if (dynamic == null) dynamic = plugin.dailyBoard().card(quest.id());
        }
        if (quest.goal() == Goal.DONATE) {
            Material offer = Material.matchMaterial(quest.siteId() == null ? "" : quest.siteId());
            if (offer == null || countPlainStorage(player, offer) < quest.target()) {
                player.sendMessage(ChatColor.RED + "背包里没有足够的" + (offer == null ? "指定物品" : offer.name().toLowerCase(Locale.ROOT))
                        + "（需 ×" + quest.target() + "）；备齐再来交付。"); return;
            }
            playerBefore = cloneItems(player.getInventory().getStorageContents());
            int deliveryChest = dynamic != null ? dynamic.chest() : plugin.taskMarket().isMarket(quest.id())
                    ? plugin.taskMarket().chest(player) : -1;
            if (deliveryChest >= 0) {
                delivery = plugin.guildShared().deposit(deliveryChest, new ItemStack(offer, quest.target()));
                if (delivery == null) {
                    player.sendMessage(ChatColor.YELLOW + "同类公共箱及扩容箱空间不足或暂不可用；物品未扣除，任务和奖励未改变。/mycli guild shared 查看公共仓库。");
                    player.sendMessage("MC_GUILD_DELIVERY {\"schemaVersion\":1,\"status\":\"denied\",\"reason\":\"public_storage_full_or_unavailable\",\"itemsDebited\":false}");
                    return;
                }
                deliveryCategory = deliveryChest; deliveredMaterial = offer;
            }
            if (!removePlainStorage(player, offer, quest.target())) {
                player.getInventory().setStorageContents(playerBefore);
                if (delivery != null) delivery.rollback();
                player.sendMessage(ChatColor.RED + "背包物品发生变化；交付未执行，请重试。"); return;
            }
        }
        if (plugin.taskMarket().isMarket(quest.id()) && plugin.taskMarket().advanceStep(player)) {
            if (delivery != null) delivery.announce(player, deliveryCategory, deliveredMaterial, quest.target());
            return;
        }
        if (plugin.taskMarket().isMarket(quest.id()) && !plugin.taskMarket().beforeComplete(player)) {
            if (playerBefore != null) player.getInventory().setStorageContents(playerBefore);
            if (delivery != null) delivery.rollback();
            return;
        }
        String path = base(player.getUniqueId());
        int emeraldGain = quest.emeralds();
        if (effectiveRank(player) >= 3) emeraldGain += Math.max(1, quest.emeralds() / 10); // 黄金特权：结算绿宝石 +10%
        if (!dungeon.queueGuildRewards(player.getUniqueId(), emeraldGain, quest.bonus(), quest.bonusCount())) {
            if (playerBefore != null) player.getInventory().setStorageContents(playerBefore);
            if (delivery != null) delivery.rollback();
            player.sendMessage(ChatColor.RED + "个人奖励箱数据异常，交付未执行；请联系服主核对。");
            plugin.getLogger().warning("Guild reward refused: player=" + player.getUniqueId()
                    + ", contract=" + quest.id());
            return;
        }
        int dims = diversityBonus(player, quest.dim());
        int gain = dims >= 3 ? quest.fame() + (int) Math.ceil(quest.fame() * 0.2) : quest.fame();
        int nextFame = fame(player) + gain;
        plugin.getConfig().set(path + ".fame", nextFame);
        plugin.getConfig().set(path + ".completed", plugin.getConfig().getInt(path + ".completed", 0) + 1);
        String completedDate = dynamic == null ? today() : dynamic.date();
        plugin.getConfig().set(path + ".daily." + quest.id(), completedDate);
        plugin.getConfig().set(path + ".everDone." + quest.id(), completedDate);
        if (plugin.taskMarket().isMarket(quest.id())) plugin.taskMarket().completed(player);
        plugin.getConfig().set(path + ".active", null);
        plugin.saveConfig();
        if (plugin.taskMarket().isMarket(quest.id())) plugin.taskMarket().afterComplete(player, quest.id());
        player.sendMessage(ChatColor.GREEN + "委托交付成功！声望 +" + gain
                + (dims >= 3 ? "（含三维度 +20% 加成，今日已集 " + dims + " 个维度）" : "")
                + "，绿宝石 ×" + emeraldGain + "及额外奖励已存入个人试炼箱。");
        if (dynamic != null) player.sendMessage(ChatColor.GREEN + dynamic.beneficiary()
                + "收到了这份帮助。" + (delivery == null ? "" : "物资已进入公会公共仓库（含同类扩容箱）。"));
        if (delivery != null) delivery.announce(player, deliveryCategory, deliveredMaterial, quest.target());
        if (rankIndex(nextFame) > certified(player)) checkCertify(player);
        plugin.getLogger().info("Guild claimed: player=" + player.getUniqueId() + ", contract=" + quest.id()
                + ", fame=" + nextFame);
    }

    private ItemStack[] cloneItems(ItemStack[] source) {
        ItemStack[] copy = new ItemStack[source.length];
        for (int i = 0; i < source.length; i++) copy[i] = source[i] == null ? null : source[i].clone();
        return copy;
    }

    private int countPlainStorage(Player player, Material material) {
        ItemStack plain = new ItemStack(material);
        int total = 0;
        for (ItemStack stack : player.getInventory().getStorageContents())
            if (stack != null && stack.isSimilar(plain)) total += stack.getAmount();
        return total;
    }

    private boolean removePlainStorage(Player player, Material material, int amount) {
        if (countPlainStorage(player, material) < amount) return false;
        ItemStack[] slots = cloneItems(player.getInventory().getStorageContents());
        ItemStack plain = new ItemStack(material);
        int needed = amount;
        for (int i = 0; i < slots.length && needed > 0; i++) {
            ItemStack stack = slots[i];
            if (stack == null || !stack.isSimilar(plain)) continue;
            int take = Math.min(needed, stack.getAmount());
            if (take == stack.getAmount()) slots[i] = null;
            else stack.setAmount(stack.getAmount() - take);
            needed -= take;
        }
        if (needed != 0) return false;
        player.getInventory().setStorageContents(slots);
        return true;
    }

    private int freeCapacity(Inventory inventory, Material material) {
        ItemStack plain = new ItemStack(material);
        int free = 0;
        for (ItemStack item : inventory.getContents()) {
            if (item == null || item.getType().isAir()) free += material.getMaxStackSize();
            else if (item.isSimilar(plain)) free += item.getMaxStackSize() - item.getAmount();
        }
        return free;
    }

    void fillBoard(Player player, Inventory inventory) {
        int rank = effectiveRank(player);
        inventory.setItem(0, icon(Material.BOOK, "§6冒险者档案", "等级：" + RANKS[rank],
                "声望：" + fame(player), member(player) ? "点击查看当前任务" : "点击注册入会"));
        inventory.setItem(7, icon(Material.CLOCK, "§6今日动态委托", "每日 05:00 更新", "下方是常驻委托"));
        inventory.setItem(8, icon(Material.BRICKS, "§6任务市场 · 千灯纪委托", "远征探索、工程、红石与多阶段生活任务", "点击查看任务与本人能力记录"));
        inventory.setItem(9,icon(Material.WRITABLE_BOOK,"§6玩家委托","收购、结伴讨伐与探索；报酬先托管"));
        List<DailyBoardManager.Card> dynamic = plugin.dailyBoard().cards();
        for (int i = 0; i < Math.min(5, dynamic.size()); i++) {
            Contract quest = dynamic.get(i).contract();
            inventory.setItem(1 + i, icon(quest.icon(), "§6今日 §e" + quest.title() + " §7(" + quest.id() + ")",
                    quest.description(), "声望 +" + quest.fame() + " / 绿宝石 ×" + quest.emeralds(),
                    doneToday(player, quest) ? "今天已完成" : "点击接单"));
        }
        for (int i = 0; i < CONTRACTS.size(); i++) {
            Contract quest = CONTRACTS.get(i);
            String state = !availableToday(player, quest) ? "今日未开放（轮换）"
                    : doneToday(player, quest) ? "今天已完成"
                    : quest.minRank() > rank ? "需要" + RANKS[quest.minRank()] : "点击接单";
            inventory.setItem(10 + i, icon(quest.icon(), "§e" + quest.title() + " §7(" + quest.id() + ")",
                new String[]{"§7维度：" + DIMS[quest.dim()], quest.description(),
                    "声望 +" + quest.fame() + " / 绿宝石 ×" + quest.emeralds(), state}));
        }
        Contract quest = active(player);
        inventory.setItem(48, icon(Material.BARRIER, "§c放弃当前委托", quest == null ? "没有在办的任务"
                : "放弃「" + quest.title() + "」；进度清零"));
        inventory.setItem(49, icon(Material.EMERALD, "§a交付已完成委托", quest == null ? "没有在办的任务"
                : quest.title() + " " + progress(player) + "/" + quest.target(), "点击领取声望与箱中物资"));
        inventory.setItem(50, icon(Material.CHEST, "§6个人奖励箱", "左键第1页；右键选择10页540格；远程2魔力"));
        inventory.setItem(51, icon(Material.IRON_SWORD, "§c前往地下城", "前往试炼塔入口"));
        inventory.setItem(52, icon(Material.ARROW, "§7返回技能", "返回技能罗盘"));
        inventory.setItem(47, icon(Material.SUNFLOWER, "§a生活公会", "种田、烹饪、钓鱼、建筑、写书和红石机关"));
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
        else if (slot == 8) plugin.taskMarket().openMenu(player);
        else if (slot == 9) plugin.playerContracts().open(player,1);
        else if (slot >= 1 && slot <= plugin.dailyBoard().cards().size())
            accept(player, plugin.dailyBoard().cards().get(slot - 1).id());
        else if (slot >= 10 && slot < 10 + CONTRACTS.size()) accept(player, CONTRACTS.get(slot - 10).id());
        else if (slot == 48) abandon(player);
        else if (slot == 49) claim(player);
        else if (slot == 50) dungeon.command(player, new String[]{"arena", "rewards"});
    }

    String bookPage(Player player) {
        if (!member(player)) return "§6冒险者公会§r\n\n尚未注册。\n\n在技能罗盘打开公会看板，或输入 /mycli guild join 加入。";
        int reputation = fame(player), rank = effectiveRank(player);
        Contract quest = active(player);
        return "§6冒险者公会§r\n\n等级：" + RANKS[rank] + "\n声望：" + reputation
                + "\n完成：" + plugin.getConfig().getInt(base(player.getUniqueId()) + ".completed", 0)
                + " 单（六维考核制）\n\n当前任务：" + (quest == null ? "无"
                : quest.title() + " " + progress(player) + "/" + quest.target())
                + "\n\n看板每日轮换；完成 3 个不同\n维度，当日声望 +20%。";
    }
}
