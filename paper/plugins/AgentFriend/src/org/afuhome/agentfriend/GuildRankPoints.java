package org.afuhome.agentfriend;

import java.util.Collection;
import java.util.regex.Pattern;

/** Per-division progress from completed guild contracts. Lifetime fame remains independent. */
final class GuildRankPoints {
    private static final int[] TARGETS = {0, 4, 8, 12, 14, 18, 22, 24, 28, 32, 36, 40, 48, 54, 60, 68, 76, 84};
    private static final int[] BASE = {4, 6, 9, 12};
    private static final String[] TIERS = {"基础", "进阶", "高阶", "卓越"};
    private static final Pattern DATED_TEMPLATE = Pattern.compile("^db_[0-9]{8}_(.+)$");
    static final int LAST_GRADE = TARGETS.length - 1;

    private GuildRankPoints() {}

    static int target(int toGrade) { return TARGETS[toGrade]; }

    // Market contracts, including destination repeats and multi-step surveys, already use tm_<task key>.
    static String template(String id) {
        var dated = DATED_TEMPLATE.matcher(id);
        return dated.matches() ? "db_" + dated.group(1) : id;
    }

    static int legacyCredit(int grade, Collection<String> delivered) {
        if (grade >= LAST_GRADE) return 0;
        int cap = target(grade + 1);
        return Math.min(cap, 2 * (int) delivered.stream().map(GuildRankPoints::template).distinct().limit(cap).count());
    }

    record Award(int fromGrade, int before, int target, int gain, int priorUses, String reason, String tier, String explanation) {
        int after() { return before + gain; }
    }

    static Award preview(int grade, int balance, int priorUses, int fame) {
        return preview(grade, balance, priorUses, fame, false);
    }

    static Award preview(int grade, int balance, int priorUses, int fame, boolean deliveryOnly) {
        int tier = deliveryOnly ? 0 : fame >= 24 ? 3 : fame >= 15 ? 2 : fame >= 8 ? 1 : 0;
        if (grade == LAST_GRADE) return new Award(grade, 0, 0, 0, 0, "max_grade", TIERS[tier], "已达最高段位");
        int cap = target(grade + 1);
        int before = Math.clamp(balance, 0, cap);
        int uses = Math.clamp(priorUses, 0, 2);
        int gap = Math.max(0, grade / 6 - tier);
        int scaled = BASE[tier];
        String reason = "full", explanation = "本阶首次";
        if (before == cap) { scaled = 0; reason = "points_ready"; explanation = "本阶积分已满"; }
        else if (gap >= 2) { scaled = 0; reason = "below_range"; explanation = "低于本段推荐两档"; }
        else if (uses >= 2) { scaled = 0; reason = "template_limit"; explanation = "本阶同类已交付两次"; }
        else {
            if (gap == 1) { scaled /= 2; reason = "below_tier"; explanation = "低一档折半"; }
            if (uses == 1) {
                scaled /= 2;
                reason = gap == 1 ? "below_tier_repeat" : "repeat";
                explanation = gap == 1 ? "低一档、同类二次，各折半" : "本阶同类二次折半";
            }
            if (scaled > cap - before) explanation += "，按本阶剩余空额结算";
        }
        if (deliveryOnly) explanation += "，纯物资交付按基础档";
        return new Award(grade, before, cap, Math.min(cap - before, scaled), uses, reason, TIERS[tier], explanation);
    }
}
