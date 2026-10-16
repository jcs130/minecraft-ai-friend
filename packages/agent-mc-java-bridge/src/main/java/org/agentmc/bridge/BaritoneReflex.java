package org.agentmc.bridge;
import java.lang.reflect.*;
import net.minecraft.class_2338;

/** Temporary public-API process: pauses an owned task without replacing its goal. */
final class BaritoneReflex {
    private static final java.util.Set<Object> OWNED=java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
    static boolean owned(Object process){return OWNED.contains(process);}
    private boolean active;
    private Object process,goal;
    private String goalKey;
    private final SettingLease policy=new SettingLease();
    private boolean leased;
    private static Class<?> type(String name)throws ClassNotFoundException{return Class.forName("baritone.api."+name);}
    void update(boolean enabled,com.google.gson.JsonObject target)throws Exception {
        if(!BaritoneNavigation.available()){if(enabled&&target!=null)throw new IllegalStateException("Reflex navigation unavailable");active=false;return;}
        if(enabled&&!leased){Object settings=type("BaritoneAPI").getMethod("getSettings").invoke(null);leased=true;
            for(String setting:java.util.List.of("allowBreak","allowPlace","allowInventory","allowParkour","allowParkourPlace","allowWaterBucketFall"))policy.set(settings,setting,false);
            policy.set(settings,"allowBreakAnyway",java.util.List.of());policy.set(settings,"maxFallHeightNoWater",3);policy.set(settings,"maxFallHeightBucket",3);}
        if(process==null){
            Class<?> contract=type("process.IBaritoneProcess");
            process=Proxy.newProxyInstance(contract.getClassLoader(),new Class<?>[]{contract},(proxy,method,args)->switch(method.getName()){
                case "isActive"->active;
                case "isTemporary"->true;
                case "priority"->1000D;
                case "displayName","displayName0","toString"->"Agent MC shared reflex body";
                case "hashCode"->System.identityHashCode(proxy);
                case "equals"->proxy==args[0];
                case "onLostControl"->null;
                case "onTick"->{Class<?> command=type("process.PathingCommand"),kind=type("process.PathingCommandType");
                    Object tag=kind.getField(goal==null?"REQUEST_PAUSE":"SET_GOAL_AND_PATH").get(null);
                    yield command.getConstructor(type("pathing.goals.Goal"),kind).newInstance(goal,tag);}
                default->throw new IllegalStateException("Unsupported reflex process API: "+method.getName());
            });
            OWNED.add(process);
            Object provider=type("BaritoneAPI").getMethod("getProvider").invoke(null);
            Object baritone=type("IBaritoneProvider").getMethod("getPrimaryBaritone").invoke(provider);
            Object manager=type("IBaritone").getMethod("getPathingControlManager").invoke(baritone);
            type("pathing.calc.IPathingControlManager").getMethod("registerProcess",contract).invoke(manager,process);
        }
        String key=enabled&&target!=null?target.toString():null;
        if(java.util.Objects.equals(goalKey,key)){active=enabled;return;}
        goalKey=key;goal=null;
        if(enabled&&target!=null){
            String kind=target.get("kind").getAsString();int x=target.get("x").getAsInt(),z=target.get("z").getAsInt();
            if(kind.equals("xz"))goal=type("pathing.goals.GoalXZ").getConstructor(int.class,int.class).newInstance(x,z);
            else {int y=target.get("y").getAsInt(),range=target.has("range")?target.get("range").getAsInt():0;
                goal=range==0?type("pathing.goals.GoalBlock").getConstructor(int.class,int.class,int.class).newInstance(x,y,z)
                    :type("pathing.goals.GoalNear").getConstructor(class_2338.class,int.class).newInstance(new class_2338(x,y,z),range);}
        }
        active=enabled;
    }
    void stop(){active=false;goal=null;goalKey=null;if(leased){try{policy.restore();leased=false;}catch(Exception error){throw new IllegalStateException("Native reflex navigation policy restoration unconfirmed",error);}}}
}
