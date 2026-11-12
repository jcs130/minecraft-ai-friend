package local.tlmcompat.hybrid;

import java.util.Objects;

/** A conversation opportunity, never an automatic game action or replay. */
final class MaidConversationInitiative {
    static final long QUIET=120_000_000_000L, SETTLE=45_000_000_000L;
    private long quietUntil=Long.MIN_VALUE, togetherSince=Long.MIN_VALUE;
    private String lastScene;
    private double lastX,lastZ;
    private long lastCue;
    void spoken(long now){quietUntil=now+QUIET;}
    boolean opportunity(long now,boolean together,String scene,double x,double z){
        return opportunity(now,together,scene,x,z,0);
    }
    boolean opportunity(long now,boolean together,String scene,double x,double z,long cue){
        if(!together){togetherSince=Long.MIN_VALUE;return false;}
        if(togetherSince==Long.MIN_VALUE){
            togetherSince=now;
            if(lastScene==null){lastScene=scene;lastX=x;lastZ=z;}
            return false;
        }
        if(now-togetherSince<SETTLE||now<quietUntil)return false;
        boolean moved=lastScene!=null&&Math.hypot(x-lastX,z-lastZ)>=64;
        if(Objects.equals(lastScene,scene)&&!moved&&cue<=lastCue)return false;
        lastScene=scene;lastX=x;lastZ=z;lastCue=Math.max(lastCue,cue);spoken(now);return true;
    }
}
