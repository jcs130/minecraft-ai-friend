package local.qdj.maids.brain;

import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;

public final class ResidentLedgerTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("check "+(checks+1));checks++;}
    interface Attempt{void run()throws Exception;}
    static void reject(String part,Attempt action)throws Exception{
        try{action.run();throw new AssertionError("unexpected success "+part);}catch(IllegalArgumentException|java.io.IOException bad){check(bad.getMessage().contains(part));}
    }
    static String validate(String input){return ResidentContract.validate(JsonParser.parseString(input).getAsJsonObject());}
    public static void main(String[] args)throws Exception{
        Path root=Path.of(args[0]);Files.createDirectories(root);
        check(validate("{\"action\":\"walk\",\"at\":{\"x\":-45,\"y\":67,\"z\":2}}").equals("walk"));
        reject("at: required",()->validate("{\"action\":\"walk\",\"to\":{\"x\":1,\"y\":2,\"z\":3}}"));
        reject("at: exactly",()->validate("{\"action\":\"walk\",\"at\":{\"x\":1,\"z\":3}}"));
        reject("at.y: integer",()->validate("{\"action\":\"walk\",\"at\":{\"x\":1,\"y\":2.1,\"z\":3}}"));
        reject("at.x: integer",()->validate("{\"action\":\"walk\",\"at\":{\"x\":\"1\",\"y\":2,\"z\":3}}"));
        reject("expectedItem: required",()->validate("{\"action\":\"place\",\"at\":{\"x\":1,\"y\":2,\"z\":3},\"face\":\"up\",\"slot\":0}"));
        reject("expectedItem: namespaced",()->validate("{\"action\":\"equip\",\"equipmentSlot\":\"head\",\"slot\":0,\"expectedItem\":\"helmet\"}"));
        reject("command: not a field",()->validate("{\"action\":\"rest\",\"command\":\"op me\"}"));
        reject("channel:",()->validate("{\"action\":\"say\",\"text\":\"secret\",\"channel\":\"private\"}"));
        check(ResidentContract.describe().get("reachBlocks").equals(5));
        UUID body=UUID.randomUUID(),other=UUID.randomUUID(),request=UUID.randomUUID();
        var state=new ResidentState(root.resolve("state"));check(state.load(body)==null);
        state.locate(body,"minecraft:overworld",-100,35);state.begin(body,request);
        var resumed=new ResidentState(root.resolve("state"));check(resumed.load(body).pending().equals(request));
        check(resumed.load(body).chunkX()==-100&&resumed.load(body).chunkZ()==35);
        resumed.locate(body,"minecraft:overworld",-101,35);check(resumed.load(body).pending().equals(request));
        reject("unknown_previous_request",()->resumed.begin(body,UUID.randomUUID()));
        reject("pending_identity_mismatch",()->resumed.finish(body,UUID.randomUUID()));
        var receipts=new ResidentReceipts(root.resolve("receipts"));
        var accepted=Map.<String,Object>of("maidId",body.toString(),"requestId",request.toString(),"status","accepted","completed",false);
        receipts.write(body,request,accepted);check(new ResidentReceipts(root.resolve("receipts")).read(body,request).get("status").equals("accepted"));
        check(new ResidentState(root.resolve("state")).load(body).pending().equals(request)); // accepted never turns into success on restart
        reject("identity_mismatch",()->receipts.write(other,request,accepted));
        reject("oversized",()->receipts.write(body,request,Map.of("maidId",body.toString(),"requestId",request.toString(),"data","x".repeat(66000))));
        check(receipts.read(body,request).get("status").equals("accepted")); // failed replacement preserves original evidence
        resumed.finish(body,request);check(new ResidentState(root.resolve("state")).load(body).pending()==null);
        Files.writeString(root.resolve("state").resolve(other+".json"),"{}");
        reject("identity_mismatch",()->new ResidentState(root.resolve("state")).load(other));
        Path denied=root.resolve("state").resolve(body+".json");Files.delete(denied);Files.createDirectory(denied);Files.writeString(denied.resolve("not-empty"),"test");
        var before=resumed.load(body);reject("",()->resumed.begin(body,UUID.randomUUID()));check(resumed.load(body).equals(before));
        var journal=new CompanionJournal(root.resolve("journal"));UUID speaker=UUID.randomUUID();
        journal.append(body,UUID.randomUUID(),"result",Map.of("maidId",body.toString(),"speakerId",speaker.toString(),"channel","private","reply","secret"));
        journal.append(body,UUID.randomUUID(),"result",Map.of("maidId",body.toString(),"speakerId",speaker.toString(),"channel","public","reply","hello"));
        check(journal.recall(body,speaker,true).size()==2);check(journal.recall(body,speaker,false).size()==1);
        check(journal.recall(body,speaker,false).getFirst().get("reply").equals("hello"));
        check(journal.recall(other,speaker,true).isEmpty());
        var bilingual=CompanionDecision.parse("{\"reply\":\"一起走吧。\",\"spokenReply\":\"一緒に行こう。\",\"action\":\"talk\"}",false);
        check(bilingual.reply().equals("一起走吧。")&&bilingual.spokenReply().equals("一緒に行こう。"));
        check(CompanionDecision.parse("{\"reply\":\"好。\",\"action\":\"talk\"}",false).spokenReply()==null);
        reject("invalid_npc_decision",()->CompanionDecision.parse("{\"reply\":\"好。\",\"spokenReply\":5,\"action\":\"talk\"}",false));
        System.out.println("Resident contract, durability, privacy and bilingual checks passed: "+checks);
    }
}
