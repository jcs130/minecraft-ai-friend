/* SPDX-License-Identifier: MPL-2.0 */
package meow.kikir.freesia.velocity.network.ysm;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** A model session belongs to one actual world join, never the login limbo or
 * a previous backend. This class carries no passwords, payloads or model data. */
public final class YsmPlayGate {
    private record State(long epoch, String backend, boolean ready) {}
    private final Map<UUID, State> states = new ConcurrentHashMap<>();
    private final AtomicLong sequence = new AtomicLong();

    public long begin(UUID player, String backend) {
        long epoch = sequence.incrementAndGet();
        states.put(player, new State(epoch, backend, false));
        return epoch;
    }
    public long epoch(UUID player) {
        State state = states.get(player);
        return state == null ? -1 : state.epoch;
    }
    public boolean markReady(UUID player, long epoch) {
        states.computeIfPresent(player, (id, state) -> state.epoch == epoch && !"auth".equalsIgnoreCase(state.backend)
                ? new State(state.epoch, state.backend, true) : state);
        return canSend(player, epoch);
    }
    public boolean canSend(UUID player, long epoch) {
        State state = states.get(player);
        return state != null && state.ready && state.epoch == epoch;
    }
    public boolean ready(UUID player) { return canSend(player, epoch(player)); }
    public void remove(UUID player) { states.remove(player); }
}
