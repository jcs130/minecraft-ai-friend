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
