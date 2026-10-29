import org.qiandengji.vortex.QuestText;
import io.vortexcore.quest.*;
import java.util.*;
import java.time.Instant;

public final class QuestTextTest {
 static int checks;
 static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
 public static void main(String[]args){
  var objective=new QuestObjectiveDefinition("zombies",QuestObjectiveType.KILL_MOB,"ZOMBIE",2,"击杀僵尸");
  var q=new QuestDefinition("first_hunt","初次讨伐","短途冒险",1,"intro","guild",0,false,List.of(objective),List.of(new QuestRewardDefinition(QuestRewardType.EXPERIENCE,"",180),new QuestRewardDefinition(QuestRewardType.CURRENCY,"",50)),"");
  String info=QuestText.info(q);check(info.contains("击杀僵尸×2"),"exact objective amount");check(info.contains("前置 intro"),"prerequisite");check(info.contains("180经验、50金币"),"actual rewards");check(info.endsWith("/mycli tasks accept first_hunt"),"one next action");
  var now=Instant.now();var started=QuestProgress.start(q);String progress=QuestText.progress(q,started);check(progress.contains("0/2"),"initial progress");check(!progress.contains("可交付"),"not ready before action");
  var partial=new QuestProgress(q.id(),QuestState.ACTIVE,List.of(new QuestObjectiveProgress("zombies",1,2,false)),now,null);
  check(QuestText.progress(q,partial).contains("1/2"),"partial progress");
  var done=partial.withObjectives(List.of(new QuestObjectiveProgress("zombies",2,2,true)));check(QuestText.progress(q,done).endsWith("/mycli tasks claim first_hunt"),"actual ready action");
  var stale=partial.withObjectives(List.of(new QuestObjectiveProgress("old_target",2,2,true)));check(!QuestText.progress(q,stale).contains("可交付"),"old objective not counted");
  check(!QuestText.progress(q,partial.withObjectives(List.of())).contains("可交付"),"empty snapshot not complete");
  check(QuestText.progress(q,done.complete()).endsWith("已交付"),"completed differs from ready");
  check(!QuestText.progress(q,done.complete()).contains("tasks claim"),"no repeated claim recommendation");
  System.out.println("quest-guidance="+checks);
 }
}
