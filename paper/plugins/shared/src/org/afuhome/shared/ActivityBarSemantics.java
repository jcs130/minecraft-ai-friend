package org.afuhome.shared;

import java.util.List;
import java.util.regex.Pattern;

/** Reserved WorldEvents activities only. Equal arbitrary boss/quest names are not identities. */
public final class ActivityBarSemantics {
    public record Activity(String id,String legacy,String label,boolean invitation) { }
    private static final List<Activity> ACTIVITIES=List.of(
        new Activity("qd-clear-sight","星灯夜巡","活动·星灯夜巡",false),
        new Activity("qd-harvest","丰收时节","活动·丰收时节",false),
        new Activity("qd-traveler","旅人顺风","活动·旅人顺风",false),
        new Activity("qd-trial-gather","冒险者集结·试炼塔","集结邀请·试炼塔",true),
        new Activity("qd-ruins-gather","冒险者集结·遗迹远征","集结邀请·遗迹远征",true),
        new Activity("qd-explorers-gather","冒险者集结·探索留影","集结邀请·探索留影",true));
    private static final Pattern COLORS=Pattern.compile("(?i)§[0-9a-fk-orx]");
    private static final Pattern ICONS=Pattern.compile("[\\s☾✿☆★⚔◈☀]*");
    private static final Pattern CLOCK=Pattern.compile("(?:\\||｜)\\s*(?:剩余约?)?\\s*(\\d{1,4}):(\\d{2})\\s*$");
    private ActivityBarSemantics(){ }
    public static Activity identify(String raw){
        if(raw==null)return null;String text=COLORS.matcher(raw).replaceAll("").strip();
        for(Activity a:ACTIVITIES){
            int at=text.indexOf(a.legacy());
            if(at>=0&&ICONS.matcher(text.substring(0,at)).matches()){
                String tail=text.substring(at+a.legacy().length()).strip();
                if(tail.isBlank()||CLOCK.matcher(tail).matches()||tail.equals("· 最后1分钟"))return a;
            }
            if(text.startsWith(a.label())){
                String tail=text.substring(a.label().length()).strip();
                if(tail.isBlank()||CLOCK.matcher(tail).matches()||tail.equals("｜剩余时间待同步"))return a;
            }
        }
        return null;
    }
    public static int remainingSeconds(String title){
        if(title==null)return -1;var m=CLOCK.matcher(COLORS.matcher(title).replaceAll("").strip());
        if(!m.find())return -1;int seconds=Integer.parseInt(m.group(2));return seconds<60?Integer.parseInt(m.group(1))*60+seconds:-1;
    }
    public static String title(String label,int seconds){
        if(seconds<0)return label+"｜剩余时间待同步";
        int rounded=((seconds+9)/10)*10;
        return label+"｜剩余约"+String.format(java.util.Locale.ROOT,"%02d:%02d",rounded/60,rounded%60);
    }
    public static boolean sameActivity(String a,String b){
        Activity left=identify(a),right=identify(b);
        if(left==null||right==null||!left.id().equals(right.id()))return false;
        int x=remainingSeconds(a),y=remainingSeconds(b);
        // Different event generations or unknown-vs-known clocks remain separate.
        return x<0&&y<0 || x>=0&&y>=0&&Math.abs(x-y)<=10;
    }
}
