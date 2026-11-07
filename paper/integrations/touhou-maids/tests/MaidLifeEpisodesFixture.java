import com.google.gson.*;
import local.tlmcompat.hybrid.MaidLifeEpisodes;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

public final class MaidLifeEpisodesFixture {
    private static final UUID OWNER=UUID.fromString("10000000-0000-0000-0000-000000000001"),MAID=UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static int checks;
    private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);checks++;}
    private static JsonObject facts(){JsonObject j=new JsonObject();j.addProperty("name","Synthetic maid");j.addProperty("dimension","minecraft:overworld");j.add("position",JsonParser.parseString("[2,90,0]"));return j;}
    private static JsonObject grave(long at,String tomb){JsonObject j=facts();j.addProperty("maidId",MAID.toString());j.addProperty("ownerId",OWNER.toString());j.addProperty("eventId","death-"+at);j.addProperty("diedAt",Instant.ofEpochMilli(at).toString());j.addProperty("tombstoneId",tomb);j.addProperty("evidence","original_tlm_tombstone");return j;}
    private static String state(JsonObject j){return j.get("lifeState").getAsString();}
    private static String event(JsonObject j,String field){return j.getAsJsonObject(field).get("eventId").getAsString();}
    public static void main(String[] args)throws Exception {
        JsonObject root=new JsonObject(),old=grave(1000,"old-grave");root.add(MAID.toString(),old.deepCopy());
        MaidLifeEpisodes ledger=new MaidLifeEpisodes(root);
        JsonObject migrated=ledger.view(OWNER,MAID,2000,null,old);
        check(state(migrated).equals("unloaded_or_unavailable")&&!migrated.has("death"),"legacy grave alone is not current death");
        check(migrated.has("historicalDeath"),"legacy evidence is retained");
        JsonObject alive=ledger.view(OWNER,MAID,3000,facts(),old);String recovered=event(alive,"recovery");
        check(state(alive).equals("alive")&&!alive.has("death"),"live entity wins over old grave");
        check(!ledger.durable(recovered),"recovery is not durable before save");
        check(!alive.getAsJsonObject("recovery").get("actualRevivalTimeKnown").getAsBoolean(),"observation is not invented revival time");
        check(recovered.length()<=48,"server event fits bounded request ids");
        ledger.saved();check(ledger.durable(recovered),"successful save acknowledges recovery");
        JsonObject missing=ledger.view(OWNER,MAID,3500,null,old);
        check(state(missing).equals("unloaded_or_unavailable")&&!missing.has("death"),"unload cannot resurrect old death");
        check(event(missing,"recovery").equals(recovered),"recovery event is stable across reads");
        Path saved=Files.createTempFile("synthetic-maid-life-",".json");Files.writeString(saved,root.toString());
        JsonObject reopened=JsonParser.parseString(Files.readString(saved)).getAsJsonObject();Files.delete(saved);
        ledger=new MaidLifeEpisodes(reopened);JsonObject restarted=ledger.view(OWNER,MAID,4000,null,old);
        check(state(restarted).equals("unloaded_or_unavailable")&&!restarted.has("death"),"reboot preserves resolved episode");
        check(event(restarted,"recovery").equals(recovered),"reboot keeps the same recovery id");
        check(reopened.getAsJsonObject(MAID.toString()).equals(old),"legacy death entry is retained verbatim");
        JsonObject second=grave(5000,"second-grave");ledger.died(OWNER,MAID,5000,facts(),second);
        JsonObject dead=ledger.view(OWNER,MAID,5100,null,second);String died=event(dead,"death");
        check(state(dead).equals("dead")&&!dead.has("recovery"),"new actual death opens a new episode");
        check(dead.getAsJsonObject("death").get("tombstoneId").getAsString().equals("second-grave"),"new death points to new grave");
        ledger.died(OWNER,MAID,5200,facts(),second);check(event(ledger.view(OWNER,MAID,5300,null,second),"death").equals(died),"duplicate native callbacks are one event");
        check(event(ledger.view(OWNER,MAID,5400,null,old),"death").equals(died),"old grave cannot replace newer current death");
        JsonObject secondAlive=ledger.view(OWNER,MAID,5500,facts(),second);String recovery2=event(secondAlive,"recovery");
        check(!recovery2.equals(recovered),"second recovery has a different event");
        check(state(ledger.view(OWNER,MAID,5600,null,second)).equals("unloaded_or_unavailable"),"same-second recovery advances death watermark");
        JsonObject snapshot=JsonParser.parseString(reopened.toString()).getAsJsonObject();ledger=new MaidLifeEpisodes(snapshot);
        check(!ledger.view(OWNER,MAID,5700,null,second).has("death"),"second recovered episode stays resolved after reboot");
        JsonObject unseen=ledger.view(OWNER,MAID,6000,null,null);check(!unseen.has("death"),"missing grave is not a new death");
        JsonObject third=grave(7000,"third-grave");check(state(ledger.view(OWNER,MAID,7100,null,third)).equals("dead"),"newer grave after known alive can confirm offline death");
        JsonObject future=grave(999999,"future-grave");JsonObject fresh=new JsonObject();MaidLifeEpisodes unknown=new MaidLifeEpisodes(fresh);
        check(state(unknown.view(OWNER,MAID,1000,null,future)).equals("unloaded_or_unavailable"),"future timestamp cannot invent a death");
        JsonObject foreign=grave(1000,"foreign-grave");foreign.addProperty("ownerId",UUID.randomUUID().toString());
        check(!unknown.view(OWNER,MAID,2000,null,foreign).has("historicalDeath"),"foreign owner evidence is not disclosed");
        unknown.died(OWNER,MAID,3000,facts(),null);JsonObject pending=unknown.view(OWNER,MAID,3100,null,null);String before=event(pending,"death");
        check(state(pending).equals("dead"),"native death is sufficient before tombstone appears");
        JsonObject delayed=grave(3000,"delayed-grave");check(event(unknown.view(OWNER,MAID,3200,null,delayed),"death").equals(before),"delayed tombstone enriches the same event");
        JsonObject fourth=grave(4000,"different-grave");check(!event(unknown.view(OWNER,MAID,4100,null,fourth),"death").equals(before),"different newer grave is a different episode");
        JsonObject output=ledger.view(OWNER,MAID,7200,null,third);output.getAsJsonObject("death").addProperty("name","mutated caller");
        check(!ledger.view(OWNER,MAID,7300,null,third).getAsJsonObject("death").get("name").getAsString().equals("mutated caller"),"caller cannot mutate stored facts");
        UUID anotherOwner=UUID.fromString("10000000-0000-0000-0000-000000000002");
        JsonObject transferred=ledger.view(anotherOwner,MAID,8000,facts(),null);
        check(state(transferred).equals("alive")&&!transferred.has("historicalDeath")&&!transferred.has("recovery"),"new verified owner does not inherit another owner's death history");
        check(state(ledger.view(OWNER,MAID,8100,null,third)).equals("dead"),"separate owner records do not overwrite earlier evidence");
        System.out.println("MaidLifeEpisodesFixture: "+checks+" checks passed; synthetic data only");
    }
}
