package local.tlmcompat.hybrid;

import java.util.Objects;

/** A conversation opportunity, never an automatic game action or replay. */
final class MaidConversationInitiative {
    static final long QUIET=180_000_000_000L, SETTLE=90_000_000_000L;
    private long quietUntil=Long.MIN_VALUE, togetherSince=Long.MIN_VALUE;
    private String lastScene;
    private double lastX,lastZ;
    void spoken(long now){quietUntil=now+QUIET;}
    boolean opportunity(long now,boolean together,String scene,double x,double z){
        if(!together){togetherSince=Long.MIN_VALUE;return false;}
        if(togetherSince==Long.MIN_VALUE){togetherSince=now;return false;}
        if(now-togetherSince<SETTLE||now<quietUntil)return false;
        boolean moved=lastScene!=null&&Math.hypot(x-lastX,z-lastZ)>=64;
        if(Objects.equals(lastScene,scene)&&!moved)return false;
        lastScene=scene;lastX=x;lastZ=z;spoken(now);return true;
    }
}
