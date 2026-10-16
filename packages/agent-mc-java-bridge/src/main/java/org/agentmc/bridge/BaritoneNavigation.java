package org.agentmc.bridge;

import java.lang.reflect.*;
import java.util.*;
import net.minecraft.class_2338;

/** Optional public API binding. Discovery initializes no navigator or game action. */
final class BaritoneNavigation implements NavigationSession.Driver {
    private static Class<?> type(String name) throws ClassNotFoundException {return Class.forName("baritone.api."+name,false,BaritoneNavigation.class.getClassLoader());}
    private static Throwable discoveryFailure;
    private static final boolean API_AVAILABLE=detect();
    static boolean available(){return API_AVAILABLE;}
    static String diagnostic(){return discoveryFailure==null?"available":discoveryFailure.toString();}
    private static boolean detect(){
        try{
            type("BaritoneAPI").getMethod("getProvider");type("BaritoneAPI").getMethod("getSettings");
            type("IBaritoneProvider").getMethod("getPrimaryBaritone");
            for(String getter:List.of("getCustomGoalProcess","getPathingBehavior","getPathingControlManager","getMineProcess","getBuilderProcess","getExploreProcess","getFarmProcess","getFollowProcess","getGetToBlockProcess","getElytraProcess"))type("IBaritone").getMethod(getter);
            type("process.IBaritoneProcess").getMethod("isActive");
            type("pathing.calc.IPathingControlManager").getMethod("mostRecentInControl");
            type("process.ICustomGoalProcess").getMethod("setGoalAndPath",type("pathing.goals.Goal"));
            type("process.ICustomGoalProcess").getMethod("mostRecentGoal");
            type("behavior.IPathingBehavior").getMethod("cancelEverything");
            type("behavior.IPathingBehavior").getMethod("getInProgress");
            type("behavior.IPathingBehavior").getMethod("getCurrent");type("behavior.IPathingBehavior").getMethod("getNext");
            for(String setting:List.of("allowBreak","allowPlace","allowInventory","allowParkour","allowParkourPlace","allowWaterBucketFall","allowBreakAnyway","maxFallHeightNoWater","maxFallHeightBucket"))type("Settings").getField(setting).getType().getField("value");
            type("pathing.goals.GoalNear").getConstructor(class_2338.class,int.class);
            type("pathing.goals.GoalBlock").getConstructor(int.class,int.class,int.class);
            return true;
        }catch(ReflectiveOperationException|LinkageError error){discoveryFailure=error;return false;}
    }
    private Object baritone,pathing,process,goal;
    private boolean stopRequested;
    BaritoneNavigation(){}
    /** Public-API objects can be supplied by an offline contract check, without a live provider. */
    BaritoneNavigation(Object baritone,Object pathing,Object process,Object goal){this.baritone=baritone;this.pathing=pathing;this.process=process;this.goal=goal;}
    static boolean busyForReflex()throws Exception {
        if(!available())return false;
        Object provider=type("BaritoneAPI").getMethod("getProvider").invoke(null),baritone=type("IBaritoneProvider").getMethod("getPrimaryBaritone").invoke(provider);
        Object manager=type("IBaritone").getMethod("getPathingControlManager").invoke(baritone);
        Optional<?> controller=(Optional<?>)type("pathing.calc.IPathingControlManager").getMethod("mostRecentInControl").invoke(manager);
        if(controller.isPresent()&&BaritoneReflex.owned(controller.get()))return false;
        for(String getter:List.of("getCustomGoalProcess","getMineProcess","getBuilderProcess","getExploreProcess","getFarmProcess","getFollowProcess","getGetToBlockProcess","getElytraProcess")){
            Object process=type("IBaritone").getMethod(getter).invoke(baritone);if((boolean)type("process.IBaritoneProcess").getMethod("isActive").invoke(process))return true;
        }
        Object path=type("IBaritone").getMethod("getPathingBehavior").invoke(baritone);
        return type("behavior.IPathingBehavior").getMethod("getCurrent").invoke(path)!=null;
    }
    private final SettingLease policy=new SettingLease();
    private Object invoke(String owner,String name,Object target) throws Exception {return type(owner).getMethod(name).invoke(target);}
    private Object get(String name) throws Exception {return invoke("IBaritone",name,baritone);}
    private boolean active(Object target) throws Exception {return (boolean)invoke("process.IBaritoneProcess","isActive",target);}
    private boolean foreignActive() throws Exception {
        Optional<?> controller=(Optional<?>)invoke("pathing.calc.IPathingControlManager","mostRecentInControl",get("getPathingControlManager"));
        if(controller.isPresent()&&controller.get()!=process&&!BaritoneReflex.owned(controller.get())&&active(controller.get()))return true;
        for(String getter:List.of("getMineProcess","getBuilderProcess","getExploreProcess","getFarmProcess","getFollowProcess","getGetToBlockProcess","getElytraProcess"))if(active(get(getter)))return true;
        return false;
    }
    private boolean sharedReflexController() throws Exception {
        Optional<?> controller=(Optional<?>)invoke("pathing.calc.IPathingControlManager","mostRecentInControl",get("getPathingControlManager"));
        return controller.isPresent()&&BaritoneReflex.owned(controller.get());
    }
    boolean canStart() throws Exception {
        // A shared reflex path may still be draining on the same game tick after its lease ended.
        // The normal process manager transfers that path; arbitrary foreign paths stay protected.
        return !active(process)&&!foreignActive()&&(idle()||sharedReflexController());
    }
    public void start(NavigationSession.Goal target) throws Exception {
        if(!available())throw new IllegalStateException("Matching Baritone public API unavailable; no navigation dispatched");
        Object provider=type("BaritoneAPI").getMethod("getProvider").invoke(null);
        baritone=invoke("IBaritoneProvider","getPrimaryBaritone",provider);
        pathing=get("getPathingBehavior");process=get("getCustomGoalProcess");
        if(!canStart())throw new IllegalStateException("Another navigator process owns the client; no goal replaced");
        goal=target.range()==0?type("pathing.goals.GoalBlock").getConstructor(int.class,int.class,int.class).newInstance(target.x(),target.y(),target.z())
            :type("pathing.goals.GoalNear").getConstructor(class_2338.class,int.class).newInstance(new class_2338(target.x(),target.y(),target.z()),target.range());
        Object settings=type("BaritoneAPI").getMethod("getSettings").invoke(null);
        try{
            for(String name:List.of("allowBreak","allowPlace","allowInventory","allowParkour","allowParkourPlace","allowWaterBucketFall"))set(settings,name,false);
            set(settings,"allowBreakAnyway",List.of());set(settings,"maxFallHeightNoWater",3);set(settings,"maxFallHeightBucket",3);
            type("process.ICustomGoalProcess").getMethod("setGoalAndPath",type("pathing.goals.Goal")).invoke(process,goal);
        }catch(Exception error){
            // Starting a goal may fail after it was installed. Retain the owned driver for cancellation.
            if(goal==null||!owns()||stop()&&idle())restore();
            throw error;
        }
    }
    private void set(Object settings,String name,Object value) throws Exception {
        policy.set(settings,name,value);
    }
    public boolean owns() throws Exception {
        if(process==null||goal==null||foreignActive())return false;
        Object binding=invoke("process.ICustomGoalProcess","mostRecentGoal",process);
        // cancelEverything retires the process before its path/calculation necessarily drains.
        // Keep our cleanup obligation until the measured path is idle; a different goal is foreign.
        return binding==goal||stopRequested&&binding==null&&!active(process);
    }
    public boolean idle() throws Exception {return pathing==null||invoke("behavior.IPathingBehavior","getCurrent",pathing)==null&&invoke("behavior.IPathingBehavior","getNext",pathing)==null&&((Optional<?>)invoke("behavior.IPathingBehavior","getInProgress",pathing)).isEmpty()&&(!stopRequested||!active(process));}
    public boolean stop() throws Exception {
        if(stopRequested&&!active(process)||!owns())return true;
        stopRequested=true;
        // The API boolean is a synchronous path-stop hint, not cancellation acknowledgement.
        // It may be false while already idle. NavigationSession independently checks idle().
        invoke("behavior.IPathingBehavior","cancelEverything",pathing);return true;
    }
    public void restore() throws Exception {
        policy.restore();
    }
}
