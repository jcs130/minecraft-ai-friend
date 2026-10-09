package dev.qiandeng.maw;

import com.elfmcys.yesstevemodel.O0Ooo000O0ooO00Oooo00oOO;
import com.elfmcys.yesstevemodel.OOo0o0000Ooo0o00OO0oOOoO;
import com.elfmcys.yesstevemodel.o00o000O0Ooooo0o0OOoo0oO;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.attachment.AttachmentType;
import net.neoforged.neoforge.registries.NeoForgeRegistries;
import net.minecraft.resources.ResourceLocation;

/** Locked YSM 2.6.5 self-selection, using the original ordinary-player handler. */
final class YsmOperations {
    private static final String SOURCE = "YSM_2.6.5_native_self_selection";

    static JsonObject requireState(ServerPlayer player) {
        JsonObject state = PlayerYsmState.snapshot(player);
        if (!state.has("available") || !state.get("available").getAsBoolean()
                || !state.has("ysmVersion") || !state.get("ysmVersion").getAsString().equals("2.6.5"))
            ModRequest.fail("ysm_verified_attachment_required");
        return state;
    }

    @SuppressWarnings("unchecked")
    private static boolean permitted(ServerPlayer player, String modelId) {
        if (!O0Ooo000O0ooO00Oooo00oOO.oOoo00O0o0oO0o0oO00OO0O0().contains(modelId)) return true;
        var type = (AttachmentType<OOo0o0000Ooo0o00OO0oOOoO>) NeoForgeRegistries.ATTACHMENT_TYPES.getOptional(
                ResourceLocation.fromNamespaceAndPath("yes_steve_model", "own_models")).orElse(null);
        if (type == null) return false;
        // A read must not create an attachment or grant model ownership.
        return player.getExistingData(type).map(owned -> owned.OO000o0ooOooooOOOOO0Ooo0(modelId)).orElse(false);
    }

    static JsonObject catalog(ServerPlayer player, int offset, int limit) {
        JsonObject result = new JsonObject(); result.addProperty("source", SOURCE);
        result.add("current", requireState(player));
        var models = O0Ooo000O0ooO00Oooo00oOO.oOo0OO0O0o000OO0O000oo0o();
        var entries = models.entrySet().stream().sorted(java.util.Map.Entry.comparingByKey()).toList();
        JsonArray rows = new JsonArray();
        for (int i = offset; i < Math.min(entries.size(), offset + limit); i++) {
            var entry = entries.get(i); String modelId = entry.getKey();
            JsonObject row = new JsonObject(); row.addProperty("modelId", modelId);
            row.addProperty("selectable", permitted(player, modelId));
            var original = entry.getValue().oOoo00O0o0oO0o0oO00OO0O0().oOoo00O0o0oO0o0oO00OO0O0();
            JsonArray textures = new JsonArray(); original.stream().limit(24).forEach(textures::add);
            row.add("textures", textures); row.addProperty("textureCount", original.size());
            row.addProperty("texturesTruncated", original.size() > 24); rows.add(row);
        }
        result.add("models", rows); result.addProperty("total", entries.size());
        result.addProperty("offset", offset); result.addProperty("hasMore", offset + rows.size() < entries.size());
        return result;
    }

    static void validateSelection(ServerPlayer player, JsonObject input) {
        JsonObject before = requireState(player);
        for (String field : new String[]{"modelId", "texture", "enabled", "mandatory"}) {
            String expected = "expected" + Character.toUpperCase(field.charAt(0)) + field.substring(1);
            if (!before.get(field).equals(input.get(expected))) ModRequest.fail("ysm_appearance_changed");
        }
        if (before.get("mandatory").getAsBoolean()) ModRequest.fail("ysm_model_locked_by_server");
        if (!before.get("enabled").getAsBoolean()) ModRequest.fail("ysm_model_disabled_by_server");
        String id = ModRequest.text(input, "modelId", 256), texture = ModRequest.text(input, "texture", 256);
        var model = O0Ooo000O0ooO00Oooo00oOO.oOo0OO0O0o000OO0O000oo0o().get(id);
        if (model == null) ModRequest.fail("ysm_model_not_found");
        if (!permitted(player, id)) ModRequest.fail("ysm_model_not_owned");
        if (!model.oOoo00O0o0oO0o0oO00OO0O0().oOoo00O0o0oO0o0oO00OO0O0().contains(texture))
            ModRequest.fail("ysm_texture_not_found");
    }

    static void select(ServerPlayer player, String modelId, String texture) {
        // This public serverbound packet handler preserves YSM's allow-change,
        // model ownership, valid texture, attachment update and tracking sync.
        // No console command, target player, mandatory flag or auth grant.
        o00o000O0Ooooo0o0OOoo0oO.oOo0OO0O0o000OO0O000oo0o(
                new o00o000O0Ooooo0o0OOoo0oO(modelId, texture), player, player.connection.getConnection());
    }
}
