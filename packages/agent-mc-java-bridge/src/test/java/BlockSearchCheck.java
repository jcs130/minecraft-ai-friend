import org.agentmc.bridge.BlockSearch;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class BlockSearchCheck {
    private static void check(boolean ok){if(!ok)throw new AssertionError();}
    private static void rejects(Runnable run){try{run.run();throw new AssertionError("Expected rejection");}catch(IllegalArgumentException|IllegalStateException expected){}}
    public static void main(String[] args){
        // A voxel fixture has a hidden nearer match, an unloaded cell and two visible blocks.
        var found=BlockSearch.find(-.2,64,-.2,2,2,cell->cell.y()==64&&cell.z()==0,
            cell->cell.x()==0||cell.x()==1?null:List.of(cell.x(),cell.y(),cell.z()));
        check(found.equals(List.of(List.of(-1,64,0),List.of(-2,64,0))));
        List<BlockSearch.Cell> visited=new ArrayList<>();
        BlockSearch.find(0,0,0,1,64,cell->{visited.add(cell);return true;},cell->cell);
        check(visited.size()==7&&visited.get(0).distanceSquared()==0);
        check(visited.get(1).x()==-1&&visited.get(2).y()==-1);
        AtomicInteger calls=new AtomicInteger();
        var one=BlockSearch.find(0,64,0,16,1,cell->true,cell->{calls.incrementAndGet();return cell;});
        check(one.size()==1&&calls.get()==1);
        calls.set(0);
        rejects(()->BlockSearch.find(0,64,0,16,1,cell->true,cell->{calls.incrementAndGet();return null;}));
        check(calls.get()==BlockSearch.MAX_VISIBILITY_CHECKS);
        check(BlockSearch.find(0,64,0,16,1,cell->false,cell->{throw new AssertionError();}).isEmpty());
        rejects(()->BlockSearch.find(Double.NaN,0,0,1,1,cell->true,cell->cell));
        rejects(()->BlockSearch.find(0,0,0,17,1,cell->true,cell->cell));
        rejects(()->BlockSearch.find(0,0,0,1,65,cell->true,cell->cell));
        System.out.println("Native block search: nearest order, negative/fractional coordinates, sphere bounds, unknowns and visibility budget passed");
    }
}
