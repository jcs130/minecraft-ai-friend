package org.afuhome.agentfriend;

import java.util.List;
import java.util.Map;

public final class DungeonArrivalTest {
    private static int checks;
    private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);checks++;}
    private static boolean nearby(String world,double x,double z){return DungeonArrival.nearApproach(world,x,z,"world",1168,224,1096,232);}
    public static void main(String[] args){
        check(nearby("world",1096.5,232.5),"actual travel landing is nearby, not another travel request");
        check(nearby("world",1092.5,236.5),"safe landing radius is included");
        check(nearby("world",1112,221),"walking away from the approach does not reset to travel");
        check(!nearby("other_world",1096.5,232.5),"world name, not dimension, scopes arrival");
        check(!nearby("world",1000,232),"far away remains travel");
        check(!nearby("world",Double.NaN,232),"unknown coordinates cannot imply arrival");
        var fields=DungeonArrival.describe("world",List.of(),1096,232);
        var destination=(Map<?,?>)fields.get("travelDestination");
        check(destination.get("kind").equals("approach")&&destination.get("x").equals(1096),"reports real approach, not first room");
        check(destination.containsKey("y")&&destination.get("y")==null,"surface landing height remains unknown before execution");
        check(destination.get("heightKnown").equals(false),"unknown height remains explicit when a JSON writer omits nulls");
        check(fields.get("entranceConfigured").equals(false)&&fields.get("routeVerified").equals(false),"no invented entrance or route");
        check(fields.get("startMeaning").equals("first_room_center"),"legacy start coordinates retain explicit meaning");
        var explicit=DungeonArrival.describe("world",List.of(-425,4,677),null,null);
        var entry=(Map<?,?>)explicit.get("travelDestination");
        check(entry.get("kind").equals("configured_entry")&&entry.get("y").equals(4),"configured entry preserved");
        check(explicit.get("routeVerified").equals(false),"configured destination alone does not validate a route");
        check(DungeonArrival.travelSuccess(false).contains("外围"),"human travel receipt does not claim entrance");
        check(DungeonArrival.travelSuccess(true).contains("尚不代表进入首室"),"configured travel does not imply admission");
        System.out.println("Dungeon arrival: "+checks+" checks passed");
    }
}
