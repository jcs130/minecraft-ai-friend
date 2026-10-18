package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.List;
import java.util.HashSet;

/** Run against the release candidate, including its filtered command catalog. */
public final class LocalTaskCliTest {
    private static int checks;
    private static void check(boolean ok,String label){checks++;if(!ok)throw new AssertionError(label);}
    private static JsonObject help(String line){return AgentCliCatalog.helpData(line.split(" +"),List.of());}
    private static Object parse(String line)throws Exception{
        var method=TaskRoutes.class.getDeclaredMethod("parse",String[].class);method.setAccessible(true);
        try{return method.invoke(null,(Object)("tasks "+line).split(" +"));}
        catch(java.lang.reflect.InvocationTargetException e){if(e.getCause() instanceof IllegalArgumentException invalid)throw invalid;throw e;}
    }
    private static Object field(Object request,String name)throws Exception{var read=request.getClass().getDeclaredMethod(name);read.setAccessible(true);return read.invoke(request);}
    public static void main(String[] args)throws Exception{
        var group=help("tasks --help --json");var names=new HashSet<String>();
        check(group.getAsJsonArray("commands").size()<=7,"task group fits one short help page");
        for(var row:group.getAsJsonArray("commands"))names.add(row.getAsJsonObject().get("name").getAsString());
        check(names.containsAll(List.of("list","info","status","menu","pause","resume")),"ordinary task discovery exposes familiar actions");
        for(String action:List.of("pause","resume")){
            var detail=help("tasks "+action+" --help --json");
            check(detail.get("readOnly").getAsBoolean()&&!detail.get("actionReadOnly").getAsBoolean(),"help is read only and advertises a write: "+action);
            check(detail.get("jsonSupported").getAsBoolean()&&detail.has("permission")&&detail.has("consumption")&&detail.has("resultQuery"),"requirements and result query discoverable: "+action);
            var plain=parse(action);var json=parse("--json "+action);
            check(field(plain,"action").equals(field(json,"action"))&&field(json,"json").equals(true),"json changes output only: "+action);
        }
        check(help("tasks status --help").get("actionReadOnly").getAsBoolean(),"status remains read only");
        for(String bad:List.of("pause other","resume other","pause --page 2","resume --page 1","pause --bogus","pause --verbose","resume --page","status extra")){
            try{parse(bad);throw new AssertionError("invalid write args accepted: "+bad);}catch(IllegalArgumentException expected){checks++;}
        }
        check(help("archive --help").has("errorCode"),"candidate does not advertise unpublished archives");
        System.out.println("LocalTaskCliTest: "+checks+" passed");
    }
}
