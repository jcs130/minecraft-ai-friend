package org.agentmc.bridge;

import com.google.gson.*;
import java.util.*;
import java.util.function.Supplier;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import net.minecraft.*;

/** One reserved native queue entry, not a second player or a Python translation. */
final class MethodSession {
    static final String PROTOCOL = "agent-mc-method/v1";
    static final Set<String> READS = Set.of("read", "blockAt", "findBlocks", "findBlock", "canSeeBlock", "inventory.items", "getControlState");
    private static final Set<String> CONTROLS=Set.of("forward","back","left","right","jump","sprint","sneak");
    static final List<String> METHODS = List.of("read", "blockAt", "canSeeBlock", "inventory.items", "getControlState", "look", "lookAt", "setControlState", "clearControlStates", "waitForTicks", "equip", "activateBlock", "activateItem", "deactivateItem", "findBlocks", "findBlock", "setQuickBarSlot");
    private final class_310 c;
    private final MethodCalls calls=new MethodCalls();
    private final Map<String, Boolean> held = new HashMap<>();
    private Runnable deferred;
    private Supplier<Boolean> completion;
    private final InventoryPick inventoryPick;
    private final String actionId;
    private int currentCall;
    private final Object player,world;
    private class_243 previousPosition;
    private final long deadline;
    MethodSession(class_310 client, int durationMs, InventoryPick pick, String id) { c=client; inventoryPick=pick; actionId=id; player=c.field_1724;world=c.field_1687;previousPosition=c.field_1724.method_19538();deadline=System.currentTimeMillis()+durationMs; }
    void tick() {
        if(System.currentTimeMillis()>deadline)throw new IllegalStateException("JavaScript body session expired");
        if(c.field_1724!=player||c.field_1687!=world||c.field_1724.method_19538().method_1022(previousPosition)>8)throw new IllegalStateException("Body respawned, changed dimension or teleported; method revoked");
        previousPosition=c.field_1724.method_19538();
        if(c.field_1724.method_6032()<=0)throw new IllegalStateException("Player died; method revoked");
        if(c.field_1755!=null&&!held.isEmpty())throw new IllegalStateException("GUI took control; method revoked");
        held.forEach((name,value)->key(c,name).method_23481(value));
        calls.tick();
    }
    JsonObject call(int call,String name,JsonArray args) {
        int ticks=name.equals("waitForTicks")?boundedInt(args.get(0),1,200):1;
        return calls.call(call,name+args,ticks,()->{
            deferred=null;completion=null;currentCall=call;
            if(c.field_1755!=null)throw new IllegalStateException("Close the current GUI before body calls");
            inventoryPick.requireResolved();
            return invoke(name,args);
        },()->deferred,()->completion);
    }
    JsonObject result(int call){return calls.result(call);}
    boolean pending(){return calls.pending();}
    private JsonElement invoke(String name,JsonArray args) {
        if(!METHODS.contains(name)||READS.contains(name))throw new IllegalArgumentException("Unsupported body method: "+name);
        switch(name) {
            case "setControlState" -> {String key=args.get(0).getAsString();if(!CONTROLS.contains(key))throw new IllegalArgumentException("Unknown movement control; held use has separate activateItem/deactivateItem APIs");boolean value=bool(args.get(1));key(c,key).method_23481(value);if(value)held.put(key,true);else held.remove(key);}
            case "clearControlStates" -> {for(String key:List.of("forward","back","left","right","jump","sprint","sneak"))key(c,key).method_23481(false);held.keySet().removeIf(key->!key.equals("use"));}
            case "waitForTicks" -> boundedInt(args.get(0),1,200);
            case "setQuickBarSlot" -> c.field_1724.method_31548().field_7545=boundedInt(args.get(0),0,8);
            case "look" -> look(c,number(args.get(0)),number(args.get(1)));
            case "lookAt" -> {class_243 p=point(args.get(0)),eye=c.field_1724.method_33571();double dx=p.field_1352-eye.field_1352,dy=p.field_1351-eye.field_1351,dz=p.field_1350-eye.field_1350;look(c,Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)));}
            case "equip" -> {
                if(args.size()<1||args.size()>2||args.size()>1&&!args.get(1).isJsonNull()&&!args.get(1).getAsString().equals("hand"))throw new IllegalArgumentException("Native equip supports the main hand; armor/offhand destinations unavailable");
                var inventory=c.field_1724.method_31548();
                if(inventory.method_5439()!=41||c.field_1724.field_7512!=c.field_1724.field_7498||!c.field_1724.field_7512.method_34255().method_7960()||!held.isEmpty()||c.field_1724.method_6115())throw new IllegalStateException("Equip requires standard player inventory, empty cursor, no held input/use and closed GUI");
                JsonElement requested=args.get(0);int found=-1;
                for(int slot=0;slot<36;slot++){JsonObject item=item(c,inventory.method_5438(slot),slot<9?slot+36:slot);if(item==null)continue;
                    boolean match=requested.isJsonPrimitive()?item.get("type").getAsInt()==boundedInt(requested,0,Integer.MAX_VALUE):item.equals(requested);
                    if(match){if(found!=-1)throw new IllegalArgumentException("Ambiguous item type; pass fresh inventory item with slot and identity");found=slot;}}
                if(found<0)throw new IllegalArgumentException("Item changed or missing; read fresh inventory.items before equip");
                if(found<9){inventory.field_7545=found;var expected=inventory.method_5438(found).method_7972();int selected=found;deferred=()->{if(inventory.field_7545!=selected||!class_1799.method_7973(expected,c.field_1724.method_6047()))throw new IllegalStateException("Selected item changed before hotbar equip settled");};}
                else {
                    inventoryPick.begin(actionId+":"+currentCall,found,inventoryIdentities(c),System.currentTimeMillis());
                    // Vanilla sends PickFromInventoryC2SPacket only. Never predict the swap locally.
                    c.field_1761.method_2916(found);
                    completion=()->{
                        if(c.field_1755!=null||c.field_1724.field_7512!=c.field_1724.field_7498||!c.field_1724.field_7512.method_34255().method_7960())throw new IllegalStateException("Inventory context changed while awaiting server pick; inspect inventoryTransfer, no replay");
                        JsonObject receipt=inventoryPick.inspect();String phase=receipt.get("phase").getAsString();
                        if(phase.equals("completed"))return true;
                        if(phase.equals("running"))return false;
                        throw new IllegalStateException(receipt.get("reason").getAsString());
                    };
                }
            }
            case "activateBlock" -> {
                JsonObject supplied=args.get(0).getAsJsonObject();class_243 p=point(supplied.get("position"));JsonObject fresh=block(c,p);
                if(fresh==null||!fresh.get("stateId").equals(supplied.get("stateId")))throw new IllegalArgumentException("Target hidden, unloaded or changed; re-read blockAt");
                class_243 direction=args.size()>1&&!args.get(1).isJsonNull()?point(args.get(1)):new class_243(0,1,0);
                if(Math.abs(direction.field_1352)+Math.abs(direction.field_1351)+Math.abs(direction.field_1350)!=1||!integral(direction))throw new IllegalArgumentException("Direction must be a cardinal unit vector");
                class_243 cursor=args.size()>2&&!args.get(2).isJsonNull()?point(args.get(2)):new class_243(.5,.5,.5);
                if(Math.min(cursor.field_1352,Math.min(cursor.field_1351,cursor.field_1350))<0||Math.max(cursor.field_1352,Math.max(cursor.field_1351,cursor.field_1350))>1)throw new IllegalArgumentException("Cursor must be within the block");
                class_2338 pos=cell(p);class_243 hit=new class_243(pos.method_10263()+cursor.field_1352,pos.method_10264()+cursor.field_1351,pos.method_10260()+cursor.field_1350);
                if(hit.method_1022(c.field_1724.method_33571())>4.5)throw new IllegalArgumentException("Block beyond conservative interaction reach; no navigation");
                class_2350 side=direction.field_1351>0?class_2350.field_11036:direction.field_1351<0?class_2350.field_11033:direction.field_1352>0?class_2350.field_11034:direction.field_1352<0?class_2350.field_11039:direction.field_1350>0?class_2350.field_11035:class_2350.field_11043;
                var eye=c.field_1724.method_33571();double dx=hit.field_1352-eye.field_1352,dy=hit.field_1351-eye.field_1351,dz=hit.field_1350-eye.field_1350;
                look(c,Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)));
                // Let vanilla send the new look before dispatch; recheck state/hand/reach then.
                var heldBefore=c.field_1724.method_6047().method_7972();
                deferred=()->{
                    if(c.field_1755!=null||hit.method_1022(c.field_1724.method_33571())>4.5||class_2248.method_9507(c.field_1687.method_8320(pos))!=supplied.get("stateId").getAsInt()||!class_1799.method_7973(heldBefore,c.field_1724.method_6047()))throw new IllegalStateException("Interaction precondition changed before dispatch");
                    var ray=c.field_1687.method_17742(new class_3959(c.field_1724.method_33571(),hit,class_3959.class_3960.field_17559,class_3959.class_242.field_1348,c.field_1724));
                    if(ray.method_17783()!=class_239.class_240.field_1333&&!ray.method_17777().equals(pos))throw new IllegalStateException("Selected interaction point is occluded");
                    c.field_1761.method_2896(c.field_1724,class_1268.field_5808,new class_3965(hit,side,pos,false));
                };
            }
            case "activateItem" -> {if(args.size()>0&&bool(args.get(0)))throw new IllegalArgumentException("Off-hand use unavailable in this adapter");held.put("use",true);key(c,"use").method_23481(true);}
            case "deactivateItem" -> {held.remove("use");key(c,"use").method_23481(false);c.field_1761.method_2897(c.field_1724);}
            default -> throw new IllegalArgumentException("Unsupported method");
        }
        return JsonNull.INSTANCE;
    }
    static JsonElement read(class_310 c,String name,JsonArray args) {
        if(!READS.contains(name))throw new IllegalArgumentException("Not a read-only method");
        if(name.equals("blockAt"))return block(c,point(args.get(0)));
        if(name.equals("findBlocks")||name.equals("findBlock"))return findBlocks(c,args,name.equals("findBlock"));
        if(name.equals("canSeeBlock"))return new JsonPrimitive(block(c,point(args.get(0).getAsJsonObject().get("position")))!=null);
        if(name.equals("getControlState")){String key=args.get(0).getAsString();if(!CONTROLS.contains(key))throw new IllegalArgumentException("Unknown movement control");return new JsonPrimitive(key(c,key).method_1434());}
        if(name.equals("inventory.items"))return inventory(c,false);
        String path=args.get(0).getAsString();
        switch(path) {
            case "health":return new JsonPrimitive(c.field_1724.method_6032());
            case "food":return new JsonPrimitive(c.field_1724.method_7344().method_7586());
            case "inventory.slots":return inventory(c,true);
            case "heldItem":return item(c,c.field_1724.method_31548().method_5438(c.field_1724.method_31548().field_7545),36+c.field_1724.method_31548().field_7545);
            case "game":{JsonObject out=new JsonObject();out.addProperty("dimension",c.field_1687.method_27983().method_29177().toString().replace("minecraft:",""));return out;}
            case "entity":{JsonObject out=new JsonObject();var p=c.field_1724;out.addProperty("id",p.method_5628());out.add("position",vec(p.method_23317(),p.method_23318(),p.method_23321()));var v=p.method_18798();out.add("velocity",vec(v.field_1352,v.field_1351,v.field_1350));out.addProperty("yaw",Math.PI-Math.toRadians(p.method_36454()));out.addProperty("pitch",-Math.toRadians(p.method_36455()));out.addProperty("onGround",p.method_24828());return out;}
            default:{
                String[] parts=path.split("\\.");if(parts.length!=3||!parts[0].equals("registry")||!parts[2].matches("[a-z0-9_:.-]+"))throw new IllegalArgumentException("Unsupported public read path");
                // Find by actual registry identity; never assume vanilla numeric IDs for modded clients.
                if(parts[1].equals("itemsByName")){for(var value:class_7923.field_41178){String id=class_7923.field_41178.method_10221(value).toString();if(id.equals(parts[2])||id.equals("minecraft:"+parts[2]))return registry(id,class_7923.field_41178.method_10206(value));}}
                else if(parts[1].equals("blocksByName")){for(var value:class_7923.field_41175){String id=class_7923.field_41175.method_10221(value).toString();if(id.equals(parts[2])||id.equals("minecraft:"+parts[2]))return registry(id,class_7923.field_41175.method_10206(value));}}
                else throw new IllegalArgumentException("Unsupported registry");return JsonNull.INSTANCE;
            }
        }
    }
    private static JsonObject registry(String id,int raw){JsonObject out=new JsonObject();out.addProperty("id",raw);out.addProperty("name",shortName(id));return out;}
    private static JsonElement findBlocks(class_310 c,JsonArray args,boolean first){
        if(args.size()!=1||!args.get(0).isJsonObject())throw new IllegalArgumentException("findBlock(s) requires one options object");
        JsonObject options=args.get(0).getAsJsonObject();
        if(!Set.of("point","matching","maxDistance","count","useExtraInfo").containsAll(options.keySet()))throw new IllegalArgumentException("Unknown findBlock(s) option");
        JsonElement matching=options.get("matching");
        if(matching==null)throw new IllegalArgumentException("matching requires actual numeric registry IDs");
        JsonArray ids=new JsonArray();if(matching.isJsonArray())ids=matching.getAsJsonArray();else ids.add(matching);
        if(ids.isEmpty()||ids.size()>64)throw new IllegalArgumentException("matching requires 1..64 numeric registry IDs");
        Set<Integer> types=new HashSet<>();for(JsonElement id:ids)types.add(boundedInt(id,0,Integer.MAX_VALUE));
        int radius=options.has("maxDistance")?boundedInt(options.get("maxDistance"),1,16):16;
        int count=options.has("count")?boundedInt(options.get("count"),1,64):1;
        if(options.has("useExtraInfo"))bool(options.get("useExtraInfo"));
        class_243 origin=options.has("point")?point(options.get("point")):c.field_1724.method_19538();
        if(origin.method_1022(c.field_1724.method_33571())+radius>32)throw new IllegalArgumentException("Entire search sphere must be within 32 blocks of the eyes");
        var found=BlockSearch.find(origin.field_1352,origin.field_1351,origin.field_1350,radius,first?1:count,
            cell->{
                class_2338 pos=new class_2338(cell.x(),cell.y(),cell.z());
                if(c.field_1687.method_2935().method_2857(cell.x()>>4,cell.z()>>4,class_2806.field_12803,false)==null)return false;
                return types.contains(class_7923.field_41175.method_10206(c.field_1687.method_8320(pos).method_26204()));
            },cell->block(c,new class_243(cell.x(),cell.y(),cell.z())));
        if(first)return found.isEmpty()?JsonNull.INSTANCE:found.get(0);
        JsonArray out=new JsonArray();for(JsonObject value:found)out.add(value.get("position"));return out;
    }
    private static JsonArray inventory(class_310 c,boolean slots){JsonArray out=new JsonArray();if(slots)for(int i=0;i<46;i++)out.add(JsonNull.INSTANCE);var inv=c.field_1724.method_31548();if(inv.method_5439()!=41)throw new IllegalStateException("Nonstandard player inventory; inspect native mc_bag rather than guessing slot mapping");for(int slot=0;slot<inv.method_5439();slot++){int mapped=slot<9?slot+36:slot<36?slot:slot<40?44-slot:45;JsonObject item=item(c,inv.method_5438(slot),mapped);if(slots)out.set(mapped,item==null?JsonNull.INSTANCE:item);else if(item!=null&&slot<36)out.add(item);}return out;}
    static JsonObject item(class_310 c,class_1799 stack,int slot){if(stack.method_7960())return null;JsonObject out=new JsonObject();out.addProperty("name",shortName(class_7923.field_41178.method_10221(stack.method_7909()).toString()));out.addProperty("type",class_7923.field_41178.method_10206(stack.method_7909()));out.addProperty("count",stack.method_7947());out.addProperty("slot",slot);String display=stack.method_7964().getString();out.addProperty("displayName",display.substring(0,Math.min(240,display.length())));if(display.length()>240)out.addProperty("displayNameTruncated",true);out.addProperty("instanceHash",identity(stack));return out;}
    static String identity(class_1799 stack){if(stack.method_7960())return null;try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((class_7923.field_41178.method_10206(stack.method_7909())+":"+stack.method_7947()+":"+stack.method_57353()).getBytes(StandardCharsets.UTF_8)));}catch(Exception error){throw new IllegalStateException("Item identity hash unavailable",error);}}
    static List<String> inventoryIdentities(class_310 c){List<String> out=new ArrayList<>();var inv=c.field_1724.method_31548();for(int i=0;i<inv.method_5439();i++)out.add(identity(inv.method_5438(i)));return out;}
    private static JsonObject block(class_310 c,class_243 p){
        class_2338 pos=cell(p);var world=c.field_1687;
        if(p.method_1022(c.field_1724.method_33571())>32||world.method_2935().method_2857(pos.method_10263()>>4,pos.method_10260()>>4,class_2806.field_12803,false)==null)return null;
        // Raycast against real collision geometry; conservative unknown for occlusion.
        boolean visible=false;var eye=c.field_1724.method_33571();
        for(double[] offset:new double[][]{{.5,.5,.5},{.001,.5,.5},{.999,.5,.5},{.5,.001,.5},{.5,.999,.5},{.5,.5,.001},{.5,.5,.999}}){
            var to=new class_243(pos.method_10263()+offset[0],pos.method_10264()+offset[1],pos.method_10260()+offset[2]);
            var hit=world.method_17742(new class_3959(eye,to,class_3959.class_3960.field_17559,class_3959.class_242.field_1348,c.field_1724));
            if(hit.method_17783()==class_239.class_240.field_1333||hit.method_17777().equals(pos)){visible=true;break;}
        }
        if(!visible)return null;
        class_2680 state=world.method_8320(pos);JsonObject out=registry(class_7923.field_41175.method_10221(state.method_26204()).toString(),class_7923.field_41175.method_10206(state.method_26204()));
        out.add("type",out.remove("id"));out.addProperty("stateId",class_2248.method_9507(state));out.add("position",vec(pos.method_10263(),pos.method_10264(),pos.method_10260()));
        JsonObject properties=new JsonObject();state.method_11656().forEach((key,value)->{if(value instanceof Boolean b)properties.addProperty(key.method_11899(),b);else if(value instanceof Number n)properties.addProperty(key.method_11899(),n);else properties.addProperty(key.method_11899(),value.toString().toLowerCase(Locale.ROOT));});out.add("properties",properties);
        return out;
    }
    private static String shortName(String id){return id.startsWith("minecraft:")?id.substring(10):id;}
    private static void look(class_310 c,double yaw,double pitch){if(Math.abs(pitch)>Math.PI/2)throw new IllegalArgumentException("Pitch must be radians within +/- PI/2");double degrees=180-Math.toDegrees(yaw);degrees=((degrees+180)%360+360)%360-180;c.field_1724.method_36456((float)degrees);c.field_1724.method_36457((float)-Math.toDegrees(pitch));}
    private static class_304 key(class_310 c,String key){return switch(key){case "forward"->c.field_1690.field_1894;case "back"->c.field_1690.field_1881;case "left"->c.field_1690.field_1913;case "right"->c.field_1690.field_1849;case "jump"->c.field_1690.field_1903;case "sneak"->c.field_1690.field_1832;case "sprint"->c.field_1690.field_1867;case "use"->c.field_1690.field_1904;default->throw new IllegalArgumentException("Unknown control key");};}
    private static boolean bool(JsonElement e){if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isBoolean())throw new IllegalArgumentException("Expected boolean");return e.getAsBoolean();}
    private static double number(JsonElement e){if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isNumber()||!Double.isFinite(e.getAsDouble()))throw new IllegalArgumentException("Expected finite number");return e.getAsDouble();}
    private static int boundedInt(JsonElement e,int min,int max){double n=number(e);if(n!=Math.floor(n)||n<min||n>max)throw new IllegalArgumentException("Integer outside method bounds");return(int)n;}
    private static class_243 point(JsonElement e){JsonObject o=e.getAsJsonObject();double x=number(o.get("x")),y=number(o.get("y")),z=number(o.get("z"));if(Math.max(Math.abs(x),Math.max(Math.abs(y),Math.abs(z)))>30000000)throw new IllegalArgumentException("Point outside world bounds");return new class_243(x,y,z);}
    private static boolean integral(class_243 p){return p.field_1352==Math.floor(p.field_1352)&&p.field_1351==Math.floor(p.field_1351)&&p.field_1350==Math.floor(p.field_1350);}
    private static class_2338 cell(class_243 p){return new class_2338((int)Math.floor(p.field_1352),(int)Math.floor(p.field_1351),(int)Math.floor(p.field_1350));}
    private static JsonObject vec(double x,double y,double z){JsonObject out=new JsonObject();out.addProperty("x",x);out.addProperty("y",y);out.addProperty("z",z);return out;}
}
