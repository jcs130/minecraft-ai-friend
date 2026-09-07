package dev.qiandeng.irons;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import net.puffish.skillsmod.api.SkillsAPI;

/** Optional Pufferfish integration uses getters only; it never migrates progression. */
final class ProgressionReader {
    private ProgressionReader() {}
    static JsonObject read(ServerPlayer player) {
        var out = QiandengIronsBridge.response(player, "progression", true, "ok", "原生成长分类与技能点");
        var rows = new JsonArray();
        try (var categories = SkillsAPI.streamCategories()) {
            categories.sorted(java.util.Comparator.comparing(c -> c.getId().toString())).limit(256).forEach(category -> {
                var row = new JsonObject();
                row.addProperty("id", category.getId().toString());
                var experience = category.getExperience();
                row.addProperty("available", experience.isPresent());
                if (experience.isPresent()) {
                    row.addProperty("level", experience.get().getLevel(player));
                    row.addProperty("experience", experience.get().getTotal(player));
                } else {
                    row.addProperty("code", "no_experience");
                    row.add("level", JsonNull.INSTANCE);
                    row.add("experience", JsonNull.INSTANCE);
                }
                // Total and spendable points are distinct native getters, not inferred.
                row.addProperty("points_total", category.getPointsTotal(player));
                row.addProperty("points_spent", category.getSpentPoints(player));
                row.addProperty("points_left", category.getPointsLeft(player));
                rows.add(row);
            });
        }
        out.add("categories", rows);
        return out;
    }
}
