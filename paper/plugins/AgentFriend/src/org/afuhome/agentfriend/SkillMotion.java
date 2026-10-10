package org.afuhome.agentfriend;

/** Vanilla vertical drag/gravity estimate. Collision and actual client movement remain authoritative. */
final class SkillMotion {
    private SkillMotion() { }
    static double apex(double velocity) {
        double height = 0;
        for (int tick = 0; tick < 100 && velocity > 0; tick++) { height += velocity; velocity = (velocity - .08) * .98; }
        return height;
    }
    static double jumpVelocity(double height) {
        if (!Double.isFinite(height) || height < 6 || height > 16) throw new IllegalArgumentException("jump height");
        double low = .5, high = 2;
        for (int i = 0; i < 32; i++) { double mid = (low + high) / 2; if (apex(mid) < height) low = mid; else high = mid; }
        return high;
    }
}
