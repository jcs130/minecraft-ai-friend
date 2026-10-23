import com.google.gson.JsonObject;
import org.agentmc.bridge.ControlLedger;
import java.nio.file.Files;
public final class ControlLedgerCheck {
    private static void check(boolean value) { if (!value) throw new AssertionError("Control/ledger invariant failed"); }
    private static void rejected(Runnable operation) { try { operation.run(); } catch (IllegalStateException|IllegalArgumentException expected) { return; } throw new AssertionError("Expected rejection"); }
    public static void main(String[] args) throws Exception {
        var directory=Files.createTempDirectory("agent-mc-control-check-");var ledger=new ControlLedger(directory);
        var claim=ledger.claim("first",1000,100);var nonce=claim.get("nonce").getAsString();
        ledger.require("first",nonce,100);rejected(()->ledger.claim("second",1000,200));rejected(()->ledger.require("first","wrong",200));
        ledger.renew("first",nonce,1000,500);check(ledger.active(1499));check(!ledger.active(1500));
        var next=ledger.claim("second",1000,1501);check(!next.get("nonce").getAsString().equals(nonce));
        JsonObject input=new JsonObject();input.addProperty("forward",true);input.addProperty("ticks",5);
        var action=ledger.admit("stable-action","move",input,1600);check(ledger.admit("stable-action","move",input,1601)==action);
        JsonObject changed=new JsonObject();changed.addProperty("forward",false);
        try {ledger.admit("stable-action","move",changed,1602);throw new AssertionError("Conflicting action replayed");}catch(IllegalArgumentException expected){}
        var recovered=new ControlLedger(directory);check(recovered.get("stable-action").phase.equals("unknown"));
        ledger.finish(action,"cancelled","stopped",new JsonObject(),1700);ledger.finish(action,"completed",null,new JsonObject(),1800);check(action.phase.equals("cancelled"));
        ledger.release();check(!ledger.active(1800));
        System.out.println("Native lease exclusion/expiry, durable deduplication, unknown recovery and no terminal revival passed");
    }
}
