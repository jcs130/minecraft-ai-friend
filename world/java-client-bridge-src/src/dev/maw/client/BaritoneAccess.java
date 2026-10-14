package dev.maw.client;

import com.google.gson.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.function.Predicate;
import java.util.concurrent.*;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.Entity;
import static dev.maw.client.ClientState.object;

/** Optional public API only. No Baritone classes or code are bundled. Client-thread owned. */
final class BaritoneAccess {
    private static final Class<?>[] NONE=new Class<?>[0];
    private final Minecraft mc=Minecraft.getInstance();
    private final Map<String,Object> previous=new LinkedHashMap<>(),assigned=new LinkedHashMap<>();
    private Object primary;
    private boolean owned;
    private final ExecutorService preparation=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"maw-baritone-prepare");t.setDaemon(true);return t;});
    private CompletableFuture<Object> mineLookup;
    private int mineTarget;
    void close(){preparation.shutdownNow();}
    boolean preparingMine(){return mineLookup!=null;}
    void tickMine()throws Exception{
        if(mineLookup==null||!mineLookup.isDone())return;
        Object lookup;
        try{lookup=mineLookup.join();}catch(CompletionException|CancellationException error){throw new IllegalStateException("baritone_mining_prepare_failed",error);}
        mineLookup=null;
        invoke(process("getMineProcess"),"baritone.api.process.IMineProcess","mine",new Class<?>[]{int.class,type("baritone.api.utils.BlockOptionalMetaLookup")},mineTarget,lookup);
    }
    boolean available(){
        try{Class.forName("baritone.api.BaritoneAPI",false,getClass().getClassLoader());return true;}
        catch(ClassNotFoundException|LinkageError error){return false;}
    }
    private Class<?> type(String name)throws ClassNotFoundException{return Class.forName(name);}
    private Object invoke(Object target,String api,String method,Class<?>[] params,Object...args)throws Exception{
        try{return type(api).getMethod(method,params).invoke(target,args);}
        catch(InvocationTargetException error){throw new IllegalStateException("baritone_api_call_failed",error.getCause());}
    }
    private Object api(String method)throws Exception{return invoke(null,"baritone.api.BaritoneAPI",method,NONE);}
    private Object bot()throws Exception{
        if(!available())throw new IllegalStateException("baritone_not_installed");
        primary=invoke(api("getProvider"),"baritone.api.IBaritoneProvider","getPrimaryBaritone",NONE);
        Object context=invoke(primary,"baritone.api.IBaritone","getPlayerContext",NONE);
        if(invoke(context,"baritone.api.utils.IPlayerContext","player",NONE)!=mc.player)throw new IllegalStateException("baritone_body_mismatch");
        return primary;
    }
    private Object process(String method)throws Exception{return invoke(bot(),"baritone.api.IBaritone",method,NONE);}
    private Object pathing()throws Exception{return process("getPathingBehavior");}
    private boolean active(String method)throws Exception{return (boolean)invoke(process(method),"baritone.api.process.IBaritoneProcess","isActive",NONE);}
    boolean busy()throws Exception{
        if(!available()||mc.player==null)return false;
        if((boolean)invoke(pathing(),"baritone.api.behavior.IPathingBehavior","isPathing",NONE))return true;
        if(((Optional<?>)invoke(pathing(),"baritone.api.behavior.IPathingBehavior","getInProgress",NONE)).isPresent())return true;
        for(String method:List.of("getCustomGoalProcess","getMineProcess","getFollowProcess","getFarmProcess","getBuilderProcess","getExploreProcess","getGetToBlockProcess","getElytraProcess"))if(active(method))return true;
        return false;
    }
    boolean owned(){return owned;}
    boolean atGoal(BlockPos target)throws Exception{
        Object context=invoke(bot(),"baritone.api.IBaritone","getPlayerContext",NONE);
        return target.equals(invoke(context,"baritone.api.utils.IPlayerContext","playerFeet",NONE));
    }
    private Object setting(String key)throws Exception{return api("getSettings").getClass().getField(key).get(api("getSettings"));}
    private Object value(String key)throws Exception{Object setting=setting(key);return setting.getClass().getField("value").get(setting);}
    private void write(String key,Object value)throws Exception{Object setting=setting(key);setting.getClass().getField("value").set(setting,value);}
    private void set(String key,Object value)throws Exception{previous.put(key,value(key));assigned.put(key,value);write(key,value);}
    void begin(String operation,JsonObject args)throws Exception{
        if(owned||busy())throw new IllegalStateException("baritone_already_controlled");
        bot();owned=true;
        try{
            set("allowBreak",operation.equals("baritone.mine"));set("allowPlace",false);
            set("legitMine",true);set("legitMineIncludeDiagonals",false);set("chatControl",false);set("prefixControl",false);
            switch(operation){
                case "baritone.goto" -> {
                    JsonObject p=args.getAsJsonObject("position");Object goal=type("baritone.api.pathing.goals.GoalBlock").getConstructor(int.class,int.class,int.class)
                        .newInstance(p.get("x").getAsInt(),p.get("y").getAsInt(),p.get("z").getAsInt());
                    invoke(process("getCustomGoalProcess"),"baritone.api.process.ICustomGoalProcess","setGoalAndPath",new Class<?>[]{type("baritone.api.pathing.goals.Goal")},goal);
                }
                case "baritone.mine" -> {
                    String[] blocks=new String[args.getAsJsonArray("blocks").size()];for(int i=0;i<blocks.length;i++)blocks[i]=args.getAsJsonArray("blocks").get(i).getAsString();
                    mineTarget=args.get("targetCount").getAsInt();
                    // BlockOptionalMeta's first loot reload schedules work on Minecraft's executor.
                    // Constructing it and joining its registry future on that same thread can deadlock.
                    // Preparation builds an immutable public-API filter only; game dispatch stays here.
                    mineLookup=CompletableFuture.supplyAsync(()->{
                        try{return type("baritone.api.utils.BlockOptionalMetaLookup").getConstructor(String[].class).newInstance((Object)blocks);}
                        catch(Exception error){throw new CompletionException(error);}
                    },preparation);
                }
                case "baritone.follow" -> {
                    UUID target=UUID.fromString(args.get("targetUuid").getAsString());Predicate<Entity> predicate=e->e!=mc.player&&e.isAlive()&&e.getUUID().equals(target);
                    invoke(process("getFollowProcess"),"baritone.api.process.IFollowProcess","follow",new Class<?>[]{Predicate.class},predicate);
                }
                case "baritone.farm" -> {
                    set("farmWaitForGrowth",true);
                    invoke(process("getFarmProcess"),"baritone.api.process.IFarmProcess","farm",new Class<?>[]{int.class,BlockPos.class},args.get("radius").getAsInt(),mc.player.blockPosition());
                }
                default -> throw new IllegalArgumentException("baritone_operation_unavailable");
            }
        }catch(Exception error){stopOwned();throw error;}
    }
    boolean stopOwned()throws Exception{
        if(!owned)return true;
        if(mineLookup!=null){mineLookup.cancel(true);mineLookup=null;}
        boolean immediate=false;
        try{
            if(primary!=null){
                Object behavior=invoke(primary,"baritone.api.IBaritone","getPathingBehavior",NONE);
                immediate=(boolean)invoke(behavior,"baritone.api.behavior.IPathingBehavior","cancelEverything",NONE);
                Object input=invoke(primary,"baritone.api.IBaritone","getInputOverrideHandler",NONE);
                invoke(input,"baritone.api.utils.IInputOverrideHandler","clearAllKeys",NONE);
            }
        }finally{
            for(String key:previous.keySet())if(Objects.equals(value(key),assigned.get(key)))write(key,previous.get(key));
            previous.clear();assigned.clear();owned=false;
        }
        return immediate;
    }
    JsonObject state(){
        JsonObject out=object("available",available(),"owned",owned,"preparingMine",preparingMine(),"testedVersion","1.11.3","authority","client_observed");
        if(!available()){out.addProperty("code","baritone_not_installed");return out;}
        if(mc.player==null){out.addProperty("code","client_body_offline");return out;}
        try{
            Object behavior=pathing();out.addProperty("busy",busy());
            out.addProperty("pathing",(boolean)invoke(behavior,"baritone.api.behavior.IPathingBehavior","isPathing",NONE));
            out.addProperty("calculating",((Optional<?>)invoke(behavior,"baritone.api.behavior.IPathingBehavior","getInProgress",NONE)).isPresent());
            out.addProperty("goal",String.valueOf(invoke(behavior,"baritone.api.behavior.IPathingBehavior","getGoal",NONE)));
            Optional<?> estimate=(Optional<?>)invoke(behavior,"baritone.api.behavior.IPathingBehavior","estimatedTicksToGoal",NONE);
            out.add("estimatedTicks",estimate.isPresent()?new Gson().toJsonTree(estimate.get()):JsonNull.INSTANCE);
            out.addProperty("legitMine",(boolean)value("legitMine"));out.addProperty("allowBreak",(boolean)value("allowBreak"));out.addProperty("allowPlace",(boolean)value("allowPlace"));
        }catch(Exception|LinkageError error){out.addProperty("code","baritone_api_unavailable");out.addProperty("available",false);}
        return out;
    }
    int itemCount(String id){
        int count=0;for(int i=0;i<mc.player.getInventory().getContainerSize();i++){
            var stack=mc.player.getInventory().getItem(i);if(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString().equals(id))count+=stack.getCount();
        }return count;
    }
    boolean targetPresent(String id){
        for(Entity e:mc.level.entitiesForRendering())if(e!=mc.player&&e.isAlive()&&e.getUUID().toString().equals(id))return true;
        return false;
    }
    void validate(String operation,JsonObject args)throws Exception{
        if(!available())throw new IllegalStateException("baritone_not_installed");
        if(busy())throw new IllegalStateException("baritone_already_controlled");
        if(operation.equals("baritone.mine")){
            if(args.getAsJsonArray("blocks").isEmpty()||args.getAsJsonArray("blocks").size()>16)throw new IllegalArgumentException("mining_blocks_invalid");
            for(JsonElement e:args.getAsJsonArray("blocks"))if(!BuiltInRegistries.BLOCK.containsKey(ResourceLocation.parse(e.getAsString())))throw new IllegalArgumentException("mining_block_unknown");
            if(!BuiltInRegistries.ITEM.containsKey(ResourceLocation.parse(args.get("itemId").getAsString())))throw new IllegalArgumentException("mining_drop_item_unknown");
        }
        if(operation.equals("baritone.follow")&&!targetPresent(UUID.fromString(args.get("targetUuid").getAsString()).toString()))throw new IllegalArgumentException("follow_target_not_loaded_or_alive");
    }
}
