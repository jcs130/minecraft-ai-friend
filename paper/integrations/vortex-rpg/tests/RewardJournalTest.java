package io.vortexcore.quest;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
public final class RewardJournalTest {
    private static int checks;
    private static void ok(boolean value){if(!value)throw new AssertionError();checks++;}
    private static void rejected(Throwing task)throws Exception{try{task.run();throw new AssertionError("accepted");}catch(java.io.IOException expected){checks++;}}
    interface Throwing{void run()throws Exception;}
    public static void main(String[] args)throws Exception{
        Path root=Files.createTempDirectory("qd-reward-proof-");var id=UUID.randomUUID();Instant start=Instant.parse("2026-10-27T00:00:00Z");
        var store=new RewardJournal(root);ok(store.pending(id)==0);
        var ticket=store.prepare(id,"first_blood",start,List.of("EXPERIENCE:180","CURRENCY:50"));ok(store.pending(id)==1);
        rejected(()->new RewardJournal(root).prepare(id,"first_blood",start,List.of("CURRENCY:50")));
        rejected(()->ticket.issuing(0));ticket.committed();ticket.issuing(0);
        ok(new RewardJournal(root).pending(id)==1);rejected(()->ticket.issuing(0));rejected(ticket::complete);
        ticket.applied(0);rejected(()->ticket.applied(0));ticket.issuing(1);ticket.applied(1);ticket.complete();
        ok(new RewardJournal(root).pending(id)==0);
        rejected(()->new RewardJournal(root).prepare(id,"first_blood",start,List.of("CURRENCY:50")));
        var next=store.prepare(id,"first_blood",start.plusSeconds(1),List.of("CURRENCY:50"));ok(store.pending(id)==1);
        ok(store.pending(UUID.randomUUID())==0);
        // A process ending after ISSUING leaves durable uncertainty, never a retry token.
        next.committed();next.issuing(0);ok(new RewardJournal(root).pending(id)==1);
        rejected(()->new RewardJournal(root).prepare(id,"first_blood",start.plusSeconds(1),List.of("CURRENCY:50")));
        try(var stream=Files.walk(root)){ok(stream.noneMatch(p->p.toString().endsWith(".tmp")));}
        System.out.println(checks+" reward journal checks passed");
    }
}
