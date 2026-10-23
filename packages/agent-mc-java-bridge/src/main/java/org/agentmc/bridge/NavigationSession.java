package org.agentmc.bridge;

/** A bounded owned walk completes only after the measured feet satisfy its goal. */
final class NavigationSession {
    record Goal(int x, int y, int z, int range) {
        boolean contains(double[] feet) {
            double dx=Math.floor(feet[0])-x,dy=Math.floor(feet[1])-y,dz=Math.floor(feet[2])-z;
            return dx*dx+dy*dy+dz*dz<=range*range;
        }
    }
    interface Driver {
        void start(Goal goal) throws Exception;
        boolean owns() throws Exception;
        boolean idle() throws Exception;
        boolean stop() throws Exception;
        void restore() throws Exception;
    }
    private final Driver driver;
    private final Goal goal;
    private long deadline,pausedAt=-1;
    private long progressAt;
    private double[] last;
    private String stopping,phase="running",reason;
    private long stoppingAt;
    NavigationSession(Driver driver,Goal goal,double[] feet,long now,int timeoutMs) throws Exception {
        this.driver=driver;this.goal=goal;last=feet.clone();progressAt=now;deadline=now+timeoutMs;
        driver.start(goal);
    }
    String phase(){return phase;}
    String reason(){return reason;}
    Goal goal(){return goal;}
    void paused(boolean value,long now){if(value&&pausedAt<0)pausedAt=now;else if(!value&&pausedAt>=0){long elapsed=Math.max(0,now-pausedAt);deadline+=elapsed;progressAt+=elapsed;pausedAt=-1;}}
    void tick(double[] feet,boolean onGround,long now) throws Exception {
        if(!phase.equals("running"))return;
        if(!driver.owns()) { phase="blocked";reason="Navigation ownership changed; foreign goal was not cancelled";driver.restore();return; }
        if(stopping==null){
            if(goal.contains(feet)&&onGround) requestStop("arrived",now);
            else if(now>=deadline) requestStop("Navigation timed out before measured arrival",now);
            else if(distance(feet,last)>=.15){last=feet.clone();progressAt=now;}
            else if(now-progressAt>=5000) requestStop("No measured progress for5s; inspect route and collision",now);
        }
        if(stopping!=null){
            if(driver.stop()&&driver.idle()){
                phase=stopping.equals("arrived")&&goal.contains(feet)&&onGround?"completed":"blocked";
                reason=phase.equals("completed")?"Measured feet satisfy the goal and owned navigation stopped":stopping.equals("arrived")?"Feet left the goal before navigation stopped":stopping;
                driver.restore();
            }else if(now-stoppingAt>=2000){phase="unknown";reason="Owned navigation cancellation unconfirmed; reconcile before new body work";}
        }
    }
    boolean cancel(long now) throws Exception {
        if(!phase.equals("running")&&!phase.equals("unknown"))return true;
        if(!driver.owns()){driver.restore();phase="cancelled";reason="Original navigation no longer owns control";return true;}
        requestStop("Explicit navigation cancellation",now);
        if(driver.stop()&&driver.idle()){driver.restore();phase="cancelled";reason=stopping;return true;}
        return false;
    }
    private void requestStop(String why,long now){if(stopping==null){stopping=why;stoppingAt=now;}}
    private static double distance(double[] a,double[] b){return Math.sqrt(Math.pow(a[0]-b[0],2)+Math.pow(a[1]-b[1],2)+Math.pow(a[2]-b[2],2));}
}
