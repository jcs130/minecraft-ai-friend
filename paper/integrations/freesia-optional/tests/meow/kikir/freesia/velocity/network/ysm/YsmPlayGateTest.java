/* SPDX-License-Identifier: MPL-2.0 */
package meow.kikir.freesia.velocity.network.ysm;
import java.util.UUID;

/** No network, model files or player data. Real wire timing is tested separately. */
public final class YsmPlayGateTest {
    private static int checks;
    private static void check(boolean condition, String name) {
        if (!condition) throw new AssertionError(name);
        checks++;
    }
    public static void main(String[] args) {
        var gate = new YsmPlayGate();
        UUID player = UUID.randomUUID();
        check(!gate.ready(player), "unknown connection cannot send");
        long auth = gate.begin(player, "auth");
        check(!gate.markReady(player, auth), "login limbo JOIN does not start models");
        check(!gate.canSend(player, auth), "no YSM handshake in auth");
        long first = gate.begin(player, "paper");
        check(!gate.ready(player), "new world waits for JOIN");
        check(!gate.markReady(player, auth), "late auth callback cannot open paper");
        check(gate.markReady(player, first), "current actual world JOIN opens models");
        check(gate.canSend(player, first), "current PLAY session can send");
        long second = gate.begin(player, "paper");
        check(!gate.ready(player), "transfer blocks previously ready session");
        check(!gate.canSend(player, first), "queued old Worker payload is stale");
        check(!gate.markReady(player, first), "late old JOIN cannot unblock transfer");
        check(gate.markReady(player, second), "new JOIN restores models");
        check(!gate.canSend(player, first), "old payload stays stale after new JOIN");
        gate.remove(player);
        check(!gate.markReady(player, second), "disconnect removes readiness");
        long reconnect = gate.begin(player, "paper");
        check(reconnect != second, "reconnect has a fresh epoch");
        check(!gate.canSend(player, second), "reused player UUID cannot reuse old epoch");
        check(gate.markReady(player, reconnect), "reconnected world can handshake again");
        UUID other = UUID.randomUUID();
        check(!gate.ready(other), "one player's readiness grants nothing to another");
        System.out.println("YSM play lifecycle checks: " + checks);
    }
}
