package org.afuhome.agentfriend;
import java.util.*;
public final class GameplayGuideTest {
    static int checks;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    public static void main(String[] args){
        var entries=GameplayGuide.entries(Set.of("AgentFriend","VortexRPG","WorldEvents","Vault","Citizens","NPCSpeak","QiandengVoice"),true,true,true);
        check(entries.size()==18,"bounded complete discovery index");
        check(entries.stream().map(GameplayGuide.Entry::id).distinct().count()==18,"unique stable feature IDs");
        for(var entry:entries){check(entry.command().startsWith("/"),"actual route "+entry.id());check(!entry.state().equals("unavailable"),"ready provider "+entry.id());}
        check(GameplayGuide.page(entries,1).size()==6&&GameplayGuide.page(entries,3).size()==6&&GameplayGuide.page(entries,4).isEmpty(),"six rows per page");
        var missing=GameplayGuide.entries(Set.of(),false,false,false);check(missing.stream().filter(e->e.state().equals("unavailable")).count()==17,"unknown missing dependencies do not become ready");
        check(missing.stream().filter(e->e.id().equals("appearance")).findFirst().orElseThrow().state().equals("external_service"),"proxy appearance is not inferred absent");
        check(GameplayGuide.parse(new String[]{"world","list","--page","2","--json"}).equals(new GameplayGuide.Query(2,true)),"normal CLI flags");
        for(String[] invalid:List.of(new String[]{"world","list","2"},new String[]{"world","list","--page","0"},new String[]{"world","list","--page"},new String[]{"world","list","--json","--json"},new String[]{"world","list","--page","x"})){boolean refused=false;try{GameplayGuide.parse(invalid);}catch(IllegalArgumentException expected){refused=true;}check(refused,"invalid options rejected");}
        check(entries.stream().filter(e->e.id().equals("trade")).findFirst().orElseThrow().note().contains("拍卖交付尚未开放"),"no fake auction readiness");
        System.out.println("GameplayGuideTest: "+checks+" passed");
    }
}
