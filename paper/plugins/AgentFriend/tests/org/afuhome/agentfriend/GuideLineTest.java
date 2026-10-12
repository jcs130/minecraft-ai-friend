package org.afuhome.agentfriend;

/** Geometry guarantees for the actual packet renderer, no server or duplicate implementation. */
public final class GuideLineTest {
    private static int checked;
    public static void main(String[] args) {
        GuideLine.Point start = new GuideLine.Point(-31.5, 65.2, 8.5);
        for (GuideLine.Point end : new GuideLine.Point[] {
                new GuideLine.Point(16.5, 30.5, 8.5), new GuideLine.Point(-31.5, 105.5, 8.5),
                new GuideLine.Point(-31.5, -20.5, 8.5), new GuideLine.Point(-50.5, 70.5, -20.5),
                new GuideLine.Point(29999900, 64, 29999900), new GuideLine.Point(-31.4, 65.2, 8.5), start }) {
            var points = GuideLine.points(start, end);
            require(points.size() >= 2 && points.size() <= GuideLine.MAX_POINTS, "bounded full frame");
            require(points.getFirst().equals(start) && points.getLast().equals(end), "both exact endpoints, including >10 blocks");
            double dx = end.x() - start.x(), dy = end.y() - start.y(), dz = end.z() - start.z();
            for (int i = 0; i < points.size(); i++) {
                var point = points.get(i); double t = i / (double) (points.size() - 1);
                require(Math.abs(point.x() - (start.x() + t * dx)) < 1e-7
                        && Math.abs(point.y() - (start.y() + t * dy)) < 1e-7
                        && Math.abs(point.z() - (start.z() + t * dz)) < 1e-7, "all points lie on the ordered bearing");
            }
        }
        require(GuideLine.points(new GuideLine.Point(Double.NaN, 0, 0), start).isEmpty(), "reject NaN");
        require(GuideLine.points(start, new GuideLine.Point(0, Double.POSITIVE_INFINITY, 0)).isEmpty(), "reject infinity");
        require(GuideLine.points(start, null).isEmpty(), "reject missing endpoint");
        System.out.println("PASS GuideLine " + checked + " assertions");
    }
    private static void require(boolean good, String description) { checked++; if (!good) throw new AssertionError(description); }
}
