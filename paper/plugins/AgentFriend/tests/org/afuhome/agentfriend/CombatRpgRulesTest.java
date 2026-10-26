package org.afuhome.agentfriend;

import java.nio.file.*;
import java.util.*;

public final class CombatRpgRulesTest {
    static int checks;
    static void check(boolean value,String text){checks++;if(!value)throw new AssertionError(text);}
    static void rejects(Runnable op,String text){try{op.run();throw new AssertionError(text);}catch(IllegalArgumentException ok){checks++;}}
    public static void main(String[] args)throws Exception{
        check(!CombatRpgRules.activate(false,false),"combat progression is opt in");
        check(!CombatRpgRules.activate(false,true),"Vortex alone remains independent");
        check(CombatRpgRules.activate(true,false),"single combat authority");
        rejects(()->CombatRpgRules.activate(true,true),"never double apply XP and attributes");
        check(CombatRpgRules.progress(0).level()==1,"fresh level");
        for(int level=1;level<=100;level++){
            long xp=CombatRpgRules.threshold(level);check(CombatRpgRules.progress(xp).level()==level,"exact level threshold");
            if(level>1)check(CombatRpgRules.progress(xp-1).level()==level-1,"one point short");
        }
        check(CombatRpgRules.progress(CombatRpgRules.MAX_XP).toNext()==0,"level cap");
        rejects(()->CombatRpgRules.progress(-1),"negative XP");rejects(()->CombatRpgRules.threshold(101),"overflow level");
        UUID warrior=UUID.randomUUID(),tank=UUID.randomUUID(),healer=UUID.randomUUID(),bystander=UUID.randomUUID();
        var party=List.of(new CombatRpgRules.Fighter(warrior,"warrior",10,0,0,true,true),
                new CombatRpgRules.Fighter(tank,"tank",0,6,0,true,true),new CombatRpgRules.Fighter(healer,"healer",0,0,4,true,true),
                new CombatRpgRules.Fighter(bystander,"bystander",0,0,0,true,true));
        var credits=CombatRpgRules.split(100,party,false);
        check(credits.size()==3,"healing and tanking count; proximity does not");
        check(credits.stream().mapToInt(CombatRpgRules.Credit::xp).sum()<=120,"group pool bounded");
        check(credits.stream().allMatch(c->c.floor()==0),"kills are not floor clears");
        check(CombatRpgRules.split(100,party,true).stream().mapToInt(CombatRpgRules.Credit::xp).sum()<=24,"practice XP bounded and separate");
        check(CombatRpgRules.split(20,List.of(new CombatRpgRules.Fighter(warrior,"w",100,0,0,false,true)),false).isEmpty(),"absent no reward");
        rejects(()->CombatRpgRules.split(100,List.of(party.getFirst(),party.getFirst()),false),"no duplicate participants");
        check(CombatRpgRules.next("",1,false,false,true,"/mycli dungeon status",0,false).equals("/mycli dungeon status"),"active activity priority");
        check(CombatRpgRules.next("mage",12,true,true,true,"",0,false).equals("/mycli tasks pause"),"graduated retired task still has exit");
        check(TankCombatRules.remaining(10,3,.5)==7,"tank cap after armor");
        check(TankCombatRules.remaining(2,6,.5)==1,"tank cannot be immune");
        check(TankCombatRules.remaining(0,6,.5)==0,"zero damage stays zero");
        rejects(()->TankCombatRules.remaining(Double.NaN,3,.5),"nonfinite damage");
        check(TankCombatRules.active(true,true,true,true,true,false,false,144,0,1),"taunt max distance inclusive");
        check(!TankCombatRules.active(true,true,true,false,true,false,false,1,0,1),"putting away shield ends taunt");
        check(!TankCombatRules.active(true,true,true,true,true,false,true,1,0,1),"PvP not tauntable");
        Path root=Files.createTempDirectory("qd-combat-test-");Path file=root.resolve("combat.json");
        var ledger=new CombatRpgLedger(file);check(!Files.exists(file),"query does not enroll or write");
        ledger.snapshot().player(warrior,"w");check(!Files.exists(file),"default player is read-only");
        UUID event=UUID.randomUUID();var award=new CombatRpgLedger.Award(event,credits);
        ledger.apply(List.of(award));byte[] saved=Files.readAllBytes(file);long xp=ledger.snapshot().player(warrior,"w").xp();
        ledger.apply(List.of(award));check(Arrays.equals(saved,Files.readAllBytes(file)),"duplicate is read-only");
        var cold=new CombatRpgLedger(file);cold.apply(List.of(award));check(cold.snapshot().player(warrior,"w").xp()==xp,"cold restart dedup");
        var failing=new CombatRpgLedger(file,(f,b)->{throw new java.io.IOException("simulated lock");});
        try{failing.apply(List.of(new CombatRpgLedger.Award(UUID.randomUUID(),credits)));throw new AssertionError("save should fail");}catch(java.io.IOException expected){checks++;}
        check(failing.snapshot().player(warrior,"w").xp()==xp,"failed write cannot publish XP");
        check(Arrays.equals(saved,Files.readAllBytes(file)),"last durable file retained");
        cold.apply(List.of(new CombatRpgLedger.Award(UUID.randomUUID(),List.of(new CombatRpgRules.Credit(warrior,"w",100,0,2)))));
        check(cold.snapshot().player(warrior,"w").highestFloor()==0,"floor gaps cannot unlock frontier");
        cold.apply(List.of(new CombatRpgLedger.Award(UUID.randomUUID(),List.of(new CombatRpgRules.Credit(warrior,"w",100,0,1)))));
        check(cold.snapshot().player(warrior,"w").highestFloor()==2,"contiguous clears unlock frontier");
        check(new CombatRpgLedger(file).snapshot().player(warrior,"w").highestFloor()==2,"formal progression survives restart");
        Files.delete(file);Files.delete(root);System.out.println("Combat RPG checks: "+checks);
    }
}
