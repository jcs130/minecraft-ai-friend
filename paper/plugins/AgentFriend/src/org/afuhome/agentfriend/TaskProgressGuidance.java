package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.Map;

/** Read-only next steps for the original goal enum. Never supplies game evidence. */
final class TaskProgressGuidance {
    private TaskProgressGuidance() { }
    record Notice(String token, String reason, int progress, long at) { }
    static boolean shouldNotify(Notice before, Notice after) {
        return before == null || !before.token().equals(after.token()) || !before.reason().equals(after.reason())
                || after.at() < before.at() || after.at() - before.at() >= 10_000;
    }
    private static final Map<String, String> MOB_NAMES = Map.ofEntries(
            Map.entry("SPIDER", "蜘蛛"), Map.entry("CAVE_SPIDER", "洞穴蜘蛛"),
            Map.entry("ZOMBIE", "僵尸"), Map.entry("HUSK", "尸壳"), Map.entry("DROWNED", "溺尸"),
            Map.entry("SKELETON", "骷髅"), Map.entry("STRAY", "流浪者"), Map.entry("BOGGED", "沼骸"),
            Map.entry("WITCH", "女巫"), Map.entry("PILLAGER", "掠夺者"), Map.entry("CREEPER", "苦力怕"),
            Map.entry("ENDERMAN", "末影人"), Map.entry("BLAZE", "烈焰人"), Map.entry("WARDEN", "监守者"));

    static JsonObject guide(GuildManager.Contract quest, int observed, JsonObject combat,
                            String verificationReason, JsonObject evidence) {
        verificationReason = verificationReason == null ? "" : verificationReason;
        int current = Math.max(0, observed), target = quest.target();
        boolean verify = EngineeringSites.GOALS.contains(quest.goal());
        boolean earlierBlocked = evidence != null && evidence.has("failedEarlierStep");
        boolean ready = current >= target && (!verify || "ready".equals(verificationReason)) && !earlierBlocked;
        JsonObject out = new JsonObject();
        out.addProperty("readOnly", true); out.addProperty("ready", ready);
        out.addProperty("phase", ready ? "ready_to_submit" : verify ? "verify_build" : "perform_action");
        out.addProperty("reason", ready ? "READY_TO_SUBMIT" : verify ? "VERIFICATION_REQUIRED" : "ACTION_INCOMPLETE");
        out.addProperty("summary", ready ? "本阶段条件已记录齐全，等待本人交付"
                : "本阶段已记录 " + current + "/" + target + "，还差 " + Math.max(0, target - current));
        out.addProperty("current", current); out.addProperty("target", target);
        out.addProperty("remaining", Math.max(0, target - current));
        out.addProperty("progress", ready ? 1.0 : Math.min(.99, current / (double) Math.max(1, target)));
        JsonArray missing = new JsonArray(); out.add("missingConditions", missing);
        String action = ready ? "用 /mycli guild claim 交付本阶段；阶段达标和整单领奖分别确认。"
                : instruction(quest, combat);
        if (!ready) missing.add(verify ? verificationHint(verificationReason, evidence)
                : "还需 " + Math.max(0, target - current) + "；" + requirement(quest, combat));
        if (!ready && verify) action += " " + verificationHint(verificationReason, evidence);
        out.addProperty("nextAction", action);
        out.addProperty("nextCommand", ready ? "/mycli guild claim" : verify ? "/mycli guild verify" : "/mycli tasks status");
        if (verify && !ready && java.util.Set.of("not_at_site", "area_unloaded", "site_not_reserved").contains(verificationReason)) {
            out.addProperty("phase", "not_at_site".equals(verificationReason) ? "reach_site" : "check_site");
            out.addProperty("reason", verificationReason.toUpperCase(java.util.Locale.ROOT));
            out.addProperty("nextCommand", "/mycli guild engineering " + quest.id());
        }
        JsonArray objectives = new JsonArray(); out.add("objectives", objectives);
        objective(objectives, "action", requirement(quest, combat), ready, !ready);
        objective(objectives, "claim", "本人交付当前阶段", false, ready);
        out.addProperty("completedObjectives", ready ? 1 : 0); out.addProperty("totalObjectives", 2);
        if (earlierBlocked) {
            out.addProperty("phase", "repair_earlier_stage"); out.addProperty("reason", "EARLIER_STAGE_INVALID");
            out.addProperty("summary", "本阶段进度保留，前面第 " + evidence.get("failedEarlierStep").getAsInt() + " 阶段结构需修复");
            out.addProperty("nextAction", "先修复前面第 " + evidence.get("failedEarlierStep").getAsInt() + " 阶段；" + verificationHint(verificationReason, evidence)
                    + " 用 guild engineering 查看原场地与条件，修复后再验收交付，不放弃重接。");
            out.addProperty("nextCommand", "/mycli guild engineering " + quest.id());
            while (!missing.isEmpty()) missing.remove(missing.size()-1);
            missing.add("前面第 " + evidence.get("failedEarlierStep").getAsInt() + " 阶段实际结构不再达标");
        }
        return out;
    }

    static String requirement(GuildManager.Contract quest, JsonObject combat) {
        return quest.goal() == GuildManager.Goal.KILLS && combat != null ? combatRequirement(combat)
                : TaskGuidance.step(quest.goal(), quest.description());
    }

    private static String instruction(GuildManager.Contract q, JsonObject combat) {
        String subject = q.siteId() == null ? "委托指定目标" : q.siteId();
        // Exhaustiveness is intentional: adding a goal must add its guidance.
        return switch (q.goal()) {
            case KILLS -> combat == null ? "参加试炼场多层挑战，按本单的参战击杀规则累计；野外杀怪不等于试炼参战记录。"
                    : combatRequirement(combat) + " 完成真实击杀后查进度；无需为此拆建筑、刷怪笼或申请无关领地。";
            case WITCH_KILLS -> "在试炼挑战中按本单条件击败女巫，普通怪物不能代替；先确认试炼参战状态。";
            case MELEE_KILLS -> "按本单装备条件持剑近战击败敌人；以实际职业战斗击杀记录为准，造成伤害和完成击杀分别判断。";
            case MARK_KILLS -> "先按本单要求给敌人施加印记，印记有效期间由玩家击杀；本人留在同一世界的目标32格内并保持技能资格，只施放印记不算击杀。";
            case PARRY -> "先施放本单要求的格挡或防护技能，让保护目标承受敌人实际攻击并产生有效减伤；普通举盾或空挥不补职业减伤记录。";
            case HEALING -> "用本单要求的治疗能力，治疗两分钟内被怪物打伤的队友；按实际恢复的有效怪物伤量计数。治疗自己、摔伤或满血施法不补该进度。";
            case FLOOR -> "参加试炼场多层挑战，通关本单指定第 " + q.floor() + " 层；野外地下城清场不能替代试炼楼层记录。";
            case PARTY_FLOOR -> "至少两名队友共同通关试炼场" + (q.floor() > 0 ? "第 " + q.floor() + " 层" : "允许的楼层") + "；本单若要求带新人，还需符合队友等级条件。";
            case FAST_FLOOR -> "接单后保持禁食，通关试炼场第 " + q.floor() + " 层；这是不进食约束。已有进食记录须先核对状态，再由本人决定是否重接。";
            case NO_DEATH -> "接单后保持零死亡，通关试炼场第 " + q.floor() + " 层；已经死亡须先核对状态，再由本人决定是否重接。";
            case LIGHT_FLOOR -> "通关试炼场第 " + q.floor() + " 层时，本人背包占用须不超过10格；可提前将多余物品收好，再参战。";
            case STONE_FLOOR -> "通关试炼场第 " + q.floor() + " 层时，背包与副手不能携带铁质以上武器；先收好不合规武器，再参战。";
            case CLAIMS -> "先完成对应试炼并取得待领奖记录，再由本人领取；仅打开箱子或重复查询不算领奖。";
            case DONATE -> "将 " + subject + " 备在本人随身背包，再用 /mycli guild claim 主动交付；普通材料和特色物品按原物品规则区分。需要补给先查看公会公共箱。";
            case CRAFT -> "亲手合成 " + subject + "；从箱子拿取、捡起或移动已有成品不能代替合成。完成后查进度。";
            case HARVEST -> "在获准农田实际收获本单指定的成熟作物 " + subject + "；捡起库存作物不算新收获。";
            case REPLANT -> "在本单要求的位置实际补种；收获和补种分别计数，查询不会代种。";
            case FISH -> "用鱼竿实际钓起本单要求的渔获；取用已有鱼不算钓鱼。";
            case TRADE -> "与本单指定商人实际完成交易，任意村民不能代替；/mycli world shops 查看真实集市位置，核对商人和收购项。打开交易页或看报价不算成交。";
            case LANTERNS -> "在获准位置实际放置本单指定火把或灯笼；受保护的入口、台阶和路灯要保留。";
            case PHOTO -> TaskGuidance.photo();
            case PHOTO_HANG -> "先取回本人的成片，再按本单要求实际挂展；照片在奖励箱中或仅打开相册不等于挂展。";
            case SITE_CLEAR -> "进入本单指定野外地下城并按参战规则清场；试炼场楼层战报不能代替该场地记录。";
            case SKILL_CAST -> "本人按条件实际成功施放 " + subject + "；冷却、缺魔力或权限拒绝都不会计作成功施法。";
            case SKILL_ASSESSMENT -> "查看本人考试当前场次，按冻结的实练项目完成并提交；单项通过与整场毕业分别判断。";
            case PEAK -> "到达 Y≥120 的高处，屋顶、高塔和天然山峰均可；落地横向走动一格后查询，不要求积雪。";
            case BIOME_BORDER -> "在同一世界实际步行跨过两种真实群系的交界；同一群系内走远或仅传送不算跨界。";
            case DIMENSION -> "经已知门户进入本单要求的维度，再按探索要求实际走查；进入一次不能代替移动距离和时间。";
            case STRUCTURE -> "进入本单指定注册类型的天然遗迹内部，再在同一座结构内走查；到达某个高度、同名群系或自己搭的建筑不算找到遗迹。";
            case BIOME -> "进入本单指定的真实群系并实际走查；以服务器群系键为准，外观相似不能代替。";
            case RETURN -> "回到本单指定维度或返程点，核对保存的探索证据，再本人交付；不重新接单清空记录。";
            case MAP_HUNT -> "主手核对原绑定地图，按地图标记、真实入口、内部走查和返程条件推进；原图调查不一律要求开箱。";
            case EXPLORE -> "先 /mycli guide explore 查本单地点 " + subject + " 的登记参考点与实际入口路线；参考中心不等于入口，不在无证据处反复竖挖。";
            case ERUDITE -> "核对历史累计完成的 " + q.target() + " 种不同能力维度委托，如感知、战斗、协作；不是去不同世界或学习技能。历史不足时先 /mycli guild status 核对认证进度；该槽只能接一单，核对后再自行选择是否换单，历史成绩保留。";
            case PRAYER_ROAD -> "先 /mycli goddess pray 向女神问路，再从本次祈愿位置走到200格外；只聊天或查询不会代替祈愿与行走记录。";
            case PILGRIMAGE -> "从接单位置徒步远行至少500格，再步行返回出发点附近；途中传送或死亡重生会重置远方标记，先保存出发坐标并保持补给。";
            case BRIDGE, ROAD, BUILD, REDSTONE -> "在本单登记场地内按冻结条件施工；用 /mycli guild verify 验收真实增量。查询状态不会扫描施工或替代验收。";
        };
    }

    static String combatRequirement(JsonObject combat) {
        JsonArray mobs = combat.getAsJsonArray("mobs"), weapons = combat.getAsJsonArray("weapons");
        String enemies = mobs.asList().stream().map(v -> MOB_NAMES.getOrDefault(v.getAsString(), v.getAsString())).reduce((a,b)->a+"、"+b).orElse("指定敌人");
        String arms = weapons.asList().stream().map(v -> switch(v.getAsString()) {
            case "SWORD" -> "剑"; case "AXE" -> "斧"; case "BOW" -> "弓";
            case "CROSSBOW" -> "弩"; case "TRIDENT" -> "三叉戟"; case "MACE" -> "重锤";
            case "ANY" -> "允许的武器"; default -> v.getAsString();
        }).reduce((a,b)->a+"或"+b).orElse("指定武器");
        String method = switch (combat.get("attack").getAsString()) {
            case "melee" -> "原版近战完成最后一击，法术和环境伤害不计";
            case "projectile" -> "本人发射的投射物完成最后一击，以发射时武器为准";
            default -> "按允许的攻击方式完成本人最后一击";
        };
        return "任选 " + enemies + " 累计数量（同种的不同个体也可，每个生物只计一次）；使用" + arms + "，" + method + "。";
    }

    static String verificationHint(String reason, JsonObject evidence) {
        return switch (reason == null ? "" : reason) {
            case "not_at_site" -> "本人尚未到登记场地附近；先查 guild engineering 的世界与坐标并实际到场，再验收，远程重交不会补进度。";
            case "area_unloaded" -> "登记场地尚未全部加载；实际到场并等地形就绪，再验收。持续不可用请联系服主，保留原基准。";
            case "site_not_reserved" -> "场地不在本次委托的有效预约内；查 guild engineering 后联系服主核对原预约，不重设基准或换地点施工。";
            case "scan_busy" -> "另一次扫描正在进行；等其结束后再验一次，不连续发送验收命令。";
            case "site_changed_during_scan", "site_or_player_changed" -> "扫描期间场地、本人位置或预约发生变化；回到原场地，暂停施工并站稳，再验一次。";
            case "insufficient_new_blocks" -> "新增的合格材料不足；按原条件补建，移动原有方块不能冒充新增材料。";
            case "bridge_not_connected" -> "桥面尚未形成可通行的两端连接；补齐连续桥面后再验收。";
            case "insufficient_road_coverage" -> "道路覆盖尚不足；在指定范围补齐可通行路面后再验收。";
            case "missing_components" -> "机械结构还缺部件：" + (evidence != null && evidence.has("missingComponents") ? evidence.get("missingComponents") : "用 guild verify 查看实际清单") + "。";
            case "signal_not_observed" -> "部件存在，但还缺真实开关信号证据；按本单要求操作机关，再验收。";
            case "ready" -> "上次验收已通过；交付时仍会按原规则复核。";
            default -> "进度来自上次记录；先用 /mycli guild verify 查看当前真实缺项，保留原场地和基准。";
        };
    }

    static String rejectedHint(String reason, JsonObject combat) {
        String fix = switch(reason) {
            case "TARGET_MISMATCH" -> "这只敌人不在本单的目标集合。";
            case "WEAPON_MISMATCH" -> "最后一击使用的武器不符合本单条件。";
            case "ATTACK_METHOD_MISMATCH" -> "最后一击的攻击方式不符合本单条件；击杀成功与委托计数分别确认。";
            case "MELEE_EVIDENCE_MISSING" -> "最后一击缺少本阶段的原版近战证据；法术或自动伤害不能代替规定的原版攻击。";
            case "PROJECTILE_EVIDENCE_MISSING" -> "投射物缺少本阶段发射记录；接单后用允许武器重新完成有效射击。";
            case "WRONG_ITEM_OR_SITE" -> "本次物品或场地与当前阶段指定目标不符；按当前条件重新选择目标。";
            case "REPLANT_SITE_NOT_HARVESTED" -> "这个种植位置不在本单先前收获的位置记录内；回到本单收获过的同种作物田格补种。";
            default -> "本次行动没有形成当前阶段的有效证据。";
        };
        return fix + (combat == null ? "先 /mycli tasks status 核对当前条件。" : combatRequirement(combat));
    }

    private static void objective(JsonArray out, String id, String title, boolean done, boolean current) {
        JsonObject row = new JsonObject(); row.addProperty("id", id); row.addProperty("title", title);
        row.addProperty("state", done ? "completed" : current ? "current" : "pending"); out.add(row);
    }
}
