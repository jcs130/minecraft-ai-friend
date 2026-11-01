package dev.myagentworld.native263;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import io.netty.buffer.Unpooled;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import net.fabricmc.fabric.api.networking.v1.*;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/** Translate only views already sent to this player, using the supplier's codec.
 * Original packets and all progression/permission checks remain in place.
 */
public final class NativeViews {
    private static final String[] CLASSES = {
        "de.quest.network.ReputationPayloads$ViewPayload",
        "de.quest.network.ReputationPayloads$InteractionPayload",
        "de.quest.network.Payloads$JournalPayload",
        "de.quest.network.Payloads$QuestTrackerPayload",
        "de.quest.network.VillageNetworkPayloads$NoticeBoardPayload",
        "de.quest.network.VillageNetworkPayloads$NoticeJourneyPayload"
    };
    private static final Map<String, Class<?>> VIEWS = new LinkedHashMap<>();
    public record ViewState(byte[] bytes) implements CustomPacketPayload {
        public static final Type<ViewState> TYPE = new Type<>(Identifier.fromNamespaceAndPath("maw_agent", "view_state"));
        public static final StreamCodec<RegistryFriendlyByteBuf, ViewState> CODEC = StreamCodec.of(
            (buffer, payload) -> buffer.writeBytes(payload.bytes),
            buffer -> { int n = buffer.readableBytes(); if (n > 262144) throw new IllegalArgumentException("View budget"); byte[] data = new byte[n]; buffer.readBytes(data); return new ViewState(data); });
        @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
    }

    public static void register() {
        try {
            for (String name : CLASSES) {
                Class<?> type = Class.forName(name);
                var id = (CustomPacketPayload.Type<?>) type.getField("ID").get(null);
                if (!type.isRecord()) throw new IllegalStateException("Reviewed view is no longer a record");
                VIEWS.put(id.id().toString(), type);
            }
        } catch (ReflectiveOperationException error) { throw new IllegalStateException("Village Quest view codec differs", error); }
        PayloadTypeRegistry.clientboundPlay().register(ViewState.TYPE, ViewState.CODEC);
    }

    public static JsonObject describe() {
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1);
        out.addProperty("villageQuestVersion", "2.6.3"); out.addProperty("channel", ViewState.TYPE.id().toString());
        JsonArray channels = new JsonArray(); VIEWS.keySet().forEach(channels::add); out.add("channels", channels);
        return out;
    }

    @SuppressWarnings("unchecked") public static void beforeSend(Object listener, Packet<?> packet) {
        if (!(listener instanceof ServerGamePacketListenerImpl game) || !(packet instanceof ClientboundCustomPayloadPacket custom)) return;
        String channel = custom.payload().type().id().toString();
        Class<?> type = VIEWS.get(channel);
        if (type == null || !ServerPlayNetworking.canSend(game.player, ViewState.TYPE)) return;
        try {
            if (custom.payload().getClass() != type) throw new IllegalStateException("Unexpected native view class");
            var codec = (StreamCodec<RegistryFriendlyByteBuf, CustomPacketPayload>) type.getField("CODEC").get(null);
            RegistryFriendlyByteBuf buffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), game.player.registryAccess());
            String hash;
            try {
                codec.encode(buffer, custom.payload());
                byte[] bytes = new byte[buffer.readableBytes()]; buffer.readBytes(bytes);
                hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            } finally { buffer.release(); }
            JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1); out.addProperty("channel", channel);
            out.addProperty("bodyId", game.player.getUUID().toString()); out.addProperty("observedAt", java.time.Instant.now().toString());
            out.addProperty("wireSha256", hash); out.addProperty("complete", true);
            out.add("data", json(custom.payload(), game, 0, new int[]{0}));
            byte[] encoded = out.toString().getBytes(StandardCharsets.UTF_8);
            if (encoded.length > 262144) throw new IllegalStateException("Native view budget exceeded");
            ServerPlayNetworking.send(game.player, new ViewState(encoded));
        } catch (Exception error) {
            // Preserve the supplier packet and its gameplay behavior. A failed
            // translation is an explicit unsupported view, never invented data.
            System.err.println("[MAW Native] view translation unavailable: " + channel + " " + error);
        }
    }

    private static JsonElement json(Object value, ServerGamePacketListenerImpl game, int depth, int[] count) throws Exception {
        if (++count[0] > 20000 || depth > 24) throw new IllegalArgumentException("View complexity budget");
        if (value == null) return JsonNull.INSTANCE;
        if (value instanceof Boolean b) return new JsonPrimitive(b);
        if (value instanceof Number n) return new JsonPrimitive(n);
        if (value instanceof String s) return new JsonPrimitive(s);
        if (value instanceof Component c) {
            JsonObject text = new JsonObject(); text.addProperty("text", c.getString());
            text.add("component", ComponentSerialization.CODEC.encodeStart(game.player.registryAccess().createSerializationContext(JsonOps.INSTANCE), c).getOrThrow());
            return text;
        }
        if (value instanceof Identifier || value instanceof UUID || value instanceof Enum<?>) return new JsonPrimitive(value.toString());
        if (value instanceof Optional<?> optional) return json(optional.orElse(null), game, depth + 1, count);
        if (value instanceof Iterable<?> iterable) {
            JsonArray array = new JsonArray(); int n = 0;
            for (Object element : iterable) { if (++n > 1024) throw new IllegalArgumentException("View list budget"); array.add(json(element, game, depth + 1, count)); }
            return array;
        }
        if (value instanceof Map<?, ?> map) {
            JsonObject object = new JsonObject();
            for (var entry : map.entrySet()) object.add(String.valueOf(entry.getKey()), json(entry.getValue(), game, depth + 1, count));
            return object;
        }
        if (value.getClass().isRecord()) {
            JsonObject object = new JsonObject();
            for (RecordComponent field : value.getClass().getRecordComponents()) object.add(field.getName(), json(field.getAccessor().invoke(value), game, depth + 1, count));
            return object;
        }
        throw new IllegalArgumentException("Unsupported view value: " + value.getClass().getName());
    }
}
