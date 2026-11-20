package org.afuhome.agentfriend;

import java.util.List;

public final class GuildRankPointsTest {
    private static int checks;

    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
        checks++;
    }

    public static void main(String[] args) {
        int[] thresholds = {0,4,8,12,14,18,22,24,28,32,36,40,48,54,60,68,76,84};
        for (int grade = 0; grade < thresholds.length; grade++)
            check(GuildRankPoints.target(grade) == thresholds[grade], "target " + grade);
        check(GuildRankPoints.preview(0,0,0,5).gain() == 4, "first beginner contract fills introductory division");
        check(GuildRankPoints.preview(4,0,0,7).gain() == 4, "basic contract");
        check(GuildRankPoints.preview(4,0,0,8).gain() == 6, "advanced starts at eight fame");
        check(GuildRankPoints.preview(7,0,0,14).gain() == 6, "advanced upper boundary");
        check(GuildRankPoints.preview(7,0,0,15).gain() == 9, "high contract lower boundary");
        check(GuildRankPoints.preview(9,0,0,23).gain() == 9, "high upper boundary");
        check(GuildRankPoints.preview(9,0,0,24).gain() == 12, "expert contract");
        check(GuildRankPoints.preview(4,0,0,15,true).gain()==4, "one lantern delivered from existing inventory is a basic contract");
        check(GuildRankPoints.preview(12,0,0,80,true).gain()==0, "a high posted fame does not make pure deliveries advanced");
        check(GuildRankPoints.preview(9,0,0,15,false).gain()==9, "an expedition ending in delivery retains the complete job rating");
        check(GuildRankPoints.preview(8,0,0,6).gain() == 2, "silver receives half for a basic contract");
        check(GuildRankPoints.preview(8,0,1,6).gain() == 1, "second under-tier completion halves again");
        check(GuildRankPoints.preview(13,0,0,6).reason().equals("below_range"), "platinum practice");
        check(GuildRankPoints.preview(13,0,0,8).gain() == 3, "platinum advanced contract");
        check(GuildRankPoints.preview(13,0,1,15).gain() == 4, "half of odd award rounds down");
        check(GuildRankPoints.preview(13,0,2,80).gain() == 0, "third completion of the same expert template");
        check(GuildRankPoints.preview(17,0,0,24).reason().equals("max_grade"), "highest grade does not bank points");
        check(GuildRankPoints.preview(5,20,0,24).after() == 22, "no overflow into silver");
        check(GuildRankPoints.preview(5,22,0,15).reason().equals("points_ready"), "ready to attempt promotion");
        var history = List.of("db_20261119_copper","db_20261120_copper","tm_chart","tm_chart","deep_explorer");
        check(GuildRankPoints.legacyCredit(5,history)==6, "three distinct historical templates");
        check(GuildRankPoints.legacyCredit(0,history)==4, "history is limited to the current division");
        check(GuildRankPoints.legacyCredit(17,history)==0, "no migration beyond top grade");
        check(GuildRankPoints.template("db_20261119_mine_survey").equals("db_mine_survey"), "daily dates share one template");
        check(GuildRankPoints.template("tm_expedition_map").equals("tm_expedition_map"), "destination-based market work shares its original task key");
        for(int grade=0;grade<17;grade++) {
            int target=GuildRankPoints.target(grade+1);
            for(int fame:List.of(1,7,8,14,15,23,24,100)) {
                for(int old:List.of(0,target-1,target)) {
                    var first=GuildRankPoints.preview(grade,old,0,fame);
                    var second=GuildRankPoints.preview(grade,old,1,fame);
                    var third=GuildRankPoints.preview(grade,old,2,fame);
                    check(first.gain()>=second.gain() && second.gain()>=0 && third.gain()==0, "diminishing rewards");
                    check(first.after()<=target && second.after()<=target && third.after()==old, "bounded current division");
                }
            }
        }
        System.out.println("GuildRankPointsTest: " + checks + " passed");
    }
}
