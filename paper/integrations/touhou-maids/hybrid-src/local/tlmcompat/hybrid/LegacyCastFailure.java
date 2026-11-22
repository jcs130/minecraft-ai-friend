package local.tlmcompat.hybrid;

import com.google.gson.JsonObject;

/**
 * Pure, auditable classification of a legacy companion cast failure.
 *
 * <p>The original private companion magic layer ({@code NativeMaidMagicSupport.cast}) deducts mana
 * and sets cooldowns <em>before</em> applying effects, and may throw mid-cast. Historically such an
 * exception escaped to a generic catch that wrote a reason-only {@code unknown} receipt with no
 * state and no log. The unified host could never reconcile that receipt, so it froze the maid's
 * decision and speech loop forever, silently.
 *
 * <p>This helper turns that failure into evidence without ever manufacturing success:
 * <ul>
 *   <li>Threw <b>before</b> mana was committed: provably no mana spent and no effect applied. The
 *       receipt settles {@code rejected} (terminal) carrying the proof, so the host reconciles and
 *       resumes. No replay.</li>
 *   <li>Threw <b>after</b> mana was committed: effects may have partially applied and cannot be
 *       proven either way. The receipt stays {@code unknown} (nonterminal) but now carries the mana
 *       delta, the exception and an explicit {@code effectsUnproven} marker for manual audit. It is
 *       never rewritten as a no-effect rejection, and never replayed.</li>
 * </ul>
 *
 * <p>Self-contained (Gson only) so the actual production decision is exercised in isolation. The
 * heavy Bukkit/Vortex callers delegate here; the committed flag itself is bookkeeping inside
 * {@code NativeMaidMagicSupport.cast} and never changes casting mechanics or the guard-tick path.
 */
final class LegacyCastFailure {
    private LegacyCastFailure() {}

    /** Build the failure observation. {@code committed} is whether mana was deducted before the throw. */
    static JsonObject evidence(String spell, boolean committed, double manaBefore, double manaAfter, Throwable failure) {
        var observation = new JsonObject();
        observation.addProperty("spellId", spell);
        observation.addProperty("manaBefore", manaBefore);
        observation.addProperty("manaRemaining", manaAfter);
        observation.addProperty("exception", failure.getClass().getName() + ": " + failure.getMessage());
        if (committed) {
            observation.addProperty("state", "rpg_cast_exception_after_mana");
            observation.addProperty("error", "rpg_cast_exception_after_mana");
            // No successful effect is claimed; the true outcome is unproven and must stay unknown.
            observation.addProperty("effectsApplied", false);
            observation.addProperty("effectsUnproven", true);
            observation.addProperty("manaDeducted", true);
            observation.addProperty("message", "施法在扣除魔力后异常中断，效果是否生效不可证明；保留原编号待审计，不重放。");
        } else {
            observation.addProperty("state", "rpg_cast_failed_before_mana");
            observation.addProperty("error", "rpg_cast_failed_before_mana");
            observation.addProperty("effectsApplied", false);
            observation.addProperty("manaDeducted", false);
            observation.addProperty("message", "施法在扣除魔力前异常中断，可证明未消耗魔力、未产生效果。");
        }
        return observation;
    }

    /**
     * Map a legacy cast observation to the bridge receipt status. An unproven post-mana failure stays
     * {@code unknown}; a provable no-effect failure is {@code rejected}; a landed effect is {@code completed}.
     */
    static String status(JsonObject result) {
        boolean unproven = result.has("effectsUnproven") && result.get("effectsUnproven").getAsBoolean();
        if (unproven) return "unknown";
        return result.get("effectsApplied").getAsBoolean() ? "completed" : "rejected";
    }
}