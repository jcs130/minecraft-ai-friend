package org.afuhome.agentfriend;
import com.google.gson.*;
import java.util.List;

public final class ProtectionGuidanceTest {
    private static int checks;
    private static void check(boolean ok){if(!ok)throw new AssertionError("Protection guidance check "+checks);checks++;}
    public static void main(String[] args){
        JsonObject mine=JsonParser.parseString("{\"status\":\"deny\",\"reason\":\"worldguard\",\"allowed\":false,\"action\":\"break\",\"actionLabel\":\"拆除方块\",\"world\":\"minecraft:overworld\",\"x\":1,\"y\":64,\"z\":2}").getAsJsonObject();
        String route="村庄地下不能深挖；到主世界村西矿坑入口，沿楼梯下到采掘层，再向西采矿；入口和楼梯不能拆。";
        mine.addProperty("regionGuidance",route);
        check(ProtectionQuery.nextAction(mine).equals(route));check(ProtectionQuery.compact(mine).get("nextAction").getAsString().equals(route));
        check(ProtectionChat.summary(mine).stream().anyMatch(s->s.contains(route)));
        var query=ProtectionQuery.parse(new String[]{"protect","batch","break","1,64,2"});
        check(ProtectionQuery.batch(query,"minecraft:overworld",List.of(mine)).getAsJsonArray("groups").get(0).getAsJsonObject().get("nextAction").getAsString().equals(route));
        mine.addProperty("boundsIncomplete",true);check(!ProtectionQuery.nextAction(mine).contains("矿坑"));check(ProtectionChat.summary(mine).stream().noneMatch(s->s.contains(route)));
        mine.remove("boundsIncomplete");mine.addProperty("reason","unknown_worldguard");check(!ProtectionQuery.nextAction(mine).equals(route));check(ProtectionChat.summary(mine).stream().noneMatch(s->s.contains(route)));
        System.out.println("PASS "+checks+" protection guidance checks: configured routes reach human, compact and batch receipts; unknown rules stay closed");
    }
}
