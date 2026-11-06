package dev.god.godvoice;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** Bounded, per-utterance SVC send-event evidence. It is not a client acknowledgement. */
final class VoiceDelivery {
    record Summary(int packetOffers,int listenerCount,boolean listenersTruncated) { }
    private final Set<UUID> listeners=new HashSet<>();
    private int packetOffers;
    private boolean truncated;
    synchronized void offered(UUID listener){
        if(listener==null)return;
        packetOffers=Math.min(1_000_000,packetOffers+1);
        if(listeners.size()<128)listeners.add(listener);
        else if(!listeners.contains(listener))truncated=true;
    }
    synchronized Summary summary(){return new Summary(packetOffers,listeners.size(),truncated);}
    static String completionReason(Summary value){
        return value.packetOffers()==0?"VOICE_NO_RECEIVER_CHECK_STATUS":"VOICE_SENT_HEARING_UNVERIFIED";
    }
}
