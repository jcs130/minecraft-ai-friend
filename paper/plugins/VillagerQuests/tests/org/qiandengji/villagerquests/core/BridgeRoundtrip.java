package org.qiandengji.villagerquests.core;

import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Java half of {@code run_bridge_roundtrip.py}: drives the real Spool files against the real Python bridge.
 * {@code handoff <spool> <hero>} posts and hands off a commission; {@code kills <spool> <hero>} writes hero kill
 * evidence; {@code consume <spool> <hero>} reads the bridge's outbox and checks the table reward is owed once.
 */
public final class BridgeRoundtrip {
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[1]);
        String hero = args[2];
        Spool spool = new Spool(root);
        Board board = new Board(CoreRulesTest.policy(), List.of(hero));
        Path state = root.resolve("plugin-board.json");
        if (Files.exists(state)) board.load(JsonParser.parseString(Files.readString(state)).getAsJsonObject());
        long now = System.currentTimeMillis();
        String id = "qinghe-20261120-night-01";
        switch (args[0]) {
            case "handoff" -> {
                Board.Quest q = board.post(CoreRulesTest.slay(id, 3), now - 11 * 60_000L);
                if (!board.dueForHandoff(now, 10 * 60_000L).contains(q)) throw new AssertionError("not due");
                if (!spool.writeCommission(board.handoff(q.id, now))) throw new AssertionError("inbox write");
                System.out.println("handoff " + q.id);
            }
            case "kills" -> {
                for (int i = 0; i < 4; i++) { // one more than needed, plus one outside the area
                    Board.Outcome o = board.evidence(CoreRulesTest.kill("vqk-rt-" + i, hero, -540, now));
                    if (o.forward()) spool.appendSignal(Spool.signal(CoreRulesTest.kill("vqk-rt-" + i, hero, -540, now), o.counted()));
                }
                Board.Outcome far = board.evidence(CoreRulesTest.kill("vqk-rt-far", hero, -400, now));
                if (!"no_match".equals(far.code())) throw new AssertionError("far kill forwarded");
                System.out.println("signals " + Files.readAllLines(spool.signals).size());
            }
            case "consume" -> {
                Spool.Batch b = spool.readOutbox(0);
                String qid = Board.questId(id);
                for (Spool.OutboxLine l : b.lines()) board.heroFeedback(l.questId(), l.kind(), l.grantKey(), l.recipientBody());
                for (Spool.OutboxLine l : b.lines()) board.heroFeedback(l.questId(), l.kind(), l.grantKey(), l.recipientBody()); // replay
                Board.Quest q = board.get(qid);
                List<Board.Grant> owed = board.owedTo(hero);
                if (q.status != Board.Status.COMPLETED || owed.size() != 1 || !owed.get(0).reward().equals(new Reward(2, 20, 2)))
                    throw new AssertionError("status=" + q.status + " owed=" + owed);
                System.out.println("consume kinds=" + b.lines().stream().map(Spool.OutboxLine::kind).toList() + " owed=" + owed.get(0).reward() + " bad=" + b.bad());
            }
            default -> throw new IllegalArgumentException(args[0]);
        }
        Files.writeString(state, board.toJson().toString(), StandardCharsets.UTF_8);
    }
}
