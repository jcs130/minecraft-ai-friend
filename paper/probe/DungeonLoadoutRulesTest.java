package org.afuhome.agentfriend;
import java.util.*;
public final class DungeonLoadoutRulesTest {
    public static void main(String[] args){
        String[] armor={"IRON_BOOTS","LEATHER_LEGGINGS","CHAINMAIL_CHESTPLATE","TURTLE_HELMET"};int checks=0;
        for(String weapon:List.of("WOODEN_SWORD","DIAMOND_AXE","TRIDENT","MACE","BOW","CROSSBOW")){
            if(!DungeonLoadoutRules.missing(armor,List.of(weapon),false).isEmpty())throw new AssertionError(weapon);checks++;
        }
        for(String tool:List.of("BLAZE_ROD","BOOK","CLOCK","BONE","DIAMOND_PICKAXE","NETHERITE_HOE","SHIELD","PLAYER_HEAD")){
            if(DungeonLoadoutRules.missing(armor,List.of(tool),false).size()!=1)throw new AssertionError(tool);checks++;
        }
        for(int i=0;i<4;i++){var broken=armor.clone();broken[i]="AIR";if(DungeonLoadoutRules.missing(broken,List.of("IRON_SWORD"),false).size()!=1)throw new AssertionError("armor "+i);checks++;}
        var cosmetic=armor.clone();cosmetic[2]="ELYTRA";cosmetic[3]="CARVED_PUMPKIN";
        if(DungeonLoadoutRules.missing(cosmetic,List.of("DIAMOND_SWORD"),false).size()!=2)throw new AssertionError("cosmetic armor");checks++;
        if(DungeonLoadoutRules.missing(new String[0],List.of(),false).size()!=5)throw new AssertionError("empty");checks++;
        if(!DungeonLoadoutRules.missing(armor,List.of("BLAZE_ROD","STONE_SWORD"),false).isEmpty())throw new AssertionError("backup weapon");checks++;
        for(String item:List.of("BLAZE_ROD","BOOK","BONE","CLOCK")){
            if(!DungeonLoadoutRules.missing(armor,List.of(item),true).isEmpty())throw new AssertionError("native class item "+item);checks++;
        }
        if(DungeonLoadoutRules.missing(new String[0],List.of("BOOK"),true).size()!=4)throw new AssertionError("class item does not skip armor");checks++;
        System.out.println(checks+" dungeon loadout checks passed");
    }
}
