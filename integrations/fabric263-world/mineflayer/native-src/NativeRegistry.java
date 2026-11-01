package dev.myagentworld.native263;

import com.google.gson.*;
import io.netty.buffer.Unpooled;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.GZIPOutputStream;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.*;
import net.fabricmc.fabric.impl.registry.sync.RegistrySyncManager;
import net.fabricmc.fabric.impl.registry.sync.packet.RegistrySyncPayload;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerLoginPacketListenerImpl;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.AABB;

/** Optional login-time, same-JVM registry discovery. No OP, actions or world scan. */
public final class NativeRegistry implements ModInitializer {
    public static final Identifier OFFER = Identifier.fromNamespaceAndPath("maw_agent", "registry_offer");
    public static final Identifier DATA = Identifier.fromNamespaceAndPath("maw_agent", "registry_data");
    private static volatile byte[] encoded;
    private static volatile String hash;
    private static final String EPOCH = UUID.randomUUID().toString();
    private static final Set<ServerLoginPacketListenerImpl> OFFERED = ConcurrentHashMap.newKeySet();
    private static final Set<ServerLoginPacketListenerImpl> SENT = ConcurrentHashMap.newKeySet();

    @Override public void onInitialize() {
        NativeViews.register();
        NativeMenus.register();
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            try { exportRegistry(server); } catch (Exception e) { throw new IllegalStateException("Native registry export failed", e); }
        });
        ServerLoginConnectionEvents.QUERY_START.register((handler, server, sender, sync) -> {
            if (encoded == null) return;
            OFFERED.add(handler);
            JsonObject offer = new JsonObject();
            offer.addProperty("schemaVersion", 1); offer.addProperty("minecraft", "26.3");
            offer.addProperty("serverEpoch", EPOCH); offer.addProperty("compression", "gzip");
            offer.addProperty("sha256", hash); offer.addProperty("bytes", encoded.length);
            sender.sendPacket(OFFER, new FriendlyByteBuf(Unpooled.wrappedBuffer(offer.toString().getBytes(StandardCharsets.UTF_8))));
        });
        ServerLoginNetworking.registerGlobalReceiver(OFFER, (server, handler, understood, data, sync, sender) -> {
            if (!OFFERED.remove(handler)) return;
            // Ordinary clients decline this optional query and continue normally.
            if (!understood) return;
            if (data.readableBytes() != 1 || data.readByte() != 1) throw new IllegalArgumentException("Invalid native registry offer acknowledgement");
            SENT.add(handler);
            ServerLoginNetworking.getSender(handler).sendPacket(DATA, new FriendlyByteBuf(Unpooled.wrappedBuffer(encoded)));
        });
        ServerLoginNetworking.registerGlobalReceiver(DATA, (server, handler, understood, data, sync, sender) -> {
            if (!SENT.remove(handler)) return;
            if (!understood || data.readableBytes() != 64 || !data.toString(StandardCharsets.US_ASCII).equals(hash)) {
                throw new IllegalArgumentException("Native registry acknowledgement mismatch");
            }
        });
        ServerLoginConnectionEvents.DISCONNECT.register((handler, server) -> { OFFERED.remove(handler); SENT.remove(handler); });
    }

    @SuppressWarnings({"rawtypes", "unchecked"}) private static String propertyName(Property property, BlockState state) {
        return property.getName(state.getValue(property));
    }

    private static void exportRegistry(MinecraftServer server) throws Exception {
        JsonObject root = new JsonObject();
        root.addProperty("schemaVersion", 1); root.addProperty("minecraft", "26.3"); root.addProperty("protocol", 777);
        root.addProperty("serverEpoch", EPOCH); root.addProperty("observedAt", java.time.Instant.now().toString());
        JsonArray states = new JsonArray();
        for (BlockState state : Block.BLOCK_STATE_REGISTRY) {
            Block block = state.getBlock();
            JsonObject row = new JsonObject();
            row.addProperty("id", Block.getId(state)); row.addProperty("blockId", BuiltInRegistries.BLOCK.getId(block));
            row.addProperty("name", BuiltInRegistries.BLOCK.getKey(block).toString());
            row.addProperty("defaultStateId", Block.getId(block.defaultBlockState()));
            row.addProperty("hardness", block.defaultDestroyTime()); row.addProperty("canOcclude", state.canOcclude());
            row.addProperty("air", state.isAir());
            JsonObject props = new JsonObject();
            for (Property<?> property : state.getProperties()) props.addProperty(property.getName(), propertyName(property, state));
            row.add("properties", props);
            JsonArray boxes = new JsonArray(); boolean available = !block.hasDynamicShape();
            if (available) {
                try {
                    for (AABB box : state.getCollisionShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO).toAabbs()) {
                        JsonArray a = new JsonArray();
                        for (double n : new double[]{box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ}) a.add(n);
                        boxes.add(a);
                    }
                } catch (RuntimeException error) { available = false; boxes = new JsonArray(); }
            }
            row.addProperty("shapeAvailable", available);
            row.addProperty("shapeContext", available ? "static_empty_world_context" : "unknown_requires_live_context");
            row.add("collisionShapes", boxes); states.add(row);
        }
        root.add("states", states);
        JsonArray items = new JsonArray();
        for (var item : BuiltInRegistries.ITEM) {
            JsonObject row = new JsonObject();
            row.addProperty("id", BuiltInRegistries.ITEM.getId(item)); row.addProperty("name", BuiltInRegistries.ITEM.getKey(item).toString());
            row.addProperty("stackSize", item.getDefaultMaxStackSize()); row.addProperty("translationKey", item.getDescriptionId());
            var food = item.components().get(DataComponents.FOOD);
            if (food != null) {
                JsonObject meal = new JsonObject(); meal.addProperty("nutrition", food.nutrition());
                meal.addProperty("saturation", food.saturation()); meal.addProperty("canAlwaysEat", food.canAlwaysEat()); row.add("food", meal);
            }
            items.add(row);
        }
        root.add("items", items);
        JsonArray entities = new JsonArray();
        for (var type : BuiltInRegistries.ENTITY_TYPE) {
            JsonObject row = new JsonObject();
            row.addProperty("id", BuiltInRegistries.ENTITY_TYPE.getId(type)); row.addProperty("name", BuiltInRegistries.ENTITY_TYPE.getKey(type).toString());
            row.addProperty("width", type.getWidth()); row.addProperty("height", type.getHeight()); row.addProperty("category", type.getCategory().getName());
            entities.add(row);
        }
        root.add("entities", entities);
        JsonArray components = new JsonArray();
        for (var type : BuiltInRegistries.DATA_COMPONENT_TYPE) {
            JsonObject row = new JsonObject(); row.addProperty("id", BuiltInRegistries.DATA_COMPONENT_TYPE.getId(type));
            row.addProperty("name", BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(type).toString()); components.add(row);
        }
        root.add("components", components);
        JsonArray menus = new JsonArray();
        for (var type : BuiltInRegistries.MENU) {
            JsonObject row = new JsonObject(); row.addProperty("id", BuiltInRegistries.MENU.getId(type));
            row.addProperty("name", BuiltInRegistries.MENU.getKey(type).toString()); menus.add(row);
        }
        root.add("menus", menus);
        root.add("viewBridge", NativeViews.describe());
        root.addProperty("menuBridge", NativeMenus.MenuState.TYPE.id().toString());
        root.add("gridRecipes", NativeRecipes.export(server));
        // Retain the real Fabric sync protocol. The JS consumer verifies the
        // received payload byte-for-byte before acknowledging this task.
        var syncMap = RegistrySyncManager.createAndPopulateRegistryMap();
        JsonObject syncRegistries = new JsonObject();
        if (syncMap != null) for (var entry : syncMap.entrySet()) {
            JsonObject table = new JsonObject();
            for (var value : entry.getValue().object2IntEntrySet()) table.addProperty(value.getKey().toString(), value.getIntValue());
            syncRegistries.add(entry.getKey().toString(), table);
        }
        root.add("fabricRegistries", syncRegistries);
        if (syncMap != null) {
            FriendlyByteBuf buffer = new FriendlyByteBuf(Unpooled.buffer());
            try {
                RegistrySyncPayload.CODEC.encode(buffer, new RegistrySyncPayload(syncMap));
                byte[] bytes = new byte[buffer.readableBytes()]; buffer.readBytes(bytes);
                root.addProperty("fabricSyncSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)));
            } finally { buffer.release(); }
        }
        byte[] raw = root.toString().getBytes(StandardCharsets.UTF_8);
        if (raw.length > 64 * 1024 * 1024) throw new IllegalStateException("Native registry expanded budget exceeded");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(out)) { gzip.write(raw); }
        byte[] compressed = out.toByteArray();
        if (compressed.length > 900 * 1024) throw new IllegalStateException("Native registry login packet budget exceeded");
        hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(compressed));
        encoded = compressed;
        System.out.println("[MAW Native] registry ready: states=" + states.size() + " items=" + items.size() + " entities=" + entities.size() + " gzip=" + compressed.length + " epoch=" + EPOCH);
    }
}
