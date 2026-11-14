package org.afuhome.agentfriend;
import com.google.gson.*;
import java.util.List;
/** Exact old help fails the expiry assertion; native actions are covered by the marked game probe. */
public final class StashGuidanceCatalogTest {
    private static int checks;
    private static void check(boolean value,String why){if(!value)throw new AssertionError(why);checks++;}
    private static JsonObject help(String s){return AgentCliCatalog.helpData((s+" --help").split(" +"),List.of(),true);}
    public static void main(String[]args){
        var quote=help("trade recycle quote");
        check(quote.get("summary").getAsString().contains("300秒")&&!quote.get("summary").getAsString().contains("30秒"),"trade quote help uses the actual five-minute lifetime");
        check(quote.get("summary").getAsString().contains("expiresAt"),"server expiry remains authoritative");
        var tidy=help("inventory tidy");
        check(!tidy.has("errorCode")&&tidy.get("jsonSupported").getAsBoolean(),"tidy is discoverable and returns JSON");
        check(tidy.get("usage").getAsString().contains("--dry-run")&&tidy.get("usage").getAsString().contains("--discard-common"),"preview and explicit discard are discoverable");
        check(!tidy.get("actionReadOnly").getAsBoolean(),"actual tidy is an item mutation");
        var status=help("inventory tidy auto status");
        check(status.get("actionReadOnly").getAsBoolean(),"auto status is read only");
        for(String action:List.of("on","off"))check(!help("inventory tidy auto "+action).get("actionReadOnly").getAsBoolean(),"auto setting writes are explicit: "+action);
        check(help("inventory tidy stash auto status").get("actionReadOnly").getAsBoolean(),"stash auto status is discoverable and read only");
        for(String action:List.of("on","off"))check(!help("inventory tidy stash auto "+action).get("actionReadOnly").getAsBoolean(),"stash auto settings are explicit: "+action);
        check(help("arena stash putslot").toString().contains("stash_full"),"deposit failure has an actionable alternative");
        var overview=help("arena stash summary");
        check(overview.get("actionReadOnly").getAsBoolean()&&overview.get("jsonSupported").getAsBoolean(),"whole-stash overview is a real JSON read");
        check(overview.get("consumption").getAsString().equals("无游戏内资源消耗"),"whole-stash overview is free");
        check(overview.get("resultQuery").getAsString().equals(PersonalStashOverview.QUERY),"copyable JSON query");
        check(help("arena stash").getAsJsonArray("commands").get(0).getAsJsonObject().get("name").getAsString().equals("summary"),"overview is first in stash help");
        check(!PersonalStashOverview.matchesCommand(new String[]{"arena","stash","take","1"}),"overview cannot intercept item transfers");
        check(tidy.get("resultQuery").getAsString().contains("不重放"),"unknown save results cannot be retried as completion");
        System.out.println("PASS "+checks+" stash guidance catalog assertions");
    }
}
