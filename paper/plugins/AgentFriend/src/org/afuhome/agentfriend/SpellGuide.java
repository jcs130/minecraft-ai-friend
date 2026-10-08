package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.LinkedHashMap;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/** One read-only guide for the custom spells used by Java, Bedrock and Agents. */
final class SpellGuide {
    private static final int PAGE_SIZE = 7;
    record Entry(String id, String name, String category, Material icon, String command,
                 String effect, String target, int mana, int cooldownSeconds,
                 String requires, String failure, String scaling, String tip) {
        String costLine() { return "魔力 " + mana + " · 冷却 " + cooldownSeconds + " 秒"; }
        JsonObject json() {
            JsonObject data = new JsonObject();
            data.addProperty("schemaVersion", 1);
            data.addProperty("id", id);
            data.addProperty("name", name);
            data.addProperty("category", category);
            data.addProperty("command", command);
            data.addProperty("effect", effect);
            data.addProperty("target", target);
            data.addProperty("mana", mana);
            data.addProperty("cooldownMs", cooldownSeconds * 1000);
            data.addProperty("requires", requires);
            data.addProperty("onFailure", failure);
            data.addProperty("scaling", scaling);
            data.addProperty("tip", tip);
            return data;
        }
    }

    private static final List<Entry> SPELLS = List.of(
            new Entry("support", "支援传送术", "travel", Material.BELL,
                    "/mycli village support [事件ID]", "重查村庄实时敌情，传到仍存活敌人附近6至12格的安全可见落点，并返回敌人坐标。", "已确认警报里的活敌人", 8, 20,
                    "生存/冒险模式；至少3颗心；不在试炼/PvP、载具或滑翔中；敌情已确认。", "警报过期、敌人消失、魔力不足或没有安全落点时不传送、不扣费。", "无熟练度升级；/mycli cast support 和罗盘也可用。", "Agent 用警报 cmd 的事件ID；不要沿用旧坐标，抵达后核对 enemy UUID 再攻击。"),
            new Entry("selfheal", "圣愈术", "recovery", Material.GOLDEN_APPLE,
                    "/mycli cast selfheal", "回复自己 8 点生命（4 颗心）。", "自己", 6, 15,
                    "生命未满；非旁观者。", "已满血时不治疗，也不应重复施放。", "无熟练度升级。", "受伤后给自己补血；队友受伤用 heal。"),
            new Entry("heal", "范围治疗", "recovery", Material.GLISTERING_MELON_SLICE,
                    "/mycli cast heal", "治疗 8 格内所有受伤玩家，每人最多回复 6 点生命（3 颗心）。", "自己和附近队友", 6, 12,
                    "8 格内至少一名玩家受伤；非旁观者。", "无人受伤不扣魔力，不进入冷却。", "无熟练度升级。", "组队战斗中多人掉血时使用；无需瞄准。"),
            new Entry("food", "饱食术", "recovery", Material.BREAD,
                    "/mycli cast food", "恢复 4 点饥饿值和 2.5 点饱和度。", "自己", 3, 30,
                    "饥饿值未满；非旁观者。", "饥饿已满时没有收益。", "无熟练度升级。", "远行缺少食物时补充；不能代替治疗。"),
            new Entry("home", "归乡术", "travel", Material.RED_BED,
                    "/mycli cast home", "传送回出生村庄的安全落点。", "自己", 6, 0,
                    "目标传送点可用且落脚处安全；非旁观者；6 魔力。", "落点被阻挡或传送失败时留在原地，不扣魔力。", "无熟练度升级。", "迷路、任务结束或离开危险区域时使用。"),
            new Entry("travel", "传送点术", "travel", Material.LODESTONE,
                    "/mycli waypoint menu", "记录亲自到达的安全地点并起名；返回私人地点或别人主动分享的地点，支持主世界、下界和末地。", "本人地点或有效分享码", 6, 0,
                    "生存/冒险角色；落点安全、保护规则允许；不在试炼/PvP 活动中。", "落点受阻、分享撤回、地点失效或魔力不足时不传送、不扣费。", "记录、列表、改名、分享免费；实际传送每次 6 魔力，无熟练度升级。", "到达后 /mycli waypoint add 下界营地；/mycli goto personal:下界营地；share 后别人用 shared:分享码。"),
            new Entry("blink", "闪现术", "travel", Material.ENDER_PEARL,
                    "/mycli cast blink", "沿视线短距闪现，最远约 25 格；不能穿越封闭天花板。", "自己朝向", 4, 8,
                    "面向可到达的安全位置；非旁观者。", "目标不安全时 MagicSpells 拒绝传送。", "无熟练度升级。", "越过小沟或快速躲开近身怪物；先确认落点。"),
            new Entry("give", "造物术", "creation", Material.CRAFTING_TABLE,
                    "/mycli cast give <物品>", "固定配方：bread×4、torch×4、oak_log×8、cobblestone×16、crafting_table×1、chest×1、cake×1、glass×8。其他物品转交女神审核，不会立即生成。", "自己的背包；缺项交女神", 4, 20,
                    "固定配方需背包有空间；缺项申请需女神在线，申请本身不扣魔力。", "背包满则固定配方拒绝；女神不在线则申请未送达。", "固定配方无熟练度升级；缺项申请有独立 60 秒间隔。", "缺建材或食物时选固定配方；不要把申请当作已得到物品。"),
            new Entry("fireworks", "烟花术", "cosmetic", Material.FIREWORK_ROCKET,
                    "/mycli cast fireworks", "在身边播放烟花粒子和声音；没有伤害。", "自己周围", 1, 10,
                    "非旁观者。", "魔力不足或冷却中不播放成功效果。", "无熟练度升级。", "庆祝或直播画面装饰。"),
            new Entry("starlight", "星尘术", "cosmetic", Material.GLOWSTONE_DUST,
                    "/mycli cast starlight", "在身边播放星光粒子和声音；没有真实照明或伤害。", "自己周围", 1, 10,
                    "非旁观者。", "魔力不足或冷却中不播放成功效果。", "无熟练度升级。", "仪式或直播画面装饰；夜间看路请用 night。"),
            new Entry("starbolt", "星芒箭", "combat", Material.AMETHYST_SHARD,
                    "/mycli cast starbolt", "优先命中准星 18 格内敌对怪物，否则锁定 12 格内最近可见怪物；基础伤害 5。", "可见敌对怪物", 4, 3,
                    "目标可见且没有方块遮挡；非旁观者。", "无合法怪物时不扣魔力、不进入冷却。", "成功 8/24 次升 2/3 级，每级 +1 伤害；战斗每 20 级再 +1，最多 +2。", "远程单体输出；不会锁玩家、村民、宠物或友方。"),
            new Entry("frostnova", "霜环", "combat", Material.SNOWBALL,
                    "/mycli cast frostnova", "伤害并减速身边 5.5 格内最多 4 只可见怪物；基础伤害 2、减速 4 秒。", "附近敌对怪物", 7, 14,
                    "身边有可见怪物；非旁观者。", "没有合法怪物时不扣魔力、不进入冷却。", "成功 8/24 次升 2/3 级：伤害 2/3/4，减速 4/5/6 秒；战斗等级最多再 +2 伤害。", "被多只怪物包围时先控场；不会冻住队友。"),
            new Entry("flamewave", "焰浪", "combat", Material.BLAZE_POWDER,
                    "/mycli cast flamewave", "伤害并点燃前方 9 格内最多 4 只可见怪物；基础伤害 4、燃烧 3 秒。", "前方敌对怪物", 8, 10,
                    "面向怪物且目标可见；非旁观者。", "前方没有合法怪物时不扣魔力、不进入冷却。", "成功 8/24 次升 2/3 级：伤害 4/5/6，燃烧 3/4/5 秒；战斗等级最多再 +2 伤害。", "清理前方成群怪物；不会点燃方块或伤队友。"),
            new Entry("prospect", "探矿术", "gathering", Material.SPYGLASS,
                    "/mycli cast prospect [all|coal|iron|copper|gold|gems|diamond|redstone|ancient]", "扫描已加载区域，返回最近矿块的绝对坐标；持续显示粒子指向线和遮挡墙光框，Java 另见矿块轮廓。", "附近矿块", 6, 30,
                    "只查已加载区块；ancient 适合下界；非旁观者。", "附近无对应矿物时不扣魔力、不进入冷却。", "基础半径 24 格，挖矿每 5 级 +2，最多 40；刻印工具再 +8；熟练度提升标记 12/15/18 秒。", "粒子线指示方位而非可行走路径；按绝对坐标寻找安全路线。"),
            new Entry("leap", "跃空术", "exploration", Material.RABBIT_FOOT,
                    "/mycli cast leap", "高高跳起并获得缓降，避免落地伤害。", "自己", 4, 8,
                    "站在地面，未乘坐载具或飞行；非旁观者。", "没有站稳时不扣魔力、不进入冷却。", "成功 8/24 次升 2/3 级；跳跃略增，缓降 9/11/13 秒。", "越过高差或短程逃离；先确认上方与落点。"),
            new Entry("flight", "飞行术", "exploration", Material.ELYTRA,
                    "/mycli cast flight", "生存模式自由飞行，到期回收飞行权限并缓降。", "自己", 10, 90,
                    "不是创造模式，当前没有飞行术生效；非旁观者。", "飞行中重复使用不会再扣魔力。", "成功 8/24 次升 2/3 级，持续 15/18/21 秒。", "跨越地形或高处侦察；时间结束前寻找安全落点。"),
            new Entry("golem", "守护傀儡", "exploration", Material.IRON_BLOCK,
                    "/mycli cast golem", "在身边召唤临时铁傀儡，只协助攻击敌对怪物。", "附近安全落脚处", 12, 75,
                    "附近有 3 格高的安全落脚处，且自己的旧傀儡已离开。", "无落点或旧傀儡仍在时不扣魔力、不进入冷却。", "成功 8/24 次升 2/3 级，存在 45/50/55 秒。", "危险区域提前召唤；不会攻击玩家和家畜。"),
            new Entry("sense", "探敌术（心眼）", "exploration", Material.RECOVERY_COMPASS,
                    "/mycli cast sense", "探查附近已加载的敌对怪物，持续 8 秒显示方位、坐标与墙面指引；Java 轮廓仅对本人和附身 Eye 可见。", "附近敌对怪物", 3, 15,
                    "附近区块已加载；非旁观者。", "未发现怪物时不扣魔力、不进入冷却。", "成功 8/24 次升 2/3 级，范围 24/28/32 格。", "入侵时寻找躲在墙后的怪物；基岩看粒子墙框与方向条，未加载区域不能据此认定安全。"),
            new Entry("feather", "羽落术", "support", Material.FEATHER,
                    "/mycli cast feather", "获得 45 秒缓降效果。", "自己", 2, 90,
                    "先学会：原版经验 5 级、炼金等级 2 免费，或首次通过试炼第三层。", "未学会、魔力不足或冷却中不能施放。", "无熟练度升级。", "高处下落前施放；也可从罗盘图标学习。"),
            new Entry("night", "夜视术", "support", Material.LANTERN,
                    "/mycli cast night", "获得 120 秒夜视效果；不会改变世界光照。", "自己", 2, 180,
                    "先学会：原版经验 5 级、炼金等级 2 免费，或首次通过试炼第三层。", "未学会、魔力不足或冷却中不能施放。", "无熟练度升级。", "矿洞和夜间探索前施放；观战者夜视另行设置。"));

    private SpellGuide() { }
    static java.util.Set<String> baseIds() { return SPELLS.stream().map(Entry::id).collect(java.util.stream.Collectors.toSet()); }
    static List<Entry> entries() {
        List<Entry> entries = new ArrayList<>(SPELLS);
        var plugin = org.bukkit.Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (plugin instanceof AgentFriendPlugin friend && friend.professions() != null)
            friend.professions().skills().stream().map(ProfessionCatalog.Skill::guide).forEach(entries::add);
        return List.copyOf(entries);
    }
    static Entry find(String raw) {
        String id = raw.toLowerCase(Locale.ROOT).trim();
        if (id.startsWith("cast.")) id = id.substring(5);
        if (id.equals("village.support")) id = "support";
        if (id.startsWith("prospect ")) id = "prospect";
        if (id.startsWith("give ")) id = "give";
        for (Entry entry : entries()) if (entry.id().equals(id)) return entry;
        return null;
    }
    static String costLine(String raw) {
        Entry entry = find(raw);
        return entry == null ? "" : entry.costLine();
    }
    static String[] menuLines(String... values) {
        List<String> lines = new ArrayList<>();
        for (String value : values) {
            for (int start = 0; start < value.length(); start += 32)
                lines.add(value.substring(start, Math.min(start + 32, value.length())));
        }
        return lines.toArray(String[]::new);
    }
    static String[] preview(Entry entry) {
        String effect = entry.effect();
        return new String[]{effect.length() > 32 ? effect.substring(0, 32) + "…" : effect,
                entry.costLine(), "点击查看完整说明；不会施法"};
    }
    static void command(Player player, String[] args) {
        if (args.length == 1 || args.length >= 2 && args[1].equalsIgnoreCase("list")) {
            int page = 1; String filter = "all";
            if (args.length > 4) { error(player, "INVALID_ARGUMENT", "用法：/mycli skills list [分类] [页码]，旧 list <页码> 仍有效"); return; }
            if (args.length >= 3) {
                String value = args[2].toLowerCase(Locale.ROOT);
                if (value.matches("[+-]?\\d+")) {
                    if (args.length != 3) { error(player, "INVALID_ARGUMENT", "页码前请先写分类，如 list priest 1"); return; }
                    try { page = Integer.parseInt(value); }
                    catch (NumberFormatException invalid) { error(player, "INVALID_PAGE", "页码超出范围"); return; }
                } else filter = value;
            }
            if (args.length == 4) try { page = Integer.parseInt(args[3]); }
            catch (NumberFormatException invalid) { error(player, "INVALID_PAGE", "页码必须是整数"); return; }
            list(player, filter, page);
            return;
        }
        if (args.length < 3 || !(args[1].equalsIgnoreCase("explain")
                || args[1].equalsIgnoreCase("info") || args[1].equalsIgnoreCase("describe"))) {
            error(player, "INVALID_ARGUMENT", "用法：/mycli skills list [all|common|profession|warrior|mage|priest] [页码] 或 explain <技能ID>");
            return;
        }
        detail(player, String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length)));
    }
    static void list(Player player, int page) {
        list(player, "all", page);
    }
    private static Map<String, String> professions() {
        Map<String, String> roles = new LinkedHashMap<>();
        var plugin = org.bukkit.Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (plugin instanceof AgentFriendPlugin friend && friend.professions() != null)
            friend.professions().skills().forEach(skill -> roles.put(skill.id(), skill.role()));
        return roles;
    }
    static void discoveryHint(Player player) {
        int count = professions().size();
        player.sendMessage(ChatColor.AQUA + "[系统·技能目录] 当前基础" + SPELLS.size() + "项、职业" + count
                + "项；/mycli skills list profession 查看职业技艺，list warrior|mage|priest 按战法牧查询。技能有多页，请读 pages/MC_SPELL_NEXT。");
        player.sendMessage(ChatColor.GRAY + "用 /mycli skills info <ID> 查各级效果、点数和解锁条件；看到技能不等于已经学会。组队倒地救援是副本规则，靠近4格10秒或清场自动复活，无需学习/施法。");
    }
    private static void list(Player player, String filter, int page) {
        List<Entry> all = entries(); Map<String, String> roles = professions();
        if (!List.of("all", "common", "profession").contains(filter) && !roles.containsValue(filter)) {
            error(player, "UNKNOWN_FILTER", "分类：all、common、profession、warrior、mage、priest"); return;
        }
        List<Entry> SPELLS = all.stream().filter(entry -> filter.equals("all")
                || filter.equals("common") && !roles.containsKey(entry.id())
                || filter.equals("profession") && roles.containsKey(entry.id())
                || filter.equals(roles.get(entry.id()))).toList();
        int pages = Math.max(1, (SPELLS.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        if (page < 1 || page > pages) { error(player, "INVALID_PAGE", "页码范围 1–" + pages); return; }
        JsonObject header = new JsonObject();
        header.addProperty("schemaVersion", 1);
        header.addProperty("page", page);
        header.addProperty("pages", pages);
        header.addProperty("total", SPELLS.size());
        header.addProperty("filter", filter);
        header.addProperty("catalogTotal", all.size());
        header.addProperty("commonTotal", all.size() - roles.size());
        header.addProperty("professionTotal", roles.size());
        header.addProperty("professionListCommand", "/mycli skills list profession");
        var plugin = org.bukkit.Bukkit.getPluginManager().getPlugin("AgentFriend");
        header.addProperty("catalogVersion", plugin == null ? "unavailable" : plugin.getDescription().getVersion());
        player.sendMessage("MC_SPELL_LIST " + header);
        for (int i = (page - 1) * PAGE_SIZE; i < Math.min(page * PAGE_SIZE, SPELLS.size()); i++) {
            Entry entry = SPELLS.get(i);
            JsonObject item = new JsonObject();
            item.addProperty("id", entry.id());
            item.addProperty("name", entry.name());
            item.addProperty("category", entry.category());
            item.addProperty("mana", entry.mana());
            item.addProperty("cooldownMs", entry.cooldownSeconds() * 1000);
            item.addProperty("command", entry.command());
            item.addProperty("profession", roles.getOrDefault(entry.id(), "common"));
            item.addProperty("summary", entry.effect());
            item.addProperty("detailCommand", "/mycli skills info " + entry.id());
            player.sendMessage("MC_SPELL_ITEM " + item);
        }
        if (page < pages) player.sendMessage("MC_SPELL_NEXT /mycli spells list "
                + (filter.equals("all") ? "" : filter + " ") + (page + 1));
        discoveryHint(player);
    }
    static void detail(Player player, String id) {
        Entry entry = find(id);
        if (entry == null) { error(player, "UNKNOWN_ID", "未知技能；先用 /mycli spells list"); return; }
        player.sendMessage("MC_SPELL_DETAIL " + entry.json());
        player.sendMessage(ChatColor.LIGHT_PURPLE + entry.name() + "：" + entry.effect());
        player.sendMessage(ChatColor.GRAY + "用法 " + entry.command() + "；" + entry.costLine()
                + "；" + entry.tip());
    }
    private static void error(Player player, String code, String hint) {
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("code", code);
        data.addProperty("hint", hint);
        player.sendMessage("MC_SPELL_ERROR " + data);
    }
}
