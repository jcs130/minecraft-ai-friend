package org.afuhome.agentfriend;

public final class DungeonExitAdviceTest {
    public static void main(String[] args){
        int count=0;
        for(String[] input:new String[][]{{"dungeon","abandon","undead_crypt"},{"dungeon","leave","undead_crypt"},{"dungeon","cancel"}}){
            try{DungeonAdvice.parse(input);throw new AssertionError("must not execute a guessed exit route");}
            catch(DungeonAdvice.Usage expected){
                if(!expected.nextCommand.equals("/mycli dungeon leave")||!expected.getMessage().contains("回城"))throw new AssertionError("one exact recovery and its effect");count++;
            }
        }
        var request=DungeonAdvice.parse(new String[]{"dungeon","leave","--json"});
        if(!request.json()||request.args().length!=2)throw new AssertionError("canonical leave stays unchanged");count++;
        System.out.println("Dungeon exit guidance: "+count+" checks passed");
    }
}
