package dev.qiandeng.maw;

import com.google.gson.*;
import com.simibubi.create.content.kinetics.base.KineticBlockEntity;
import com.simibubi.create.content.kinetics.base.IRotate;
import net.minecraft.core.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.status.ChunkStatus;
import net.minecraft.world.level.chunk.LevelChunk;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.nbt.CompoundTag;
import vectorwing.farmersdelight.common.block.entity.AbstractStoveBlockEntity;
import vectorwing.farmersdelight.common.block.entity.CuttingBoardBlockEntity;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Opt-in display state, scoped to this authenticated connection's loaded local
 * scene. No commands, controls, generated chunks, model inference or inventory
 * mutation. Rendering data is not a visibility-gated Agent perception API. */
final class PlayerSceneBridge {
    static final Set<String> BLOCKS=Set.of("farmersdelight:stove","farmersdelight:cutting_board",
        "create:cogwheel","create:large_cogwheel","create:shaft","create:millstone","create:windmill_bearing",
        "create:white_sail","create:sail_frame");
    private static final Set<UUID> SUBSCRIBED=new HashSet<>();
    private static final int MAX=65536;
    private record Subscribe(byte enabled) implements CustomPacketPayload {
        static final Type<Subscribe> TYPE=new Type<>(ResourceLocation.parse("maw_agent:scene_subscribe"));
        static final StreamCodec<RegistryFriendlyByteBuf,Subscribe> CODEC=StreamCodec.of((b,p)->b.writeByte(p.enabled),b->{
            if(b.readableBytes()!=1)throw new IllegalArgumentException("scene_subscription_size");return new Subscribe(b.readByte());});
        public Type<Subscribe> type(){return TYPE;}
    }
    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE=new Type<>(ResourceLocation.parse("maw_agent:scene_state"));
        static final StreamCodec<RegistryFriendlyByteBuf,State> CODEC=StreamCodec.of((b,p)->{
            byte[] raw=p.json.getBytes(StandardCharsets.UTF_8);if(raw.length>MAX)throw new IllegalArgumentException("scene_budget");b.writeBytes(raw);
        },b->{if(b.readableBytes()>MAX)throw new IllegalArgumentException("scene_budget");byte[] raw=new byte[b.readableBytes()];b.readBytes(raw);return new State(new String(raw,StandardCharsets.UTF_8));});
        public Type<State> type(){return TYPE;}
    }
    static void register(IEventBus bus){
        PlayerActorVisuals.register();
        bus.addListener(PlayerSceneBridge::payloads);
        NeoForge.EVENT_BUS.addListener(PlayerSceneBridge::tick);
        NeoForge.EVENT_BUS.addListener(PlayerSceneBridge::logout);
        NeoForge.EVENT_BUS.addListener(PlayerSceneBridge::commands);
    }
    private static void payloads(RegisterPayloadHandlersEvent event){
        var r=event.registrar("1").optional();r.playToClient(State.TYPE,State.CODEC,(p,c)->{});
        r.playToServer(Subscribe.TYPE,Subscribe.CODEC,(p,c)->c.enqueueWork(()->{
            if(!(c.player() instanceof ServerPlayer player)||!PlayerAuthBridge.authenticated(player))return;
            if(p.enabled==1&&player.connection.hasChannel(State.TYPE))SUBSCRIBED.add(player.getUUID());
            else SUBSCRIBED.remove(player.getUUID());
        }));
    }
    private static void logout(PlayerEvent.PlayerLoggedOutEvent event){SUBSCRIBED.remove(event.getEntity().getUUID());}
    private static void tick(ServerTickEvent.Post event){
        if(event.getServer().getTickCount()%5!=0)return;
        for(var player:event.getServer().getPlayerList().getPlayers())if(SUBSCRIBED.contains(player.getUUID())&&PlayerAuthBridge.authenticated(player)&&player.connection.hasChannel(State.TYPE)){
            var scene=snapshot(player);String json=scene.toString();
            // Existing contraption payloads retain priority under the packet
            // budget. Trim farthest display actors rather than dropping a frame.
            var actors=scene.getAsJsonArray("actors");
            while(json.getBytes(StandardCharsets.UTF_8).length>MAX&&!actors.isEmpty()){
                actors.remove(actors.size()-1);scene.addProperty("actorsTruncated",true);json=scene.toString();
            }
            if(json.getBytes(StandardCharsets.UTF_8).length<=MAX)PacketDistributor.sendToPlayer(player,new State(json));
        }
    }
    static JsonObject properties(BlockState state){JsonObject out=new JsonObject();state.getValues().forEach((k,v)->out.addProperty(k.getName(),NativeCollisionFacts.propertyValue(k,v)));return out;}
    static JsonArray shape(BlockState state,net.minecraft.world.level.BlockGetter level,BlockPos pos){
        JsonArray out=new JsonArray();for(var box:state.getCollisionShape(level,pos).toAabbs()){
            JsonArray b=new JsonArray();for(double v:new double[]{box.minX,box.minY,box.minZ,box.maxX,box.maxY,box.maxZ})b.add(v);out.add(b);
        }return out;
    }
    static JsonObject snapshot(ServerPlayer player){
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("playerUuid",player.getUUID().toString());
        out.addProperty("dimension",player.level().dimension().location().toString());out.addProperty("serverTick",player.level().getGameTime());
        out.addProperty("sampledAt",java.time.Instant.now().toString());out.addProperty("radius",16);
        JsonArray blocks=new JsonArray();var level=player.serverLevel();var center=player.chunkPosition();
        List<BlockPos> candidates=new ArrayList<>();
        if(!player.isDeadOrDying())for(int x=center.x-1;x<=center.x+1;x++)for(int z=center.z-1;z<=center.z+1;z++){
            var chunk=level.getChunkSource().getChunk(x,z,ChunkStatus.FULL,false);
            if(chunk instanceof LevelChunk full)for(var be:full.getBlockEntities().values()){
                if(be.getBlockPos().distToCenterSqr(player.position())>256)continue;
                if(BLOCKS.contains(BuiltInRegistries.BLOCK.getKey(be.getBlockState().getBlock()).toString()))candidates.add(be.getBlockPos());
            }
        }
        // Unassembled sails have no block entity. A small loaded-only cube
        // keeps a building player's sails visible before assembly as well.
        if(!player.isDeadOrDying()){
            Block white=BuiltInRegistries.BLOCK.get(ResourceLocation.parse("create:white_sail")),frame=BuiltInRegistries.BLOCK.get(ResourceLocation.parse("create:sail_frame"));
            BlockPos origin=player.blockPosition();
            for(BlockPos pos:BlockPos.betweenClosed(origin.offset(-6,-6,-6),origin.offset(6,6,6))){
                if(!level.getChunkSource().hasChunk(pos.getX()>>4,pos.getZ()>>4))continue;
                Block b=level.getBlockState(pos).getBlock();if(b==white||b==frame)candidates.add(pos.immutable());
            }
        }
        candidates.sort(Comparator.comparingDouble(pos->pos.distToCenterSqr(player.position())));
        for(var pos:candidates.stream().limit(24).toList()){
            var state=level.getBlockState(pos);var be=level.getBlockEntity(pos);JsonObject row=new JsonObject();
            row.addProperty("x",pos.getX());row.addProperty("y",pos.getY());row.addProperty("z",pos.getZ());
            row.addProperty("id",BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());row.addProperty("stateId",Block.getId(state));row.add("properties",properties(state));
            if(be instanceof KineticBlockEntity kinetic&&state.getBlock() instanceof IRotate rotating){
                var axis=rotating.getRotationAxis(state);float speed=kinetic.getSpeed();
                JsonObject motion=new JsonObject();motion.addProperty("axis",axis.getName());motion.addProperty("rpm",speed);
                // Same locked Create 6.0.10 phase rule (client render time becomes
                // authoritative server game time here); see source audit.
                String id=BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
                int parity=axis==Direction.Axis.X?pos.getY()+pos.getZ():axis==Direction.Axis.Y?pos.getX()+pos.getZ():pos.getX()+pos.getY();
                float offset=(parity&1)==0?22.5f:id.equals("create:large_cogwheel")?11.25f:0f;
                offset+=kinetic.getRotationAngleOffset(axis);
                motion.addProperty("angleDegrees",((level.getGameTime()*speed*.3+offset)%360+360)%360);
                motion.addProperty("overstressed",kinetic.isOverStressed());row.add("kinetic",motion);
            }
            JsonArray food=new JsonArray();
            if(be instanceof AbstractStoveBlockEntity stove){
                CompoundTag tag=new CompoundTag();stove.saveAdditional(tag,player.registryAccess());
                int[] times=tag.getIntArray("CookingTimes"),totals=tag.getIntArray("CookingTotalTimes");
                for(int i=0;i<Math.min(6,stove.getItems().getSlots());i++){
                    var item=stove.getItems().getStackInSlot(i);if(item.isEmpty())continue;JsonObject f=new JsonObject();
                    f.addProperty("slot",i);f.addProperty("id",BuiltInRegistries.ITEM.getKey(item.getItem()).toString());f.addProperty("count",item.getCount());
                    if(i<times.length)f.addProperty("cookingTime",times[i]);if(i<totals.length)f.addProperty("cookingTotalTime",totals[i]);food.add(f);
                }
            }else if(be instanceof CuttingBoardBlockEntity board&&!board.getStoredItem().isEmpty()){
                JsonObject f=new JsonObject();f.addProperty("slot",0);f.addProperty("id",BuiltInRegistries.ITEM.getKey(board.getStoredItem().getItem()).toString());f.addProperty("count",board.getStoredItem().getCount());food.add(f);
            }
            row.add("foods",food);blocks.add(row);
        }
        out.add("blocks",blocks);out.addProperty("truncated",candidates.size()>24);
        out.add("contraptions",player.isDeadOrDying()?new JsonArray():PlayerWorldBridge.contraptionRenderStates(player));
        out.add("actors",PlayerActorVisuals.snapshot(player));out.addProperty("actorVisualVersion",1);
        return out;
    }
    private static void commands(RegisterCommandsEvent event){
        event.getDispatcher().register(Commands.literal("maw_scene").requires(s->s.hasPermission(4))
            .then(Commands.literal("bubble").then(Commands.argument("maid",net.minecraft.commands.arguments.UuidArgument.uuid())
                .then(Commands.argument("text",com.mojang.brigadier.arguments.StringArgumentType.greedyString()).executes(c->{
                    var uuid=net.minecraft.commands.arguments.UuidArgument.getUuid(c,"maid");
                    var entity=c.getSource().getLevel().getEntity(uuid);
                    if(!(entity instanceof com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid))return 0;
                    String text=PlayerActorVisuals.clean(com.mojang.brigadier.arguments.StringArgumentType.getString(c,"text"),160);
                    if(text.isBlank())return 0;maid.getChatBubbleManager().addTextChatBubble(text);
                    c.getSource().sendSuccess(()->Component.literal("MAW_SCENE bubble_added "+uuid),false);return 1;
                })))));
        event.getDispatcher().register(Commands.literal("maw_scene").requires(s->s.hasPermission(4)).then(Commands.literal("export_shapes").executes(c->{
            JsonArray rows=new JsonArray();var level=c.getSource().getServer().overworld();BlockPos pos=level.getSharedSpawnPos();
            for(String name:BLOCKS.stream().sorted().toList())for(var state:BuiltInRegistries.BLOCK.get(ResourceLocation.parse(name)).getStateDefinition().getPossibleStates()){
                JsonObject row=new JsonObject();row.addProperty("stateId",Block.getId(state));row.addProperty("name",name);row.add("properties",properties(state));row.add("collisionBoxes",shape(state,level,pos));rows.add(row);
            }
            JsonObject file=new JsonObject();file.addProperty("schemaVersion",1);file.addProperty("source","installed_native_block_collision_shapes");file.add("states",rows);
            try{Files.writeString(Path.of("maw-scene-shapes.json"),file.toString(),StandardCharsets.UTF_8);}catch(java.io.IOException e){throw new IllegalStateException("scene_export_failed",e);}
            c.getSource().sendSuccess(()->Component.literal("MAW_SCENE shapes="+rows.size()),false);return rows.size();
        })));
    }
}
