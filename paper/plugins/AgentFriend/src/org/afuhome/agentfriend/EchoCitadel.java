package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.bukkit.entity.EntityType;

/** The reviewed virtual-echo encounter for the existing Aincrad rooms. */
final class EchoCitadel {
    static final String SITE = "void_citadel";
    static final int VERSION = 1;
    static final long WAVE_WARNING_MS = 2000;
    static final List<List<Integer>> CENTERS = List.of(
        List.of(9217,122,8705), List.of(9237,122,8725), List.of(9237,122,8705));
    static final String BOSS = "回响执政官";
    private static final List<List<Integer>> TO_GUARD = List.of(
        List.of(9230,122,8705), List.of(9237,122,8705), List.of(9237,122,8711), CENTERS.get(1));
    private static final List<List<Integer>> TO_BOSS = List.of(
        List.of(9237,122,8718), List.of(9237,122,8711), CENTERS.get(2));

    record Wave(String name, String tactic, List<DungeonWaveCatalog.Enemy> enemies,
                DungeonEnemyMoves.Move move, boolean sideFlank) {}

    static int waves(int room) {
        return room == 0 ? 1 : 2;
    }

    static List<List<Integer>> route(int room) {
        return switch (room) {
            case 1 -> TO_GUARD;
            case 2 -> TO_BOSS;
            default -> List.of();
        };
    }

    static Wave wave(int room, int wave, String difficulty, List<DungeonWaveCatalog.Enemy> current) {
        if (room < 0 || room >= CENTERS.size() || wave < 0 || wave >= waves(room))
            throw new IllegalArgumentException("invalid_echo_wave");
        boolean harder = !"normal".equals(difficulty);
        boolean apocalypse = "apocalypse".equals(difficulty);
        if (room == 0)
            return new Wave("前庭热身", "先压制弓手，让近战守卫绕柱靠近。", current, null, false);
        if (room == 1 && wave == 0)
            return new Wave("卫所哨队", "用柱脚挡缓慢箭，优先压制女巫。", current, null, false);
        if (room == 1) {
            var flank = new ArrayList<>(List.of(
                enemy(EntityType.STRAY,46,"西翼弓手"),
                enemy(EntityType.VINDICATOR,55,"破盾斧卫"),
                enemy(EntityType.WITHER_SKELETON,47,"封路守卫")));
            if (harder) flank.add(1,enemy(EntityType.STRAY,49,"东翼弓手"));
            if (apocalypse) flank.add(enemy(EntityType.WITCH,54,"援军炼金师"));
            String tactic = harder ? "两侧远程交叉射击。沿柱脚换侧，先打掉一边，再处理斧卫。"
                : "从进门直线移到柱脚，先压西翼弓手，拉开破盾斧卫。";
            return new Wave("侧翼援军", tactic, List.copyOf(flank), null, true);
        }
        if (wave == 0) {
            var guard = new ArrayList<>(List.of(
                enemy(EntityType.PILLAGER,45,"执政官弩卫"),
                enemy(EntityType.WITHER_SKELETON,54,"执政官近卫"),
                enemy(EntityType.WITHER_SKELETON,83,"执政官投影")));
            if (harder) guard.addFirst(enemy(EntityType.WITCH,50,"投影炼金师"));
            if (apocalypse) guard.addFirst(enemy(EntityType.STRAY,50,"投影副官"));
            return new Wave("执政官投影", "先拆投影的护卫。投影散开后，执政官会在本室显形。", List.copyOf(guard), null, false);
        }
        var move = harder && !apocalypse ? DungeonEnemyMoves.Move.ECHO_BEAM : DungeonEnemyMoves.Move.ECHO_NOVA;
        String tactic = move.response + "，技能落地后趁恢复期回击。";
        return new Wave("执政官本体", tactic,
            List.of(new DungeonWaveCatalog.Enemy(EntityType.WITHER_SKELETON,112,BOSS,"QD_Ruin_void_citadel")),
            move, false);
    }

    private static DungeonWaveCatalog.Enemy enemy(EntityType type, double health, String name) {
        return new DungeonWaveCatalog.Enemy(type,health,name);
    }

    static final class Progress {
        int wave;
        long nextAt;
        private long sampleAt, battleMs, travelMs, transitionMs;
        private final int[] witnessed = new int[CENTERS.size()];

        boolean waiting() { return nextAt != 0; }

        boolean hasNext(int room) { return wave + 1 < waves(room); }

        void schedule(long now) { nextAt = now + WAVE_WARNING_MS; }

        void advance() { wave++; nextAt = 0; }

        void spawn(int room) { witnessed[room] = Math.max(witnessed[room], wave + 1); }

        void resetRoom() { wave = 0; nextAt = 0; }

        void sample(long now, String phase, boolean present) {
            long elapsed = sampleAt == 0 ? 0 : Math.max(0,Math.min(2000,now-sampleAt));
            sampleAt = now;
            if (!present) return;
            if ("moving".equals(phase)) travelMs += elapsed;
            if ("fighting".equals(phase)) {
                if (waiting()) transitionMs += elapsed;
                else battleMs += elapsed;
            }
        }

        Map<String,Object> timing() {
            return Map.of("battleMs",battleMs,"travelMs",travelMs,"waveTransitionMs",transitionMs,
                "observedWaves",Arrays.stream(witnessed).boxed().toList());
        }

        void restore(long battle, long travel, long transition, List<Integer> waves) {
            battleMs = Math.clamp(battle,0,1_800_000L);
            travelMs = Math.clamp(travel,0,1_800_000L);
            transitionMs = Math.clamp(transition,0,1_800_000L);
            for (int room = 0; room < Math.min(witnessed.length,waves.size()); room++)
                witnessed[room] = Math.clamp(waves.get(room),0,EchoCitadel.waves(room));
        }
    }
}
