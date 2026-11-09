package local.tlmcompat.hybrid;

import java.util.HashSet;

public final class MaidAmbientPatrolFixture {
    static int checks;
    static void check(boolean ok,String label){checks++;if(!ok)throw new AssertionError(label);}
    public static void main(String[] args){
        var ambient=new MaidAmbientPolicy();String idle="touhou_little_maid:maid.mode.idle";
        check(ambient.choose(idle,0,false)==null,"unattended area stays quiet");
        var lines=new HashSet<String>();
        for(int i=0;i<6;i++){
            String line=ambient.choose(idle,i*180_000_000_000L,true);
            check(line!=null&&lines.add(line),"native idle event chooses a different line");
            check(ambient.choose(idle,i*180_000_000_000L+15_000_000_000L,true)==null,"repeated idle event is throttled");
        }
        check(ambient.choose("minecraft:entity.villager.ambient",2_000_000_000_000L,true)==null,"other entities never use shared TTS");
        check(ambient.choose("touhou_little_maid:maid.ai.death",2_000_000_000_000L,true)==null,"death does not create speech");
        check(ambient.choose("touhou_little_maid:maid.ai_chat",2_000_000_000_000L,true)==null,"no duplicate LLM placeholder");
        check(MaidCompanionPolicy.hostileCandidate(false,true,false,false,true,true,true,true),"visible untargeted hostile is proactively eligible");
        check(!MaidCompanionPolicy.hostileCandidate(false,true,true,false,true,true,true,true),"peaceful neutral mob is not attacked");
        check(MaidCompanionPolicy.hostileCandidate(true,true,true,false,true,true,true,true),"an actually attacking neutral can be defended against");
        check(!MaidCompanionPolicy.hostileCandidate(false,true,false,true,true,true,true,true),"team mate never attacked");
        check(!MaidCompanionPolicy.hostileCandidate(false,true,false,false,false,true,true,true),"stationary protected decorative mob not attacked");
        check(!MaidCompanionPolicy.hostileCandidate(false,true,false,false,true,false,true,true),"no seeing through walls");
        check(!MaidCompanionPolicy.hostileCandidate(false,true,false,false,true,true,false,true),"no long range pursuit");
        check(!MaidCompanionPolicy.hostileCandidate(false,true,false,false,true,true,true,false),"native target restrictions retained");
        check(MaidCompanionPolicy.choose(true,false,false,false,true,true,0)==MaidCompanionPolicy.Action.HOLD,"manual work stays authoritative");
        check(MaidCompanionPolicy.choose(false,false,true,false,true,true,0)==MaidCompanionPolicy.Action.HOLD,"owner stop remains authoritative");
        check(MaidCompanionPolicy.choose(true,false,true,true,true,true,0)==MaidCompanionPolicy.Action.HOLD,"low health does not start pursuit");
        System.out.println("Maid ambient/patrol checks passed: "+checks);
    }
}
