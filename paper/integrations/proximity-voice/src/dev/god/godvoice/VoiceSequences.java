package dev.god.godvoice;
import java.util.*;

/** Sequence history belongs to the connection, not one silence-delimited utterance. */
final class VoiceSequences {
    private record Epoch(UUID session,CaptureFence fence) { }
    private final Map<UUID,Epoch> rows=new HashMap<>();
    synchronized boolean observe(UUID actor,UUID session,long sequence) {
        Epoch row=rows.get(actor);
        if(row==null||!row.session.equals(session)){row=new Epoch(session,new CaptureFence());rows.put(actor,row);}
        return row.fence.observe(sequence);
    }
    synchronized void remove(UUID actor){rows.remove(actor);}
    synchronized void clear(){rows.clear();}
}
