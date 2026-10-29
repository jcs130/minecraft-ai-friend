import java.util.*;import java.util.concurrent.CompletionException;
import org.qiandengji.vortex.*;
public final class RpgFailureTest {
    static int count;
    static void check(boolean value,String label){if(!value)throw new AssertionError(label);count++;}
    public static void main(String[] args){
        var cast=new BridgeRules.Request("cast","cast",List.of("fortify"),false,false);
        for(var e:Map.of("技能尚在冷却，剩余：6.922s","cooldown","Spell is on cooldown for 1.1s","cooldown","魔力不足，请先恢复；本次未施放、未进入冷却。","insufficient_mana","[no_valid_target] 范围内没有符合条件的敌对目标","no_valid_target","已经选择职业：骑士","class_already_selected","Requires level 6.","level_required","需要等级：6.","level_required","You need 2 skill point(s).","insufficient_skill_points","Insufficient talent points.","insufficient_talent_points","Missing prerequisite talent: iron_skin","prerequisite_required").entrySet()){
            var a=RpgFailure.describe(new CompletionException(new IllegalStateException(e.getKey())),cast);check(a.reason().equals(e.getValue()),e.getKey());check(a.nextCommand().startsWith("/mycli "),"one executable recovery");check(a.data().get("success").equals(false),"never false success");
        }
        var cooldown=RpgFailure.describe(new IllegalStateException("技能尚在冷却，剩余：6.922s"),cast);check(cooldown.retryAfterMs()==6922L,"actual cooldown retained");
        var unknown=RpgFailure.describe(new IllegalStateException("SQL error with private/path"),cast);check(unknown.outcome().equals("unknown")&&!unknown.text().contains("private/path"),"unknown result not leaked or misclassified as unexecuted");
        var task=new BridgeRules.Request("quests","claim",List.of("qd_first_hunt"),true,false);var a=RpgFailure.describe(new IllegalStateException("目标未完成、已领取或当前不能交付；查询：/mycli tasks status"),task);check(a.nextCommand().equals("/mycli tasks status qd_first_hunt"),"focused quest recovery");
        var menu=new BridgeRules.Request("class","menu",List.of(),true,false);var linkage=RpgFailure.describe(new NoSuchMethodError("private internal interface"),menu);check(linkage.reason().equals("service_unavailable"),"runtime API incompatibility has a recovery");check(linkage.nextCommand().equals("/mycli profession status"),"failed menu recovers to a text query");check(linkage.outcome().equals("unknown")&&!linkage.text().contains("private internal"),"no false completion or private API leak");
        System.out.println("RPG failure guidance="+count);
    }
}
