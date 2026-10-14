package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

public final class ProtectionQueryTest {
    private static int checks;
    private static void check(String title, boolean ok) { if (!ok) throw new AssertionError(title); checks++; }
    private static ProtectionQuery.Request parse(String args) { return ProtectionQuery.parse(("protect " + args).split(" +")); }
    private static void invalid(String args) { try { parse(args); throw new AssertionError("Accepted " + args); } catch (IllegalArgumentException expected) { checks++; } }
    private static JsonObject result(int x, String status, String reason, String owner) {
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1); out.addProperty("readOnly", true);
        out.addProperty("world", "minecraft:overworld"); out.addProperty("action", "break");
        out.addProperty("x", x); out.addProperty("y", 64); out.addProperty("z", 10);
        out.addProperty("status", status); out.addProperty("reason", reason);
        out.add("allowed", status.equals("unknown") ? JsonNull.INSTANCE : new JsonPrimitive(status.equals("allow_likely")));
        if (owner != null) out.addProperty("owner", owner);
        if (status.equals("deny")) {
            JsonArray areas = new JsonArray();
            areas.add(JsonParser.parseString("{\"id\":\"house\",\"name\":\"村屋\",\"world\":\"minecraft:overworld\",\"min\":[0,60,0],\"max\":[10,70,10],\"shape\":\"structure_mask_envelope\",\"inclusive\":true,\"envelopeOnly\":true}"));
            out.add("areas", areas); out.addProperty("nextAction", "完整的保护说明。".repeat(40));
            JsonArray commands = new JsonArray(); commands.add("/mycli land here"); out.add("nextCommands", commands);
        }
        return out;
    }
    public static void main(String[] args) {
        for (String action : List.of("break", "place", "container", "use")) {
            var q = parse(action + " -1 64 0 --json");
            check("legacy " + action, !q.batch() && q.json() && q.action().equals(action) && q.points().getFirst().x() == -1);
        }
        var flags = parse("--json batch break --verbose 1,64,10 2,64,10 1,64,10");
        check("order-preserving deduplication", flags.batch() && flags.json() && flags.verbose() && flags.requested() == 3 && flags.points().size() == 2 && flags.points().get(1).x() == 2);
        var box = parse("batch place --box 3 65 12 0 64 10");
        check("inclusive normalized box", box.points().size() == 24 && box.min().equals(new ProtectionQuery.Point(0, 64, 10)) && box.max().equals(new ProtectionQuery.Point(3, 65, 12)));
        check("x-fastest box ordering", box.points().get(3).equals(new ProtectionQuery.Point(3, 64, 10)) && box.points().get(4).equals(new ProtectionQuery.Point(0, 64, 11)) && box.points().get(12).equals(new ProtectionQuery.Point(0, 65, 10)));
        check("box exactly 64", parse("batch break --box 0 64 0 7 64 7").points().size() == 64);
        check("int max box terminates", parse("batch break --box 2147483647 0 0 2147483647 0 0").points().size() == 1);
        for (String bad : List.of("", "break 1 2", "break 1.2 2 3", "break ~1 2 3", "break 1 2 2147483648", "give 1 2 3", "batch break", "batch break 1,2", "batch break 1,2,3,4", "batch break 1,,3", "batch break --box 0 0 0 1 1", "batch break --box 0 0 0 64 0 0", "batch break --box -2147483648 -2147483648 -2147483648 2147483647 2147483647 2147483647", "batch break 1,2,3 --bogus", "batch break 1,2,3 --json --json", "batch break 1,2,3 --verbose --verbose", "break 1 2 3 --box")) invalid(bad);
        invalid("batch break " + "1,2,3 ".repeat(65));
        var a = result(1, "deny", "village_structure", "Alice"); var b = result(2, "deny", "village_structure", "Alice");
        var allowed = result(3, "allow_likely", "no_known_protection", null); var unknown = result(4, "unknown", "unknown_out_of_range", null);
        var other = result(5, "deny", "village_structure", "Bob");
        var query = parse("batch break 1,64,10 2,64,10 3,64,10 4,64,10 5,64,10 6,64,10");
        List<JsonObject> raw = List.of(a, b, allowed, unknown, other, result(6, "deny", "village_structure", "Alice"));
        String before = raw.toString(); var batch = ProtectionQuery.batch(query, "minecraft:overworld", raw);
        check("no input mutation", before.equals(raw.toString()));
        check("same policy groups, owner remains distinct", batch.getAsJsonArray("groups").size() == 4);
        check("areas stored once", batch.getAsJsonArray("areas").size() == 1);
        check("mask envelope stays explicit", batch.getAsJsonArray("areas").get(0).getAsJsonObject().get("envelopeOnly").getAsBoolean());
        check("mixed verdict counts", batch.getAsJsonObject("counts").toString().equals("{\"allow_likely\":1,\"deny\":4,\"unknown\":1}"));
        check("gapped indices are lossless", batch.getAsJsonArray("groups").get(0).getAsJsonObject().get("indices").toString().equals("[[0,1],[5,5]]"));
        Set<Integer> covered = new HashSet<>();
        for (var groupValue : batch.getAsJsonArray("groups")) {
            var group = groupValue.getAsJsonObject();
            for (var rangeValue : group.getAsJsonArray("indices")) {
                var range = rangeValue.getAsJsonArray();
                for (int i = range.get(0).getAsInt(); i <= range.get(1).getAsInt(); i++)
                    check("every index has exactly the actual result", covered.add(i) && raw.get(i).get("status").equals(group.get("status")) && raw.get(i).get("allowed").equals(group.get("allowed")));
            }
        }
        check("every target covered", covered.size() == raw.size());
        var compact = ProtectionQuery.compact(a);
        check("single receipt is short but has real next step", compact.toString().length() < a.toString().length() * .7 && compact.has("nextAction") && !compact.has("areas") && compact.has("detailCommand"));
        check("full original still has all rules", a.has("areas") && a.get("nextAction").getAsString().length() > 200);
        var verbose = ProtectionQuery.batch(parse("batch break 1,64,10 2,64,10 --verbose"), "minecraft:overworld", List.of(a, b));
        check("verbose includes original guidance once", verbose.getAsJsonArray("groups").size() == 1 && verbose.getAsJsonArray("groups").get(0).getAsJsonObject().get("nextAction").equals(a.get("nextAction")));
        var changedBoundary = b.deepCopy(); changedBoundary.getAsJsonArray("areas").get(0).getAsJsonObject().addProperty("envelopeOnly", false);
        check("different boundary semantics are not merged", ProtectionQuery.batch(parse("batch break 1,64,10 2,64,10"), "minecraft:overworld", List.of(a, changedBoundary)).getAsJsonArray("groups").size() == 2);
        var otherWorld = b.deepCopy(); otherWorld.addProperty("world", "minecraft:the_nether");
        check("notice keys separate dimensions", !ProtectionQuery.policy(a).equals(ProtectionQuery.policy(otherWorld)));
        var otherAction = b.deepCopy(); otherAction.addProperty("action", "place");
        check("notice keys separate actions", !ProtectionQuery.policy(a).equals(ProtectionQuery.policy(otherAction)));
        var large = a.deepCopy(); large.addProperty("nextAction", "复杂保护说明😀。".repeat(1800));
        var largeBatch = ProtectionQuery.batch(parse("batch break 1,64,10 --verbose"), "minecraft:overworld", List.of(large));
        var pages = AgentReplyPages.pack(List.of(largeBatch)); StringBuilder restored = new StringBuilder();
        for (var page : pages) for (var item : page.items()) {
            var row = item.getAsJsonObject(); if (row.has("encoding") && row.get("encoding").getAsString().equals("json_fragment")) restored.append(row.get("data").getAsString());
        }
        check("large aggregate pages preserve exact JSON and Unicode", largeBatch.equals(JsonParser.parseString(restored.toString())) && pages.size() > 1);
        try { ProtectionQuery.batch(query, "minecraft:overworld", List.of(a)); throw new AssertionError("Missing targets accepted"); } catch (IllegalArgumentException expected) { checks++; }
        List<JsonObject> many = new ArrayList<>(); var sixtyFour = parse("batch break --box 0 64 0 7 64 7");
        for (var point : sixtyFour.points()) { var r = a.deepCopy(); r.addProperty("x", point.x()); r.addProperty("z", point.z()); many.add(r); }
        int fullChars = many.toString().length(), batchChars = ProtectionQuery.batch(sixtyFour, "minecraft:overworld", many).toString().length();
        check("64 repeated rules collapse by at least 90 percent", batchChars < fullChars / 10);

        var limiter = new ProtectionNotices(); UUID p = UUID.randomUUID(), q = UUID.randomUUID();
        check("first automatic denial emits", limiter.allow(p, a.deepCopy(), 10000));
        check("neighbour with same policy is coalesced", !limiter.allow(p, b.deepCopy(), 10100));
        check("same-coordinate repeat coalesced", !limiter.allow(p, a.deepCopy(), 14999));
        check("changed owner emits immediately", limiter.allow(p, other.deepCopy(), 10200));
        check("changed reason emits immediately", limiter.allow(p, unknown.deepCopy(), 10300));
        check("changed bounds emit immediately", limiter.allow(p, changedBoundary.deepCopy(), 10400));
        check("other player isolated", limiter.allow(q, a.deepCopy(), 10100));
        var after = b.deepCopy(); check("window ends with count", limiter.allow(p, after, 15000) && after.get("suppressedNotices").getAsInt() == 2);
        check("window metadata does not defeat dedup", !limiter.allow(p, a.deepCopy(), 15001));
        limiter.forget(p); check("reconnect forgets notices", limiter.allow(p, a.deepCopy(), 15002));
        limiter.clear(); check("stop clears notices", limiter.allow(q, a.deepCopy(), 15003));
        check("clock regression cannot silence feedback", limiter.allow(q, a.deepCopy(), 1));
        var help = AgentCliCatalog.helpData(new String[]{"protect", "batch", "--help"}, List.of());
        check("batch discoverable, read only and JSON-capable", help.get("actionReadOnly").getAsBoolean() && help.get("jsonSupported").getAsBoolean() && help.get("summary").getAsString().contains("--box"));
        System.out.println("PASS " + checks + " protection checks; 64-target chars " + fullChars + " -> " + batchChars);
    }
}
