package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Pre-dispatch cast failure settlement. A not_found service ledger row proves the spell never
 * reached the RPG service; the original request settles rejected with evidence, never replayed.
 * No server, production files or network access.
 */
public final class CastPreDispatchTest {
    private static int checks;
    private static final UUID OWNER=UUID.fromString("20000000-0000-0000-0000-000000000021");
    private static final UUID MAID=UUID.fromString("10000000-0000-0000-0000-000000000011");
    private static void check(boolean condition,String title){if(!condition)throw new AssertionError(title);checks++;}
    @FunctionalInterface private interface Call{void run()throws Exception;}
    private static void fault(String code,Call call)throws Exception{try{call.run();throw new AssertionError("missing "+code);}catch(MaidBodyControl.Fault e){check(e.code.equals(code),code+" received "+e.code);}}
    private static JsonObject notFound(){return JsonParser.parseString("{\"status\":\"not_found\",\"completed\":false}").getAsJsonObject();}
    private static UUID derived(UUID maid,String request){return UUID.nameUUIDFromBytes(("unified-cast:"+maid+":"+request).getBytes(StandardCharsets.UTF_8));}
    public static void main(String[] args)throws Exception {
        // The evidence helper is fail-closed: only a definitive not_found row settles a cast.
        check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","unknown",notFound())!=null,"not_found settles an uncertain cast");
        check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","accepted",notFound())!=null,"not_found settles a never-dispatched acceptance");
        check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","running",notFound())==null,"a previously running cast keeps its unresolved audit when the row vanishes");
        for(String status:List.of("completed","rejected","applied","pending"))
            check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1",status,notFound())==null,"terminal or foreign body status "+status+" is never rewritten");
        for(String state:List.of("completed","failed","blocked","rejected","cancelled","accepted","pending","running","unknown"))
            check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","unknown",JsonParser.parseString("{\"status\":\""+state+"\"}").getAsJsonObject())==null,"service state "+state+" is not a pre-dispatch proof");
        check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","unknown",new JsonObject())==null,"missing service status is not a proof");
        check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","unknown",JsonParser.parseString("{\"status\":7}").getAsJsonObject())==null,"non-string service status is not a proof");
        check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","unknown",null)==null,"absent service receipt is not a proof");
        var evidence=MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","unknown",notFound());
        check(evidence.get("reason").getAsString().equals("native_failure_before_service_dispatch"),"evidence names the pre-dispatch failure");
        check(!evidence.get("effectsApplied").getAsBoolean(),"no spell or mana effect is claimed");
        check(evidence.get("serviceRequestId").getAsString().equals(derived(MAID,"hs_cast1").toString()),"evidence carries the original derived service request ID");
        check(!evidence.get("serviceRequestId").getAsString().equals(derived(MAID,"hs_cast2").toString()),"a different request never shares the service ID");
        check(evidence.getAsJsonObject("serviceReceipt").get("status").getAsString().equals("not_found"),"original service answer is preserved for audit");
        var service=notFound();var copy=MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast1","unknown",service);
        copy.getAsJsonObject("serviceReceipt").addProperty("status","tampered");
        check(service.get("status").getAsString().equals("not_found"),"evidence deep-copies the service receipt");
        // Durable settlement through the real receipt journal: terminal, no replay, restart-safe.
        Path root=Path.of(args[0]);var control=new MaidBodyControl(root,Map.of(MAID,OWNER));
        var cast=JsonParser.parseString("{\"action\":\"cast\",\"requestId\":\"hs_cast1\",\"spellId\":\"radiant_pulse\"}").getAsJsonObject();
        check(control.reserve(OWNER,MAID,"hs_cast1",cast)==null,"original cast reserved before dispatch");
        var settled=control.finish(MAID,"hs_cast1","rejected",evidence);
        check(settled.get("terminal").getAsBoolean()&&!settled.get("goalCompleted").getAsBoolean()&&!settled.get("retryAllowed").getAsBoolean(),"rejection is terminal without success or replay permission");
        check(settled.getAsJsonObject("observation").get("reason").getAsString().equals("native_failure_before_service_dispatch"),"journal keeps the failure evidence");
        check(control.read(MAID,"hs_cast1").equals(settled),"read returns the settled rejection");
        check(control.reserve(OWNER,MAID,"hs_cast1",cast).equals(settled),"duplicate original request returns the terminal receipt, never a new dispatch");
        var changed=cast.deepCopy();changed.addProperty("spellId","starbolt");
        fault("REQUEST_CONFLICT",()->control.reserve(OWNER,MAID,"hs_cast1",changed));
        var restarted=new MaidBodyControl(root,Map.of(MAID,OWNER));
        check(restarted.read(MAID,"hs_cast1").get("status").getAsString().equals("rejected"),"restart keeps the audited rejection");
        check(restarted.reserve(OWNER,MAID,"hs_cast1",cast).get("terminal").getAsBoolean(),"restart never reopens the settled request");
        // An unknown service answer (interrupted after persistence) must NOT settle here.
        var interrupted=JsonParser.parseString("{\"status\":\"unknown\",\"reason\":\"interrupted_query_service_state_do_not_replay\"}").getAsJsonObject();
        check(MaidBodyControl.castPreDispatchEvidence(MAID,"hs_cast2","unknown",interrupted)==null,"interrupted service state stays unresolved for manual audit");
        System.out.println("Cast pre-dispatch settlement: "+checks+" checks passed");
    }
}