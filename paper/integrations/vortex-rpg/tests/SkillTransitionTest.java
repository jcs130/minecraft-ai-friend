import org.qiandengji.vortex.SkillTransition;
public final class SkillTransitionTest {
 public static void main(String[] args){int count=0;
  for(String id:SkillTransition.LEGACY){if(!SkillTransition.reason(id).equals("skill_retired")||!SkillTransition.message(id,true).contains("已停用")||!SkillTransition.message(id,true).contains("不扣魔力")||!SkillTransition.message(id,true).contains("/mycli skills list"))throw new AssertionError(id);count++;}
  if(!SkillTransition.message("not_a_skill",false).contains("unknown_skill")||!SkillTransition.next(false).equals("/mycli profession list"))throw new AssertionError("unknown/unselected");count++;
  if(SkillTransition.LEGACY.contains("home")||SkillTransition.LEGACY.contains("fortify")||SkillTransition.LEGACY.contains("mend"))throw new AssertionError("live/common spell retired");count++;
  for(String id:SkillTransition.COMMON){if(SkillTransition.LEGACY.contains(id))throw new AssertionError("basic survival skill retired: "+id);count++;}
  if(!SkillTransition.targets(java.util.List.of(java.util.Map.of("type","self"))).equals("自己"))throw new AssertionError("self");count++;
  if(!SkillTransition.targets(java.util.List.of(java.util.Map.of("type","nearby_monster","range",20,"limit",1))).contains("20格"))throw new AssertionError("range");count++;
  if(!SkillTransition.targets(java.util.List.of(java.util.Map.of("type","nearby_player","range",8))).contains("附近其他玩家（8格"))throw new AssertionError("group healing target");count++;
  if(!SkillTransition.targets(java.util.List.of(java.util.Map.of("type","ray","range",24))).contains("准星指向（24格"))throw new AssertionError("ray target");count++;
  if(!SkillTransition.effects(java.util.List.of(java.util.Map.of("type","damage","base",5,"scaling-attribute","intelligence"))).contains("智力"))throw new AssertionError("damage");count++;
  if(!SkillTransition.effects(java.util.List.of(java.util.Map.of("type","apply_effect","effect","arcane_ward"))).contains("奥术护盾"))throw new AssertionError("effect");count++;
  System.out.println("PASS "+count+" skill transition policies");
 }
}
