package org.qiandengji.vortex;

import io.vortexcore.quest.*;
import java.util.*;

/** A bounded read-only projection of native quest definitions and progress. */
public final class QuestText {
    private QuestText(){}
    public static String info(QuestDefinition q){
        String requirements="Lv"+q.requiredLevel()+(q.hasPrerequisite()?"；前置 "+q.requiredQuest():"");
        String objectives=String.join("、",q.objectives().stream().map(o->objective(o)+"×"+o.amount()).toList());
        String rewards=String.join("、",q.rewards().stream().map(r->switch(r.type()){
            case EXPERIENCE->number(r.amount())+"经验";
            case CURRENCY->number(r.amount())+"金币";
            case ITEM->r.value()+"×"+number(r.amount());
            case PERMISSION->"权限 "+r.value();
            case COMMAND->"配置奖励（交付时执行）";
        }).toList());
        return q.name()+" ["+q.id()+"]；需要 "+requirements+"；"+q.description()+"；目标："+objectives+"；奖励："+rewards+"。接取：/mycli tasks accept "+q.id();
    }
    public static String progress(QuestDefinition q,QuestProgress p){
        if(p.state()==QuestState.COMPLETED)return q.name()+" ["+q.id()+"] 已交付";
        if(p.state()!=QuestState.ACTIVE)return q.name()+" ["+q.id()+"] 已退出；详情：/mycli tasks info "+q.id();
        List<String> rows=new ArrayList<>();
        for(var o:q.objectives()){
            var current=p.objectives().stream().filter(v->v.objectiveId().equals(o.id())).findFirst();
            rows.add(objective(o)+" "+current.map(QuestObjectiveProgress::current).orElse(0)+"/"+o.amount());
        }
        boolean ready=ready(q,p);
        return q.name()+" ["+q.id()+"]："+String.join("、",rows)+(ready?"；可交付：/mycli tasks claim "+q.id():"；继续完成缺少目标，暂不领奖");
    }
    public static String info(QuestDefinition q,PlayerQuestData data,int level){
        String definition=info(q);definition=definition.substring(0,definition.lastIndexOf("。接取："));
        String state=RpgJourney.availability(q,data,level);
        return definition+"；本人："+RpgJourney.label(state)+"。"+switch(state){
            case "completed"->"已交付，无需重复接取或领奖。改选：/mycli tasks list";
            case "active","ready_to_claim"->progress(q,data.quests().get(q.id()))+"；核对：/mycli tasks status "+q.id()+"；若要放弃：/mycli tasks abandon "+q.id()+"（重新接取会重新计数，不回城）";
            case "level_required"->"需要Lv"+q.requiredLevel()+"，本人Lv"+level+"；先选较短任务：/mycli tasks list";
            case "prerequisite_required"->"先交付前置 "+q.requiredQuest()+"；核对：/mycli tasks status "+q.requiredQuest();
            case "cooldown"->"任务冷却中，先选其他任务：/mycli tasks list";
            default->"主动接取：/mycli tasks accept "+q.id();
        };
    }
    public static String nextCommand(QuestDefinition q,PlayerQuestData data,int level){return switch(RpgJourney.availability(q,data,level)){
        case "ready_to_claim"->"/mycli tasks claim "+q.id();case "active"->"/mycli tasks status "+q.id();
        case "available"->"/mycli tasks accept "+q.id();case "prerequisite_required"->"/mycli tasks status "+q.requiredQuest();
        default->"/mycli tasks list";
    };}
    public static boolean ready(QuestDefinition q,QuestProgress p){return p!=null&&p.state()==QuestState.ACTIVE&&!q.objectives().isEmpty()&&q.objectives().stream().allMatch(o->p.objectives().stream().anyMatch(v->v.objectiveId().equals(o.id())&&v.current()>=o.amount()&&v.completed()));}
    public static String objective(QuestObjectiveDefinition o){
        String type=switch(o.type().name()){
            case "KILL_MOB"->"击杀";case "MINE_BLOCK"->"采集";case "GATHER_ITEM"->"收集";
            case "CRAFT_ITEM"->"制作";case "VISIT_LOCATION"->"到达";case "FISH_ITEM"->"钓取";
            case "CAST_SPELL"->"施放";case "REACH_LEVEL"->"达到等级";case "TALK_TO_NPC"->"交谈";case "KILL_BOSS"->"讨伐首领";
            default->o.type().name();
        };
        String text=o.description()!=null&&!o.description().isBlank()?o.description():type+" "+o.target();
        if(o.type()==QuestObjectiveType.VISIT_LOCATION){String[] target=o.target().split(":");if(target.length==5)text+="（"+target[0]+" "+target[1]+","+target[2]+","+target[3]+"，半径"+target[4]+"）";}
        return text;
    }
    private static String number(double n){return n==Math.rint(n)?Long.toString((long)n):Double.toString(n);}
}
