package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Read saved harvest locations, never blocks/chunks. Does not create action evidence. */
final class ReplantGuidance {
    private ReplantGuidance() { }
    private record Site(String key, String world, int x, int y, int z) { }

    static JsonObject attach(JsonObject original, String crop, List<String> harvested,
                             List<String> counted, Map<String, String> worlds,
                             String currentWorld, double x, double y, double z) {
        if (original.get("ready").getAsBoolean()) return original;
        Set<String> seen = new HashSet<>(), done = new HashSet<>(counted);
        List<Site> pending = new ArrayList<>();
        // The persisted format is CROP:world-UUID:x:y:z. Unknown worlds remain
        // unknown; resolving them must not load a dimension or guess a location.
        for (String value : harvested.subList(0, Math.min(4096, harvested.size()))) {
            String[] fields = value.split(":", -1);
            if (fields.length != 5 || !fields[0].equals(crop)) continue;
            String key = value.substring(crop.length() + 1), world = worlds.get(fields[1]);
            if (world == null || done.contains(key) || !seen.add(key)) continue;
            try {
                int sx = Integer.parseInt(fields[2]), sy = Integer.parseInt(fields[3]), sz = Integer.parseInt(fields[4]);
                if (Math.abs((long) sx) > 30_000_000 || Math.abs((long) sz) > 30_000_000 || sy < -2048 || sy > 2048) continue;
                pending.add(new Site(key, world, sx, sy, sz));
            } catch (NumberFormatException ignored) { /* Keep malformed evidence untouched. */ }
        }
        pending.sort(Comparator.comparing((Site s) -> !s.world.equals(currentWorld))
                .thenComparingDouble(s -> distance(s, x, y, z)).thenComparing(Site::key));
        JsonObject out = original.deepCopy(); JsonArray targets = new JsonArray();
        for (Site site : pending.subList(0, Math.min(8, pending.size()))) {
            JsonObject row = new JsonObject(); row.addProperty("world", site.world);
            row.addProperty("x", site.x); row.addProperty("y", site.y); row.addProperty("z", site.z);
            targets.add(row);
        }
        out.add("replantTargets", targets); out.addProperty("pendingRecordedSites", pending.size());
        out.addProperty("targetsTruncated", pending.size() > targets.size());
        out.addProperty("targetSource", "saved_harvest_locations_not_live_block_inspection");
        out.addProperty("nextCommand", "/mycli tasks status");
        if (pending.isEmpty()) {
            out.addProperty("phase", "check_replant_record"); out.addProperty("reason", "REPLANT_LOCATIONS_UNAVAILABLE");
            out.addProperty("nextAction", "补种记录暂不能定位；请服主核对原收获位置。进度保留，别在别处反复种植或放弃重接。等待时可独立查看 arena status 或 dungeon list，不必接另一张公会委托。");
        } else {
            Site first = pending.getFirst();
            out.addProperty("phase", "return_to_harvested_plot");
            out.addProperty("nextAction", "回本单收获过的田格补种 " + crop + "，先去 " + first.world + "(" + first.x + "," + first.y + "," + first.z
                    + ")；这是作物格，耕地在正下方一格。只计进入本阶段后的实际补种；若已长出作物，等成熟再正常收获并补种，不拔幼苗刷数。其余原格见 replantTargets，已计数位置会移出；保护拒绝先查 protect，进度不清零。");
        }
        return out;
    }

    private static double distance(Site s, double x, double y, double z) {
        return (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) + (s.z - z) * (s.z - z);
    }
}
