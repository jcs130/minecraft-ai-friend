package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Opt in a single owner's existing body. Native work and other residents keep their own controllers. */
record PersonalMaidDialogue(UUID owner, UUID maid, String soundPackId, String voice) {
    static PersonalMaidDialogue load(HybridMaidPlugin plugin) {
        Path file = plugin.getDataFolder().toPath().resolve("personal-dialogue.json");
        if (!Files.exists(file)) return null;
        try {
            JsonObject row = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            if (row.get("schema").getAsInt() != 1) throw new IllegalArgumentException("schema");
            var binding = new PersonalMaidDialogue(UUID.fromString(row.get("ownerId").getAsString()),
                UUID.fromString(row.get("maidId").getAsString()), row.get("soundPackId").getAsString(), row.get("voice").getAsString());
            if (!binding.soundPackId.matches("[a-z0-9_.:-]{1,96}") || !binding.voice.matches("[A-Za-z0-9_.-]{1,96}"))
                throw new IllegalArgumentException("voice or native pack id");
            plugin.getLogger().info("Personal maid dialogue enabled for original body " + binding.maid() + ", native pack " + binding.soundPackId());
            return binding;
        } catch (Exception invalid) {
            plugin.getLogger().warning("Invalid personal-dialogue.json: " + invalid.getClass().getSimpleName());
            return null;
        }
    }

    boolean matches(EntityMaid body) {
        return body != null && maid.equals(body.getUUID()) && owner.equals(body.getOwnerUUID()) && body.isAlive() && !body.isRemoved();
    }

    JsonObject speechProfile(JsonObject transport) {
        var profile = transport.deepCopy();
        profile.addProperty("maidId", maid.toString());
        profile.addProperty("ownerId", owner.toString());
        profile.addProperty("voice", voice);
        profile.addProperty("requiredSoundPack", soundPackId);
        profile.remove("ambientPack");
        return profile;
    }
}
