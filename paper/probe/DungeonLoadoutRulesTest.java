package org.afuhome.agentfriend;
import java.util.*;
public final class DungeonLoadoutRulesTest {
    public static void main(String[] args){
        String[] armor={"IRON_BOOTS","LEATHER_LEGGINGS","CHAINMAIL_CHESTPLATE","TURTLE_HELMET"};int checks=0;
        for(String weapon:List.of("WOODEN_SWORD","DIAMOND_AXE","TRIDENT","MACE")){
            if(!DungeonLoadoutRules.melee(weapon))throw new AssertionError(weapon);checks++;
        }
        for(String tool:List.of("BOW","CROSSBOW","BLAZE_ROD","BOOK","CLOCK","BONE","DIAMOND_PICKAXE","NETHERITE_HOE","SHIELD","PLAYER_HEAD")){
            if(DungeonLoadoutRules.melee(tool))throw new AssertionError(tool);checks++;
        }
        for(int i=0;i<4;i++){var broken=armor.clone();broken[i]="AIR";if(DungeonLoadoutRules.missing(broken,true,true).size()!=1)throw new AssertionError("armor "+i);checks++;}
        var cosmetic=armor.clone();cosmetic[2]="ELYTRA";cosmetic[3]="CARVED_PUMPKIN";
        if(DungeonLoadoutRules.missing(cosmetic,true,true).size()!=2)throw new AssertionError("cosmetic armor");checks++;
        if(DungeonLoadoutRules.missing(new String[0],false,false).size()!=6)throw new AssertionError("empty");checks++;
        if(!DungeonLoadoutRules.missing(armor,true,true).isEmpty())throw new AssertionError("complete");checks++;
        if(!DungeonLoadoutRules.missing(armor,true,false).getFirst().contains("远程"))throw new AssertionError("missing ranged");checks++;
        if(!DungeonLoadoutRules.missing(armor,false,true).getFirst().contains("近战"))throw new AssertionError("missing melee");checks++;
        if(DungeonLoadoutRules.missing(new String[0],false,true).size()!=5)throw new AssertionError("class weapon does not skip armor or melee");checks++;
        System.out.println(checks+" dungeon loadout checks passed");
    }
}
