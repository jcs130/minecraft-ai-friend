package org.afuhome.agentfriend;

import java.util.Set;

/** Result evidence survives travel; only a continuous measurement needs suspension. */
final class ExamLifecyclePolicy {
    private ExamLifecyclePolicy() { }
    static boolean durable(String primitive) {
        return Set.of("contract_record", "native_lesson").contains(primitive);
    }
    static boolean resumable(String primitive, String state, String reason, long expiresAt, long now) {
        if(!state.equals("interrupted") || now>=expiresAt)return false;
        if(durable(primitive))return Set.of("teleport", "world_changed", "logout", "server_restart").contains(reason);
        return Set.of("flight_route", "leap_route").contains(primitive)
                && Set.of("teleport", "world_changed", "logout", "server_restart", "sampling_gap", "impossible_displacement").contains(reason);
    }
}
