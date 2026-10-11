package dev.qiandeng.maw;

import com.google.gson.*;
import com.mojang.datafixers.util.Pair;
import io.netty.buffer.Unpooled;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.*;
import net.minecraft.server.level.ServerEntity;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.chunk.status.ChunkStatus;
import java.time.Instant;
import java.util.*;
import com.mojang.serialization.JsonOps;

/** Detached, read-only copies of a real body's state. Never adds a camera player,
 * generates a chunk, consumes an inbox, opens a menu, or takes a control lease. */
public final class NativeViewerAccess {
    private NativeViewerAccess() {}
    private static final java.lang.reflect.Field ENTITY_DATA = entityDataField();
    private static java.lang.reflect.Field entityDataField() {
        try { var f=net.minecraft.network.syncher.SynchedEntityData.class.getDeclaredField("itemsById");f.setAccessible(true);return f; }
        catch(ReflectiveOperationException e){throw new IllegalStateException("viewer_entity_data_layout_unsupported",e);}
    }
    private static List<net.minecraft.network.syncher.SynchedEntityData.DataValue<?>> metadata(net.minecraft.world.entity.Entity entity) {
        try {
            var items=(net.minecraft.network.syncher.SynchedEntityData.DataItem<?>[])ENTITY_DATA.get(entity.getEntityData());
            List<net.minecraft.network.syncher.SynchedEntityData.DataValue<?>> values=new ArrayList<>();
            // A detached full snapshot includes values returning to defaults.
            // Never call packDirty(): it would consume another client's updates.
            for(var item:items)if(item!=null)values.add(item.value());
            return values;
        }catch(IllegalAccessException e){throw new IllegalStateException("viewer_entity_data_unavailable",e);}
    }

    public static JsonObject snapshot(ServerPlayer player, JsonObject args) {
        PlayerAuthBridge.requireAuthenticated(player);
        if (player.getServer()==null || !player.getServer().isSameThread()) throw new IllegalStateException("minecraft_thread_required");
        if (player.isDeadOrDying()) throw new IllegalArgumentException("body_dead");
        if (!Set.of("initialize", "columns").containsAll(args.keySet())) throw new IllegalArgumentException("unsupported_viewer_argument");
        JsonObject out=new JsonObject();
        out.addProperty("schemaVersion",1);out.addProperty("ok",true);
        out.addProperty("source","numen_server_body");out.addProperty("playerUuid",player.getUUID().toString());
        out.addProperty("name",player.getGameProfile().getName());out.addProperty("entityId",player.getId());
        out.addProperty("hasCustomTextures",!player.getGameProfile().getProperties().get("textures").isEmpty());
        out.addProperty("sampledAt",Instant.now().toString());out.addProperty("tick",player.getServer().getTickCount());
        var level=player.serverLevel();
        JsonObject dimension=new JsonObject();dimension.addProperty("name",level.dimension().location().toString());
        dimension.addProperty("minY",level.getMinBuildHeight());dimension.addProperty("height",level.getHeight());out.add("dimension",dimension);
        out.addProperty("biomeSeed",Long.toString(net.minecraft.world.level.biome.BiomeManager.obfuscateSeed(level.getSeed())));
        JsonObject pose=new JsonObject();pose.addProperty("x",player.getX());pose.addProperty("y",player.getY());pose.addProperty("z",player.getZ());
        pose.addProperty("yaw",Math.PI-Math.toRadians(player.getYRot()));pose.addProperty("pitch",-Math.toRadians(player.getXRot()));
        pose.addProperty("eyeHeight",player.getEyeHeight());out.add("pose",pose);out.addProperty("onGround",player.onGround());
        out.addProperty("age",level.getGameTime());out.addProperty("day",level.getDayTime());
        out.addProperty("raining",level.isRaining());out.addProperty("rain",level.getRainLevel(1));out.addProperty("thunder",level.getThunderLevel(1));
        var menu=PlayerMenuBridge.snapshot(player);out.add("menu",menu);
        String type=menu.get("menuType").getAsString();
        if(type.equals("curios:curios_container"))out.add("curios",NativeModAccess.invoke(player,"curios.state",new JsonObject(),true,"viewer_"+UUID.randomUUID().toString().replace("-","")));
        if(type.startsWith("domum_ornamentum:"))out.add("domum",NativeModAccess.invoke(player,"domum.state",new JsonObject(),true,"viewer_"+UUID.randomUUID().toString().replace("-","")));
        out.add("spell",NativeModAccess.invoke(player,"spell.list",new JsonObject(),true,"viewer_"+UUID.randomUUID().toString().replace("-","")));
        if (args.has("initialize") && args.get("initialize").getAsBoolean()) {
            out.addProperty("blockStatesCount",Block.BLOCK_STATE_REGISTRY.size());
            var registry=level.registryAccess().registryOrThrow(Registries.BIOME);
            JsonArray biomes=new JsonArray();
            for(var biome:registry) {JsonObject b=new JsonObject();b.addProperty("id",registry.getId(biome));b.addProperty("key",registry.getKey(biome).toString());
                b.add("value",Biome.NETWORK_CODEC.encodeStart(JsonOps.INSTANCE,biome).getOrThrow());biomes.add(b);}
            out.add("biomes",biomes);
        }
        JsonArray packets=new JsonArray();
        var codec=GameProtocols.CLIENTBOUND_TEMPLATE.bind(RegistryFriendlyByteBuf.decorator(player.registryAccess())).codec();
        java.util.function.Consumer<Packet<? super ClientGamePacketListener>> add=packet->{
            var buffer=Unpooled.buffer();
            try {codec.encode(buffer,packet);if(buffer.readableBytes()>1024*1024)throw new IllegalStateException("viewer_packet_too_large");
                byte[] bytes=new byte[buffer.readableBytes()];buffer.readBytes(bytes);packets.add(Base64.getEncoder().encodeToString(bytes));}
            finally {buffer.release();}
        };
        if(args.has("columns")) {
            JsonArray columns=args.getAsJsonArray("columns");if(columns.size()>2)throw new IllegalArgumentException("viewer_column_budget");
            for(var value:columns) {
                JsonArray p=value.getAsJsonArray();if(p.size()!=2)throw new IllegalArgumentException("invalid_viewer_column");
                int x=p.get(0).getAsInt(),z=p.get(1).getAsInt();
                if(p.get(0).getAsDouble()!=x||p.get(1).getAsDouble()!=z||Math.abs((long)x-player.chunkPosition().x)>2||Math.abs((long)z-player.chunkPosition().z)>2)throw new IllegalArgumentException("viewer_column_outside_body");
                var chunk=level.getChunkSource().getChunk(x,z,ChunkStatus.FULL,false);
                if(chunk instanceof net.minecraft.world.level.chunk.LevelChunk full) add.accept(new ClientboundLevelChunkWithLightPacket(full,level.getLightEngine(),null,null));
            }
        }
        var nearby=level.getEntities(player,player.getBoundingBox().inflate(48),e->e.isAlive()&&!e.isSpectator()).stream()
            .sorted(Comparator.comparingDouble(e->e.distanceToSqr(player))).limit(96).toList();
        JsonArray entityIds=new JsonArray();
        for(var entity:nearby) {
            entityIds.add(entity.getId());
            // Use the entity's original spawn provider, including its native
            // object data. Constructing a tracker does not register or tick it.
            add.accept(entity.getAddEntityPacket(new ServerEntity(level,entity,1,false,p->{})));
            add.accept(new ClientboundSetEntityDataPacket(entity.getId(),metadata(entity)));
            if(entity instanceof LivingEntity living) {
                List<Pair<EquipmentSlot,net.minecraft.world.item.ItemStack>> equipment=new ArrayList<>();
                for(var slot:new EquipmentSlot[]{EquipmentSlot.MAINHAND,EquipmentSlot.OFFHAND,EquipmentSlot.FEET,EquipmentSlot.LEGS,EquipmentSlot.CHEST,EquipmentSlot.HEAD})equipment.add(Pair.of(slot,living.getItemBySlot(slot).copy()));
                add.accept(new ClientboundSetEquipmentPacket(entity.getId(),equipment));
            }
            add.accept(new ClientboundTeleportEntityPacket(entity));
        }
        out.add("entityIds",entityIds);out.add("packets",packets);
        if(out.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>3*1024*1024)throw new IllegalStateException("viewer_frame_over_budget");
        return out;
    }
}
