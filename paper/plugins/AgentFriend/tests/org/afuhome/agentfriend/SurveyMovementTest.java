package org.afuhome.agentfriend;

public final class SurveyMovementTest {
    private static int checks;
    private static void check(String name,boolean pass){if(!pass)throw new AssertionError(name);checks++;}
    public static void main(String[] args) {
        SurveyMovement m=new SurveyMovement();double distance=0,time=0;
        for(int block=0;block<24;block++)for(int frame=0;frame<4;frame++){var c=m.sample(block+",4,677",frame==0,.25,250);distance+=c.distance();time+=c.milliseconds();}
        check("24 slow new metres credit 24 rather than 6",Math.abs(distance-24)<1e-9);
        check("continuous movement time not lost between cell crossings",time==24000);
        var first=m.sample("new",true,.5,300);check("new cell credits native movement",first.distance()==.5&&first.milliseconds()==300);
        double repeatedDistance=0,repeatedTime=0;
        for(int n=0;n<100;n++){var c=m.sample("new",false,.4,250);repeatedDistance+=c.distance();repeatedTime+=c.milliseconds();}
        check("pacing in one cell is capped",repeatedDistance<=1.500001&&repeatedTime<=1700);
        check("remaining cap cannot be renewed",m.sample("new",false,1,1000).distance()==0);
        m.sample("old-cell",false,1,1000);
        check("old cell grants no movement",m.sample("old-cell",false,1,1000).distance()==0);
        check("return to visited new cell grants no second credit",m.sample("new",false,1,1000).distance()==0);
        SurveyMovement restart=new SurveyMovement();check("restart cannot renew a persisted visited cell",restart.sample("new",false,1,1000).distance()==0);
        check("invalid displacement adds nothing",restart.sample("bad",true,Double.NaN,250).distance()==0);
        check("zero movement adds no wait time",restart.sample("stationary",true,0,1000).milliseconds()==0);
        SurveyMovement sprint=new SurveyMovement();check("ordinary sprint remains credited",sprint.sample("sprint",true,1.3,250).distance()==1.3);
        SurveyMovement bounded=new SurveyMovement();var capped=bounded.sample("cell",true,24,3000);check("one cell cannot mint long route",capped.distance()==2&&capped.milliseconds()<=2000);
        System.out.println("SurveyMovementTest: "+checks+" passed");
    }
}
