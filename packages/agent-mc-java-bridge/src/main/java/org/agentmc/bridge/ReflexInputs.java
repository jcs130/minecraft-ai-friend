package org.agentmc.bridge;
import com.google.gson.*;
import java.util.*;
import net.minecraft.*;

/** Bounded input executor only. Decisions stay in the existing shared JS reflex/combat kernel. */
final class ReflexInputs {
    private final ReflexLease lease=new ReflexLease();
    private final BaritoneReflex navigation=new BaritoneReflex();
    private JsonObject input=new JsonObject();
    private boolean wrote;
    private long attacks;
    private String block;
    private boolean goalReached;
    private boolean cleanupUnknown;
    boolean unresolved(){return cleanupUnknown;}
    private final class_310 c;
    ReflexInputs(class_310 c){this.c=c;}
    boolean active(int generation){return lease.active(System.currentTimeMillis(),generation)&&!"idle".equals(text(input,"owner"));}
    String owner(){return text(input,"owner");}
    JsonObject accept(JsonObject args,int generation){
        if(cleanupUnknown)throw new IllegalStateException("Original reflex navigation policy cleanup is unknown; no new body input");
        if(!Set.of("stream","sequence","sampledAtMs","ttlMs","input","bodyScope").containsAll(args.keySet()))throw new IllegalArgumentException("Unknown reflex envelope field");
        if(integer(args,"bodyScope")!=generation)throw new IllegalStateException("Reflex body respawned or changed dimension before dispatch");
        JsonObject proposed=args.getAsJsonObject("input");validate(proposed);
        boolean fresh=lease.accept(text(args,"stream"),integer(args,"sequence"),generation,args.get("sampledAtMs").getAsLong(),System.currentTimeMillis(),proposed.toString(),integer(args,"ttlMs"));
        if(fresh){input=proposed.deepCopy();block=null;goalReached=false;}
        JsonObject out=status(generation);out.addProperty("accepted",true);out.addProperty("duplicate",!fresh);out.addProperty("goalCompleted",false);return out;
    }
    void tick(int generation,boolean allowed){
        if(!allowed||!active(generation)||c.field_1724==null||c.field_1687==null||c.field_1755!=null||c.field_1724.method_6032()<=0){stop();return;}
        try {
            JsonObject goal=input.has("goal")&&!input.get("goal").isJsonNull()?input.getAsJsonObject("goal"):null;
            if(goal!=null){double dx=Math.floor(c.field_1724.method_23317())-goal.get("x").getAsInt(),dz=Math.floor(c.field_1724.method_23321())-goal.get("z").getAsInt(),dy=text(goal,"kind").equals("xz")?0:Math.floor(c.field_1724.method_23318())-goal.get("y").getAsInt();int range=goal.has("range")?integer(goal,"range"):0;
                if(c.field_1724.method_24828()&&dx*dx+dy*dy+dz*dz<=range*range){goalReached=true;goal=null;}}
            navigation.update(true,goal);
            JsonObject keys=input.getAsJsonObject("keys");for(String name:List.of("forward","back","left","right","jump","sprint","sneak","use"))key(name).method_23481(keys.has(name)&&keys.get(name).getAsBoolean());
            wrote=true;
            if(input.has("look")){JsonObject look=input.getAsJsonObject("look");c.field_1724.method_36456((float)look.get("yaw").getAsDouble());c.field_1724.method_36457((float)look.get("pitch").getAsDouble());}
            if(input.has("attack")){
                JsonObject target=input.getAsJsonObject("attack");input.remove("attack");var entity=c.field_1687.method_8469(integer(target,"id"));
                if(entity==null||entity==c.field_1724||!entity.method_5667().toString().equals(text(target,"uuid"))||!entity.method_5805()||!c.field_1724.method_6057(entity)){block="Reflex attack target changed or occluded";return;}
                var eye=c.field_1724.method_33571();var box=entity.method_5829();double dx=eye.field_1352-Math.max(box.field_1323,Math.min(eye.field_1352,box.field_1320)),dy=eye.field_1351-Math.max(box.field_1322,Math.min(eye.field_1351,box.field_1325)),dz=eye.field_1350-Math.max(box.field_1321,Math.min(eye.field_1350,box.field_1324));
                if(dx*dx+dy*dy+dz*dz>9||c.field_1724.method_7261(0)<.848){block="Reflex attack reach/cooldown not ready";return;}
                c.field_1761.method_2918(c.field_1724,entity);c.field_1724.method_6104(class_1268.field_5808);attacks++;
            }
        }catch(Exception error){block=error.getMessage();stop();}
    }
    void stop(){if(!cleanupUnknown)try{navigation.stop();}catch(Exception error){cleanupUnknown=true;block=error.getMessage();}if(wrote)for(String name:List.of("forward","back","left","right","jump","sprint","sneak","use"))key(name).method_23481(false);wrote=false;lease.clear();input=new JsonObject();}
    JsonObject status(int generation){JsonObject out=new JsonObject();out.addProperty("protocol",ReflexFrames.PROTOCOL);out.addProperty("active",active(generation));out.addProperty("owner",owner());out.addProperty("sequence",lease.sequence());out.addProperty("attacksSent",attacks);out.addProperty("goalReached",goalReached);out.addProperty("cleanupUnknown",cleanupUnknown);if(input.has("goal"))out.add("goal",input.get("goal").deepCopy());if(block!=null)out.addProperty("blocked",block);return out;}
    private static void validate(JsonObject value){
        if(value==null||!Set.of("owner","keys","look","attack","goal").containsAll(value.keySet())||!Set.of("idle","combat","environment").contains(text(value,"owner"))||!value.has("keys")||!value.get("keys").isJsonObject())throw new IllegalArgumentException("Invalid reflex owner/keys");
        JsonObject keys=value.getAsJsonObject("keys");if(!Set.of("forward","back","left","right","jump","sprint","sneak","use").containsAll(keys.keySet())||keys.entrySet().stream().anyMatch(e->!e.getValue().isJsonPrimitive()||!e.getValue().getAsJsonPrimitive().isBoolean()))throw new IllegalArgumentException("Invalid reflex key");
        if(value.has("look")){var look=value.getAsJsonObject("look");if(!look.keySet().equals(Set.of("yaw","pitch"))||!finite(look.get("yaw"))||!finite(look.get("pitch"))||Math.abs(look.get("yaw").getAsDouble())>180||Math.abs(look.get("pitch").getAsDouble())>90)throw new IllegalArgumentException("Invalid reflex look");}
        if(value.has("attack")){var attack=value.getAsJsonObject("attack");if(!attack.keySet().equals(Set.of("id","uuid"))||!attack.get("id").isJsonPrimitive()||attack.get("id").getAsDouble()!=attack.get("id").getAsInt()||!text(attack,"uuid").matches("[a-fA-F0-9-]{36}"))throw new IllegalArgumentException("Invalid reflex attack identity");}
        if(value.has("goal")&&!value.get("goal").isJsonNull()){var goal=value.getAsJsonObject("goal");String kind=text(goal,"kind");if(!Set.of("xz","block","near").contains(kind)||!Set.of("kind","x","y","z","range").containsAll(goal.keySet()))throw new IllegalArgumentException("Invalid reflex goal");for(String name:kind.equals("xz")?List.of("x","z"):List.of("x","y","z")){if(!finite(goal.get(name))||goal.get(name).getAsDouble()!=goal.get(name).getAsInt()||Math.abs(goal.get(name).getAsDouble())>30000000)throw new IllegalArgumentException("Invalid reflex goal coordinates");}if(goal.has("range")&&(integer(goal,"range")<0||integer(goal,"range")>16))throw new IllegalArgumentException("Invalid reflex goal range");}
    }
    private static boolean finite(JsonElement value){return value!=null&&value.isJsonPrimitive()&&value.getAsJsonPrimitive().isNumber()&&Double.isFinite(value.getAsDouble());}
    private static int integer(JsonObject o,String key){if(!finite(o.get(key))||o.get(key).getAsDouble()!=o.get(key).getAsInt())throw new IllegalArgumentException("Expected reflex integer");return o.get(key).getAsInt();}
    private static String text(JsonObject o,String key){return o.has(key)&&o.get(key).isJsonPrimitive()?o.get(key).getAsString():"";}
    private class_304 key(String key){return switch(key){case "forward"->c.field_1690.field_1894;case "back"->c.field_1690.field_1881;case "left"->c.field_1690.field_1913;case "right"->c.field_1690.field_1849;case "jump"->c.field_1690.field_1903;case "sneak"->c.field_1690.field_1832;case "sprint"->c.field_1690.field_1867;case "use"->c.field_1690.field_1904;default->throw new IllegalArgumentException("Unknown key");};}
}
