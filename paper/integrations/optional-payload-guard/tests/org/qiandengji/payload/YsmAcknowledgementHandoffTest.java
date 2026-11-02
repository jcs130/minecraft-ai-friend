package org.qiandengji.payload;

import java.util.Arrays;

public final class YsmAcknowledgementHandoffTest {
    private static int checks;
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);checks++;}
    private static byte[] ack(){return new byte[]{52,5,'2','.','6','.','0'};}
    public static void main(String[] args){
        var handoff=new YsmAcknowledgementHandoff();Object player=new Object(),other=new Object(),auth=new Object(),game=new Object();
        check(!handoff.queue(player,game),"no client acknowledgement is never synthesized");
        for(byte[] bad:new byte[][]{null,new byte[0],{51,5,'2','.','6','.','0'},{52,5,'2','.','4','.','0'},{52,5,'2','.','6','.','0',0},{52},{6,0},{8,0}})
            check(!handoff.received(player,bad),"only exact original version acknowledgement is retained");
        byte[] original=ack();check(handoff.received(player,original),"received original acknowledgement accepted");original[0]=0;
        check(!handoff.queue(other,game),"another physical player cannot use the receipt");
        check(!handoff.queue(player,null),"missing target is not queued");
        check(handoff.queue(player,game)&&!handoff.queue(player,game),"concurrent callbacks coalesce to one pending send");
        check(handoff.take(player,auth)==null,"stale or wrong backend cannot consume receipt");
        byte[] first=handoff.take(player,game);check(Arrays.equals(first,ack()),"forwards an immutable copy of received bytes");first[1]=0;
        check(handoff.take(player,game)==null,"a task cannot run twice");
        check(handoff.queue(player,game),"failed send has one bounded retry");
        check(Arrays.equals(handoff.take(player,game),ack()),"retry preserves original bytes");
        check(!handoff.queue(player,game),"no unbounded retry loop");
        Object replacement=new Object();check(handoff.queue(player,replacement),"a genuine new backend connection has its own attempt budget");
        handoff.delivered(player,game);check(handoff.take(player,game)==null,"stale completion cannot affect a new backend");
        check(handoff.take(player,replacement)!=null,"new connection receives the actual receipt");handoff.delivered(player,replacement);
        check(!handoff.queue(player,replacement),"successful receipt is forwarded once per backend");
        check(handoff.received(player,ack())&&!handoff.queue(player,replacement),"repeated client messages do not reset send budget");
        handoff.left(player);check(!handoff.queue(player,new Object()),"disconnect removes the original session");
        String firstEqual=new String("same"),secondEqual=new String("same");handoff.received(firstEqual,ack());
        check(!handoff.queue(secondEqual,game),"names or equal values do not identify a physical connection");
        handoff.clear();check(!handoff.queue(firstEqual,game),"shutdown clears receipts");
        Object[] sessions=new Object[512];for(int i=0;i<sessions.length;i++){sessions[i]=new Object();check(handoff.received(sessions[i],ack()),"bounded session receipt "+i);}
        check(!handoff.received(new Object(),ack()),"session count is bounded");handoff.left(sessions[0]);
        check(handoff.received(new Object(),ack()),"disconnect frees bounded capacity");
        System.out.println("YsmAcknowledgementHandoffTest: "+checks+" checks passed");
    }
}
