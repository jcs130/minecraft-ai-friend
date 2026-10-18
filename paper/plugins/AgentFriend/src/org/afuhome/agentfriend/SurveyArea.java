package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.configuration.ConfigurationSection;

/** Optional, frozen local survey bounds. Checking them never loads a chunk. */
record SurveyArea(String name, int minX, int minY, int minZ, int maxX, int maxY, int maxZ, String world) {
    SurveyArea(String name, int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
        this(name,minX,minY,minZ,maxX,maxY,maxZ,"world");
    }
    SurveyArea {
        if (name == null || name.isBlank() || name.length() > 40 || name.chars().anyMatch(Character::isISOControl)
                || minX > maxX || minY > maxY || minZ > maxZ || minY < -64 || maxY > 319
                || Math.abs((long)minX) >= 29999000 || Math.abs((long)maxX) >= 29999000
                || Math.abs((long)minZ) >= 29999000 || Math.abs((long)maxZ) >= 29999000
                || (long)maxX - minX > 1024 || (long)maxZ - minZ > 1024
                || world == null || !world.matches("[A-Za-z0-9_.-]{1,80}"))
            throw new IllegalArgumentException("survey area needs named, bounded inclusive coordinates");
    }
    static SurveyArea parse(ConfigurationSection step) {
        if (!step.contains("area")) return null;
        ConfigurationSection area = step.getConfigurationSection("area");
        if (area == null && step.get("area") instanceof java.util.Map<?, ?> values) {
            var normalized = new org.bukkit.configuration.file.YamlConfiguration();
            area = normalized.createSection("area", values);
        }
        if (area == null) throw new IllegalArgumentException("area must be an object");
        for (String key : new String[]{"min-x", "min-y", "min-z", "max-x", "max-y", "max-z"})
            if (!area.isInt(key)) throw new IllegalArgumentException("area requires integer " + key);
        return new SurveyArea(area.getString("name", ""), area.getInt("min-x"), area.getInt("min-y"),
                area.getInt("min-z"), area.getInt("max-x"), area.getInt("max-y"), area.getInt("max-z"), area.getString("world", "world"));
    }
    boolean contains(double x, double y, double z) {
        // Block bounds, including the whole last block; fractional positions on
        // its east/south edge must not be mistaken for leaving the task area.
        return Double.isFinite(x) && Double.isFinite(y) && Double.isFinite(z)
                && x >= minX && x < (double)maxX + 1 && y >= minY && y < (double)maxY + 1
                && z >= minZ && z < (double)maxZ + 1;
    }
    boolean contains(String world, double x, double y, double z) { return this.world.equals(world) && contains(x,y,z); }
    String conditions() { return name + "（X=" + minX + ".." + maxX + "，Y=" + minY + ".." + maxY + "，Z=" + minZ + ".." + maxZ + "，含边界方块）"; }
    JsonObject json() {
        JsonObject out = new JsonObject(); out.addProperty("name", name); out.addProperty("world", world);
        JsonArray min = new JsonArray(), max = new JsonArray();
        for (int value : new int[]{minX, minY, minZ}) min.add(value);
        for (int value : new int[]{maxX, maxY, maxZ}) max.add(value);
        out.add("min", min); out.add("max", max); out.addProperty("inclusiveBlockBounds", true); return out;
    }
}
