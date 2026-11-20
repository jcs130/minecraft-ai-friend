package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sk89q.worldedit.math.BlockVector3;
import org.bukkit.configuration.ConfigurationSection;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Public frontage and stable resident identity for a protected, private housing plot. */
record LandHome(String id, UUID characterId, String streetId, String street, String number,
                String parentId, String resident, String profession, BlockVector3 entrance, BlockVector3 respawn) {
    private static final Set<String> FIELDS = Set.of("address-id", "character-id", "body-uuid",
            "street-id", "street-name", "number", "parent-id", "resident", "profession", "entrance", "respawn");

    static LandHome read(ConfigurationSection config, UUID owner, BlockVector3 min, BlockVector3 max) {
        if (!FIELDS.containsAll(config.getKeys(false))) throw new IllegalArgumentException("住房有未知字段");
        UUID character = uuid(config, "character-id");
        if (!owner.equals(uuid(config, "body-uuid"))) throw new IllegalArgumentException("住房身体必须是该领地主人");
        BlockVector3 door = point(config, "entrance");
        int dx = Math.max(0, Math.max(min.x() - door.x(), door.x() - max.x()));
        int dz = Math.max(0, Math.max(min.z() - door.z(), door.z() - max.z()));
        if (Math.abs((long) door.x()) > 29_999_984 || Math.abs((long) door.z()) > 29_999_984
                || door.y() < min.y() || door.y() > max.y() || (long) dx + dz > 1)
            throw new IllegalArgumentException("住房门口必须位于本领地内或贴邻边界");
        String number = label(config, "number", 24);
        if (!number.matches("[\\p{L}\\p{N}][\\p{L}\\p{N}-]{0,23}"))
            throw new IllegalArgumentException("无效住房门牌号");
        BlockVector3 respawn = point(config, "respawn");
        if (respawn.x() < min.x() || respawn.x() > max.x() || respawn.z() < min.z() || respawn.z() > max.z()
                || respawn.y() < min.y() || (long) respawn.y() + 1 > max.y())
            throw new IllegalArgumentException("住房重生点和头部空间须在领地内");
        return new LandHome(id(config, "address-id"), character, id(config, "street-id"),
                label(config, "street-name", 40), number,
                config.contains("parent-id") ? id(config, "parent-id") : null,
                label(config, "resident", 40), config.contains("profession") ? label(config, "profession", 40) : null,
                door, respawn);
    }

    private static BlockVector3 point(ConfigurationSection config, String key) {
        List<?> coordinates = config.getList(key);
        if (coordinates == null || coordinates.size() != 3
                || coordinates.stream().anyMatch(value -> !(value instanceof Integer)))
            throw new IllegalArgumentException("住房 " + key + " 需要三个整数");
        return BlockVector3.at((int) coordinates.get(0), (int) coordinates.get(1), (int) coordinates.get(2));
    }

    private static UUID uuid(ConfigurationSection config, String key) {
        String value = label(config, key, 36);
        UUID id = UUID.fromString(value);
        if (!id.toString().equalsIgnoreCase(value) || id.equals(new UUID(0, 0)))
            throw new IllegalArgumentException("住房 " + key + " 需要完整的非零 UUID");
        return id;
    }

    private static String id(ConfigurationSection config, String key) {
        String value = label(config, key, 80);
        if (!value.matches("[a-z][a-z0-9_-]{0,79}")) throw new IllegalArgumentException("无效住房 " + key);
        return value;
    }

    private static String label(ConfigurationSection config, String key, int limit) {
        String value = config.isString(key) ? config.getString(key) : null;
        if (value == null || value.isBlank() || !value.equals(value.strip()) || value.length() > limit
                || value.matches("(?s).*[<>§\\p{C}\\p{Zl}\\p{Zp}].*"))
            throw new IllegalArgumentException("无效住房 " + key);
        return value;
    }

    String numberScope() { return (parentId != null ? "room:" + parentId : "street:" + streetId) + ':' + number; }

    String address() { return street + ' ' + number + (parentId != null ? " 室" : " 号"); }

    JsonObject publicEntry(String title) {
        JsonObject data = new JsonObject();
        data.addProperty("id", id);
        data.addProperty("kind", parentId != null ? "room" : "home");
        data.addProperty("name", title);
        data.addProperty("streetId", streetId);
        data.addProperty("streetName", street);
        data.addProperty("number", number);
        if (parentId != null) data.addProperty("parentId", parentId);
        JsonObject point = new JsonObject();
        point.addProperty("x", entrance.x()); point.addProperty("y", entrance.y()); point.addProperty("z", entrance.z());
        data.add("position", point);
        JsonObject occupant = new JsonObject();
        occupant.addProperty("name", resident);
        if (profession != null) occupant.addProperty("profession", profession);
        JsonArray occupants = new JsonArray();
        occupants.add(occupant);
        data.add("residents", occupants);
        return data;
    }
}
