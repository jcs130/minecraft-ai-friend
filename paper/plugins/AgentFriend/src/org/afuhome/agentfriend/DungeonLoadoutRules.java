package org.afuhome.agentfriend;
import java.util.ArrayList;
import java.util.List;
/** Physical equipment only; display names, skins and held tools cannot spoof it. */
final class DungeonLoadoutRules {
    static final String REQUIREMENTS = "穿齐四件护甲，随身带一件近战武器和另一件可用远程武器（弓弩＋弹药、可投掷三叉戟或本职业攻击法器）";
    static final String SUPPLIES = "/mycli trade shop list supplies";

    static boolean melee(String material) {
        return material.endsWith("_SWORD") || material.endsWith("_AXE") || material.equals("MACE") || material.equals("TRIDENT");
    }

    static List<String> missing(String[] armor, boolean melee, boolean ranged) {
        String[] suffix={"_BOOTS","_LEGGINGS","_CHESTPLATE","_HELMET"},name={"靴子","护腿","胸甲","头盔"};
        List<String> gaps=new ArrayList<>();
        for(int n=0;n<4;n++)if(armor==null||armor.length<=n||armor[n]==null||!armor[n].endsWith(suffix[n]))gaps.add(name[n]);
        if (!melee) gaps.add("近战武器（剑、斧、重锤或三叉戟）");
        if (!ranged) gaps.add("另一件可用远程武器（弓弩＋弹药、可投掷三叉戟或本职业攻击法器）");
        return List.copyOf(gaps);
    }
}
