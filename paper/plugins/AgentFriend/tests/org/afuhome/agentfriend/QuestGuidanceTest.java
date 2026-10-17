package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

public final class QuestGuidanceTest {
    private static int checks;
    private static void check(String name,boolean value){if(!value)throw new AssertionError(name);checks++;}
    private static JsonObject json(String value){return JsonParser.parseString(value).getAsJsonObject();}
    private static JsonObject info(){return json("{\"map\":{\"mapId\":26,\"worldUuid\":\"overworld-uuid\",\"dimension\":\"minecraft:overworld\",\"x\":-425,\"z\":677,\"heightKnown\":false},\"returnTo\":{\"worldUuid\":\"overworld-uuid\",\"x\":-580.5,\"y\":68,\"z\":-450.5},\"targetKind\":\"structure\",\"clue\":{\"approachHint\":\"这是一处地下遗迹，地表标记不代表入口。\"}}");}
    private static JsonObject evidence(){return json("{\"ready\":false,\"surveyed\":false,\"returned\":false,\"validCurrentTarget\":false,\"requirements\":{\"zoneSize\":4,\"minDistance\":24,\"minMovingSeconds\":15,\"minSections\":1,\"minHeightSpan\":0,\"returnRadius\":16},\"distinctZones\":0,\"distance\":0,\"movingSeconds\":0,\"distinctSections\":0}");}
    private static JsonObject guide(JsonObject i,JsonObject e,JsonObject p,String world,double x,double y,double z){return QuestGuidance.map(i,e,"",4,world,x,y,z,true,p);}
    private static String phase(JsonObject guide){return guide.get("phase").getAsString();}
    private static String next(JsonObject guide){return guide.get("nextCommand").getAsString();}
    public static void main(String[] args){
        JsonObject i=info(),e=evidence(),p=json("{\"required\":true,\"ready\":false,\"photographedRegions\":0,\"requiredRegions\":1}");
        String original=i+"|"+e+"|"+p;
        JsonObject g=guide(i,e,p,"overworld-uuid",-580,68,-450);
        check("all query inputs readonly",original.equals(i+"|"+e+"|"+p));
        check("far away is travel",phase(g).equals("travel_to_marker"));
        check("reference coordinates preserved",g.get("nextAction").getAsString().contains("X=-425")&&g.get("nextAction").getAsString().contains("Z=677"));
        check("no guessed entrance Y",!g.getAsJsonObject("navigation").has("y")&&!g.getAsJsonObject("navigation").get("entranceVerified").getAsBoolean());
        check("marker proximity not arrival proof",!g.get("targetMatch").getAsBoolean()&&!g.get("ready").getAsBoolean());
        check("first objective current",g.getAsJsonArray("objectives").get(0).getAsJsonObject().get("state").getAsString().equals("current"));
        g=guide(i,e,p,"nether-uuid",-425,62,677);
        check("same coordinates wrong world",phase(g).equals("travel_to_map_world"));
        check("no crossworld distance invented",g.getAsJsonObject("navigation").get("horizontalDistance").getAsInt()==-1);
        g=guide(i,e,p,"overworld-uuid",-425,62,677);
        check("surface marker is find entrance",phase(g).equals("find_entrance"));
        check("underground clue from verified input",g.get("nextAction").getAsString().contains("地下遗迹"));
        check("no invitation to dig shaft",g.get("nextAction").getAsString().contains("避免脚下直挖"));
        check("not engineering",!next(g).contains("engineering"));
        check("different grid count hidden until enter",g.getAsJsonArray("missingConditions").size()==1);
        e.addProperty("validCurrentTarget",true);e.addProperty("mode","structure");
        g=guide(i,e,p,"overworld-uuid",-425,4,677);
        check("inside is survey",phase(g).equals("survey"));
        check("four positions not four ruins",g.get("nextAction").getAsString().contains("不是多座遗迹"));
        check("known ruin no fresh chest requirement",g.get("nextAction").getAsString().contains("不要求开启新宝箱"));
        check("all real deficits displayed",g.getAsJsonArray("missingConditions").size()==4);
        e.addProperty("distinctZones",4);e.addProperty("distance",24);e.addProperty("movingSeconds",12);e.addProperty("distinctSections",1);
        g=guide(i,e,p,"overworld-uuid",-425,4,677);
        check("only remaining movement deficit",g.getAsJsonArray("missingConditions").size()==1&&g.getAsJsonArray("missingConditions").get(0).getAsString().contains("12.0/15.0"));
        e.addProperty("validCurrentTarget",false);e.addProperty("structureInstance","same-ruin");
        g=guide(i,e,p,"overworld-uuid",-425,62,677);
        check("partial survey must resume same ruin",phase(g).equals("resume_same_structure"));
        check("no discard recommendation",g.get("nextAction").getAsString().contains("不必放弃重接"));
        e.addProperty("surveyed",true);e.addProperty("returned",true);
        g=guide(i,e,p,"overworld-uuid",-580,68,-450);
        check("photo before handover even at origin",phase(g).equals("photograph")&&next(g).equals("/mycli photo menu"));
        check("not photo at origin",g.get("nextAction").getAsString().contains("先回原目标现场"));
        check("missing photo never ready",!g.get("ready").getAsBoolean());
        p.addProperty("ready",true);p.addProperty("photographedRegions",1);e.addProperty("returned",false);
        g=guide(i,e,p,"overworld-uuid",-425,4,677);
        check("return after photo",phase(g).equals("return_to_acceptance_point"));
        check("correct return height and radius",g.get("nextAction").getAsString().contains("Y=68")&&g.get("nextAction").getAsString().contains("16格内"));
        check("negative origin floors rather than truncates",g.get("nextAction").getAsString().contains("X=-581")&&g.get("nextAction").getAsString().contains("Z=-451"));
        e.addProperty("returned",true);g=guide(i,e,p,"overworld-uuid",-580,68,-450);
        check("only real ready may claim",phase(g).equals("ready_to_submit")&&g.get("ready").getAsBoolean()&&next(g).equals("/mycli guild claim"));
        check("handover remains an explicit objective",g.get("completedObjectives").getAsInt()==5&&g.get("totalObjectives").getAsInt()==6&&g.get("progress").getAsDouble()<1);
        check("stage and exam not conflated",g.get("nextAction").getAsString().contains("再查看考试"));
        p.addProperty("required",false);p.addProperty("ready",false);
        g=guide(i,e,p,"overworld-uuid",-580,68,-450);
        check("no photo requirement outside examination",g.get("ready").getAsBoolean()&&g.get("totalObjectives").getAsInt()==5);
        g=QuestGuidance.map(i,e,"",4,"overworld-uuid",-580,68,-450,false,p);
        check("survival prerequisite enforced",phase(g).equals("resume_survival")&&!g.get("ready").getAsBoolean());
        g=QuestGuidance.map(i,e,"map_destination_already_completed",4,"overworld-uuid",-580,68,-450,true,p);
        check("repeat destination cannot claim",phase(g).equals("destination_completed")&&!g.get("ready").getAsBoolean()&&!next(g).contains("claim"));
        g=QuestGuidance.map(i,e,"map_binding_missing_or_invalid",4,"overworld-uuid",-580,68,-450,true,p);
        check("invalid binding never fabricated",phase(g).equals("check_map_binding")&&!g.get("ready").getAsBoolean());
        g=QuestGuidance.map(info(),evidence(),"current_chunk_unloaded",4,"overworld-uuid",-425,62,677,true,p);
        check("unloaded not absent",phase(g).equals("wait_for_terrain"));
        JsonObject unknown=info();unknown.remove("clue");unknown.addProperty("targetKind","unknown");
        g=guide(unknown,evidence(),p,"overworld-uuid",-425,62,677);
        check("unknown icon not assumed treasure",g.get("nextAction").getAsString().contains("红叉本身不能区分"));
        JsonObject ex=json("{\"phase\":\"ready_to_submit\",\"ready\":true,\"targetMatch\":false,\"missingConditions\":[],\"summary\":\"就绪\",\"nextAction\":\"交付\",\"nextCommand\":\"/mycli guild claim\"}");
        JsonObject photo=json("{\"required\":true,\"ready\":false}");String before=ex.toString();
        g=QuestGuidance.exploration(ex,photo);
        check("ordinary surveys share photo phase",phase(g).equals("photograph")&&!g.get("ready").getAsBoolean());
        check("ordinary evidence remains readonly",before.equals(ex.toString()));
        check("pure guide never advertises new commands",next(g).equals("/mycli photo menu"));
        System.out.println("QuestGuidanceTest: "+checks+" passed");
    }
}
