package org.afuhome.agentfriend;
import com.google.gson.*;
import java.util.*;
public final class RpgCatalogTest {
    static int n;static void check(boolean value,String name){if(!value)throw new AssertionError(name);n++;}
    static JsonObject help(boolean nativeRpg,String...words){return AgentCliCatalog.helpData(words,List.of(),nativeRpg);}
    public static void main(String[]args){
        var root=help(true,"--help");check(root.getAsJsonArray("commands").size()<=7,"root remains short");
        check(root.getAsJsonArray("commands").get(0).getAsJsonObject().get("name").getAsString().equals("intro"),"guided entry first, not another command root");
        var intro=help(true,"intro","--help");check(intro.get("actionReadOnly").getAsBoolean()&&intro.get("jsonSupported").getAsBoolean(),"intro read-only contract");
        var wallet=help(true,"trade","wallet","--help");check(!wallet.has("errorCode")&&wallet.get("actionReadOnly").getAsBoolean(),"coin query is discoverable and read-only");
        check(wallet.get("jsonSupported").getAsBoolean(),"wallet machine format agrees with implementation");
        check(wallet.get("resultQuery").getAsString().contains("trade wallet"),"coin query does not point to villager ID");
        var menu=help(true,"trade","auction","--help");check(!menu.has("errorCode")&&menu.get("actionReadOnly").getAsBoolean(),"auction status remains pure query");
        check(menu.get("summary").getAsString().contains("交付故障"),"broken auction not advertised as a usable gameplay feature");
        check(help(false,"trade","wallet","--help").has("errorCode"),"legacy backend does not advertise Vortex-only money commands");
        var trade=help(true,"trade","--help");var names=new HashSet<String>();trade.getAsJsonArray("commands").forEach(x->names.add(x.getAsJsonObject().get("name").getAsString()));
        check(names.containsAll(List.of("wallet","auction","find","info","locate")),"native and villager trade share one discovery tree");
        check(trade.getAsJsonArray("commands").size()<=7,"trade help still paginates");
        System.out.println("rpg-catalog="+n);
    }
}
