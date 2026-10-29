package org.qiandengji.vortex;

import com.google.gson.*;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.bukkit.ChatColor;
import org.bukkit.entity.Player;

/** Read loaded native definitions; never choose a class, grant a kit or save a player. */
final class ClassInfoView {
    private static final Gson JSON=new Gson();
    record View(Map<String,Object> data,String text){}
    static String selectionReason(String current,String requested,boolean allowed,boolean permission){
        if(!current.isEmpty())return current.equals(requested)?"already_selected":"class_already_chosen";
        if(!permission)return "permission_denied";
        return allowed?"ready":"player_state_blocked";
    }
    private static String plain(String value){return Objects.toString(ChatColor.stripColor(value),"");}
    private static Map<String,Double> stats(Map<io.vortexcore.progression.VortexAttribute,Double> input){
        var out=new TreeMap<String,Double>();input.forEach((key,value)->out.put(key.name(),value));return out;
    }
    static String statText(Map<?,?> values){
        return String.join("、",values.entrySet().stream().map(e->switch(e.getKey().toString()){
            case "STRENGTH"->"力量";case "DEXTERITY"->"敏捷";case "VITALITY"->"体质";
            case "INTELLIGENCE"->"智力";case "WISDOM"->"智慧";case "SPIRIT"->"精神";default->e.getKey().toString();
        }+" "+e.getValue()).toList());
    }
    static List<Map<String,Object>> definitions(VortexCorePlugin nativePlugin){
        var spells=nativePlugin.spellbookService().editorSpellSnapshots();var result=new ArrayList<Map<String,Object>>();
        for(var role:nativePlugin.classSkillService().registeredClassProfiles().stream().sorted(Comparator.comparing(ClassProfileDefinition::id)).toList()){
            // Only the temporary, unregistered object receives metadata. The native
            // skillsFor/ascensionsFor APIs read that metadata and the loaded trees.
            var query=new UnifiedPlayer(new UUID(0,0),"catalog-read-only");query.putMetadata("rpg.class",role.id());
            var nodes=nativePlugin.classSkillService().skillsFor(query);var spellIds=new LinkedHashSet<String>();spellIds.add(role.starterSpellId());
            var growth=new ArrayList<Map<String,Object>>();
            for(var n:nodes){
                var row=new LinkedHashMap<String,Object>();row.put("id",n.id());row.put("name",plain(n.displayName()));row.put("requiredLevel",n.requiredLevel());
                row.put("learningPoints",n.cost());row.put("bonuses",stats(n.permanentBonuses()));row.put("grantedSpellId",n.grantedSpellId());
                row.put("kind",n.grantedSpellId()==null||n.grantedSpellId().isBlank()?"passive":"spell");
                row.put("detailsCommand","/mycli skills info "+n.id());growth.add(row);
                if(n.grantedSpellId()!=null&&!n.grantedSpellId().isBlank())spellIds.add(n.grantedSpellId());
            }
            var routes=nativePlugin.classSkillService().ascensionsFor(query);
            for(var route:routes)if(route.grantedSpellId()!=null&&!route.grantedSpellId().isBlank())spellIds.add(route.grantedSpellId());
            var abilities=new ArrayList<Map<String,Object>>();
            for(String id:spellIds)spells.stream().filter(s->s.id().equals(id)).findFirst().ifPresent(s->{
                var row=new LinkedHashMap<String,Object>();row.put("id",id);row.put("name",plain(s.displayName()));row.put("minimumLevel",s.minLevel());
                row.put("mana",io.vortexcore.combat.ManaGate.cost(nativePlugin,id));row.put("cooldownMs",s.cooldownMillis());
                row.put("targets",SkillTransition.targets(s.targeters()));row.put("effect",SkillTransition.effects(s.mechanics())+FortifyDefence.description(id));
                row.put("detailsCommand","/mycli skills info "+id);abilities.add(row);
            });
            String kitPath="class-selection.rewards.classes."+role.archetype().commandId()+".items";
            var kit=nativePlugin.getConfig().getConfigurationSection(kitPath);var equipment=new ArrayList<Map<String,Object>>();
            if(kit!=null)for(String id:kit.getKeys(false))nativePlugin.qiandengjiItems().definition(id).ifPresent(item->{
                equipment.add(Map.of("id",id,"name",plain(item.displayName()),"material",item.material().getKey().toString(),"amount",Math.max(1,kit.getInt(id,1)),"locked",item.locked()));
            });
            var ascensions=routes.stream().map(a->Map.of("id",a.id(),"name",plain(a.displayName()),"description",plain(a.description()),"bonuses",stats(a.permanentBonuses()),"grantedSpellId",Objects.toString(a.grantedSpellId(),""))).toList();
            var data=new LinkedHashMap<String,Object>();data.put("id",role.id());data.put("name",plain(role.displayName()));data.put("description",plain(role.description()));
            data.put("baseAttributes",stats(role.baseStats()));data.put("starterSpell",role.starterSpellId());data.put("starterEquipment",equipment);data.put("starterEquipmentSource",kitPath);
            data.put("skills",abilities);data.put("growth",growth);data.put("ascensionLevel",nativePlugin.classSkillService().ascensionLevelThreshold());data.put("ascensions",ascensions);
            result.add(data);
        }
        return result;
    }
    static String revision(List<Map<String,Object>> catalog){
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical(JSON.toJsonTree(catalog)).getBytes(StandardCharsets.UTF_8))).substring(0,16);}
        catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
    }
    private static String canonical(JsonElement value){
        if(value.isJsonObject()){var sorted=new TreeMap<String,String>();value.getAsJsonObject().entrySet().forEach(e->sorted.put(e.getKey(),canonical(e.getValue())));return "{"+String.join(",",sorted.entrySet().stream().map(e->JSON.toJson(e.getKey())+":"+e.getValue()).toList())+"}";}
        if(value.isJsonArray()){var values=new ArrayList<String>();value.getAsJsonArray().forEach(e->values.add(canonical(e)));return "["+String.join(",",values)+"]";}return value.toString();
    }
    static View info(VortexCorePlugin nativePlugin,Player player,UnifiedPlayer state,String id,List<String> notes,boolean commandAllowed){
        var catalog=definitions(nativePlugin);var found=catalog.stream().filter(d->id.equals(d.get("id"))).findFirst().orElseThrow(()->new IllegalArgumentException("[unknown_class] 未知职业；/mycli profession list"));
        var out=new LinkedHashMap<>(found);String current=nativePlugin.classSkillService().selectedClassDefinition(state).map(ClassProfileDefinition::id).orElse("");
        String reason=selectionReason(current,id,io.vortexcore.combat.PlayerStateGate.allowed(player),commandAllowed);
        out.put("queryOnly",true);out.put("schemaVersion",1);out.put("catalogVersion",nativePlugin.getDescription().getVersion()+":"+revision(catalog));out.put("authority","VortexRPG.loaded");
        out.put("canChoose",reason.equals("ready"));out.put("selectionReason",reason);out.put("currentClass",current);out.put("currentLevel",state.level());
        out.put("unspentLearningPoints",nativePlugin.classSkillService().unspentSkillPoints(state));out.put("notes",notes);
        out.put("definitionVersion",out.get("catalogVersion")+":"+revision(List.of(Map.of("notes",notes))));
        out.put("nextCommand",reason.equals("ready")?"/mycli profession choose "+id:current.equals(id)?"/mycli skills status":"/mycli profession status");
        var text=new StringBuilder(plain(found.get("name").toString())).append(" (").append(id).append(")：").append(found.get("description"));
        text.append("\n基础属性：").append(statText((Map<?,?>)found.get("baseAttributes"))).append("；最终生命、魔力与装备以本人 status 为准。");
        @SuppressWarnings("unchecked") var gear=(List<Map<String,Object>>)found.get("starterEquipment");
        text.append("\n初始装备：").append(gear.isEmpty()?"当前没有配置装备":String.join("、",gear.stream().map(i->i.get("name")+"("+i.get("id")+")×"+i.get("amount")).toList())).append("；护甲不足可 /mycli guild shared。");
        @SuppressWarnings("unchecked") var abilities=(List<Map<String,Object>>)found.get("skills");
        for(var s:abilities)text.append("\n").append(s.get("id")).append("：Lv").append(s.get("minimumLevel")).append("、").append(s.get("mana")).append("魔力、冷却").append(((Number)s.get("cooldownMs")).longValue()/1000.0).append("秒；").append(s.get("targets")).append("；").append(s.get("effect"));
        @SuppressWarnings("unchecked") var growth=(List<Map<String,Object>>)found.get("growth");
        text.append("\n成长：").append(String.join("；",growth.stream().map(n->n.get("name")+"("+n.get("id")+") Lv"+n.get("requiredLevel")+"/"+n.get("learningPoints")+"学习点；加成 "+statText((Map<?,?>)n.get("bonuses"))+"；"+(n.get("kind").equals("passive")?"被动常驻":"解锁 "+n.get("grantedSpellId"))).toList()));
        @SuppressWarnings("unchecked") var routes=(List<Map<String,Object>>)found.get("ascensions");
        text.append("\n进阶门槛Lv").append(found.get("ascensionLevel")).append("：").append(String.join("；",routes.stream().map(n->n.get("name")+"("+n.get("id")+") "+n.get("description")+"；加成 "+statText((Map<?,?>)n.get("bonuses"))).toList()));
        text.append("\n本人Lv").append(state.level()).append("、剩余").append(out.get("unspentLearningPoints")).append("学习点。选择条件：").append(switch(reason){case "ready"->"当前可选";case "already_selected"->"你已经是此职业，不重复发装备";case "class_already_chosen"->"已选其他职业，choose不能换职";case "permission_denied"->"当前入口缺少选择权限";default->"当前角色状态不可选择";});
        if(!notes.isEmpty())text.append("。").append(String.join("；",notes));
        text.append("\n版本 ").append(out.get("catalogVersion")).append("；查询未选择、未花点、未发装备。下一步：").append(out.get("nextCommand"));
        return new View(out,text.toString());
    }
}
