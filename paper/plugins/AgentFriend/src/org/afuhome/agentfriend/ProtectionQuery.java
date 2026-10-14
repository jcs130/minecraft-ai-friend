package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Transport-only protection queries. No cached verdicts, world loads or permissions. */
final class ProtectionQuery {
    static final int MAX_TARGETS = 64;
    static final Set<String> ACTIONS = Set.of("break", "place", "container", "use");
    record Point(int x, int y, int z) {
        JsonArray json() { JsonArray a = new JsonArray(); a.add(x); a.add(y); a.add(z); return a; }
    }
    record Request(String action, List<Point> points, boolean batch, boolean json, boolean verbose,
                   int requested, Point min, Point max) {
        JsonObject targets() {
            JsonObject out = new JsonObject();
            if (min != null) {
                out.addProperty("encoding", "box"); out.add("min", min.json()); out.add("max", max.json());
                out.addProperty("order", "y,z,x"); // x advances fastest; indices are zero-based.
            } else {
                out.addProperty("encoding", "points"); JsonArray values = new JsonArray();
                points.forEach(p -> values.add(p.json())); out.add("points", values);
            }
            return out;
        }
    }
    static Request parse(String[] raw) {
        List<String> args = new ArrayList<>(); boolean json = false, verbose = false;
        for (int i = 1; i < raw.length; i++) {
            String s = raw[i];
            if (s.equals("--json")) { if (json) throw invalid(); json = true; }
            else if (s.equals("--verbose")) { if (verbose) throw invalid(); verbose = true; }
            else args.add(s);
        }
        boolean batch = !args.isEmpty() && args.getFirst().equalsIgnoreCase("batch");
        if (batch) args.removeFirst();
        if (args.isEmpty()) throw invalid();
        String action = args.removeFirst().toLowerCase(Locale.ROOT);
        if (!ACTIONS.contains(action)) throw invalid();
        List<Point> points = new ArrayList<>(); Point min = null, max = null;
        if (!batch) {
            if (args.size() != 3) throw invalid(); points.add(point(args, 0));
        } else if (!args.isEmpty() && args.getFirst().equals("--box")) {
            if (args.size() != 7) throw invalid(); Point a = point(args, 1), b = point(args, 4);
            min = new Point(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
            max = new Point(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
            long nx = (long)max.x - min.x + 1, ny = (long)max.y - min.y + 1, nz = (long)max.z - min.z + 1;
            if (nx > MAX_TARGETS || ny > MAX_TARGETS || nz > MAX_TARGETS || nx * ny * nz > MAX_TARGETS) throw tooMany();
            for (int y = 0; y < ny; y++) for (int z = 0; z < nz; z++) for (int x = 0; x < nx; x++)
                points.add(new Point(min.x + x, min.y + y, min.z + z));
        } else {
            if (args.isEmpty()) throw invalid(); if (args.size() > MAX_TARGETS) throw tooMany();
            for (String value : args) {
                String[] xyz = value.split(",", -1); if (xyz.length != 3) throw invalid();
                points.add(point(Arrays.asList(xyz), 0));
            }
        }
        int requested = points.size();
        return new Request(action, List.copyOf(new LinkedHashSet<>(points)), batch, json, verbose, requested, min, max);
    }
    private static Point point(List<String> args, int offset) {
        try { return new Point(Integer.parseInt(args.get(offset)), Integer.parseInt(args.get(offset + 1)), Integer.parseInt(args.get(offset + 2))); }
        catch (NumberFormatException invalid) { throw invalid(); }
    }
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("参数有误；坐标须为绝对整数，批量点用 x,y,z，范围用 --box x1 y1 z1 x2 y2 z2。请查 /mycli protect --help。"); }
    private static IllegalArgumentException tooMany() { return new IllegalArgumentException("一次最多查询64个方块；请缩小范围或拆成小批次。"); }

    static String detailCommand(JsonObject data) {
        String action = switch (data.get("action").getAsString()) {
            case "place", "bucket", "fertilize" -> "place";
            case "container", "inventory" -> "container";
            case "use", "interact" -> "use";
            default -> "break";
        };
        return "/mycli protect " + action + " " + data.get("x") + " " + data.get("y") + " " + data.get("z") + " --verbose --json";
    }
    static String nextAction(JsonObject data) {
        String reason = data.get("reason").getAsString();
        if (reason.startsWith("unknown_")) return data.has("nextAction") ? data.get("nextAction").getAsString() : "权限未知，暂缓操作并重新查询。";
        if (reason.endsWith("unavailable") || data.has("boundsIncomplete")) return "权限数据未就绪，停止操作并联系服主。";
        if (reason.equals("no_known_protection")) return "可尝试操作；最终以实际操作结果为准。";
        if (reason.equals("land_notice_board")) return "右键公告牌查看归属和协作者；位置调整请联系服主。";
        if (Set.of("generated_structure", "village_structure", "life_guild_building").contains(reason)) return "沿原有门、楼梯或梯子通行；施工换目标后重查权限。";
        if (data.has("publicCommand")) return "私产需主人授权；公共物资用 /mycli guild shared。";
        if (data.has("globalProtection") && data.get("globalProtection").getAsBoolean()) return "当前世界有全局限制，请联系服主确认允许的位置或授权。";
        return "停止操作；取得主人授权或更换目标后重新查询。";
    }
    static JsonObject compact(JsonObject full) {
        JsonObject out = full.deepCopy();
        for (String key : List.of("areas", "actionLabel", "nextCommands", "boundaryInclusive")) out.remove(key);
        if (full.has("areas")) {
            JsonArray ids = new JsonArray(); for (JsonElement area : full.getAsJsonArray("areas")) ids.add(area.getAsJsonObject().get("id"));
            if (!ids.isEmpty()) out.add("areaIds", ids);
        }
        out.addProperty("nextAction", nextAction(full)); out.addProperty("detailCommand", detailCommand(full));
        out.addProperty("detailAvailable", true); return out;
    }
    /** Equality includes every effective rule/owner/boundary, not just the reason or an envelope. */
    static JsonObject policy(JsonObject full) {
        JsonObject out = full.deepCopy();
        for (String key : List.of("x", "y", "z", "schemaVersion", "kind", "readOnly", "sessionId", "sequence", "observedAt",
                "suppressedNotices", "noticeWindowMs", "detailCommand", "detailAvailable")) out.remove(key);
        return out;
    }
    static JsonObject batch(Request query, String world, List<JsonObject> results) {
        if (results.size() != query.points.size()) throw new IllegalArgumentException("Missing protection verdicts");
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1); out.addProperty("kind", "protection_batch");
        out.addProperty("readOnly", true); out.addProperty("action", query.action); out.addProperty("world", world);
        out.addProperty("requested", query.requested); out.addProperty("total", results.size()); out.add("targets", query.targets());
        Map<JsonObject, List<Integer>> groups = new LinkedHashMap<>(); Map<String, Integer> totals = new LinkedHashMap<>();
        for (String status : List.of("allow_likely", "deny", "unknown")) totals.put(status, 0);
        for (int i = 0; i < results.size(); i++) {
            JsonObject result = results.get(i); String status = result.get("status").getAsString();
            if (!totals.containsKey(status)) throw new IllegalArgumentException("Invalid protection verdict");
            totals.put(status, totals.get(status) + 1); groups.computeIfAbsent(policy(result), ignored -> new ArrayList<>()).add(i);
        }
        JsonObject counts = new JsonObject(); totals.forEach(counts::addProperty); out.add("counts", counts);
        // Area definitions occur once, even when rules overlap or actions vary by target.
        Map<JsonObject, Integer> areaIndices = new LinkedHashMap<>(); JsonArray areas = new JsonArray(), rows = new JsonArray();
        for (var group : groups.entrySet()) {
            JsonObject original = results.get(group.getValue().getFirst());
            JsonObject row = query.verbose ? group.getKey().deepCopy() : compact(original);
            for (String key : List.of("x", "y", "z", "world", "action", "schemaVersion", "kind", "readOnly", "areas", "areaIds")) row.remove(key);
            JsonArray refs = new JsonArray();
            if (original.has("areas")) for (JsonElement value : original.getAsJsonArray("areas")) {
                JsonObject area = value.getAsJsonObject(); Integer index = areaIndices.get(area);
                if (index == null) { index = areaIndices.size(); areaIndices.put(area, index); areas.add(area.deepCopy()); }
                refs.add(index);
            }
            if (!refs.isEmpty()) row.add("areas", refs);
            row.addProperty("count", group.getValue().size()); row.add("indices", ranges(group.getValue())); rows.add(row);
        }
        out.addProperty("indexBase", 0); out.addProperty("indicesInclusive", true);
        out.add("areas", areas); out.add("groups", rows); out.addProperty("complete", true);
        return out;
    }
    private static JsonArray ranges(List<Integer> indices) {
        JsonArray ranges = new JsonArray(); int start = indices.getFirst(), last = start;
        for (int i = 1; i <= indices.size(); i++) {
            if (i < indices.size() && indices.get(i) == last + 1) { last++; continue; }
            JsonArray pair = new JsonArray(); pair.add(start); pair.add(last); ranges.add(pair);
            if (i < indices.size()) start = last = indices.get(i);
        }
        return ranges;
    }
}
