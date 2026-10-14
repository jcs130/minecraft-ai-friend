package dev.maw.client;

import com.google.gson.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
public final class ActionStoreTest {
    static int checks;
    static void check(boolean b){checks++;if(!b)throw new AssertionError("check_"+checks);}
    public static void main(String[] argv)throws Exception{
        Path root=Path.of(argv[0]);String body="7dbeb982-9bcb-3be9-a0fb-36ca776177cf",server="127.0.0.1:28978";
        var a=JsonParser.parseString("{\"yaw\":0,\"pitch\":15}").getAsJsonObject();
        var b=JsonParser.parseString("{\"pitch\":15,\"yaw\":0}").getAsJsonObject();
        check(ActionStore.fingerprint("control.look",a).equals(ActionStore.fingerprint("control.look",b)));
        check(!ActionStore.fingerprint("control.look",a).equals(ActionStore.fingerprint("body.move",a)));
        ActionStore store=new ActionStore(root,body,server);
        JsonObject record=new JsonObject();record.addProperty("action_id","durable-1");record.addProperty("fingerprint",ActionStore.fingerprint("control.look",a));
        record.addProperty("operation","control.look");record.add("args",a);record.addProperty("terminal",false);record.addProperty("outcomeKnown",true);
        store.accept(record);check(store.unresolvedCount()==1);
        ActionStore reopened=new ActionStore(root,body,server);check(reopened.unresolvedCount()==1);
        var unknown=reopened.get("durable-1");check(unknown.get("terminal").getAsBoolean());check(!unknown.get("outcomeKnown").getAsBoolean());check(unknown.get("status").getAsString().equals("unknown"));
        try{reopened.accept(record);throw new AssertionError("duplicate_accepted");}catch(IllegalStateException expected){check(true);}
        for(String id:new String[]{"../secret","..",".","x/y","x\\y",""})try{reopened.get(id);throw new AssertionError("invalid_id_accepted");}catch(IllegalArgumentException expected){check(true);}
        JsonObject bad=record.deepCopy();bad.addProperty("fingerprint","changed");bad.addProperty("terminal",true);
        try{reopened.finish(bad);throw new AssertionError("changed_receipt_accepted");}catch(IllegalStateException expected){check(true);}
        JsonObject result=record.deepCopy();result.addProperty("terminal",true);result.addProperty("status","succeeded");
        reopened.finish(result);check(reopened.unresolvedCount()==0);check(new ActionStore(root,body,server).get("durable-1").get("status").getAsString().equals("succeeded"));
        check(new ActionStore(root,body,"127.0.0.1:28979").get("durable-1")==null);
        try{reopened.finish(result);throw new AssertionError("duplicate_terminal_accepted");}catch(IllegalStateException expected){check(true);}
        record.addProperty("action_id","unknown-1");reopened.accept(record);record.addProperty("terminal",true);record.addProperty("status","unknown");record.addProperty("outcomeKnown",false);
        reopened.finish(record);check(reopened.unresolvedCount()==1);check(new ActionStore(root,body,server).unresolvedCount()==1);
        Path evidence=root.resolve("operator-evidence.json").toAbsolutePath();
        var proof=new JsonObject();proof.addProperty("bodyId",body);proof.addProperty("server",server);
        proof.addProperty("action_id","unknown-1");proof.add("fingerprint",record.get("fingerprint"));
        proof.addProperty("summary","Operator reviewed the original unknown action and independent world state; do not replay.");
        Files.writeString(evidence,proof.toString());
        try(var owner=FileChannel.open(root.resolve("instance.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);var lock=owner.lock()) {
            try{ActionStore.auditReleaseOffline(root,body,server,"unknown-1",evidence);throw new AssertionError("live_client_audited");}
            catch(IllegalStateException expected){check(expected.getMessage().equals("client_must_be_closed"));}
        }
        var foreign=proof.deepCopy();foreign.addProperty("bodyId","c0ce7c92-973d-4359-8c1e-e0e19a1ea69c");Files.writeString(evidence,foreign.toString());
        try{ActionStore.auditReleaseOffline(root,body,server,"unknown-1",evidence);throw new AssertionError("foreign_evidence_accepted");}
        catch(IllegalStateException expected){check(expected.getMessage().equals("operator_audit_evidence_mismatch"));}
        Files.writeString(evidence,proof.toString());
        Path original=root.resolve("actions").resolve(ActionStore.hash(server).substring(0,24)).resolve(body).resolve("unknown-1.json");
        byte[] before=Files.readAllBytes(original);
        var audit=ActionStore.auditReleaseOffline(root,body,server,"unknown-1",evidence);
        check(java.util.Arrays.equals(before,Files.readAllBytes(original)));
        check(audit.get("disposition").getAsString().equals("release_new_actions_keep_unknown"));
        var recovered=new ActionStore(root,body,server);check(recovered.unresolvedCount()==0);
        var old=recovered.get("unknown-1");check(old.get("status").getAsString().equals("unknown"));check(!old.get("outcomeKnown").getAsBoolean());
        check(!old.getAsJsonObject("operatorAudit").get("retryAutomatically").getAsBoolean());
        try{ActionStore.auditReleaseOffline(root,body,server,"unknown-1",evidence);throw new AssertionError("duplicate_audit_accepted");}
        catch(IllegalStateException expected){check(expected.getMessage().equals("unknown_action_required"));}
        Files.writeString(evidence,proof.toString()+" ");
        try{new ActionStore(root,body,server);throw new AssertionError("changed_evidence_accepted");}
        catch(IllegalStateException expected){check(expected.getMessage().equals("operator_audit_invalid"));}
        Files.writeString(evidence,proof.toString());
        Files.writeString(original,new String(before,java.nio.charset.StandardCharsets.UTF_8)+" ");
        try{new ActionStore(root,body,server);throw new AssertionError("changed_original_accepted");}
        catch(IllegalStateException expected){check(expected.getMessage().equals("operator_audit_invalid"));}
        Files.write(original,before);
        check(new ActionStore(root,body,server).unresolvedCount()==0);
        JsonObject next=record.deepCopy();next.addProperty("action_id","after-audit");next.addProperty("terminal",false);next.addProperty("outcomeKnown",true);
        recovered.accept(next);check(recovered.unresolvedCount()==1);next.addProperty("terminal",true);next.addProperty("status","succeeded");
        recovered.finish(next);check(recovered.unresolvedCount()==0);
        check(recovered.get("unknown-1").get("status").getAsString().equals("unknown"));
        System.out.println("{\"ok\":true,\"checks\":"+checks+"}");
    }
}
