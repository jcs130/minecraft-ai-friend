package dev.qiandeng.irons;
import java.nio.charset.StandardCharsets;
public final class TownBlockMaskTest {
    static int checks;
    static void check(boolean ok){checks++;if(!ok)throw new AssertionError("check "+checks);}
    static TownBlockMask parse(String runs,String count)throws Exception{return TownBlockMask.parse(("{\"schema\":1,\"dimension\":\"minecraft:overworld\",\"blocks\":"+count+",\"runs\":"+runs+"}").getBytes(StandardCharsets.UTF_8));}
    public static void main(String[] args)throws Exception{
        var mask=parse("[[-600,-598,64,850],[-600,-600,67,850]]","4");
        check(mask.ready&&mask.size()==4);check(mask.protects("minecraft:overworld",-600,64,850));
        check(!mask.protects("minecraft:overworld",-600,65,850));
        check(!mask.protects("minecraft:the_nether",-600,64,850));
        check(!mask.protects("minecraft:overworld",-597,64,850));
        for(String runs:new String[]{"[]","[[-600,-598,320,850]]","[[-716,-714,64,850]]","[[-600,-598,64,694]]","[[-598,-600,64,850]]","[[-600,-598,64,850],[-599,-599,64,850]]","[[-600,-598,64.1,850]]","[[\"-600\",-598,64,850]]"}){
            boolean denied=false;try{parse(runs,"3");}catch(Exception e){denied=true;}check(denied);
        }
        boolean denied=false;try{parse("[[-600,-598,64,850]]","2");}catch(Exception e){denied=true;}check(denied);
        var installed=TownBlockMask.load();check(installed.ready&&installed.size()>10000&&installed.sha256.length()==64);
        System.out.println("{\"ok\":true,\"checks\":"+checks+"}");
    }
}
