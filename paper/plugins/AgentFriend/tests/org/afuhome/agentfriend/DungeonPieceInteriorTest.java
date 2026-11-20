package org.afuhome.agentfriend;

import java.util.List;
import org.bukkit.Location;

/** Authored piece union. A touching seam is interior, the real outside face stays immutable. */
public final class DungeonPieceInteriorTest {
    private static ProtectionArea box(int x1, int x2) {
        return ProtectionArea.box("part", "part", null, x1, -1, 5, x2, 3, 9);
    }
    private static boolean canBuild(List<ProtectionArea> parts, int x, int y, int z) {
        return DungeonBuildPolicy.insidePieces(parts, new Location(null, x, y, z));
    }
    public static void main(String[] args) {
        var pieces = List.of(box(-10, -5), box(-4, -2), box(1, 3));
        if (!canBuild(pieces, -5, 1, 7) || !canBuild(pieces, -4, 1, 7)) throw new AssertionError("shared seam");
        if (canBuild(pieces, 0, 1, 7) || canBuild(pieces, -2, 1, 7)) throw new AssertionError("gap");
        if (canBuild(pieces, -10, 1, 7) || canBuild(pieces, -7, -1, 7) || canBuild(pieces, -7, 3, 7)
                || canBuild(pieces, -7, 1, 5) || canBuild(pieces, -7, 1, 9)) throw new AssertionError("outer shell");
        System.out.println("Verified floor, ceiling, sides, seams and gaps.");
    }
}
