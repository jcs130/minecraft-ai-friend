package local.qdj.maids.brain;

import java.nio.file.*;
import java.io.IOException;
import java.util.*;
import com.google.gson.*;

public final class ResidentGoalContextTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("goal context check "+(checks+1));checks++;}
    static void rejected(CompanionJournal journal,UUID id,String reason)throws Exception{
        try{journal.currentGoals(id);throw new AssertionError("accepted "+reason);}catch(IOException error){check(error.getMessage().equals(reason));}
    }
    public static void main(String[] args)throws Exception{
        Path root=Path.of(args[0]);UUID a=UUID.randomUUID(),b=UUID.randomUUID();var journal=new CompanionJournal(root);
        check(((Map<?,?>)journal.currentGoals(a)).get("status").equals("not_configured"));
        var row=new Gson().toJsonTree(Map.of("schemaVersion",1,"maidId",a.toString(),"scope",Map.of("realm","synthetic","account","npc:"+a,"agent",a.toString()),
            "source","agent-mc-goals/v1","semantics","intentions_not_current_world_evidence","status","available","observedAt",System.currentTimeMillis(),
            "goals",List.of(Map.of("slot",1,"text","先交付鲜花，再去采购食物")))).getAsJsonObject();
        var file=root.resolve(a.toString()).resolve("core-goals.json");Files.createDirectories(file.getParent());Files.writeString(file,row.toString());
        check(new Gson().toJson(new CompanionJournal(root).currentGoals(a)).contains("先交付鲜花"));
        check(((Map<?,?>)journal.currentGoals(b)).get("status").equals("not_configured"));
        row.getAsJsonObject("scope").addProperty("agent",b.toString());Files.writeString(file,row.toString());rejected(journal,a,"resident_goal_scope_or_schema_mismatch");
        row.getAsJsonObject("scope").addProperty("agent",a.toString());row.addProperty("status","unavailable");Files.writeString(file,row.toString());rejected(journal,a,"resident_goal_context_unavailable");
        row.addProperty("status","available");row.addProperty("observedAt",System.currentTimeMillis()-400_000);Files.writeString(file,row.toString());rejected(journal,a,"resident_goal_projection_stale");
        row.addProperty("observedAt",System.currentTimeMillis()+120_000);Files.writeString(file,row.toString());rejected(journal,a,"resident_goal_observation_invalid");
        row.addProperty("observedAt",System.currentTimeMillis());row.addProperty("status","not_configured");Files.writeString(file,row.toString());rejected(journal,a,"inactive_goal_context_has_intentions");
        row.add("goals",new JsonArray());Files.writeString(file,row.toString());check(((Map<?,?>)journal.currentGoals(a)).get("status").equals("not_configured"));
        Files.writeString(file,"{");rejected(journal,a,"resident_goal_context_invalid");check(Files.readString(file).equals("{"));
        System.out.println("Core goal projection identity, freshness and restart checks passed: "+checks);
    }
}
