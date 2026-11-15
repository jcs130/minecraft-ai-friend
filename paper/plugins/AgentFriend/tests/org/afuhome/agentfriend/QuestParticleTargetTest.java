package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

public final class QuestParticleTargetTest {
    private static int checks;
    private static void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
    private static QuestParticleTarget.Point resolve(String text){
        return QuestParticleTarget.resolve(JsonParser.parseString(text).getAsJsonObject(),"uuid-a","minecraft:overworld","world",0,65,0);
    }
    public static void main(String[] args){
        check(resolve("{}") == null,"no target is not invented");
        check(resolve("{target:{world:'aincrad',x:10,y:65,z:0}}") == null,"same coordinates in a different world do not point nearby");
        check(resolve("{target:{world:'world',worldUuid:'uuid-b',x:10,y:65,z:0}}") == null,"UUID takes priority over matching world name");
        var npc=resolve("{target:{world:'minecraft:overworld',x:10,y:64,z:0}}");
        check(npc!=null&&npc.x()==10&&npc.y()==65,"native NPC target is supported");
        var map=resolve("{phase:'travel_to_marker',navigation:{worldUuid:'uuid-a',x:120,z:0}}");
        check(map!=null&&map.x()==24&&map.y()==65,"distant map is a bounded bearing, never fabricated entrance depth");
        check(resolve("{phase:'find_entrance',navigation:{worldUuid:'uuid-a',x:120,z:0}}") == null,"map centre is not an entrance");
        check(resolve("{phase:'survey',navigation:{worldUuid:'uuid-a',x:120,z:0}}") == null,"survey does not keep directing back to map marker");
        var home=resolve("{phase:'return_to_acceptance_point',returnTo:{worldUuid:'uuid-a',x:-10,y:64,z:0},navigation:{worldUuid:'uuid-a',x:120,z:0}}");
        check(home!=null&&home.x()==-10,"return journey points to recorded acceptance point");
        check(resolve("{target:{world:'world',x:0,y:64,z:2}}") == null,"arrived player gets no particle loop");
        check(resolve("{target:{world:'world',x:'NaN',y:64,z:10}}") == null,"NaN rejected");
        check(resolve("{target:{world:'world',x:[],y:64,z:10}}") == null,"malformed numeric data does not break tracking");
        check(resolve("{target:{world:'world',x:10,y:null,z:10}}") == null,"unknown vertical coordinate is not zero");
        check(resolve("{target:{world:'world',x:10}}") == null,"partial coordinates ignored");
        System.out.println("QUEST_PARTICLES passed=true checks="+checks);
    }
}
