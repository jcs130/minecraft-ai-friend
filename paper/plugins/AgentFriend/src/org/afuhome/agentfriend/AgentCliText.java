package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Bounded presentation of existing observations. No commands, world reads or gameplay writes. */
final class AgentCliText {
    private static final int PAGE_SIZE = 7;
    private AgentCliText() { }

    private static String value(JsonObject data, String key, String fallback) {
        JsonElement value = data.get(key);
        return value != null && value.isJsonPrimitive() ? value.getAsString() : fallback;
    }
    private static boolean yes(JsonObject data, String key) { return value(data, key, "").equals("true"); }
    private static String shortText(String text, int limit) {
        String clean = text.replaceAll("§[0-9A-FK-ORXa-fk-orx]", "").replaceAll("[\\r\\n\\t]+", " ").trim();
        return clean.codePointCount(0, clean.length()) <= limit ? clean : clean.substring(0, clean.offsetByCodePoints(0, limit - 1)) + "…";
    }
    // Commands are copied whole, never clipped into a different executable command.
    private static String command(JsonObject data, String key, String fallback) {
        String result = value(data, key, fallback);
        return result.startsWith("/mycli ") && result.length() <= 320 && !result.contains("\n") && !result.contains("\r") ? result : fallback;
    }

    static List<String> help(JsonObject data) {
        if (data.has("errorCode")) return List.of("[提示] " + shortText(value(data, "message", "参数错误"), 180) + "。命令：/mycli --help");
        List<String> lines = new ArrayList<>();
        lines.add("用法：" + value(data, "usage", "/mycli --help"));
        if (data.has("commands")) {
            for (JsonElement item : data.getAsJsonArray("commands")) {
                JsonObject row = item.getAsJsonObject();
                lines.add(value(row, "name", "") + "：" + shortText(value(row, "summary", ""), 60));
            }
            lines.add("详情：<命令> --help；仅详情标明支持时使用 --json。");
        } else {
            lines.add(shortText(value(data, "summary", ""), 160));
            String operation = switch (value(data, "operation", "")) {
                case "query" -> yes(data, "actionReadOnly") ? "只读查询" : "查询（可能更新旧版进度）";
                case "enroll" -> "报名或接单"; case "cancel" -> "取消或退出"; case "group" -> "命令组，按子动作结算";
                default -> "执行动作";
            };
            lines.add("类型：" + operation + "；" + (yes(data, "jsonSupported") ? "支持 --json" : "沿用原回执，不支持 --json"));
            lines.add("条件：" + value(data, "requirements", "以实际回执为准"));
            lines.add("消耗：" + value(data, "consumption", "以实际回执为准"));
            lines.add("核对：" + value(data, "resultQuery", "/mycli status"));
        }
        if (data.has("nextCommand")) lines.add("下一页：" + command(data, "nextCommand", "/mycli --help"));
        return List.copyOf(lines);
    }

    static List<String> state(JsonObject data) {
        String auth = "未知（不能据此判断未登录）";
        if (data.has("authentication") && data.get("authentication").isJsonObject()) {
            JsonObject authentication = data.getAsJsonObject("authentication");
            if (yes(authentication, "authorized") && value(authentication, "status", "").equals("authenticated")) auth = "已验证";
            else if (value(authentication, "authorized", "").equals("false")) auth = "待验证；用 /authstatus 核对";
        }
        String activity = yes(data, "downed") ? "倒地，等队友救援" : yes(data, "inPvp") ? "竞技中" : yes(data, "inDungeon") ? "参战中" : "自由活动";
        String mana = value(data, "mana", "未知") + "/" + value(data, "maxMana", "未知");
        JsonObject combat=data.has("combatRpg")?data.getAsJsonObject("combatRpg"):new JsonObject();
        String growth=combat.has("level")?" · 战斗Lv."+value(combat,"level","")+" · 正式攻略"+value(combat,"conquestFloor","0")+"层":"";
        return List.of("[状态] " + value(data, "name", "本人") + " · " + value(data, "adventurerRank", "等级未知")+growth
                        + " · 生命 " + value(data, "health", "未知") + "/" + value(data, "maxHealth", "未知")
                        + " · 饱食 " + value(data, "food", "未知") + " · 魔力 " + mana,
                "认证：" + auth + "；" + activity + "；入门：" + (yes(data, "mainlineGraduated") ? "已毕业" : "未毕业或待核对")
                    +(combat.has("level")?"；升级还需"+value(combat,"xpToNext","未知")+"经验（"+switch(value(combat,"saveState","unavailable")){case "saved"->"已保存";case "pending"->"保存中";default->"保存异常，请勿重复领奖";}+"）":""),
                "下一步：" + command(data, "nextCommand", "/mycli progress"));
    }

    private static String status(JsonObject row) {
        String state = value(row, "status", value(row, "state", value(row, "stage", "")));
        return switch (state) {
            case "none" -> "未参与"; case "active", "running", "practicing", "in_progress" -> "进行中";
            case "ready_to_submit" -> "待交付"; case "needs_verification" -> "待主动验收";
            case "completed" -> "已完成"; case "not_enrolled" -> "未报名"; case "paused" -> "已暂停";
            case "training_summary" -> "自愿实练";
            case "failed" -> "未通过"; case "cancelled", "canceled" -> "已取消";
            default -> "以条件和回执为准";
        };
    }
    static List<String> progress(List<JsonObject> source, String filter, int page) {
        List<JsonObject> rows = new ArrayList<>();
        List<JsonObject> training = source.stream().filter(row -> value(row, "section", "").equals("training")).toList();
        boolean grouped = false;
        for (JsonObject row : source) {
            if (filter.equals("all") && value(row, "section", "").equals("training")) {
                if (grouped) continue;
                grouped = true;
                JsonObject summary = new JsonObject(); summary.addProperty("title", "专项实练（独立于主线）"); summary.addProperty("status", "training_summary");
                summary.addProperty("stageTitle", "已完成 " + training.stream().filter(item -> yes(item, "done")).count() + "/" + training.size());
                summary.addProperty("nextCommand", "/mycli progress training"); rows.add(summary);
            } else rows.add(row);
        }
        List<String> lines = new ArrayList<>();
        int pages = pages(rows.size(), page); lines.add("[我的进度] " + page + "/" + pages + "；主线、专项、委托分别验收。");
        for (JsonObject row : rows.subList((page - 1) * PAGE_SIZE, Math.min(page * PAGE_SIZE, rows.size()))) {
            if (value(row,"reason", "").equals("observer")) { lines.add("观战账号不参加任务；请在对应生存角色查询进度。"); continue; }
            String label = value(row, "section", "").equals("main") ? (yes(row, "graduated") ? "已毕业" : "未毕业")
                    : row.has("done") ? (yes(row, "done") ? "已完成" : status(row)) : status(row);
            String title = shortText(value(row, "title", value(row, "kind", "当前记录")), 40);
            String stage = shortText(value(row, "stageTitle", value(row, "activeId", "")), 48);
            lines.add(title + "：" + label + (stage.isEmpty() ? "" : " · " + stage));
            if (row.has("missingConditions") && row.get("missingConditions").isJsonArray() && !row.getAsJsonArray("missingConditions").isEmpty()) {
                JsonArray missing = row.getAsJsonArray("missingConditions");
                lines.add("还缺：" + shortText(missing.get(0).getAsString(), 96) + (missing.size() > 1 ? "（另有 " + (missing.size() - 1) + " 项，按下一步查）" : ""));
            }
            lines.add("下一步：" + command(row, "nextCommand", "/mycli progress " + filter));
        }
        if (page < pages) lines.add("下一页：/mycli progress " + filter + " " + (page + 1));
        return List.copyOf(lines);
    }

    static List<String> skills(List<JsonObject> rows, String filter, int page) {
        int pages = pages(rows.size(), page); List<String> lines = new ArrayList<>();
        lines.add("[技能状态] " + page + "/" + pages + "，共 " + rows.size() + " 项；查询不学习、不施法。");
        for (JsonObject row : rows.subList((page - 1) * PAGE_SIZE, Math.min(page * PAGE_SIZE, rows.size()))) {
            String cooldown = value(row, "cooldownRemainingMs", "");
            String reason = switch (value(row, "reason", "")) {
                case "not_learned" -> "未学会"; case "not_prepared" -> "未准备"; case "cooldown" -> "冷却中";
                case "insufficient_mana" -> "魔力不足"; case "downed" -> "倒地"; case "survival_required" -> "需存活的生存角色";
                case "ready" -> "条件就绪"; case "target_or_context_not_checked" -> "仍需核对目标或环境";
                case "observation_incomplete", "data_unavailable" -> "读数不全，先核对";
                default -> "条件未确认；用 skills info 查明";
            };
            lines.add(value(row, "id", "未知") + "（" + shortText(value(row, "name", ""), 24) + "）等级 " + value(row, "level", "未知")
                    + " · 耗魔 " + value(row, "manaCost", "未知") + " · 冷却 " + (cooldown.isEmpty() ? "未知" : cooldown + "ms") + " · " + reason);
        }
        lines.add("详情：/mycli skills info <ID>；施放：/mycli cast <ID>（按目标、资格和资源检查）。");
        if (page < pages) lines.add("下一页：/mycli skills status " + filter + " " + (page + 1));
        return List.copyOf(lines);
    }
    private static int pages(int total, int page) {
        int pages = Math.max(1, (total + PAGE_SIZE - 1) / PAGE_SIZE);
        if (page < 1 || page > pages) throw new IllegalArgumentException("页码范围 1–" + pages);
        return pages;
    }
}
