package org.afuhome.agentfriend;
import com.google.gson.*;
import java.util.*;
public final class PhotoEvidenceTest {
    static int checks;
    static void check(String label,boolean ok){if(!ok)throw new AssertionError(label);checks++;System.out.println("PASS "+label);}
    static JsonObject image(){return JsonParser.parseString("{\"width\":1536,\"height\":1536,\"darkFraction\":0.1,\"brightFraction\":0,\"contrast\":42,\"sha256\":\""+"a".repeat(64)+"\"}").getAsJsonObject();}
    static JsonObject scene(){return JsonParser.parseString("{\"loadedRays\":25,\"nearRays\":0,\"subjectRays\":12,\"depthBands\":2}").getAsJsonObject();}
    public static void main(String[] args){
        check("clear subject passes",PhotoEvidence.review(scene(),image()).qualified());
        check("layered composition gets honorary record",PhotoEvidence.review(scene(),image()).honour());
        JsonObject flat=scene();flat.addProperty("depthBands",1);check("beauty is not promotion gate",PhotoEvidence.review(flat,image()).qualified()&&!PhotoEvidence.review(flat,image()).honour());
        for(String key:List.of("darkFraction","brightFraction","contrast","width")){JsonObject i=image();i.addProperty(key,key.equals("darkFraction")||key.equals("brightFraction")?1:0);check("bad image "+key,!PhotoEvidence.review(scene(),i).qualified());}
        for(String key:List.of("nearRays","subjectRays","loadedRays")){JsonObject s=scene();s.addProperty(key,key.equals("nearRays")?25:0);check("bad scene "+key,!PhotoEvidence.review(s,image()).qualified());}
        check("old worker no proof",!PhotoEvidence.review(scene(),null).qualified());
        for(String bad:List.of("", "a\nforged", "§cname", "x".repeat(65))){try{PhotoEvidence.text(bad,64);throw new AssertionError("accepted caption");}catch(IllegalArgumentException e){check("unsafe/oversize caption rejected",true);}}
        check("literal markup remains author text",PhotoEvidence.text("<click:run_command:'/op'>旅行</click>",64).startsWith("<click:"));
        JsonObject i=image();i.addProperty("darkFraction",2);try{PhotoEvidence.image(i);throw new AssertionError("metric range");}catch(IllegalArgumentException e){check("forged range rejected",true);}
        UUID owner=UUID.randomUUID();JsonObject row=new JsonObject();row.addProperty("owner",owner.toString());row.addProperty("qualified",true);row.addProperty("capturedAt",2000);
        JsonObject context=new JsonObject();context.addProperty("examRun","exam1");context.addProperty("marketRun","market1");context.addProperty("step",2);row.add("context",context);
        check("same live run accepts evidence",PhotoEvidence.matches(row,owner,"exam1","market1",2,1000));
        check("other owner rejects",!PhotoEvidence.matches(row,UUID.randomUUID(),"exam1","market1",2,1000));
        check("old exam rejects",!PhotoEvidence.matches(row,owner,"exam2","market1",2,1000));
        check("old contract rejects",!PhotoEvidence.matches(row,owner,"exam1","market2",2,1000));
        check("other stage rejects",!PhotoEvidence.matches(row,owner,"exam1","market1",1,1000));
        check("pre-exam photograph rejects",!PhotoEvidence.matches(row,owner,"exam1","market1",2,3000));
        row.remove("context");check("ordinary photo not exam proof",!PhotoEvidence.matches(row,owner,"exam1","market1",2,1000));
        System.out.println("PhotoEvidenceTest "+checks+" passed");
    }
}
