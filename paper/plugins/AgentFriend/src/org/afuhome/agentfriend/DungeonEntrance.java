package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.List;

/** Navigation metadata, deliberately outside Site's persisted combat definition. */
record DungeonEntrance(List<Integer> entry, String hint) {
    static DungeonEntrance parse(Object raw, String hint, int minHeight, int maxHeight,
                                 int firstX, int firstY, int firstZ) {
        if (!(raw instanceof List<?> values) || values.size() != 3)
            throw new IllegalArgumentException("invalid_approach_entry");
        List<Integer> point = new ArrayList<>();
        for (Object value : values) {
            if (!(value instanceof Number n) || n.doubleValue() != n.intValue())
                throw new IllegalArgumentException("integer_approach_entry_required");
            point.add(((Number) value).intValue());
        }
        int x = point.get(0), y = point.get(1), z = point.get(2);
        if (Math.abs((long) x) >= 29_000_000 || Math.abs((long) z) >= 29_000_000
                || y <= minHeight || y + 1 >= maxHeight
                || Math.abs((long) x - firstX) > 256 || Math.abs((long) z - firstZ) > 256
                || Math.abs((long) y - firstY) > 128)
            throw new IllegalArgumentException("approach_entry_bounds");
        if (hint == null || hint.isBlank() || hint.length() > 300)
            throw new IllegalArgumentException("approach_hint_required_limit_300");
        return new DungeonEntrance(List.copyOf(point), hint.strip());
    }

    /** Require the floor, feet and head in explicitly declared building protection. */
    boolean protectedBy(List<int[]> boxes) {
        int x = entry.get(0), y = entry.get(1), z = entry.get(2);
        for (int dy = -1; dy <= 1; dy++) {
            final int atY = y + dy;
            if (boxes.stream().noneMatch(b -> x >= b[0] && x <= b[3]
                    && atY >= b[1] && atY <= b[4] && z >= b[2] && z <= b[5])) return false;
        }
        return true;
    }
}
