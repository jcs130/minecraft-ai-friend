package org.agentmc.bridge;
import java.lang.reflect.*;
import java.util.*;

/** Discovery checks the actual optional API jar without starting a client or path. */
public final class BaritoneApiCheck {
    public static void main(String[] args)throws Exception{
        boolean expected=args.length==1&&args[0].equals("present");
        if(BaritoneNavigation.available()!=expected)throw new AssertionError("Baritone public API capability mismatch: "+expected+"; "+BaritoneNavigation.diagnostic());
        if(expected){
            Class<?> goalBlock=Class.forName("baritone.api.pathing.goals.GoalBlock"),goalNear=Class.forName("baritone.api.pathing.goals.GoalNear");
            for(int radius:new int[]{0,1,3}){
                Object goal=radius==0?goalBlock.getConstructor(int.class,int.class,int.class).newInstance(-1,64,-2):goalNear.getConstructor(net.minecraft.class_2338.class,int.class).newInstance(new net.minecraft.class_2338(-1,64,-2),radius);
                var isInGoal=goal.getClass().getMethod("isInGoal",int.class,int.class,int.class);var reference=new NavigationSession.Goal(-1,64,-2,radius);
                for(int x=-5;x<=3;x++)for(int y=60;y<=68;y++)for(int z=-6;z<=2;z++)if((boolean)isInGoal.invoke(goal,x,y,z)!=reference.contains(new double[]{x+.5,y,z+.5}))throw new AssertionError("Measured goal differs from actual Baritone goal");
            }
            cancellationContract();
        }
        System.out.println("BaritoneApiCheck: optional public API "+(expected?"detected":"absent without breaking baseline"));
    }
    private static Object proxy(String name,InvocationHandler handler)throws Exception{
        Class<?> type=Class.forName("baritone.api."+name);return Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},handler);
    }
    private static Object inactive(Class<?> type){return Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(p,m,a)->m.getName().equals("isActive")?false:m.getReturnType()==boolean.class?false:null);}
    private static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
    private static void cancellationContract()throws Exception{
        Object goal=Class.forName("baritone.api.pathing.goals.GoalBlock").getConstructor(int.class,int.class,int.class).newInstance(3,64,0);
        boolean[] idle={true},active={true};Object[] binding={goal},controller={null};int[] cancellations={0};
        Object pathToken=inactive(Class.forName("baritone.api.pathing.path.IPathExecutor"));
        Object process=proxy("process.ICustomGoalProcess",(p,m,a)->switch(m.getName()){
            case "isActive"->active[0];case "mostRecentGoal"->binding[0];default->null;});
        Object path=proxy("behavior.IPathingBehavior",(p,m,a)->switch(m.getName()){
            case "getCurrent"->idle[0]?null:pathToken;case "getNext"->null;case "getInProgress"->Optional.empty();
            case "cancelEverything"->{cancellations[0]++;active[0]=false;binding[0]=null;yield false;}default->null;});
        Object manager=proxy("pathing.calc.IPathingControlManager",(p,m,a)->m.getName().equals("mostRecentInControl")?Optional.ofNullable(controller[0]):null);
        Object baritone=proxy("IBaritone",(p,m,a)->switch(m.getName()){
            case "getPathingBehavior"->path;case "getCustomGoalProcess"->process;case "getPathingControlManager"->manager;
            default->inactive(m.getReturnType());});
        controller[0]=process;
        BaritoneNavigation nativeDriver=new BaritoneNavigation(baritone,path,process,goal);
        NavigationSession session=new NavigationSession(bound(nativeDriver),new NavigationSession.Goal(3,64,0,0),new double[]{0,64,0},0,10000);
        session.tick(new double[]{3,64,0},true,100);
        check(session.phase().equals("completed")&&cancellations[0]==1,"False synchronous API hint plus measured idle must complete, not become unknown");

        idle[0]=false;active[0]=true;binding[0]=goal;cancellations[0]=0;
        nativeDriver=new BaritoneNavigation(baritone,path,process,goal);
        session=new NavigationSession(bound(nativeDriver),new NavigationSession.Goal(3,64,0,0),new double[]{0,64,0},0,10000);
        session.tick(new double[]{3,64,0},true,100);session.tick(new double[]{3,64,0},true,2100);
        check(session.phase().equals("unknown")&&cancellations[0]==1,"Deactivated process does not prove path cleanup; no repeated global cancellation");
        check(!session.cancel(2150),"A still active original path cannot be retired as cancelled");
        idle[0]=true;check(session.cancel(2200)&&cancellations[0]==1,"Fresh idle reconciles the exact original cancellation");

        Object foreign=proxy("process.IBaritoneProcess",(p,m,a)->m.getName().equals("isActive")?true:null);
        active[0]=false;idle[0]=false;controller[0]=foreign;
        check(!new BaritoneNavigation(baritone,path,process,null).canStart(),"A foreign path cannot be replaced");
        java.lang.reflect.Field registry=BaritoneReflex.class.getDeclaredField("OWNED");registry.setAccessible(true);
        @SuppressWarnings("unchecked") Set<Object> owned=(Set<Object>)registry.get(null);owned.add(foreign);
        try{check(new BaritoneNavigation(baritone,path,process,null).canStart(),"An exact registered shared reflex controller permits bounded handoff");
            active[0]=true;check(!new BaritoneNavigation(baritone,path,process,null).canStart(),"An active custom goal stays protected even beside our shared reflex");}
        finally{owned.remove(foreign);}
        System.out.println("BaritoneApiCheck: real API cancellation hint, asynchronous idle, foreign control and shared reflex handoff passed");
    }
    private static NavigationSession.Driver bound(BaritoneNavigation driver){return new NavigationSession.Driver(){
        public void start(NavigationSession.Goal goal){}public boolean owns()throws Exception{return driver.owns();}
        public boolean idle()throws Exception{return driver.idle();}public boolean stop()throws Exception{return driver.stop();}
        public void restore()throws Exception{driver.restore();}
    };}
}
