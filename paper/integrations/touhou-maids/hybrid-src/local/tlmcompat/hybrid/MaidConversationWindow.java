package local.tlmcompat.hybrid;

import java.util.*;

/** A completed nearby reply grants only its original speaker bounded follow-ups. */
final class MaidConversationWindow {
    private record Turn(UUID maid, UUID world, Object connection, long until, int remaining) {}
    private final Map<UUID,Turn> turns=new HashMap<>();
    void replied(UUID actor,UUID maid,UUID world,Object connection,long now){
        turns.entrySet().removeIf(e->e.getValue().until<now);
        if(turns.size()>=64&&!turns.containsKey(actor))return;
        turns.put(actor,new Turn(maid,world,connection,now+120_000_000_000L,6));
    }
    String followup(UUID actor,UUID maid,UUID world,Object connection,String text,long now){
        Turn t=turns.get(actor);
        if(t==null||!t.maid.equals(maid))return null;
        if(t.until<now||!t.world.equals(world)||t.connection!=connection||t.remaining<=0){turns.remove(actor);return null;}
        String value=text==null?"":text.strip();
        if(value.isEmpty()||value.length()>140||value.startsWith("/")||value.startsWith("!")||value.startsWith("@")||value.codePoints().anyMatch(c->Character.isISOControl(c)||c==0xA7))return null;
        turns.put(actor,new Turn(maid,world,connection,t.until,t.remaining-1));return value;
    }
}
