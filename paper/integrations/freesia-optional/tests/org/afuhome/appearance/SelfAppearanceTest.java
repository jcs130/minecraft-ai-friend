package org.afuhome.appearance;

import java.util.*;
import java.util.concurrent.*;

public final class SelfAppearanceTest {
    private static int count;
    private static final UUID PLAYER=UUID.fromString("c6cc3202-7ad0-3fcb-ade7-b7c7e5984453");
    private static final Map<String,List<String>> CATALOG=Map.of(
        "qiandengji_naruto",List.of("skin"),"public_fox",List.of("white","red"),"猫娘",List.of("白色"));
    private static void check(boolean condition,String label) {if(!condition)throw new AssertionError(label);count++;}
    private static SelfAppearance.Result begin(SelfAppearance flow,Object connection,long epoch,boolean ready,int workers,long time,String... args) {
        return flow.begin(PLAYER,connection,epoch,"ag_Naruto",ready,workers,CATALOG,args,time);
    }
    public static void main(String[] args) throws Exception {
        var flow=new SelfAppearance();var connection=new Object();long now=1_000_000;
        check(SelfAppearance.validTarget(PLAYER,PLAYER.toString()),"native API may bind its exact own UUID");
        check(!SelfAppearance.validTarget(PLAYER,UUID.randomUUID().toString()),"another body's UUID is not an own target");
        check(!SelfAppearance.validTarget(PLAYER,"角色名;stop"),"native UUID path does not permit command text");
        check(begin(flow,connection,1,false,1,now,"set","qiandengji_naruto").selection()==null,"unauthenticated/limbo connection refused");
        check(begin(flow,connection,-1,true,1,now,"set","qiandengji_naruto").selection()==null,"unknown session refused");
        check(begin(flow,connection,1,true,0,now,"set","qiandengji_naruto").selection()==null,"offline worker refused");
        check(begin(flow,connection,1,true,2,now,"set","qiandengji_naruto").selection()==null,"ambiguous worker refused");
        check(begin(flow,connection,1,true,1,now,"set","another_player","qiandengji_naruto","skin").selection()==null,"no target argument accepted");
        check(begin(flow,connection,1,true,1,now,"set","private_model","skin").selection()==null,"nonpublic model refused");
        check(begin(flow,connection,1,true,1,now,"set","../private","skin").selection()==null,"path traversal refused");
        check(begin(flow,connection,1,true,1,now,"set","qiandengji_naruto\" stop","skin").selection()==null,"model command injection refused");
        check(begin(flow,connection,1,true,1,now,"set","qiandengji_naruto","skin\" true").selection()==null,"texture command injection refused");
        check(begin(flow,connection,1,true,1,now,"set","public_fox").selection()==null,"multiple textures require explicit choice");
        check(begin(flow,connection,1,true,1,now,"set","public_fox","skin").selection()==null,"cross-model texture refused");
        var result=begin(flow,connection,1,true,1,now,"set","qiandengji_naruto");
        check(result.selection()!=null,"ordinary authenticated connection may select own public model");
        check(result.selection().player().equals(PLAYER),"immutable original UUID retained");
        check(result.selection().command().equals("ysm model set ag_Naruto \"qiandengji_naruto\" \"skin\" false"),"only own name, native command, no model-authorization bypass");
        check(begin(flow,connection,1,true,1,now+1,"set","qiandengji_naruto").selection()==null,"duplicate submission does not dispatch twice");
        check(flow.observe(PLAYER,connection,1,true,"old_model","skin",now+2)==null,"request accepted is not application confirmed");
        check(flow.observe(PLAYER,connection,1,true,"qiandengji_naruto","skin",now+3).contains("已应用"),"actual native matching selection confirms application");
        check(flow.observe(PLAYER,connection,1,true,"qiandengji_naruto","skin",now+4)==null,"confirmation emitted once");
        check(begin(flow,connection,1,true,1,now+5,"set","public_fox","white").selection()==null,"same account cooldown retained");
        check(begin(flow,connection,1,true,1,now+30_000,"set","public_fox","white").selection()!=null,"explicit subsequent selection allowed after cooldown");
        check(flow.observe(PLAYER,connection,2,true,"public_fox","white",now+30_001)==null,"new world epoch never accepts old request");
        check(begin(flow,connection,2,true,1,now+60_000,"set","public_fox","white").selection()!=null,"new epoch can issue own new request");
        check(flow.observe(PLAYER,new Object(),2,true,"public_fox","white",now+60_001)==null,"new connection identity cannot confirm old connection request");
        begin(flow,connection,3,true,1,now+90_000,"set","public_fox","red");
        check(flow.observe(PLAYER,connection,3,true,"public_fox","white",now+105_000).contains("未自动重试"),"timed-out result remains unknown without replay");
        check(flow.observe(PLAYER,connection,3,true,"public_fox","red",now+105_001)==null,"late confirmation does not fabricate a completed request");
        var unicode=begin(flow,connection,3,true,1,now+120_000,"set","猫娘");
        check(unicode.selection().command().contains("\"猫娘\" \"白色\" false"),"verified Unicode model and texture names supported");
        flow.left(PLAYER);
        check(flow.observe(PLAYER,connection,3,true,"猫娘","白色",now+120_001)==null,"logout retires confirmation state");
        var concurrent=new SelfAppearance();var pool=Executors.newFixedThreadPool(2);
        try {
            Callable<Boolean> call=()->begin(concurrent,connection,4,true,1,now,"set","qiandengji_naruto").selection()!=null;
            var futures=pool.invokeAll(List.of(call,call));
            check(futures.stream().filter(f->{try{return f.get();}catch(Exception e){throw new RuntimeException(e);}}).count()==1,"racing duplicate commands dispatch once");
        } finally {pool.shutdownNow();}
        System.out.println("PASS "+count+" self appearance identity, authority, receipt and replay checks");
    }
}
