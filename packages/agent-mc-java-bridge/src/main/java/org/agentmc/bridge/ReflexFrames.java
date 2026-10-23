package org.agentmc.bridge;
import com.google.gson.*;
import java.util.*;
import net.minecraft.*;

/** Internal collision/actor samples for the shared core, not an Agent-visible world scan. */
final class ReflexFrames {
    static final String PROTOCOL="agent-mc-reflex/v1";
    private final Gson gson=new Gson();
    private final ArrayDeque<JsonObject> damage=new ArrayDeque<>();
    private long damageSeq;
    private JsonElement inventory;
    private Object player,world;
    private int scope;
    int scope(class_310 c){if(player!=c.field_1724||world!=c.field_1687){player=c.field_1724;world=c.field_1687;scope++;inventory=null;}return scope;}
    void invalidateInventory(){inventory=null;}
    void damage(class_8143 packet){
        JsonObject out=new JsonObject();out.addProperty("seq",++damageSeq);out.addProperty("entityId",packet.comp_1267());
        out.addProperty("atMs",System.currentTimeMillis());
        out.addProperty("sourceType",packet.comp_1268().method_40230().map(key->key.method_29177().toString()).orElse("unknown"));
        out.addProperty("causeId",packet.comp_1269());out.addProperty("directId",packet.comp_1270());
        out.add("position",packet.comp_1271().map(v->gson.toJsonTree(new double[]{v.field_1352,v.field_1351,v.field_1350})).orElse(JsonNull.INSTANCE));
        damage.add(out);while(damage.size()>64)damage.removeFirst();
    }
    void reset(){damage.clear();damageSeq=0;inventory=null;}
    JsonObject sample(class_310 c,int generation,JsonObject state,String taskId,boolean taskRunning){
        JsonObject out=new JsonObject();out.addProperty("protocol",PROTOCOL);out.addProperty("sampledAtMs",System.currentTimeMillis());out.addProperty("generation",generation);
        out.addProperty("minecraftVersion",ClientBridge.MINECRAFT_VERSION);
        out.addProperty("reflexGeneration",scope(c));out.addProperty("absorption",c.field_1724.method_6067());
        out.add("state",state);out.addProperty("taskRunning",taskRunning);if(taskId!=null)out.addProperty("taskId",taskId);
        var p=c.field_1724;var world=c.field_1687;
        out.addProperty("entityId",p.method_5628());out.addProperty("oxygen",p.method_5669());out.addProperty("maxOxygen",p.method_5748());out.addProperty("onGround",p.method_24828());out.addProperty("burning",p.method_5809());
        out.addProperty("height",p.method_17682());out.addProperty("eyeHeight",p.method_18381(p.method_18376()));out.addProperty("maxHealth",p.method_6063());
        var velocity=p.method_18798();out.add("velocity",gson.toJsonTree(new double[]{velocity.field_1352,velocity.field_1351,velocity.field_1350}));
        if(inventory==null)inventory=MethodSession.read(c,"read",array("inventory.slots"));out.add("inventorySlots",inventory);
        out.add("damage",gson.toJsonTree(damage));
        JsonArray actors=new JsonArray();int omitted=0;
        List<class_1297> entities=new ArrayList<>();for(var entity:world.method_18112())if(entity!=p&&(entity instanceof class_1309||entity instanceof class_1676)&&entity.method_19538().method_1022(p.method_19538())<=24)entities.add(entity);
        entities.sort(Comparator.comparingDouble(e->e.method_19538().method_1022(p.method_19538())));
        for(var e:entities){if(actors.size()>=32){omitted++;continue;}JsonObject actor=new JsonObject();
            actor.addProperty("id",e.method_5628());actor.addProperty("uuid",e.method_5667().toString());actor.addProperty("name",class_1299.method_5890(e.method_5864()).toString());actor.addProperty("username",e.method_5477().getString());
            actor.addProperty("player",e instanceof class_1657);actor.addProperty("alive",e.method_5805());actor.addProperty("visible",p.method_6057(e));
            actor.addProperty("projectile",e instanceof class_1676);
            actor.add("position",gson.toJsonTree(new double[]{e.method_23317(),e.method_23318(),e.method_23321()}));
            var v=e.method_18798();actor.add("velocity",gson.toJsonTree(new double[]{v.field_1352,v.field_1351,v.field_1350}));
            actor.addProperty("width",e.method_17681());actor.addProperty("height",e.method_17682());
            if(e instanceof class_1309 living){actor.addProperty("health",living.method_6032());actor.addProperty("maxHealth",living.method_6063());}
            actors.add(actor);
        }out.add("actors",actors);out.addProperty("actorsOmitted",omitted);
        int bx=(int)Math.floor(p.method_23317()),by=(int)Math.floor(p.method_23318()),bz=(int)Math.floor(p.method_23321());
        JsonArray blocks=new JsonArray(),palette=new JsonArray();Map<Integer,Integer> indices=new HashMap<>();
        for(int x=bx-5;x<=bx+5;x++)for(int y=by-4;y<=by+4;y++)for(int z=bz-5;z<=bz+5;z++){
            var pos=new class_2338(x,y,z);if(world.method_2935().method_2857(x>>4,z>>4,class_2806.field_12803,false)==null)continue;
            var block=world.method_8320(pos);int id=class_2248.method_9507(block);Integer index=indices.get(id);
            if(index==null){index=palette.size();indices.put(id,index);JsonObject type=new JsonObject();type.addProperty("stateId",id);type.addProperty("name",class_7923.field_41175.method_10221(block.method_26204()).toString());
                JsonObject props=new JsonObject();block.method_11656().forEach((key,value)->{if(value instanceof Boolean b)props.addProperty(key.method_11899(),b);else if(value instanceof Number n)props.addProperty(key.method_11899(),n);else props.addProperty(key.method_11899(),value.toString().toLowerCase(Locale.ROOT));});type.add("properties",props);
                JsonArray shapes=new JsonArray();for(var box:block.method_26220(world,pos).method_1090())shapes.add(gson.toJsonTree(new double[]{box.field_1323,box.field_1322,box.field_1321,box.field_1320,box.field_1325,box.field_1324}));type.add("shapes",shapes);palette.add(type);
            }blocks.add(gson.toJsonTree(new int[]{x,y,z,index}));
        }out.add("palette",palette);out.add("cells",blocks);out.addProperty("collisionOnly",true);return out;
    }
    private static JsonArray array(String value){JsonArray a=new JsonArray();a.add(value);return a;}
}
