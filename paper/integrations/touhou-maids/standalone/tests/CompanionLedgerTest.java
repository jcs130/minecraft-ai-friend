package local.qdj.maids.brain;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

public final class CompanionLedgerTest {
    private static int checks;
    private static void check(boolean yes) { if (!yes) throw new AssertionError("check " + (checks + 1)); checks++; }
    @FunctionalInterface interface Attempt { void run() throws Exception; }
    private static void reject(String reason, Attempt a) throws Exception {
        try { a.run(); throw new AssertionError("unexpected success: " + reason); }
        catch (IllegalArgumentException ex) { check(ex.getMessage().equals(reason)); }
    }
    public static void main(String[] args) throws Exception {
        Path dir = Path.of(args[0]); Files.createDirectories(dir);
        Path file = dir.resolve("ledger.json");
        var ledger = new CompanionLedger(file);
        UUID npc = UUID.randomUUID(), other = UUID.randomUUID(), player = UUID.randomUUID(), visitor = UUID.randomUUID();
        var p = new CompanionLedger.Point("minecraft:overworld", 10, 65, -8);
        var home = new CompanionLedger.Home(p, p, p, true, "ALL", "touhou_little_maid:attack");
        var e = ledger.recruit(npc, player, home, p, 10_000, 60_000);
        check(Files.exists(file)); check(ledger.party(player).getFirst().maid().equals(npc));
        check(ledger.recruit(npc, player, home, p, 20_000, 60_000).equals(e));
        check(ledger.recruit(npc, player, home, p, 20_000, 60_000).expiresAt() == 70_000);
        reject("companion_busy", () -> ledger.recruit(npc, visitor, home, p, 10_000, 60_000));
        var second = ledger.recruit(other, player, home, p, 10_000, 60_000);
        check(ledger.party(player).size() == 2 && !second.contract().equals(e.contract()));
        reject("cannot_follow_self", () -> ledger.recruit(visitor, visitor, home, p, 10_000, 60_000));
        reject("nested_party_not_supported", () -> ledger.recruit(visitor, npc, home, p, 10_000, 60_000));
        reject("nested_party_not_supported", () -> ledger.recruit(player, visitor, home, p, 10_000, 60_000));
        reject("not_your_companion", () -> ledger.order(npc, visitor, e.contract(), "stay", p, 10_001));
        reject("stale_contract", () -> ledger.order(npc, player, UUID.randomUUID(), "stay", p, 10_001));
        reject("invalid_order", () -> ledger.order(npc, player, e.contract(), "give_op", p, 10_001));
        var ordered = ledger.order(npc, player, e.contract(), "stay", p, 10_001);
        check(ordered.mode().equals("stay") && ordered.revision() > e.revision());
        var restarted = new CompanionLedger(file);
        check(restarted.get(npc).equals(ordered)); check(restarted.party(player).contains(ordered) && restarted.party(player).size() == 2);
        for (int i = 0; i < 50; i++) restarted.order(npc, player, e.contract(), "work", p, 10_002 + i);
        check(restarted.get(npc).history().size() == 32);
        var release = restarted.get(npc).change(null, "returning", p, 0, 10_100, "dismiss");
        restarted.put(release);
        check(restarted.party(player).size() == 1 && restarted.party(player).getFirst().equals(second));
        reject("companion_busy", () -> restarted.recruit(npc, visitor, home, p, 10_101, 60_000));
        restarted.put(release.change(null, "available", p, 0, 10_102, "returned"));
        var next = restarted.recruit(npc, visitor, home, p, 10_103, 60_000);
        check(!next.contract().equals(e.contract()));
        reject("not_your_companion", () -> restarted.order(npc, player, e.contract(), "work", p, 10_104));
        restarted.put(next.change(null, "dead", p, 0, 10_105, "died"));
        check(restarted.party(visitor).isEmpty());
        reject("companion_busy", () -> restarted.recruit(npc, player, home, p, 10_106, 60_000));
        var before = restarted.get(npc);
        Files.delete(file); Files.createDirectory(file); Files.writeString(file.resolve("blocker"), "fail atomically");
        try { restarted.put(before.change(null, "available", p, 0, 10_107, "returned")); throw new AssertionError("write succeeded"); }
        catch (java.io.IOException expected) { check(restarted.get(npc).equals(before)); }
        Path corrupt = dir.resolve("corrupt.json"); Files.writeString(corrupt, "{}");
        try { new CompanionLedger(corrupt); throw new AssertionError("accepted corrupt"); }
        catch (java.io.IOException expected) { checks++; }
        check(CompanionDecision.parse("{\"reply\":\"我在这里等你。\",\"action\":\"stay\",\"targetNpc\":null}", false).action().equals("stay"));
        for (String invalid : java.util.List.of("{}", "null", "[]", "{\"reply\":4,\"action\":\"stay\"}",
                "{\"reply\":\"好\",\"action\":null}", "{\"reply\":\"好\",\"action\":\"op\"}",
                "{\"reply\":\"好---坏\",\"action\":\"talk\"}", "{\"reply\":\"好\",\"action\":\"talk\",\"tools\":[]}",
                "{\"reply\":\"好\",\"action\":\"invite\",\"targetNpc\":\"" + npc + "\"}"))
            reject("invalid_npc_decision", () -> CompanionDecision.parse(invalid, false));
        check(CompanionDecision.parse("{\"reply\":\"一起出发吧\",\"action\":\"invite\",\"targetNpc\":\"" + npc + "\"}", true).targetNpc().equals(npc.toString()));
        var journal = new CompanionJournal(dir.resolve("journal"));
        UUID turn = UUID.randomUUID();
        journal.append(npc, turn, "result", java.util.Map.of("maidId", npc.toString(), "speakerId", player.toString(), "reply", "你好阿岚"));
        check(journal.recall(npc, player).size() == 1);
        check(journal.recall(npc, visitor).isEmpty() && journal.recall(other, player).isEmpty());
        try { journal.append(npc, turn, "result", java.util.Map.of("reply", "rewritten")); throw new AssertionError("evidence overwritten"); }
        catch (java.io.IOException expected) { checks++; }
        check(journal.recall(npc, player).getFirst().get("reply").equals("你好阿岚"));
        check(new CompanionJournal(dir.resolve("journal")).latest(npc, player).get("reply").equals("你好阿岚"));
        UUID interrupted = UUID.randomUUID();
        journal.append(npc, interrupted, "request", java.util.Map.of("id", interrupted.toString(), "maidId", npc.toString(), "speakerId", visitor.toString()));
        check(journal.latest(npc, visitor).get("status").equals("unknown"));
        check(journal.latest(other, visitor) == null);
        System.out.println("Companion ledger checks passed: " + checks);
    }
}
