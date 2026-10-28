package org.qiandengji.vortex;

import io.vortexcore.quest.*;
import java.util.*;

/** Read-only advice from native progress. No tutorial ledger, automatic actions or rewards. */
public final class RpgJourney {
    public record Facts(String classId,int level,double health,double maxHealth,int food,double mana,
            long foodCooldownMs,long healCooldownMs,boolean canAct,boolean downed,boolean inDungeon,
            boolean pending,int pendingRewards,List<String> missingEquipment,String world) {}
    public record Advice(String step,String reason,String action,String command,String verify,
                         String questId,List<String> missing) {
        public Map<String,Object> data(){
            var out=new LinkedHashMap<String,Object>();out.put("step",step);out.put("reason",reason);
            out.put("nextAction",action);out.put("verifyCommand",verify);out.put("queryOnly",true);
            out.put("requiresWorldAction",command.isEmpty());out.put("missing",missing);
            if(!command.isEmpty())out.put("nextCommand",command);
            if(!questId.isEmpty())out.put("questId",questId);
            return out;
        }
        public String text(){return "[当前目标] "+action+(command.isEmpty()?"；亲自行动，查询不会推进目标":"。下一步："+command)+"。核对："+verify;}
    }
    private static Advice advice(String step,String reason,String action,String command,String verify){
        return new Advice(step,reason,action,command,verify,"",List.of());
    }
    public static boolean completed(QuestDefinition q,PlayerQuestData data){
        var p=data.quests().get(q.id());
        return p!=null&&p.state()==QuestState.COMPLETED||data.completedQuestLog().contains(q.id());
    }
    public static String availability(QuestDefinition q,PlayerQuestData data,int level){
        var p=data.quests().get(q.id());
        if(p!=null&&p.state()==QuestState.ACTIVE)return QuestText.ready(q,p)?"ready_to_claim":"active";
        if(!q.repeatable()&&completed(q,data))return "completed";
        if(level<q.requiredLevel())return "level_required";
        if(q.hasPrerequisite()&&!data.completedQuestLog().contains(q.requiredQuest())&&
                !(data.quests().containsKey(q.requiredQuest())&&data.quests().get(q.requiredQuest()).state()==QuestState.COMPLETED))return "prerequisite_required";
        if(data.cooldowns().get(q.id())!=null&&data.cooldowns().get(q.id()).isAfter(java.time.Instant.now()))return "cooldown";
        return "available";
    }
    public static String label(String state){return switch(state){
        case "ready_to_claim"->"待交付";case "active"->"进行中";case "completed"->"已交付";
        case "level_required"->"等级不足";case "prerequisite_required"->"前置未交付";
        case "cooldown"->"冷却中";default->"可接取";
    };}
    public static Advice next(Facts f,Collection<QuestDefinition> definitions,PlayerQuestData data){
        return next(f,definitions,data,-1);
    }
    public static Advice next(Facts f,Collection<QuestDefinition> definitions,PlayerQuestData data,int freeSlots){
        if(f.downed())return advice("rescue","downed","倒地等待队友靠近救援；不要重放技能或任务动作","","/mycli dungeon status");
        if(!f.canAct())return advice("recover","state_blocked","先恢复为可行动角色；死亡需先重生，观战角色不必做战斗引导","","/mycli status");
        if(f.pending())return advice("confirm","operation_pending","上一操作仍在保存；先核对结果，不要重复执行","/mycli progress","/mycli progress");
        if(f.pendingRewards()>0)return advice("confirm","reward_unverified","有奖励待核对；保留原记录并联系服主，不重复领奖","/mycli tasks status","/mycli tasks status");
        if(f.food()<=14){
            if(f.mana()>=3&&f.foodCooldownMs()==0)return advice("survival","hungry","饱食 "+f.food()+"/20；饱食术补4点，圣愈只回血、不补饥饿","/mycli cast food","/mycli status");
            if(f.foodCooldownMs()>0)return advice("survival","food_cooldown","饱食 "+f.food()+"/20；饱食术还需 "+((f.foodCooldownMs()+999)/1000)+"秒，先吃随身熟食；无食物去共享补给，不反复施法","/mycli guild shared","/mycli status");
            return advice("survival",f.mana()<3?"food_mana_required":"food_state_unavailable","饱食 "+f.food()+"/20；先吃熟食或领补给；饱食术需3魔力，治疗不能代替进食",f.mana()<3?"/mycli guild shared":"/mycli skills info food","/mycli status");
        }
        if(f.health()<=f.maxHealth()*.4){
            if(f.mana()>=6&&f.healCooldownMs()==0)return advice("survival","low_health","生命偏低，先用圣愈术恢复；遇敌先撤到安全位置","/mycli cast selfheal","/mycli status");
            return advice("survival","heal_unavailable","生命偏低，先撤到安全处、进食或等治疗冷却；不要重复施法","/mycli skills info selfheal","/mycli status");
        }
        if(f.inDungeon())return advice("dungeon","in_dungeon","正在副本中；按本场目标推进，倒地等队友救援，清场后按回执返回结算","/mycli dungeon status","/mycli dungeon status");
        if(freeSlots==0)return advice("storage","inventory_full","随身36格已占用；选择材料用 arena stash putslot <槽> <数量> 直接远程存箱（成功2魔力）；多余装备 arena recycle list；查询不会腾出格子","","/mycli inventory");
        var active=definitions.stream().filter(q->{var p=data.quests().get(q.id());return p!=null&&p.state()==QuestState.ACTIVE;})
            .sorted(Comparator.<QuestDefinition>comparingInt(q->QuestText.ready(q,data.quests().get(q.id()))?0:1)
                .thenComparing(Comparator.comparingDouble((QuestDefinition q)->fraction(q,data.quests().get(q.id()))).reversed()).thenComparing(QuestDefinition::id)).toList();
        if(!active.isEmpty()&&QuestText.ready(active.getFirst(),data.quests().get(active.getFirst().id()))){
            var q=active.getFirst();return new Advice("claim","quest_ready",q.name()+"目标已完成，主动交付才领取奖励","/mycli tasks claim "+q.id(),"/mycli tasks status "+q.id(),q.id(),List.of());
        }
        if(f.classId().isEmpty()||f.classId().equals("none"))return advice("class","class_required","选择喜欢的职业：骑士/法师/游侠/牧师/驯兽师/工程师；基础生存技能已可用","/mycli profession list","/mycli profession status");
        if(!active.isEmpty()){
            var q=active.getFirst();var progress=data.quests().get(q.id());
            var remaining=q.objectives().stream().filter(o->!objectiveDone(o,progress)).toList();
            if(remaining.isEmpty())return advice("confirm","quest_definition_changed","任务目标与记录不一致；先核对，不重接或领奖","/mycli tasks status "+q.id(),"/mycli tasks status "+q.id());
            var o=remaining.getFirst();String verify="/mycli tasks status "+q.id();
            boolean combat=o.type()==QuestObjectiveType.KILL_MOB||o.type()==QuestObjectiveType.KILL_BOSS;
            if(combat&&!f.missingEquipment().isEmpty())return new Advice("equip","equipment_missing","战斗前先装备；缺少："+String.join("、",f.missingEquipment())+"；穿在身上，放背包不算护甲","/mycli guild shared",verify,q.id(),f.missingEquipment());
            if(o.type()==QuestObjectiveType.KILL_BOSS){
                String site=o.target().startsWith("site_")?o.target().substring(5):"";
                return new Advice("dungeon","quest_active",q.name()+"；先确认难度、开放状态和本场条件，故障或关闭时换目标，不原地死等",site.matches("[a-z0-9_]{1,48}")?"/mycli dungeon info "+site:"/mycli dungeon list",verify,q.id(),List.of());
            }
            if(o.type()==QuestObjectiveType.VISIT_LOCATION){
                String[] target=o.target().split(":");
                if(target.length==5&&!target[0].equals(f.world())){
                    int cost=q.id().equals("qd_floor_scout")?8:target[0].equals("aincrad")?6:0;
                    if(f.mana()<cost)return new Advice("explore","travel_mana_required",q.name()+"；前往目标需 "+cost+"魔力，当前不足；先安全等待恢复，不重复传送","/mycli status",verify,q.id(),List.of());
                    return new Advice("explore","different_world",q.name()+"；目标在 "+target[0]+"，当前在 "+f.world()+"；到场后走动才能记录",q.id().equals("qd_floor_scout")?"/mycli dungeon travel aincrad_01":target[0].equals("aincrad")?"/warp aincrad":"/mycli tasks info "+q.id(),verify,q.id(),List.of());
                }
            }
            int current=progress.objectives().stream().filter(x->x.objectiveId().equals(o.id())).mapToInt(QuestObjectiveProgress::current).findFirst().orElse(0);
            String detail=QuestText.objective(o)+"，还差 "+Math.max(0,o.amount()-current);
            if(o.type()==QuestObjectiveType.CRAFT_ITEM)detail+="；在工作台实际制作，持有旧装备或从箱子取出不计数";
            if(o.type()==QuestObjectiveType.KILL_MOB)detail+="；在村外找真实目标，白天无怪可换探索任务，不必死等";
            return new Advice("quest","quest_active",q.name()+"："+detail,"",verify,q.id(),List.of());
        }
        boolean available=definitions.stream().anyMatch(q->availability(q,data,f.level()).equals("available"));
        return advice(available?"choose_task":"explore",available?"quest_available":"no_eligible_task",
            available?"任选近期讨伐、城市巡访或装备制作；已交付任务不用重接，领取经验与金币后整备冒险":"当前没有可接的原生任务；可探索、组队或查看适合自己的副本，不用等旧任务刷新",
            available?"/mycli tasks list":"/mycli dungeon list",available?"/mycli tasks status":"/mycli dungeon status");
    }
    private static boolean objectiveDone(QuestObjectiveDefinition o,QuestProgress p){return p.objectives().stream().anyMatch(v->v.objectiveId().equals(o.id())&&v.current()>=o.amount()&&v.completed());}
    private static double fraction(QuestDefinition q,QuestProgress p){return q.objectives().isEmpty()?0:q.objectives().stream().mapToDouble(o->p.objectives().stream().filter(v->v.objectiveId().equals(o.id())).mapToDouble(v->Math.min(1,(double)v.current()/Math.max(1,o.amount()))).findFirst().orElse(0)).average().orElse(0);}
}
