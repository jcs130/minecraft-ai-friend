package org.agentmc.bridge;

import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;

/** Bounded nearest-first search; unknown observations never become visible matches. */
public final class BlockSearch {
    public static final int MAX_VISIBILITY_CHECKS = 256;
    public record Cell(int x, int y, int z, double distanceSquared) {}

    public static <T> List<T> find(double x, double y, double z, int radius, int count,
                                  Predicate<Cell> matches, Function<Cell, T> observe) {
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                || Math.max(Math.abs(x), Math.max(Math.abs(y), Math.abs(z))) > 30000000
                || radius < 1 || radius > 16 || count < 1 || count > 64)
            throw new IllegalArgumentException("Search point/radius/count outside native bounds");
        List<Cell> cells = new ArrayList<>();
        for (int px=(int)Math.ceil(x-radius); px<=Math.floor(x+radius); px++)
            for (int py=(int)Math.ceil(y-radius); py<=Math.floor(y+radius); py++)
                for (int pz=(int)Math.ceil(z-radius); pz<=Math.floor(z+radius); pz++) {
                    double distance=(px-x)*(px-x)+(py-y)*(py-y)+(pz-z)*(pz-z);
                    if (distance<=radius*radius) cells.add(new Cell(px,py,pz,distance));
                }
        cells.sort(Comparator.comparingDouble(Cell::distanceSquared)
                .thenComparingInt(Cell::x).thenComparingInt(Cell::y).thenComparingInt(Cell::z));
        List<T> found = new ArrayList<>(); int visibilityChecks=0;
        for (Cell cell:cells) {
            if (!matches.test(cell)) continue;
            if (++visibilityChecks>MAX_VISIBILITY_CHECKS)
                throw new IllegalStateException("Native search visibility budget exceeded; narrow maxDistance/matching. No complete result available.");
            T value=observe.apply(cell);
            if (value==null) continue;
            found.add(value);
            if (found.size()==count) break;
        }
        return found;
    }
}
