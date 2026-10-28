package io.vortexcore.combat;
import java.util.List;

/** A monster-only spell must not fall back to a location and report a hit on empty air. */
public final class NativeCastTargets {
    private NativeCastTargets(){}
    public static void requireEntityWhenMonsterOnly(List<?> targeters){
        if(!targeters.isEmpty()&&targeters.stream().allMatch(t->t.getClass().getName().equals("io.vortexcore.rpg.SpellbookService$NearbyMonsterTargeter")))
            throw new IllegalStateException("[no_valid_target] 范围内没有符合条件的敌对目标");
    }
}
