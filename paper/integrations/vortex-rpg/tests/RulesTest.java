import org.qiandengji.vortex.BridgeRules;
import io.vortexcore.quest.QuestService;
import java.util.*;

public final class RulesTest {
    static int count;
    static void check(boolean value){if(!value)throw new AssertionError("check "+count);count++;}
    static void rejects(String... words){try{BridgeRules.parse(words);throw new AssertionError(Arrays.toString(words));}catch(IllegalArgumentException expected){count++;}}
    public static void main(String[] args){
        check(BridgeRules.GROUPS.size()==7);
        for(String group:BridgeRules.GROUPS){var r=BridgeRules.parse(new String[]{"rpg",group,"choose","knight","--help","--json"});check(r.help()&&r.json()&&r.group().equals(group));}
        check(BridgeRules.parse(new String[]{"rpg","cast","fortify"}).arguments().equals(List.of("fortify")));
        check(BridgeRules.parse(new String[]{"rpg","status","--json"}).json());
        for(var entry:Map.of("profession","class","tasks","quests","trade","shop","waypoint","town").entrySet())check(BridgeRules.parse(new String[]{entry.getKey(),"list"}).group().equals(entry.getValue()));
        check(BridgeRules.parse(new String[]{"skills","status"}).action().equals("status"));
        check(BridgeRules.parse(new String[]{"tasks","abandon","qd_first_hunt","--json"}).arguments().equals(List.of("qd_first_hunt")));
        rejects("tasks","abandon");rejects("tasks","abandon","qd_first_hunt","other");
        for(String[] words:List.of(new String[]{"other"},new String[]{"status","extra"},new String[]{"class","choose","../x"},new String[]{"--oops"},new String[]{"cast"},new String[]{"class","choose","a","b","c"}))rejects(words);
        check(QuestService.locationMatches("aincrad:1:67:2:4","aincrad",1,67,2));
        check(!QuestService.locationMatches("aincrad:1:67:2:4","world",1,67,2));
        check(!QuestService.locationMatches("aincrad:1:67:2:4","aincrad",100,67,2));
        check(!QuestService.locationMatches("aincrad:1:67:2:4","aincrad",1,74,2));
        check(QuestService.locationMatches("aincrad:1:67:2:4","aincrad",5,67,2));
        check(!QuestService.locationMatches("aincrad:1:67:2:0","aincrad",1,67,2));
        check(!QuestService.locationMatches("aincrad:1:67:2:129","aincrad",1,67,2));
        for(String value:List.of("NaN","Infinity","bad",""))check(!QuestService.locationMatches("aincrad:"+value+":67:2:4","aincrad",1,67,2));
        check(QuestService.locationMatches("aincrad","aincrad",1,67,2));
        check(!QuestService.locationMatches(null,"aincrad",1,67,2));
        System.out.println("rules="+count);
    }
}
