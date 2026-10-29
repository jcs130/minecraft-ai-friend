package dev.qiandeng.maw.saoforge;

/** Native cast evidence only. An unrelated NBT write is not a started skill. */
final class CastEvidence {
    static String swordCooldownKey(int style, int skill) {
        return "cd" + style + "_" + skill;
    }
    static boolean started(int oldResource, int resource, int oldCooldown, int cooldown,
                           int oldActivity, int activity) {
        return resource < oldResource || cooldown > oldCooldown
            || activity > 0 && activity > oldActivity;
    }
    static String gate(boolean enabled, boolean alive, boolean spectator, boolean downed,
                       boolean profession, int role, int style, boolean busy, int cooldown) {
        if (!enabled) return "combat_disabled";
        if (!alive || spectator) return "body_dead_or_spectator";
        if (downed) return "body_downed";
        if (profession && role == 0) return "profession_required";
        if (!profession && style < 0) return "weapon_not_supported_for_sword_skill";
        if (busy) return "native_cast_busy";
        if (cooldown > 0) return "skill_cooldown";
        return null;
    }
}
