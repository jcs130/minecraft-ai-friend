package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Lifecycle/idempotency regression tests. No server, production files or network access. */
public final class MaidBodyControlTest {
    private static int checks;
    private static final UUID OWNER=UUID.fromString("20000000-0000-0000-0000-000000000021");
    private static final UUID MAID=UUID.fromString("10000000-0000-0000-0000-000000000011");
    private static final UUID FIRST=UUID.randomUUID(), SECOND=UUID.randomUUID();
    private static void check(boolean condition,String title){if(!condition)throw new AssertionError(title);checks++;}
    @FunctionalInterface private interface Call{void run()throws Exception;}
    private static void fault(String code,Call call)throws Exception{try{call.run();throw new AssertionError("missing "+code);}catch(MaidBodyControl.Fault e){check(e.code.equals(code),code+" received "+e.code);}}
    private static JsonObject json(String raw){return JsonParser.parseString(raw).getAsJsonObject();}
    public static void main(String[] args)throws Exception {
        Path root=Path.of(args[0]);var bindings=Map.of(MAID,OWNER);var control=new MaidBodyControl(root,bindings);
        fault("NOT_AUTHORIZED",()->control.bind(SECOND,MAID,FIRST,1000));
        check(!control.active(MAID),"authorization refusal has no side effect");
        var first=control.bind(OWNER,MAID,FIRST,1000);check(control.active(MAID),"binding activates one controller");
        check(first.generation().equals(control.bind(OWNER,MAID,FIRST,2000).generation()),"bind response retry preserves generation");
        fault("CONTROL_BUSY",()->control.bind(OWNER,MAID,SECOND,3000));
        fault("CONTROL_CHANGED",()->control.require(OWNER,MAID,SECOND,first.generation(),3000));
        check(control.lease(MAID).controller().equals(FIRST),"conflicting controller cannot acquire body");
        var live=control.require(OWNER,MAID,FIRST,first.generation(),10_000);
        check(live.expiresAt()==130_000,"authorized read can renew lease");
        check(control.expired(129_999).isEmpty(),"no premature expiry");
        check(control.expired(130_000).equals(List.of(MAID)),"expiry boundary is exact");
        fault("CONTROL_EXPIRED",()->control.bind(OWNER,MAID,FIRST,130_000));
        check(control.active(MAID),"expired lease held until host stops original body");
        long oldEpoch=control.epoch(MAID);control.release(MAID);
        check(!control.active(MAID)&&control.epoch(MAID)>oldEpoch,"release invalidates delayed native callbacks");
        var second=control.bind(OWNER,MAID,SECOND,140_000);
        check(!second.generation().equals(first.generation()),"handoff issues different generation");
        fault("CONTROL_CHANGED",()->control.require(OWNER,MAID,FIRST,first.generation(),140_001));
        var restarted=new MaidBodyControl(root,bindings);
        check(!restarted.active(MAID),"restart never restores an in-memory controller lease");
        fault("CONTROL_CHANGED",()->restarted.require(OWNER,MAID,SECOND,second.generation(),140_002));
        fault("INVALID_ownerId",()->MaidBodyControl.uuid(json("{\"ownerId\":\"1-1-1-1-1\"}"),"ownerId"));
        fault("INVALID_ownerId",()->MaidBodyControl.uuid(json("{\"ownerId\":42}"),"ownerId"));
        fault("INVALID_requestId",()->control.read(MAID,"../../escape"));
        var walk=json("{\"action\":\"walk\",\"requestId\":\"walk-1\",\"x\":10,\"y\":64,\"z\":20}");
        check(control.reserve(OWNER,MAID,"walk-1",walk)==null,"first request persisted before world dispatch");
        var accepted=restarted.read(MAID,"walk-1");
        check(accepted.get("status").getAsString().equals("accepted")&&!accepted.get("terminal").getAsBoolean(),"second instance sees durable acceptance without inventing completion");
        var reordered=json("{\"z\":20,\"action\":\"walk\",\"y\":64,\"x\":10,\"requestId\":\"walk-1\"}");
        check(control.reserve(OWNER,MAID,"walk-1",reordered)!=null,"JSON key order does not redispatch a write");
        check(control.reserve(OWNER,MAID,"walk-1",json("{\"action\":\"walk\",\"requestId\":\"walk-1\",\"x\":1e1,\"y\":64.0,\"z\":20.00}"))!=null,"equivalent integer, decimal and exponent coordinates share the original receipt");
        check(!MaidBodyControl.canonical(json("{\"text\":\"81.0\"}")).equals(MaidBodyControl.canonical(json("{\"text\":\"81\"}"))),"numeric-looking dialogue strings are never normalized");
        check(MaidBodyControl.canonical(json("{\"x\":1e1000000}")).length()<40,"canonical exponent does not allocate an unbounded decimal expansion");
        var changed=walk.deepCopy();changed.addProperty("x",11);
        fault("REQUEST_CONFLICT",()->control.reserve(OWNER,MAID,"walk-1",changed));
        check(restarted.read(MAID,"walk-1").get("arguments").getAsString().equals(MaidBodyControl.canonical(walk)),"conflict preserves original target");
        var observation=json("{\"arrived\":false,\"actualPosition\":{\"x\":9,\"y\":64,\"z\":20}}");
        var running=control.finish(MAID,"walk-1","running",observation);
        check(!running.get("goalCompleted").getAsBoolean()&&!running.get("terminal").getAsBoolean(),"movement started is not arrival");
        var unknown=control.finish(MAID,"walk-1","unknown",json("{\"reason\":\"restart_or_execution_interrupted\"}"));
        check(!unknown.get("retryAllowed").getAsBoolean()&&!unknown.get("goalCompleted").getAsBoolean(),"unknown execution never authorizes replay");
        observation.addProperty("arrived",true);var done=control.finish(MAID,"walk-1","completed",observation);
        check(done.get("goalCompleted").getAsBoolean()&&done.get("terminal").getAsBoolean()&&done.has("actualPosition"),"arrival includes measured location");
        check(restarted.reserve(OWNER,MAID,"walk-1",walk).get("status").getAsString().equals("completed"),"duplicate after restart returns original terminal receipt");
        var setting=json("{\"action\":\"task\",\"requestId\":\"task-1\",\"taskId\":\"touhou_little_maid:idle\"}");control.reserve(OWNER,MAID,"task-1",setting);
        check(!control.finish(MAID,"task-1","applied",json("{\"effectsApplied\":true}")).get("goalCompleted").getAsBoolean(),"selecting task does not claim work complete");
        check(control.read(MAID,"missing")==null,"missing history stays missing");
        Files.writeString(root.resolve(MAID.toString()).resolve("broken.json"),"{}");
        fault("RECEIPT_UNAVAILABLE",()->control.read(MAID,"broken"));
        fault("RECEIPT_UNAVAILABLE",()->control.reserve(OWNER,MAID,"broken",walk));
        var tool=MaidBodyControl.tool();var schema=tool.getAsJsonObject("inputSchema");var names=schema.getAsJsonObject("properties").getAsJsonObject("action").getAsJsonArray("enum");
        check(names.size()==MaidBodyControl.READS.size()+MaidBodyControl.WRITES.size(),"advertised action set matches executor policy");
        check(!schema.getAsJsonObject("properties").has("choice")&&!schema.get("additionalProperties").getAsBoolean(),"brain reads cannot advertise brain mutation");
        check(!MaidBodyControl.WRITES.contains("craft")&&!MaidBodyControl.WRITES.contains("transfer"),"unsupported native operations are not promised");
        check(MaidBodyControl.WRITES.containsAll(Set.of("companion","cast"))&&MaidBodyControl.READS.contains("spells"),"delegated native behaviour and original spells discoverable");
        fault("INVALID_spellId",()->MaidBodyControl.validateShape(json("{\"action\":\"cast\",\"requestId\":\"spell-1\"}")));
        fault("UNEXPECTED_FIELD",()->MaidBodyControl.validateShape(json("{\"action\":\"companion\",\"requestId\":\"c-1\",\"ownerId\":\"fake\"}")));
        long epoch=control.epoch(MAID);control.invalidateCallbacks(MAID);
        check(control.epoch(MAID)>epoch,"external mode transition invalidates old native brain callbacks");
        fault("INVALID_y",()->MaidBodyControl.validateShape(json("{\"action\":\"walk\",\"requestId\":\"x\",\"x\":1,\"z\":2}")));
        fault("UNEXPECTED_FIELD",()->MaidBodyControl.validateShape(json("{\"action\":\"brain\",\"choice\":\"native\"}")));
        check(schema.getAsJsonArray("oneOf").size()==names.size(),"per-action required fields and accepted fields share the runtime contract");
        check(MaidBodyControl.WRITES.contains("dismount"),"a seated body advertises an explicit dismount action");
        MaidBodyControl.validateShape(json("{\"action\":\"dismount\",\"requestId\":\"dismount-1\"}"));
        fault("UNEXPECTED_FIELD",()->MaidBodyControl.validateShape(json("{\"action\":\"dismount\",\"requestId\":\"dismount-1\",\"enabled\":true}")));
        fault("UNEXPECTED_FIELD",()->MaidBodyControl.validateShape(json("{\"action\":\"guard\",\"requestId\":\"guard-1\",\"enabled\":true}")));
        var meet = new JsonObject();
        meet.addProperty("action", "rendezvous");
        meet.addProperty("requestId", "meet-1");
        fault("INVALID_targetUuid", () -> MaidBodyControl.validateShape(meet));
        meet.addProperty("targetUuid", "1-1-1-1-1");
        fault("INVALID_targetUuid", () -> MaidBodyControl.validateShape(meet));
        meet.addProperty("targetUuid", FIRST.toString());
        MaidBodyControl.validateShape(meet);
        var injected = meet.deepCopy();
        injected.addProperty("x", 1);
        fault("UNEXPECTED_FIELD", () -> MaidBodyControl.validateShape(injected));
        check(control.reserve(OWNER, MAID, "meet-1", meet) == null, "reserve the original skill cast once");
        var effect = new JsonObject();
        effect.addProperty("arrived", true);
        effect.addProperty("manaCost", 8);
        var settled = control.finish(MAID, "meet-1", "completed", effect);
        check(settled.equals(restarted.reserve(OWNER, MAID, "meet-1", meet)), "retry returns original arrival and cost");
        meet.addProperty("targetUuid", SECOND.toString());
        fault("REQUEST_CONFLICT", () -> control.reserve(OWNER, MAID, "meet-1", meet));
        System.out.println("Native body control: "+checks+" checks passed");
    }
}
