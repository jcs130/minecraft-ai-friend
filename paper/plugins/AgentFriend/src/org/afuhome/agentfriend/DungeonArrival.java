package org.afuhome.agentfriend;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Travel facts, separate from admission, room progress, and route reachability. */
final class DungeonArrival {
    private DungeonArrival() { }

    // The expedition landing search may move four blocks on either axis.
    // This is only a nearby-area hint, never evidence of entrance or room arrival.
    static boolean nearApproach(String currentWorld,double x,double z,String world,
                                int centerX,int centerZ,int approachX,int approachZ) {
        return world.equals(currentWorld)&&Double.isFinite(x)&&Double.isFinite(z)
                &&Math.hypot(x-centerX,z-centerZ)<=Math.hypot(approachX-centerX,approachZ-centerZ)+8;
    }

    static Map<String,Object> describe(String world,List<Integer> entry,Integer approachX,Integer approachZ) {
        Map<String,Object> destination=new LinkedHashMap<>();
        destination.put("kind",entry.isEmpty()?"approach":"configured_entry");
        destination.put("world",world);
        destination.put("heightKnown",entry.size()==3);
        if(entry.size()==3){destination.put("x",entry.get(0));destination.put("y",entry.get(1));destination.put("z",entry.get(2));}
        else {destination.put("x",approachX);destination.put("y",null);destination.put("z",approachZ);}
        Map<String,Object> out=new LinkedHashMap<>();
        out.put("travelDestination",destination);
        out.put("entranceConfigured",entry.size()==3);
        out.put("routeVerified",false);
        out.put("startMeaning","first_room_center");
        out.put("instruction",entry.isEmpty()
                ?"travel只到遗迹外围，未配置入口坐标；start是首室中心，不是入口。已在附近无需重复传送；观察实际门、楼梯或询问路标，找不到通路时报告阻碍，不沿坐标挖穿保护建筑。"
                :"travel到配置的入口安全落点；start是首室中心。入口到首室的路线未由本查询核验，沿实际通道前进。");
        return out;
    }

    static String travelSuccess(boolean configuredEntry) {
        return configuredEntry?"已到配置入口附近，尚不代表进入首室":"已到遗迹外围，尚未确认入口或进入首室";
    }
}
