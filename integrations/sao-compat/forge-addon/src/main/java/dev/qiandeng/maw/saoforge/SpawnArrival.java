package dev.qiandeng.maw.saoforge;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.server.ServerLifecycleHooks;
import org.slf4j.LoggerFactory;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Opt-in operator-configured arrival repair. Original player items/progress stay untouched. */
@Mod.EventBusSubscriber(modid="maw_sao_native",bus=Mod.EventBusSubscriber.Bus.FORGE,value=Dist.DEDICATED_SERVER)
public final class SpawnArrival {
    private static final String HANDLED="mawArrivalHandled20261031",WELCOME="mawArrivalWelcome20261031";
    private static Config config;
    private record Config(ServerLevel level,BlockPos anchor,double x,double y,double z,float yaw,ArrivalPolicy.Bounds legacy,String legacyDimension,Set<UUID> migrate,String message,Path audit){}
    @SubscribeEvent public static void started(ServerStartedEvent event){
        config=null;Path file=Path.of("config/maw-arrival.json");if(!Files.exists(file))return;
        try{
            if(Files.size(file)>32768)throw new IllegalArgumentException("arrival_config_budget");
            JsonObject root=JsonParser.parseString(Files.readString(file)).getAsJsonObject();if(root.get("schemaVersion").getAsInt()!=1)throw new IllegalArgumentException("arrival_schema");
            if(!root.get("enabled").getAsBoolean())return;
            MinecraftServer server=event.getServer();String dimension=root.get("dimension").getAsString();ServerLevel level=null;
            for(ServerLevel candidate:server.getAllLevels())if(candidate.dimension().location().toString().equals(dimension))level=candidate;
            if(level==null||level!=server.overworld())throw new IllegalArgumentException("arrival_overworld_required");
            JsonObject at=root.getAsJsonObject("landing");double x=number(at,"x"),y=number(at,"y"),z=number(at,"z");float yaw=(float)number(at,"yaw");BlockPos anchor=BlockPos.containing(x,y,z);
            if(!level.getWorldBorder().isWithinBounds(anchor)||y<=level.getMinBuildHeight()||y+2>=level.getMaxBuildHeight())throw new IllegalArgumentException("arrival_outside_world");
            JsonObject b=root.getAsJsonObject("legacyBounds");ArrivalPolicy.Bounds bounds=new ArrivalPolicy.Bounds(integer(b,"x1"),integer(b,"y1"),integer(b,"z1"),integer(b,"x2"),integer(b,"y2"),integer(b,"z2"));
            Set<UUID> migrate=new HashSet<>();JsonArray ids=root.getAsJsonArray("migrateUuids");if(ids.size()>256)throw new IllegalArgumentException("arrival_migration_budget");for(JsonElement id:ids)migrate.add(UUID.fromString(id.getAsString()));
            String message=root.get("message").getAsString();if(message.length()>256)throw new IllegalArgumentException("arrival_message_budget");
            int radius=integer(root,"spawnRadius");if(radius<0||radius>4)throw new IllegalArgumentException("arrival_radius");
            String legacyDimension=root.get("legacyDimension").getAsString();if(!legacyDimension.equals("minecraft:overworld"))throw new IllegalArgumentException("arrival_legacy_overworld_required");
            // One explicit operator-selected chunk, after the complete config is parsed.
            level.getChunk(anchor);if(!safe(level,x,y,z))throw new IllegalArgumentException("arrival_not_walkable");
            Path audit=server.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT).resolve("data/maw-arrivals.jsonl");
            JsonObject record=new JsonObject();record.addProperty("kind","configure");record.addProperty("oldSpawn",level.getSharedSpawnPos().toShortString());record.addProperty("oldSpawnRadius",level.getGameRules().getInt(GameRules.RULE_SPAWN_RADIUS));record.addProperty("newSpawn",anchor.toShortString());record.addProperty("spawnRadius",radius);append(audit,record);
            level.setDefaultSpawnPos(anchor,yaw);level.getGameRules().getRule(GameRules.RULE_SPAWN_RADIUS).set(radius,server);
            config=new Config(level,anchor,x,y,z,yaw,bounds,legacyDimension,Set.copyOf(migrate),message,audit);
            LoggerFactory.getLogger("maw-arrival").info("Verified arrival configured at {} in {}; {} legacy bodies eligible",anchor,dimension,migrate.size());
        }catch(Exception failure){LoggerFactory.getLogger("maw-arrival").error("Arrival configuration rejected; no player moved",failure);}
    }
    private static double number(JsonObject o,String key){double value=o.get(key).getAsDouble();if(!Double.isFinite(value))throw new IllegalArgumentException("arrival_coordinate");return value;}
    private static int integer(JsonObject o,String key){double value=number(o,key);if(value!=Math.rint(value)||value<Integer.MIN_VALUE||value>Integer.MAX_VALUE)throw new IllegalArgumentException("arrival_integer");return (int)value;}
    private static boolean safe(ServerLevel level,double x,double y,double z){
        BlockPos feet=BlockPos.containing(x,y,z),floor=feet.below();var ground=level.getBlockState(floor);var shape=ground.getCollisionShape(level,floor);
        return ground.getFluidState().isEmpty()&&!shape.isEmpty()&&shape.max(net.minecraft.core.Direction.Axis.Y)>=0.5&&level.noCollision(new AABB(x-.3,y,z-.3,x+.3,y+1.8,z+.3))&&level.getBlockState(feet).getFluidState().isEmpty()&&level.getBlockState(feet.above()).getFluidState().isEmpty();
    }
    @SubscribeEvent public static void tick(TickEvent.ServerTickEvent event){
        Config c=config;MinecraftServer server=ServerLifecycleHooks.getCurrentServer();if(c==null||server==null||event.phase!=TickEvent.Phase.END||server.getTickCount()%20!=0)return;
        int handled=0;for(ServerPlayer p:server.getPlayerList().getPlayers()){
            if(!SaoAuthentication.loggedIn(p)||!p.isAlive())continue;
            var data=p.getPersistentData();ArrivalPolicy.Decision decision=ArrivalPolicy.decide(true,true,c.migrate.contains(p.getUUID()),data.getBoolean(HANDLED),p.level().dimension().location().toString(),c.legacyDimension,c.legacy,p.getX(),p.getY(),p.getZ());
            if(decision==ArrivalPolicy.Decision.MOVE){
                if(handled>=2||!safe(c.level,c.x,c.y,c.z))continue;
                boolean moved=false;
                try{JsonObject record=new JsonObject();record.addProperty("kind","migration_intent");record.addProperty("bodyUuid",p.getUUID().toString());record.addProperty("bodyName",p.getGameProfile().getName());record.addProperty("from",p.position().toString());record.addProperty("to",new Vec3(c.x,c.y,c.z).toString());append(c.audit,record);
                    p.teleportTo(c.level,c.x,c.y,c.z,c.yaw,0);moved=p.level()==c.level&&p.position().distanceToSqr(new Vec3(c.x,c.y,c.z))<.01;
                    if(moved){p.setDeltaMovement(Vec3.ZERO);p.fallDistance=0;data.putBoolean(HANDLED,true);handled++;}
                    record.addProperty("kind","migration_result");record.addProperty("moved",moved);record.addProperty("actual",p.position().toString());append(c.audit,record);
                }catch(Exception failure){LoggerFactory.getLogger("maw-arrival").warn("Arrival operation failed for {} moved={}: {}",p.getUUID(),moved,failure.getClass().getSimpleName());continue;}
            }else if(decision==ArrivalPolicy.Decision.KEEP)data.putBoolean(HANDLED,true);
            if(p.level()==c.level&&p.position().distanceToSqr(new Vec3(c.x,c.y,c.z))<100&&!data.getBoolean(WELCOME)){p.sendSystemMessage(Component.literal(c.message));data.putBoolean(WELCOME,true);}
        }
    }
    private static void append(Path file,JsonObject record)throws Exception{record.addProperty("observedAt",System.currentTimeMillis());Files.createDirectories(file.getParent());Files.writeString(file,record+"\n",StandardCharsets.UTF_8,StandardOpenOption.CREATE,StandardOpenOption.APPEND);}
    private SpawnArrival(){}
}
