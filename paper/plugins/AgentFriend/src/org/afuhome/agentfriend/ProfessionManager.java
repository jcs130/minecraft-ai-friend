package org.afuhome.agentfriend;

import com.google.gson.*;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.inventory.*;

/** Additive professions: existing abilities, clients and inventories keep their old behavior. */
final class ProfessionManager implements Listener {
    private final AgentFriendPlugin plugin;
    final ProfessionLedger ledger;
    private ProfessionCatalog catalog;
    private final ProfessionEffects effects;
    private final Map<Inventory, Menu> menus = new IdentityHashMap<>();
    private final Map<UUID, Map<String, Double>> metrics = new HashMap<>();
    private record Menu(UUID owner, String page, List<String> ids) { }

    ProfessionManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        for (String file : List.of("professions.yml", "skills.yml", "skill-unlocks.yml", "skill-points.yml"))
            if (!new java.io.File(plugin.getDataFolder(), file).exists()) plugin.saveResource(file, false);
        ledger = new ProfessionLedger(plugin.getDataFolder().toPath().resolve("profession-ledger.json"));
        if (!reload()) plugin.getLogger().severe("New profession abilities disabled; existing skills remain available.");
        if (!ledger.ready()) plugin.getLogger().severe("Profession ledger retained, writes disabled: " + ledger.error());
        initializeLegacy();
        effects = new ProfessionEffects(plugin, this);
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getPluginManager().registerEvents(effects, plugin);
        Bukkit.getScheduler().runTask(plugin, this::recover);
        Bukkit.getScheduler().runTaskTimer(plugin, this::flushMetrics, 100L, 100L);
    }
    Collection<ProfessionCatalog.Skill> skills() { return catalog == null ? List.of() : catalog.skills.values(); }
    List<String> ids() { return skills().stream().map(ProfessionCatalog.Skill::id).toList(); }
    List<String> roleIds() { return catalog == null ? List.of() : List.copyOf(catalog.roles.keySet()); }
    ProfessionCatalog.Skill skill(String id) { return catalog == null ? null : catalog.skills.get(normalize(id)); }
    String normalize(String id) {
        id = id == null ? "" : id.toLowerCase(Locale.ROOT).trim();
        if (id.startsWith("mycli:") || id.startsWith("cast.")) id = id.substring(id.indexOf(id.contains(":") ? ':' : '.') + 1);
        return id;
    }
    boolean reload() {
        try {
            ProfessionCatalog next = ProfessionCatalog.load(plugin.getDataFolder());
            if (ledger.ready()) for (var entry : ledger.data().getAsJsonObject("players").entrySet()) {
                JsonObject p = entry.getValue().getAsJsonObject();
                if (!next.skills.keySet().containsAll(p.getAsJsonObject("learned").keySet())) throw new IllegalArgumentException("cannot remove learned skill");
                Set<String> retained = new HashSet<>(p.getAsJsonObject("learned").keySet()); retained.addAll(p.getAsJsonObject("unlocked").keySet());
                if (!next.skills.keySet().containsAll(retained)) throw new IllegalArgumentException("cannot remove unlocked skill");
                if (p.getAsJsonObject("points").get("earned").getAsInt() > next.progression.cap) throw new IllegalArgumentException("cap below existing earned points");
                for (String id : p.getAsJsonObject("learned").keySet()) {
                    JsonObject r = p.getAsJsonObject("learned").getAsJsonObject(id);
                    if (r.has("level") && r.get("level").getAsInt() > next.progression.ranks.get(id).size()) throw new IllegalArgumentException("cannot remove learned rank");
                }
                for (var learned : p.getAsJsonObject("unlocked").entrySet()) {
                    JsonObject grant = learned.getValue().getAsJsonObject();
                    if (grant.has("identity") && !grant.get("identity").getAsString().equals(identity(next.skills.get(learned.getKey()))))
                        throw new IllegalArgumentException("cannot change learned skill identity " + learned.getKey());
                }
                if (!p.get("combat").getAsString().isEmpty() && !next.roles.containsKey(p.get("combat").getAsString())
                        || !next.roles.keySet().containsAll(ProfessionLedger.strings(p, "life"))) throw new IllegalArgumentException("cannot remove selected profession");
            }
            ConfigurationSection pending = plugin.getConfig().getConfigurationSection("profession-pending");
            if (ledger.ready()) for (var raid : ledger.data().getAsJsonObject("raids").entrySet())
                if (!next.skills.keySet().containsAll(ProfessionLedger.strings(raid.getValue().getAsJsonObject(), "rewards")))
                    throw new IllegalArgumentException("active raid skill reference");
            if (pending != null) for (String key : pending.getKeys(false))
                if (!next.skills.keySet().containsAll(pending.getStringList(key + ".skills"))) throw new IllegalArgumentException("pending skill reference");
            ConfigurationSection players = plugin.getConfig().getConfigurationSection("guild-players");
            if (players != null) for (String id : players.getKeys(false))
                if (!next.skills.keySet().containsAll(players.getStringList(id + ".active.market.skill-rewards")))
                    throw new IllegalArgumentException("accepted skill reference");
            catalog = next; return true;
        } catch (Exception error) {
            plugin.getLogger().warning("Profession reload rejected; last valid catalog retained: " + error.getMessage()); return false;
        }
    }
    private boolean available() { return catalog != null && ledger.ready(); }
    private void initializeLegacy() {
        if (!available() || ledger.data().has("legacyInitialized")) return;
        Set<UUID> old = new HashSet<>();
        for (OfflinePlayer p : Bukkit.getOfflinePlayers()) old.add(p.getUniqueId());
        for (Player p : Bukkit.getOnlinePlayers()) old.add(p.getUniqueId());
        if (!ledger.write(data -> {
            if (!data.has("legacyPlayers")) data.add("legacyPlayers", new JsonObject());
            old.forEach(id -> data.getAsJsonObject("legacyPlayers").addProperty(id.toString(), true));
            data.addProperty("legacyInitialized", System.currentTimeMillis());
        })) plugin.getLogger().severe("Legacy qualification snapshot failed; profession learning disabled until retry.");
    }
    boolean grandfathered(Player p) {
        return ledger.ready() && ledger.data().getAsJsonObject("legacyPlayers").has(p.getUniqueId().toString());
    }
    int level(Player p, String id) {
        if (SpellGuide.baseIds().contains(id)) {
            if (plugin.oldGoddessLearned(p, id)) return 1;
            if (!id.equals("feather") && !id.equals("night") && grandfathered(p)) return 1;
            return ledger.profile(p.getUniqueId()).getAsJsonObject("basicLearned").has(id) ? 1 : 0;
        }
        JsonObject record = ledger.profile(p.getUniqueId()).getAsJsonObject("learned").getAsJsonObject(id);
        return record == null ? 0 : record.has("level") ? record.get("level").getAsInt() : 1;
    }
    /** Every old native entry point uses this gate; legacy players retain their current qualification. */
    boolean basicAllowed(Player p, String id) {
        if (!SpellGuide.baseIds().contains(id) || !available()) return true;
        if (level(p, id) > 0) return true;
        result(p, "cast", "not_learned", id);
        p.sendMessage("§d基础技能人人可学：/mycli skills learn " + id + "；需要 " + nextCost(p,id) + " 技能点。");
        return false;
    }
    int maxLevel(String id) { return catalog == null || !catalog.progression.ranks.containsKey(id) ? 0 : catalog.progression.ranks.get(id).size(); }
    int nextCost(Player p, String id) {
        int level = level(p,id); return level >= maxLevel(id) ? 0 : catalog.progression.ranks.get(id).get(level).cost();
    }
    private boolean unlocked(Player p, String id) {
        return SpellGuide.baseIds().contains(id) || ledger.profile(p.getUniqueId()).getAsJsonObject("unlocked").has(id) || learned(p.getUniqueId(),id);
    }
    private boolean syncPoints(Player p) {
        if (!available() || !ledger.data().has("legacyInitialized")) return false;
        int levels = 0;
        var user = AuraSkillsApi.get().getUser(p.getUniqueId());
        if (user != null && user.isLoaded()) for (var skill : dev.aurelium.auraskills.api.skill.Skills.values())
            if (skill.isEnabled()) levels += Math.max(0, user.getSkillLevel(skill) - 1);
        JsonObject old = ledger.profile(p.getUniqueId()).getAsJsonObject("points");
        int high = Math.max(levels, old.get("levelHighWater").getAsInt());
        int earned = Math.max(old.get("earned").getAsInt(), Math.min(catalog.progression.cap,
                catalog.progression.initial + high / catalog.progression.levelsPerPoint));
        if (high == old.get("levelHighWater").getAsInt() && earned == old.get("earned").getAsInt()) return true;
        return ledger.write(data -> { var points = ProfessionLedger.profile(data,p.getUniqueId()).getAsJsonObject("points");
            points.addProperty("levelHighWater",high); points.addProperty("earned",earned); });
    }
    JsonObject pointState(Player p) {
        boolean synced = syncPoints(p); JsonObject result = ledger.profile(p.getUniqueId()).getAsJsonObject("points").deepCopy();
        result.addProperty("available", synced); result.addProperty("remaining", result.get("earned").getAsInt() - result.get("spent").getAsInt());
        result.addProperty("cap", catalog == null ? 0 : catalog.progression.cap);
        result.addProperty("initial", catalog == null ? 0 : catalog.progression.initial);
        result.addProperty("auraLevelsPerPoint", catalog == null ? 0 : catalog.progression.levelsPerPoint);
        result.addProperty("grandfathered", grandfathered(p));
        result.addProperty("respecMana",catalog==null?0:catalog.progression.respecMana);
        result.addProperty("respecCooldownMs",catalog==null?0:catalog.progression.respecSeconds*1000L);
        result.addProperty("respecRemainingMs",remaining(p,"respec")); return result;
    }
    String bookSummary(Player p) { JsonObject points=pointState(p); return "技能点 "+points.get("remaining").getAsInt()+" 可用 / 上限 "+points.get("cap").getAsInt(); }
    String pointSummary(Player p) {
        JsonObject points = pointState(p);
        return "技能点 " + points.get("remaining").getAsInt() + " 可用 / " + points.get("earned").getAsInt()
                + " 已获；已花 " + points.get("spent").getAsInt() + "，上限 " + points.get("cap").getAsInt();
    }
    ProfessionProgression.Rank rank(Player p, String id) {
        if (catalog == null || !catalog.progression.ranks.containsKey(id)) return null;
        return catalog.progression.ranks.get(id).get(Math.max(0, Math.min(maxLevel(id),level(p,id)) - 1));
    }
    private ProfessionCatalog.Skill effective(Player p, ProfessionCatalog.Skill skill) { return rank(p,skill.id()).effect(); }
    private String respec(Player p) {
        if (!available() || !syncPoints(p)) return "data_unavailable";
        if (p.getGameMode()!=GameMode.SURVIVAL || p.isDead()) return "survival_required";
        if (plugin.pvpParticipant(p) || plugin.dungeonParticipant(p)) return "activity_active";
        if (remaining(p,"respec")>0) return "cooldown";
        JsonObject old=ledger.profile(p.getUniqueId());
        if (old.getAsJsonObject("points").get("spent").getAsInt()==0) return "nothing_to_refund";
        int mana=catalog.progression.respecMana;
        if (!plugin.spendMana(p,mana)) return "insufficient_mana";
        Set<String> paidBasic=new HashSet<>(old.getAsJsonObject("basicLearned").keySet());
        if (!ledger.write(data -> {
            JsonObject profile=ProfessionLedger.profile(data,p.getUniqueId()); profile.getAsJsonObject("points").addProperty("spent",0);
            profile.add("learned",new JsonObject()); profile.add("basicLearned",new JsonObject()); profile.add("prepared",new JsonArray());
            profile.getAsJsonObject("cooldowns").addProperty("respec",System.currentTimeMillis()+catalog.progression.respecSeconds*1000L);
        })) {
            var user=AuraSkillsApi.get().getUser(p.getUniqueId());
            if (user!=null && user.isLoaded()) user.setMana(Math.min(user.getMaxMana(),user.getMana()+mana));
            return "data_unavailable";
        }
        paidBasic.stream().filter(id->id.equals("feather")||id.equals("night")).forEach(id->plugin.revokePaidBasic(p,id));
        effects.clear(p.getUniqueId());
        plugin.publishSkill(p,"respec","洗点完成，已退回技能点；消耗"+mana+"魔力",p.getLocation());
        p.sendTitle("§d洗点完成","§7技能点已退回，解锁资格保留",3,30,7);
        p.getWorld().spawnParticle(Particle.ENCHANT,p.getLocation().add(0,1,0),24,.4,.6,.4,.1);
        p.playSound(p.getLocation(),Sound.BLOCK_ENCHANTMENT_TABLE_USE,.7f,1f);
        notice(p,"MC_SKILL_POINTS",pointState(p)); return "success";
    }
    private void confirmRespec(Player p) {
        if (!available()) { result(p,"respec","data_unavailable",""); return; }
        Inventory inv=Bukkit.createInventory(null,27,"洗点 · 确认重新分配");
        inv.setItem(11,icon(Material.EXPERIENCE_BOTTLE,"确认洗点",pointSummary(p),"消耗"+catalog.progression.respecMana+"魔力，冷却"+catalog.progression.respecSeconds+"秒",
                "退回已花技能点，清除本次学习与准备", "保留旧资格、职业、任务解锁和传承归属", "已施放技能的冷却不清除"));
        inv.setItem(15,icon(Material.BARRIER,"取消")); menus.put(inv,new Menu(p.getUniqueId(),"respec",List.of())); p.openInventory(inv);
    }
    String purchase(Player p, String id, boolean upgrade) {
        if (!available() || !syncPoints(p)) return "data_unavailable";
        if (p.getGameMode() != GameMode.SURVIVAL || p.isDead() || plugin.pvpParticipant(p)) return "survival_required";
        if (maxLevel(id) == 0) return "unknown_skill";
        int current = level(p,id);
        if (!upgrade && current > 0) return "already_learned";
        if (upgrade && current == 0) return "not_learned";
        if (current >= maxLevel(id)) return "max_level";
        ProfessionCatalog.Skill skill = skill(id);
        if (skill != null && !selected(p.getUniqueId(),skill.role())) return "profession_required";
        if (!unlocked(p,id)) return "locked";
        if ((id.equals("feather") || id.equals("night")) && !plugin.canLearnGoddess(p)) return "prerequisite";
        int price = nextCost(p,id);
        JsonObject balance = ledger.profile(p.getUniqueId()).getAsJsonObject("points");
        if (balance.get("earned").getAsInt() - balance.get("spent").getAsInt() < price) return "insufficient_points";
        if (!ledger.write(data -> {
            JsonObject profile = ProfessionLedger.profile(data,p.getUniqueId()), points = profile.getAsJsonObject("points");
            points.addProperty("spent", points.get("spent").getAsInt() + price);
            JsonObject records = profile.getAsJsonObject(skill == null ? "basicLearned" : "learned");
            JsonObject record = records.has(id) ? records.getAsJsonObject(id) : skill == null ? new JsonObject() : profile.getAsJsonObject("unlocked").getAsJsonObject(id).deepCopy();
            record.addProperty("source", record.has("source") ? record.get("source").getAsString() : "skill_points");
            record.addProperty("level", current+1); record.addProperty("pointsSpent", (record.has("pointsSpent") ? record.get("pointsSpent").getAsInt() : 0) + price);
            record.addProperty("at",System.currentTimeMillis()); if (skill != null) record.addProperty("identity",identity(skill)); records.add(id,record); autoPrepare(profile);
        })) return "data_unavailable";
        if (id.equals("feather") || id.equals("night")) plugin.finishGoddessLearning(p,id);
        effects.clear(p.getUniqueId());
        p.sendMessage("§a" + SpellGuide.find(id).name() + " " + (current+1) + "/" + maxLevel(id) + "；花费 " + price + " 技能点。");
        notice(p,"MC_SKILL_POINTS",pointState(p)); return "success";
    }
    private void addLearningState(Player p, String id, JsonObject item) {
        item.addProperty("unlocked",unlocked(p,id)); item.addProperty("level",level(p,id)); item.addProperty("maxLevel",maxLevel(id));
        item.addProperty("nextPointCost",nextCost(p,id)); item.addProperty("learningCondition",learningReason(p,id));
        JsonArray levels = new JsonArray();
        if (catalog != null) for (var r : catalog.progression.ranks.get(id)) {
            JsonObject value = new JsonObject(); value.addProperty("level",levels.size()+1); value.addProperty("pointCost",r.cost());
            if (r.effect()!=null) { var effect=r.effect(); value.addProperty("mana",effect.mana()); value.addProperty("power",effect.power());
                value.addProperty("range",effect.range()); value.addProperty("targets",effect.targets()); value.addProperty("durationMs",effect.ticks()*50);
                value.addProperty("wardMs",r.wardTicks()*50); value.addProperty("wardCap",r.wardCap()); value.addProperty("immunityMs",r.immuneTicks()*50); }
            levels.add(value);
        }
        item.add("levels",levels);
        if (skill(id) != null && level(p,id)>0) { var r=rank(p,id); item.addProperty("mana",r.effect().mana());
            item.addProperty("power",r.effect().power()); item.addProperty("targets",r.effect().targets()); item.addProperty("range",r.effect().range());
            item.addProperty("wardMs",r.wardTicks()*50); item.addProperty("immunityMs",r.immuneTicks()*50); }
    }
    private String learningReason(Player p, String id) {
        if (level(p,id)>=maxLevel(id)) return "已学满";
        if (!unlocked(p,id)) return "未解锁：" + (skill(id)==null ? "基础技艺" : skill(id).origin());
        if (skill(id)!=null && !selected(p.getUniqueId(),skill(id).role())) return "需选择 " + catalog.roles.get(skill(id).role()).title();
        if (id.equals("feather") || id.equals("night")) return "基础技艺；仍需原版经验5级或炼金2级";
        return "已具学习资格；下级需要 " + nextCost(p,id) + " 技能点";
    }
    private List<String> learningIds() {
        List<String> ids = new ArrayList<>(new TreeSet<>(SpellGuide.baseIds())); ids.addAll(ids()); return ids;
    }
    List<String> bookPages(Player p) {
        JsonObject points = pointState(p); String role = ledger.profile(p.getUniqueId()).get("combat").getAsString();
        String title = catalog != null && catalog.roles.containsKey(role) ? catalog.roles.get(role).title() : "尚未选择";
        List<String> pages = new ArrayList<>();
        pages.add("§d命格 · 技能点§r\n\n职业：" + title + "\n" + pointSummary(p) + "\n\n初始" + points.get("initial").getAsInt()
                + "点；AuraSkills累计成长每" + points.get("auraLevelsPerPoint").getAsInt() + "级增加1点。\n三方向共用余额，切换职业不退点。\n洗点退回已花点数，需"+points.get("respecMana").getAsInt()+"魔力；冷却"+points.get("respecCooldownMs").getAsLong()/1000+"秒，剩余"+(points.get("respecRemainingMs").getAsLong()+999)/1000+"秒。\n\n罗盘→职业与传承→技能学习与升级");
        List<String> lines = new ArrayList<>();
        for (String id : learningIds()) {
            var s=skill(id); if (s!=null && !selected(p.getUniqueId(),s.role()) && !learned(p.getUniqueId(),id) && !unlocked(p,id)) continue;
            String effect="";
            if (s!=null && level(p,id)>0) { var r=rank(p,id); effect="\n魔力"+r.effect().mana()+" · 强度"+r.effect().power()+" · 目标"+r.effect().targets();
                if (r.wardTicks()>0) effect+="\n减伤"+r.wardTicks()/20+"秒（一次）";
                if (r.immuneTicks()>0) effect+=" · 护佑"+r.immuneTicks()/20.0+"秒"; }
            lines.add(SpellGuide.find(id).name() + " " + level(p,id) + "/" + maxLevel(id) + "\n" + (level(p,id)>=maxLevel(id) ? "已学满" : "下级 " + nextCost(p,id) + "点；" + (unlocked(p,id) ? "已解锁" : "需任务/事件"))+effect);
            if (lines.size()==4) { pages.add("§d技艺与升级§r\n\n"+String.join("\n\n",lines)); lines.clear(); }
        }
        if (!lines.isEmpty()) pages.add("§d技艺与升级§r\n\n"+String.join("\n\n",lines));
        if (catalog!=null) for (var skill : skills()) if (selected(p.getUniqueId(),skill.role()) && !unlocked(p,skill.id()))
            pages.add("§d未解锁的技艺§r\n\n"+skill.title()+"\n"+skill.id()+"\n\n"+skill.origin()+"\n解锁后仍需"+nextCost(p,skill.id())+"点学习。");
        pages.add("§d进阶与传承§r\n\n任务和袭击提供学习资格，学习和升级另耗技能点。\n\n高阶圣愈逐级增加治疗量和友军人数；高等级附短时怪物攻击减伤和护佑。\n\n完整条件与各级效果：技能学习菜单右键图标。\n旧基础技艺资格与熟练度保留。");
        List<String> readable = new ArrayList<>();
        for (String page : pages) {
            List<String> linesOnPage = new ArrayList<>(); StringBuilder line = new StringBuilder(); int width=0;
            for (int i=0;i<page.length();i++) {
                char ch=page.charAt(i);
                if (ch=='§' && i+1<page.length()) { line.append(ch).append(page.charAt(++i)); continue; }
                int size=ch>255 ? 2 : 1;
                if (ch=='\n' || width+size>24) {
                    linesOnPage.add(line.toString()); line.setLength(0); width=0;
                    if (linesOnPage.size()==13) { readable.add(String.join("\n",linesOnPage)); linesOnPage.clear(); }
                    if (ch=='\n') continue;
                }
                line.append(ch); width+=size;
            }
            if (!line.isEmpty()) linesOnPage.add(line.toString());
            if (!linesOnPage.isEmpty()) readable.add(String.join("\n",linesOnPage));
        }
        return readable;
    }
    boolean selected(UUID player, String role) {
        JsonObject p = ledger.profile(player);
        return p.get("combat").getAsString().equals(role) || ProfessionLedger.strings(p, "life").contains(role);
    }
    boolean learned(UUID player, String id) { return available() && ledger.profile(player).getAsJsonObject("learned").has(id); }
    boolean learnedEffect(UUID player, String effect) {
        return skills().stream().anyMatch(skill -> skill.effect().equals(effect) && selected(player, skill.role()) && learned(player, skill.id()));
    }
    long remaining(Player p, String id) {
        JsonElement until = ledger.profile(p.getUniqueId()).getAsJsonObject("cooldowns").get(id);
        return until == null ? 0 : Math.max(0, until.getAsLong() - System.currentTimeMillis());
    }
    String denial(Player p, ProfessionCatalog.Skill skill, boolean runtime) {
        if (!available()) return "data_unavailable";
        if (p.getGameMode() != GameMode.SURVIVAL || p.isDead()) return "survival_required";
        if (plugin.pvpParticipant(p)) return "pvp_active";
        if (!selected(p.getUniqueId(), skill.role())) return "profession_required";
        if (!learned(p.getUniqueId(), skill.id())) return "not_learned";
        if (!ProfessionLedger.strings(ledger.profile(p.getUniqueId()), "prepared").contains(skill.id())) return "not_prepared";
        if (!runtime) return "ready";
        if (!equipment(p, skill.equipment())) return "equipment_required";
        if (remaining(p, skill.id()) > 0) return "cooldown";
        return "ready";
    }
    static boolean equipment(Player p, String requirement) {
        Material main = p.getInventory().getItemInMainHand().getType(), off = p.getInventory().getItemInOffHand().getType();
        return switch (requirement) {
            case "sword" -> main.name().endsWith("_SWORD");
            case "two_swords" -> main.name().endsWith("_SWORD") && off.name().endsWith("_SWORD");
            case "shield" -> main == Material.SHIELD || off == Material.SHIELD;
            case "bow" -> main == Material.BOW || main == Material.CROSSBOW;
            case "pickaxe" -> main.name().endsWith("_PICKAXE");
            case "axe" -> main.name().endsWith("_AXE");
            case "hoe" -> main.name().endsWith("_HOE");
            default -> true;
        };
    }
    void cast(Player p, String raw) {
        String[] parts = raw.trim().split("\\s+", 2); ProfessionCatalog.Skill skill = skill(parts[0]);
        if (skill == null) { result(p, "cast", "unknown_skill", parts[0]); return; }
        String reason = denial(p, skill, true);
        if (!reason.equals("ready")) { result(p, "cast", reason, skill.id()); return; }
        effects.cast(p, effective(p, skill), parts.length == 2 ? parts[1] : "");
    }
    /** Reserve cooldown durably before any effect. Every execution path calls this method once. */
    boolean begin(Player p, ProfessionCatalog.Skill skill) {
        String reason = denial(p, skill, true);
        if (!reason.equals("ready")) { result(p, "cast", reason, skill.id()); return false; }
        if (!plugin.hasMana(p, skill.mana())) { result(p, "cast", "insufficient_mana", skill.id()); return false; }
        if (!ledger.write(data -> ProfessionLedger.profile(data, p.getUniqueId()).getAsJsonObject("cooldowns")
                .addProperty(skill.id(), System.currentTimeMillis() + skill.cooldown()))) {
            result(p, "cast", "data_unavailable", skill.id()); return false;
        }
        if (!plugin.spendMana(p, skill.mana())) { clearCooldown(p, skill); return false; }
        return true;
    }
    private void clearCooldown(Player p, ProfessionCatalog.Skill skill) {
        ledger.write(data -> ProfessionLedger.profile(data, p.getUniqueId()).getAsJsonObject("cooldowns").remove(skill.id()));
    }
    void refund(Player p, ProfessionCatalog.Skill skill, String reason) {
        var user = AuraSkillsApi.get().getUser(p.getUniqueId());
        if (user != null && user.isLoaded()) user.setMana(Math.min(user.getMaxMana(), user.getMana() + skill.mana()));
        clearCooldown(p, skill); result(p, "cast", reason, skill.id());
    }
    void succeeded(Player p, ProfessionCatalog.Skill skill, String body) {
        metric(p, "casts", 1);
        plugin.publishSkill(p, skill.id(), body, p.getLocation());
        p.sendTitle("§b" + skill.title(), "§7✦ " + skill.mana() + " 魔力 ✦", 3, 24, 7);
        p.getWorld().spawnParticle(Particle.END_ROD, p.getLocation().add(0, 1, 0), 12, .35, .5, .35, .01);
        p.playSound(p.getLocation(), Sound.BLOCK_AMETHYST_BLOCK_CHIME, .6f, 1.1f);
        result(p, "cast", "success", skill.id()); p.sendMessage("§b" + skill.title() + "：" + body);
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void directCast(PlayerCommandPreprocessEvent event) {
        String[] parts = event.getMessage().substring(1).trim().split("\\s+", 2);
        String root = parts[0].toLowerCase(Locale.ROOT); root = root.substring(root.lastIndexOf(':') + 1);
        if (!Set.of("cast", "c").contains(root) || parts.length < 2 || skill(parts[1].split("\\s+", 2)[0]) == null) return;
        event.setCancelled(true); cast(event.getPlayer(), parts[1]);
    }
    List<String> rewards(String source, String id) { return catalog == null ? List.of() : catalog.rewards(source, id); }
    void validateTask(ConfigurationSection row) {
        String role = row.getString("profession", "");
        if (!role.isEmpty() && (catalog == null || !catalog.roles.containsKey(role))) throw new IllegalArgumentException("task profession");
        if (catalog == null && !row.getStringList("requires-skills").isEmpty()
                || catalog != null && !catalog.skills.keySet().containsAll(row.getStringList("requires-skills")))
            throw new IllegalArgumentException("task requires-skills");
    }
    String taskDenial(Player p, String definition) {
        try {
            YamlConfiguration yaml = new YamlConfiguration(); yaml.loadFromString(definition);
            String role = yaml.getString("task.profession", "");
            if (!role.isEmpty() && !selected(p.getUniqueId(), role)) return "profession_required:" + role;
            for (String id : yaml.getStringList("task.requires-skills")) if (!learned(p.getUniqueId(), id)) return "skill_required:" + id;
            return "available";
        } catch (Exception error) { return "data_unavailable"; }
    }
    /** Called inside the guild's completion transaction, before the shared config is saved. */
    void queue(UUID player, String source, String run, List<String> skills) {
        if (skills.isEmpty()) return;
        String key = receipt(player + ":" + source + ":" + run), path = "profession-pending." + key;
        if (plugin.getConfig().contains(path)) return;
        plugin.getConfig().set(path + ".player", player.toString()); plugin.getConfig().set(path + ".source", source);
        plugin.getConfig().set(path + ".run", run); plugin.getConfig().set(path + ".skills", skills);
        plugin.getConfig().set(path + ".state", "pending"); plugin.getConfig().set(path + ".created-at", System.currentTimeMillis());
    }
    static String receipt(String input) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
    void recover() {
        if (!available()) return;
        ConfigurationSection pending = plugin.getConfig().getConfigurationSection("profession-pending");
        if (pending == null) return;
        boolean changed = false;
        for (String key : pending.getKeys(false)) {
            if (!pending.getString(key + ".state", "").equals("pending")) continue;
            try {
                UUID id = UUID.fromString(pending.getString(key + ".player", "")); List<String> grants = pending.getStringList(key + ".skills");
                if (!catalog.skills.keySet().containsAll(grants)) continue;
                List<String> added = new ArrayList<>(), limited = new ArrayList<>();
                String source = pending.getString(key + ".source", "unknown");
                if (!ledger.write(data -> {
                    JsonObject p = ProfessionLedger.profile(data, id), learned = p.getAsJsonObject("unlocked"), owners = data.getAsJsonObject("uniqueOwners");
                    for (String skillId : grants) {
                        ProfessionCatalog.Skill skill = skill(skillId);
                        if (learned.has(skillId)) continue;
                        if (skill.worldLimit() == 1 && owners.has(skillId) && !owners.get(skillId).getAsString().equals(id.toString())) { limited.add(skillId); continue; }
                        if (skill.worldLimit() == 1) owners.addProperty(skillId, id.toString());
                        JsonObject record = new JsonObject(); record.addProperty("source", source); record.addProperty("receipt", key);
                        record.addProperty("identity", identity(skill));
                        record.addProperty("at", System.currentTimeMillis()); learned.add(skillId, record); added.add(skillId);
                    }
                    autoPrepare(p);
                })) continue;
                pending.set(key + ".state", "applied"); pending.set(key + ".applied-at", System.currentTimeMillis());
                pending.set(key + ".limited", limited); changed = true;
                Player online = Bukkit.getPlayer(id);
                if (online != null) {
                    for (String skillId : added) { JsonObject event = new JsonObject(); event.addProperty("skill", skillId);
                        event.addProperty("title", skill(skillId).title()); event.addProperty("source", source); event.addProperty("receipt", key);
                        notice(online, "MC_SKILL_UNLOCK", event); online.sendMessage("§d解锁了「" + skill(skillId).title() + "」的学习资格；/mycli skills learn " + skillId + "；" + skill(skillId).origin()); }
                    if (!limited.isEmpty()) online.sendMessage("§e传承名额已由其他冒险者获得：" + String.join(",", limited) + "。委托奖励正常结算。");
                }
            } catch (RuntimeException bad) { plugin.getLogger().warning("Pending skill receipt retained: " + key); }
        }
        if (changed) plugin.saveConfig();
    }
    private void autoPrepare(JsonObject p) {
        List<String> prepared = new ArrayList<>(ProfessionLedger.strings(p, "prepared"));
        for (String id : p.getAsJsonObject("learned").keySet()) {
            ProfessionCatalog.Skill skill = skill(id); if (skill == null || prepared.contains(id)) continue;
            if (!p.get("combat").getAsString().equals(skill.role()) && !ProfessionLedger.strings(p, "life").contains(skill.role())) continue;
            long occupied = prepared.stream().map(this::skill).filter(Objects::nonNull).filter(s -> s.legacy() == skill.legacy()).count();
            if (occupied < (skill.legacy() ? 1 : 4)) prepared.add(id);
        }
        ProfessionLedger.strings(p, "prepared", prepared);
    }
    String choose(UUID id, String roleId) {
        if (!available()) return "data_unavailable";
        ProfessionCatalog.Role role = catalog.roles.get(roleId);
        if (role == null) return "unknown_profession";
        JsonObject before = ledger.profile(id);
        if (!role.combat() && !selected(id, roleId) && ProfessionLedger.strings(before, "life").size() >= 2) return "life_limit";
        if (!ledger.write(data -> {
            JsonObject p = ProfessionLedger.profile(data, id);
            if (role.combat()) p.addProperty("combat", roleId);
            else { List<String> life = new ArrayList<>(ProfessionLedger.strings(p, "life")); if (!life.contains(roleId)) life.add(roleId); ProfessionLedger.strings(p, "life", life); }
            List<String> prepared = new ArrayList<>(ProfessionLedger.strings(p, "prepared"));
            prepared.removeIf(skillId -> { ProfessionCatalog.Skill skill = skill(skillId);
                return skill != null && !p.get("combat").getAsString().equals(skill.role()) && !ProfessionLedger.strings(p, "life").contains(skill.role()); });
            ProfessionLedger.strings(p, "prepared", prepared);
            for (String skillId : role.starters()) if (!p.getAsJsonObject("unlocked").has(skillId)) {
                JsonObject grant = new JsonObject(); grant.addProperty("source", "profession:" + roleId); grant.addProperty("at", System.currentTimeMillis());
                grant.addProperty("identity", identity(skill(skillId)));
                p.getAsJsonObject("unlocked").add(skillId, grant);
            }
            autoPrepare(p);
        })) return "data_unavailable";
        return "success";
    }
    private static String identity(ProfessionCatalog.Skill skill) { return skill.role() + ":" + skill.effect() + ":" + skill.legacy() + ":" + skill.worldLimit(); }
    void observedHealing(Player caster, Player target, double amount) { effects.recordHealing(caster, target, amount); }
    void metric(Player player, String key, double amount) {
        if (amount > 0 && Double.isFinite(amount)) metrics.computeIfAbsent(player.getUniqueId(), ignored -> new HashMap<>()).merge(key, amount, Double::sum);
    }
    void flushMetrics() {
        if (!available() || metrics.isEmpty() && (effects == null || !effects.dirty())) return;
        if (ledger.write(data -> { metrics.forEach((id, values) -> {
            JsonObject counts = ProfessionLedger.profile(data, id).getAsJsonObject("metrics");
            values.forEach((key, value) -> counts.addProperty(key, (counts.has(key) ? counts.get(key).getAsDouble() : 0) + value));
        }); if (effects != null) effects.save(data); })) { metrics.clear(); if (effects != null) effects.saved(); }
    }
    JsonObject state(Player player) {
        JsonObject p = ledger.profile(player.getUniqueId()), state = new JsonObject();
        state.addProperty("schemaVersion", 1); state.addProperty("available", available()); state.add("points", pointState(player));
        state.add("combat", p.get("combat")); state.add("life", p.getAsJsonArray("life").deepCopy()); state.add("prepared", p.getAsJsonArray("prepared").deepCopy());
        return state;
    }
    void result(Player p, String action, String reason, String id) {
        JsonObject data = new JsonObject(); data.addProperty("action", action); data.addProperty("reason", reason);
        data.addProperty("skill", id); data.addProperty("success", reason.equals("success"));
        if (action.equals("cast")) data.addProperty("cooldownRemainingMs", remaining(p, id));
        notice(p, "MC_PROFESSION_RESULT", data);
        if (!reason.equals("success")) p.sendMessage("§e" + switch (reason) {
            case "insufficient_points" -> "技能点不足；命格书可查看余额和成长方式。";
            case "nothing_to_refund" -> "没有已花的技能点；未消耗魔力。";
            case "activity_active" -> "试炼/PvP中不能洗点，请先退出活动。";
            case "prerequisite" -> "羽落/夜视仍需原版经验5级或炼金2级；条件不足未扣技能点。";
            case "locked" -> "尚未取得学习资格；查看技能图鉴中的任务或事件条件。";
            case "already_learned" -> "已经学会；升级用 /mycli skills upgrade " + id;
            case "max_level" -> "已达到最高技能等级；基础技能的原熟练度照常成长。";
            case "profession_required" -> "需要先选择对应职业。";
            case "not_learned" -> "尚未学会；职业菜单和图鉴可查看获取途径。";
            case "not_prepared" -> "技能未准备；/mycli skills prepare " + id;
            case "equipment_required" -> "当前手持装备不符合技能要求。";
            case "cooldown" -> "技能冷却还需 " + ((remaining(p, id) + 999) / 1000) + " 秒。";
            case "survival_required" -> "新职业技能需要生存模式；观察者不能施放。";
            case "data_unavailable" -> "职业账本暂不可用；没有执行技能，请联系服主。";
            case "no_target", "protected_target" -> "没有有效目标，或目标受到保护；未消耗魔力。";
            case "unsafe_path" -> "前方路径或落点不安全；未消耗魔力。";
            case "prepared_limit" -> "最多准备 4 项新主动技能和 1 项传承；先 unprepare 一项。";
            case "life_limit" -> "最多选择两个生活职业；先 leave 一项。";
            case "already_effective" -> "现有状态已足够，无需重复施放；未消耗魔力。";
            default -> "操作未执行：" + reason + "。";
        });
    }
    private void notice(Player p, String type, JsonObject data) {
        data.addProperty("schemaVersion", 1); data.addProperty("scope", "self");
        String message = type + " " + data; p.sendMessage(message);
        // CortiEyeMirror forwards this private system chat to the registered attached observer.
    }
    void command(Player p, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "status";
        if (action.equals("menu")) { open(p, args[0].equalsIgnoreCase("skills") ? "skills" : "roles"); return; }
        if (action.equals("mine")) { reportSkills(p); return; }
        if (action.equals("points")) { notice(p, "MC_SKILL_POINTS", pointState(p)); p.sendMessage("§d" + pointSummary(p)); return; }
        if (action.equals("learn") || action.equals("upgrade")) {
            String id = args.length == 3 ? normalize(args[2]) : "";
            result(p, action, purchase(p, id, action.equals("upgrade")), id); return;
        }
        if (action.equals("learnmenu")) { open(p, "learn"); return; }
        if (action.equals("respec")) {
            if (args.length==3 && args[2].equalsIgnoreCase("confirm")) result(p,"respec",respec(p),"respec");
            else confirmRespec(p); return;
        }
        if (action.equals("info") && args.length == 3 && maxLevel(normalize(args[2])) > 0) { learningDetail(p,normalize(args[2])); return; }
        if (action.equals("status") || action.equals("list")) {
            notice(p, "MC_PROFESSION", state(p));
            JsonObject profile = ledger.profile(p.getUniqueId()); String combat = profile.get("combat").getAsString();
            String title = catalog != null && catalog.roles.containsKey(combat) ? catalog.roles.get(combat).title() : "尚未选择";
            List<String> life = ProfessionLedger.strings(profile, "life");
            p.sendMessage("§6职业：" + title + (life.isEmpty() ? "" : "；生活：" + String.join(",", life)));
            p.sendMessage("§7/mycli profession choose <ID>；skills mine|prepare|unprepare <ID>；旧技能照常使用。");
            if (catalog != null) for (ProfessionCatalog.Role role : catalog.roles.values()) p.sendMessage("§b" + role.id() + " " + role.title() + (role.combat() ? " · 主战职业" : " · 生活职业"));
            return;
        }
        if (p.getGameMode() != GameMode.SURVIVAL || p.isDead() || plugin.pvpParticipant(p)) { result(p, action, "survival_required", ""); return; }
        if (args.length != 3 || !available()) { result(p, action, available() ? "invalid_arguments" : "data_unavailable", ""); return; }
        String id = normalize(args[2]);
        if (action.equals("choose")) { String reason = choose(p.getUniqueId(), id); if (reason.equals("success")) effects.clear(p.getUniqueId()); result(p, action, reason, id); return; }
        if (action.equals("leave")) {
            if (!catalog.roles.containsKey(id)) { result(p, action, "unknown_profession", id); return; }
            boolean saved = ledger.write(data -> { JsonObject profile = ProfessionLedger.profile(data, p.getUniqueId());
                if (profile.get("combat").getAsString().equals(id)) profile.addProperty("combat", "");
                List<String> life = new ArrayList<>(ProfessionLedger.strings(profile, "life")); life.remove(id); ProfessionLedger.strings(profile, "life", life);
                List<String> prepared = new ArrayList<>(ProfessionLedger.strings(profile, "prepared")); prepared.removeIf(skillId -> skill(skillId).role().equals(id));
                ProfessionLedger.strings(profile, "prepared", prepared); });
            effects.clear(p.getUniqueId()); result(p, action, saved ? "success" : "data_unavailable", id); return;
        }
        ProfessionCatalog.Skill skill = skill(id);
        if (skill == null || !Set.of("prepare", "unprepare").contains(action)) { result(p, action, "unknown_skill", id); return; }
        if (!learned(p.getUniqueId(), id)) { result(p, action, "not_learned", id); return; }
        if (!selected(p.getUniqueId(), skill.role())) { result(p, action, "profession_required", id); return; }
        List<String> prepared = new ArrayList<>(ProfessionLedger.strings(ledger.profile(p.getUniqueId()), "prepared"));
        if (action.equals("unprepare")) prepared.remove(id);
        else if (!prepared.contains(id)) {
            if (prepared.stream().map(this::skill).filter(s -> s.legacy() == skill.legacy()).count() >= (skill.legacy() ? 1 : 4)) { result(p, action, "prepared_limit", id); return; }
            prepared.add(id);
        }
        boolean saved = ledger.write(data -> ProfessionLedger.strings(ProfessionLedger.profile(data, p.getUniqueId()), "prepared", prepared));
        if (saved && action.equals("unprepare")) effects.clear(p.getUniqueId());
        result(p, action, saved ? "success" : "data_unavailable", id);
    }
    void reportSkills(Player p) {
        JsonObject profile = ledger.profile(p.getUniqueId());
        for (ProfessionCatalog.Skill skill : skills()) {
            JsonObject item = skill.guide().json(); item.addProperty("profession", skill.role()); item.addProperty("legacy", skill.legacy());
            item.addProperty("learned", learned(p.getUniqueId(), skill.id())); item.addProperty("prepared", ProfessionLedger.strings(profile, "prepared").contains(skill.id()));
            item.addProperty("reason", denial(p, skill, true)); item.addProperty("cooldownRemainingMs", remaining(p, skill.id()));
            item.addProperty("equipment", skill.equipment()); item.addProperty("worldLimit", skill.worldLimit());
            if (profile.getAsJsonObject("learned").has(skill.id())) item.add("grant", profile.getAsJsonObject("learned").get(skill.id()).deepCopy());
            addLearningState(p, skill.id(), item); notice(p, "MC_SKILL", item);
        }
        for (String id : new TreeSet<>(SpellGuide.baseIds())) {
            JsonObject item = SpellGuide.find(id).json(); item.addProperty("profession", "common"); addLearningState(p, id, item); notice(p, "MC_SKILL", item);
        }
        notice(p, "MC_SKILL_POINTS", pointState(p));
        flushMetrics(); notice(p, "MC_SKILL_ASSESSMENT", ledger.profile(p.getUniqueId()).getAsJsonObject("metrics").deepCopy());
    }
    private void learningDetail(Player p, String id) {
        SpellGuide.detail(p,id); JsonObject item=SpellGuide.find(id).json(); addLearningState(p,id,item); notice(p,"MC_SKILL",item);
        p.sendMessage("§d"+learningReason(p,id));
        int i=0;
        for (var rank : catalog.progression.ranks.get(id)) {
            String effect = rank.effect()==null ? "基础资格，原熟练度照常成长" : "魔力"+rank.effect().mana()+"，强度"+rank.effect().power()+"，目标"+rank.effect().targets();
            if (rank.wardTicks()>0) effect += "；一次怪物减伤50%/最多"+rank.wardCap()+"，持续"+rank.wardTicks()/20+"秒";
            if (rank.immuneTicks()>0) effect += "；怪物攻击护佑"+rank.immuneTicks()/20.0+"秒";
            p.sendMessage("§7等级"+(++i)+"："+rank.cost()+"点；"+effect);
        }
    }
    void admin(CommandSender sender, String[] args) {
        String action = args.length > 2 ? args[2] : "audit";
        if (action.equals("reload")) { sender.sendMessage(reload() ? "职业技能已热加载；原学习与冷却保留。" : "配置校验失败，保留上一有效目录。"); return; }
        if (action.equals("recover")) { recover(); sender.sendMessage("已重试 pending 技能收据。"); return; }
        if (action.equals("assign") && args.length == 5) try {
            UUID id = UUID.fromString(args[3]); sender.sendMessage("profession assign " + id + " " + choose(id, args[4]));
            plugin.getLogger().info("Console profession assignment: " + id + " " + args[4]); return;
        } catch (IllegalArgumentException invalid) { sender.sendMessage("必须使用玩家 UUID。不能使用名字作为授权。"); return; }
        if (action.equals("audit")) {
            JsonObject data = new JsonObject(); data.addProperty("ready", available()); data.addProperty("error", ledger.error());
            data.addProperty("skills", skills().size()); data.addProperty("professions", catalog == null ? 0 : catalog.roles.size());
            data.addProperty("players", ledger.ready() ? ledger.data().getAsJsonObject("players").size() : 0); sender.sendMessage(data.toString()); return;
        }
        sender.sendMessage("mycli admin professions audit|reload|recover|assign <UUID> <职业ID>");
    }
    void open(Player p, String page) {
        if (!available()) { result(p, "menu", "data_unavailable", ""); return; }
        Inventory inv = Bukkit.createInventory(null, 54, page.equals("roles") ? "职业与传承" : page.equals("learn") ? "技能学习与升级" : "我的职业技能");
        List<String> ids = page.equals("roles") ? List.copyOf(catalog.roles.keySet()) : page.equals("learn") ? learningIds() : ids();
        for (int i = 0; i < ids.size(); i++) {
            String id = ids.get(i);
            if (page.equals("roles")) { var role = catalog.roles.get(id); inv.setItem(i, icon(role.icon(), "§b" + role.title(),
                    role.combat() ? "主战职业只能选一个" : "生活职业最多选两个", selected(p.getUniqueId(), id) ? "已选择；右键离开" : "左键选择后用技能点学习", "ID：" + id)); }
            else if (page.equals("learn")) { var entry = SpellGuide.find(id); inv.setItem(i, icon(entry.icon(), "§d" + entry.name(),
                    "已学 " + level(p, id) + "/" + maxLevel(id) + "；下级需 " + nextCost(p, id) + " 技能点", learningReason(p,id), entry.tip(),
                    "左键学习/升级；右键查看详情", "ID：" + id)); }
            else { var skill = effective(p,skill(id)); inv.setItem(i, icon(skill.icon(), "§d" + skill.title()+" "+level(p,id)+"/"+maxLevel(id), skill.description(),
                    skill.mana() + " 魔力 / " + skill.cooldown() / 1000 + " 秒；" + denial(p, skill, true), skill.origin(),
                    "左键准备/取消准备；右键施放", "ID：" + id)); }
        }
        inv.setItem(45, icon(Material.NAME_TAG, "职业选择")); inv.setItem(46, icon(Material.ENCHANTED_BOOK, "我的职业技能"));
        inv.setItem(47, icon(Material.EXPERIENCE_BOTTLE, "技能学习与升级", pointSummary(p), "基础技能人人可学；职业试炼提供进阶资格"));
        inv.setItem(48, icon(Material.GRINDSTONE,"洗点", "退回已花技能点；保留解锁资格", "消耗"+catalog.progression.respecMana+"魔力；冷却"+catalog.progression.respecSeconds+"秒"));
        inv.setItem(49, icon(Material.COMPASS, "返回技能罗盘")); inv.setItem(50, icon(Material.LECTERN, "成长委托", "查看任务市场，接取专精试炼"));
        menus.put(inv, new Menu(p.getUniqueId(), page, ids)); p.openInventory(inv);
    }
    private ItemStack icon(Material material, String title, String... lore) {
        ItemStack item = new ItemStack(material); var meta = item.getItemMeta(); meta.setDisplayName(title);
        meta.setLore(List.of(SpellGuide.menuLines(lore))); item.setItemMeta(meta); return item;
    }
    @EventHandler public void click(InventoryClickEvent event) {
        Menu menu = menus.get(event.getView().getTopInventory()); if (menu == null) return;
        event.setCancelled(true); if (!(event.getWhoClicked() instanceof Player p) || !p.getUniqueId().equals(menu.owner) || event.getClick().isShiftClick()) return;
        int slot = event.getRawSlot(); if (slot < 0 || slot >= 54) return;
        boolean right = event.isRightClick(); p.closeInventory();
        Bukkit.getScheduler().runTask(plugin, () -> { if (!p.isOnline()) return;
            if (menu.page.equals("respec")) { if (slot==11) command(p,new String[]{"skills","respec","confirm"}); open(p,"learn"); return; }
            if (slot==48) { confirmRespec(p); return; }
            if (slot == 49) { p.performCommand("mycli menu"); return; }
            if (slot == 50) { plugin.taskMarket().openMenu(p); return; }
            if (slot == 47) { open(p, "learn"); return; }
            if (slot == 45 || slot == 46) { open(p, slot == 45 ? "roles" : "skills"); return; }
            if (slot < menu.ids.size()) {
                String id = menu.ids.get(slot);
                if (menu.page.equals("roles")) command(p, new String[]{"profession", right ? "leave" : "choose", id});
                else if (menu.page.equals("learn")) {
                    if (right) learningDetail(p,id);
                    else command(p, new String[]{"skills", level(p,id) > 0 ? "upgrade" : "learn", id});
                }
                else if (right) cast(p, id);
                else command(p, new String[]{"skills", ProfessionLedger.strings(ledger.profile(p.getUniqueId()), "prepared").contains(id) ? "unprepare" : "prepare", id});
            }
            open(p, menu.page);
        });
    }
    @EventHandler public void drag(InventoryDragEvent event) { if (menus.containsKey(event.getView().getTopInventory())) event.setCancelled(true); }
    @EventHandler public void close(InventoryCloseEvent event) { menus.remove(event.getInventory()); }
    void shutdown() { flushMetrics(); effects.shutdown(); menus.clear(); }
}
