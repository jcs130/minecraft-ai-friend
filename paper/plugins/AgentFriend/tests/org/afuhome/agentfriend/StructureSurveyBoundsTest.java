package org.afuhome.agentfriend;

import java.util.List;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.levelgen.structure.StructureStart;
import net.minecraft.world.level.levelgen.structure.pieces.PiecesContainer;
import net.minecraft.world.level.levelgen.structure.structures.JungleTemplePiece;

/** Replays real saved temple metadata; never opens or writes a game world. */
public final class StructureSurveyBoundsTest {
    private static int checks;
    private static void check(String name, boolean ok) {
        if (!ok) throw new AssertionError(name);
        checks++;
    }
    public static void main(String[] args) {
        var stdout=System.out; var stderr=System.err;
        try { SharedConstants.tryDetectVersion(); Bootstrap.bootStrap(); }
        finally { System.setOut(stdout); System.setErr(stderr); }
        CompoundTag saved = new CompoundTag();
        saved.putIntArray("BB", new int[]{1600,86,2352,1614,95,2363});
        saved.putInt("O",3); saved.putInt("GD",0);
        saved.putInt("Width",12); saved.putInt("Height",10); saved.putInt("Depth",15);
        saved.putInt("HPos",86);
        JungleTemplePiece piece = new JungleTemplePiece(saved);
        var original = piece.getBoundingBox();
        StructureStart start = new StructureStart(null,new ChunkPos(100,147),0,new PiecesContainer(List.of(piece)));
        var pieceBox = ExplorationObjectives.surveyPieceBounds("minecraft:jungle_pyramid",piece);
        var startBox = ExplorationObjectives.surveyStartBounds("minecraft:jungle_pyramid",start);
        check("actual saved basement chest level belongs to temple",pieceBox.isInside(1607,83,2357));
        check("start prefilter also admits basement",startBox.isInside(1607,83,2357));
        check("normal main floor still admitted",startBox.isInside(1607,87,2357));
        check("upper floor still admitted",startBox.isInside(1607,93,2357));
        check("player below physical basement not admitted",!startBox.isInside(1613,80,2360));
        check("adjacent cave not admitted",!startBox.isInside(1615,83,2357));
        check("above roof not admitted",!startBox.isInside(1607,96,2357));
        check("saved structure metadata remains unchanged",original.minY()==86 && piece.getBoundingBox()==original);
        check("other registry keys not expanded",ExplorationObjectives.surveyPieceBounds("example:custom_temple",piece)==original);
        check("buried treasure keeps current piece height",ExplorationObjectives.surveyStartBounds("minecraft:buried_treasure",start)==original);
        System.out.println("StructureSurveyBoundsTest: "+checks+" passed");
    }
}
