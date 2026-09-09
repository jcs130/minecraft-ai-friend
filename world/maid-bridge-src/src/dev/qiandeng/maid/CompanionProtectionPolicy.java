package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.Set;
import java.util.UUID;

/** A single explicit body/owner pair; no name, selector, wildcard or global protection. */
public record CompanionProtectionPolicy(boolean enabled, UUID bodyUuid, UUID ownerUuid) {
    public static CompanionProtectionPolicy disabled() { return new CompanionProtectionPolicy(false, null, null); }
    public static CompanionProtectionPolicy parse(String text) {
        if (text.length() > 4096) throw new IllegalArgumentException("protection_config_too_large");
        JsonObject value = JsonParser.parseString(text).getAsJsonObject();
        if (!value.keySet().equals(Set.of("schema", "enabled", "bodyUuid", "ownerUuid"))
                || !value.get("schema").isJsonPrimitive() || !value.getAsJsonPrimitive("schema").isNumber()
                || !value.get("schema").getAsString().equals("1")
                || !value.get("enabled").isJsonPrimitive() || !value.getAsJsonPrimitive("enabled").isBoolean())
            throw new IllegalArgumentException("invalid_protection_config");
        UUID body = uuid(value, "bodyUuid"), owner = uuid(value, "ownerUuid");
        if (body.equals(owner)) throw new IllegalArgumentException("distinct_protection_identities_required");
        return new CompanionProtectionPolicy(value.get("enabled").getAsBoolean(), body, owner);
    }
    private static UUID uuid(JsonObject value, String key) {
        if (!value.get(key).isJsonPrimitive() || !value.getAsJsonPrimitive(key).isString())
            throw new IllegalArgumentException("invalid_protection_uuid");
        String text = value.get(key).getAsString(); UUID uuid = UUID.fromString(text);
        if (!uuid.toString().equals(text)) throw new IllegalArgumentException("invalid_protection_uuid");
        return uuid;
    }
    public boolean matches(UUID body, UUID owner) {
        return enabled && bodyUuid != null && bodyUuid.equals(body) && ownerUuid.equals(owner);
    }
}
