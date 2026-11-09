package org.afuhome.agentfriend;

/** Village training rewards. Formal floor progression has its own reward catalogue. */
final class TrialRewardPolicy {
    static boolean legendary(int floor,int difficulty){return difficulty==2&&floor>=12;}
    static boolean aura(int floor,int difficulty){return difficulty>=1&&floor>=11;}
    static boolean milestone(int difficulty,boolean firstClear){return firstClear||difficulty>0;}
    static int affixCount(int floor,int difficulty){return difficulty==0?(floor<6?1:2):floor<11?2:difficulty==1?3:4;}
    static int affixLevel(int floor,int difficulty){return difficulty==0?(floor<6?1:2):floor<6?2:difficulty==1?3:4;}
    private TrialRewardPolicy(){}
}
