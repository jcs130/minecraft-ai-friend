package local.tlmcompat.hybrid;

import java.util.*;

/** Close idle companionship; native movement and safe landing remain authoritative. */
public final class MaidFollowPolicy {
    public enum Action { REST, WALK, RECOVER }
    public record Point(double x,double y,double z) {
        double distance(Point p){return Math.sqrt((x-p.x)*(x-p.x)+(y-p.y)*(y-p.y)+(z-p.z)*(z-p.z));}
    }
    private static final long STUCK=8_000_000_000L,COOLDOWN=15_000_000_000L;
    private static final class State {
        Point owner;double best,walkBeyond,recoverBeyond;long progress,attempt;boolean attempted;
        State(Point owner,double distance,long now,double walkBeyond,double recoverBeyond){this.owner=owner;best=distance;progress=now;this.walkBeyond=walkBeyond;this.recoverBeyond=recoverBeyond;}
    }
    private final Map<UUID,State> states=new HashMap<>();
    public Action observe(UUID id,Point maid,Point owner,long now){
        return observe(id,maid,owner,now,3,3);
    }
    public Action observe(UUID id,Point maid,Point owner,long now,double walkBeyond,double recoverBeyond){
        if(!Double.isFinite(walkBeyond)||!Double.isFinite(recoverBeyond)||walkBeyond<3||recoverBeyond<walkBeyond||recoverBeyond>256)throw new IllegalArgumentException("Invalid following distance");
        double distance=maid.distance(owner);State s=states.get(id);
        if(s==null||s.walkBeyond!=walkBeyond||s.recoverBeyond!=recoverBeyond){s=new State(owner,distance,now,walkBeyond,recoverBeyond);states.put(id,s);}
        if(distance<=walkBeyond||owner.distance(s.owner)>2||distance<s.best-.25){s.owner=owner;s.best=distance;s.progress=now;}
        if(distance<=walkBeyond)return Action.REST;
        if(distance>recoverBeyond&&now-s.progress>=STUCK&&(!s.attempted||now-s.attempt>=COOLDOWN)){
            s.attempted=true;s.attempt=now;s.progress=now;return Action.RECOVER;
        }
        return Action.WALK;
    }
    public void clear(UUID id){states.remove(id);}
    public void retain(Set<UUID> ids){states.keySet().retainAll(ids);}
}
