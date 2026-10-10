package org.afuhome.agentfriend;

import com.google.gson.JsonObject;

/** Fixed-size trajectory accumulator. No Bukkit, interpolation, raw sample log or disk writes. */
final class SkillTrajectory {
    record Sample(long time, AssessmentCatalog.Point point, double yaw, boolean airborne, boolean safeGround) { }
    final AssessmentCatalog.Definition definition;
    private Sample previous;
    private double lastDx, lastDz;
    private long groundedAt;
    private int checkpoint, samples, gaps, landedJumps;
    private double horizontal, backwards, ascent, descent, largestTurn, jumpStartY, jumpApex, startY, peakY;
    private boolean jumpActive, ready;
    SkillTrajectory(AssessmentCatalog.Definition definition) {this.definition=definition;}
    void jump(double y) {jumpActive=true;jumpStartY=y;jumpApex=y;groundedAt=0;previous=null;lastDx=lastDz=0;}
    String accept(Sample current, boolean powered, boolean landingGrace) {
        if(ready)return "ready";
        var course=definition.course();if(course==null||!course.contains(current.point))return "outside_course";
        samples++;
        if(previous==null){if(samples==1){startY=current.point.y();peakY=startY;}previous=current;return "sampling";}
        long elapsed=current.time-previous.time;
        double dx=current.point.x()-previous.point.x(),dy=current.point.y()-previous.point.y(),dz=current.point.z()-previous.point.z();
        double distance=Math.sqrt(dx*dx+dy*dy+dz*dz),flat=Math.hypot(dx,dz);
        if(elapsed<=0||elapsed>750){gaps++;previous=current;lastDx=lastDz=0;groundedAt=0;return "sampling_gap";}
        // Bounded native flight/velocity observations; a gap never invents a traversed segment.
        boolean flying=definition.primitive().equals("flight_route");
        // A 16-block native leap starts near 40 blocks/s vertically. Paid flight uses
        // a separate 16 blocks/s envelope; applying that envelope to leaps rejects valid casts.
        if(distance>Math.max(3,elapsed/1000.0*(flying?16:44))){previous=null;return "impossible_displacement";}
        boolean observedAir=current.airborne && previous.airborne;
        if(flying && observedAir && powered || !flying && observedAir && jumpActive) {
            horizontal+=flat;peakY=Math.max(peakY,current.point.y());ascent=Math.max(ascent,current.point.y()-startY);descent=Math.max(descent,peakY-current.point.y());
            if(flat>=.08) {
                double yaw=Math.toRadians(current.yaw),dot=(-Math.sin(yaw)*dx+Math.cos(yaw)*dz)/flat;
                if(dot<=-.7)backwards+=flat;
                if(Math.hypot(lastDx,lastDz)>=.08) {
                    double cosine=(lastDx*dx+lastDz*dz)/(Math.hypot(lastDx,lastDz)*flat);
                    largestTurn=Math.max(largestTurn,Math.toDegrees(Math.acos(Math.max(-1,Math.min(1,cosine)))));
                }
                lastDx=dx;lastDz=dz;
            }
            if(flying && checkpoint<course.checkpoints().size() && current.point.distance(course.checkpoints().get(checkpoint))<=definition.radius())checkpoint++;
        }
        if(jumpActive)jumpApex=Math.max(jumpApex,current.point.y());
        var landingPoint=!flying&&checkpoint<course.checkpoints().size()?course.checkpoints().get(checkpoint):course.landing();
        boolean landing=current.safeGround && current.point.distance(landingPoint)<=definition.radius() && flat<=.18 && Math.abs(dy)<=.1;
        if(landing && (powered||landingGrace||!flying)) {
            if(groundedAt==0)groundedAt=current.time;
            if(current.time-groundedAt>=definition.stableSeconds()*1000L) {
                if(!flying&&jumpActive) {
                    if(jumpApex-jumpStartY>=definition.ascent()){landedJumps++;checkpoint++;}
                    jumpActive=false;
                }
                ready=checkpoint>=course.checkpoints().size() && horizontal>=definition.horizontal()
                        && (!flying ? landedJumps>=definition.jumps() : ascent>=definition.ascent()&&descent>=1
                        && largestTurn>=definition.turn()&&backwards>=definition.backwards());
            }
        }else groundedAt=0;
        previous=current;return ready?"ready":"sampling";
    }
    int checkpoint() {return checkpoint;}
    boolean ready() {return ready;}
    JsonObject measurements() {
        JsonObject o=new JsonObject();o.addProperty("horizontalDistance",round(horizontal));o.addProperty("backwardsDistance",round(backwards));
        o.addProperty("ascent",round(ascent));o.addProperty("descent",round(descent));o.addProperty("turnDegrees",round(largestTurn));
        o.addProperty("checkpoints",checkpoint);o.addProperty("landedJumps",landedJumps);o.addProperty("jumpHeight",round(jumpApex-jumpStartY));
        o.addProperty("samples",samples);o.addProperty("samplingGaps",gaps);o.addProperty("landingStableMs",groundedAt==0||previous==null?0:Math.max(0,previous.time-groundedAt));return o;
    }
    private static double round(double d){return Math.round(d*100)/100.0;}
}
