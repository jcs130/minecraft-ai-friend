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
        journal.action(npc,turn,java.util.Map.of("requestId",turn.toString(),"action","cast","completed",true,"manaSpent",5));
        var ownAction=new CompanionJournal(dir.resolve("journal")).recall(npc,npc).getFirst();
        check(ownAction.get("kind").equals("resident_action") && ownAction.get("sourceRequestId").equals(turn.toString()));
        check(!ownAction.get("id").equals(turn.toString()) && ownAction.get("reply").toString().contains("\"completed\":true"));
        check(journal.latest(npc,player).get("reply").equals("你好阿岚"));
        try {journal.action(npc,turn,java.util.Map.of("completed",false));throw new AssertionError("action evidence overwritten");}
        catch(java.io.IOException expected){checks++;}
        check(journal.recall(npc,npc).size()==1 && journal.recall(npc,npc).getFirst().get("reply").toString().contains("\"completed\":true"));
        UUID interrupted = UUID.randomUUID();
        journal.append(npc, interrupted, "request", java.util.Map.of("id", interrupted.toString(), "maidId", npc.toString(), "speakerId", visitor.toString()));
        check(journal.latest(npc, visitor).get("status").equals("unknown"));
        check(journal.latest(other, visitor) == null);
        var json=new com.google.gson.Gson();
        UUID delivered=UUID.randomUUID();
        var facts=ResidentActionMemory.summarize(java.util.Map.of("requestId",delivered.toString(),"action","cli","command","guild claim","status","completed","completed",true,
            "serviceReceipt",java.util.Map.of("goalCompleted",true,"fame",6,"before",java.util.Map.of("activeId","tm_flowers","completed",0),"after",java.util.Map.of("activeId","","completed",1))));
        String proof=json.toJson(facts);
        check(proof.contains("tm_flowers")&&proof.contains("\"goalCompleted\":true")&&Boolean.FALSE.equals(facts.get("queryOnly")));
        journal.action(npc,delivered,facts);
        for(int i=0;i<10;i++){
            Thread.sleep(2);
            journal.action(npc,UUID.randomUUID(),ResidentActionMemory.summarize(java.util.Map.of("action","cli","command","guild board","status","completed","completed",true)));
        }
        var memory=new CompanionJournal(dir.resolve("journal")).actionRecall(npc);
        check(memory.size()<=8&&memory.stream().anyMatch(row->delivered.toString().equals(row.get("sourceRequestId"))&&row.get("reply").toString().contains("tm_flowers")));
        check(new CompanionJournal(dir.resolve("journal")).actionRecall(other).isEmpty());
        var unknown=ResidentActionMemory.summarize(java.util.Map.of("action","cli","command","arena recycle sell quoted-id","status","unknown","completed",false));
        check("unknown".equals(unknown.get("status"))&&Boolean.FALSE.equals(unknown.get("completed")));
        var quoted=ResidentActionMemory.summarize(java.util.Map.of("action","cli","command","arena recycle quote bag 1 1","status","completed","completed",true,
            "serviceReceipt",java.util.Map.of("quoteId","actual-quote","expiresAt",1000,"price",4,"item",java.util.Map.of("baseId","minecraft:iron_sword","count",1))));
        check(Boolean.TRUE.equals(quoted.get("queryOnly"))&&json.toJson(quoted).contains("actual-quote")&&json.toJson(quoted).contains("minecraft:iron_sword"));
        var entrance=ResidentActionMemory.summarize(java.util.Map.of("action","cli","input",java.util.Map.of("command","arena entrance"),"status","completed","completed",true));
        check(Boolean.TRUE.equals(entrance.get("queryOnly"))&&"read_only".equals(entrance.get("operationEffect")));
        check("query_snapshot_not_world_action".equals(entrance.get("completionScope"))&&entrance.containsKey("operationNotice"));
        for(int i=0;i<10;i++){Thread.sleep(2);journal.action(npc,UUID.randomUUID(),entrance);}
        check(journal.actionRecall(npc).stream().anyMatch(row->delivered.toString().equals(row.get("sourceRequestId"))));
        check(Boolean.FALSE.equals(ResidentCliContract.describe("arena start").get("queryOnly")));
        check(Boolean.FALSE.equals(ResidentCliContract.describe("guild verify").get("queryOnly")));
        check(Boolean.TRUE.equals(ResidentCliContract.describe("arena recycle quote chest 2 1").get("queryOnly")));
        check(Boolean.TRUE.equals(ResidentCliContract.describe("archive mine").get("queryOnly")));
        check("unknown".equals(ResidentCliContract.describe("arena starter").get("operationEffect")));
        check("unknown".equals(ResidentCliContract.describe("say status").get("operationEffect")));
        check(ResidentCliContract.available().stream().noneMatch(s->s.startsWith("photo cancel")||s.startsWith("archive mine")));
        check(!ResidentCliContract.readOnly().contains("arena recycle status"));
        check(ResidentCliContract.OPERATIONS.stream().map(ResidentCliContract.Operation::key).distinct().count()==ResidentCliContract.OPERATIONS.size());
        for(var operation:ResidentCliContract.OPERATIONS){
            var effect=ResidentCliContract.describe(operation.syntax());
            check(effect.get("queryOnly").equals(operation.queryOnly())&&effect.get("operationEffect").equals(operation.effect()));
        }
        UUID notice=UUID.randomUUID();
        journal.append(npc,notice,"result",java.util.Map.of("maidId",npc.toString(),"speakerId",npc.toString(),"kind","game_notice","channel","private","reply","购买成功，奖励在个人箱待领取","sentAt",java.time.Instant.now().toString()));
        var storedNotice=com.google.gson.JsonParser.parseString(Files.readString(dir.resolve("journal").resolve(npc.toString()).resolve(notice+"-result.json"))).getAsJsonObject();
        check(storedNotice.get("id").getAsString().equals(notice.toString())&&storedNotice.get("schemaVersion").getAsInt()==1&&storedNotice.has("at"));
        try{journal.append(npc,UUID.randomUUID(),"result",java.util.Map.of("maidId",other.toString(),"speakerId",npc.toString()));throw new AssertionError("cross NPC journal write");}catch(java.io.IOException expected){check(expected.getMessage().equals("conversation_identity_mismatch"));}
        try{journal.append(npc,UUID.randomUUID(),"result",java.util.Map.of("id",notice.toString(),"speakerId",npc.toString()));throw new AssertionError("wrong record UUID");}catch(java.io.IOException expected){check(expected.getMessage().equals("conversation_identity_mismatch"));}
        try{journal.append(npc,UUID.randomUUID(),"result",java.util.Map.of("reply","missing speaker"));throw new AssertionError("guessed speaker");}catch(java.io.IOException expected){check(expected.getMessage().equals("conversation_speaker_required"));}
        System.out.println("Companion ledger checks passed: " + checks);
    }
}
