package local.tlmcompat.hybrid;

public final class MaidCombatSpeechFixture {
    private static final long SECOND = 1_000_000_000L;
    private static int checks;

    private static void check(boolean ok, String label) {
        checks++;
        if (!ok) throw new AssertionError(label);
    }

    private static MaidCombatSpeech.Hit hit(String mob, String mode, float damage, double target,
                                           double partner, double self, boolean close) {
        return new MaidCombatSpeech.Hit("minecraft:overworld", "minecraft:" + mob, mode, damage, target, partner, self, close);
    }

    public static void main(String[] args) {
        var ordinary = hit("zombie", "MAGIC", 2, .8, 1, 1, false);
        var policy = new MaidCombatSpeech();
        check(policy.hit(0, hit("zombie","MAGIC",0,.8,1,1,false), true, false) == null, "blocked damage stays silent");
        check(policy.hit(0, hit("zombie","MAGIC",Float.NaN,.8,1,1,false), true, false) == null, "invalid damage stays silent");
        check(policy.hit(0, ordinary, false, false) == null, "no nearby spectator");
        check(policy.hit(0, ordinary, true, true) == null, "an existing reply takes priority");

        String opening = policy.hit(0, ordinary, true, false);
        check(opening != null && opening.contains("僵尸"), "actual target is named");
        check(!opening.contains("倒下") && MaidShortReply.text(opening).equals(opening), "one canonical sentence without a false kill");

        for (int time = 5; time <= 205; time += 5) {
            check(policy.hit(time * SECOND, ordinary, true, false) == null, "unchanged fight stays quiet");
        }

        var other = hit("pillager", "RANGED", 3, .8, 1, 1, true);
        String change = policy.hit(210 * SECOND, other, true, false);
        check(change.contains("掠夺者") && !change.equals(opening), "new target and close distance alter the line");

        var weak = hit("pillager", "RANGED", 3, .15, 1, 1, true);
        check(policy.hit(235 * SECOND, weak, true, false) == null, "every scene shares one speech gap");
        String low = policy.hit(260 * SECOND, weak, true, false);
        check(low.contains("没剩多少血") && !low.contains("倒下"), "wounded creature stays alive");
        check(policy.hit(310 * SECOND, weak, true, false) == null, "same tactical cue is suppressed");
        String down = policy.hit(320 * SECOND, hit("pillager", "RANGED", 3, 0, 1, 1, true), true, false);
        check(down.contains("倒下") && down.contains("掠夺者"), "only observed zero health permits collapse");
        check(policy.hit(370 * SECOND, hit("pillager", "RANGED", 3, 0, 1, 1, true), true, false) == null,
            "new engagement still limits identical subjects");

        var ally = new MaidCombatSpeech();
        String warn = ally.hit(0, hit("witch", "RANGED", 3, .7, .35, .5, false), true, false);
        check(warn.contains("你的血线") && warn.contains("女巫"), "nearby partner in danger changes the topic");
        check(ally.hit(60 * SECOND, hit("zombie", "RANGED", 3, .7, .34, .5, false), true, false) == null,
            "new enemy does not repeat the same partner health warning");
        String retreat = ally.hit(70 * SECOND, hit("zombie", "RANGED", 3, .7, .9, .31, false), true, false);
        check(retreat.contains("退路"), "maid health has its own cue");
        var unknown = new MaidCombatSpeech();
        String generic = unknown.hit(0, hit("custom_target", "unknown", 1, .8, Double.NaN, .9, false), true, false);
        check(generic.contains("怪物") && !generic.contains("血线") && !generic.contains("custom_target"), "unknown NPC or type stays generic");

        var tactics = new MaidCombatSpeech();
        tactics.hit(0, ordinary, true, false);
        for (int time = 10; time < 50; time += 10) tactics.hit(time * SECOND, ordinary, true, false);
        String switched = tactics.hit(50 * SECOND, hit("zombie", "RANGED", 3, .7, 1, 1, false), true, false);
        check(switched.contains("远程"), "confirmed changed mode has a different contextual line");

        check(MaidCombatSpeech.fresh(0, 12 * SECOND), "bounded scene lifetime");
        check(!MaidCombatSpeech.fresh(0, 13 * SECOND), "stale synthesis is discarded");
        check(MaidCombatSpeech.lowPriority("combat") && MaidCombatSpeech.lowPriority("ambient") && !MaidCombatSpeech.lowPriority("reply"),
            "direct replies keep their audio priority");
        System.out.println("PASS " + checks + " combat speech checks");
    }
}
