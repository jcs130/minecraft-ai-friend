package dev.myagentworld.native263;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import net.fabricmc.fabric.api.networking.v1.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.*;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.*;

/** Actual open menu layout; no guessed chest layout or inventory mutation. */
public final class NativeMenus {
    public record MenuState(byte[] bytes) implements CustomPacketPayload {
        public static final Type<MenuState> TYPE = new Type<>(Identifier.fromNamespaceAndPath("maw_agent", "menu_state"));
        public static final StreamCodec<RegistryFriendlyByteBuf, MenuState> CODEC = StreamCodec.of(
            (buffer, payload) -> buffer.writeBytes(payload.bytes),
            buffer -> { int n = buffer.readableBytes(); if (n > 65536) throw new IllegalArgumentException("Menu budget"); byte[] bytes = new byte[n]; buffer.readBytes(bytes); return new MenuState(bytes); });
        @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
    }
    private static final Map<ServerGamePacketListenerImpl, String> LAST = Collections.synchronizedMap(new WeakHashMap<>());
    public static void register() { PayloadTypeRegistry.clientboundPlay().register(MenuState.TYPE, MenuState.CODEC); }

    public static void beforeSend(Object listener, Packet<?> packet) {
        if (!(listener instanceof ServerGamePacketListenerImpl game) || !ServerPlayNetworking.canSend(game.player, MenuState.TYPE)) return;
        int id;
        if (packet instanceof ClientboundOpenScreenPacket open) id = open.getContainerId();
        else if (packet instanceof ClientboundContainerSetContentPacket contents) id = contents.containerId();
        else return;
        AbstractContainerMenu menu = id == 0 ? game.player.inventoryMenu : game.player.containerMenu;
        if (menu.containerId != id) return;
        sendLayout(game.player, menu);
    }

    public static void sendLayout(ServerPlayer player, AbstractContainerMenu menu) {
        if (player.connection == null || !ServerPlayNetworking.canSend(player, MenuState.TYPE) || menu.slots.size() > 256) return;
        ServerGamePacketListenerImpl game = player.connection;
        int id = menu.containerId;
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1); out.addProperty("bodyId", player.getUUID().toString());
        out.addProperty("windowId", id); out.addProperty("nativeId", id == 0 ? "minecraft:inventory" : BuiltInRegistries.MENU.getKey(menu.getType()).toString());
        out.addProperty("slotCount", menu.slots.size());
        JsonArray slots = new JsonArray(); int first = Integer.MAX_VALUE; int last = -1; int count = 0; int resultSlot = -1;
        for (Slot slot : menu.slots) {
            boolean playerInventory = slot.container == game.player.getInventory() && slot.getContainerSlot() >= 0 && slot.getContainerSlot() < 36;
            if (playerInventory) { first = Math.min(first, slot.index); last = Math.max(last, slot.index); count++; }
            if (slot instanceof ResultSlot) resultSlot = slot.index;
            JsonObject row = new JsonObject(); row.addProperty("index", slot.index); row.addProperty("containerIndex", slot.getContainerSlot());
            row.addProperty("playerInventory", playerInventory); row.addProperty("class", slot.getClass().getName());
            row.addProperty("x", slot.x); row.addProperty("y", slot.y); slots.add(row);
        }
        out.addProperty("inventoryStart", count == 36 && last - first == 35 ? first : -1);
        out.addProperty("inventoryEnd", count == 36 && last - first == 35 ? last + 1 : -1);
        out.addProperty("resultSlot", resultSlot); out.add("slots", slots);
        String fingerprint = out.toString();
        if (fingerprint.equals(LAST.get(game))) return;
        out.addProperty("observedAt", java.time.Instant.now().toString()); out.addProperty("complete", true);
        byte[] encoded = out.toString().getBytes(StandardCharsets.UTF_8);
        if (encoded.length > 65536) throw new IllegalStateException("Native menu layout exceeds budget");
        LAST.put(game, fingerprint); ServerPlayNetworking.send(game.player, new MenuState(encoded));
    }
}
