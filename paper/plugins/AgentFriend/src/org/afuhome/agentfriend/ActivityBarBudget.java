package org.afuhome.agentfriend;

import java.util.regex.Pattern;

/** Village ambience only: fixed title, one last-minute change, 25% progress.
 * Combat bosses, raid danger, task navigation and rescue progress are excluded. */
final class ActivityBarBudget {
    private static final Pattern CLOCK=Pattern.compile("(?:\\||｜)\\s*(\\d+):(\\d{2})(?:\\D|$)");
    final String label;
    private float progress;
    private boolean lastMinute;
    ActivityBarBudget(String label,float initial,String title) {
        this.label=label;progress=quantize(initial);lastMinute=lastMinute(title);
    }
    static String label(String title) {
        if(title.contains("星灯夜巡"))return "☾ 星灯夜巡";
        if(title.contains("丰收时节"))return "✿ 丰收时节";
        if(title.contains("旅人顺风"))return "☆ 旅人顺风";
        return null;
    }
    static float quantize(float value) { return (float)(Math.ceil(Math.max(0,Math.min(1,value))*4-0.00001)/4); }
    private static boolean lastMinute(String title) {
        var m=CLOCK.matcher(title);
        return m.find() && Long.parseLong(m.group(1))*60+Long.parseLong(m.group(2))<=60;
    }
    synchronized boolean updateTitle(String title) {
        if(!lastMinute && lastMinute(title)){lastMinute=true;return true;}return false;
    }
    synchronized String title() { return label+(lastMinute?" · 最后1分钟":""); }
    synchronized float progress() { return progress; }
    synchronized boolean updateProgress(float actual) {
        float next=quantize(actual);if(next==progress)return false;progress=next;return true;
    }
}
