package local.tlmcompat.hybrid;

import java.util.*;

/** Same sustained request budget as five-second spacing, but permits natural turns. */
final class MaidConversationRate {
    static final long WINDOW=30_000_000_000L;
    static final int BURST=6;
    private final Map<UUID,ArrayDeque<Long>> accepted=new HashMap<>();
    int retryAfterSeconds(UUID actor,long now){
        ArrayDeque<Long> recent=accepted.get(actor);
        if(recent==null)return 0;
        expire(recent,now);
        if(recent.isEmpty()){accepted.remove(actor);return 0;}
        if(recent.size()<BURST)return 0;
        return (int)Math.max(1,(WINDOW-(now-recent.getFirst())+999_999_999L)/1_000_000_000L);
    }
    void started(UUID actor,long now,boolean proactive){
        if(proactive)return; // Her invitation never spends the listener's budget.
        if(retryAfterSeconds(actor,now)>0)throw new IllegalStateException("Conversation rate validation required");
        accepted.computeIfAbsent(actor,k->new ArrayDeque<>()).addLast(now);
    }
    void prune(long now){
        accepted.values().removeIf(recent->{expire(recent,now);return recent.isEmpty();});
    }
    private static void expire(ArrayDeque<Long> recent,long now){
        while(!recent.isEmpty()&&now-recent.getFirst()>=WINDOW)recent.removeFirst();
    }
}
