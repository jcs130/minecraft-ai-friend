package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;

/** Short, read-only instructions derived from frozen rules and real survey evidence.
 * Public coordinates are hints, never arrival evidence or a verified safe entrance. */
final class ExplorationGuidance {
    record Landmark(String id, String name, String world, int x, int z, String structureKey, String verifiedAt) {
        JsonObject json() {
            JsonObject j = new JsonObject();
            j.addProperty("id", id); j.addProperty("name", name); j.addProperty("world", world);
            j.addProperty("x", x); j.addProperty("z", z); j.addProperty("structureKey", structureKey);
            j.addProperty("verifiedAt", verifiedAt); j.addProperty("entranceVerified", false);
            j.addProperty("precision", "horizontal_structure_reference"); return j;
        }
    }
    private ExplorationGuidance() { }

    // Same bounded schema as the Goddess's hot-read public catalog. No world scan,
    // locate, chunk loading, file watching or per-tick disk reads.
    static List<Landmark> load(Path file) throws IOException {
        if (!Files.exists(file)) return List.of();
        if (Files.size(file) > 16384) throw new IllegalArgumentException("landmark catalog exceeds 16 KiB");
        byte[] bytes;
        try (var stream = Files.newInputStream(file)) { bytes = stream.readNBytes(16385); }
        if (bytes.length > 16384) throw new IllegalArgumentException("landmark catalog exceeds 16 KiB");
        JsonObject raw = JsonParser.parseString(new String(bytes, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
        if (raw.get("schemaVersion").getAsInt() != 1
                || !raw.get("source").getAsString().equals("formal_anvil_structure_and_block_records"))
            throw new IllegalArgumentException("landmark schema/source");
        String verified = raw.get("verifiedAt").getAsString(); Instant.parse(verified);
        JsonArray rows = raw.getAsJsonArray("places");
        if (rows.size() > 24) throw new IllegalArgumentException("max 24 landmarks");
        List<Landmark> result = new ArrayList<>(); HashSet<String> ids = new HashSet<>();
        for (var value : rows) {
            JsonObject p = value.getAsJsonObject(); String id = p.get("id").getAsString(), name = p.get("name").getAsString();
            String world = p.get("world").getAsString(), key = p.get("structureKey").getAsString();
            if (!id.matches("[a-z0-9_-]{1,64}") || !ids.add(id) || name.isBlank() || name.length() > 40
                    || name.chars().anyMatch(c -> c < 32 || c == 127 || c == '§')
                    || !world.matches("[a-z0-9_.-]+:[a-z0-9_./-]+") || !key.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")
                    || !p.get("precision").getAsString().equals("horizontal_structure_reference")
                    || !p.get("entranceVerified").isJsonPrimitive()
                    || !p.get("entranceVerified").getAsJsonPrimitive().isBoolean()
                    || p.get("entranceVerified").getAsBoolean() || p.has("y"))
                throw new IllegalArgumentException("invalid horizontal landmark");
            int x = coordinate(p, "x"), z = coordinate(p, "z");
            result.add(new Landmark(id, name, world, x, z, key, verified));
        }
        return List.copyOf(result);
    }
    private static int coordinate(JsonObject p, String key) {
        var value = p.get(key);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException("landmark coordinate");
        double n = value.getAsDouble();
        if (!Double.isFinite(n) || n != Math.rint(n) || Math.abs(n) >= 29999000) throw new IllegalArgumentException("landmark coordinate");
        return (int) n;
    }
    static JsonObject guide(ExplorationObjectives.Target target, int count, JsonObject navigation,
            JsonObject evidence, String reason, List<Landmark> places, int x, int z) {
        JsonObject out = new JsonObject(); JsonArray missing = new JsonArray();
        out.addProperty("readOnly", true); out.addProperty("observedAt", System.currentTimeMillis());
        out.add("missingConditions", missing);
        boolean ready = flag(evidence, "ready"), matches = flag(navigation, "dimensionMatches");
        out.addProperty("ready", ready); out.addProperty("targetMatch", flag(evidence, "validCurrentTarget"));
        out.addProperty("nextCommand", ready ? "/mycli guild claim" : "/mycli tasks status");
        // Completed surveys survive the return journey; a new world must not undo them.
        if (ready) return phase(out, "ready_to_submit", "本阶段探索已完成。", "用 /mycli guild claim 交付；多阶段委托会继续下一阶段。");
        if (!matches) {
            missing.add("返回" + target.dimensionLabel());
            return phase(out, "return_to_required_dimension", "当前维度不符合本阶段要求。",
                    "先经已知门户或本人地点回" + target.dimensionLabel() + "；中转坐标不是探索目标。");
        }
        if (reason.equals("outside_survey_target")) return phase(out, "resume_survival", "当前状态不能记录探索。", "存活后以生存模式落地步行，已有进度保留。");
        if (reason.equals("current_chunk_unloaded")) return phase(out, "wait_for_terrain", "脚下区块或现场数据尚未就绪。", "先等现场加载；持续不恢复请联系服主，不连续重复交付。");
        boolean started = number(evidence, "distinctZones") > 0 || !text(evidence, "structureInstance").isEmpty();
        if (target.goal() == GuildManager.Goal.STRUCTURE && !flag(evidence, "validCurrentTarget")) {
            if (started) {
                JsonObject last = evidence.has("lastSurveyPosition") && evidence.get("lastSurveyPosition").isJsonObject() ? evidence.getAsJsonObject("lastSurveyPosition") : new JsonObject();
                if (last.has("world") && last.has("x") && last.has("z")) out.add("resumePosition", last.deepCopy());
                missing.add("回到原先记录的同一座遗迹内部");
                return phase(out, "resume_same_structure", "已有走查证据保留，目前不在原遗迹的有效区域。", "回到上次记录地点，进入原遗迹的通道继续走查；不要换一座凑数，也不必放弃重接。");
            }
            missing.add("进入任务指定的天然结构内部");
            Landmark hint = nearest(target, navigation, places, x, z);
            String next = "先向女神询问已核实的目标线索；没有线索时不要盲找或反复交付。";
            if (hint != null) {
                JsonObject landmark = hint.json(); int distance = (int) Math.ceil(Math.hypot((double)hint.x - x, (double)hint.z - z));
                landmark.addProperty("horizontalDistance", distance); out.add("landmark", landmark);
                next = "前往" + target.dimensionLabel() + " X=" + hint.x + "、Z=" + hint.z + " 的" + hint.name
                        + "（直线约" + distance + "格）；这是建筑参考位置，入口与安全路线未验证，抵达后找实际入口。";
            }
            return phase(out, "find_target", "还未记录到目标内部探索；到同名群系或庙外不算。", next);
        }
        if (target.goal() == GuildManager.Goal.RETURN) return phase(out, "confirm_return", "已回目标维度，等待服务器记录。", "稍后 tasks status 查询；状态就绪后只交付一次。");
        if (reason.equals("outside_survey_biome")) {
            missing.add("进入指定群系 " + String.join(" 或 ", target.keys()));
            return phase(out, "find_target_biome", "当前位置不是本阶段要求的群系。", "先找到指定群系再步行调查；普通森林不能代替丛林等其他群系。");
        }
        deficit(missing, "不同分区", number(evidence, "distinctZones"), count, "个");
        deficit(missing, "有效行进", number(evidence, "distance"), target.minDistance(), "格");
        deficit(missing, "有效行进时间", number(evidence, "movingSeconds"), target.minSeconds(), "秒");
        deficit(missing, "内部区段", number(evidence, "distinctSections"), target.minParts(), "段");
        deficit(missing, "群系", evidence.has("biomes") ? evidence.getAsJsonArray("biomes").size() : 0, target.minBiomes(), "种");
        deficit(missing, "上下高差", number(evidence, "heightSpan"), target.minHeightSpan(), "格");
        String next = number(evidence, "heightSpan") < target.minHeightSpan()
                ? "沿可通行的上下通道探索不同高度，再走未经过的区域；不要只在同一层绕圈。"
                : "步行进入尚未走过的区域；站着等、重复原路和传送位移不补足行进证据。";
        if (target.goal() == GuildManager.Goal.STRUCTURE) next += "分区是同一座建筑内的" + target.zoneSize() + "格空间网格，不是多座建筑或固定打卡方块。";
        return phase(out, "survey", "正在记录实际探索；只需补齐下列缺项。", next);
    }
    private static Landmark nearest(ExplorationObjectives.Target t, JsonObject nav, List<Landmark> places, int x, int z) {
        String world = text(nav, "requiredDimension");
        return places.stream().filter(p -> p.world.equals(world) && t.keys().contains(p.structureKey))
                .min(Comparator.comparingDouble(p -> Math.hypot((double)p.x - x, (double)p.z - z))).orElse(null);
    }
    private static JsonObject phase(JsonObject out, String phase, String summary, String next) {
        out.addProperty("phase", phase); out.addProperty("summary", summary); out.addProperty("nextAction", next); return out;
    }
    private static void deficit(JsonArray out, String label, double current, int required, String unit) {
        if (current < required) out.add(label + "还缺" + (int)Math.ceil(required - current) + unit + "（" + current + "/" + required + "）");
    }
    private static boolean flag(JsonObject obj, String name) { return obj.has(name) && obj.get(name).getAsBoolean(); }
    private static String text(JsonObject obj, String name) { return obj.has(name) ? obj.get(name).getAsString() : ""; }
    private static double number(JsonObject obj, String name) { return obj.has(name) ? obj.get(name).getAsDouble() : 0; }
}
