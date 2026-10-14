package dev.maw.client;

import com.google.gson.*;
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
        System.out.println("{\"ok\":true,\"checks\":"+checks+"}");
    }
}
