package org.afuhome.agentfriend;

import java.util.EnumMap;
import java.util.Map;
import java.util.random.RandomGenerator;

public final class TrialRewardPolicyTest {
    private static int checks;

    private static void require(boolean valid, String message) {
        checks++;
        if (!valid) throw new AssertionError(message);
    }

    private static Map<TrialRewardPolicy.Tier, Integer> sample(int floor, int difficulty, int misses) {
        var counts = new EnumMap<TrialRewardPolicy.Tier, Integer>(TrialRewardPolicy.Tier.class);
        for (int i = 0; i < 100; i++) {
            int draw = i;
            RandomGenerator random = new RandomGenerator() {
                @Override public long nextLong() { throw new AssertionError("unexpected RNG call"); }
                @Override public int nextInt(int bound) {
                    require(bound == 100, "expected one percentage draw");
                    return draw;
                }
            };
            counts.merge(TrialRewardPolicy.roll(floor, difficulty, misses, random), 1, Integer::sum);
        }
        return counts;
    }

    public static void main(String[] args) {
        for (int difficulty = 0; difficulty <= 2; difficulty++) {
            var previous = TrialRewardPolicy.rates(1, difficulty);
            for (int floor = 1; floor <= 15; floor++) {
                var rates = TrialRewardPolicy.rates(floor, difficulty);
                var fresh = sample(floor, difficulty, 0);
                var pity = sample(floor, difficulty, TrialRewardPolicy.pityAfter(difficulty));
                int[] expected = {100 - rates.common() - rates.gear(), rates.common(), rates.uncommon(),
                        rates.rare(), rates.excellent(), rates.legendary()};
                for (var tier : TrialRewardPolicy.Tier.values())
                    require(fresh.getOrDefault(tier, 0) == expected[tier.ordinal()], "reported rates must match draws");
                require(expected[0] >= 44, "too many extra drops");
                require(pity.getOrDefault(TrialRewardPolicy.Tier.EXCELLENT, 0) == rates.excellent()
                        && pity.getOrDefault(TrialRewardPolicy.Tier.LEGENDARY, 0) == rates.legendary(),
                        "pity must not amplify excellent or legendary rolls");
                if (rates.rare() == 0) require(fresh.equals(pity), "ineligible clear must ignore pity");
                else require(pity.getOrDefault(TrialRewardPolicy.Tier.RARE, 0)
                        == 100 - rates.excellent() - rates.legendary(), "pity must yield actual premium loot");
                if (difficulty == 0 || floor <= 3 || floor == 7)
                    require(rates.gear() == 0, "gear on an ineligible floor or difficulty");
                if (floor < 8) require(rates.excellent() == 0, "early excellent");
                if (floor < 12 || difficulty != 2) require(rates.legendary() == 0, "early legendary");
                if (difficulty == 0 || floor < 11) require(!TrialRewardPolicy.aura(floor, difficulty), "early aura");
                if (floor != 7) {
                    require(rates.gear() >= previous.gear() && rates.excellent() >= previous.excellent()
                            && rates.legendary() >= previous.legendary(), "deeper eligible floors must improve odds");
                    previous = rates;
                }
                require(TrialRewardPolicy.milestone(floor, difficulty, false)
                        == (difficulty > 0 && (floor == 6 || floor == 10)), "repeat milestone must use the rotation floors");
                require(TrialRewardPolicy.milestone(floor, difficulty, true)
                        == (floor >= 4 && floor != 7 && floor != 15), "first clear milestone set changed");
            }
        }
        require(TrialRewardPolicy.rates(15, 1).excellent() == 4, "adventure summit excellent");
        require(TrialRewardPolicy.rates(15, 2).excellent() == 5, "apocalypse summit excellent");
        require(TrialRewardPolicy.rates(15, 2).legendary() == 2, "apocalypse summit legendary");
        System.out.println("PASS " + checks + " reward distribution and progression checks");
    }
}
