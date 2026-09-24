import com.dwinovo.numen.core.pathing.moves.CalculationContext;
import com.dwinovo.numen.core.pathing.moves.ChunkLoadedTest;
import com.dwinovo.numen.core.pathing.moves.MutableMoveResult;
import com.dwinovo.numen.core.pathing.moves.movements.MovementAscend;
import com.dwinovo.numen.core.pathing.moves.movements.MovementDescend;
import com.dwinovo.numen.core.pathing.moves.movements.MovementDownward;
import com.dwinovo.numen.core.pathing.spec.CellClass;
import com.dwinovo.numen.core.pathing.spec.RouteSpec;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.StairBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Half;
import net.minecraft.world.level.block.state.properties.StairsShape;
import net.minecraft.world.level.material.FluidState;
import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Real native state classification and movement cost methods; no server or game commands. */
public final class StairSupportContractTest {
    private static int assertions;
    private static final double INF = 1000000.0;
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
        assertions++;
    }
    private static final class View implements BlockGetter {
        final Map<BlockPos, BlockState> cells = new HashMap<>();
        View set(int x, int y, int z, BlockState state) {
            cells.put(new BlockPos(x,y,z), state); return this;
        }
        @Override public BlockState getBlockState(BlockPos p) { return cells.getOrDefault(p, Blocks.AIR.defaultBlockState()); }
        @Override public BlockEntity getBlockEntity(BlockPos p) { return null; }
        @Override public FluidState getFluidState(BlockPos p) { return getBlockState(p).getFluidState(); }
        @Override public int getHeight() { return 384; }
        @Override public int getMinBuildHeight() { return -64; }
    }
    private static void field(Object target, String name, Object value) throws Exception {
        Field f = CalculationContext.class.getDeclaredField(name); f.setAccessible(true); f.set(target, value);
    }
    private static CalculationContext context(View view) throws Exception {
        // A frozen calculation fixture has no player, permissions, inventory or input driver.
        Field f = sun.misc.Unsafe.class.getDeclaredField("theUnsafe"); f.setAccessible(true);
        CalculationContext c = (CalculationContext)((sun.misc.Unsafe)f.get(null)).allocateInstance(CalculationContext.class);
        field(c,"view",view); field(c,"loadedTest",ChunkLoadedTest.ALWAYS);
        field(c,"spec",RouteSpec.defaults()); field(c,"cursor",new BlockPos.MutableBlockPos());
        field(c,"allowBreakAnyway",List.of()); field(c,"worldBottom",-64); field(c,"worldHeight",320);
        field(c,"minFallHeight",3); field(c,"maxFallHeightNoWater",3);
        check(!c.allowBreak && !c.hasThrowaway && !c.spec.alter().mayAlter(), "fixture must prohibit break/place");
        return c;
    }
    private static BlockState stair(Direction face, Half half, StairsShape shape) {
        return Blocks.STONE_BRICK_STAIRS.defaultBlockState().setValue(StairBlock.FACING,face)
            .setValue(StairBlock.HALF,half).setValue(StairBlock.SHAPE,shape);
    }
    public static void main(String[] args) throws Exception {
        java.io.PrintStream resultOutput = System.out;
        net.minecraft.SharedConstants.tryDetectVersion(); net.minecraft.server.Bootstrap.bootStrap();
        for (Direction face : Direction.Plane.HORIZONTAL) {
            for (Half half : Half.values()) for (StairsShape shape : StairsShape.values()) {
                BlockState s = stair(face,half,shape); View v = new View().set(0,70,0,s).set(0,69,0,Blocks.STONE.defaultBlockState());
                check(CellClass.of(s)==CellClass.STAIRS,"classification preserved");
                check(CellClass.canWalkOn(v,new BlockPos(0,70,0),RouteSpec.defaults()),"stairs remain support");
                check(!CellClass.canWalkThrough(v,new BlockPos(0,70,0),RouteSpec.defaults()),"solid stair cell must not be a body cell: "+face+half+shape);
                check(MovementDownward.cost(context(v),0,71,0)>=INF,"free vertical edge into stair must be rejected");
            }
            // Descend opposite facing (north-facing stairs descend south), ascend the reverse.
            int dx=-face.getStepX(), dz=-face.getStepZ();
            View v=new View().set(0,70,0,stair(face,Half.BOTTOM,StairsShape.STRAIGHT))
                .set(dx,69,dz,stair(face,Half.BOTTOM,StairsShape.STRAIGHT));
            CalculationContext c=context(v); MutableMoveResult result=new MutableMoveResult();
            MovementDescend.cost(c,0,71,0,dx,dz,result);
            check(result.cost<INF && result.y==70,"normal stair descent preserved: "+face);
            check(MovementAscend.cost(c,dx,70,dz,0,0)<INF,"normal stair ascent preserved: "+face);
        }
        View ordinary=new View().set(0,70,0,Blocks.STONE.defaultBlockState()).set(0,69,1,Blocks.STONE.defaultBlockState());
        CalculationContext c=context(ordinary); MutableMoveResult r=new MutableMoveResult(); MovementDescend.cost(c,0,71,0,0,1,r);
        check(r.cost<INF && r.y==70,"one-block full-cube descent preserved");
        check(MovementAscend.cost(c,0,70,1,0,0)<INF,"one-block full-cube ascent preserved");
        View air=new View().set(0,69,0,Blocks.STONE.defaultBlockState());
        check(CellClass.canWalkThrough(air,new BlockPos(0,70,0),RouteSpec.defaults()),"air still passable");
        check(MovementDownward.cost(context(air),0,71,0)<INF,"air drop with support preserved");
        View solid=new View().set(0,70,0,Blocks.STONE.defaultBlockState()).set(0,69,0,Blocks.STONE.defaultBlockState());
        check(MovementDownward.cost(context(solid),0,71,0)>=INF,"no new permission to dig solid floor");
        resultOutput.println("{\"ok\":true,\"assertions\":"+assertions+",\"scope\":\"native classification and north/south/east/west movement costs; physical navigation pending\"}");
    }
}
