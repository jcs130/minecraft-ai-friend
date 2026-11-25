package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.papermc.paper.event.player.PlayerTradeEvent;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.block.data.Ageable;
import org.bukkit.block.data.Lightable;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerEditBookEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.BookMeta;
import org.bukkit.inventory.meta.ItemMeta;

/** Small daily life contracts using only vanilla actions and items on every client. */
final class LifeGuildManager implements Listener {
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final String CHANNEL = "mcagent:life";
    private record Contract(String id, String guildId, String guild, String title, String description,
            Material icon, int target, int reputation, int emeralds, Material gift, int giftCount) { }
    private static final List<Contract> CONTRACTS = List.of(
            new Contract("farmer_harvest", "farmer", "田园公会", "丰收的一天", "收获 12 株成熟小麦；同一块田只计一次",
                    Material.WHEAT, 12, 3, 2, Material.BONE_MEAL, 4),
            new Contract("gourmet_bread", "gourmet", "美食家公会", "给大家烤面包", "亲手合成 3 次面包",
                    Material.BREAD, 3, 3, 2, Material.HONEY_BOTTLE, 1),
            new Contract("angler_catch", "angler", "钓客公会", "河畔小憩", "用鱼竿钓起 3 条鱼",
                    Material.FISHING_ROD, 3, 3, 2, Material.CAMPFIRE, 1),
            new Contract("builder_home", "builder", "建筑家公会", "搭一间小屋", "亲手建至少3×3室内小屋：完整地面、两格高墙、屋顶、外墙玻璃窗、可通行门和床；到床24格内验房",
                    Material.CHERRY_PLANKS, 7, 4, 3, Material.FLOWER_POT, 2),
            new Contract("author_story", "author", "故事公会", "旅途的一页", "签署一本至少 40 字的原创游记；书留在自己手中",
                    Material.WRITABLE_BOOK, 1, 4, 2, Material.BOOKSHELF, 1),
            new Contract("tinkerer_light", "tinkerer", "机关工匠公会", "点亮第一盏灯", "亲手放置红石灯，再用附近拉杆点亮它",
                    Material.REDSTONE_LAMP, 1, 4, 3, Material.REDSTONE, 4),
            new Contract("trader_supply", "trader", "商旅公会", "村庄收购单", "把物资卖给两种不同职业的村民，换取绿宝石",
                    Material.EMERALD, 2, 4, 2, Material.PAPER, 4));

    private final AgentFriendPlugin plugin;
    private final DungeonManager dungeon;
    private final java.util.Map<java.util.UUID, StarterHouseValidator.Result> lastHomes = new java.util.HashMap<>();

    LifeGuildManager(AgentFriendPlugin plugin, DungeonManager dungeon) {
        this.plugin = plugin;
        this.dungeon = dungeon;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
    }

    private String today() { return LocalDate.now(ZONE).toString(); }
    private String base(Player player) { return "life-guild." + player.getUniqueId(); }
    private Contract byId(String id) {
        for (Contract contract : CONTRACTS) if (contract.id().equals(id)) return contract;
        return null;
    }
    private Contract active(Player player) {
        return byId(plugin.getConfig().getString(base(player) + ".active.id", ""));
    }
    private int progress(Player player) {
        Contract c = active(player);
        return c != null && c.id().equals("builder_home") ? StarterHouseInspection.inspect(player, houseRecords(player)).progress()
                : plugin.getConfig().getInt(base(player) + ".active.progress");
    }
    private boolean completedToday(Player player, Contract contract) {
        return today().equals(plugin.getConfig().getString(base(player) + ".done." + contract.id()));
    }
    String activeId(Player player) { return plugin.getConfig().getString(base(player) + ".active.id", ""); }
    boolean hasActiveContract(Player player) { return !activeId(player).isEmpty(); }
    boolean contractId(String id) { return byId(id) != null; }
    List<GuildManager.Contract> catalog() {
        return CONTRACTS.stream().filter(c -> !RetiredActivities.retired(c.id())).map(c -> new GuildManager.Contract(
                c.id(), c.title(), c.description(), c.icon(), switch (c.guildId()) {
                    case "farmer" -> GuildManager.Goal.HARVEST;
                    case "gourmet" -> GuildManager.Goal.CRAFT;
                    case "angler" -> GuildManager.Goal.FISH;
                    case "builder" -> GuildManager.Goal.BUILD;
                    case "trader" -> GuildManager.Goal.TRADE;
                    case "tinkerer" -> GuildManager.Goal.REDSTONE;
                    default -> GuildManager.Goal.CRAFT;
                }, c.target(), 0, 0, c.reputation(), c.emeralds(), c.gift(), c.giftCount())).toList();
    }
    String acceptanceReason(Player player, String id) {
        Contract c = byId(id);
        if (c == null) return "task_not_found";
        if (RetiredActivities.retired(id)) return "retired";
        if (player.getGameMode() != GameMode.SURVIVAL) return "requires_survival";
        if (hasActiveContract(player) || plugin.guild().hasAdventureContract(player)) return "another_contract_active";
        if (plugin.skillAssessments() != null && plugin.skillAssessments().busy(player)) return "exam_contract_incompatible";
        if (completedToday(player, c)) return "done_today";
        return "available";
    }
    private List<String> houseRecords(Player p) {
        if (!HouseEvidence.available(plugin)) return List.of();
        long accepted = plugin.getConfig().getLong(base(p) + ".active.acceptedAt", 0);
        // No timestamp is invented for old contracts; their original list is ordinary-life-only.
        if (accepted > 0) return HouseEvidence.placementsSince(plugin, p, accepted);
        var records = new java.util.ArrayList<>(HouseEvidence.allRecords(plugin, p));
        records.addAll(plugin.getConfig().getStringList(base(p) + ".active.house-placed"));
        return records;
    }
    JsonObject onboardingState(Player player) { return taskState(player); }
    /** Journal/catalogue reads must not refresh a cache, save progress or settle rewards. */
    JsonObject taskState(Player player) {
        JsonObject out = new JsonObject(); Contract contract = active(player);
        var house = contract != null && contract.id().equals("builder_home")
                ? StarterHouseInspection.inspect(player, houseRecords(player)) : null;
        int observed = house == null ? progress(player) : house.progress();
        boolean ready = contract != null && (house == null ? observed >= contract.target() : house.ready());
        out.addProperty("queryOnly", true); out.addProperty("kind", "life"); out.addProperty("track", "guild");
        out.addProperty("fame", plugin.guild().reputation(player));
        out.addProperty("fameReward", contract == null ? 0 : contract.reputation());
        out.addProperty("available", activeId(player).isEmpty() || contract != null && (house == null || HouseEvidence.available(plugin) && !house.reason().equals("nearby_chunk_not_loaded")));
        out.addProperty("acceptedAt", plugin.getConfig().getLong(base(player) + ".active.acceptedAt", 0));
        out.addProperty("runId", plugin.getConfig().getString(base(player) + ".active.runId", ""));
        out.addProperty("actorId", player.getUniqueId().toString()); out.addProperty("activeId", activeId(player));
        out.addProperty("title", contract == null ? "生活委托" : contract.title());
        out.addProperty("instruction", contract == null ? "" : contract.description());
        out.addProperty("condition", contract == null ? "" : contract.description());
        out.addProperty("progress", contract == null ? 0 : observed); out.addProperty("target", contract == null ? 0 : contract.target());
        out.addProperty("remaining", contract == null ? 0 : Math.max(0, contract.target() - observed));
        out.addProperty("ready", ready); out.addProperty("requiresVerification", house != null);
        out.addProperty("status", contract == null ? activeId(player).isEmpty() ? "none" : "unavailable" : ready ? "ready_to_submit" : "active");
        out.addProperty("nextCommand", contract == null ? "/mycli guild board" : ready ? "/mycli guild claim" : house != null ? "/mycli guild verify" : "/mycli guild status");
        out.addProperty("nextAction", contract == null ? "在公会看板选择委托" : ready ? "用 /mycli guild claim 交付此单" : house == null ? contract.description() : StarterHouseInspection.hint(house));
        out.addProperty("progressSource", house == null ? "server_action_ledger" : "house-evidence");
        if (house != null) { out.add("house", StarterHouseInspection.json(house)); out.addProperty("missingAdvice", StarterHouseInspection.hint(house)); }
        out.addProperty("availableId", CONTRACTS.stream().filter(c -> !RetiredActivities.retired(c.id()) && !completedToday(player, c)).map(Contract::id).findFirst().orElse(""));
        return out;
    }
    JsonObject skillState(Player player) {
        JsonObject out = new JsonObject(); JsonArray skills = new JsonArray(); JsonObject archive = new JsonObject();
        out.addProperty("queryOnly", true); out.addProperty("track", "skills"); out.addProperty("actorId", player.getUniqueId().toString());
        for (Contract c : CONTRACTS) {
            int rep = plugin.getConfig().getInt(base(player) + ".reputation." + c.guildId());
            JsonObject row;
            if (!LifeContractSettlement.retainedSkill(c.guildId())) {
                row = FoundationGrowth.skill(player, c.guildId().equals("angler") ? "fishing" : "farming");
                row.addProperty("legacyId", c.guildId()); archive.addProperty(c.guildId(), rep);
            } else {
                row = new JsonObject(); row.addProperty("id", c.guildId()); row.addProperty("authority", "life-guild");
                row.addProperty("available", true); row.addProperty("proficiency", rep); row.addProperty("rank", rank(rep));
                row.addProperty("level", rep >= 50 ? 3 : rep >= 20 ? 2 : rep >= 6 ? 1 : 0);
                row.addProperty("nextThreshold", rep >= 50 ? 0 : rep >= 20 ? 50 : rep >= 6 ? 20 : 6);
            }
            row.addProperty("name", c.guild().replace("公会", "技艺")); skills.add(row);
        }
        out.addProperty("available", true); out.addProperty("authority", "life-guild/AuraSkills");
        var summary = new java.util.ArrayList<String>();
        for (var item : skills) {
            var row = item.getAsJsonObject();
            summary.add(row.get("name").getAsString() + " " + (row.get("available").getAsBoolean()
                    ? row.has("proficiency") ? row.get("rank").getAsString() + " 熟练度 " + row.get("proficiency").getAsInt()
                    : "AuraSkills Lv." + row.get("level").getAsInt() + " XP " + row.get("xp").getAsDouble()
                    : "AuraSkills unavailable"));
        }
        out.addProperty("nextAction", String.join("；", summary)); out.addProperty("nextCommand", "/mycli skills");
        out.add("skills", skills); JsonObject deprecated = new JsonObject(); deprecated.add("reputation", archive); out.add("deprecatedArchival", deprecated);
        return out;
    }
    private String skillText(Player p, Contract c) {
        if (LifeContractSettlement.retainedSkill(c.guildId())) {
            int rep = plugin.getConfig().getInt(base(p) + ".reputation." + c.guildId());
            return "生活技艺 " + rank(rep) + " · 熟练度 " + rep;
        }
        var row = FoundationGrowth.skill(p, c.guildId().equals("angler") ? "fishing" : "farming");
        return row.get("available").getAsBoolean() ? "AuraSkills Lv." + row.get("level").getAsInt() + " · XP " + row.get("xp").getAsDouble() : "AuraSkills unavailable（未加载）";
    }
    boolean verify(Player player) {
        Contract c = active(player);
        if (c == null) return false;
        if (c.id().equals("builder_home")) {
            var result = refreshHouse(player); player.sendMessage(ChatColor.YELLOW + StarterHouseInspection.hint(result));
            return result.ready();
        }
        status(player); return progress(player) >= c.target();
    }

    void command(Player player, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "board";
        switch (action) {
            case "board", "list", "看板" -> board(player);
            case "menu", "菜单" -> plugin.openLifeGuildMenu(player);
            case "locations", "地点", "npc" -> plugin.lifeBuildings().locations(player);
            case "visit", "拜访" -> {
                if (args.length < 3) player.sendMessage("§e用法：/mycli life visit harvest|harbor|workshop|library");
                else plugin.lifeBuildings().visit(player, args[2]);
            }
            case "status", "状态" -> status(player);
            case "accept", "接单" -> {
                if (args.length < 3) player.sendMessage(ChatColor.YELLOW + "用法：/mycli life accept <任务ID>");
                else accept(player, args[2].toLowerCase(Locale.ROOT));
            }
            case "verify", "验收" -> verify(player);
            case "claim", "交付", "领取" -> claim(player);
            case "abandon", "放弃" -> abandon(player);
            case "write", "写书" -> write(player, args);
            default -> player.sendMessage(ChatColor.YELLOW
                    + "用法：/mycli life board|menu|status|locations|visit <建筑ID>|accept <任务ID>|claim|abandon|write <书名>|<正文>");
        }
    }

    private void board(Player player) {
        status(player);
        for (Contract contract : CONTRACTS) {
            if (RetiredActivities.retired(contract.id())) continue;
            String state = contract.id().equals(activeId(player)) ? "在途" : acceptanceReason(player, contract.id());
            player.sendMessage(ChatColor.GOLD + contract.guild() + ChatColor.WHITE + " "
                    + contract.id() + " · " + contract.title() + " · " + contract.description()
                    + " · 公会声望+" + contract.reputation() + " [" + state + "]");
        }
        player.sendMessage(ChatColor.GRAY + "接单 /mycli guild accept <ID>；完成后 /mycli guild claim（life 命令兼容）。"
                + "手柄可用 /mycli life menu 或技能罗盘进入看板。");
    }

    private void status(Player player) {
        if (active(player) != null && active(player).id().equals("builder_home")) refreshHouse(player);
        Contract contract = active(player);
        player.sendMessage(ChatColor.AQUA + "公会生活委托：" + (contract == null ? "当前没有委托"
                : contract.guild() + "「" + contract.title() + "」 " + progress(player) + "/" + contract.target()));
        if (contract != null && contract.id().equals("trader_supply"))
            player.sendMessage(ChatColor.GRAY + "已向这些职业出售：" + seenProfessionText(player)
                    + "；/mycli village villagers 查附近村民的真实收购报价。");
        for (Contract guild : CONTRACTS)
            player.sendMessage(ChatColor.GRAY + guild.guild().replace("公会", "技艺") + " · " + skillText(player, guild));
        JsonObject json = new JsonObject();
        json.addProperty("schemaVersion", 1);
        json.addProperty("kind", "status");
        json.addProperty("activeId", contract == null ? "" : contract.id());
        json.addProperty("progress", contract == null ? 0 : progress(player));
        json.addProperty("target", contract == null ? 0 : contract.target());
        json.add("seenProfessions", seenProfessions(player));
        json.add("skills", skillState(player));
        json.addProperty("fame", plugin.guild().reputation(player));
        if (contract != null && contract.id().equals("builder_home")) {
            var r=lastHomes.get(player.getUniqueId());json.add("house",StarterHouseInspection.json(r));
            player.sendMessage(ChatColor.YELLOW+StarterHouseInspection.hint(r));
        }
        send(player, json);
        String[] dailyThoughts = {
                "今日无委托也可：去钓一次鱼、看一场日落，都算过好了今天。",
                "今天可以出门发现一处新风景，再把故事写进游记。",
                "做完想做的事，也别忘了在灯下歇一会儿。"
        };
        int thought = Math.floorMod((java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"))
                + player.getUniqueId().toString()).hashCode(), dailyThoughts.length);
        player.sendMessage(ChatColor.GRAY + dailyThoughts[thought]);
    }

    private String rank(int reputation) {
        if (reputation >= 50) return "大师";
        if (reputation >= 20) return "匠人";
        if (reputation >= 6) return "熟手";
        return "学徒";
    }

    private void accept(Player player, String id) {
        if (RetiredActivities.retired(id)) { player.sendMessage(ChatColor.YELLOW + RetiredActivities.HINT); return; }
        Contract contract = byId(id);
        if (contract == null) { player.sendMessage(ChatColor.RED + "未知生活委托；/mycli life board 查看任务 ID。"); return; }
        if (player.getGameMode() == GameMode.SPECTATOR) { player.sendMessage(ChatColor.RED + "旁观者不能接委托；请使用生存角色，/mycli life board 查看生活委托。"); return; }
        String reason = acceptanceReason(player, id);
        if (!reason.equals("available")) { player.sendMessage(ChatColor.YELLOW + reason + "；/mycli guild status 或 guild exam status 核对在途任务。"); return; }
        String path = base(player) + ".active";
        try {
            LifeContractSettlement.atomic(plugin.getConfig(), () -> {
                String guild = "guild-players." + player.getUniqueId();
                if (!plugin.getConfig().contains(guild + ".joined")) plugin.getConfig().set(guild + ".joined", today());
                plugin.getConfig().set(path, null);
                plugin.getConfig().set(path + ".id", contract.id());
                plugin.getConfig().set(path + ".progress", 0);
                plugin.getConfig().set(path + ".acceptedAt", System.currentTimeMillis());
                plugin.getConfig().set(path + ".runId", java.util.UUID.randomUUID().toString());
                if (id.equals("builder_home")) plugin.getConfig().set(path + ".house-rule", 2);
                return true;
            }, () -> DurableConfigStore.persist(plugin), () -> Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown")));
        } catch (java.io.IOException | RuntimeException failed) {
            player.sendMessage(ChatColor.RED + "接单保存未确认；查询原委托记录，未知结果不要重接。"); return;
        }
        player.sendMessage(ChatColor.GREEN + "已接「" + contract.title() + "」：" + contract.description());
        if (contract.id().equals("author_story")) starter(player, Material.WRITABLE_BOOK, "书与笔");
        if (contract.id().equals("angler_catch")) starter(player, Material.FISHING_ROD, "鱼竿");
        receipt(player, "accept", contract, true, "accepted");
        plugin.communication().taskTransition(player,"contract",contract.id(),"active","/mycli journal");
    }

    private void starter(Player player, Material material, String label) {
        String key = base(player) + ".starter." + material.name().toLowerCase(Locale.ROOT);
        if (plugin.getConfig().getBoolean(key) || player.getInventory().contains(material)) return;
        if (player.getInventory().firstEmpty() < 0) {
            player.sendMessage(ChatColor.YELLOW + "背包满了；" + label + "可自行准备，或空出一格后放弃并重接。");
            return;
        }
        player.getInventory().addItem(new ItemStack(material));
        plugin.getConfig().set(key, true);
        plugin.saveConfig();
        player.sendMessage(ChatColor.GREEN + "公会送你一件入门工具：" + label + "。");
    }

    private void abandon(Player player) {
        Contract contract = active(player);
        if (contract == null) { player.sendMessage(ChatColor.YELLOW + "没有在办的生活委托；/mycli life status 核对，想接单先 life board 查ID，再 life accept <ID>。"); return; }
        try {
            LifeContractSettlement.atomic(plugin.getConfig(), () -> {
                plugin.getConfig().set(base(player) + ".active", null); return true;
            }, () -> DurableConfigStore.persist(plugin), () -> Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown")));
        } catch (java.io.IOException | RuntimeException failed) {
            player.sendMessage(ChatColor.RED + "放弃未保存，原委托保留。"); return;
        }
        lastHomes.remove(player.getUniqueId());
        player.sendMessage(ChatColor.YELLOW + "已放弃「" + contract.title() + "」。");
        receipt(player, "abandon", contract, true, "abandoned");
    }

    private void claim(Player player) {
        if(player.getGameMode()!=GameMode.SURVIVAL){player.sendMessage(ChatColor.YELLOW+"需要生存角色才能交付；原委托记录保留。");return;}
        Contract contract = active(player);
        if (contract == null) { player.sendMessage(ChatColor.YELLOW + "没有可交付的生活委托；/mycli life status 核对，先 life board 选单，accept 后按说明完成再 claim。"); return; }
        if (contract.id().equals("builder_home") && !refreshHouse(player).ready()) {
            player.sendMessage(ChatColor.YELLOW + StarterHouseInspection.hint(lastHomes.get(player.getUniqueId())));
            receipt(player,"claim",contract,false,"house_incomplete"); return;
        }
        if (progress(player) < contract.target()) {
            player.sendMessage(ChatColor.YELLOW + "当前进度 " + progress(player) + "/" + contract.target() + "；/mycli life status 核对目标，继续「" + contract.description() + "」，完成后 life claim。"); return;
        }
        if (completedToday(player, contract)) { player.sendMessage(ChatColor.RED + "今日已结算，请联系服主核对。"); return; }
        String base = base(player);
        String run = plugin.getConfig().getString(base + ".active.runId", "");
        if (run.isEmpty()) run = java.util.UUID.randomUUID().toString(); // Old active contracts may finish, never old done receipts.
        String receiptPath = base + ".completion-receipts." + run;
        if (plugin.getConfig().contains(receiptPath)) {
            receipt(player, "claim", contract, false, "already_settled"); return;
        }
        try {
            boolean committed = LifeContractSettlement.atomic(plugin.getConfig(), () -> {
                if (!dungeon.queueGuildRewards(player.getUniqueId(), contract.emeralds(), contract.gift(), contract.giftCount())) return false;
                plugin.guild().stageLifeCompletion(player, contract.id(), contract.reputation());
                if (LifeContractSettlement.retainedSkill(contract.guildId())) {
                    String skill = base + ".reputation." + contract.guildId();
                    plugin.getConfig().set(skill, Math.addExact(plugin.getConfig().getInt(skill), contract.reputation()));
                }
                plugin.getConfig().set(base + ".done." + contract.id(), today());
                plugin.getConfig().set(receiptPath + ".id", contract.id());
                plugin.getConfig().set(receiptPath + ".actor", player.getUniqueId().toString());
                plugin.getConfig().set(receiptPath + ".completedAt", System.currentTimeMillis());
                plugin.getConfig().set(receiptPath + ".fame", contract.reputation());
                plugin.getConfig().set(receiptPath + ".emeralds", contract.emeralds());
                plugin.getConfig().set(receiptPath + ".gift", contract.gift().name());
                plugin.getConfig().set(receiptPath + ".giftCount", contract.giftCount());
                plugin.getConfig().set(base + ".active", null);
                return true;
            }, () -> DurableConfigStore.persist(plugin), () -> Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown")));
            if (!committed) {
                player.sendMessage(ChatColor.RED + "奖励箱数据异常，未交付。");
                receipt(player, "claim", contract, false, "reward_storage_error"); return;
            }
        } catch (java.io.IOException | RuntimeException failed) {
            player.sendMessage(ChatColor.RED + "结算未确认，原回执与奖励记录保留；先只读对账，不重复领取，存储异常请联系服主。");
            receipt(player, "claim", contract, false, "state_commit_unavailable"); return;
        }
        player.sendMessage(ChatColor.GREEN + "公会生活委托完成！公会声望 +" + contract.reputation()
                + "；绿宝石与小礼物已进入个人试炼箱。" + skillText(player, contract));
        receipt(player, "claim", contract, true, "claimed");
        plugin.communication().taskTransition(player,"contract",contract.id(),"complete","/mycli journal");
        plugin.recordWorldLesson(player, "life");
        // Shelter exams inspect HouseEvidence directly on submit; claiming is neither necessary nor proof.
        plugin.getLogger().info("Life guild claim: player=" + player.getUniqueId() + ", id=" + contract.id());
    }

    private void advance(Player player, String id, String uniquePosition) {
        Contract contract = active(player);
        if (contract == null || !contract.id().equals(id) || progress(player) >= contract.target()) return;
        String path = base(player) + ".active";
        int next = progress(player) + 1;
        try {
            boolean changed = LifeContractSettlement.atomic(plugin.getConfig(), () -> {
                if (uniquePosition != null) {
                    Set<String> seen = new HashSet<>(plugin.getConfig().getStringList(path + ".seen"));
                    if (!seen.add(uniquePosition)) return false;
                    plugin.getConfig().set(path + ".seen", List.copyOf(seen));
                }
                plugin.getConfig().set(path + ".progress", next); return true;
            }, () -> DurableConfigStore.persist(plugin), () -> Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown")));
            if (!changed) return;
        } catch (java.io.IOException | RuntimeException failed) {
            player.sendMessage(ChatColor.RED + "行动进度未保存，请稍后重试。"); return;
        }
        if (next == contract.target()) player.sendMessage(ChatColor.GOLD + "「" + contract.title()
                + "」已达成！在看板点击交付，或 /mycli life claim。");
        else player.sendMessage(ChatColor.AQUA + "「" + contract.title() + "」 " + next + "/" + contract.target());
        receipt(player, "progress", contract, true, "progressed");
    }

    private String position(org.bukkit.Location location) {
        return location.getWorld().getUID() + ":" + location.getBlockX() + ":"
                + location.getBlockY() + ":" + location.getBlockZ();
    }

    private JsonArray seenProfessions(Player player) {
        JsonArray seen = new JsonArray();
        for (String value : plugin.getConfig().getStringList(base(player) + ".active.seen"))
            if (value.startsWith("profession:")) seen.add(value.substring("profession:".length()));
        return seen;
    }

    private String seenProfessionText(Player player) {
        JsonArray seen = seenProfessions(player);
        return seen.size() == 0 ? "暂无" : seen.toString();
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onHarvest(BlockBreakEvent event) {
        if (event.getBlock().getType() != Material.WHEAT
                || !(event.getBlock().getBlockData() instanceof Ageable age)
                || age.getAge() != age.getMaximumAge()) return;
        advance(event.getPlayer(), "farmer_harvest", position(event.getBlock().getLocation()));
    }

    private final java.util.Map<java.util.UUID, Boolean> breadShiftClicks = new java.util.HashMap<>();
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCraft(CraftItemEvent event) {
        if (!(event.getWhoClicked() instanceof Player p)) return;
        breadShiftClicks.remove(p.getUniqueId());
        if (event.isShiftClick() && event.getCurrentItem() != null && event.getCurrentItem().getType() == Material.BREAD) {
            breadShiftClicks.put(p.getUniqueId(), false);
            Bukkit.getScheduler().runTask(plugin, () -> breadShiftClicks.remove(p.getUniqueId()));
        }
    }
    /** Extraction statistic is emitted for both native bodies and client crafting, not recipe previews. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCraftExtract(org.bukkit.event.player.PlayerStatisticIncrementEvent event) {
        if (event.getStatistic() != org.bukkit.Statistic.CRAFT_ITEM || event.getMaterial() != Material.BREAD
                || event.getNewValue() <= event.getPreviousValue()
                || !(event.getPlayer().getOpenInventory().getTopInventory() instanceof org.bukkit.inventory.CraftingInventory)) return;
        Player p = event.getPlayer();
        if (breadShiftClicks.containsKey(p.getUniqueId())) {
            if (breadShiftClicks.get(p.getUniqueId())) return;
            breadShiftClicks.put(p.getUniqueId(), true);
        }
        advance(p, "gourmet_bread", null);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFish(PlayerFishEvent event) {
        if (event.getState() != PlayerFishEvent.State.CAUGHT_FISH
                || !(event.getCaught() instanceof Item item)) return;
        Material type = item.getItemStack().getType();
        if (type == Material.COD || type == Material.SALMON || type == Material.TROPICAL_FISH
                || type == Material.PUFFERFISH) advance(event.getPlayer(), "angler_catch", null);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBuild(BlockPlaceEvent event) {
        Player p = event.getPlayer(); Contract current = active(p);
        java.util.List<org.bukkit.block.Block> blocks = event instanceof org.bukkit.event.block.BlockMultiPlaceEvent multi
                ? multi.getReplacedBlockStates().stream().map(org.bukkit.block.BlockState::getBlock).distinct().toList()
                : List.of(event.getBlockPlaced());
        boolean recording = p.getGameMode()==GameMode.SURVIVAL && (current != null && current.id().equals("builder_home") || recordingShelter(p));
        if (!HouseEvidence.placed(plugin, p, blocks, recording)) {
            p.sendMessage(ChatColor.RED + "施工事实未保存，暂不能验房或认证；存储恢复后重新施工。"); return;
        }
        if (event.getBlockPlaced().getType() == Material.REDSTONE_LAMP && current != null && current.id().equals("tinkerer_light")) {
            try {
                LifeContractSettlement.atomic(plugin.getConfig(), () -> {
                    plugin.getConfig().set(base(p) + ".active.lamp", position(event.getBlockPlaced().getLocation())); return true;
                }, () -> DurableConfigStore.persist(plugin), () -> Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown")));
            } catch (java.io.IOException | RuntimeException failed) {
                p.sendMessage(ChatColor.RED + "灯的施工记录未保存；暂不能交付。"); return;
            }
            p.sendMessage(ChatColor.AQUA + "红石灯已登记；在 4 格内用拉杆点亮它。");
        }
    }
    private boolean recordingShelter(Player p) {
        var assessments = plugin.skillAssessments(); if (assessments == null) return false;
        // Agent A integration contract: boolean SkillAssessments.recordingShelter(Player p).
        // Optional linkage also keeps this class compilable against the frozen baseline API.
        try {
            var recording = assessments.getClass().getDeclaredMethod("recordingShelter", Player.class);
            return Boolean.TRUE.equals(recording.invoke(assessments, p));
        } catch (NoSuchMethodException baseline) {
            // Only the old baseline lacks the API. summary is read-only; never recurse into taskState.
            var exam = assessments.summary(p);
            return exam.has("examId") && exam.get("examId").getAsString().startsWith("shelter_")
                    && exam.has("state") && exam.get("state").getAsString().equals("active");
        } catch (ReflectiveOperationException unavailable) { return false; }
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void onHouseBreak(BlockBreakEvent event) {
        if (!HouseEvidence.broken(plugin, event.getBlock())) event.getPlayer().sendMessage(ChatColor.RED + "施工事实失效未保存，住房认证暂不可用。");
    }
    private StarterHouseValidator.Result refreshHouse(Player p) {
        var result = StarterHouseInspection.inspect(p, houseRecords(p));
        lastHomes.put(p.getUniqueId(), result);
        // Live inspection only. Claim commits the completion, not a delayed proof/progress cache.
        return result;
    }

    private boolean sameRun(Player player,String id,String runId,String lampKey) {
        Contract current=active(player);String path=base(player)+".active";
        return current!=null&&current.id().equals(id)
                &&plugin.getConfig().getString(path+".runId","").equals(runId)
                &&plugin.getConfig().getString(path+".lamp","").equals(lampKey);
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onLever(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getClickedBlock() == null
                || event.getClickedBlock().getType() != Material.LEVER) return;
        Player player = event.getPlayer();
        Contract current = active(player);
        if (current == null || !current.id().equals("tinkerer_light")) return;
        String lampKey = plugin.getConfig().getString(base(player) + ".active.lamp", "");
        if (lampKey.isEmpty()) return;
        String expectedRun=plugin.getConfig().getString(base(player)+".active.runId","");
        org.bukkit.Location lever = event.getClickedBlock().getLocation();
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!player.isOnline()||!sameRun(player,"tinkerer_light",expectedRun,lampKey)) return;
            for (int dx = -4; dx <= 4; dx++) for (int dy = -4; dy <= 4; dy++) for (int dz = -4; dz <= 4; dz++) {
                if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 4) continue;
                org.bukkit.block.Block block = lever.getBlock().getRelative(dx, dy, dz);
                if (block.getType() == Material.REDSTONE_LAMP && position(block.getLocation()).equals(lampKey)
                        && block.getBlockData() instanceof Lightable light && light.isLit()) {
                    advance(player, "tinkerer_light", null);
                    return;
                }
            }
        }, 2L);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBook(PlayerEditBookEvent event) {
        if (event.isSigning() && validBook(event.getNewBookMeta()))
            advance(event.getPlayer(), "author_story", null);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTrade(PlayerTradeEvent event) {
        if (!(event.getVillager() instanceof Villager villager) || !villager.isAdult()
                || villager.getProfession() == Villager.Profession.NONE
                || villager.getProfession() == Villager.Profession.NITWIT
                || event.getTrade().getResult().getType() != Material.EMERALD
                || event.getTrade().getIngredients().stream().noneMatch(item -> item.getType() != Material.EMERALD)) return;
        Player player = event.getPlayer();
        String profession = villager.getProfession().name().toLowerCase(Locale.ROOT);
        if (active(player) != null && active(player).id().equals("trader_supply")) {
            plugin.getConfig().set(base(player) + ".active.lastProfession", profession);
            advance(player, "trader_supply", "profession:" + profession);
        }
    }

    private boolean validBook(BookMeta meta) {
        if (meta.getTitle() == null || meta.getTitle().isBlank()) return false;
        String body = String.join("", meta.getPages()).replaceAll("\\s+", "");
        return body.codePointCount(0, body.length()) >= 40;
    }
    void written(Player player,String body){
        if(body.replaceAll("\\s+","").codePointCount(0,body.replaceAll("\\s+","").length())>=40)advance(player,"author_story",null);
    }

    /** Mineflayer fallback: creates the same real, signed vanilla book as the client editor. */
    private void write(Player player, String[] args) {
        String joined = args.length < 3 ? "" : String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length));
        int separator = joined.indexOf('|');
        if (separator < 1) {
            player.sendMessage(ChatColor.YELLOW + "用法：/mycli life write <书名>|<至少40字的正文>"); return;
        }
        String title = joined.substring(0, separator).trim();
        String body = joined.substring(separator + 1).trim();
        if (title.isBlank() || title.length() > 32 || body.length() > 256
                || body.replaceAll("\\s+", "").codePointCount(0, body.replaceAll("\\s+", "").length()) < 40) {
            player.sendMessage(ChatColor.RED + "书名需 1–32 字，正文需 40–256 字。"); return;
        }
        plugin.archives().legacyWrite(player,title,body);
    }

    void fillMenu(Player player, Inventory inventory) {
        Contract active = active(player);
        inventory.setItem(0, icon(Material.BOOK, "§6生活公会", active == null ? "当前无委托"
                : active.title() + " " + progress(player) + "/" + active.target()));
        for (int i = 0; i < CONTRACTS.size(); i++) {
            Contract contract = CONTRACTS.get(i);
            if (RetiredActivities.retired(contract.id())) continue;
            inventory.setItem(10 + i, icon(contract.icon(), "§e" + contract.guild(), contract.title(),
                    contract.description(), skillText(player, contract), "公会声望 +" + contract.reputation(),
                    completedToday(player, contract) ? "今日已完成" : "点击接单"));
        }
        inventory.setItem(18, icon(Material.EMERALD, "§a交付委托", "进度达成后点击领取"));
        inventory.setItem(19, icon(Material.BARRIER, "§c放弃委托", "进度清零"));
        inventory.setItem(21, icon(Material.WRITABLE_BOOK, "§d写一本书", "用原版书与笔写满 40 字后签署",
                "Agent 可用 /mycli life write <书名>|<正文>"));
        inventory.setItem(22, icon(Material.ARROW, "§7返回技能罗盘", "生活任务每天可各完成一次"));
        inventory.setItem(24, icon(Material.COMPASS, "§6生活公会地点", "§7列出四座建筑及专属导师的绝对坐标"));
    }

    void click(Player player, int slot) {
        if (slot >= 10 && slot < 10 + CONTRACTS.size()) accept(player, CONTRACTS.get(slot - 10).id());
        else if (slot == 0) status(player);
        else if (slot == 18) claim(player);
        else if (slot == 19) abandon(player);
        else if (slot == 21) player.sendMessage(ChatColor.YELLOW
                + "拿一本书与笔，在原版界面写至少 40 字并签署。Agent 可用 /mycli life write <书名>|<正文>。");
        else if (slot == 24) plugin.lifeBuildings().locations(player);
    }

    String bookPage(Player player) {
        StringBuilder page = new StringBuilder("§a生活公会§r\n\n");
        for (Contract guild : CONTRACTS) {
            page.append(guild.guild().replace("公会", "技艺")).append("：")
                    .append(skillText(player, guild)).append("\n");
        }
        Contract current = active(player);
        page.append("\n当前：").append(current == null ? "无" : current.title() + " "
                + progress(player) + "/" + current.target());
        page.append("\n罗盘向日葵打开看板。");
        return page.toString();
    }

    private ItemStack icon(Material type, String title, String... lore) {
        ItemStack item = new ItemStack(type);
        ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(title);
        meta.setLore(List.of(lore));
        item.setItemMeta(meta);
        return item;
    }

    private void receipt(Player player, String action, Contract contract, boolean success, String reason) {
        JsonObject json = new JsonObject();
        json.addProperty("schemaVersion", 1);
        json.addProperty("kind", action);
        json.addProperty("id", contract.id());
        json.addProperty("guild", contract.guild());
        json.addProperty("guildId", contract.guildId());
        json.addProperty("success", success);
        json.addProperty("reason", reason);
        json.addProperty("progress", progress(player));
        json.addProperty("target", contract.target());
        if (contract.id().equals("trader_supply"))
            json.addProperty("lastProfession", plugin.getConfig().getString(base(player) + ".active.lastProfession", ""));
        json.add("seenProfessions", seenProfessions(player));
        if(contract.id().equals("builder_home") && lastHomes.containsKey(player.getUniqueId()))json.add("house",StarterHouseInspection.json(lastHomes.get(player.getUniqueId())));
        if (action.equals("claim") && success) {
            json.addProperty("fameEarned", contract.reputation());
            json.addProperty("fame", plugin.guild().reputation(player));
            json.addProperty("emeralds", contract.emeralds());
            json.addProperty("gift", contract.gift().getKey().toString());
            json.addProperty("giftCount", contract.giftCount());
            json.addProperty("rewardLocation", "personal_trial_stash");
        }
        send(player, json);
    }

    void send(Player player, JsonObject json) {
        byte[] data = json.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length > 16_384) return;
        plugin.communication().privatePayload(player, CHANNEL, data);
    }
}
