package org.afuhome.agentfriend;

import com.google.gson.Gson;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** The six playable stops of the first-floor chapter. Settlement is the seventh stop. */
final class BeaconExpedition {
    static final String SITE = "aincrad_01";
    static final String VERSION = "lost_beacon_v1";
    static final String STATUS = "/mycli dungeon status " + SITE;
    static final String MENU = "/mycli dungeon menu " + SITE;
    static final int BRIEFING = 0, APPROACH = 1, RESCUE = 2, CAMP = 3, FINAL_ROUTE = 4, BOSS = 5, STAGES = 6;
    private static final Gson JSON = new Gson();

    enum Stop { BRIEFING, SCOUT, GATE, RESCUE, CAMP, ALTAR, VAULT, BOSS }
    enum Opening { SCOUT, GATE }
    enum Finale { ALTAR, VAULT }
    enum Boon {
        EDGE("edge", "锋刃", "近战直接命中本段敌人时增加2点伤害"),
        AIM("aim", "远望", "本人发射的箭、弩箭或三叉戟命中本段敌人时增加2点伤害"),
        WARD("ward", "守势", "受到本段敌人的攻击时减免2点伤害，至少仍受1点");

        final String id, label, effect;
        Boon(String id, String label, String effect) { this.id = id; this.label = label; this.effect = effect; }

        static Boon from(String id) {
            for (Boon boon : values()) if (boon.id.equals(id)) return boon;
            return null;
        }
    }

    enum Rescue { WAITING, ESCORTING, STRANDED, SAFE, BEACON_RECOVERED }

    enum Choice {
        SCOUT("scout", "走北廊暗道", "查两处侦察印记。首领首次蓄力会多预告2秒。"),
        GATE("gate", "从东门突破", "用柱廊掩护击败三名守卫。通关多得1铁锭。"),
        SURVEY_WEST("survey_west", "调查西侧印记", "走到金色标记地砖旁，查看巡逻记录。"),
        SURVEY_EAST("survey_east", "调查东侧印记", "走到金色标记地砖旁，读取首领情报。"),
        RELEASE("release", "接应失联队员", "从西廊接出队员并陪他走到安全标记。"),
        SALVAGE("salvage", "带回遗留信标", "在接应处确认信标，继续前往营地。"),
        ALTAR("altar", "切断看台供能", "走原石梯上看台，关闭两处封印。首领失去震地攻击。"),
        VAULT("vault", "挑战宝库守卫", "在东南廊迎战精英。首领保留震地，通关多得1铁锭。"),
        SEAL_NORTH("seal_north", "关闭北侧封印", "靠近看台上的一处供能点，交互断开。"),
        SEAL_SOUTH("seal_south", "关闭南侧封印", "靠近看台上的另一处供能点，交互断开。"),
        EDGE(Boon.EDGE), AIM(Boon.AIM), WARD(Boon.WARD);

        final String id, label, detail;
        final Boon boon;

        Choice(String id, String label, String detail) { this(id, label, detail, null); }
        Choice(Boon boon) { this(boon.id, boon.label, boon.effect, boon); }
        Choice(String id, String label, String detail, Boon boon) {
            this.id = id; this.label = label; this.detail = detail; this.boon = boon;
        }

        boolean marked() {
            return this == SURVEY_WEST || this == SURVEY_EAST || this == RELEASE || this == SALVAGE
                || this == SEAL_NORTH || this == SEAL_SOUTH;
        }

        static List<Choice> withBoons(Choice left, Choice right, boolean available) {
            return available ? List.of(EDGE, AIM, WARD, left, right) : List.of(left, right);
        }
    }

    record Point(int x, int y, int z) {
        List<Integer> coordinates() { return List.of(x, y, z); }
    }

    record Decision(Progress progress, boolean advance) {}

    record Progress(Opening opening, Finale finale, Rescue rescue, int scoutMarks, int altarMarks,
                    Map<UUID, Boon> initial, Map<UUID, Boon> camp) {
        Progress {
            Objects.requireNonNull(rescue);
            initial = Map.copyOf(initial);
            camp = Map.copyOf(camp);
            require(scoutMarks >= 0 && scoutMarks <= 3 && altarMarks >= 0 && altarMarks <= 3);
        }

        static Progress fresh() {
            return new Progress(null, null, Rescue.WAITING, 0, 0, Map.of(), Map.of());
        }

        Stop stop(int stage) {
            return switch (stage) {
                case BRIEFING -> Stop.BRIEFING;
                case APPROACH -> opening == Opening.GATE ? Stop.GATE : Stop.SCOUT;
                case RESCUE -> Stop.RESCUE;
                case CAMP -> Stop.CAMP;
                case FINAL_ROUTE -> finale == Finale.VAULT ? Stop.VAULT : Stop.ALTAR;
                case BOSS -> Stop.BOSS;
                default -> throw new IllegalArgumentException("invalid_beacon_stage");
            };
        }

        boolean safeRescue() { return rescue == Rescue.SAFE; }
        boolean clearedRescue() { return safeRescue() || rescue == Rescue.BEACON_RECOVERED; }
        boolean altarDisabled() { return finale == Finale.ALTAR && altarMarks == 3; }
        Boon boon(UUID id) { return camp.getOrDefault(id, initial.get(id)); }
        int strength(UUID id) { return safeRescue() && camp.containsKey(id) ? 3 : 2; }

        List<Choice> choices(int stage, UUID id) {
            return switch (stage) {
                case BRIEFING -> Choice.withBoons(Choice.SCOUT, Choice.GATE, !initial.containsKey(id));
                case APPROACH -> opening == Opening.SCOUT
                    ? marks(scoutMarks, Choice.SURVEY_WEST, Choice.SURVEY_EAST) : List.of();
                case RESCUE -> switch (rescue) {
                    case WAITING -> List.of(Choice.RELEASE);
                    case STRANDED -> List.of(Choice.SALVAGE);
                    default -> List.of();
                };
                case CAMP -> Choice.withBoons(Choice.ALTAR, Choice.VAULT, !camp.containsKey(id));
                case FINAL_ROUTE -> finale == Finale.ALTAR
                    ? marks(altarMarks, Choice.SEAL_NORTH, Choice.SEAL_SOUTH) : List.of();
                default -> List.of();
            };
        }

        private static List<Choice> marks(int bits, Choice first, Choice second) {
            return switch (bits) {
                case 0 -> List.of(first, second);
                case 1 -> List.of(second);
                case 2 -> List.of(first);
                default -> List.of();
            };
        }

        Decision choose(int stage, UUID id, Choice choice) {
            if (!choices(stage, id).contains(choice)) throw new IllegalArgumentException("stale_beacon_choice");
            if (choice.boon != null) return new Decision(withBoon(id, choice.boon, stage == CAMP), false);
            return switch (choice) {
                case SCOUT -> new Decision(withOpening(Opening.SCOUT), true);
                case GATE -> new Decision(withOpening(Opening.GATE), true);
                case SURVEY_WEST, SURVEY_EAST -> {
                    Progress next = withMark(stage, choice == Choice.SURVEY_WEST ? 1 : 2);
                    yield new Decision(next, next.scoutMarks == 3);
                }
                case RELEASE -> new Decision(withRescue(Rescue.ESCORTING), false);
                case SALVAGE -> new Decision(withRescue(Rescue.BEACON_RECOVERED), true);
                case ALTAR -> new Decision(withFinale(Finale.ALTAR), true);
                case VAULT -> new Decision(withFinale(Finale.VAULT), true);
                case SEAL_NORTH, SEAL_SOUTH -> {
                    Progress next = withMark(stage, choice == Choice.SEAL_NORTH ? 1 : 2);
                    yield new Decision(next, next.altarMarks == 3);
                }
                default -> throw new IllegalStateException("invalid_beacon_choice");
            };
        }

        int rewardCount(int base) {
            return base + (opening == Opening.GATE ? 1 : 0) + (finale == Finale.VAULT ? 1 : 0);
        }

        Progress withOpening(Opening choice) {
            return new Progress(choice, finale, rescue, scoutMarks, altarMarks, initial, camp);
        }

        Progress withFinale(Finale choice) {
            return new Progress(opening, choice, rescue, scoutMarks, altarMarks, initial, camp);
        }

        Progress withRescue(Rescue state) {
            return new Progress(opening, finale, state, scoutMarks, altarMarks, initial, camp);
        }

        Progress withMark(int stage, int bit) {
            return stage == APPROACH
                ? new Progress(opening, finale, rescue, scoutMarks | bit, altarMarks, initial, camp)
                : new Progress(opening, finale, rescue, scoutMarks, altarMarks | bit, initial, camp);
        }

        Progress withBoon(UUID id, Boon boon, boolean atCamp) {
            Map<UUID, Boon> choices = new LinkedHashMap<>(atCamp ? camp : initial);
            choices.put(id, boon);
            return new Progress(opening, finale, rescue, scoutMarks, altarMarks,
                atCamp ? initial : choices, atCamp ? choices : camp);
        }

        boolean committed(UUID actor, int stage, String action) {
            Boon boon = Boon.from(action);
            if (boon != null) return (stage == BRIEFING ? initial : stage == CAMP ? camp : Map.of()).get(actor) == boon;
            return switch (action) {
                case "scout" -> stage == BRIEFING && opening == Opening.SCOUT;
                case "gate" -> stage == BRIEFING && opening == Opening.GATE;
                case "survey_west" -> stage == APPROACH && (scoutMarks & 1) != 0;
                case "survey_east" -> stage == APPROACH && (scoutMarks & 2) != 0;
                case "release" -> stage == RESCUE && rescue != Rescue.WAITING;
                case "salvage" -> stage == RESCUE && rescue == Rescue.BEACON_RECOVERED;
                case "altar" -> stage == CAMP && finale == Finale.ALTAR;
                case "vault" -> stage == CAMP && finale == Finale.VAULT;
                case "seal_north" -> stage == FINAL_ROUTE && (altarMarks & 1) != 0;
                case "seal_south" -> stage == FINAL_ROUTE && (altarMarks & 2) != 0;
                default -> false;
            };
        }

        Map<String, Object> summary() {
            return Map.of("version", VERSION, "opening", key(opening), "finale", key(finale),
                "rescue", key(rescue), "surveyMarks", Integer.bitCount(scoutMarks),
                "sealsDisabled", Integer.bitCount(altarMarks), "altarDisabled", altarDisabled());
        }

        String save() { return JSON.toJson(this); }

        static Progress restore(String raw, int stage, Set<UUID> participants) {
            Progress p = Objects.requireNonNull(JSON.fromJson(raw, Progress.class));
            require((stage >= APPROACH) == (p.opening != null));
            require((stage >= FINAL_ROUTE) == (p.finale != null));
            require(stage >= APPROACH || p.scoutMarks == 0);
            require(p.opening == Opening.SCOUT || p.scoutMarks == 0);
            if (p.opening == Opening.SCOUT) require((stage > APPROACH) == (p.scoutMarks == 3));
            require(stage >= RESCUE || p.rescue == Rescue.WAITING);
            require((stage > RESCUE) == p.clearedRescue());
            require(p.finale == Finale.ALTAR || p.altarMarks == 0);
            if (p.finale == Finale.ALTAR) require((stage > FINAL_ROUTE) == p.altarDisabled());
            require(stage >= CAMP || p.camp.isEmpty());
            require(participants.containsAll(p.initial.keySet()) && participants.containsAll(p.camp.keySet()));
            return p;
        }
    }

    record Token(String run, int stage, String action) {
        String value() { return run + "." + stage + "." + action; }

        static Token parse(String value) {
            String[] parts = value.split("\\.", -1);
            if (parts.length != 3 || !parts[0].matches("[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
                    || !parts[1].matches("[0-4]") || !parts[2].matches("[a-z_]{2,16}"))
                throw new IllegalArgumentException("invalid_beacon_choice");
            return new Token(parts[0], Integer.parseInt(parts[1]), parts[2]);
        }
    }

    private static String key(Enum<?> value) { return value == null ? "" : value.name().toLowerCase(java.util.Locale.ROOT); }

    private static void require(boolean valid) {
        if (!valid) throw new IllegalArgumentException("invalid_beacon_checkpoint_preserved");
    }
}
