package org.qiandengji.vortex.tests;

import io.vortexcore.math.ExperienceCurve;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.ExperienceProgress;
import java.util.UUID;

public final class ExperienceProgressTest {
    static int checks;
    static void check(boolean ok, String label) { if (!ok) throw new AssertionError(label); checks++; }
    public static void main(String[] args) {
        var curve = ExperienceCurve.cubic(45, 120);
        var player = new UnifiedPlayer(UUID.randomUUID(), "GrowthFixture");
        player.setExperience(8353, curve);
        var view = ExperienceProgress.of(player, curve);
        check(player.level() == 5, "reported 8353 total belongs to level 5");
        check(view.progress() == 3373 && view.required() == 5745 && view.remaining() == 2372, "same-level numerator and denominator");
        check(view.total() == 8353 && player.experience() == 8353, "view does not spend or rewrite XP");
        check(view.fields().get("xp").equals(8353L) && view.fields().get("nextLevelXp").equals(2372L), "legacy wire meanings retained");
        player.setExperience(10724, curve);
        check(player.level() == 5 && ExperienceProgress.of(player, curve).remaining() == 1, "one XP before threshold");
        var up = player.grantExperience(1, curve);
        check(up.previousLevel() == 5 && up.newLevel() == 6 && up.levelsGained() == 1, "native threshold awards exactly one level");
        check(ExperienceProgress.of(player, curve).progress() == 0 && ExperienceProgress.of(player, curve).required() == 9840, "next level starts at zero");
        player.setExperience(8353, curve); up = player.grantExperience(50000, curve);
        check(up.levelsGained() > 1 && player.level() == curve.solveLevel(58353) && player.experience() == 58353, "native multi-level overflow retained");
        var custom = ExperienceCurve.cubic(8, 20); player.setExperience(8353, custom);
        view = ExperienceProgress.of(player, custom);
        check(view.remaining() == custom.totalExperienceToReach(player.level() + 1) - 8353, "uses supplied server curve rather than hardcoded thresholds");
        player.setExperience(curve.totalExperienceToReach(200), curve); view = ExperienceProgress.of(player, curve);
        check(player.level() == 200 && view.maxLevel() && view.remaining() == 0, "max level does not offer level 201");
        check(view.display().equals("已满级") && !view.display().contains("/0"), "no impossible full-level fraction");
        System.out.println("EXPERIENCE_PROGRESS checks=" + checks + " passed=true");
    }
}
