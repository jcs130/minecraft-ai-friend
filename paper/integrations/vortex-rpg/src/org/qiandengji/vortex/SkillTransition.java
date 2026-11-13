package org.qiandengji.vortex;

import java.util.*;

/** Explains retired abilities; never silently grants or casts their replacements. */
public final class SkillTransition {
    public static final List<String> COMMON=List.of("home","selfheal","food","blink","starbolt","frostnova","give","travel","team","support","prospect","night","feather");
    public static final Set<String> LEGACY=Set.of("heal","fireworks","starlight","flamewave","leap","flight","golem","sense",
        "tank_taunt","tank_bastion","tank_bash","tank_cover","warrior_sky_leap","mage_soar","priest_blessing","sword_thrust","sword_parry","sword_arc","sword_step","sword_beam","twin_legacy","guardian_ward","guardian_oath","scout_mark","scout_watch","healer_mend","healer_cleanse","healer_beacon","mage_bolt","mage_frost","mage_flame");
    public static String reason(String id){return LEGACY.contains(id)?"skill_retired":"unknown_skill";}
    public static String next(boolean chosen){return chosen?"/mycli skills list":"/mycli profession list";}
    public static String targets(List<Map<String,Object>> rows){return String.join("、",rows.stream().map(r->switch(String.valueOf(r.get("type"))){case "self"->"自己";case "nearby_monster"->"自动选择附近敌对目标（"+r.getOrDefault("range","配置")+"格，最多"+r.getOrDefault("limit",1)+"个）";case "nearby_player"->"自己及可见队友（"+r.getOrDefault("range","配置")+"格，副本内按当场参战名单）";case "ray"->"准星指向（"+r.getOrDefault("range","配置")+"格）";default->"按服务端目标条件";}).distinct().toList());}
    public static String effects(List<Map<String,Object>> rows){
        return String.join("、",rows.stream().map(r->switch(String.valueOf(r.get("type"))){
            case "damage"->"基础伤害"+r.getOrDefault("base",0)+"，随"+stat(String.valueOf(r.get("scaling-attribute")))+"成长";
            case "heal"->"基础治疗"+r.getOrDefault("base",0)+"，随"+stat(String.valueOf(r.get("scaling-attribute")))+"成长";
            case "apply_effect"->{
                String effect=switch(String.valueOf(r.get("effect"))){
                    case "arcane_ward"->"奥术护盾（持续回血）";case "bleed"->"流血（持续伤害）";default->String.valueOf(r.get("effect"));
                };
                String duration=r.get("duration-ticks") instanceof Number ticks ? " "+(ticks.doubleValue()/20)+" 秒" : "";
                yield "附加"+effect+duration;
            }
            case "cleanse"->"净化最多 "+r.getOrDefault("max-removals",1)+" 个符合标签的状态"+(r.get("tags") instanceof List<?> tags?" "+tags:"");
            default->"";
        }).filter(s->!s.isEmpty()).distinct().toList());
    }
    private static String stat(String id){return switch(id){case "intelligence"->"智力";case "strength"->"力量";case "dexterity"->"敏捷";case "spirit"->"精神";default->"原生属性";};}
    public static String message(String id,boolean chosen){return "["+reason(id)+"] "+id+(LEGACY.contains(id)?" 是旧版技能，已停用；旧刻印和装备保留，普通附魔仍有效。本次未施法、不扣魔力或物品。":" 不在当前技能目录；本次未执行。")+"下一步："+next(chosen)+"。完整攻略指引：/mycli intro";}
}
