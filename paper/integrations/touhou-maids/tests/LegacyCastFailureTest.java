package local.tlmcompat.hybrid;

import com.google.gson.*;

/**
 * Legacy companion cast failure classification. Exercises the actual production {@link LegacyCastFailure}
 * decision (Gson only, no server / network). The invariant: a provable pre-mana failure settles rejected
 * so the host resumes; an unproven post-mana failure stays unknown but auditable; success is never claimed.
 */
public final class LegacyCastFailureTest {
    private static int checks;
    private static void check(boolean condition, String title) { if (!condition) throw new AssertionError(title); checks++; }
    private static JsonObject obs(boolean effectsApplied) { var o = new JsonObject(); o.addProperty("spellId", "astral_convergence"); o.addProperty("effectsApplied", effectsApplied); return o; }

    public static void main(String[] args) {
        var boom = new IllegalStateException("vortex nexus bus unavailable");
        // Provable failure: threw before mana was committed -> no mana spent, no effect.
        var before = LegacyCastFailure.evidence("astral_convergence", false, 40.0, 40.0, boom);
        check(before.get("state").getAsString().equals("rpg_cast_failed_before_mana"), "pre-mana failure names a provable no-effect state");
        check(before.get("error").getAsString().equals(before.get("state").getAsString()), "error mirrors state for refusal reconciliation");
        check(!before.get("effectsApplied").getAsBoolean(), "pre-mana failure claims no effect");
        check(!before.get("manaDeducted").getAsBoolean(), "pre-mana failure proves mana was not deducted");
        check(!before.has("effectsUnproven"), "provable pre-mana failure is NOT marked unproven");
        check(before.get("spellId").getAsString().equals("astral_convergence"), "evidence keeps the original spell");
        check(before.get("manaBefore").getAsDouble() == 40.0 && before.get("manaRemaining").getAsDouble() == 40.0, "unchanged mana is recorded as proof");
        check(before.get("exception").getAsString().contains("IllegalStateException") && before.get("exception").getAsString().contains("vortex nexus bus unavailable"), "exception class and message are preserved for audit");
        check(LegacyCastFailure.status(before).equals("rejected"), "provable pre-mana failure settles rejected (terminal, host resumes)");

        // Unproven failure: threw after mana was committed -> effects may have partially applied.
        var after = LegacyCastFailure.evidence("astral_convergence", true, 40.0, 25.0, boom);
        check(after.get("state").getAsString().equals("rpg_cast_exception_after_mana"), "post-mana failure names an unproven state");
        check(after.get("error").getAsString().equals(after.get("state").getAsString()), "error mirrors state");
        check(!after.get("effectsApplied").getAsBoolean(), "post-mana failure never claims a successful effect");
        check(after.get("effectsUnproven").getAsBoolean(), "post-mana failure is explicitly unproven");
        check(after.get("manaDeducted").getAsBoolean(), "post-mana failure records that mana was spent");
        check(after.get("manaBefore").getAsDouble() == 40.0 && after.get("manaRemaining").getAsDouble() == 25.0, "mana delta is recorded as audit evidence");
        check(LegacyCastFailure.status(after).equals("unknown"), "unproven post-mana failure stays unknown (never a no-effect rejection)");

        // The classification never manufactures success, regardless of mana delta.
        check(!before.get("effectsApplied").getAsBoolean() && !after.get("effectsApplied").getAsBoolean(), "no failure path ever claims effectsApplied=true");
        var zeroCost = LegacyCastFailure.evidence("spark", true, 10.0, 10.0, boom);
        check(LegacyCastFailure.status(zeroCost).equals("unknown"), "a zero-cost spell that threw after commit is still unproven, not a provable no-effect");
        check(zeroCost.get("manaDeducted").getAsBoolean(), "committed flag, not the mana delta, decides provability");

        // Normal (non-exception) legacy observations keep their existing transport.
        check(LegacyCastFailure.status(obs(true)).equals("completed"), "a landed effect still maps to completed");
        check(LegacyCastFailure.status(obs(false)).equals("rejected"), "a normal refusal still maps to rejected");
        var explicitProven = obs(false); explicitProven.addProperty("effectsUnproven", false);
        check(LegacyCastFailure.status(explicitProven).equals("rejected"), "effectsUnproven=false does not force unknown");
        var unprovenNoEffect = obs(false); unprovenNoEffect.addProperty("effectsUnproven", true);
        check(LegacyCastFailure.status(unprovenNoEffect).equals("unknown"), "effectsUnproven=true forces unknown even with effectsApplied=false");

        // A null exception message must not break evidence building.
        var nullMsg = LegacyCastFailure.evidence("spark", false, 5.0, 5.0, new RuntimeException());
        check(nullMsg.get("exception").getAsString().startsWith("java.lang.RuntimeException"), "null exception message is tolerated");
        check(LegacyCastFailure.status(nullMsg).equals("rejected"), "null-message pre-mana failure still settles rejected");

        System.out.println("Legacy cast failure classification: " + checks + " checks passed");
    }
}