package org.agentmc.bridge;

import com.google.gson.*;
import java.util.*;
import java.util.function.Supplier;

/** Ordered idempotent calls within one native body reservation. All access is on the game thread. */
public final class MethodCalls {
    private final Map<Integer,JsonObject> replies=new LinkedHashMap<>();
    private final Map<Integer,String> inputs=new HashMap<>();
    private JsonObject pending;
    private Runnable deferred;
    private Supplier<Boolean> completion;
    private int tick,until;
    public JsonObject call(int id,String input,int ticks,Supplier<JsonElement> invoke,Supplier<Runnable> afterTicks){
        return call(id,input,ticks,invoke,afterTicks,()->null);
    }
    public JsonObject call(int id,String input,int ticks,Supplier<JsonElement> invoke,Supplier<Runnable> afterTicks,Supplier<Supplier<Boolean>> untilComplete){
        if(inputs.containsKey(id)){if(!inputs.get(id).equals(input))throw new IllegalArgumentException("Method call ID payload changed");return replies.get(id);}
        if(id!=replies.size()+1||id>32||pending!=null)throw new IllegalStateException("Await each method call, at most 32 calls per session");
        if(ticks<1||ticks>200)throw new IllegalArgumentException("ticks must be 1..200");
        JsonObject out=new JsonObject();out.addProperty("call",id);inputs.put(id,input);replies.put(id,out);
        try{JsonElement value=invoke.get();out.add("value",value==null?JsonNull.INSTANCE:value);deferred=afterTicks.get();completion=untilComplete.get();until=tick+ticks+1;pending=out;out.addProperty("status","running");}
        catch(Exception error){deferred=null;completion=null;out.addProperty("status","failed");out.addProperty("error",error.getMessage());}
        return out;
    }
    public void tick(){if(++tick>=until&&pending!=null){try{if(deferred!=null){Runnable once=deferred;deferred=null;once.run();}if(completion!=null&&!completion.get())return;pending.addProperty("status","completed");}catch(Exception error){pending.addProperty("status","failed");pending.addProperty("error",error.getMessage());}pending=null;deferred=null;completion=null;}}
    public JsonObject result(int id){JsonObject out=replies.get(id);if(out==null)throw new IllegalArgumentException("Unknown method call; reconcile original ID");return out;}
    public boolean pending(){return pending!=null;}
}
