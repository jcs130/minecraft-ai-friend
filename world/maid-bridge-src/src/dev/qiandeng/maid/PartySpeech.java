package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.neoforged.neoforge.common.util.FakePlayer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;

/** A physical nearby speech event. Hearing is resolved on the world thread before AI delivery. */
public final class PartySpeech {
    private static final PartySpeechJournal JOURNAL = new PartySpeechJournal(Path.of("data/qiandeng-maid-bridge/party-speech"));
    private PartySpeech() {}
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("qdmaid").requires(s -> s.hasPermission(4) && s.getEntity() == null)
            .then(Commands.literal("party_say").then(Commands.argument("request", StringArgumentType.word())
                .executes(c -> say(c.getSource(), StringArgumentType.getString(c, "request")))))
            .then(Commands.literal("party_speech_status").then(Commands.argument("eventId", StringArgumentType.word())
                .executes(c -> status(c.getSource(), StringArgumentType.getString(c, "eventId"))))));
    }
    private static JsonObject base(JsonObject input, String phase, String code) {
        var out = new JsonObject(); out.addProperty("schema", 1);
        for (String key : new String[]{"eventId", "speakerUuid", "listenerUuid", "textSha256"})
            out.add(key, input != null && input.has(key) ? input.get(key).deepCopy() : JsonNull.INSTANCE);
        out.add("channel", input != null && input.has("channel") ? input.get("channel").deepCopy() : JsonNull.INSTANCE);
        out.addProperty("ok", false); out.addProperty("heard", false); out.addProperty("phase", phase); out.addProperty("code", code);
        for (String key : new String[]{"dimension", "speakerPosition", "listenerPosition", "distance", "emittedAt"}) out.add(key, JsonNull.INSTANCE);
        if (input != null && input.has("channel") && input.get("channel").getAsString().equals("msg")) out.add("radius", JsonNull.INSTANCE);
        else out.addProperty("radius", 24);
        out.addProperty("observedAt", System.currentTimeMillis());
        return out;
    }
    private static JsonObject decode(String encoded) {
        if (encoded == null || !encoded.matches("[A-Za-z0-9_-]{1,2400}")) throw new BridgeProtocol.Failure("invalid_request");
        JsonObject input;
        try { input = JsonParser.parseString(new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8)).getAsJsonObject(); }
        catch (RuntimeException error) { throw new BridgeProtocol.Failure("invalid_request"); }
        BridgeProtocol.exactKeys(input, Set.of("schema", "eventId", "speakerUuid", "listenerUuid", "text", "textSha256", "channel"));
        if (!input.has("schema") || !input.get("schema").toString().equals("1")) throw new BridgeProtocol.Failure("invalid_schema");
        for (String key : new String[]{"eventId", "speakerUuid", "listenerUuid"}) BridgeProtocol.uuid(BridgeProtocol.string(input, key, 36));
        String channel = input.has("channel") ? BridgeProtocol.string(input, "channel", 16) : "nearby";
        if (!Set.of("nearby", "msg").contains(channel)) throw new BridgeProtocol.Failure("invalid_channel");
        input.addProperty("channel", channel);
        String text = BridgeProtocol.string(input, "text", 640);
        if (text.codePointCount(0, text.length()) > 160 || text.codePoints().anyMatch(c -> Character.isISOControl(c)
            || Character.getType(c) == Character.FORMAT || c == 0x2028 || c == 0x2029)) throw new BridgeProtocol.Failure("invalid_text");
        String digest = BridgeProtocol.string(input, "textSha256", 64);
        if (!digest.matches("[0-9a-f]{64}") || !digest.equals(BridgeProtocol.sha256(text.getBytes(StandardCharsets.UTF_8))))
            throw new BridgeProtocol.Failure("text_hash_mismatch");
        return input;
    }
    private static boolean numen(ServerPlayer player) { return player.getClass().getName().equals("com.dwinovo.numen.entity.NumenPlayer"); }
    private static LivingEntity body(CommandSourceStack source, UUID id) {
        var player = source.getServer().getPlayerList().getPlayer(id);
        if (player != null) {
            if (!numen(player) || !player.isAlive() || player.hasDisconnected()) throw new BridgeProtocol.Failure("live_numen_body_required");
            return player;
        }
        return MaidBridge.find(source.getServer(), id);
    }
    private static JsonArray position(LivingEntity body) {
        var value = new JsonArray(); value.add(body.getX()); value.add(body.getY()); value.add(body.getZ()); return value;
    }
    private static int say(CommandSourceStack source, String encoded) {
        JsonObject input = null, result = null; String id = null, fingerprint = null;
        boolean claimed = false, emitted = false;
        try {
            MaidBridge.requireThread(source.getServer()); input = decode(encoded);
            id = input.get("eventId").getAsString();
            fingerprint = BridgeProtocol.sha256(("game_speech_v1\n" + input.get("channel").getAsString() + "\n" + input.get("speakerUuid").getAsString() + "\n"
                + input.get("listenerUuid").getAsString() + "\n" + input.get("textSha256").getAsString()).getBytes(StandardCharsets.UTF_8));
            result = base(input, "unknown", "outcome_unknown");
            JsonObject previous = JOURNAL.claim(id, fingerprint, input, result);
            if (previous != null) {
                if (previous.get("heard").getAsBoolean()) previous.addProperty("code", "already_heard");
                return emit(source, previous);
            }
            claimed = true;
            var speaker = body(source, BridgeProtocol.uuid(input.get("speakerUuid").getAsString()));
            var listener = body(source, BridgeProtocol.uuid(input.get("listenerUuid").getAsString()));
            EntityMaid maid; ServerPlayer owner;
            if (speaker instanceof EntityMaid m && listener instanceof ServerPlayer p) { maid = m; owner = p; }
            else if (listener instanceof EntityMaid m && speaker instanceof ServerPlayer p) { maid = m; owner = p; }
            else throw new BridgeProtocol.Failure("numen_owned_maid_pair_required");
            if (!maid.isTame() || !owner.getUUID().equals(maid.getOwnerUUID())) throw new BridgeProtocol.Failure("owner_changed");
            result.add("speakerPosition", position(speaker)); result.add("listenerPosition", position(listener));
            result.addProperty("dimension", speaker.level().dimension().location().toString());
            if (speaker.level() == listener.level()) result.addProperty("distance", Math.sqrt(speaker.distanceToSqr(listener)));
            if (input.get("channel").getAsString().equals("msg")) {
                if (!(listener instanceof ServerPlayer)) throw new BridgeProtocol.Failure("unsupported_player_target");
                // Installed native /msg did not provide a verifiable completion callback in
                // isolated testing. Keep private delivery unavailable; never silently publish it.
                throw new BridgeProtocol.Failure("native_msg_unavailable");
            }
            if (speaker.level() != listener.level()) throw new BridgeProtocol.Failure("different_dimension");
            double distance = Math.sqrt(speaker.distanceToSqr(listener)); result.addProperty("distance", distance);
            if (distance > 24) throw new BridgeProtocol.Failure("outside_hearing_radius");
            String text = input.get("text").getAsString();
            Component line = Component.literal("[附近] " + BridgeProtocol.clip(speaker.getName().getString(), 80) + "：" + text);
            emitted = true; // Any failure after the first possible packet is uncertain, never re-broadcast.
            for (var player : source.getServer().getPlayerList().getPlayers()) {
                if (numen(player) || player instanceof FakePlayer || player.level() != speaker.level()
                    || player.distanceToSqr(speaker) > 24 * 24) continue;
                player.sendSystemMessage(line);
            }
            // The loaded listener is the physical recipient even without a network connection.
            // One same-tick server event provides its hearing input; Qwen is not called here.
            result.addProperty("ok", true); result.addProperty("heard", true); result.addProperty("phase", "heard");
            result.addProperty("code", "nearby_speech_heard"); long confirmedAt = System.currentTimeMillis();
            result.addProperty("emittedAt", confirmedAt); result.addProperty("observedAt", confirmedAt);
        } catch (BridgeProtocol.Failure error) {
            if (result == null) result = base(input, "rejected", error.code);
            result.addProperty("ok", false); result.addProperty("heard", false);
            result.addProperty("phase", emitted ? "unknown" : "rejected"); result.addProperty("code", emitted ? "outcome_unknown" : error.code);
        } catch (Exception error) {
            result = base(input, "unknown", "outcome_unknown");
        }
        if (claimed) {
            try { JOURNAL.finish(id, fingerprint, input, result); }
            catch (Exception error) { result = base(input, "unknown", "outcome_unknown"); }
        }
        return emit(source, result);
    }
    private static int status(CommandSourceStack source, String id) {
        JsonObject input = new JsonObject(); JsonObject result;
        try {
            MaidBridge.requireThread(source.getServer()); BridgeProtocol.uuid(id); input.addProperty("eventId", id);
            result = JOURNAL.status(id);
            if (result == null) result = base(input, "not_found", "event_not_found");
        } catch (BridgeProtocol.Failure error) { result = base(input, "rejected", error.code); }
        catch (Exception error) { result = base(input, "unknown", "outcome_unknown"); }
        return emit(source, result);
    }
    private static int emit(CommandSourceStack source, JsonObject result) {
        String text = BridgeProtocol.PREFIX + result;
        source.sendSuccess(() -> Component.literal(text), false);
        return result.get("ok").getAsBoolean() ? 1 : 0;
    }
}
