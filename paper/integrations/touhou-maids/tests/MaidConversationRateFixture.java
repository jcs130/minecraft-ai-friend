package local.tlmcompat.hybrid;

import java.util.UUID;
public final class MaidConversationRateFixture {
    static int checks;
    static void check(boolean ok,String label){checks++;if(!ok)throw new AssertionError(label);}
    public static void main(String[] args){
        var rate=new MaidConversationRate();UUID a=UUID.randomUUID(),b=UUID.randomUUID();long s=1_000_000_000L;
        rate.started(a,0,true);
        check(rate.retryAfterSeconds(a,s)==0,"companion invitation never charges its partner");
        for(int n=0;n<6;n++){
            check(rate.retryAfterSeconds(a,n*s)==0,"completed rapid turn "+n+" allowed");
            rate.started(a,n*s,false);
        }
        check(rate.retryAfterSeconds(a,6*s)==24,"seventh turn receives actual wait");
        check(rate.retryAfterSeconds(a,29*s+1)==1,"wait rounds up, not zero");
        check(rate.retryAfterSeconds(b,6*s)==0,"another player's budget is independent");
        check(rate.retryAfterSeconds(UUID.fromString(a.toString()),6*s)==24,"reconnect cannot reset actor budget");
        rate.started(a,7*s,true);
        check(rate.retryAfterSeconds(a,8*s)==22,"initiative cannot reset exhausted budget");
        check(rate.retryAfterSeconds(a,30*s)==0,"oldest request expires at exact boundary");
        rate.started(a,30*s,false);
        check(rate.retryAfterSeconds(a,30*s)==1,"only one slot becomes available");
        rate.prune(100*s);
        check(rate.retryAfterSeconds(a,100*s)==0,"expired actors are cleaned");
        System.out.println("PASS "+checks+" rapid-turn rate checks");
    }
}
