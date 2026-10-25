package org.afuhome.agentfriend;

import java.util.Set;

/** Withdraw offers, never the frozen contract or a player's earned progress. */
final class RetiredActivities {
    private static final Set<String> IDS = Set.of(
            "farmer_harvest", "harvest_home", "tm_field_cycle", "tm_vegetable_cycle");
    static boolean retired(String id) { return IDS.contains(id); }
    static boolean pausable(String id, boolean project, boolean once, boolean exploration) {
        return !project && (retired(id) || once && exploration);
    }
    static final String HINT = "农耕委托已撤下，不再新接；已接记录保留，可自愿收尾。新冒险：/mycli tasks list exploration；讨伐：/mycli tasks list combat。";
    private RetiredActivities() { }
}
