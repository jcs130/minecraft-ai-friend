package org.agentmc.bridge;
import java.util.*;

/** Short lived, ordered inputs. Reconnect/expiry never restores the old stream. */
public final class ReflexLease {
    private String stream, signature;
    private int sequence, generation;
    private long until;
    private final Map<String,Integer> seen=new LinkedHashMap<>();
    public boolean accept(String id,int seq,int connection,long sampledAt,long now,String payload,int ttlMs){
        if(id==null||!id.matches("[A-Za-z0-9_.:-]{1,180}")||seq<1||ttlMs<50||ttlMs>400
            ||sampledAt>now+50||now-sampledAt>500)throw new IllegalArgumentException("Stale or invalid reflex input");
        if(stream!=null&&generation!=connection)clear();
        if(stream!=null&&!stream.equals(id)&&now<until)throw new IllegalStateException("Another reflex stream still owns inputs");
        String key=connection+":"+id;
        if(id.equals(stream)&&seq<=sequence){
            if(seq==sequence&&Objects.equals(signature,payload))return false;
            throw new IllegalStateException("Reflex sequence changed or replayed");
        }
        if(seq<=seen.getOrDefault(key,0))throw new IllegalStateException("Ended reflex inputs cannot be replayed");
        seen.put(key,seq);while(seen.size()>128)seen.remove(seen.keySet().iterator().next());
        stream=id;sequence=seq;generation=connection;signature=payload;until=now+ttlMs;return true;
    }
    public boolean active(long now,int connection){return stream!=null&&connection==generation&&now<until;}
    public int sequence(){return sequence;}
    public String stream(){return stream;}
    public void clear(){stream=null;signature=null;sequence=0;until=0;generation=0;}
}
