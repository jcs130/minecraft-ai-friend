package local.tlmcompat.hybrid;

import java.util.Set;
import static local.tlmcompat.hybrid.MaidGuardDecision.Mode.*;

/** Exercises the production typed-choice parser and the PCM path before the Opus encoder. */
public final class MaidGuardDecisionFixture {
    public static void main(String[] args) {
        var choices = Set.of(MELEE, MAGIC);
        var good = "{\"answers\":{\"mode\":{\"type\":\"choice\",\"choice\":\"magic\",\"confidence\":0.6,\"probabilities\":{\"melee\":0.2,\"magic\":0.8}}}}";
        check(MaidGuardDecision.parse(good, choices).choice() == MAGIC, "accept above-chance confidence");
        check(MaidGuardDecision.parse(good.replace("0.6", "0.8"), choices).choice() == MAGIC, "accept raw confidence");
        check(MaidGuardDecision.parse(good.replace("\"choice\":\"magic\"", "\"choice\":\"ranged\""), choices).choice() == null, "unavailable action");
        check(MaidGuardDecision.parse(good.replace("0.2", "0.4"), choices).choice() == null, "invalid probability sum");
        check(MaidGuardDecision.parse(good.replace("0.2", "\"0.2\""), choices).choice() == null, "typed probabilities");
        check(MaidGuardDecision.parse(good.replace("0.2", "0.5").replace("0.8", "0.5").replace("0.6", "0"), choices).status().equals("ambiguous"), "ties abstain");
        check(MaidGuardDecision.parse(good.replace("\"choice\":\"magic\"", "\"choice\":\"melee\""), choices).choice() == null, "non-top choice");
        check(MaidGuardDecision.parse(good.replace("0.6", "0.4"), choices).choice() == null, "inconsistent confidence");
        check(MaidGuardDecision.parse(good, Set.of(MAGIC)).choice() == null, "one option does not require scoring");
        check(MaidGuardDecision.parse(good + " ".repeat(9000), choices).choice() == null, "oversized response");

        var pcm = new short[]{1000, -1000, 0, Short.MAX_VALUE, Short.MIN_VALUE};
        var frame = new short[pcm.length];
        new MaidSpeechVolume(6).copy(pcm, 0, frame, frame.length);
        check(frame[0] == 1995 && frame[1] == -1995 && frame[2] == 0, "quiet samples gain six dB");
        check(frame[3] < Short.MAX_VALUE && frame[3] > 27000 && frame[3] == -frame[4], "peak limit leaves symmetric headroom");
        check(pcm[0] == 1000 && pcm[3] == Short.MAX_VALUE, "source audio is unchanged");
        new MaidSpeechVolume(0).copy(pcm, 1, frame, 4);
        check(frame[0] == -1000 && frame[3] == Short.MIN_VALUE, "zero gain copies exact PCM");
        try { new MaidSpeechVolume(Double.NaN); throw new AssertionError("invalid gain"); }
        catch (IllegalArgumentException expected) { }
        System.out.println("PASS 15 typed choice and PCM checks");
    }
    private static void check(boolean value, String name) {
        if (!value) throw new AssertionError(name);
    }
}
