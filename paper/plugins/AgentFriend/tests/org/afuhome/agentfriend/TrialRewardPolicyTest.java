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
        dailyRewards();
        introductoryRewards();
        require(!TrialRewardPolicy.summitUpgrade(14, 2, -1, true), "only the summit awards the guaranteed cache");
        require(!TrialRewardPolicy.summitUpgrade(15, 1, -1, false), "practice does not award the cache");
        require(TrialRewardPolicy.summitUpgrade(15, 0, -1, true), "first qualified summit awards a cache");
        require(!TrialRewardPolicy.summitUpgrade(15, 0, 0, true), "same grade never duplicates a cache");
        require(TrialRewardPolicy.summitUpgrade(15, 2, 1, true), "qualified higher difficulty awards an upgrade");
        require(!TrialRewardPolicy.summitUpgrade(15, 1, 2, true), "clearing below a rewarded grade grants no cache");
        require(TrialRewardPolicy.summitAchievement(-1, 10).isEmpty(), "a pre-summit clear does not unlock the title");
        require(TrialRewardPolicy.summitAchievement(-1, 15).equals("试炼登顶者"), "historical summit retains recognition");
        require(TrialRewardPolicy.summitAchievement(1, 15).equals("踏云征服者"), "adventure award title");
        require(TrialRewardPolicy.summitAchievement(2, 15).equals("星灯誓约者"), "apocalypse award title");
        String today="2026-11-20", yesterday="2026-11-19";
        require(SiteRewardPolicy.status("run2",today,null,"run1",yesterday).equals("eligible"), "new day fresh site");
        require(SiteRewardPolicy.status("run2",today,null,"run1",today).equals("daily_limit"), "one expedition award per site/day");
        require(SiteRewardPolicy.status("run1",today,"run1",null,null).equals("ready"), "restart retains original receipt");
        require(SiteRewardPolicy.status("run1",today,null,"run1",yesterday).equals("claimed"), "claimed run replay next day");
        require(SiteRewardPolicy.status("run2",today,"run1",null,null).equals("previous_reward_pending"), "preserve earlier pending reward");
        require(SiteRewardPolicy.relicEligible(true,false,false,false), "verified final room once grants relic");
        require(!SiteRewardPolicy.relicEligible(false,false,false,false), "earlier room alone is not final credit");
        require(!SiteRewardPolicy.relicEligible(true,true,false,false), "collected relic cannot be granted again");
        require(!SiteRewardPolicy.relicEligible(true,false,true,false), "older pending receipt is always preserved");
        require(!SiteRewardPolicy.relicEligible(true,false,false,true), "original run cannot be replayed");
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

    private static void dailyRewards() {
        var empty = TrialRewardPolicy.Daily.EMPTY;
        var first = TrialRewardPolicy.payout(empty, true, 2, 1);
        require(first.items() && first.coins() == 1, "historical first clear keeps supplies and progression");
        var training = TrialRewardPolicy.payout(empty, false, 2, 1);
        require(training.next().equals(empty) && !training.items() && training.coins() == 0,
                "practice cannot consume another difficulty's daily award");
        var low = TrialRewardPolicy.payout(empty, false, 1, 3);
        require(!low.items() && low.coins() == 1 && low.next().clears() == 1, "below recommendation earns only discounted gold");
        var upgrade = TrialRewardPolicy.payout(low.next(), false, 0, 7);
        require(upgrade.items() && upgrade.coins() == 9, "upgrade pays six gold difference plus three second-clear gold");
        var third = TrialRewardPolicy.payout(upgrade.next(), false, 0, 7);
        require(!third.items() && third.coins() == 0, "ordinary third repeat earns nothing");
        var late = TrialRewardPolicy.payout(third.next(), false, 0, 14);
        require(!late.items() && late.coins() == 7, "later upgrade only raises the full-clear entitlement");
        for (int base = 1; base <= 14; base++) {
            var a = TrialRewardPolicy.payout(empty, false, 0, base);
            var b = TrialRewardPolicy.payout(a.next(), false, 0, base);
            var c = TrialRewardPolicy.payout(b.next(), false, 0, base);
            require(a.items() && a.coins() == base, "first matched clear issues one loot roll and full gold");
            require(!b.items() && b.coins() == base / 2, "second matched clear issues only half gold rounded down");
            require(!c.items() && c.coins() == 0 && c.next().equals(b.next()), "later clears keep capped entitlement");
            var migrated = TrialRewardPolicy.payout(TrialRewardPolicy.Daily.LEGACY_PAID, false, 0, base);
            require(migrated.coins() == 0 && !migrated.items(), "legacy paid floor cannot be replayed");
        }
        // Four clears at different tiers in arbitrary order. The entire day is bounded
        // by one physical package and 1.5 times the hardest challenge actually completed.
        for (int a : new int[]{1, 3, 7}) for (int b : new int[]{1, 3, 7})
            for (int c : new int[]{1, 3, 7}) for (int d : new int[]{1, 3, 7}) {
                var state = empty;
                int coins = 0, itemAwards = 0, hardest = 0;
                for (int base : new int[]{a, b, c, d}) {
                    var result = TrialRewardPolicy.payout(state, false, 0, base);
                    state = result.next();
                    coins += result.coins();
                    if (result.items()) itemAwards++;
                    hardest = Math.max(hardest, base);
                }
                require(itemAwards == 1 && coins >= hardest && coins <= hardest + hardest / 2,
                        "gear or coins inflated by difficulty switching");
            }
    }

    private static void introductoryRewards() {
        var empty = TrialRewardPolicy.Daily.EMPTY;
        boolean newcomer = TrialRewardPolicy.introductory(2, 0);
        boolean veteran = TrialRewardPolicy.introductory(96, 42);
        require(newcomer && !veteran && !TrialRewardPolicy.introductory(3, 0)
                && !TrialRewardPolicy.introductory(0, 1), "personal boss history determines eligibility");
        int newcomerGap = TrialRewardPolicy.gap(2, 1, newcomer);
        int veteranGap = TrialRewardPolicy.gap(2, 1, veteran);
        var novice = TrialRewardPolicy.payout(empty, false, newcomerGap, 3, true);
        var experienced = TrialRewardPolicy.payout(empty, false, veteranGap, 3, false);
        require(novice.items() && novice.coins() == 5 && novice.introductoryCoins() == 2,
                "a player in introductory protection receives full Adventure loot plus the one-time award");
        require(!experienced.items() && experienced.coins() == 1,
                "a veteran sharing the same monsters still receives the personal below-target reward");
        require(novice.next().peakCoins() == 3, "one-time gold must not inflate the daily difficulty watermark");
        var second = TrialRewardPolicy.payout(novice.next(), false, newcomerGap, 3, true);
        require(!second.items() && second.coins() == 1 && second.introductoryCoins() == 0,
                "even an unconsumed award flag cannot create another same-day package or bonus");
        var nextDay = TrialRewardPolicy.payout(empty, false, newcomerGap, 3, false);
        require(nextDay.items() && nextDay.coins() == 3 && nextDay.introductoryCoins() == 0,
                "a new day refreshes supplies, not the lifetime introductory award");
        var migration = TrialRewardPolicy.payout(TrialRewardPolicy.Daily.LEGACY_PAID, false, newcomerGap, 3, true);
        require(!migration.items() && migration.coins() == 0 && migration.introductoryCoins() == 0,
                "unknown older payouts retain the replay fence");
        var discounted = new TrialRewardPolicy.Daily(1, 1, false, false);
        var corrected = TrialRewardPolicy.payout(discounted, false, newcomerGap, 3, true);
        require(corrected.items() && corrected.coins() == 5 && corrected.next().peakCoins() == 3,
                "first new run can unlock missed same-day gear, ordinary gold difference and the lifetime bonus");
        var exhausted = TrialRewardPolicy.payout(corrected.next(), false, newcomerGap, 3, false);
        require(!exhausted.items() && exhausted.coins() == 0, "corrected daily state cannot duplicate loot");
        var upgrade = TrialRewardPolicy.payout(novice.next(), false, newcomerGap, 7, false);
        require(!upgrade.items() && upgrade.coins() == 7 && upgrade.introductoryCoins() == 0,
                "upgrading difficulty still only awards the ordinary difference plus second-clear share");
        var ordinary = TrialRewardPolicy.payout(empty, false, TrialRewardPolicy.gap(2, 0, newcomer), 1, true);
        require(ordinary.items() && ordinary.coins() == 2 && TrialRewardPolicy.rates(10, 0).gear() == 0,
                "normal remains a training item pool even for an eligible newcomer");
    }
}
