package org.afuhome.agentfriend;

import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import org.bukkit.*;
import org.bukkit.block.Block;

public final class PeakSurveyTest {
    private static int checks;
    private static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);checks++;}
    private static PeakSurvey.Result sample(String kind,int y) {
        var reads=new AtomicInteger();
        World world=(World)Proxy.newProxyInstance(World.class.getClassLoader(),new Class<?>[]{World.class},(p,m,a)->switch(m.getName()){
            case "getEnvironment"->kind.equals("nether")?World.Environment.NETHER:World.Environment.NORMAL;
            case "getMinHeight"->-64;case "getMaxHeight"->320;
            case "isChunkLoaded"->!kind.equals("unloaded");
            case "getHighestBlockYAt"->kind.equals("ceiling")?150:125;
            case "getBlockAt"->{
                if(kind.equals("unloaded"))throw new AssertionError("unloaded terrain read");
                reads.incrementAndGet();int xx=(int)a[0],yy=(int)a[1],zz=(int)a[2];
                Material material;
                if(kind.equals("pillar"))material=xx==0&&zz==0&&yy<=125?Material.STONE:Material.AIR;
                else if(kind.equals("thin_roof"))material=yy==125?Material.STONE:Material.AIR;
                else if(kind.equals("wood_roof"))material=yy<=125?Material.OAK_PLANKS:Material.AIR;
                else if(kind.equals("water"))material=yy<=125?Material.WATER:Material.AIR;
                else if(kind.equals("cliff"))material=xx>=0&&yy<=125?Material.STONE:Material.AIR;
                else material=yy<=125?Material.STONE:Material.AIR;
                yield Proxy.newProxyInstance(Block.class.getClassLoader(),new Class<?>[]{Block.class},(bp,bm,ba)->switch(bm.getName()){
                    case "getType"->material;case "isLiquid"->material==Material.WATER;case "isPassable"->material==Material.AIR;default->throw new AssertionError("unexpected block "+bm.getName());});
            }
            default->throw new AssertionError("unexpected world operation "+m.getName());});
        var result=PeakSurvey.inspect(new Location(world,.5,y,.5));check(reads.get()==result.reads()&&reads.get()<=180,"bounded loaded terrain reads");return result;
    }
    public static void main(String[]args) {
        check(sample("mountain",126).ready(),"broad mountain passes");
        check(sample("cliff",126).ready(),"broad ridge edge passes");
        check(!sample("pillar",126).ready(),"vertical stone pillar is not a mountain");
        check(!sample("thin_roof",126).ready(),"wide thin stone roof is not a mountain");
        check(!sample("wood_roof",126).ready(),"wooden tower is not a mountain");
        check(!sample("water",126).ready(),"water is not natural standing support");
        check(!sample("ceiling",126).ready(),"covered ceiling rejected");
        check(!sample("nether",126).ready(),"nether roof rejected");
        check(sample("unloaded",126).reason().equals("terrain_unloaded"),"unknown terrain remains unknown");
        check(sample("mountain",67).reason().equals("find_mountain"),"lowland requires real exploration");
        var ready=new com.google.gson.JsonObject();ready.addProperty("ready",true);
        check(PeakSurvey.guide(ready,sample("pillar",126))==ready,"already recorded completion is never revoked by a new query");
        check(PeakSurvey.requirement().contains("垫柱")&&PeakSurvey.requirement().contains("不强制建造"),"rule and wording agree");
        System.out.println("peak-survey-checks="+checks+" passed=true");
    }
}
