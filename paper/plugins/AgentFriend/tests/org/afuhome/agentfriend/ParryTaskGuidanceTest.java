package org.afuhome.agentfriend;

import com.google.gson.JsonObject;

/** Exercises actionable skill preconditions without creating task evidence or spending points. */
public final class ParryTaskGuidanceTest {
    private static int checks;
    private static void check(String name, boolean ok) { if (!ok) throw new AssertionError(name); checks++; }
    private static JsonObject guide(int count) {
        var q = new GuildManager.Contract("tm_sword_arc_trial", "两次有效格挡", "原冻结条件", null,
                GuildManager.Goal.PARRY, 2, 0, 0, 1, 1, null, 1, "");
        return TaskProgressGuidance.guide(q, count, null, "", new JsonObject());
    }
    private static JsonObject skill(String reason) {
        JsonObject s = new JsonObject(); s.addProperty("id", "sword_parry"); s.addProperty("name", "架势格挡");
        s.addProperty("reason", reason); s.addProperty("remainingPoints", 0); s.addProperty("nextPointCost", 2);
        s.addProperty("respecMana", 10); s.addProperty("manaCost", 4); s.addProperty("cooldownRemainingMs", 4321);
        s.addProperty("learnCommand", "/mycli skills learn sword_parry");
        s.addProperty("prepareCommand", "/mycli skills prepare sword_parry");
        s.addProperty("command", "/mycli cast sword_parry"); s.addProperty("windowMs", 2000);
        s.addProperty("cooldownMs", 12000); s.addProperty("frontalMelee", true); return s;
    }
    public static void main(String[] args) {
        var original = guide(0); var missing = skill("not_learned");
        String before = original.toString(), beforeSkill = missing.toString();
        var g = TaskProgressGuidance.parry(original, missing);
        check("no evidence invented", g.get("current").getAsInt() == 0 && g.get("remaining").getAsInt() == 2 && !g.get("ready").getAsBoolean());
        check("original snapshot unchanged", original.toString().equals(before) && missing.toString().equals(beforeSkill));
        check("real missing prerequisite", g.get("reason").getAsString().equals("SKILL_NOT_LEARNED") && g.get("phase").getAsString().equals("prepare_skill"));
        check("points queried before destructive reset", g.get("nextCommand").getAsString().equals("/mycli skills points"));
        check("cost and balance explicit", g.get("nextAction").getAsString().contains("2 技能点") && g.get("nextAction").getAsString().contains("可用 0"));
        check("reset consequences explicit", g.get("nextAction").getAsString().contains("10 魔力") && g.get("nextAction").getAsString().contains("清除付费学习") && !g.get("nextCommand").getAsString().contains("confirm"));
        check("skill precedes combat objective", g.getAsJsonArray("objectives").get(0).getAsJsonObject().get("id").getAsString().equals("skill") && g.getAsJsonArray("objectives").get(1).getAsJsonObject().get("state").getAsString().equals("pending"));
        missing.addProperty("remainingPoints", 2); g = TaskProgressGuidance.parry(guide(1), missing);
        check("enough points opens detail", g.get("nextCommand").getAsString().equals("/mycli skills info sword_parry"));
        check("learn explicitly named", g.get("nextAction").getAsString().contains("/mycli skills learn sword_parry"));
        check("existing count retained", g.get("current").getAsInt() == 1 && g.get("remaining").getAsInt() == 1);
        g = TaskProgressGuidance.parry(guide(0), skill("not_prepared"));
        check("prepare command", g.get("nextCommand").getAsString().equals("/mycli skills prepare sword_parry"));
        check("wrong profession", TaskProgressGuidance.parry(guide(0), skill("profession_required")).get("nextCommand").getAsString().equals("/mycli profession status"));
        check("wrong equipment", TaskProgressGuidance.parry(guide(0), skill("equipment_required")).get("nextAction").getAsString().contains("主手武器"));
        check("remaining cooldown", TaskProgressGuidance.parry(guide(0), skill("cooldown")).get("nextAction").getAsString().contains("4321 毫秒"));
        check("mana amount", TaskProgressGuidance.parry(guide(0), skill("insufficient_mana")).get("nextAction").getAsString().contains("4 魔力"));
        g = TaskProgressGuidance.parry(guide(0), skill("target_or_context_not_checked"));
        check("cast remains an action", g.get("nextCommand").getAsString().equals("/mycli cast sword_parry") && !g.get("ready").getAsBoolean());
        String action = g.get("nextAction").getAsString();
        check("real timing and independent casts", action.contains("2.0 秒") && action.contains("12.0 秒") && action.contains("分轮施法"));
        check("facing before cast", action.contains("先正对") && action.contains("施放时的朝向"));
        check("ordinary shield and ranged are distinguished", action.contains("普通举盾") && action.contains("完全挡掉") && action.contains("女巫药水"));
        var ward = skill("target_or_context_not_checked"); ward.addProperty("id", "guardian_ward"); ward.addProperty("frontalMelee", false);
        ward.addProperty("windowMs", 7000); ward.addProperty("cooldownMs", 25000); ward.addProperty("command", "/mycli cast guardian_ward");
        g = TaskProgressGuidance.parry(guide(0), ward);
        check("ward uses actual effect not sword assumptions", g.get("nextAction").getAsString().contains("7.0 秒") && !g.get("nextAction").getAsString().contains("主手持剑") && g.get("nextCommand").getAsString().endsWith("guardian_ward"));
        check("ward credits each protected ally rather than limiting a party cast to one", g.get("nextAction").getAsString().contains("每位受保护者") && !g.get("nextAction").getAsString().contains("分轮施法"));
        var unavailable = new JsonObject(); unavailable.addProperty("reason", "data_unavailable");
        check("unknown state is not ready", TaskProgressGuidance.parry(guide(0), unavailable).get("reason").getAsString().equals("SKILL_DATA_UNAVAILABLE"));
        check("earned evidence claim survives respec", TaskProgressGuidance.parry(guide(2), missing).get("nextCommand").getAsString().equals("/mycli guild claim"));
        check("read remains read only", g.get("readOnly").getAsBoolean());
        var rejection = ActionFeedback.advice("market", "skill_required:sword_parry", "tm_sword_arc_trial");
        check("accept denial names actual skill", rejection.message().contains("sword_parry") && rejection.commands().contains("/mycli skills info sword_parry"));
        check("accept denial explains shield distinction", rejection.next().contains("普通举盾"));
        check("other skill requirements do not gain irrelevant parry text", !ActionFeedback.advice("market", "skill_required:arcane_mark", "tm_mage_trial").next().contains("举盾"));
        System.out.println("ParryTaskGuidanceTest: " + checks + " passed");
    }
}
