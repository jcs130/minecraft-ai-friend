package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

public final class AgentCliContractTest {
    private static int checks;
    private static void check(String message,boolean ok){if(!ok)throw new AssertionError(message);checks++;}
    private static ChallengeCli.Request parse(String line){return ChallengeCli.parse(("challenge "+line).trim().split(" +"));}
    private static void invalid(String line){try{parse(line);throw new AssertionError("accepted: "+line);}catch(IllegalArgumentException expected){checks++;}}
    private static JsonObject help(String line){return AgentCliCatalog.helpData(line.split(" +"),List.of());}
    private static Map<String,Object> archive(String line)throws Exception{
        var method=PublicArchives.class.getDeclaredMethod("parse",String[].class);method.setAccessible(true);
        Object value;
        try{value=method.invoke(null,(Object)("archive "+line).trim().split(" +"));}
        catch(java.lang.reflect.InvocationTargetException e){if(e.getCause() instanceof IllegalArgumentException invalid)throw invalid;throw e;}
        Map<String,Object> result=new HashMap<>();for(var component:value.getClass().getRecordComponents()){var read=component.getAccessor();read.setAccessible(true);result.put(component.getName(),read.invoke(value));}return result;
    }
    private static void invalidArchive(String line)throws Exception{try{archive(line);throw new AssertionError("accepted archive args: "+line);}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args)throws Exception{
        check("default is an inexpensive read",parse("").action().equals("status")&&parse("").readOnly());
        for(String line:List.of("create backpack_roundtrip","start","join 00000000-0000-0000-0000-000000000001 maker","cancel","menu")){
            var plain=parse(line);var json=parse("--json "+line);
            check("JSON changes only format: "+line,plain.action().equals(json.action())&&plain.values().equals(json.values())&&!json.readOnly()&&json.json());
        }
        check("legacy start ID preserves enrolment",parse("start backpack_roundtrip").action().equals("create"));
        check("legacy begin starts",parse("begin --json").action().equals("start"));
        check("read flags work in any order",parse("--json --verbose status").readOnly()&&parse("--json --verbose status").verbose());
        check("explicit page",parse("--page 2 history --json").page()==2);
        for(String line:List.of("create","create a b","join a","start a b","cancel other","status a b","create a --page 2","create a --verbose","list --unknown","list --page","list --page 0","list --page -1","list --page x","list --page 2 --page 3"))invalid(line);
        JsonObject root=help("--help --json");check("root is one short page",root.get("readOnly").getAsBoolean()&&root.getAsJsonArray("commands").size()<=7&&root.toString().length()<2400);
        check("familiar starting point first",root.getAsJsonArray("commands").get(0).getAsJsonObject().get("name").getAsString().equals("status"));
        check("root pagination preserves JSON",root.get("nextCommand").getAsString().endsWith("--json"));
        Set<String> names=new HashSet<>();int pages=help("challenge --help").get("pages").getAsInt();
        for(int page=1;page<=pages;page++)for(var item:help("challenge --help --page "+page).getAsJsonArray("commands"))check("no duplicate command",names.add(item.getAsJsonObject().get("name").getAsString()));
        check("progressive group discovery",names.containsAll(Set.of("list","info","create","start","join","status","result","history","cancel","menu"))&&!names.contains("begin"));
        JsonObject create=help("challenge create backpack_roundtrip --help --json");
        check("help never pretends to execute",create.get("readOnly").getAsBoolean()&&!create.get("actionReadOnly").getAsBoolean());
        check("leaf exposes real parameters and resource rules",create.has("parameters")&&create.has("consumption")&&create.has("permission")&&create.has("resultQuery"));
        check("JSON actions advertised",create.get("jsonSupported").getAsBoolean());
        check("dungeon info supports optional JSON",help("dungeon info --help").get("jsonSupported").getAsBoolean());
        check("dungeon start JSON remains an action",help("dungeon start --help").get("jsonSupported").getAsBoolean()&&!help("dungeon start --help").get("actionReadOnly").getAsBoolean());
        check("legacy dungeon menu does not pretend JSON support",!help("dungeon menu --help").get("jsonSupported").getAsBoolean());
        var dungeonHelp=help("dungeon --help").getAsJsonArray("commands");
        check("dungeon essential steps fit page one",dungeonHelp.size()==7&&dungeonHelp.get(0).getAsJsonObject().get("name").getAsString().equals("list")&&dungeonHelp.get(2).getAsJsonObject().get("name").getAsString().equals("status"));
        check("exam status explicitly supports JSON",help("guild exam status --help --json").get("jsonSupported").getAsBoolean());
        check("exam info explicitly supports JSON",help("guild exam info survey_basic --help --json").get("jsonSupported").getAsBoolean());
        check("supplies claim is an explicit JSON action",help("guild exam supplies claim map --help --json").get("jsonSupported").getAsBoolean()&&!help("guild exam supplies claim map --help --json").get("actionReadOnly").getAsBoolean());
        check("supplies status is an inexpensive JSON query",help("guild exam supplies status --help --json").get("jsonSupported").getAsBoolean()&&help("guild exam supplies status --help --json").get("actionReadOnly").getAsBoolean());
        check("guide supports progressive JSON discovery",help("guild exam guide --help --json").get("jsonSupported").getAsBoolean());
        check("free exam checkout is an explicit JSON action",help("guild exam supplies take all --help --json").get("jsonSupported").getAsBoolean()&&!help("guild exam supplies take all --help --json").get("actionReadOnly").getAsBoolean());
        check("unknown child is not silently parent help",help("challenge bogus --help").has("errorCode"));
        check("unknown root errors",help("bogus --help").has("errorCode"));
        check("invalid help page errors",help("challenge --help --page 99").has("errorCode"));
        check("duplicate help page errors",help("--help --page 1 --page 2").has("errorCode"));
        check("help short alias works",help("challenge status -h").get("actionReadOnly").getAsBoolean());
        check("detail flag can coexist with help",help("challenge status --verbose --help").has("usage"));
        check("ordinary status help is not legacy full mode",help("status --help").get("actionReadOnly").getAsBoolean());
        check("legacy JSON limitation is discoverable",!help("guild claim --help").get("jsonSupported").getAsBoolean());
        for(String action:List.of("status","list","info","read","create","restore","notice","menu"))
            check("archive JSON discovery: "+action,help("archive "+action+" --help --json").get("jsonSupported").getAsBoolean());
        check("archive status is a pure query",help("archive status --help").get("actionReadOnly").getAsBoolean());
        check("archive create has explicit consumption",help("archive create --help").get("consumption").getAsString().contains("书与笔")&&!help("archive create --help").get("actionReadOnly").getAsBoolean());
        check("archive progressive help remains bounded",help("archive --help").getAsJsonArray("commands").size()<=7&&help("archive --help").get("pages").getAsInt()==2);
        check("exam material discovery has no obsolete photo blank-map requirement",!help("guild exam supplies info photo --help").toString().contains("摄影空图")&&help("guild exam supplies info photo --help").toString().contains("无需空地图"));
        check("archive format is independent of action",archive("create 书|正文 --json").get("action").equals("create")&&archive("create 书|正文 --json").get("json").equals(true));
        check("archive pagination is parsed",archive("list book --page 2").get("page").equals(2));
        check("archive explicit edition is parsed",archive("info 00000000-0000-0000-0000-000000000001 --version 2").get("version").equals(2));
        check("literal diary preserves CLI examples",archive("create --json --request-id stable -- 书|请用 --help 或 --json").get("arguments").toString().contains("--help")&&archive("create --json --request-id stable -- 书|请用 --help 或 --json").get("arguments").toString().contains("--json"));
        for(String line:List.of("list --page 0","list --page","list --page 2 --page 3","list --bogus","create 书|文 --page 2","create 书|文 --version 1","status --request-id stable","info a --version -1"))invalidArchive(line);
        String unicode="字".repeat(599)+"📖"+"故事".repeat(500);var unicodePages=PublicArchives.splitText(unicode,600);
        check("diary page boundaries retain emoji and complete text",String.join("",unicodePages).equals(unicode)&&unicodePages.stream().allMatch(p->p.length()<=600&&!Character.isHighSurrogate(p.charAt(p.length()-1))));
        System.out.println("PASS "+checks+" CLI contract checks");
    }
}
