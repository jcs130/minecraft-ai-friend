package org.afuhome.agentfriend;

public final class TrialRewardPolicyTest {
    public static void main(String[] args){
        int checks=0;
        for(int floor=1;floor<=15;floor++)for(int difficulty=0;difficulty<3;difficulty++){
            if(difficulty==0&&(TrialRewardPolicy.legendary(floor,difficulty)||TrialRewardPolicy.aura(floor,difficulty)))throw new AssertionError("ordinary training enters an elite pool");
            if(floor<11&&TrialRewardPolicy.aura(floor,difficulty))throw new AssertionError("early aura");
            if((floor<12||difficulty<2)&&TrialRewardPolicy.legendary(floor,difficulty))throw new AssertionError("early legendary");
            checks+=3;
        }
        if(TrialRewardPolicy.milestone(0,false)||!TrialRewardPolicy.milestone(0,true))throw new AssertionError("normal first-clear boundary");
        if(!TrialRewardPolicy.milestone(1,false)||!TrialRewardPolicy.milestone(2,false))throw new AssertionError("harder rotation lost");
        if(!TrialRewardPolicy.legendary(15,2)||!TrialRewardPolicy.aura(15,1))throw new AssertionError("deep challenge still needs differentiated rewards");
        System.out.println("PASS "+(checks+3)+" reward progression boundaries");
    }
}
