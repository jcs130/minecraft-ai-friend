package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

public final class AgentCliContractTest {
    private static int checks;
    private static void check(String message,boolean ok){if(!ok)throw new AssertionError(message);checks++;}
    private static ChallengeCli.Request parse(String line){return ChallengeCli.parse(("challenge "+line).trim().split(" +"));}
    private static void invalid(String line){try{parse(line);throw new AssertionError("accepted: "+line);}catch(IllegalArgumentException expected){checks++;}}
    private static JsonObject help(String line){return AgentCliCatalog.helpData(line.split(" +"),List.of());}
    public static void main(String[] args){
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
        System.out.println("PASS "+checks+" CLI contract checks");
    }
}
