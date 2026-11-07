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
        Point owner;double best;long progress,attempt;boolean attempted;
        State(Point owner,double distance,long now){this.owner=owner;best=distance;progress=now;}
    }
    private final Map<UUID,State> states=new HashMap<>();
    public Action observe(UUID id,Point maid,Point owner,long now){
        double distance=maid.distance(owner);State s=states.computeIfAbsent(id,k->new State(owner,distance,now));
        if(distance<=3||owner.distance(s.owner)>2||distance<s.best-.25){s.owner=owner;s.best=distance;s.progress=now;}
        if(distance<=3)return Action.REST;
        if(now-s.progress>=STUCK&&(!s.attempted||now-s.attempt>=COOLDOWN)){
            s.attempted=true;s.attempt=now;s.progress=now;return Action.RECOVER;
        }
        return Action.WALK;
    }
    public void clear(UUID id){states.remove(id);}
    public void retain(Set<UUID> ids){states.keySet().retainAll(ids);}
}
