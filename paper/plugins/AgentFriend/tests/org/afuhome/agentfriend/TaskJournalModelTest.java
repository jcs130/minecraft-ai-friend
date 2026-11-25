package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

public final class TaskJournalModelTest {
    static int checks;
    static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    static JsonObject source(String state) { var out=new JsonObject();out.addProperty("state",state);out.addProperty("runId","same-original-run");out.addProperty("nextCommand","/mycli guild exam status");return out; }
    static JsonObject item(String group, String id, String state) { return TaskJournalModel.item(group,"assessment",id,id,source(state),"/mycli guild exam status","/mycli guild exam submit"); }
    static void rejects(Runnable operation) { boolean rejected=false;try{operation.run();}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"must reject"); }
    public static void main(String[] ignored) {
        for(String state:List.of("submitted","completed","claimed","complete","won")) check(TaskJournalModel.state(state).equals("complete"),"confirmed terminal mapping "+state);
        for(String state:List.of("active","paused","needs_verification","sampling")) check(TaskJournalModel.state(state).equals("active"),"live phase retains active "+state);
        for(String state:List.of("unknown","unavailable"))check(TaskJournalModel.state(state).equals("unavailable"),"unknown never complete");
        for(String state:List.of("cancelled","expired","failed")) {
            var raw=source(state);raw.addProperty("ready",true);
            var row=TaskJournalModel.item("guild","assessment","shelter_basic","小屋",raw,"/mycli guild exam status","/mycli guild exam submit");
            check(row.get("state").getAsString().equals(state),"stale ready cannot override terminal");
            check(!row.has("submitCommand"),"terminal has no resubmission");
        }
        var raw=source("active");raw.addProperty("readOnly",false);var missing=new JsonArray();missing.add("roof");raw.add("missingProofs",missing);
        JsonObject before=raw.deepCopy();var row=TaskJournalModel.item("guild","assessment","shelter_basic","小屋",raw,"/mycli guild exam status","/mycli guild exam submit");
        check(raw.equals(before),"query does not mutate source");check(row.get("readOnly").getAsBoolean(),"raw action metadata cannot turn a query into a write");
        check(row.get("runId").getAsString().equals("same-original-run"),"original run retained");
        check(row.getAsJsonArray("missingProofs").get(0).getAsString().equals("roof"),"exact missing proof retained");
        row.getAsJsonArray("missingProofs").add("walls");check(raw.getAsJsonArray("missingProofs").size()==1,"source lists are not shared");
        check(row.get("journalSubmitCommand").getAsString().equals("/mycli journal submit assessment:shelter_basic"),"one authoritative submit route");
        raw.addProperty("canSubmit",false);check(!TaskJournalModel.item("guild","assessment","shelter_basic","小屋",raw,"/mycli guild exam status","/mycli guild exam submit").has("submitCommand"),"missing native proofs cannot offer premature submission");raw.remove("canSubmit");
        raw.addProperty("available",false);var unknown=TaskJournalModel.item("guild","assessment","shelter_basic","小屋",raw,"/mycli guild exam status","/mycli guild exam submit");
        check(unknown.get("state").getAsString().equals("unavailable")&&!unknown.has("submitCommand"),"unavailable snapshot never offers a write");
        raw.addProperty("nextCommand","/mycli guild claim\nstop");check(TaskJournalModel.item("guild","assessment","shelter_basic","小屋",raw,"/mycli guild exam status","").get("nextCommand").getAsString().equals("/mycli guild exam status"),"command injection rejected");
        List<JsonObject> rows=new ArrayList<>();for(int i=0;i<19;i++)rows.add(item(i%2==0?"guild":"skills","topic_"+i,"active"));rows.add(rows.getFirst().deepCopy());
        check(TaskJournalModel.unique(rows).size()==19,"same source identity deduplicated");
        for(int page=1;page<=3;page++){var out=TaskJournalModel.page(rows,"all",page);check(out.getAsJsonArray("items").size()<=7,"max seven rows");check(out.get("total").getAsInt()==19,"page totals stable");check(out.getAsJsonArray("groups").size()==2,"only two progress groups");}
        check(TaskJournalModel.page(rows,"guild",1).get("total").getAsInt()==10,"guild filter");check(TaskJournalModel.page(rows,"skills",1).get("total").getAsInt()==9,"skills filter");
        check(TaskJournalModel.page(List.of(),"all",1).getAsJsonArray("items").isEmpty(),"empty is empty, not fabricated completion");
        rejects(()->TaskJournalModel.page(rows,"old_life",1));rejects(()->TaskJournalModel.page(rows,"all",0));rejects(()->TaskJournalModel.page(rows,"all",4));
        rejects(()->TaskJournalModel.item("guild","assessment","invalid\ncommand","x",source("active"),"/mycli journal",""));
        System.out.println("PASS "+checks+" task journal projection checks");
    }
}
