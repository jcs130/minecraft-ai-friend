package org.qiandengji.payload;

import java.util.Arrays;
import java.util.IdentityHashMap;
import java.util.Map;

/** Keeps only a genuinely received original 2.6.0 version acknowledgement. */
final class YsmAcknowledgementHandoff {
    static final String CHANNEL="yes_steve_model:2_6_0";
    private static final byte[] ACK={52,5,'2','.','6','.','0'};
    private static final class Session {
        final byte[] acknowledgement;
        Object backend;
        int attempts;
        boolean pending,delivered;
        Session(byte[] bytes){acknowledgement=bytes.clone();}
    }
    private final Map<Object,Session> sessions=new IdentityHashMap<>();

    synchronized boolean received(Object player,byte[] bytes){
        if(player==null||!Arrays.equals(ACK,bytes))return false;
        if(sessions.containsKey(player))return true;
        if(sessions.size()>=512)return false;
        sessions.put(player,new Session(bytes));return true;
    }
    synchronized boolean queue(Object player,Object backend){
        Session session=sessions.get(player);
        if(session==null||backend==null)return false;
        if(session.backend!=backend){session.backend=backend;session.attempts=0;session.pending=false;session.delivered=false;}
        if(session.pending||session.delivered||session.attempts>=2)return false;
        session.pending=true;return true;
    }
    synchronized byte[] take(Object player,Object backend){
        Session session=sessions.get(player);
        if(session==null||session.backend!=backend||!session.pending)return null;
        session.pending=false;session.attempts++;return session.acknowledgement.clone();
    }
    synchronized void delivered(Object player,Object backend){
        Session session=sessions.get(player);
        if(session!=null&&session.backend==backend)session.delivered=true;
    }
    synchronized void left(Object player){sessions.remove(player);}
    synchronized void clear(){sessions.clear();}
}
