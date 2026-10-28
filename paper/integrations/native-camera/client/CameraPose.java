package org.qiandeng.camera;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.*;
import org.agentmc.bridge.ClientBridge;

/** A short render-only lease. It never moves the player, sends commands or loads chunks. */
public final class CameraPose {
    public record Pose(UUID job,UUID nonce,UUID owner,int entityId,double x,double y,double z,float yaw,float pitch,double anchorX,double anchorY,double anchorZ,String mode,long expires) { }
    private static volatile Pose active;
    private static long nextRead;
    public static void refresh(class_310 client,String instance) {
        long now=System.currentTimeMillis();if(now<nextRead)return;nextRead=now+100;
        try{
            Path file=FabricLoader.getInstance().getGameDir().resolve("agent-mc-bridge/camera-pose.json");
            if(!Files.isRegularFile(file)||Files.size(file)>4096){active=null;return;}
            JsonObject row=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            long expires=row.get("expiresAt").getAsLong();
            if(!instance.equals(row.get("instanceId").getAsString())||expires<=now||expires>now+5000){active=null;return;}
            String mode=row.get("mode").getAsString();if(!Set.of("first","third","top").contains(mode))throw new IllegalArgumentException();
            double x=row.get("x").getAsDouble(),y=row.get("y").getAsDouble(),z=row.get("z").getAsDouble(),yaw=row.get("yaw").getAsDouble(),pitch=row.get("pitch").getAsDouble();
            if(!Double.isFinite(x)||!Double.isFinite(y)||!Double.isFinite(z)||!Double.isFinite(yaw)||!Double.isFinite(pitch)||Math.abs(x)>30_000_000||Math.abs(z)>30_000_000||y< -2048||y>4096||Math.abs(pitch)>90)throw new IllegalArgumentException();
            double ax=row.get("anchorX").getAsDouble(),ay=row.get("anchorY").getAsDouble(),az=row.get("anchorZ").getAsDouble();if(!Double.isFinite(ax)||!Double.isFinite(ay)||!Double.isFinite(az))throw new IllegalArgumentException();
            active=new Pose(UUID.fromString(row.get("job").getAsString()),UUID.fromString(row.get("nonce").getAsString()),UUID.fromString(row.get("owner").getAsString()),row.get("entityId").getAsInt(),x,y,z,(float)yaw,(float)pitch,ax,ay,az,mode,expires);
        }catch(Exception invalid){active=null;}
    }
    public static Pose applicable(class_310 client){
        Pose pose=active;if(pose==null||pose.expires<=System.currentTimeMillis()||client.field_1687==null||ClientBridge.hasController())return null;
        class_1297 owner=client.field_1687.method_8469(pose.entityId);
        if(owner==null||!owner.method_5667().equals(pose.owner)||owner.method_19538().method_1022(new class_243(pose.x,pose.y,pose.z))>24)return null;
        if(owner.method_19538().method_1022(new class_243(pose.anchorX,pose.anchorY,pose.anchorZ))>0.75)return null;
        if(!client.field_1687.method_8393((int)Math.floor(pose.x/16),(int)Math.floor(pose.z/16)))return null;
        return pose;
    }
}
