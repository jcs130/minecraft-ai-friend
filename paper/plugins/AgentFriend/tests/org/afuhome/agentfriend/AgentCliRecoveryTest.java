package org.afuhome.agentfriend;

import com.google.gson.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Rejected intents must yield current commands without executing, guessing targets or requiring a model. */
public final class AgentCliRecoveryTest {
    private static int checks;
    private static void check(boolean value,String why){if(!value)throw new AssertionError(why);checks++;}
    private static String[] words(String line){return line.split(" +");}
    private static List<AgentCliRecovery.Match> find(String line,List<AgentCliRecovery.Card> cards,AgentCliRecovery.Context context){return AgentCliRecovery.suggest(words(line),cards,context);}
    private static void invalid(Runnable action){try{action.run();throw new AssertionError("invalid vector accepted");}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args)throws Exception{
        var cards=AgentCliCatalog.recoveryCards(List.of(),true);
        var context=new AgentCliRecovery.Context(Set.of("undead_crypt","aincrad_01"),Set.of("DeepFish","Yui"));
        for(String intent:List.of("cast dungeon info undead_crypt","cast dungeon claim undead_crypt","cast dungeon start undead_crypt","cast dungeon_claim undead_crypt")){
            var routed=find(intent,cards,context);String action=intent.contains("info")?"info":intent.contains("start")?"start":"claim";
            check(routed.size()==1&&routed.getFirst().method().equals("misplaced_cast_prefix")&&routed.getFirst().nextCommand().equals("/mycli dungeon "+action+" undead_crypt"),"exact command-prefix correction: "+intent);
            var result=AgentCliRecovery.payload(routed,cards,"COMMAND_ROUTE_MISMATCH","入口不匹配");
            check(!result.get("autoExecute").getAsBoolean()&&!result.get("changed").getAsBoolean(),"routing suggestion never executes "+intent);
        }
        check(AgentCliRecovery.misplacedCast(words("cast dungeon claim private_unknown"),cards,context).getFirst().nextCommand().equals("/mycli dungeon claim --help"),"unconfirmed destination remains a help query");
        check(AgentCliRecovery.misplacedCast(words("cast dungeon unexpected undead_crypt"),cards,context).getFirst().nextCommand().equals("/mycli dungeon --help"),"unknown subcommand is not endorsed");
        var collision=new ArrayList<>(cards);collision.add(new AgentCliRecovery.Card("cast.dungeon","/mycli cast dungeon","real configured spell","real validator"));
        check(AgentCliRecovery.misplacedCast(words("cast dungeon claim undead_crypt"),collision,context).isEmpty(),"real configured spell wins namespace collision");
        for(String valid:List.of("cast blink","cast starbolt","dungeon info undead_crypt","cast unknown_ability","cast give bread"))check(AgentCliRecovery.misplacedCast(words(valid),cards,context).isEmpty(),"leave valid or unknown spell dispatch alone: "+valid);
        for(String command:List.of("cast travel undead_crypt","teleport undead_crypt","dungeon teleport undead_crypt","传送 墓穴 undead_crypt")){
            var matches=find(command,cards,context);check(matches.size()==1&&matches.getFirst().nextCommand().equals("/mycli dungeon travel undead_crypt"),"preserve confirmed dungeon target: "+command);
            var payload=AgentCliRecovery.payload(matches,cards,"command_route_mismatch","入口不匹配");
            check(!payload.get("changed").getAsBoolean()&&!payload.get("autoExecute").getAsBoolean()&&payload.get("readOnly").getAsBoolean(),"recovery is advice only");
            check(AgentCliRecovery.text(payload).size()<=4&&payload.toString().length()<3500,"bounded advice");
        }
        check(find("teleport deepfish",cards,context).getFirst().nextCommand().equals("/mycli locate tp DeepFish"),"reuse actual online name and canonical teammate route");
        check(find("teleport Yui undead_crypt",cards,context).stream().allMatch(m->Set.of("/mycli dungeon list","/mycli locate list").contains(m.nextCommand())),"multiple real targets require selection rather than picking an action");
        var unknown=find("teleport unknown_secret_destination",cards,context);
        check(unknown.stream().noneMatch(m->m.nextCommand().contains("unknown_secret_destination")),"unknown target cannot become an executable destination");
        check(find("tp Yui",cards,AgentCliRecovery.Context.empty()).stream().noneMatch(m->m.nextCommand().equals("/mycli locate tp Yui")),"offline/unconfirmed target not filled");
        var typo=find("waypont list",cards,context);check(!typo.isEmpty()&&typo.getFirst().card().usage().startsWith("/mycli waypoint"),"typing correction uses the current waypoint tree");
        var home=find("回家 村庄出生点",cards,context);check(home.stream().anyMatch(m->m.nextCommand().equals("/mycli cast home")),"Chinese intent finds actual home entry");
        var team=find("传送 队友",cards,context);check(team.stream().anyMatch(m->m.card().usage().startsWith("/mycli locate tp")),"ambiguous teammate intent offers actual usage");
        var health=find("selfhel",cards,context);check(health.stream().anyMatch(m->m.card().usage().equals("/mycli cast selfheal")),"spell spelling retrieves actual basic skill");
        for(String input:List.of("teleport password example_secret","tp srv_abcdefghijklmnopqrstuvxyz","teleport\nadmin","authorization bearer value"))check(find(input,cards,context).isEmpty(),"credential/control input is not indexed or echoed");
        check(find("teleport x",cards,new AgentCliRecovery.Context(Set.of("x\nadmin"),Set.of("x;admin"))).stream().noneMatch(m->m.method().startsWith("confirmed_")),"context names cannot inject commands");
        check(AgentCliRecovery.query(new String[33]).isEmpty(),"bounded input");
        check(!AgentCliRecovery.revision(cards).equals(AgentCliRecovery.revision(cards.subList(1,cards.size()))),"catalog revision follows enabled entries");
        String clean=AgentCliRecovery.semanticQuery(words("teleport DeepFish undead_crypt"),context);check(!clean.toLowerCase(Locale.ROOT).contains("deepfish")&&!clean.contains("undead_crypt"),"known identities not sent to embeddings");
        invalid(()->AgentCliRecovery.cosine(new double[]{1,2},new double[]{1,2,3}));
        invalid(()->AgentCliRecovery.cosine(new double[]{0,0},new double[]{1,2}));
        invalid(()->AgentCliRecovery.cosine(new double[]{Double.NaN,1},new double[]{1,2}));
        invalid(()->AgentCliRecovery.cosine(new double[]{Double.MAX_VALUE,1},new double[]{Double.MAX_VALUE,1}));
        var two=List.of(new AgentCliRecovery.Card("cast.home","/mycli cast home","回家","6魔力"),new AgentCliRecovery.Card("locate.tp","/mycli locate tp <名字>","找队友","8魔力"));
        AtomicInteger calls=new AtomicInteger();HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/embeddings",exchange->{try{
            int count=calls.incrementAndGet();JsonObject request=JsonParser.parseString(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();
            var inputs=request.getAsJsonArray("input");var rows=new JsonArray();
            for(int n=inputs.size()-1;n>=0;n--){var row=new JsonObject();row.addProperty("index",n);row.add("embedding",JsonParser.parseString(count==1?(n==0?"[1,0]":"[0,1]"):"[1,0]"));row.addProperty("command","/forged-do-not-use");rows.add(row);}
            var result=new JsonObject();result.addProperty("model","fixture-model");result.add("data",rows);byte[] bytes=result.toString().getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);
        }finally{exchange.close();}});server.start();
        try(var index=new CommandEmbeddingIndex(URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/embeddings"),"fixture-model","",500)){
            var matched=index.lookup(words("返回起点"),two,AgentCliRecovery.Context.empty());
            check(matched.getFirst().nextCommand().equals("/mycli cast home"),"real HTTP vector response only ranks supplied catalog commands");
            check(matched.getFirst().method().equals("semantic_embedding")&&calls.get()==2,"actual corpus and query requests");
            index.lookup(words("回到安全区"),two,AgentCliRecovery.Context.empty());check(calls.get()==3,"same revision reuses document vectors");
        }finally{server.stop(0);}
        long[] times=new long[30];for(int n=0;n<times.length;n++){long start=System.nanoTime();find("waypont list",cards,context);times[n]=(System.nanoTime()-start)/1000;}Arrays.sort(times);
        System.out.println("RECOVERY_TESTS_OK checks="+checks+" catalog="+cards.size()+" lookupP50us="+times[15]+" lookupP95us="+times[28]+" neuralFixtureOnly=true productionModelTested=false");
    }
}
