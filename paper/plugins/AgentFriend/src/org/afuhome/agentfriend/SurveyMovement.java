package org.afuhome.agentfriend;

/** Credits a new cell's continuous visit, rather than only its first sampled frame.
 * Per-cell caps prevent pacing inside one block from manufacturing an entire route.
 * Visited-cell ownership stays in the existing durable trail, so a return visit,
 * teleport or restart cannot renew the credit. This object itself is transient. */
final class SurveyMovement {
    record Credit(double distance,double milliseconds) { }
    private String point="";
    private boolean freshVisit;
    private double distance,milliseconds;
    Credit sample(String next,boolean fresh,double moved,long elapsed) {
        if(!next.equals(point)){point=next;freshVisit=fresh;distance=0;milliseconds=0;}
        if(!freshVisit||!Double.isFinite(moved)||moved<=0||elapsed<=0)return new Credit(0,0);
        double credited=Math.min(moved,Math.max(0,2-distance));
        double time=Math.min(elapsed*credited/moved,Math.max(0,2000-milliseconds));
        distance+=credited;milliseconds+=time;
        return new Credit(credited,time);
    }
}
