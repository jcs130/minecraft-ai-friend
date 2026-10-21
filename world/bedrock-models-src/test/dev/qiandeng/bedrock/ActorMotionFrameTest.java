package dev.qiandeng.bedrock;
import java.util.*;
public final class ActorMotionFrameTest {
    private static int checks;
    private static Map<String,Object> frame(){var m=new HashMap<String,Object>();m.put("schemaVersion",1L);m.put("source","same_connection_native_entity_packets");
        m.put("entityId",41L);m.put("uuid","174bd1e7-fad4-3319-91e6-d495fc2ac20b");m.put("sequence",1L);m.put("pose",1L);
        m.put("moving",true);m.put("swinging",false);m.put("bodyYaw",90d);m.put("headYaw",45d);m.put("pitch",-22.5d);m.put("onGround",null);m.put("leaseMs",500L);return m;}
    private static void check(boolean ok){checks++;if(!ok)throw new AssertionError();}
    private static void reject(String key,Object value){var m=frame();m.put(key,value);try{ActorMotionFrame.decode(m);throw new AssertionError(key);}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args){
        var a=ActorMotionFrame.decode(frame());check(a.pose()==1&&a.onGround()==null&&a.bodyYaw()==90);check(a.uuid().toString().equals(frame().get("uuid")));
        var m=frame();m.put("onGround",true);check(ActorMotionFrame.decode(m).onGround());
        for(Object value:List.of(-1,9,1.5,Double.NaN,"walk"))reject("pose",value);
        for(Object value:List.of(0,-1,1.5,Double.POSITIVE_INFINITY))reject("sequence",value);
        reject("uuid","1-2-3-4-5");reject("source","proxy");reject("schemaVersion",2);reject("onGround",0);reject("leaseMs",1001);reject("headYaw",181);
        reject("moving","true");reject("pitch",Double.NaN);System.out.println("ActorMotionFrame checks="+checks);
    }
}
