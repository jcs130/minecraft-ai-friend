package dev.qiandeng.maw.taunative;
import com.google.gson.*;
import java.nio.file.*;
public final class NativePolicyTest {
    static int checks;
    static void check(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    public static void main(String[] args)throws Exception{
        var policy=new NativePolicy(JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject());
        var schema=policy.operation("inventory.inspect").getAsJsonObject("parameters");
        check(NativePolicy.validate(JsonParser.parseString("{\"slot\":36}"),schema,"args")==null,"valid slot");
        check(NativePolicy.validate(JsonParser.parseString("{\"slot\":\"36\"}"),schema,"args").field().equals("args.slot"),"no numeric-string coercion");
        check(NativePolicy.validate(JsonParser.parseString("{\"slot\":46}"),schema,"args")!=null,"slot bound");
        check(NativePolicy.validate(JsonParser.parseString("{\"to\":[1,2,3]}"),schema,"args").field().equals("args.slot"),"missing target remains an error");
        check(NativePolicy.validate(JsonParser.parseString("{\"slot\":36,\"to\":2}"),schema,"args").field().equals("args.to"),"unknown field remains an error");
        check(policy.query("body_snapshot").get("id").getAsString().equals("body.snapshot"),"contract dispatch");
        check(policy.query("maid.spawn")==null,"no invented remote operations");
        var a=JsonParser.parseString("{\"b\":2,\"a\":{\"y\":1,\"x\":0}}");
        var b=JsonParser.parseString("{\"a\":{\"x\":0,\"y\":1},\"b\":2}");
        check(NativePolicy.canonical(a).equals(NativePolicy.canonical(b)),"equivalent JSON order fingerprints equally");
        var receipts=new NativePolicy.Receipts(2,100);var done=JsonParser.parseString("{\"status\":\"completed\",\"changed\":true}").getAsJsonObject();
        receipts.put("a","fp-a",0,done);done.addProperty("changed",false);
        check(receipts.get("a",1).receipt().get("changed").getAsBoolean(),"immutable receipt copy");
        receipts.put("b","fp-b",2,new JsonObject());receipts.put("c","fp-c",3,new JsonObject());
        check(receipts.get("a",4)==null&&receipts.get("b",4)!=null,"bounded retention");
        check(receipts.get("c",103)==null&&receipts.empty(104),"expired receipts remain unknown");
        check(policy.limit("receiptsPerPlayer")==128&&policy.limit("receiptTtlMs")==300000,"contract owns runtime budgets");
        var huge=JsonParser.parseString("{\"kind\":\"action_receipt\",\"status\":\"completed\",\"changed\":true,\"outcomeKnown\":true,\"requestId\":\"once\"}").getAsJsonObject();
        huge.addProperty("state","x".repeat(70000));
        var bounded=NativePolicy.bounded(huge,65536);
        check(bounded.get("changed").getAsBoolean()&&bounded.get("outcomeKnown").getAsBoolean()&&bounded.get("status").getAsString().equals("completed"),"state budget never changes confirmed action outcome");
        check(bounded.get("state").isJsonNull()&&bounded.get("stateUnavailable").getAsBoolean()&&bounded.toString().length()<65536,"over budget state is explicitly unavailable");
        check(huge.get("state").getAsString().length()==70000,"bounded wire response does not mutate ledger");
        System.out.println("NativePolicy: "+checks+" checks passed");
    }
}
