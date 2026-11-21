package org.afuhome.agentfriend;

import java.util.random.RandomGenerator;

/** Village training rewards. Formal floor progression has its own reward catalogue. */
final class TrialRewardPolicy {
    private static final int REST_FLOOR = 7;
    private static final int BOSS_FLOOR = 10;
    private static final int FINAL_FLOOR = 15;

    enum Tier {
        NONE("none"), COMMON("common"), UNCOMMON("uncommon"),
        RARE("rare"), EXCELLENT("excellent"), LEGENDARY("legendary");

        final String id;
        Tier(String id) { this.id = id; }
    }

    record Rates(int common, int uncommon, int rare, int excellent, int legendary) {
        int gear() { return uncommon + rare + excellent + legendary; }
    }

    record Daily(int clears, int peakCoins, boolean itemsIssued, boolean legacyPaid) {
        static final Daily EMPTY = new Daily(0, 0, false, false);
        // An old game-day receipt has no run ID or trustworthy difficulty.
        static final Daily LEGACY_PAID = new Daily(1, 0, true, true);
    }

    record Payout(Daily next, boolean items, int coins, int introductoryCoins, String reason) { }

    static Payout payout(Daily prior, boolean firstClear, int gap, int baseCoins) {
        return payout(prior, firstClear, gap, baseCoins, false);
    }

    static boolean introductory(int bossClears, int summitClears) {
        return bossClears >= 0 && bossClears < 3 && summitClears == 0;
    }

    static int gap(int recommended, int played, boolean introductory) {
        return introductory ? 0 : Math.max(0, recommended - played);
    }

    static Payout payout(Daily prior, boolean firstClear, int gap, int baseCoins, boolean introductoryAward) {
        if (prior.legacyPaid()) return new Payout(prior, false, 0, 0, "daily_limit");
        if (!firstClear && gap >= 2) return new Payout(prior, false, 0, 0, "practice");
        int coins = gap == 0 ? baseCoins : Math.max(1, baseCoins * (gap == 1 ? 60 : 30) / 100);
        boolean items = !prior.itemsIssued() && (firstClear || gap == 0);
        if (coins == 0 && !items) return new Payout(prior, false, 0, 0, "practice");
        int increase = Math.max(0, coins - prior.peakCoins());
        int introductoryCoins = items && introductoryAward ? (baseCoins + 1) / 2 : 0;
        int reward = increase + (prior.clears() == 1 ? coins / 2 : 0) + introductoryCoins;
        Daily next = new Daily(Math.min(2, prior.clears() + 1), Math.max(prior.peakCoins(), coins),
                prior.itemsIssued() || items, false);
        String reason = items ? "daily_items" : increase > 0 && prior.clears() > 0 ? "difficulty_upgrade"
                : reward > 0 ? "coins_only" : "daily_limit";
        return new Payout(next, items, reward, introductoryCoins, reason);
    }

    /** Exact percentage points per clear eligible for rewards, before the difficulty penalty. */
    static Rates rates(int floor, int difficulty) {
        if (floor < 1 || floor > FINAL_FLOOR || difficulty < 0 || difficulty > 2)
            throw new IllegalArgumentException("loot_context_out_of_range");
        if (floor == REST_FLOOR) return new Rates(0, 0, 0, 0, 0);
        int common = Math.min(28, 13 + floor);
        if (difficulty == 0 || floor < 4) return new Rates(common, 0, 0, 0, 0);
        int uncommon = Math.min(11, 2 + floor / 2 + difficulty);
        int rare = Math.min(10, 2 + floor / 3 + difficulty);
        int excellent = floor < 8 ? 0 : 1 + (floor - 8) / 2 + difficulty - 1;
        int legendary = difficulty == 2 && floor >= 12 ? 1 + (floor - 12) / 2 : 0;
        return new Rates(common, uncommon, rare, excellent, legendary);
    }

    static Tier roll(int floor, int difficulty, int misses, RandomGenerator random) {
        Rates rates = rates(floor, difficulty);
        int draw = random.nextInt(100);
        if ((draw -= rates.legendary()) < 0) return Tier.LEGENDARY;
        if ((draw -= rates.excellent()) < 0) return Tier.EXCELLENT;
        if ((draw -= rates.rare()) < 0 || rates.rare() > 0 && misses >= pityAfter(difficulty)) return Tier.RARE;
        if ((draw -= rates.uncommon()) < 0) return Tier.UNCOMMON;
        return draw < rates.common() ? Tier.COMMON : Tier.NONE;
    }

    static int pityAfter(int difficulty) { return difficulty == 2 ? 8 : 10; }

    static boolean milestone(int floor, int difficulty, boolean firstClear) {
        return switch (floor) {
            case 6, BOSS_FLOOR -> firstClear || difficulty > 0;
            case 4, 5, 8, 9, 11, 12, 13, 14 -> firstClear;
            default -> false;
        };
    }

    static boolean aura(int floor, int difficulty) { return difficulty > 0 && floor >= 11; }

    static int affixCount(int floor,int difficulty){return difficulty==0?(floor<6?1:2):floor<11?2:difficulty==1?3:4;}
    static int affixLevel(int floor,int difficulty){return difficulty==0?(floor<6?1:2):floor<6?2:difficulty==1?3:4;}
    static int affixCount(int floor, int difficulty, String tier) {
        return "excellent".equals(tier) && difficulty > 0 ? Math.max(3, affixCount(floor, difficulty))
                : affixCount(floor, difficulty);
    }
    static int affixLevel(int floor, int difficulty, String tier) {
        return "legendary".equals(tier) && difficulty == 2 && floor >= 12 ? 5 : affixLevel(floor, difficulty);
    }
    private TrialRewardPolicy(){}
}
