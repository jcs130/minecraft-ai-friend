package org.afuhome.agentfriend;
public final class ProfessionHitRulesTest {
    static int checks;
    static void check(boolean value){checks++;if(!value)throw new AssertionError("hurt window case "+checks);}
    public static void main(String[] args){
        check(ProfessionHitRules.recovering(20,20,7,4));
        check(ProfessionHitRules.recovering(11,20,4,4));
        check(!ProfessionHitRules.recovering(10,20,7,4));
        check(!ProfessionHitRules.recovering(0,20,7,4));
        check(!ProfessionHitRules.recovering(20,20,4,8));
        check(!ProfessionHitRules.recovering(20,0,7,4));
        check(ProfessionHitRules.recovering(11,21,7,4));
        check(!ProfessionHitRules.recovering(10,21,7,4));
        System.out.println("Profession hit timing: "+checks+" passed");
    }
}
