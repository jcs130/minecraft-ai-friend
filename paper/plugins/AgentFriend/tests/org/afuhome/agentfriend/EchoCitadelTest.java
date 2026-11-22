package org.afuhome.agentfriend;

import java.util.List;
import org.bukkit.entity.EntityType;

public final class EchoCitadelTest {
    private static int checks;

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        var original = List.of(new DungeonWaveCatalog.Enemy(EntityType.STRAY, 20, "哨兵"));
        for (var mode : List.of("normal", "adventure", "apocalypse")) {
            check(EchoCitadel.wave(0, 0, mode, original).enemies().equals(original), "preserve warmup");
            check(EchoCitadel.wave(1, 0, mode, original).enemies().equals(original), "preserve watch");
            int additions = List.of("normal", "adventure", "apocalypse").indexOf(mode);
            var flank = EchoCitadel.wave(1, 1, mode, original);
            check(flank.sideFlank() && flank.enemies().size() == 3 + additions, "reinforcement composition");
            var projection = EchoCitadel.wave(2, 0, mode, original);
            check(projection.enemies().size() == 3 + additions && projection.move() == null, "projection has distinct guards");
            check(projection.enemies().stream().noneMatch(e -> EchoCitadel.BOSS.equals(e.name())), "no real boss in first phase");
            var boss = EchoCitadel.wave(2, 1, mode, original);
            check(boss.enemies().size() == 1 && EchoCitadel.BOSS.equals(boss.enemies().getFirst().name()), "clear ends with boss");
            check(boss.move().shape().equals(mode.equals("adventure") ? "line" : "circle"), "tactical difference");
        }
        check(EchoCitadel.route(1).getLast().equals(EchoCitadel.CENTERS.get(1)), "route reaches watch");
        check(EchoCitadel.route(2).getLast().equals(EchoCitadel.CENTERS.get(2)), "route reaches boss");
        var circle = DungeonEnemyMoves.Move.ECHO_NOVA;
        check(circle.covers(-3, 4, 0) && !circle.covers(4, 4, 0), "circle reaches behind but stops at radius");
        check(!circle.covers(0, 0, 1.8), "floors outside the cast are safe");
        var beam = DungeonEnemyMoves.Move.ECHO_BEAM;
        check(beam.covers(7, 1.25, 0) && !beam.covers(7, 1.26, 0) && !beam.covers(-1, 0, 0), "beam can be sidestepped");

        var run = new EchoCitadel.Progress();
        run.spawn(0);
        check(!run.hasNext(0) && run.hasNext(1), "warmup ends in one wave");
        run.sample(1000, "fighting", true);
        run.sample(1500, "fighting", true);
        run.sample(2000, "moving", true);
        run.spawn(1);
        run.schedule(2000);
        check(run.waiting() && run.nextAt == 4000, "two-second warning");
        run.sample(3000, "fighting", true);
        run.advance();
        run.spawn(1);
        check(!run.waiting() && !run.hasNext(1), "only one reinforcement");
        run.sample(3100, "fighting", false);
        run.resetRoom();
        check(run.hasNext(1) && run.wave == 0, "retry begins at first wave of current room");
        check(run.timing().get("observedWaves").equals(List.of(1, 2, 0)), "retry retains witnessed waves");
        check(run.timing().get("battleMs").equals(500L) && run.timing().get("travelMs").equals(500L)
            && run.timing().get("waveTransitionMs").equals(1000L), "time excludes pause and separates transition");
        var recovered = new EchoCitadel.Progress();
        recovered.restore(500, 500, 1000, List.of(1, 2, 0));
        check(recovered.timing().equals(run.timing()) && recovered.wave == 0, "checkpoint keeps measurements only");
        System.out.println("EchoCitadelTest passed " + checks + " checks");
    }
}
