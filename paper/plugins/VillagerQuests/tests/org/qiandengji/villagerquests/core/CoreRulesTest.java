package org.qiandengji.villagerquests.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Policy, evidence, reward-ledger, parser and spool rules without a server. Plain {@code main} like the repo's
 * other Java rule tests. Usage: {@code java -cp classes:gson.jar ...CoreRulesTest [path/to/villager_quest.schema.json]}.
 */
public final class CoreRulesTest {
    private static int checks;
    private static final String HERO = "6f0c1d2e-3a4b-4c5d-8e9f-001122334455";
    private static final String ALICE = "00000000-0000-4000-8000-00000000000a";
    private static final String BOB = "00000000-0000-4000-8000-00000000000b";
    private static final long T0 = 1_800_000_000_000L, MIN = 60_000L;

    public static void main(String[] args) throws Exception {
        text();
        parser();
        policyCaps();
        acceptAbandon();
        evidenceRules();
        rewardsIdempotent();
        heroFlow();
        persistence();
        spool();
        questIdMatchesBridge();
        llmRequest();
        if (args.length > 0) schemaCompat(Path.of(args[0]));
        System.out.println("checks=" + checks + " passed=true");
    }

    static void ok(boolean cond, String what) {
        checks++;
        if (!cond) throw new AssertionError(what);
    }

    static String violation(ThrowingRunnable r) {
        try { r.run(); return null; } catch (Policy.Violation v) { return v.code; } catch (Exception e) { return "exception:" + e; }
    }

    interface ThrowingRunnable { void run() throws Exception; }

    static Policy policy() {
        return Policy.fromJson(JsonParser.parseString("""
            {"villagers": {"qinghe": {"name": "麦田的青禾", "npcId": "7", "types": ["slay", "gather", "reach"], "maxOpen": 2, "dailyQuota": 3},
                           "alan": {"name": "旅人阿岚", "types": ["gather"], "maxOpen": 1, "dailyQuota": 1}},
             "targets": {"slay": ["minecraft:zombie", "minecraft:skeleton"], "gather": ["minecraft:wheat"]},
             "maxQuantity": {"easy": 5, "normal": 10, "hard": 20},
             "rewards": {"easy": {"emeralds": 2, "vortexXp": 20, "fame": 2}, "normal": {"emeralds": 4, "vortexXp": 50, "fame": 4}, "hard": {"emeralds": 8, "vortexXp": 120, "fame": 8}},
             "deadlineMinutes": {"min": 10, "max": 1440}, "maxOpenTotal": 3, "maxActivePerPlayer": 1}""").getAsJsonObject());
    }

    static final Area FIELD = new Area("world", -547, 67, -445, 32);

    static Commission slay(String id, int qty) {
        return new Commission(id, "qinghe", QuestType.SLAY, "minecraft:zombie", qty, FIELD, "easy", 60, "麦田边的夜客", "昨夜有僵尸");
    }

    static Commission gather(String id, String issuer) {
        return new Commission(id, issuer, QuestType.GATHER, "minecraft:wheat", 5, null, "easy", 60, "缺些小麦", "");
    }

    static Board board() { return new Board(policy(), List.of(HERO)); }

    static Board.Evidence kill(String id, String actor, double x, long at) {
        return new Board.Evidence(id, Board.EvidenceKind.KILL, actor, "minecraft:zombie", "world", x, 67, -445, 1, at, null);
    }

    // ---------------------------------------------------------------------------------------------------
    static void text() {
        ok(Text.clean("&a&l讨伐§c僵尸<red>!</red>", 40).equals("讨伐僵尸!"), "color and MiniMessage codes removed");
        ok(Text.clean("/op Steve", 40).equals("op Steve"), "leading slash removed");
        ok(Text.clean(" //  &a/give @p diamond 64", 40).equals("give @p diamond 64"), "slash after color code removed too");
        ok(Text.clean("&&aa红", 40).equals("红"), "nested color trick removed");
        ok(Text.clean("&#ff0000红§x§f§f§0§0§0§0色", 40).equals("红色"), "hex colors removed");
        ok(Text.clean("第一行\n/第二行\u0000", 40).equals("第一行 /第二行"), "control chars collapse; only a leading slash matters");
        ok(Text.clean("一二三四五六", 4).equals("一二三四"), "length cap by code point");
        ok(Text.clean("😀😀😀", 2).equals("😀😀"), "surrogate pairs not split");
    }

    static void parser() {
        ok(StoryParser.parse("{\"title\":\"麦田边的夜客\",\"story\":\"僵尸踩坏了麦田\"}").orElseThrow().title().equals("麦田边的夜客"), "plain JSON");
        ok(StoryParser.parse("[委托]{\"title\":\"夜客\",\"story\":\"请帮忙巡夜\"}").isPresent(), "[委托] prefix tolerated");
        ok(StoryParser.parse("{\"title\":\"夜客\"}").isEmpty(), "missing story rejected");
        ok(StoryParser.parse("{\"title\":\"夜客\",\"story\":\"   \"}").isEmpty(), "blank story rejected");
        ok(StoryParser.parse("{\"title\":\"夜客\",\"story\":\"请巡夜\",\"title\":\"另一任务\"}").isEmpty(), "duplicate keys rejected");
        ok(StoryParser.parse("```json\n{\"title\":\"夜客\",\"story\":\"x\"}\n```").isPresent(), "one code fence tolerated");
        ok(StoryParser.parse("{\"title\":\"夜客\",\"reward\":{\"emeralds\":64}}").isEmpty(), "reward key rejects the reply");
        ok(StoryParser.parse("{\"title\":\"夜客\",\"quantity\":64}").isEmpty(), "quantity key rejects the reply");
        ok(StoryParser.parse("好的！{\"title\":\"夜客\"}").isEmpty(), "prose around JSON rejected");
        ok(StoryParser.parse("{\"title\":\"a\"}{\"title\":\"b\"}").isEmpty(), "two objects rejected");
        ok(StoryParser.parse("{title:'夜客'}").isEmpty(), "lenient JSON rejected");
        ok(StoryParser.parse("{\"title\":123}").isEmpty(), "non-string title rejected");
        ok(StoryParser.parse("{\"title\":\"&a&l\"}").isEmpty(), "title empty after cleaning rejected");
        ok(StoryParser.parse("{\"title\":\"/op me\",\"story\":\"<click:run_command:/op me>点我</click>\"}").orElseThrow().title().equals("op me"), "slash stripped");
        ok(!StoryParser.parse("{\"title\":\"t\",\"story\":\"<click:run_command:/op me>点我</click>\"}").orElseThrow().story().contains("<"), "MiniMessage tags stripped");
        ok(StoryParser.parse(null).isEmpty() && StoryParser.parse("x".repeat(5000)).isEmpty(), "null / oversize rejected");
        StoryParser.Story f = Templates.fallback(slay("qinghe-x-0001", 3), "麦田的青禾", "夜里来了怪物");
        ok(f.title().equals("驱赶僵尸") && f.story().contains("讨伐 3 只僵尸"), "fallback template");
    }

    static void policyCaps() throws Exception {
        Board b = board();
        b.post(slay("qinghe-0001", 3), T0);
        Board.Quest again = b.post(slay("qinghe-0001", 3), T0 + 1);
        ok(again == b.get(Board.questId("qinghe-0001")) && b.openCount("qinghe") == 1, "same commissionId is idempotent");
        b.post(gather("qinghe-0002", "qinghe"), T0);
        ok("issuer_open_limit".equals(violation(() -> b.post(slay("qinghe-0003", 3), T0))), "per-villager open cap");
        b.post(gather("alan-0001", "alan"), T0);
        Board b2 = board();
        ok("global_open_limit".equals(violation(() -> {
            b2.post(slay("qinghe-a", 1), T0); b2.post(slay("qinghe-b", 1), T0); b2.post(gather("alan-a", "alan"), T0);
            b2.cancel(Board.questId("alan-a"));
            b2.post(gather("alan-b", "alan"), T0);
        })) == false, "cancelled frees the global slot but daily quota still counts");
        ok("daily_quota".equals(violation(() -> b2.post(gather("alan-b", "alan"), T0))), "alan's 24h quota (1) used");
        ok(violation(() -> {
            Board b3 = board(); b3.post(gather("alan-c", "alan"), T0); b3.cancel(Board.questId("alan-c"));
            b3.post(gather("alan-d", "alan"), T0 + 24 * 60 * MIN + 1);
        }) == null, "quota is a rolling 24 h window");
        Board b4 = board();
        b4.post(slay("qinghe-g1", 1), T0); b4.post(slay("qinghe-g2", 1), T0); b4.post(gather("alan-g", "alan"), T0);
        ok("issuer_open_limit".equals(violation(() -> b4.post(slay("qinghe-g3", 1), T0))), "issuer cap checked before global");
        Board b5 = new Board(Policy.fromJson(JsonParser.parseString("""
            {"villagers": {"a": {"name": "A", "types": ["slay"], "maxOpen": 5, "dailyQuota": 9}, "b": {"name": "B", "types": ["slay"], "maxOpen": 5, "dailyQuota": 9}},
             "targets": {"slay": ["minecraft:zombie"]}, "rewards": {"easy": {"emeralds": 1}}, "maxOpenTotal": 1}""").getAsJsonObject()), List.of());
        b5.post(new Commission("a-0001", "a", QuestType.SLAY, "minecraft:zombie", 1, FIELD, "easy", 60, "t", ""), T0);
        ok("global_open_limit".equals(violation(() -> b5.post(new Commission("b-0001", "b", QuestType.SLAY, "minecraft:zombie", 1, FIELD, "easy", 60, "t", ""), T0))), "global open cap");
        Board b6 = board();
        ok("target_not_allowed".equals(violation(() -> b6.post(new Commission("qinghe-t1", "qinghe", QuestType.SLAY, "minecraft:wither", 1, FIELD, "easy", 60, "t", ""), T0))), "target whitelist");
        ok("quantity_over_limit".equals(violation(() -> b6.post(slay("qinghe-t2", 6), T0))), "easy max 5");
        ok("deadline_out_of_range".equals(violation(() -> b6.post(new Commission("qinghe-t3", "qinghe", QuestType.SLAY, "minecraft:zombie", 1, FIELD, "easy", 5, "t", ""), T0))), "deadline bounds");
        ok("area_required".equals(violation(() -> b6.post(new Commission("qinghe-t4", "qinghe", QuestType.SLAY, "minecraft:zombie", 1, null, "easy", 60, "t", ""), T0))), "slay needs area");
        ok("type_not_allowed".equals(violation(() -> b6.post(new Commission("alan-t5", "alan", QuestType.SLAY, "minecraft:zombie", 1, FIELD, "easy", 60, "t", ""), T0))), "villager type whitelist");
        ok("unknown_issuer".equals(violation(() -> b6.post(new Commission("ghost-t6", "ghost", QuestType.GATHER, "minecraft:wheat", 1, null, "easy", 60, "t", ""), T0))), "unknown villager");
        ok(violation(() -> new Commission("x", "qinghe", QuestType.SLAY, "minecraft:zombie", 1, FIELD, "easy", 60, "t", "")).startsWith("exception"), "short commissionId rejected");
        ok(violation(() -> new Commission("qinghe-t7", "qinghe", QuestType.SLAY, "Minecraft:Zombie", 1, FIELD, "easy", 60, "t", "")).startsWith("exception"), "target pattern");
    }

    static void acceptAbandon() throws Exception {
        Board b = board();
        Board.Quest q = b.post(slay("qinghe-acc1", 3), T0);
        Board.Quest q2 = b.post(gather("qinghe-acc2", "qinghe"), T0);
        b.accept(q.id, ALICE, "Alice", T0 + MIN);
        ok(q.status == Board.Status.ACCEPTED && ALICE.equals(q.assignee), "player accepts");
        ok("not_open".equals(violation(() -> b.accept(q.id, BOB, "Bob", T0 + MIN))), "second player cannot take it");
        ok("player_limit".equals(violation(() -> b.accept(q2.id, ALICE, "Alice", T0 + MIN))), "per-player active cap");
        ok("hero_uses_bridge".equals(violation(() -> b.accept(q2.id, HERO, "桐人", T0 + MIN))), "hero bodies use the bridge, not /vq");
        ok("not_yours".equals(violation(() -> b.abandon(q.id, BOB))), "only the assignee abandons");
        b.evidence(kill("vqk-a1", ALICE, -540, T0 + 2 * MIN));
        ok(q.progress == 1, "progress before abandon");
        b.abandon(q.id, ALICE);
        ok(q.status == Board.Status.OPEN && q.progress == 0 && q.assignee == null, "abandon puts it back on the board");
        b.accept(q.id, BOB, "Bob", T0 + 3 * MIN);
        ok("duplicate".equals(b.evidence(kill("vqk-a1", BOB, -540, T0 + 4 * MIN)).code()), "evidence spent before abandon is not reusable");
        ok("expired".equals(violation(() -> b.accept(q2.id, BOB, "Bob", T0 + 61 * MIN))) || "player_limit".equals(violation(() -> b.accept(q2.id, BOB, "Bob", T0 + 61 * MIN))), "late accept refused");
        Board b2 = board();
        Board.Quest late = b2.post(slay("qinghe-late", 1), T0);
        ok("expired".equals(violation(() -> b2.accept(late.id, ALICE, "Alice", T0 + 60 * MIN))), "accept at deadline refused");
    }

    static void evidenceRules() throws Exception {
        Board b = board();
        Board.Quest q = b.post(slay("qinghe-ev1", 3), T0);
        ok("no_match".equals(b.evidence(kill("vqk-0", ALICE, -540, T0 + MIN)).code()), "nothing counts before accept");
        b.accept(q.id, ALICE, "Alice", T0 + 2 * MIN);
        ok("no_match".equals(b.evidence(kill("vqk-early", ALICE, -540, T0 + MIN)).code()), "event older than acceptance ignored");
        ok("no_match".equals(b.evidence(kill("vqk-1", BOB, -540, T0 + 3 * MIN)).code()), "other player's kill ignored");
        ok("no_match".equals(b.evidence(kill("vqk-2", ALICE, -400, T0 + 3 * MIN)).code()), "kill outside area ignored");
        ok("no_match".equals(b.evidence(new Board.Evidence("vqk-3", Board.EvidenceKind.KILL, ALICE, "minecraft:zombie", "world_nether", -540, 67, -445, 1, T0 + 3 * MIN, null)).code()), "other world ignored");
        ok("no_match".equals(b.evidence(new Board.Evidence("vqk-4", Board.EvidenceKind.KILL, ALICE, "minecraft:skeleton", "world", -540, 67, -445, 1, T0 + 3 * MIN, null)).code()), "wrong target ignored");
        ok("counted".equals(b.evidence(kill("vqk-5", ALICE, -540, T0 + 3 * MIN)).code()), "valid kill counted");
        ok("duplicate".equals(b.evidence(kill("vqk-5", ALICE, -540, T0 + 3 * MIN)).code()) && q.progress == 1, "same evidence id counts once");
        ok("no_match".equals(b.evidence(kill("vqk-6", ALICE, -540, T0 + 61 * MIN)).code()), "after deadline ignored");
        b.evidence(kill("vqk-7", ALICE, -540, T0 + 4 * MIN));
        Board.Outcome done = b.evidence(kill("vqk-8", ALICE, -540, T0 + 5 * MIN));
        ok(done.completed() && q.status == Board.Status.COMPLETED && q.progress == 3, "completes at quantity");
        ok("no_match".equals(b.evidence(kill("vqk-9", ALICE, -540, T0 + 6 * MIN)).code()), "completed quest takes no more evidence");

        Board g = board();
        Board.Quest gq = g.post(gather("qinghe-ev2", "qinghe"), T0);
        g.accept(gq.id, ALICE, "Alice", T0);
        Board.Evidence wrongVillager = new Board.Evidence("vqd-1", Board.EvidenceKind.DELIVER, ALICE, "minecraft:wheat", "world", 0, 0, 0, 3, T0 + MIN, "alan");
        ok("no_match".equals(g.evidence(wrongVillager).code()), "delivery to another villager ignored");
        Board.Outcome part = g.evidence(new Board.Evidence("vqd-2", Board.EvidenceKind.DELIVER, ALICE, "minecraft:wheat", "world", 0, 0, 0, 3, T0 + MIN, "qinghe"));
        ok(part.counted() == 3 && gq.progress == 3, "partial delivery");
        Board.Outcome over = g.evidence(new Board.Evidence("vqd-3", Board.EvidenceKind.DELIVER, ALICE, "minecraft:wheat", "world", 0, 0, 0, 64, T0 + MIN, "qinghe"));
        ok(over.completed() && over.counted() == 2, "only the remaining amount is counted (caller removes only that many items)");

        Board r = board();
        Board.Quest rq = r.post(new Commission("qinghe-reach", "qinghe", QuestType.REACH, "qiandengji:place", 1, new Area("world", 100, 64, 100, 5), "easy", 30, "看一眼", ""), T0);
        ok(!rq.commission.type().heroCapable() && "type_not_for_heroes".equals(violation(() -> r.handoff(rq.id, T0))), "reach is players-only");
        r.accept(rq.id, BOB, "Bob", T0);
        ok("no_match".equals(r.evidence(new Board.Evidence("vqr-x", Board.EvidenceKind.REACH, BOB, "qiandengji:place", "world", 120, 64, 100, 1, T0 + MIN, null)).code()), "not there yet");
        ok(r.evidence(new Board.Evidence("vqr-y", Board.EvidenceKind.REACH, BOB, "qiandengji:place", "world", 102, 64, 101, 1, T0 + MIN, null)).completed(), "reached");
    }

    static void rewardsIdempotent() throws Exception {
        Board b = board();
        Board.Quest q = b.post(new Commission("qinghe-rw1", "qinghe", QuestType.SLAY, "minecraft:zombie", 1, FIELD, "normal", 60, "t", ""), T0);
        b.accept(q.id, ALICE, "Alice", T0);
        b.evidence(kill("vqk-rw", ALICE, -540, T0 + MIN));
        List<Board.Grant> owed = b.owedTo(ALICE);
        ok(owed.size() == 1 && owed.get(0).reward().equals(new Reward(4, 50, 4)), "reward is the table row for 'normal'");
        ok(b.markPaid(owed.get(0).key()), "first payment");
        ok(!b.markPaid(owed.get(0).key()) && b.owedTo(ALICE).isEmpty(), "second payment refused");
        ok(b.isPaid(q.id), "ledger records the key");
        Board.Quest q2 = b.post(new Commission("qinghe-rw2", "qinghe", QuestType.SLAY, "minecraft:zombie", 1, FIELD, "hard", 60, "t", ""), T0);
        b.accept(q2.id, BOB, "Bob", T0);
        b.reconfigure(Policy.fromJson(JsonParser.parseString("""
            {"villagers": {"qinghe": {"name": "x", "types": ["slay"], "maxOpen": 2, "dailyQuota": 3}}, "targets": {"slay": ["minecraft:zombie"]},
             "rewards": {"easy": {"emeralds": 1}}}""").getAsJsonObject()), List.of(HERO));
        b.evidence(kill("vqk-rw2", BOB, -540, T0 + MIN));
        ok(q2.status == Board.Status.COMPLETED && b.owedTo(BOB).isEmpty(), "a tier removed by reload owes nothing rather than an invented amount");
        ok(violation(() -> new Reward(65, 0, 0)).startsWith("exception"), "reward bounds");
    }

    static void heroFlow() throws Exception {
        Board b = board();
        Board.Quest q = b.post(slay("qinghe-h1", 2), T0);
        ok(b.dueForHandoff(T0 + 5 * MIN, 10 * MIN).isEmpty(), "players get the grace period first");
        ok(b.dueForHandoff(T0 + 10 * MIN, 10 * MIN).size() == 1, "due after grace");
        Commission sent = b.handoff(q.id, T0 + 10 * MIN);
        ok(q.status == Board.Status.HERO && sent.deadlineMinutes() == 50, "hand-off sends the time actually left");
        ok("taken_by_hero".equals(violation(() -> b.accept(q.id, ALICE, "Alice", T0 + 11 * MIN))), "players cannot take a hero commission");
        ok("no_match".equals(b.evidence(kill("vqk-h0", ALICE, -540, T0 + 11 * MIN)).code()), "player kill does not count for hero quest");
        ok("no_match".equals(b.evidence(kill("vqk-h1", HERO, -540, T0 + 9 * MIN)).code()), "hero kill before hand-off ignored");
        Board.Outcome f = b.evidence(kill("vqk-h2", HERO, -540, T0 + 12 * MIN));
        ok(f.forward() && !f.completed() && q.status == Board.Status.HERO, "hero evidence is forwarded, never completes locally");
        b.evidence(kill("vqk-h3", HERO, -540, T0 + 13 * MIN));
        ok(q.status == Board.Status.HERO, "still waiting for the bridge even at quantity");
        JsonObject sig = Spool.signal(kill("vqk-h2", HERO, -540, T0 + 12 * MIN), 1);
        ok(sig.get("kind").getAsString().equals("mob_kill") && sig.get("actor").getAsString().equals(HERO) && sig.has("position") && sig.get("at").getAsString().endsWith("Z"), "signal wire");
        ok("recipient_not_hero".equals(b.heroFeedback(q.id, "completed", q.id, ALICE).code()) && b.owed().isEmpty(), "bridge cannot direct a reward to a non-hero");
        Board b2 = board();
        Board.Quest q2 = b2.post(slay("qinghe-h2", 2), T0);
        b2.handoff(q2.id, T0);
        Board.Outcome c = b2.heroFeedback(q2.id, "completed", q2.id, HERO);
        ok(c.completed() && b2.owedTo(HERO).size() == 1 && b2.owedTo(HERO).get(0).reward().equals(new Reward(2, 20, 2)), "hero reward from table");
        b2.heroFeedback(q2.id, "completed", q2.id, HERO);
        ok(b2.owedTo(HERO).size() == 1, "repeated outbox line owes nothing more");
        ok(b2.markPaid(q2.id) && !b2.markPaid(q2.id), "hero reward paid once");
        ok("not_hero_quest".equals(b2.heroFeedback(b2.post(slay("qinghe-h3", 1), T0).id, "completed", "k", HERO).code()), "outbox cannot complete a player/open quest");
        Board b3 = board();
        Board.Quest q3 = b3.post(slay("qinghe-h4", 1), T0);
        ok("too_late_for_heroes".equals(violation(() -> b3.handoff(q3.id, T0 + 55 * MIN))), "no hand-off with < min deadline left");
        b3.handoff(q3.id, T0);
        b3.revertHandoff(q3.id);
        ok(q3.status == Board.Status.OPEN, "failed inbox write reverts");
        ok(b3.expire(T0 + 60 * MIN).size() == 1 && q3.status == Board.Status.EXPIRED, "expiry");
    }

    static void persistence() throws Exception {
        Board b = board();
        Board.Quest q = b.post(slay("qinghe-p1", 1), T0);
        b.accept(q.id, ALICE, "Alice", T0);
        b.evidence(kill("vqk-p1", ALICE, -540, T0 + MIN));
        Board.Quest q2 = b.post(gather("qinghe-p2", "qinghe"), T0);
        Board copy = board();
        copy.load(JsonParser.parseString(b.toJson().toString()).getAsJsonObject());
        ok(copy.get(q.id).status == Board.Status.COMPLETED && copy.owedTo(ALICE).size() == 1, "owed reward survives restart");
        ok("duplicate".equals(copy.evidence(kill("vqk-p1", ALICE, -540, T0 + MIN)).code()), "seen evidence survives restart");
        ok("daily_quota".equals(violation(() -> {
            Board.Quest x = copy.get(q2.id); copy.cancel(x.id);
            copy.post(slay("qinghe-p3", 1), T0); copy.cancel(Board.questId("qinghe-p3"));
            copy.post(slay("qinghe-p4", 1), T0);
        })), "issuance log survives restart");
        copy.markPaid(q.id);
        Board again = board();
        again.load(JsonParser.parseString(copy.toJson().toString()).getAsJsonObject());
        ok(again.isPaid(q.id) && again.owed().isEmpty(), "paid ledger survives restart");
    }

    static void spool() throws Exception {
        Path dir = Files.createTempDirectory("vq-spool");
        Spool s = new Spool(dir);
        Commission c = slay("qinghe-sp1", 3);
        ok(s.writeCommission(c) && !s.writeCommission(c), "inbox write once");
        try (var files = Files.list(s.inbox)) { ok(files.map(p -> p.getFileName().toString()).toList().equals(List.of("qinghe-sp1.json")), "no tmp file left behind"); }
        JsonObject written = JsonParser.parseString(Files.readString(s.inbox.resolve("qinghe-sp1.json"))).getAsJsonObject();
        ok(!written.has("reward") && written.get("issuer").getAsString().equals("qinghe"), "inbox file has no reward");
        s.appendSignal(Spool.signal(kill("vqk-s1", HERO, -540, T0), 1));
        s.appendSignal(Spool.signal(new Board.Evidence("vqd-s2", Board.EvidenceKind.DELIVER, HERO, "minecraft:wheat", "world", 0, 0, 0, 2, T0, "qinghe"), 2));
        List<String> lines = Files.readAllLines(s.signals);
        ok(lines.size() == 2 && JsonParser.parseString(lines.get(1)).getAsJsonObject().get("recipient").getAsString().equals("qinghe"), "signals.jsonl lines");
        String good = "{\"questId\":\"vq_0123456789abcdef\",\"villager\":\"qinghe\",\"npcId\":\"7\",\"kind\":\"completed\",\"text\":\"&c青禾：谢谢 /op\","
                + "\"rewardGrant\":{\"idempotencyKey\":\"vq_0123456789abcdef\",\"recipientAgent\":\"kirito\",\"recipientBody\":\"" + HERO + "\",\"reward\":{\"emeralds\":64}}}\n";
        Files.writeString(s.outbox, good + "not json\n{\"questId\":\"vq_0123456789abcdef\",\"villager\":\"qinghe\",\"kind\":\"pro", StandardCharsets.UTF_8);
        Spool.Batch b1 = s.readOutbox(0);
        ok(b1.lines().size() == 1 && b1.bad() == 1, "one good line, one bad, partial line left");
        Spool.OutboxLine l = b1.lines().get(0);
        ok(l.text().equals("青禾：谢谢 /op") && l.recipientBody().equals(HERO), "outbox text cleaned; reward amount not read");
        Files.writeString(s.outbox, "gress\",\"text\":\"1/3\"}\n", StandardCharsets.UTF_8, java.nio.file.StandardOpenOption.APPEND);
        Spool.Batch b2 = s.readOutbox(b1.offset());
        ok(b2.lines().size() == 1 && b2.lines().get(0).kind().equals("progress"), "partial line completed later");
        ok(s.readOutbox(b2.offset()).lines().isEmpty(), "nothing new");
        Files.writeString(s.outbox, good, StandardCharsets.UTF_8);
        ok(s.readOutbox(b2.offset()).lines().size() == 1, "rotated (shorter) outbox restarts at 0");
        ok(Spool.parseOutbox("{\"questId\":\"../../etc\",\"villager\":\"qinghe\",\"kind\":\"completed\"}") == null, "bad quest id rejected");
    }

    static void questIdMatchesBridge() {
        // python -c "from agent_mc_harness.quests.bridge import quest_id; print(quest_id('qinghe-20261120-night-01'))"
        ok(Board.questId("qinghe-20261120-night-01").equals("vq_" + sha16("qinghe-20261120-night-01")), "quest id = vq_ + sha256[:16]");
        ok(Board.questId("qinghe-20261120-night-01").matches("^vq_[0-9a-f]{16}$"), "quest id shape");
    }

    static String sha16(String s) {
        try {
            byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte x : h) sb.append(String.format("%02x", x));
            return sb.substring(0, 16);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    static void llmRequest() {
        String body = StoryAuthor.OpenAiCompatible.requestBody("deepseek-chat", StoryAuthor.systemPrompt("胆小"), "需求", 0.8, 300, true);
        JsonObject o = JsonParser.parseString(body).getAsJsonObject();
        ok(o.get("model").getAsString().equals("deepseek-chat") && o.getAsJsonArray("messages").size() == 2
                && o.getAsJsonObject("response_format").get("type").getAsString().equals("json_object"), "chat completions body");
        ok(!o.has("enable_thinking"), "generic chat provider omits thinking extension");
        JsonObject codingPlan = JsonParser.parseString(StoryAuthor.OpenAiCompatible.requestBody(
                "codingplan-qwen3.7-plus", "村庄设定", "委托", 0.8, 300, true, false)).getAsJsonObject();
        ok(codingPlan.getAsJsonPrimitive("enable_thinking").isBoolean() && !codingPlan.get("enable_thinking").getAsBoolean(),
                "configured Coding Plan story request disables thinking");
        ok(StoryAuthor.OpenAiCompatible.parseContent("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"{\\\"title\\\":\\\"x\\\"}\"}}]}").equals("{\"title\":\"x\"}"), "content extracted");
        ok(violation(() -> new StoryAuthor.OpenAiCompatible("http://api.example.com/v1/chat/completions", "k", "m", 0.5, 10, java.time.Duration.ofSeconds(2), false)).startsWith("exception"), "plain http to a remote host refused");
        ok(violation(() -> new StoryAuthor.OpenAiCompatible("http://127.0.0.1:4000/v1/chat/completions", "k", "m", 0.5, 10, java.time.Duration.ofSeconds(2), false)) == null, "loopback http allowed (LiteLLM)");
        ok(StoryAuthor.userPrompt(slay("qinghe-llm", 3), "青禾&a", "/op").contains("起因：op"), "prompt inputs cleaned");
    }

    /** Minimal JSON Schema subset check against the bridge's committed schema (no extra library). */
    static void schemaCompat(Path schemaPath) throws Exception {
        JsonObject schema = JsonParser.parseString(Files.readString(schemaPath)).getAsJsonObject();
        JsonObject defs = schema.getAsJsonObject("$defs");
        JsonObject withArea = slay("qinghe-20261120-night-01", 5).toWire();
        validate(defs, "Commission", withArea);
        validate(defs, "Commission", gather("alan-20261120-1200-ab12", "alan").toWire());
        validate(defs, "QuestSignal", Spool.signal(kill("vqk-" + java.util.UUID.randomUUID(), HERO, -540, T0), 1));
        validate(defs, "QuestSignal", Spool.signal(new Board.Evidence("vqd-" + java.util.UUID.randomUUID(), Board.EvidenceKind.DELIVER, HERO, "minecraft:wheat", "world", 0, 0, 0, 2, T0, "qinghe"), 2));
        ok(!defs.getAsJsonObject("Commission").getAsJsonObject("properties").has("reward"), "schema still has no reward on Commission");
    }

    static void validate(JsonObject defs, String def, JsonObject value) {
        JsonObject s = defs.getAsJsonObject(def);
        JsonObject props = s.getAsJsonObject("properties");
        for (JsonElement r : s.getAsJsonArray("required")) ok(value.has(r.getAsString()), def + " requires " + r.getAsString());
        if (s.has("additionalProperties") && !s.get("additionalProperties").getAsBoolean())
            for (String k : value.keySet()) ok(props.has(k), def + " has no property " + k);
        for (Map.Entry<String, JsonElement> e : value.entrySet()) {
            JsonObject p = props.getAsJsonObject(e.getKey());
            if (p.has("anyOf")) p = p.getAsJsonArray("anyOf").get(0).getAsJsonObject();
            if (p.has("$ref")) { validate(defs, p.get("$ref").getAsString().replace("#/$defs/", ""), e.getValue().getAsJsonObject()); continue; }
            if (p.has("pattern")) ok(Pattern.compile(p.get("pattern").getAsString()).matcher(e.getValue().getAsString()).find(), def + "." + e.getKey() + " pattern");
            if (p.has("enum")) {
                Set<String> allowed = new java.util.HashSet<>();
                for (JsonElement x : p.getAsJsonArray("enum")) allowed.add(x.getAsString());
                ok(allowed.contains(e.getValue().getAsString()), def + "." + e.getKey() + " enum");
            }
            if (p.has("maxLength")) ok(e.getValue().getAsString().length() <= p.get("maxLength").getAsInt(), def + "." + e.getKey() + " maxLength");
            if (p.has("minLength")) ok(e.getValue().getAsString().length() >= p.get("minLength").getAsInt(), def + "." + e.getKey() + " minLength");
            if (p.has("maximum")) ok(e.getValue().getAsDouble() <= p.get("maximum").getAsDouble(), def + "." + e.getKey() + " maximum");
            if (p.has("minimum")) ok(e.getValue().getAsDouble() >= p.get("minimum").getAsDouble(), def + "." + e.getKey() + " minimum");
            if ("integer".equals(p.has("type") ? p.get("type").getAsString() : "")) ok(e.getValue().getAsDouble() == Math.rint(e.getValue().getAsDouble()), def + "." + e.getKey() + " integer");
        }
    }
}
