package org.afuhome.agentfriend;
import com.google.gson.*;
import java.util.*;
public final class NativeCliCatalogTest {
    static int checks;
    static void check(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    static JsonObject help(String text){return AgentCliCatalog.helpData(text.split(" +"),List.of(),true);}
    public static void main(String[] args){
        var root=help("--help");check(root.getAsJsonArray("commands").size()==7,"small first page");
        var commands=AgentCliText.help(root).stream().filter(line->line.startsWith("/mycli ")).toList();
        check(commands.getFirst().startsWith("/mycli intro：")&&commands.get(1).startsWith("/mycli status："),"native help leads with the guided next step and copyable status");
        Set<String> groups=new HashSet<>();int pages=root.get("pages").getAsInt();
        for(int page=1;page<=pages;page++){var h=help("--help --page "+page);check(h.getAsJsonArray("commands").size()<=7,"bounded roots");for(var v:h.getAsJsonArray("commands"))check(groups.add(v.getAsJsonObject().get("name").getAsString()),"unique root");}
        for(String group:List.of("rules","inventory","guild","arena","archive","photo","protect","world","dungeon","profession","skills","tasks","progress"))check(groups.contains(group),"discover "+group);
        for(String alias:List.of("spells info fortify","skills explain fortify","rpg class choose knight","quests accept first_blood"))check(!help(alias+" --help").has("errorCode"),"alias "+alias);
        for(String line:List.of("profession status","skills info fortify","skills tree","tasks info first_blood","tasks status first_blood","status")){var h=help(line+" --help");check(h.get("actionReadOnly").getAsBoolean(),"read only "+line);check(h.get("consumption").getAsString().equals("无游戏内资源消耗"),"no fee "+line);}
        for(String line:List.of("profession choose knight","skills learn knight_guard","skills prepare fortify","tasks accept first_blood","tasks claim first_blood","cast fortify","skills menu")){var h=help(line+" --help");check(!h.get("actionReadOnly").getAsBoolean(),"explicit action "+line);check(h.get("jsonSupported").getAsBoolean(),"format described "+line);}
        check(help("skills upgrade --help").has("errorCode"),"retired upgrade absent");
        check(!help("skills info fortify --help").get("resultQuery").getAsString().contains("skills points"),"no old point query fanout");
        check(help("arena stash --help").toString().contains("2魔力"),"personal stash cost discoverable");
        check(help("guild shared --help").toString().contains("共享"),"shared supplies discoverable");
        for(String alias:List.of("list","info","join","gui"))check(!help("guild party "+alias+" --help").has("errorCode"),"party alias discoverable "+alias);
        check(help("guild party status --help").get("actionReadOnly").getAsBoolean(),"party status read-only");
        check(help("guild party accept --help").get("resultQuery").getAsString().equals("/mycli guild party status"),"party action checks native membership");
        for(String id:NativeRpg.COMMON_IDS){var h=help("cast "+id+" --help");check(!h.has("errorCode")&&!h.get("jsonSupported").getAsBoolean(),"common format honest "+id);check(String.join("\n",AgentCliText.help(h)).contains("不支持 --json")&&h.get("requirements").getAsString().contains("skills info "+id),"visible common format and effect lookup documented "+id);}
        for(String name:List.of("寒霜","星芒箭","闪现","归乡","圣愈术","饱食术","造物术"))check(NativeRpg.common(name),"requested Chinese common alias "+name);
        check(NativeRpg.COMMON.equals(Set.copyOf(org.qiandengji.vortex.SkillTransition.COMMON)),"both adapters agree on common skills");
        for(String line:List.of("--help --page 999","skills bogus --help","--help --page 1 --page 2"))check(help(line).has("errorCode"),"invalid help "+line);
        for(String group:List.of("skills","profession","tasks")){var h=help(group+" --help");check(String.join("\n",AgentCliText.help(h)).length()<1100,"compact group "+group);}
        System.out.println("native catalog="+checks);
    }
}
