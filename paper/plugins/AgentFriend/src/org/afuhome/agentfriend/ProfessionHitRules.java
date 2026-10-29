package org.afuhome.agentfriend;

/** Vanilla's early hurt window ignores damage no greater than the previous
 * hit. Report this as timing, never as a protection denial. Do not reset the
 * target's invulnerability or bypass another plugin's damage event. */
final class ProfessionHitRules {
    static boolean recovering(int ticks,int maximum,double previous,double amount){
        return maximum>0&&ticks>maximum/2.0&&amount<=previous;
    }
    private ProfessionHitRules(){}
}
