import dev.god.botgate.chest.SkillChestLayout;
import java.util.List;
import static dev.god.botgate.chest.SkillChestLayout.*;

/** Reproduce false locks, duplicate native aliases and dead-end discovery without a world. */
public class SkillGuidanceTest {
    static int assertions;
    static void check(boolean b,String message) { assertions++;if(!b)throw new AssertionError(message); }
    public static void main(String[] args) {
        Config c=new Config();c.catalogAvailable=true;c.learningSnapshotAvailable=true;c.playerLevel=10;
        c.featured.addAll(List.of("fireworks","home","rasengan"));c.learned.add("home");
        c.requiredLevels.put("fireworks",1);c.requiredLevels.put("home",50);
        c.nativeMappings.put("rasengan","irons_spellbooks:gust");
        c.nativeAvailable=true;
        c.nativeSpells.put("irons_spellbooks:gust",new NativeSpell("irons_spellbooks:gust","Gust","spell.irons_spellbooks.gust","irons_spellbooks:evocation",1,10,0,"spellbook","spellbook",true,""));
        var directory=compassSkills(c,List.of(new SkillInfo("fireworks"),new SkillInfo("home"),new SkillInfo("rasengan")),List.of());
        var own=filtered(c,directory,"known");
        check(own.stream().map(s->s.id).toList().equals(List.of("home","irons_spellbooks:gust")),"default excludes unlearned and duplicate aliases, keeps acquired equipment");
        var catalog=buildFiltered(c,directory,0,"all");
        check(catalog.get(skillSlot(0)).actionable(),"level-eligible unknown goddess spell can be tried and learned");
        check(catalog.get(skillSlot(2)).actionable(),"native mapping does not invent a legacy learned gate");
        check(!catalog.get(skillSlot(2)).lore.contains("基础消耗"),"native alias never advertises old resource charge");
        c.nativeSpells.clear();catalog=buildFiltered(c,directory,0,"all");
        check(!catalog.get(skillSlot(2)).actionable() && catalog.get(skillSlot(2)).lore.contains("铭文台"),"missing source explains acquisition without dead cast");
        c.playerLevel=0;catalog=buildFiltered(c,directory,0,"all");
        check(!catalog.get(skillSlot(0)).actionable(),"insufficient level remains discovery only");
        check(catalog.get(skillSlot(1)).actionable(),"existing learned entry retained, live execution still checks level");
        c.nativeSpells.put("irons_spellbooks:gust",new NativeSpell("irons_spellbooks:gust","Gust","spell.irons_spellbooks.gust","irons_spellbooks:evocation",1,10,1000,"spellbook","spellbook",false,"cooldown"));
        var nativeGrid=buildFiltered(c,compassSkills(c,List.of(),List.of()),0,"native");
        check(!nativeGrid.get(skillSlot(0)).actionable() && nativeGrid.get(skillSlot(0)).lore.contains("等待后刷新"),"cooldown entry stays visible but cannot close menu and send a rejected cast");
        check(buildGuide(c).get(11).lore.contains("消耗卷轴"),"guide explains scroll consumption");
        check(catalog.get(7).kind==Kind.GUIDE && catalog.get(51).id.equals("all"),"guidance and discovery remain one click away");
        check(sourceLabel("scroll").contains("一次性"),"source semantics visible");
        String longLine="技能说明".repeat(20)+" irons_spellbooks:cloud_of_regeneration";
        var lines=loreLines(longLine);
        check(String.join("",lines).equals(longLine),"tooltip wrapping preserves information");
        check(lines.stream().allMatch(s->s.codePoints().map(c0->c0<128?1:2).sum()<=44),"tooltip width bounded for Chinese and identifiers");
        System.out.println("SkillGuidanceTest: "+assertions+" assertions passed");
    }
}
