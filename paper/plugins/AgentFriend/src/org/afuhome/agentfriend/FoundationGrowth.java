package org.afuhome.agentfriend;

import com.google.gson.*;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import dev.aurelium.auraskills.api.skill.Skills;
import org.bukkit.entity.Player;
import java.util.Locale;

/** Read the installed AuraSkills engine; never award XP or apply a modifier here. */
public final class FoundationGrowth {
    private FoundationGrowth() {}
    public static JsonObject view(Player player) {
        var out=new JsonObject();out.addProperty("authority","AuraSkills");out.addProperty("kind","foundation");
        out.addProperty("queryOnly",true);out.addProperty("classExperience",false);
        var api=AuraSkillsApi.get();var user=api.getUser(player.getUniqueId());
        var engine=org.bukkit.plugin.java.JavaPlugin.getPlugin(dev.aurelium.auraskills.bukkit.AuraSkills.class);
        boolean ready=user!=null&&user.isLoaded();out.addProperty("available",ready);
        var skills=new JsonArray();var passives=new JsonArray();out.add("skills",skills);out.add("passives",passives);
        out.addProperty("nextCommand","/mycli skills list passive");
        if(!ready)return out;
        for(var skill:Skills.values())if(skill.isEnabled()){
            var row=new JsonObject();row.addProperty("id",skill.getId().toString());
            row.addProperty("name",skill.getDisplayName(Locale.SIMPLIFIED_CHINESE,false));
            int level=user.getSkillLevel(skill);boolean capped=level>=skill.getMaxLevel();
            row.addProperty("level",level);row.addProperty("xp",Math.max(0,user.getSkillXp(skill)));
            row.addProperty("requiredXp",capped?0:api.getXpRequirements().getXpRequired(skill,level+1));
            row.addProperty("isMaxLevel",capped);skills.add(row);
            for(var ability:skill.getAbilities())if(ability.isEnabled()){
                var passive=new JsonObject();passive.addProperty("id",ability.getId().toString());
                passive.addProperty("name",ability.getDisplayName(Locale.SIMPLIFIED_CHINESE,false));
                passive.addProperty("skill",skill.getId().toString());passive.addProperty("level",user.getAbilityLevel(ability));
                passive.addProperty("unlocked",user.getAbilityLevel(ability)>0);passive.addProperty("unlockSkillLevel",ability.getUnlock());
                var supplier=engine.getAbilityManager().getSupplier();int abilityLevel=user.getAbilityLevel(ability);
                double value=supplier.getValue(ability,Math.max(1,abilityLevel));
                passive.addProperty("value",abilityLevel>0?value:0);passive.addProperty("unlockValue",supplier.getValue(ability,1));
                String description=ability.getDescription(Locale.SIMPLIFIED_CHINESE,false)
                    .replace("{value}",java.math.BigDecimal.valueOf(value).stripTrailingZeros().toPlainString())
                    .replace("{value_2}",java.math.BigDecimal.valueOf(supplier.getSecondaryValue(ability,Math.max(1,abilityLevel))).stripTrailingZeros().toPlainString());
                passive.addProperty("description",description);
                passives.add(passive);
            }
        }
        return out;
    }
    public static void describe(Player player,boolean json) {
        var state=view(player);
        if(json){player.sendMessage("MC_RPG "+state);return;}
        if(!state.get("available").getAsBoolean()){
            player.sendMessage("§e[foundation_loading] 基础熟练度加载中；未改经验或技能。稍后查询：/mycli skills list passive");return;
        }
        var levels=new java.util.ArrayList<String>();
        for(var e:state.getAsJsonArray("skills")){var r=e.getAsJsonObject();levels.add(r.get("name").getAsString()+" "+r.get("level").getAsInt());}
        player.sendMessage("§b[基础成长] "+String.join("、",levels)+"。随实际行动成长，独立于Vortex职业等级；查询不发经验。");
        for(var e:state.getAsJsonArray("passives")){
            var r=e.getAsJsonObject();player.sendMessage("§7[基础被动] "+r.get("name").getAsString()+" Lv."+r.get("level").getAsInt()+"；"+(r.get("unlocked").getAsBoolean()?"自动生效":"未解锁，需要对应熟练度"+r.get("unlockSkillLevel").getAsInt()+"级")+"；"+r.get("description").getAsString());
        }
        player.sendMessage("§7[成长分工] 基础被动自动生效；职业主动技与天赋：/mycli skills list；通用生存技：/mycli skills list common。魔力统一由Vortex管理。");
    }
}
