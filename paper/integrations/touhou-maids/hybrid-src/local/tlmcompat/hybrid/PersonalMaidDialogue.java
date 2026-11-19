package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** A server policy for tamed bodies. Older installations can retain the single-body opt-in. */
record PersonalMaidDialogue(UUID owner, UUID maid, Map<String,String> packs, Path nativeEncoder) {
    static final String SITE = "qiandengji_sound_pack";

    static PersonalMaidDialogue load(HybridMaidPlugin plugin) {
        Path file = plugin.getDataFolder().toPath().resolve("personal-dialogue.json");
        if (!Files.exists(file)) return null;
        try {
            JsonObject row = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            var policy = parse(row);
            plugin.getLogger().info(policy.allOwned()
                ? "Server maid dialogue ready for player-owned bodies, sound packs=" + policy.packs().size()
                : "Personal maid dialogue enabled for original body " + policy.maid() + ", native pack " + policy.packs().keySet().iterator().next());
            return policy;
        } catch (Exception invalid) {
            plugin.getLogger().warning("Invalid personal-dialogue.json: " + invalid.getClass().getSimpleName());
            return null;
        }
    }

    static PersonalMaidDialogue parse(JsonObject row) {
        int schema = row.get("schema").getAsInt();
        if (schema == 1) {
            return new PersonalMaidDialogue(UUID.fromString(row.get("ownerId").getAsString()),
                UUID.fromString(row.get("maidId").getAsString()), Map.of(
                packId(row.get("soundPackId").getAsString()), voiceId(row.get("voice").getAsString())), null);
        }
        if (schema != 2 || !"player_owned".equals(row.get("scope").getAsString()))
            throw new IllegalArgumentException("Unknown personal dialogue policy");
        var entries = row.getAsJsonObject("packs");
        if (entries.size() > 512) throw new IllegalArgumentException("Sound pack catalog too large");
        var packs = new LinkedHashMap<String,String>();
        entries.entrySet().forEach(e -> packs.put(packId(e.getKey()), voiceId(e.getValue().getAsString())));
        Path encoder = Path.of(row.get("nativeEncoder").getAsString());
        if (!encoder.isAbsolute()) throw new IllegalArgumentException("Absolute audio encoder path required");
        return new PersonalMaidDialogue(null, null, Map.copyOf(packs), encoder);
    }

    private static String packId(String id) {
        if (!id.matches("[a-z0-9_.:-]{1,96}")) throw new IllegalArgumentException("Invalid sound pack id");
        return id;
    }
    private static String voiceId(String id) {
        if (!id.matches("[A-Za-z0-9_.-]{1,96}")) throw new IllegalArgumentException("Invalid voice id");
        return id;
    }

    boolean allOwned() { return maid == null; }

    void watchCatalog(HybridMaidPlugin plugin) {
        if (!allOwned()) return;
        Path file = plugin.getDataFolder().toPath().resolve("personal-dialogue.json");
        var watch = new Runnable() {
            java.nio.file.attribute.FileTime last;
            public void run() {
                try {
                    var stamp = Files.getLastModifiedTime(file);
                    if (stamp.equals(last)) return;
                    last = stamp;
                    var next = parse(JsonParser.parseString(Files.readString(file)).getAsJsonObject());
                    if (!next.allOwned() || !nativeEncoder.equals(next.nativeEncoder)) return;
                    org.bukkit.Bukkit.getScheduler().runTask(plugin, () -> plugin.personal = next);
                } catch (java.nio.file.NoSuchFileException absent) {
                    // An interrupted import leaves the current catalog usable.
                } catch (Exception invalid) {
                    plugin.getLogger().warning("Could not refresh the maid voice catalog: " + invalid.getClass().getSimpleName());
                }
            }
        };
        org.bukkit.Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, watch, 20L, 300L);
    }

    boolean matches(EntityMaid body) {
        return body != null && body.getOwnerUUID() != null && body.isAlive() && !body.isRemoved()
            && (allOwned() || maid.equals(body.getUUID()) && owner.equals(body.getOwnerUUID()));
    }

    String selectedVoice(EntityMaid body) {
        String pack = body.getSoundPackId();
        return pack == null ? null : packs.get(pack);
    }

    JsonObject speechProfile(JsonObject transport, EntityMaid body, String voice) {
        var profile = transport.deepCopy();
        profile.addProperty("maidId", body.getUUID().toString());
        profile.addProperty("ownerId", body.getOwnerUUID().toString());
        profile.addProperty("voice", voice);
        profile.addProperty("requiredSoundPack", body.getSoundPackId());
        profile.remove("ambientPack");
        return profile;
    }
}
