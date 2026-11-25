package org.qiandengji.vortex;

import com.google.gson.*;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.talent.PlayerTalentData;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** One bounded read-only projection for profession default/summary/status and consumers. */
final class ProfessionOverview {
    private record TalentRead(CompletableFuture<PlayerTalentData> future, long started) {}
    private final Map<UUID, TalentRead> talentReads = new HashMap<>();
    private static final Gson GSON = new Gson();

    JsonObject read(VortexCorePlugin core, Player player) {
        var out = new JsonObject();
        out.addProperty("queryOnly", true); out.addProperty("readOnly", true);
        out.addProperty("backend", "vortex"); out.addProperty("authority", "VortexRPG");
        out.addProperty("available", false); out.addProperty("loading", false);
        out.add("classSelected", JsonNull.INSTANCE);
        for (String field : List.of("class", "classId", "className", "level", "xp", "xpTotal", "xpProgress", "xpRequired", "xpRemaining", "nextLevelXp", "isMaxLevel", "learningPoints", "unspent", "skillPoints"))
            out.add(field, JsonNull.INSTANCE);
        out.addProperty("learningPointResource", "native_skill_points");
        out.add("skills", new JsonArray()); out.add("unlockedSkillIds", new JsonArray());
        var talents = new JsonObject();
        talents.addProperty("available", false); talents.addProperty("loading", false);
        talents.addProperty("resource", "native_talent_points"); talents.add("points", JsonNull.INSTANCE);
        talents.add("allocated", new JsonObject()); talents.add("nodes", new JsonArray());
        out.add("talents", talents); out.addProperty("nextCommand", "/mycli profession");
        if (!Bukkit.isPrimaryThread()) { out.addProperty("reason", "main_thread_required"); return out; }
        if (core == null) { out.addProperty("reason", "native_unavailable"); return out; }
        if (player == null || !player.isOnline()) { out.addProperty("reason", "actor_offline"); return out; }
        UUID actor = player.getUniqueId();
        var profiles = core.playerProfileService();
        boolean loading = profiles.qiandengjiLoading(actor);
        out.addProperty("loading", loading);
        UnifiedPlayer state = loading ? null : profiles.profile(actor).orElse(null);
        if (state == null) { out.addProperty("reason", loading ? "profile_loading" : "original_profile_not_loaded"); return out; }
        if (!actor.equals(state.uniqueId())) { out.addProperty("reason", "actor_mismatch"); return out; }
        var skills = core.classSkillService();
        var selected = skills.selectedClassDefinition(state);
        out.addProperty("available", true); out.addProperty("classSelected", selected.isPresent());
        out.addProperty("class", selected.map(c -> c.id()).orElse("none")); // Existing class/status JSON alias.
        out.addProperty("classId", selected.map(c -> c.id()).orElse(""));
        out.addProperty("className", selected.map(c -> c.displayName()).orElse("未选择职业"));
        out.addProperty("level", state.level()); out.addProperty("xp", state.experience());
        io.vortexcore.rpg.ExperienceProgress.of(state, profiles.experienceCurve()).fields()
            .forEach((key, value) -> out.add(key, GSON.toJsonTree(value)));
        int unspent = skills.unspentSkillPoints(state);
        out.addProperty("learningPoints", unspent); out.addProperty("unspent", unspent); out.addProperty("skillPoints", unspent);
        Set<String> unlocked = skills.unlockedSkillIds(state);
        out.add("unlockedSkillIds", GSON.toJsonTree(unlocked.stream().sorted().toList()));
        var nodes = new JsonArray();
        for (var node : skills.skillsFor(state)) {
            var row = new JsonObject();
            row.addProperty("id", node.id()); row.addProperty("name", node.displayName());
            row.addProperty("description", node.description()); row.addProperty("cost", node.cost());
            row.addProperty("requiredLevel", node.requiredLevel()); row.addProperty("unlocked", unlocked.contains(node.id()));
            row.addProperty("resource", "native_skill_points"); row.addProperty("grantedSpellId", node.grantedSpellId());
            nodes.add(row);
        }
        out.add("skills", nodes);
        var service = core.qiandengjiTalents();
        skills.selectedClass(state).flatMap(c -> service.registry().find(c)).ifPresent(tree -> {
            var definitions = new JsonArray();
            tree.nodes().values().stream().sorted(Comparator.comparing(n -> n.id())).forEach(node -> {
                var row = new JsonObject(); row.addProperty("id", node.id()); row.addProperty("name", node.displayName());
                row.addProperty("description", node.description()); row.addProperty("cost", node.cost());
                row.addProperty("resource", "native_talent_points");
                row.add("prerequisites", GSON.toJsonTree(node.prerequisites()));
                row.addProperty("grantedAbility", node.grantedAbility()); definitions.add(row);
            });
            talents.add("nodes", definitions);
        });
        talentReads.keySet().removeIf(id -> Bukkit.getPlayer(id) == null);
        long now = System.currentTimeMillis();
        var read = talentReads.get(actor);
        if (read == null || read.future().isDone() && now - read.started() >= 1000) {
            try { read = new TalentRead(service.talentData(actor), now); talentReads.put(actor, read); }
            catch (RuntimeException error) { talents.addProperty("reason", "talents_unavailable"); }
        }
        if (read != null) {
            var future = read.future();
            talents.addProperty("loading", !future.isDone());
            if (!future.isDone()) talents.addProperty("reason", "talents_loading");
            else if (future.isCompletedExceptionally() || future.isCancelled()) talents.addProperty("reason", "talents_unavailable");
            else {
                var data = future.getNow(null);
                if (data != null && actor.equals(data.playerId())) {
                    talents.addProperty("available", true); talents.addProperty("points", data.talentPoints());
                    talents.add("allocated", GSON.toJsonTree(data.allocatedNodes()));
                    for (JsonElement element : talents.getAsJsonArray("nodes")) {
                        var row = element.getAsJsonObject();
                        row.addProperty("allocated", data.allocatedNodes().getOrDefault(selected.map(c -> c.id()).orElse(""), Set.of())
                            .contains(row.get("id").getAsString()));
                    }
                } else talents.addProperty("reason", "talent_actor_mismatch");
            }
        }
        out.addProperty("reason", selected.isPresent() ? "ready" : "class_required");
        out.addProperty("nextCommand", selected.isPresent() ? "/mycli profession" : "/mycli profession list");
        return out;
    }

    static String text(JsonObject out) {
        if (!out.get("available").getAsBoolean()) return "职业资料暂不可用（" + out.get("reason").getAsString() + "）；未修改。稍后查询 /mycli profession";
        var talents = out.getAsJsonObject("talents");
        String points = talents.get("available").getAsBoolean() ? talents.get("points").getAsString() : "未就绪";
        return out.get("className").getAsString() + " Lv." + out.get("level").getAsInt() + "；累计经验 " + out.get("xp").getAsLong()
            + "；学习点 " + out.get("unspent").getAsInt() + "；已学 " + out.getAsJsonArray("unlockedSkillIds").size()
            + "项；天赋点 " + points + "（与学习点分开）。详情：/mycli profession --json；选职：/mycli profession list；学习仍用 /mycli skills learn <ID>。";
    }
}
