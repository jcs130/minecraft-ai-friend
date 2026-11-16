package org.afuhome.agentfriend;

import java.util.HashSet;
import java.util.List;
import java.util.Random;

public final class WeaponSkillRollsTest {
    private static void expect(boolean result, String message) {
        if (!result) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        var common = new HashSet<WeaponSkillRolls.Binding>();
        var rng = new Random(1211L);
        for (int i = 0; i < 12000; i++) common.add(WeaponSkillRolls.roll(List.of(), null, rng));
        expect(common.size() == 270, "all 270 common combinations appear");
        for (var binding : common) {
            expect(binding.equals(WeaponSkillRolls.decode(binding.encode())), "IDs round-trip");
            expect(!binding.equals(WeaponSkillRolls.roll(List.of(), binding, rng)), "reroll changes the combination");
        }

        var learned = List.of("arcane_bolt", "ember_lance", "mend", "fortify", "travel", "give", "op Alex");
        var observed = new HashSet<String>();
        for (int i = 0; i < 3000; i++) {
            var binding = WeaponSkillRolls.roll(learned, null, rng);
            observed.add(binding.use());
            observed.add(binding.sneakUse());
            expect(WeaponSkillRolls.ON_HIT.contains(binding.hit()), "automatic pool only");
        }
        expect(observed.containsAll(learned.subList(0, 4)), "learned class spells are reachable");
        expect(learned.subList(4, 7).stream().noneMatch(observed::contains), "no command text or menu effects");

        for (String malformed : List.of("", "home:starbolt:frostnova", "food:travel:starbolt", "food:starbolt:starbolt",
                "night:starbolt:/op Alex", "night:feather:blink:extra"))
            expect(WeaponSkillRolls.decode(malformed) == null, "bad binding rejected");
        expect(WeaponSkillRolls.rewardChance(5, "legendary") == 0, "starter floors excluded");
        expect(WeaponSkillRolls.rewardChance(6, "common") == 0, "ordinary bonus excluded");
        expect(WeaponSkillRolls.rewardChance(6, "rare") == 20, "rare weapon conditional roll");
        expect(WeaponSkillRolls.rewardChance(8, "excellent") == 50, "excellent weapon conditional roll");
        expect(WeaponSkillRolls.rewardChance(12, "legendary") == 100, "legendary weapon always carries spells");
        System.out.println("PASS 270 common combinations, class pool, duplicate rejection, storage and reward odds");
    }
}
