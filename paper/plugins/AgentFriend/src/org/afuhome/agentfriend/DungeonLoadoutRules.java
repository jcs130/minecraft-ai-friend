package org.afuhome.agentfriend;
import java.util.*;
/** Physical equipment only; display names, skins and held tools cannot spoof it. */
final class DungeonLoadoutRules {
    static List<String> missing(String[] armor,List<String> inventory,boolean usableClassItem){
        String[] suffix={"_BOOTS","_LEGGINGS","_CHESTPLATE","_HELMET"},name={"靴子","护腿","胸甲","头盔"};
        List<String> gaps=new ArrayList<>();
        for(int n=0;n<4;n++)if(armor==null||armor.length<=n||armor[n]==null||!armor[n].endsWith(suffix[n]))gaps.add(name[n]);
        if(!usableClassItem&&(inventory==null||inventory.stream().filter(Objects::nonNull).noneMatch(v->v.endsWith("_SWORD")||v.endsWith("_AXE")||Set.of("TRIDENT","MACE","BOW","CROSSBOW").contains(v))))gaps.add("可用战斗装备（近战武器、弓弩或本职业法器）");
        return List.copyOf(gaps);
    }
}
