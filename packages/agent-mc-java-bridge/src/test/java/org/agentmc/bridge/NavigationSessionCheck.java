package org.agentmc.bridge;

import java.util.*;
import com.google.gson.JsonParser;

/** State transitions use measured feet; the navigator's own success report is insufficient. */
public final class NavigationSessionCheck {
    static final double[] START={.5,64,.5},END={3.5,64,.5};
    static final NavigationSession.Goal GOAL=new NavigationSession.Goal(3,64,0,0);
    static final class Driver implements NavigationSession.Driver {
        boolean owned=true,idle=true,stops=true,restored;int cancellations;
        public void start(NavigationSession.Goal goal){}
        public boolean owns(){return owned;}
        public boolean idle(){return idle;}
        public boolean stop(){cancellations++;return stops;}
        public void restore(){restored=true;}
    }
    public static final class Setting {public Object value;Setting(Object value){this.value=value;}}
    public static final class Settings {public Setting allowBreak=new Setting(true),allowPlace=new Setting(true),maxFall=new Setting(8),allowAnyway=new Setting(new ArrayList<>(List.of("stone")));}
    static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
    public static void main(String[] args)throws Exception{
        Driver driver=new Driver();NavigationSession session=new NavigationSession(driver,GOAL,START,0,10000);
        session.tick(START,true,100);check(session.phase().equals("running"),"Idle/path ended is not arrival");
        session.tick(END,false,150);check(session.phase().equals("running"),"Airborne crossing is not supported arrival");
        session.tick(END,true,200);check(session.phase().equals("completed")&&driver.restored&&driver.cancellations==1,"Measured arrival must cancel and restore");

        driver=new Driver();driver.stops=false;session=new NavigationSession(driver,GOAL,START,0,10000);
        session.tick(END,true,100);session.tick(START,true,150);check(session.phase().equals("running"),"Cancellation is still pending");
        driver.stops=true;session.tick(START,true,200);check(session.phase().equals("blocked"),"Moving away while stopping must not report success");

        driver=new Driver();session=new NavigationSession(driver,GOAL,START,0,10000);
        driver.owned=false;driver.idle=false;session.tick(START,true,100);
        check(session.phase().equals("blocked")&&driver.cancellations==0&&driver.restored,"Never cancel another goal/process");

        driver=new Driver();session=new NavigationSession(driver,GOAL,START,0,10000);
        session.tick(START,true,5000);check(session.phase().equals("blocked")&&session.reason().contains("No measured progress"),"Stationary route ends with evidence");
        driver=new Driver();session=new NavigationSession(driver,GOAL,START,0,1000);
        session.tick(new double[]{1,64,.5},true,1000);check(session.phase().equals("blocked")&&session.reason().contains("timed out"),"Moving without arrival times out");

        driver=new Driver();session=new NavigationSession(driver,GOAL,START,0,1000);
        session.paused(true,100);session.paused(true,5000);session.paused(false,6100);
        session.tick(START,true,6500);check(session.phase().equals("running")&&driver.cancellations==0,"Survival pause excludes wall time without changing the owned route");
        session.tick(END,true,6600);check(session.phase().equals("completed"),"Original route resumes to measured arrival");

        driver=new Driver();driver.idle=false;driver.stops=false;session=new NavigationSession(driver,GOAL,START,0,1000);
        session.tick(START,true,1000);session.tick(START,true,3000);check(session.phase().equals("unknown")&&!driver.restored,"Unconfirmed cancellation retains policy and blocks reuse");
        driver.stops=true;driver.idle=true;check(session.cancel(3100)&&driver.restored&&session.phase().equals("cancelled"),"Original cancellation can reconcile");
        driver=new Driver();driver.stops=false;session=new NavigationSession(driver,GOAL,START,0,10000);
        session.tick(END,true,100);driver.owned=false;session.tick(END,true,150);check(session.phase().equals("blocked")&&driver.cancellations==1,"Takeover during stop must not cancel the foreign goal");

        check(new NavigationSession.Goal(-1,64,-2,0).contains(new double[]{-.01,64.9,-1.1}),"Negative coordinates use floor");
        check(!new NavigationSession.Goal(0,64,0,1).contains(new double[]{1,65,0}),"GoalNear uses three dimensional squared distance");
        Settings settings=new Settings();SettingLease lease=new SettingLease();Object original=settings.allowAnyway.value;
        lease.set(settings,"allowBreak",false);lease.set(settings,"allowPlace",false);lease.set(settings,"maxFall",3);lease.set(settings,"allowAnyway",List.of());
        settings.maxFall.value=2;lease.restore();
        check(settings.allowBreak.value.equals(true)&&settings.allowPlace.value.equals(true)&&settings.maxFall.value.equals(2)&&settings.allowAnyway.value==original,"Restore every setting separately and retain later user changes");
        lease.set(settings,"allowBreak",false);try{lease.set(settings,"missing",false);throw new AssertionError("Missing setting accepted");}catch(NoSuchFieldException expected){}lease.restore();
        check(settings.allowBreak.value.equals(true),"Partial policy installation rolls back");
        for(String json:List.of("{\"x\":0,\"y\":64,\"z\":0,\"rangeSq\":\"4\"}","{\"x\":0,\"y\":64,\"z\":0,\"rangeSq\":2}","{\"x\":0,\"y\":64,\"z\":0,\"rangeSq\":289}","{\"x\":0,\"y\":64,\"z\":0,\"rangeSq\":-1}","{\"x\":0,\"y\":64,\"z\":0,\"unknown\":1}","{\"x\":\"0\",\"y\":64,\"z\":0}")){
            try{NativeNavigation.validate(JsonParser.parseString(json).getAsJsonObject());throw new AssertionError("Invalid raw navigation RPC accepted: "+json);}catch(IllegalArgumentException expected){}
        }
        System.out.println("NavigationSessionCheck: measured arrival, failure, ownership, cancellation and policy restoration passed");
    }
}
