package org.afuhome.agentfriend;
import org.afuhome.shared.ActivityBarSemantics;
public final class ActivitySemanticsTest {
    private static int checks;
    private static void check(boolean value,String name){checks++;if(!value)throw new AssertionError(name);}
    public static void main(String[] args){
        String[] names={"星灯夜巡","丰收时节","旅人顺风","冒险者集结·试炼塔","冒险者集结·遗迹远征","冒险者集结·探索留影"};
        for(String name:names){
            String raw="☆ "+name+" | 8:07";var a=ActivityBarSemantics.identify(raw);
            check(a!=null,"known activity "+name);String title=ActivityBarSemantics.title(a.label(),487);
            check(title.contains("剩余约08:10"),"explicit approximate countdown");
            check(ActivityBarSemantics.sameActivity(raw,title),"raw/canonical equivalent");
            check(ActivityBarSemantics.sameActivity(title,ActivityBarSemantics.title(a.label(),480)),"small scheduling skew");
            check(!ActivityBarSemantics.sameActivity(raw,"☆ "+name+" | 1:00"),"separate generations");
        }
        for(String title:new String[]{"双生首领","试炼救援 6/10秒","任务 · 冒险者集结·探索留影","王·星灯夜巡 | 8:07","突袭 - 剩余2名袭击者"}){
            check(ActivityBarSemantics.identify(title)==null,"non activity "+title);
            check(!ActivityBarSemantics.sameActivity(title,title),"equal names do not imply shared identity");
        }
        check(ActivityBarSemantics.remainingSeconds("☆ 星灯夜巡 | 1:99")==-1,"invalid seconds unknown");
        check(ActivityBarSemantics.title("集结邀请·探索留影",-1).contains("待同步"),"missing time not zero");
        check(ActivityBarSemantics.identify("§a☆ 冒险者集结·探索留影 | 8:07")!=null,"legacy colors");
        check(!ActivityBarSemantics.sameActivity("☆ 星灯夜巡 | 8:07","☆ 旅人顺风 | 8:07"),"different activities");
        String label=ActivityBarBudget.label("☆ 冒险者集结·探索留影 | 8:07");
        check(label!=null&&label.contains("集结邀请"),"gathering covered");
        ActivityBarBudget budget=new ActivityBarBudget(label,.8f,"☆ 冒险者集结·探索留影 | 8:07");
        check(budget.title().contains("剩余约08:10"),"invitation is not completion");
        check(!budget.updateTitle("☆ 冒险者集结·探索留影 | 8:01"),"same bucket suppressed");
        check(budget.updateTitle("☆ 冒险者集结·探索留影 | 8:00"),"next bucket visible");
        check(Math.abs(budget.progress()-.8f)<.00001,"eighty percent remaining is not a full bar");
        System.out.println("PASS "+checks+" activity semantics checks");
    }
}
