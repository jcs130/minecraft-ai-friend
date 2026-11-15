package org.qiandengji.payload;

import java.util.Arrays;

public final class YsmAcknowledgementHandoffTest {
    private static int checks;
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);checks++;}
    private static byte[] ack(){return new byte[]{52,5,'2','.','6','.','0'};}
    private static byte[] greeting(){return new byte[]{51,5,'2','.','6','.','0'};}
    public static void main(String[] args){
        var handoff=new YsmAcknowledgementHandoff();Object player=new Object(),other=new Object(),firstGame=new Object(),nextGame=new Object();
        check(!handoff.queueForGreeting(player,firstGame,greeting()),"first game handshake waits for an actual reply");
        for(byte[] bad:new byte[][]{null,new byte[0],{51,5,'2','.','6','.','0'},{52,5,'2','.','4','.','0'},{52,5,'2','.','6','.','0',0},{52},{6,0},{8,0}})
            check(!handoff.received(player,firstGame,bad),"only exact original version acknowledgement is retained");
        byte[] original=ack();check(handoff.received(player,firstGame,original),"game acknowledgement is retained");original[0]=0;
        check(!handoff.queueForGreeting(player,firstGame,greeting()),"acknowledging the current backend needs no replay");
        check(!handoff.queueForGreeting(other,nextGame,greeting()),"another physical player cannot use the receipt");
        check(!handoff.queueForGreeting(player,null,greeting()),"missing target is not queued");
        check(!handoff.queueForGreeting(player,nextGame,new byte[]{6,0}),"a model packet is not a native greeting");
        check(!handoff.queueForGreeting(player,nextGame,new byte[]{51,5,'2','.','4','.','0'}),"another protocol does not trigger a replay");
        check(handoff.queueForGreeting(player,nextGame,greeting())&&!handoff.queueForGreeting(player,nextGame,greeting()),"duplicate greetings schedule one replay");
        check(handoff.take(player,firstGame)==null,"a stale backend cannot take the pending replay");
        byte[] replay=handoff.take(player,nextGame);check(Arrays.equals(replay,ack()),"replacement backend receives the original bytes");replay[1]=0;
        check(handoff.take(player,nextGame)==null&&!handoff.queueForGreeting(player,nextGame,greeting()),"one replay attempt per replacement connection");
        Object direct=new Object();check(handoff.queueForGreeting(player,direct,greeting()),"new game greeting starts a distinct replay window");
        check(handoff.received(player,direct,ack())&&handoff.take(player,direct)==null,"a fresh reply during the grace period wins");
        Object switched=new Object();check(handoff.queueForGreeting(player,switched,greeting()),"a later connection may reuse the original reply");
        Object newest=new Object();check(handoff.queueForGreeting(player,newest,greeting()),"new greeting supersedes the old pending target");
        check(handoff.take(player,switched)==null&&Arrays.equals(handoff.take(player,newest),ack()),"stale callbacks cannot steal or modify the receipt");
        handoff.left(player);check(!handoff.queueForGreeting(player,new Object(),greeting()),"disconnect removes the original session");
        String firstEqual=new String("same"),secondEqual=new String("same");handoff.received(firstEqual,firstGame,ack());
        check(!handoff.queueForGreeting(secondEqual,nextGame,greeting()),"names or equal values do not identify a physical connection");
        handoff.clear();check(!handoff.queueForGreeting(firstEqual,nextGame,greeting()),"shutdown clears receipts");
        Object[] sessions=new Object[512];for(int i=0;i<sessions.length;i++){sessions[i]=new Object();check(handoff.received(sessions[i],firstGame,ack()),"bounded session receipt "+i);}
        check(!handoff.received(new Object(),firstGame,ack()),"session count is bounded");handoff.left(sessions[0]);
        check(handoff.received(new Object(),firstGame,ack()),"disconnect frees bounded capacity");
        System.out.println("YsmAcknowledgementHandoffTest: "+checks+" checks passed");
    }
}
