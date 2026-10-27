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
            case CURRENCY->number(r.amount())+"货币";
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
        boolean ready=!q.objectives().isEmpty()&&q.objectives().stream().allMatch(o->p.objectives().stream().anyMatch(v->v.objectiveId().equals(o.id())&&v.current()>=o.amount()&&v.completed()));
        return q.name()+" ["+q.id()+"]："+String.join("、",rows)+(ready?"；可交付：/mycli tasks claim "+q.id():"；继续完成缺少目标，暂不领奖");
    }
    private static String objective(QuestObjectiveDefinition o){
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
