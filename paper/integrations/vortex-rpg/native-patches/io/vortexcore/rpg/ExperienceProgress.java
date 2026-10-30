package io.vortexcore.rpg;

import io.vortexcore.math.ExperienceCurve;
import io.vortexcore.player.UnifiedPlayer;
import java.util.LinkedHashMap;
import java.util.Map;

/** A read-only projection of the native curve; never awards XP or changes a profile. */
public record ExperienceProgress(long total, long progress, long required, long remaining, boolean maxLevel) {
    public static ExperienceProgress of(UnifiedPlayer profile, ExperienceCurve curve) {
        long total = Math.max(0, profile.experience());
        if (profile.level() >= ExperienceCurve.MAX_LEVEL) return new ExperienceProgress(total, 0, 0, 0, true);
        long start = curve.totalExperienceToReach(profile.level());
        long end = curve.totalExperienceToReach(profile.level() + 1);
        long required = Math.max(1, end - start);
        long progress = Math.max(0, Math.min(required, total - start));
        return new ExperienceProgress(total, progress, required, Math.max(0, end - total), false);
    }

    public String display() { return maxLevel ? "已满级" : progress + "/" + required; }

    public Map<String, Object> fields() {
        var out = new LinkedHashMap<String, Object>();
        // Keep the original ABI: xp is cumulative; nextLevelXp is remaining XP.
        out.put("xp", total); out.put("nextLevelXp", remaining);
        out.put("xpTotal", total); out.put("xpProgress", progress);
        out.put("xpRequired", required); out.put("xpRemaining", remaining); out.put("isMaxLevel", maxLevel);
        return out;
    }
}
