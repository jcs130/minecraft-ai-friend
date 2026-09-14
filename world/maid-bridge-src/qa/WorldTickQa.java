package dev.qiandeng.maidqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.CompanionChunkLoader;
import com.dwinovo.numen.entity.NumenPlayer;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import dev.qiandeng.maid.CompanionTick;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.core.BlockPos;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.CropBlock;
import net.minecraft.world.level.block.FarmBlock;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** A fresh remote plot. Only vanilla world ticks may grow its initial age-zero crops. */
@Mod("qiandeng_world_tick_qa")
public final class WorldTickQa {
    private static final UUID OWNER = UUID.fromString("ec782851-295d-4d60-8847-8b5084de4241");
    private static final UUID HUMAN = UUID.fromString("40faf2cc-c96b-49e0-a951-8e55e4a7f159");
    private static final UUID MAID = UUID.fromString("43e4eb68-80b2-4a3e-b9ad-04851ea92a38");
    // Deliberately in the north neighbor of the body's original chunk (64,64).
    private static final BlockPos PLOT = new BlockPos(1024,-60,1008);
    public WorldTickQa() { NeoForge.EVENT_BUS.addListener(this::register); }
    private void register(RegisterCommandsEvent event) {
        if (!"isolated-maid-bridge".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_environment_required");
        event.getDispatcher().register(Commands.literal("qdworldtickqa").requires(s -> s.getEntity()==null && s.hasPermission(4))
            .then(Commands.argument("action",StringArgumentType.word()).executes(c -> {
                var server=c.getSource().getServer(); var level=server.overworld();
                String action=StringArgumentType.getString(c,"action");
                NumenPlayer owner=(NumenPlayer)server.getPlayerList().getPlayer(OWNER);
                EntityMaid maid=level.getEntity(MAID) instanceof EntityMaid m ? m:null;
                JsonObject out=new JsonObject();
                try {
                    if (action.equals("setup")) {
                        if (Files.exists(Path.of("world-tick-qa-created"))) throw new IllegalStateException("already_created");
                        owner=CompanionFactory.spawn(server,OWNER,"CompanionQA",HUMAN,level,new Vec3(1024.5,-60,1024.5));
                        CompanionRegistry.get(server).put(OWNER,new CompanionRegistry.Entry("CompanionQA",HUMAN,level.dimension(),new BlockPos(1024,-60,1024)));
                        owner.getInventory().setItem(40,new ItemStack(Items.CAKE,2));
                        maid=new EntityMaid(level); maid.setUUID(MAID); maid.setPos(1026,-60,1024.5);
                        maid.setPersistenceRequired(); maid.setInvulnerable(true); maid.setNoAi(true); level.addFreshEntity(maid);
                        Files.writeString(Path.of("world-tick-qa-created"),MAID.toString());
                    } else if (action.equals("seed")) {
                        // Fixture setup/reset only; every subsequent age/moisture transition must be natural.
                        for(int x=1026;x<=1033;x++) for(int z=1010;z<=1017;z++) {
                            boolean water=x==1030 && z==1014;
                            level.setBlock(new BlockPos(x,-61,z),water?Blocks.WATER.defaultBlockState():Blocks.FARMLAND.defaultBlockState().setValue(FarmBlock.MOISTURE,0),3);
                            level.setBlock(new BlockPos(x,-60,z),water?Blocks.AIR.defaultBlockState():Blocks.WHEAT.defaultBlockState().setValue(CropBlock.AGE,0),3);
                        }
                    } else if (action.equals("owner_online")) {
                        CompanionFactory.spawn(server,HUMAN,"OwnerQA",UUID.fromString("81e60910-96b8-4669-8d0f-5f9b25298d31"),level,new Vec3(1024.5,-60,1025.5));
                    } else if (action.equals("maid_only")) {
                        if(!maid.isTame() || !OWNER.equals(maid.getOwnerUUID())) throw new IllegalStateException("native_adoption_required");
                        CompanionChunkLoader.enabled=false;
                        maid.setNoAi(false); maid.setInSittingPose(false);
                    } else if (action.equals("maid_home")) {
                        if(!maid.isTame()) throw new IllegalStateException("native_adoption_required");
                        maid.getSchedulePos().setHomeModeEnable(maid,maid.blockPosition());
                        maid.setHomeModeEnable(true);
                    } else if (action.equals("disable")) {
                        CompanionChunkLoader.enabled=false;
                        if(maid!=null) maid.setInSittingPose(true);
                    } else if (action.equals("shift")) {
                        owner.moveTo(1048.5,-60,1024.5,owner.getYRot(),owner.getXRot());
                    } else if (action.equals("restore")) {
                        owner.moveTo(1024.5,-60,1024.5,owner.getYRot(),owner.getXRot());
                    } else if (action.equals("maid_shift") || action.equals("maid_restore")) {
                        maid.moveTo(action.equals("maid_shift")?1048.5:1026,-60,1024.5,maid.getYRot(),maid.getXRot());
                        maid.getSchedulePos().setHomeModeEnable(maid,maid.blockPosition());
                        maid.setHomeModeEnable(true);
                    } else if (!action.equals("status")) throw new IllegalStateException("unknown_action");
                    out.addProperty("ok",true);
                } catch(Exception e) {out.addProperty("ok",false);out.addProperty("failure",e.toString());}
                out.addProperty("serverTick",server.getTickCount());
                out.addProperty("maidUuid",MAID.toString());out.addProperty("ownerUuid",OWNER.toString());
                out.addProperty("ownerOnline",owner!=null);
                out.addProperty("humanOnline",server.getPlayerList().getPlayer(HUMAN)!=null);
                if(owner!=null) {out.addProperty("ownerChunkX",owner.chunkPosition().x);out.addProperty("ownerChunkZ",owner.chunkPosition().z);}
                if(maid!=null) {out.add("maidTick",CompanionTick.status(maid));out.addProperty("maidHome",maid.isHomeModeEnable());}
                var distance = level.getChunkSource().chunkMap.getDistanceManager();
                out.addProperty("oldEdgeForced",distance.shouldForceTicks(ChunkPos.asLong(63,64)));
                out.addProperty("intersectionForced",distance.shouldForceTicks(ChunkPos.asLong(64,64)));
                out.addProperty("newEdgeForced",distance.shouldForceTicks(ChunkPos.asLong(66,64)));
                int visitedForced=0;
                for(int x=63;x<=66;x++) for(int z=63;z<=65;z++)
                    if(distance.shouldForceTicks(ChunkPos.asLong(x,z))) visitedForced++;
                out.addProperty("visitedAreaForcedCount",visitedForced);
                if(owner!=null) {
                    int forceCount=0,entityCount=0;
                    for(int dx=-1;dx<=1;dx++) for(int dz=-1;dz<=1;dz++) {
                        var target=new ChunkPos(owner.chunkPosition().x+dx,owner.chunkPosition().z+dz);
                        if(distance.shouldForceTicks(target.toLong()))forceCount++;
                        if(level.isPositionEntityTicking(target.getMiddleBlockPosition(-60)))entityCount++;
                    }
                    out.addProperty("ownerForcedCount",forceCount);out.addProperty("ownerEntityCount",entityCount);
                }
                var pos=new ChunkPos(PLOT);
                out.addProperty("plotChunkX",pos.x);out.addProperty("plotChunkZ",pos.z);
                out.addProperty("plotForceTicks",level.getChunkSource().chunkMap.getDistanceManager().shouldForceTicks(pos.toLong()));
                out.addProperty("plotPlayerNearby",level.getChunkSource().chunkMap.getDistanceManager().hasPlayersNearby(pos.toLong()));
                out.addProperty("plotEntityTicking",level.isPositionEntityTicking(PLOT));
                // Never synchronously load a missing chunk for a status check.
                boolean loaded=level.getChunkSource().getChunkNow(pos.x,pos.z)!=null;
                out.addProperty("plotLoaded",loaded);
                if(loaded) {
                    int plants=0,grown=0,hydrated=0;
                    for(int x=1026;x<=1033;x++) for(int z=1010;z<=1017;z++) {
                        var crop=level.getBlockState(new BlockPos(x,-60,z));
                        var soil=level.getBlockState(new BlockPos(x,-61,z));
                        if(crop.is(Blocks.WHEAT)){plants++;if(crop.getValue(CropBlock.AGE)>0)grown++;}
                        if(soil.is(Blocks.FARMLAND)&&soil.getValue(FarmBlock.MOISTURE)>0)hydrated++;
                    }
                    out.addProperty("plants",plants);out.addProperty("grown",grown);out.addProperty("hydrated",hydrated);
                }
                String text="QD_WORLD_TICK_QA "+out;
                c.getSource().sendSuccess(()->Component.literal(text),false);
                return out.get("ok").getAsBoolean()?1:0;
            })));
    }
}
