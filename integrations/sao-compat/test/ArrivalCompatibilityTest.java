package dev.qiandeng.maw.saoforge;
import java.util.*;
public final class ArrivalCompatibilityTest {
    private static int passed;
    private static void check(boolean value){if(!value)throw new AssertionError("arrival/status policy check "+passed);passed++;}
    public static void main(String[] args){
        Map<String,String> mods=new HashMap<>(Map.of("numen","0.1.4.1","numen_api","0.1.4.1","maw_numen_server","server-only","required_content","2"));
        Map<String,String> channels=new HashMap<>(Map.of("numen_api:main","1","numen_tlm:outfit","1","required_content:main","2"));
        check(OptionalStatusPolicy.supported(true,mods,channels));check(!OptionalStatusPolicy.supported(false,mods,channels));
        mods.put("numen","0.1.4.2");check(!OptionalStatusPolicy.supported(true,mods,channels));mods.put("numen","0.1.4.1");
        mods.remove("maw_numen_server");check(!OptionalStatusPolicy.supported(true,mods,channels));mods.put("maw_numen_server","server-only");
        channels.put("numen_tlm:outfit","2");check(!OptionalStatusPolicy.supported(true,mods,channels));channels.remove("numen_tlm:outfit");check(OptionalStatusPolicy.supported(true,mods,channels));
        channels.remove("numen_api:main");check(!OptionalStatusPolicy.supported(true,mods,channels));check(!OptionalStatusPolicy.MODS.contains("required_content"));check(!OptionalStatusPolicy.CHANNELS.containsKey("required_content:main"));
        var bounds=new ArrivalPolicy.Bounds(-8,98,-8,8,108,8);String world="minecraft:overworld";
        check(ArrivalPolicy.decide(true,true,true,false,world,world,bounds,.5,100,3.8)==ArrivalPolicy.Decision.MOVE);
        check(ArrivalPolicy.decide(false,true,true,false,world,world,bounds,.5,100,3.8)==ArrivalPolicy.Decision.WAIT);
        check(ArrivalPolicy.decide(true,false,true,false,world,world,bounds,.5,100,3.8)==ArrivalPolicy.Decision.WAIT);
        check(ArrivalPolicy.decide(true,true,false,false,world,world,bounds,.5,100,3.8)==ArrivalPolicy.Decision.WAIT);
        check(ArrivalPolicy.decide(true,true,true,true,world,world,bounds,.5,100,3.8)==ArrivalPolicy.Decision.WAIT);
        check(ArrivalPolicy.decide(true,true,true,false,"mod:personal_home",world,bounds,.5,100,3.8)==ArrivalPolicy.Decision.KEEP);
        check(ArrivalPolicy.decide(true,true,true,false,world,world,bounds,1259.5,84,-952.5)==ArrivalPolicy.Decision.KEEP);
        check(bounds.contains(8.99,108.99,8.99));check(!bounds.contains(9,109,9));check(!bounds.contains(Double.NaN,100,0));
        try{new ArrivalPolicy.Bounds(0,0,0,65,1,1);throw new AssertionError();}catch(IllegalArgumentException valid){passed++;}
        try{new ArrivalPolicy.Bounds(Integer.MIN_VALUE,0,0,Integer.MAX_VALUE,1,1);throw new AssertionError();}catch(IllegalArgumentException valid){passed++;}
        System.out.println("{\"policyChecksPassed\":"+passed+"}");
    }
}
