package org.afuhome.agentfriend;

import java.util.List;

public final class DungeonEntranceTest {
    private static int passed;
    private static void check(boolean value) { if (!value) throw new AssertionError(); passed++; }
    private static void rejects(Runnable task, String reason) {
        try { task.run(); throw new AssertionError("accepted " + reason); }
        catch (IllegalArgumentException error) { check(error.getMessage().equals(reason)); }
    }
    private static DungeonEntrance parse(Object raw, String hint) {
        return DungeonEntrance.parse(raw, hint, -64, 320, 1159, 45, 209);
    }
    public static void main(String[] args) {
        var entrance = parse(List.of(1165, 94, 230), "沿楼梯下到首室，不要挖墙");
        check(entrance.entry().equals(List.of(1165, 94, 230)));
        check(entrance.protectedBy(List.of(new int[]{1162, 85, 227, 1171, 96, 233})));
        check(!entrance.protectedBy(List.of(new int[]{1162, 94, 227, 1171, 96, 233})));
        check(!entrance.protectedBy(List.of(new int[]{1162, 85, 227, 1171, 94, 233})));
        check(!entrance.protectedBy(List.of(new int[]{1166, 85, 227, 1171, 96, 233})));
        check(!entrance.protectedBy(List.of()));
        rejects(() -> parse(null, "路线"), "invalid_approach_entry");
        rejects(() -> parse(List.of(1165, 94), "路线"), "invalid_approach_entry");
        rejects(() -> parse(List.of(1165.5, 94, 230), "路线"), "integer_approach_entry_required");
        rejects(() -> parse(List.of("1165", 94, 230), "路线"), "integer_approach_entry_required");
        rejects(() -> parse(List.of(Double.NaN, 94, 230), "路线"), "integer_approach_entry_required");
        rejects(() -> parse(List.of(1165, 320, 230), "路线"), "approach_entry_bounds");
        rejects(() -> parse(List.of(1165, 319, 230), "路线"), "approach_entry_bounds");
        rejects(() -> parse(List.of(1165, -64, 230), "路线"), "approach_entry_bounds");
        rejects(() -> parse(List.of(1500, 94, 230), "路线"), "approach_entry_bounds");
        rejects(() -> parse(List.of(1165, 174, 230), "路线"), "approach_entry_bounds");
        rejects(() -> parse(List.of(Integer.MIN_VALUE, 94, 230), "路线"), "approach_entry_bounds");
        rejects(() -> parse(List.of(1165, 94, 230), ""), "approach_hint_required_limit_300");
        rejects(() -> parse(List.of(1165, 94, 230), "x".repeat(301)), "approach_hint_required_limit_300");
        System.out.println("PASS " + passed + " protected entrance checks");
    }
}
