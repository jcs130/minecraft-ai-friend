package dev.qiandeng.maw.saoforge;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundCustomPayloadPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.BushBlock;
import net.minecraft.world.level.block.LeavesBlock;
import net.minecraft.world.level.block.piston.PistonStructureResolver;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.level.BlockEvent;
import net.minecraftforge.event.level.ExplosionEvent;
import net.minecraftforge.event.level.PistonEvent;
import net.minecraftforge.eventbus.api.EventPriority;
import net.minecraftforge.network.NetworkDirection;
import net.minecraftforge.network.NetworkEvent;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.server.ServerLifecycleHooks;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Server-enforced building protection, independent of controller prompts and OP-free bodies. */
public final class StructureProtection {
    private record Region(String id,String dimension,int x1,int y1,int z1,int x2,int y2,int z2) {
        boolean contains(BlockPos p){return p.getX()>=x1&&p.getX()<=x2&&p.getY()>=y1&&p.getY()<=y2&&p.getZ()>=z1&&p.getZ()<=z2;}
    }
    private record Verdict(String status,String reason,String region) {}
    private static volatile List<Region> regions=List.of();
    private static volatile boolean ready=false;
    private static boolean generated=true;
    private static final Map<UUID,long[]> rates=new HashMap<>();
    private static final ResourceLocation REPLY=new ResourceLocation("mcagent:protection");

    public static void install() {
        var bus=MinecraftForge.EVENT_BUS;
        bus.addListener((net.minecraftforge.event.server.ServerStartedEvent e)->reload(e.getServer()));
        bus.addListener((net.minecraftforge.event.server.ServerStoppingEvent e)->{ready=false;rates.clear();});
        bus.addListener((net.minecraftforge.event.entity.player.PlayerEvent.PlayerLoggedOutEvent e)->rates.remove(e.getEntity().getUUID()));
        bus.addListener(EventPriority.HIGHEST,(BlockEvent.BreakEvent e)->{
            if(e.getLevel() instanceof ServerLevel level&&e.getPlayer() instanceof ServerPlayer p&&!p.hasPermissions(4)) {
                Verdict v=check(level,e.getPos(),"break");if(!v.status.equals("allow_likely")){e.setCanceled(true);send(p,reply(level,e.getPos(),"break",v,null));}
            }
        });
        bus.addListener(EventPriority.HIGHEST,(BlockEvent.EntityPlaceEvent e)->{
            if(!(e.getLevel() instanceof ServerLevel level)||e.getEntity() instanceof ServerPlayer p&&p.hasPermissions(4))return;
            List<BlockPos> cells=e instanceof BlockEvent.EntityMultiPlaceEvent multi?multi.getReplacedBlockSnapshots().stream().map(s->s.getPos()).toList():List.of(e.getPos());
            for(BlockPos pos:cells){Verdict v=check(level,pos,"place");if(!v.status.equals("allow_likely")){e.setCanceled(true);if(e.getEntity() instanceof ServerPlayer p)send(p,reply(level,pos,"place",v,null));break;}}
        });
        bus.addListener(EventPriority.HIGHEST,(BlockEvent.BlockToolModificationEvent e)->{
            if(e.getLevel() instanceof ServerLevel level&&!(e.getPlayer()!=null&&e.getPlayer().hasPermissions(4))) {
                Verdict v=check(level,e.getPos(),"break");if(!v.status.equals("allow_likely"))e.setCanceled(true);
            }
        });
        bus.addListener(EventPriority.HIGHEST,(BlockEvent.FluidPlaceBlockEvent e)->{
            if(e.getLevel() instanceof ServerLevel level&&!check(level,e.getPos(),"place").status.equals("allow_likely"))e.setCanceled(true);
        });
        bus.addListener(EventPriority.HIGHEST,(ExplosionEvent.Detonate e)->{
            if(e.getLevel() instanceof ServerLevel level)e.getAffectedBlocks().removeIf(pos->!check(level,pos,"break").status.equals("allow_likely"));
        });
        bus.addListener(EventPriority.HIGHEST,(PistonEvent.Pre e)->{
            if(!(e.getLevel() instanceof ServerLevel level))return;
            var resolver=new PistonStructureResolver(level,e.getPos(),e.getDirection(),e.getPistonMoveType()==PistonEvent.PistonMoveType.EXTEND);
            resolver.resolve();
            for(var pos:resolver.getToPush())if(!check(level,pos,"break").status.equals("allow_likely")||!check(level,pos.relative(resolver.getPushDirection()),"place").status.equals("allow_likely")){e.setCanceled(true);return;}
            for(var pos:resolver.getToDestroy())if(!check(level,pos,"break").status.equals("allow_likely")){e.setCanceled(true);return;}
        });
        bus.addListener((net.minecraftforge.event.RegisterCommandsEvent e)->{
            var c=net.minecraft.commands.Commands.literal("mawprotect");
            c.then(net.minecraft.commands.Commands.literal("reload").requires(s->s.getEntity()==null&&s.hasPermission(4)).executes(ctx->{reload(ctx.getSource().getServer());ctx.getSource().sendSuccess(()->Component.literal("Protection loaded: "+regions.size()+" regions; generated structure pieces="+generated),false);return 1;}));
            c.then(net.minecraft.commands.Commands.literal("check").then(net.minecraft.commands.Commands.argument("action",com.mojang.brigadier.arguments.StringArgumentType.word()).then(net.minecraft.commands.Commands.argument("position",net.minecraft.commands.arguments.coordinates.BlockPosArgument.blockPos()).executes(ctx->{
                String action=com.mojang.brigadier.arguments.StringArgumentType.getString(ctx,"action");if(!Set.of("break","place").contains(action))return 0;
                var pos=net.minecraft.commands.arguments.coordinates.BlockPosArgument.getBlockPos(ctx,"position");var level=ctx.getSource().getLevel();
                var out=reply(level,pos,action,check(level,pos,action),null);
                if(ctx.getSource().getEntity() instanceof ServerPlayer player)send(player,out);else ctx.getSource().sendSuccess(()->Component.literal(out.toString()),false);return 1;
            }))));e.getDispatcher().register(c);
        });
        var channel=NetworkRegistry.newEventChannel(new ResourceLocation("mcagent:protection_query"),()->"1",v->true,v->true);
        channel.addListener((NetworkEvent.ClientCustomPayloadEvent event)->{
            var context=event.getSource().get();var p=context.getSender();
            if(p==null||context.getDirection()!=NetworkDirection.PLAY_TO_SERVER||event.getPayload().readableBytes()>1024)return;
            byte[] bytes=new byte[event.getPayload().readableBytes()];event.getPayload().readBytes(bytes);
            context.enqueueWork(()->{try{
                long second=System.currentTimeMillis()/1000;long[] rate=rates.computeIfAbsent(p.getUUID(),id->new long[]{second,0});if(rate[0]!=second){rate[0]=second;rate[1]=0;}if(++rate[1]>20)return;
                var q=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();String action=q.get("action").getAsString();
                if(!Set.of("break","place").contains(action))return;
                int x=coordinate(q,"x"),y=coordinate(q,"y"),z=coordinate(q,"z");var pos=new BlockPos(x,y,z);
                String request=q.has("requestId")?q.get("requestId").getAsString():null;if(request!=null&&!request.matches("[a-zA-Z0-9._:-]{1,96}"))return;
                var level=p.serverLevel();var v=pos.distSqr(p.blockPosition())>64*64?new Verdict("unknown","outside_query_range",null):check(level,pos,action);
                if(q.has("dimension")&&!q.get("dimension").getAsString().replace("minecraft:","").equals(level.dimension().location().toString().replace("minecraft:","")))v=new Verdict("unknown","dimension_mismatch",null);
                send(p,reply(level,pos,action,v,request));
            }catch(RuntimeException malformed){/* No action is ever inferred from invalid queries. */}});context.setPacketHandled(true);
        });
    }
    private static int coordinate(JsonObject q,String key){double n=q.get(key).getAsDouble();if(!Double.isFinite(n)||n!=Math.rint(n)||Math.abs(n)>30000000)throw new IllegalArgumentException("integer_coordinate_required");return(int)n;}
    static void reload(net.minecraft.server.MinecraftServer server) {
        ready=false;
        try {
            Path file=server.getServerDirectory().toPath().resolve("config/maw-structure-protection.json");
            if(!Files.isRegularFile(file))throw new IllegalStateException("explicit_protection_configuration_required");
            var root=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            if(root.get("schemaVersion").getAsInt()!=1||root.getAsJsonArray("regions").size()>256)throw new IllegalArgumentException("invalid_protection_schema");
            List<Region> next=new ArrayList<>();Set<String> ids=new HashSet<>();
            for(var item:root.getAsJsonArray("regions")){
                var r=item.getAsJsonObject();String id=r.get("id").getAsString(),dim=new ResourceLocation(r.get("dimension").getAsString()).toString();
                int x1=coordinate(r,"x1"),y1=coordinate(r,"y1"),z1=coordinate(r,"z1"),x2=coordinate(r,"x2"),y2=coordinate(r,"y2"),z2=coordinate(r,"z2");
                if(!id.matches("[a-z0-9._:-]{1,80}")||!ids.add(id)||x1>x2||y1>y2||z1>z2)throw new IllegalArgumentException("invalid_region");
                next.add(new Region(id,dim,x1,y1,z1,x2,y2,z2));
            }
            generated=root.get("generatedStructurePieces").getAsBoolean();regions=List.copyOf(next);ready=true;
        }catch(Exception failure){throw new IllegalStateException("Protection unavailable; changes stay blocked",failure);}
    }
    private static Verdict check(ServerLevel level,BlockPos pos,String action) {
        if(!ready)return new Verdict("unknown","protection_not_ready",null);
        var chunk=level.getChunkSource().getChunkNow(pos.getX()>>4,pos.getZ()>>4);
        if(chunk==null)return new Verdict("unknown","chunk_unloaded",null);
        String dim=level.dimension().location().toString();
        var block=level.getBlockState(pos).getBlock();
        boolean vegetation=block instanceof BushBlock||block instanceof LeavesBlock;
        for(var region:regions)if(region.dimension.equals(dim)&&region.contains(pos))return new Verdict(action.equals("break")&&vegetation?"allow_likely":"deny",action.equals("break")&&vegetation?"vegetation_allowed":"protected_building",region.id);
        if(generated) {
            boolean missing=false;int tested=0;
            for(var entry:chunk.getAllReferences().entrySet())for(long packed:entry.getValue()){
                int cx=(int)packed,cz=(int)(packed>>32);var startChunk=level.getChunkSource().getChunkNow(cx,cz);
                if(startChunk==null){missing=true;continue;}var start=startChunk.getStartForStructure(entry.getKey());
                if(start==null||!start.isValid()){missing=true;continue;}
                for(var piece:start.getPieces()){
                    if(++tested>20000)return new Verdict("unknown","structure_check_budget",null);
                    if(piece.getBoundingBox().isInside(pos)){
                        var name=level.registryAccess().registryOrThrow(Registries.STRUCTURE).getKey(entry.getKey());
                        return new Verdict(action.equals("break")&&vegetation?"allow_likely":"deny",action.equals("break")&&vegetation?"vegetation_allowed":"protected_structure_piece",String.valueOf(name));
                    }
                }
            }
            if(missing)return new Verdict("unknown","structure_metadata_unloaded",null);
        }
        return new Verdict("allow_likely","outside_protected_building",null);
    }
    private static JsonObject reply(ServerLevel level,BlockPos pos,String action,Verdict v,String request) {
        var out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("action",action);out.addProperty("dimension",level.dimension().location().toString());out.addProperty("x",pos.getX());out.addProperty("y",pos.getY());out.addProperty("z",pos.getZ());out.addProperty("status",v.status);out.addProperty("reason",v.reason);if(v.region!=null)out.addProperty("region",v.region);if(request!=null)out.addProperty("requestId",request);out.addProperty("coordinateSystem","absolute_world_blocks");out.addProperty("observedAt",java.time.Instant.now().toString());return out;
    }
    private static void send(ServerPlayer p,JsonObject out){if(p.connection!=null)p.connection.send(new ClientboundCustomPayloadPacket(REPLY,new FriendlyByteBuf(io.netty.buffer.Unpooled.wrappedBuffer(out.toString().getBytes(StandardCharsets.UTF_8)))));}
}
