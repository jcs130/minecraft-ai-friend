package local.tlmcompat.hybrid;

public final class MaidConversationInitiativeFixture {
    static int count;
    static void check(boolean ok,String label){count++;if(!ok)throw new AssertionError(label);}
    public static void main(String[] args){
        var p=new MaidConversationInitiative();long s=1_000_000_000L;
        check(!p.opportunity(0,false,"town",0,0),"absent partner never triggers");
        check(!p.opportunity(s,true,"town",0,0),"no immediate login greeting");
        check(!p.opportunity(45*s,true,"town",0,0),"settle period");
        check(p.opportunity(46*s,true,"town",0,0),"settled companionship opportunity");
        check(!p.opportunity(100*s,true,"rain",0,0),"changing weather cannot bypass quiet time");
        check(!p.opportunity(271*s,true,"town",0,0),"unchanged idle scene never repeats");
        check(p.opportunity(271*s,true,"rain",0,0),"real scene change after quiet time");
        p.spoken(440*s);
        check(!p.opportunity(500*s,true,"night",0,0),"player conversation postpones initiative");
        check(p.opportunity(620*s,true,"night",0,0),"scene opportunity after player quiet time");
        check(!p.opportunity(800*s,true,"night",63,0),"tiny movement is not new exploration");
        check(p.opportunity(800*s,true,"night",64,0),"actual travel supports new topic");
        check(!p.opportunity(810*s,false,"",0,0),"combat/world/distance gate ends together period");
        check(!p.opportunity(900*s,true,"end",200,0),"reunion must settle again");
        check(p.opportunity(990*s,true,"end",200,0),"reunion with changed scene eventually permits topic");
        check(!p.opportunity(2000*s,true,"end",200,0),"no polling retry of unchanged opportunity");
        check(p.opportunity(2000*s,true,"end",200,0,1),"confirmed nearby action offers a relevant topic in unchanged terrain");
        check(!p.opportunity(2120*s,true,"end",200,0,1),"same action is not repeated after cooldown");
        check(!p.opportunity(2100*s,true,"end",200,0,2),"new action cannot bypass two-minute quiet period");
        check(p.opportunity(2120*s,true,"end",200,0,2),"fresh action after quiet period supports a short comment");
        check(!p.opportunity(2240*s,true,"end",200,0,0),"expiring observation does not invent another topic");
        System.out.println("PASS "+count+" companion initiative checks");
    }
}
