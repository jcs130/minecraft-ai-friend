package org.afuhome.agentfriend;

import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Fail on generation, hidden block reads or additional chunk loads. */
public final class HomeLandingUnavailableTest {
    static int checks;
    static void check(boolean ok){if(!ok)throw new AssertionError("home unavailable rule "+checks);checks++;}
    public static void main(String[]args){
        AtomicInteger loads=new AtomicInteger();boolean[]generated={false};
        World world=(World)Proxy.newProxyInstance(World.class.getClassLoader(),new Class<?>[]{World.class},(p,m,a)->switch(m.getName()){
            case "isChunkLoaded" -> false;
            case "isChunkGenerated" -> generated[0];
            case "loadChunk" -> {if(a.length!=3||!Boolean.FALSE.equals(a[2]))throw new AssertionError("Generation requested");loads.incrementAndGet();yield false;}
            default -> throw new AssertionError("Unavailable terrain access: "+m.getName());
        });
        Player player=(Player)Proxy.newProxyInstance(Player.class.getClassLoader(),new Class<?>[]{Player.class},(p,m,a)->switch(m.getName()){
            case "getWidth" -> .6;case "getHeight" -> 1.8;default -> throw new AssertionError(m.getName());
        });
        check(!new HomeLanding(player,null).select().found());
        var first=new HomeLanding(player,new Location(world,.5,67,.5)).select();
        check(!first.found()&&first.originalIssue().code().equals("chunk_unavailable"));check(first.blockReads()==0&&loads.get()==0);
        generated[0]=true;var next=new HomeLanding(player,new Location(world,.5,67,.5)).select();
        check(!next.found()&&next.blockReads()==0&&loads.get()==1);
        check(!new HomeLanding(player,new Location(world,Double.NaN,67,.5)).select().found());
        check(!HomeLanding.accepts(player,null,null));
        System.out.println("home-unavailable-checks="+checks+" passed=true blockReads=0");
    }
}
