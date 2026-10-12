package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.List;

/** A complete straight bearing, never a wall ray cast or a walkable route. */
final class GuideLine {
    static final int MAX_POINTS = 64;
    record Point(double x, double y, double z) { }
    private GuideLine() { }

    static List<Point> points(Point start, Point end) {
        if (!finite(start) || !finite(end)) return List.of();
        double dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
        double length = Math.hypot(Math.hypot(dx, dy), dz);
        if (!Double.isFinite(length)) return List.of();
        int segments = Math.max(1, (int) Math.min(MAX_POINTS - 1, Math.ceil(length / .65)));
        List<Point> points = new ArrayList<>(segments + 1);
        points.add(start);
        for (int i = 1; i < segments; i++) {
            double t = i / (double) segments;
            points.add(new Point(start.x + dx * t, start.y + dy * t, start.z + dz * t));
        }
        points.add(end); // Retain the exact target even when the point budget reduces density.
        return List.copyOf(points);
    }

    private static boolean finite(Point p) {
        return p != null && Double.isFinite(p.x) && Double.isFinite(p.y) && Double.isFinite(p.z);
    }
}
