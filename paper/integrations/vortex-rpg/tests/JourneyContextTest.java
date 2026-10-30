import org.qiandengji.vortex.RpgJourney;
import java.util.*;
public class JourneyContextTest {
    static int checks;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    public static void main(String[] args){
        var free=new RpgJourney.Advice("choose_task","quest_available","选任务","/mycli tasks list","/mycli tasks status","",List.of());
        var guild=new HashMap<String,Object>(Map.of("status","active","activeId","party_oath","advice","先去试炼塔入口","nextCommand","/mycli goto arena","requiresWorldAction",false));
        var result=RpgJourney.withContext(free,guild,null);check(result.command().equals("/mycli goto arena")&&result.questId().equals("party_oath"),"existing guild quest is discoverable");
        guild.put("requiresWorldAction",true);result=RpgJourney.withContext(free,guild,null);check(result.command().isEmpty()&&result.verify().equals("/mycli guild status"),"physical action not replaced by query loop");
        check(RpgJourney.withContext(free,null,null)==free,"no fake guild quest");
        var nativeActive=new RpgJourney.Advice("quest","quest_active","击杀","","/mycli tasks status qd_first_hunt","qd_first_hunt",List.of());
        check(RpgJourney.withContext(nativeActive,guild,null)==nativeActive,"does not replace active native quest");
        var busy=new RpgJourney.Advice("dungeon","in_dungeon","副本","/mycli dungeon status","/mycli dungeon status","",List.of());
        var trial=Map.<String,Object>of("participant",true,"reason","fight_remaining","nextAction","清本层怪物","nextCommand","/mycli arena status","requiresWorldAction",true);
        result=RpgJourney.withContext(busy,null,trial);check(result.verify().equals("/mycli arena status")&&result.command().isEmpty(),"tower participant receives tower facts rather than site status");
        check(RpgJourney.withContext(busy,null,Map.of("participant",false))==busy,"site participant not relabeled tower");
        guild.put("requiresWorldAction",false);guild.put("nextCommand","/op someone\n/mycli guild claim");check(RpgJourney.withContext(free,guild,null).command().equals("/mycli guild status"),"invalid observation command is not promoted");
        guild.put("status","none");check(RpgJourney.withContext(free,guild,null)==free,"empty old slot is not active");
        System.out.println("JourneyContextTest: "+checks+" passed");
    }
}
