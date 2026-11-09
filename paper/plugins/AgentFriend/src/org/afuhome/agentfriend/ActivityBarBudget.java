package org.afuhome.agentfriend;

import org.afuhome.shared.ActivityBarSemantics;

/** WorldEvents remaining time only: bounded ten-second title changes, 5% progress.
 * Combat bosses, raid danger, task navigation and rescue progress are excluded. */
final class ActivityBarBudget {
    final String label;
    private float progress;
    private String rendered;
    ActivityBarBudget(String label,float initial,String title) {
        this.label=label;progress=quantize(initial);rendered=ActivityBarSemantics.title(label,ActivityBarSemantics.remainingSeconds(title));
    }
    static String label(String title) {
        var activity=ActivityBarSemantics.identify(title);return activity==null?null:activity.label();
    }
    static float quantize(float value) { return (float)(Math.ceil(Math.max(0,Math.min(1,value))*20-0.00001)/20); }
    synchronized boolean updateTitle(String title) {
        String next=ActivityBarSemantics.title(label,ActivityBarSemantics.remainingSeconds(title));
        if(rendered.equals(next))return false;rendered=next;return true;
    }
    synchronized String title() { return rendered; }
    synchronized float progress() { return progress; }
    synchronized boolean updateProgress(float actual) {
        float next=quantize(actual);if(next==progress)return false;progress=next;return true;
    }
}
