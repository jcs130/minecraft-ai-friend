package org.afuhome.agentfriend;

import java.util.*;

public final class TrialEnchantmentBudgetTest {
    public static void main(String[] args) {
        int checks=0;
        for(int floor=1;floor<=15;floor++)for(String tier:List.of("uncommon","rare","legendary")){
            Random random=new Random(1000L+floor);
            for(int n=0;n<500;n++){
                var item=DungeonEnchantments.roll("IRON_SWORD",floor,0,tier,Set.of(),random);
                if(item.size()>(floor<6?1:2))throw new AssertionError("normal affix count exceeds training budget at floor "+floor);
                if(item.values().stream().anyMatch(v->v>2))throw new AssertionError("normal level exceeds II at floor "+floor);
                if(item.containsKey("mending"))throw new AssertionError("normal training must not farm mending");
                checks+=3;
            }
        }
        System.out.println("PASS "+checks+" ordinary-training enchantment budget assertions");
    }
}
