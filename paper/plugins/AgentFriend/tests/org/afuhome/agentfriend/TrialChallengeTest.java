package org.afuhome.agentfriend;

final class TrialChallengeTest {
    private static int checks;
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
        checks++;
    }
    public static void main(String[] args) {
        int[] floors = {0, 5, 6, 9, 10, 14, 15};
        for (int rank = 0; rank <= 5; rank++) {
            for (int floor : floors) {
                int expected = Math.max(rank / 2, floor >= 10 ? 2 : floor >= 6 ? 1 : 0);
                check(TrialChallenge.recommended(rank, floor) == expected, "personal rank and milestones");
            }
        }
        for (int floor : floors) {
            check(TrialChallenge.tier(0, floor) == 0, "normal always offers an ordinary fight");
            check(TrialChallenge.tier(1, floor) == (floor >= 10 ? 1 : 0), "adventure capped at one");
            check(TrialChallenge.tier(2, floor) == (floor < 10 ? 0 : floor < 15 ? 1 : 2), "apocalypse");
        }
        for (int floor = 1; floor <= 15; floor++) {
            check(TrialChallenge.tactic(floor, 0) == TrialChallenge.Tactic.NONE, "old runs and first-time groups");
            for (int tier = 1; tier <= 2; tier++) {
                var expected = switch (floor) {
                    case 2, 6, 10, 15 -> TrialChallenge.Tactic.WARD;
                    case 5, 9, 12, 14 -> TrialChallenge.Tactic.RALLY;
                    default -> TrialChallenge.Tactic.NONE;
                };
                check(TrialChallenge.tactic(floor, tier) == expected, "tactic for floor " + floor);
            }
        }
        System.out.println("TrialChallengeTest: " + checks + " passed");
    }
}
