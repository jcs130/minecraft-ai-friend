package local.tlmcompat.hybrid;

import java.util.HashSet;

public final class MaidAmbientPatrolFixture {
    static int checks;
    static void check(boolean ok,String label){checks++;if(!ok)throw new AssertionError(label);}
    public static void main(String[] args){
        var ambient=new MaidAmbientPolicy();String idle="touhou_little_maid:maid.mode.idle";
        check(ambient.choose(idle,0,true)==null,"idle presence alone must not invent a public conversation");
        check(ambient.choose(idle,0,false)==null,"unattended area stays quiet");
        String hurt="touhou_little_maid:maid.ai.hurt",rain="touhou_little_maid:maid.environment.rain";
        check(ambient.choose(hurt,0,true)!=null,"first real event may speak");
        check(ambient.choose(rain,89_000_000_000L,true)==null,"different events share a ninety second quiet window");
        check(ambient.choose(hurt,179_000_000_000L,true)==null,"same action waits three minutes");
        check(ambient.choose(hurt,180_000_000_000L,true)!=null,"action is available at exact boundary");
        check(ambient.choose(rain,270_000_000_000L,true)!=null,"new weather event can speak after global gap");
        check(ambient.choose(rain,869_000_000_000L,true)==null,"same weather waits ten minutes");
        check(ambient.choose(rain,870_000_000_000L,true)!=null,"weather boundary eventually allows speech");
        String attack="touhou_little_maid:maid.mode.attack";
        check(!MaidAmbientPolicy.matchesScene(attack,"touhou_little_maid:attack",false,false,false,6000,false,true),"combat job with no current target is quiet");
        check(MaidAmbientPolicy.matchesScene(attack,"touhou_little_maid:attack",true,false,false,6000,false,true),"actual nearby combat permits its native event");
        check(!MaidAmbientPolicy.matchesScene(attack,"touhou_little_maid:idle",true,false,false,6000,false,true),"stale job event is rejected");
        check(!MaidAmbientPolicy.matchesScene(rain,"touhou_little_maid:idle",false,false,false,6000,false,true),"clear weather cannot claim rain");
        check(!MaidAmbientPolicy.matchesScene(rain,"touhou_little_maid:idle",false,false,false,6000,true,false),"sheltered maid does not comment on being rained on");
        check(MaidAmbientPolicy.matchesScene(rain,"touhou_little_maid:idle",false,false,false,6000,true,true),"exposed rainy scene permits rain event");
        check(!MaidAmbientPolicy.matchesScene(hurt,"touhou_little_maid:idle",false,false,false,6000,false,true),"unhurt scene cannot produce hurt speech");
        check(MaidAmbientPolicy.matchesScene(hurt,"touhou_little_maid:idle",false,true,false,6000,false,true),"actual damage permits hurt event");
        check(!MaidAmbientPolicy.matchesScene(hurt,"touhou_little_maid:idle",false,true,true,6000,false,true),"sleeping or stationed maid remains quiet");
        check(!MaidAmbientPolicy.matchesScene("touhou_little_maid:maid.environment.morning","touhou_little_maid:idle",false,false,false,13000,false,true),"night is not morning");
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
