package org.agentmc.bridge;

import com.google.gson.*;
import net.minecraft.*;
import java.util.*;

/** Native queue and method sessions share one explicitly requested navigator. */
final class NativeNavigation {
    static final String PROTOCOL="agent-mc-navigation/v1";
    private final class_310 client;
    private NavigationSession session;
    private BaritoneNavigation driver;
    private Object player,world;
    private class_243 previous;
    private String owner;
    private boolean cleanupPending;
    NativeNavigation(class_310 client){this.client=client;}
    static NavigationSession.Goal validate(JsonObject goal){
        if(goal==null||goal.keySet().stream().anyMatch(k->!Set.of("x","y","z","rangeSq").contains(k)))throw new IllegalArgumentException("GoalBlock/GoalNear x/y/z/rangeSq required");
        for(String key:List.of("x","y","z"))if(!goal.has(key)||!goal.get(key).isJsonPrimitive()||!goal.get(key).getAsJsonPrimitive().isNumber()||goal.get(key).getAsDouble()!=goal.get(key).getAsInt()||Math.abs(goal.get(key).getAsDouble())>30000000)throw new IllegalArgumentException("Goal coordinates must be bounded integers");
        if(goal.has("rangeSq")&&(!goal.get("rangeSq").isJsonPrimitive()||!goal.get("rangeSq").getAsJsonPrimitive().isNumber()))throw new IllegalArgumentException("GoalNear rangeSq must be numeric");
        double range=goal.has("rangeSq")?Math.sqrt(goal.get("rangeSq").getAsDouble()):0;
        if(!Double.isFinite(range)||range!=(int)range||range<0||range>16)throw new IllegalArgumentException("GoalNear range must be integer0..16");
        return new NavigationSession.Goal(goal.get("x").getAsInt(),goal.get("y").getAsInt(),goal.get("z").getAsInt(),(int)range);
    }
    boolean available(){return BaritoneNavigation.available();}
    boolean unresolved(){return driver!=null&&(cleanupPending||session==null||session.phase().equals("unknown"));}
    String owner(){return owner;}
    void start(JsonObject goal,int timeoutMs,String actionId) throws Exception {
        NavigationSession.Goal target=validate(goal);
        if(!available())throw new IllegalStateException("Baritone navigation capability unavailable");
        if(timeoutMs<1000||timeoutMs>120000)throw new IllegalArgumentException("Navigation timeoutMs1000..120000");
        if(driver!=null&&!cancel())throw new IllegalStateException("Original navigation cleanup unknown; no new goal dispatched");
        if(client.field_1724==null||client.field_1687==null||client.field_1755!=null||client.field_1724.method_6032()<=0||!client.field_1724.method_24828())throw new IllegalStateException("Close GUI and verify a living grounded body before walking navigation");
        player=client.field_1724;world=client.field_1687;previous=client.field_1724.method_19538();
        driver=new BaritoneNavigation();owner=actionId;cleanupPending=false;
        try{session=new NavigationSession(driver,target,feet(),System.currentTimeMillis(),timeoutMs);}
        catch(Exception error){if(cancel())throw error;throw new IllegalStateException("Navigation start failed and cancellation unknown",error);}
    }
    String tick() throws Exception {
        if(session==null)throw new IllegalStateException("No navigation session");
        if(client.field_1724!=player||client.field_1687!=world||client.field_1724.method_6032()<=0||client.field_1755!=null||client.field_1724.method_19538().method_1022(previous)>8){
            if(!cancel())throw new IllegalStateException("Navigation body changed and cancellation unknown");
            throw new IllegalStateException("Navigation revoked by GUI/death/respawn/dimension/teleport");
        }
        previous=client.field_1724.method_19538();session.tick(feet(),client.field_1724.method_24828(),System.currentTimeMillis());return session.phase();
    }
    boolean cancel() throws Exception {
        if(driver==null)return true;
        cleanupPending=true;
        boolean stopped=session==null?!driver.owns()||driver.stop()&&driver.idle():session.cancel(System.currentTimeMillis());
        cleanupPending=!stopped;
        if(stopped){driver.restore();driver=null;session=null;owner=null;}
        return stopped;
    }
    String reason(){return session==null?"Navigation not running":session.reason();}
    JsonObject report(){
        JsonObject out=new JsonObject();out.addProperty("protocol",PROTOCOL);out.addProperty("navigator","baritone");
        if(session!=null){out.addProperty("phase",session.phase());out.addProperty("reason",session.reason());out.add("goal",new Gson().toJsonTree(session.goal()));}
        out.add("feet",client.field_1724==null?JsonNull.INSTANCE:new Gson().toJsonTree(feet()));if(client.field_1724!=null)out.addProperty("onGround",client.field_1724.method_24828());out.addProperty("cleanupPending",unresolved());if(owner!=null)out.addProperty("actionId",owner);return out;
    }
    private double[] feet(){return client.field_1724==null?new double[]{Double.NaN,Double.NaN,Double.NaN}:new double[]{client.field_1724.method_23317(),client.field_1724.method_23318(),client.field_1724.method_23321()};}
}
