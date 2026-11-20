package org.afuhome.agentfriend;

/** The party chooses its base difficulty and mastery bonus once, when it enters. */
final class TrialChallenge {
    private TrialChallenge() { }

    static int recommended(int guildRank, int clearedFloor) {
        if (guildRank >= 4 || clearedFloor >= 10) return 2;
        return guildRank >= 2 || clearedFloor >= 6 ? 1 : 0;
    }

    static int tier(int difficulty, int weakestClear) {
        int mastery = weakestClear >= 15 ? 2 : weakestClear >= 10 ? 1 : 0;
        return Math.min(difficulty, mastery);
    }

    enum Tactic {
        NONE("", ""), WARD("护旗卫", "护旗卫在场时，其他怪物受到的直接攻击伤害减少三成；先击破护旗卫可解除守护。"),
        RALLY("集火号手", "号手在场时，其他怪物的攻击提高两成；利用掩体逼近号手可解除集火。");

        final String name, hint;
        Tactic(String name, String hint) { this.name = name; this.hint = hint; }
    }

    static Tactic tactic(int floor, int tier) {
        if (tier == 0) return Tactic.NONE;
        return switch (floor) {
            case 2, 6, 10, 15 -> Tactic.WARD;
            case 5, 9, 12, 14 -> Tactic.RALLY;
            default -> Tactic.NONE;
        };
    }
}
