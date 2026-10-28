import org.qiandengji.vortex.*;
import io.vortexcore.quest.*;
import java.util.*;
import java.time.Instant;

/** Observed hunger/healing, old quest retries and query loops, plus unknown-state boundaries. */
public final class RpgJourneyTest {
    static int checks;
    static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);checks++;}
    static QuestDefinition quest(String id,QuestObjectiveType type,String target,int n,int level,String prerequisite){return new QuestDefinition(id,id,"测试目标",level,prerequisite,"",0,false,List.of(new QuestObjectiveDefinition("goal",type,target,n,"执行目标")),List.of(new QuestRewardDefinition(QuestRewardType.CURRENCY,"",50)),"");}
    static PlayerQuestData data(QuestDefinition q,QuestProgress p){return new PlayerQuestData(UUID.randomUUID(),0,Map.of(q.id(),p),Map.of(),List.of(),Instant.now());}
    static RpgJourney.Facts facts(String job,int food,double health,double mana,long foodCd,List<String> missing){return new RpgJourney.Facts(job,2,health,30,food,mana,foodCd,0,true,false,false,false,0,missing,"world");}
    public static void main(String[] args){
        var hunt=quest("hunt",QuestObjectiveType.KILL_MOB,"zombie",2,1,"");var none=PlayerQuestData.create(UUID.randomUUID());var healthy=facts("knight",20,30,20,0,List.of());
        var hungry=RpgJourney.next(facts("",0,8,20,0,List.of()),List.of(hunt),none);
        check(hungry.command().equals("/mycli cast food"),"starvation chooses food before healing or class");
        check(hungry.action().contains("圣愈只回血"),"food differs explicitly from healing");
        check(RpgJourney.next(facts("knight",0,8,20,28000,List.of()),List.of(hunt),none).reason().equals("food_cooldown"),"cooldown forbids repeated food cast");
        check(RpgJourney.next(facts("knight",0,8,20,28000,List.of()),List.of(hunt),none).command().equals("/mycli guild shared"),"cooling spell has alternative supply route");
        check(RpgJourney.next(facts("knight",5,30,0,0,List.of()),List.of(hunt),none).reason().equals("food_mana_required"),"missing mana does not suggest consuming unavailable magic");
        check(RpgJourney.next(facts("knight",5,30,20,-1,List.of()),List.of(hunt),none).reason().equals("food_state_unavailable"),"unknown cooldown not invented as ready");
        check(RpgJourney.next(facts("knight",20,8,20,0,List.of()),List.of(hunt),none).command().equals("/mycli cast selfheal"),"low health and adequate food select healing");
        check(RpgJourney.next(facts("",20,30,20,0,List.of()),List.of(hunt),none).command().equals("/mycli profession list"),"unselected player gets choice not automatic selection");
        check(RpgJourney.next(healthy,List.of(hunt),none).command().equals("/mycli tasks list"),"selected player moves to own available tasks");
        var started=QuestProgress.start(hunt);var active=data(hunt,started);var next=RpgJourney.next(healthy,List.of(hunt),active);
        check(next.command().isEmpty()&&next.verify().endsWith("hunt"),"world action separated from verification query");
        check(next.action().contains("还差 2")&&next.text().contains("查询不会推进"),"missing count and anti-query-loop explanation");
        check(Boolean.TRUE.equals(next.data().get("requiresWorldAction"))&&!next.data().containsKey("nextCommand"),"no false executable command for a physical objective");
        check(RpgJourney.next(facts("knight",20,30,20,0,List.of("胸甲")),List.of(hunt),active).missing().equals(List.of("胸甲")),"live equipment gap returned exactly");
        var ready=started.withObjectives(List.of(new QuestObjectiveProgress("goal",2,2,true)));var done=data(hunt,ready);
        check(RpgJourney.next(healthy,List.of(hunt),done).command().equals("/mycli tasks claim hunt"),"ready objective points to actual settlement");
        check(RpgJourney.next(facts("",20,30,20,0,List.of()),List.of(hunt),done).step().equals("claim"),"ready reward not hidden behind a new class choice");
        var completed=data(hunt,ready.complete());
        check(RpgJourney.availability(hunt,completed,2).equals("completed"),"completion state is native hand-in not mere counter");
        check(!QuestText.info(hunt,completed,2).contains("tasks accept hunt"),"completed info no longer recommends reacceptance");
        check(QuestText.info(hunt,active,2).contains("0/2")&&!QuestText.info(hunt,active,2).contains("tasks accept hunt"),"active info returns own counts instead of reacceptance");
        check(QuestText.nextCommand(hunt,completed,2).equals("/mycli tasks list"),"completed machine receipt leaves old quest");
        var stale=data(hunt,started.withObjectives(List.of(new QuestObjectiveProgress("old",2,2,true))));
        check(!RpgJourney.next(healthy,List.of(hunt),stale).step().equals("claim"),"obsolete objective cannot make a reward claimable");
        var high=quest("boss",QuestObjectiveType.KILL_BOSS,"site_undead_crypt",1,4,"");
        check(RpgJourney.availability(high,none,2).equals("level_required"),"unavailable difficulty not recommended as eligible");
        check(!QuestText.info(high,none,2).contains("tasks accept boss"),"level-gated info cannot send player to a rejected action");
        var chain=quest("chain",QuestObjectiveType.KILL_MOB,"zombie",2,1,"hunt");
        check(RpgJourney.availability(chain,none,2).equals("prerequisite_required"),"unclaimed predecessor remains a blocker");
        check(RpgJourney.availability(chain,completed,2).equals("available"),"native completed record also satisfies prerequisite");
        var city=quest("city",QuestObjectiveType.VISIT_LOCATION,"aincrad:-512.5:67:889.5:8",1,1,"");
        check(RpgJourney.next(healthy,List.of(city),data(city,QuestProgress.start(city))).command().equals("/warp aincrad"),"different dimension gives real travel entry");
        check(RpgJourney.next(facts("knight",20,30,2,0,List.of()),List.of(city),data(city,QuestProgress.start(city))).reason().equals("travel_mana_required"),"travel recommendation respects real mana requirement");
        var craft=quest("craft",QuestObjectiveType.CRAFT_ITEM,"shield",1,1,"");
        check(RpgJourney.next(facts("knight",20,30,20,0,List.of("胸甲")),List.of(craft),data(craft,QuestProgress.start(craft))).action().contains("持有旧装备"),"craft objective not blocked by armor and distinguishes ownership from crafting");
        check(RpgJourney.next(healthy,List.of(high),data(high,QuestProgress.start(high))).command().equals("/mycli dungeon info undead_crypt"),"boss advice checks readiness instead of blindly starting");
        var pending=new RpgJourney.Facts("knight",2,30,30,20,20,0,0,true,false,false,true,0,List.of(),"world");
        check(RpgJourney.next(pending,List.of(hunt),done).reason().equals("operation_pending"),"saving barrier cannot recommend repeated claim");
        var unknown=new RpgJourney.Facts("knight",2,30,30,20,20,0,0,true,false,false,false,1,List.of(),"world");
        check(RpgJourney.next(unknown,List.of(hunt),done).reason().equals("reward_unverified"),"unverified reward stops reexecution");
        var down=new RpgJourney.Facts("knight",2,1,30,0,20,0,0,false,true,true,false,0,List.of(),"world");
        check(RpgJourney.next(down,List.of(hunt),done).step().equals("rescue"),"downed actor never receives a cast action");
        check(none.quests().isEmpty()&&active.quests().get("hunt").state()==QuestState.ACTIVE&&done.quests().get("hunt").state()==QuestState.ACTIVE,"all queries retain original immutable quest records");
        check(next.text().length()<300,"default goal remains bounded");
        System.out.println("rpg-journey="+checks);
    }
}
