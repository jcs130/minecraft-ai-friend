package org.qiandengji.vortex;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Server ticks only. The game still decides whether each submitted strike actually hurts. */
final class SwordSequence {
    interface Body {
        String interruption();
        boolean inHurtInterval();
        Strike strike(boolean offHand);
        boolean visual(boolean offHand);
    }

    record Strike(double healthLost, double absorptionLost) {
        boolean applied() {
            return healthLost > 0 || absorptionLost > 0;
        }
    }

    private final int maxStrikes;
    private final int maxTicks;
    private final boolean alternating;
    private final List<Map<String, Object>> hits = new ArrayList<>();
    private int ticks;
    private int attempts;
    private int visualSwings;
    private int hurtWaitTicks;
    private String terminal;

    SwordSequence(int maxStrikes, int maxTicks, boolean alternating) {
        this.maxStrikes = maxStrikes;
        this.maxTicks = maxTicks;
        this.alternating = alternating;
    }

    boolean tick(Body body) {
        if (terminal != null) return true;
        if (++ticks > maxTicks) return interrupt("hurt_window_timeout");
        String interruption = body.interruption();
        if (interruption != null) return interrupt(interruption);
        if (body.inHurtInterval()) {
            hurtWaitTicks++;
            return false;
        }
        boolean offHand = alternating && attempts % 2 == 1;
        attempts++;
        Strike strike = body.strike(offHand);
        if (strike.applied()) hits.add(Map.of("attempt", attempts, "tick", ticks, "hand", offHand ? "offhand" : "mainhand",
                "healthLost", strike.healthLost(), "absorptionLost", strike.absorptionLost()));
        if (body.visual(offHand)) visualSwings++;
        if (!strike.applied()) return interrupt("damage_not_applied");
        if (attempts == maxStrikes) return interrupt("completed");
        return false;
    }

    boolean interrupt(String reason) {
        if (terminal == null) terminal = reason;
        return true;
    }

    String terminal() { return terminal; }
    int attempts() { return attempts; }
    int visualSwings() { return visualSwings; }
    int hurtWaitTicks() { return hurtWaitTicks; }
    List<Map<String, Object>> hits() { return List.copyOf(hits); }
}
