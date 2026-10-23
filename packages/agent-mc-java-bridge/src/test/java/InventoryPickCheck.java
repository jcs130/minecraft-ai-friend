import org.agentmc.bridge.InventoryPick;
import java.util.*;

public final class InventoryPickCheck {
    private static void check(boolean ok){if(!ok)throw new AssertionError();}
    private static void rejects(Runnable run){try{run.run();throw new AssertionError("Expected rejection");}catch(IllegalArgumentException|IllegalStateException expected){}}
    private static List<String> bag(){List<String> result=new ArrayList<>(Collections.nCopies(41,null));result.set(4,"bread4-components");result.set(30,"seeds23-components");return result;}
    private static List<String> swapped(List<String> before,int source,int selected){List<String> out=new ArrayList<>(before);Collections.swap(out,source,selected);return out;}
    private static void reply(InventoryPick pick,int source,int selected){pick.slot(-2,source);pick.slot(-2,selected);pick.selected(selected);}
    public static void main(String[] args){
        InventoryPick pick=new InventoryPick();List<String> before=bag(),after=swapped(before,30,4);
        rejects(()->pick.begin("invalid:1",36,before,0));rejects(()->pick.begin("empty:1",29,before,0));
        pick.slot(-2,30);pick.selected(4); // Earlier messages must not confirm a later request.
        pick.begin("crop:1",30,before,0);pick.update(after,4,100);check(pick.unresolved());
        pick.slot(12,30);pick.slot(12,40);pick.selected(4);pick.update(after,4,200);check(pick.unresolved()); // Other menus.
        pick.slot(-2,4);pick.update(after,4,300);check(pick.unresolved()); // Missing source response.
        pick.slot(-2,30);pick.update(after,4,400);check(!pick.unresolved());
        check(pick.inspect().get("phase").getAsString().equals("completed"));
        check(pick.inspect().get("actionId").getAsString().equals("crop"));
        // The server, not the adapter, chooses an empty/different hotbar slot.
        pick.begin("crop2:1",30,before,1000);reply(pick,30,7);pick.update(swapped(before,30,7),7,1100);check(!pick.unresolved());
        // Same-name/count is not enough: custom components and count are part of the hash.
        pick.begin("custom:1",30,before,2000);reply(pick,30,4);List<String> wrong=swapped(before,30,4);wrong.set(4,"seeds22-different-components");pick.update(wrong,4,2100);check(pick.inspect().get("phase").getAsString().equals("blocked"));
        // A changed held stack without authoritative packets is never completion.
        pick.begin("lost:1",30,before,3000);pick.update(after,4,8000);check(pick.inspect().get("phase").getAsString().equals("unknown"));
        rejects(pick::requireResolved);rejects(()->pick.begin("replay:1",30,before,8100));
        // Late evidence reconciles the original request, without sending a second one.
        reply(pick,30,4);pick.update(after,4,9000);check(pick.inspect().get("phase").getAsString().equals("completed"));check(pick.inspect().get("id").getAsString().equals("lost:1"));
        // Cancellation cannot revoke a packet that has already been sent.
        pick.begin("cancel:1",30,before,10000);pick.unknown("cancelled locally");rejects(pick::requireResolved);reply(pick,30,4);pick.update(after,4,11000);check(!pick.unresolved());
        // Player menu slots use a different mapping; full sync alone lacks selected-slot evidence.
        pick.begin("full:1",30,before,12000);pick.full(0);pick.update(after,4,12100);check(pick.unresolved());pick.selected(4);pick.update(after,4,12200);check(!pick.unresolved());
        pick.begin("menu:1",30,before,13000);pick.slot(0,30);pick.slot(0,40);pick.selected(4);pick.update(after,4,13100);check(!pick.unresolved());
        pick.begin("disconnect:1",30,before,14000);pick.unknown("disconnected");var old=pick.inspect();pick.newConnection();check(!pick.unresolved());check(old.get("phase").getAsString().equals("unknown"));
        System.out.println("Inventory pick: authoritative slot/selection matching, displaced stack, identity/count mismatch, timeout, late reconciliation, cancellation and connection isolation passed");
    }
}
