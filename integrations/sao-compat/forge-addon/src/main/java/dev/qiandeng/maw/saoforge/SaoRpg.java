package dev.qiandeng.maw.saoforge;

import com.google.gson.*;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerPlayer;
import java.lang.reflect.*;
import static dev.qiandeng.maw.saoforge.SaoReflection.*;

/** Same native APIs as profession/skill/talent/attribute screens; no direct point grants. */
final class SaoRpg {
    static final String BASE="cn.blockforge.generated.mod1cab0b39.";
    static Class<?> player(){return type(BASE+"PlayerData");}
    static Class<?> professions(){return type(BASE+"Professions");}
    static CompoundTag data(ServerPlayer p){return(CompoundTag)call(player(),"get",p);}
    static int role(ServerPlayer p){return number(call(professions(),"role",p));}
    static int level(ServerPlayer p){return number(call(player(),"level",p));}
    static int style(ServerPlayer p){return number(call(type(BASE+"Combat"),"style",p));}
    static int cooldown(CompoundTag t, boolean profession, int role, int style, int skill){
        String key=profession&&role>0?(String)call(professions(),"cd",role,skill):CastEvidence.swordCooldownKey(style,skill);
        return Math.max(0,t.getInt(key));
    }
    static int activity(CompoundTag t,boolean profession){
        return profession?t.getInt("professionBusy"):Math.max(t.getInt("windup"),Math.max(t.getInt("hitsLeft"),t.getInt("recovery")));
    }
    static String castGate(ServerPlayer p,boolean profession,int skill){
        var t=data(p);int weapon=style(p),role=role(p);
        boolean busy=t.getInt("professionBusy")>0||t.getInt("windup")>0||t.getInt("hitsLeft")>0||t.getInt("recovery")>0
            ||t.getBoolean("elementalActive")||(profession&&t.getBoolean("voidActive"))||yes(call(type(BASE+"BreathMoves"),"busy",p));
        boolean breathing=profession&&yes(call(type(BASE+"Combat"),"isBreathing",p));
        return CastEvidence.gate(yes(call(field(type(BASE+"SaoConfig"),"COMBAT"),"get")),p.isAlive(),p.isSpectator(),
            yes(call(type(BASE+"SocialSystem"),"downed",p)),profession,breathing?1:role,weapon,busy,cooldown(t,profession,role,weapon,skill));
    }
    static int need(ServerPlayer p,boolean profession,int skill){
        CompoundTag copy=data(p).copy();copy.putInt("level",level(p));var rules=type("local.sao.gameplay.ProgressionRules");
        call(rules,"metadata",copy);return number(call(rules,"clientNeed",copy,profession,skill));
    }
    static JsonObject mana(ServerPlayer p){
        var cls=type("local.sao.points.PointsData");JsonObject out=new JsonObject();
        out.addProperty("current",(Number)call(cls,"mana",p));out.addProperty("max",(Number)call(cls,"maxMana",p));return out;
    }
    static JsonObject status(ServerPlayer p){
        var t=data(p);var out=new JsonObject();int r=role(p);String[] names=(String[])field(professions(),"NAMES");
        out.addProperty("professionId",r);out.addProperty("professionName",r>=0&&r<names.length?names[r]:"unknown");
        out.addProperty("level",level(p));out.addProperty("xp",t.getInt("xp"));out.addProperty("levelProgressPercent",number(call(player(),"progressPercent",p)));
        out.addProperty("floor",t.getInt("floor"));out.add("mana",mana(p));
        var resource=new JsonObject();resource.addProperty("id",(String)call(player(),"activeResource",p));resource.addProperty("current",number(call(player(),"resource",p)));resource.addProperty("max",number(call(player(),"maxResource",p)));out.add("nativeResource",resource);
        out.addProperty("hydration",t.getInt("hydration"));out.addProperty("switchCooldownRemainingMs",Math.max(0,t.getInt("cdProfessionSwitch"))*50L);
        out.addProperty("combatCooldownRemainingMs",Math.max(0,t.getInt("cdProfessionCombat"))*50L);
        int weaponStyle=style(p);out.addProperty("weaponStyle",weaponStyle);
        out.addProperty("mainHandItem",net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(p.getMainHandItem().getItem()).toString());
        var loadout=new JsonArray();for(boolean profession:new boolean[]{false,true})for(int slot=0;slot<(profession?6:2);slot++){
            int skill=number(call(type(BASE+"SkillLoadout"),"get",t,style(p),profession,slot));
            var row=new JsonObject();row.addProperty("kind",profession?"profession":"sword");row.addProperty("slot",slot);row.addProperty("skill",skill);
            row.addProperty("equipped",skill>=0);row.addProperty("requiredLevel",need(p,profession,skill));row.addProperty("unlocked",skill>=0&&level(p)>=need(p,profession,skill));
            row.addProperty("cooldownRemainingMs",skill>=0?cooldown(t,profession,r,weaponStyle,skill)*50L:0);
            String blocked=skill<0?"slot_not_equipped":level(p)<need(p,profession,skill)?"level_requirement":castGate(p,profession,skill);
            row.addProperty("available",blocked==null);if(blocked!=null)row.addProperty("blockedReason",blocked);
            if(profession&&r>0&&skill>=0&&skill<6)row.addProperty("name",((String[][])field(professions(),"SKILLS"))[r-1][skill]);
            loadout.add(row);
        }out.add("loadout",loadout);
        out.addProperty("talentPoints",number(call(type("local.sao.talents.TalentData"),"available",p)));
        out.addProperty("attributePoints",number(call(type("local.sao.points.PointsData"),"available",p)));
        out.addProperty("attributeLevel",number(call(type("local.sao.points.PointsData"),"level",p)));
        return out;
    }
    static JsonObject catalog(ServerPlayer p,JsonObject args){
        var out=new JsonObject();String[] names=(String[])field(professions(),"NAMES");var rows=new JsonArray();
        if(!args.has("profession_id")){
            for(int i=1;i<names.length;i++)if(yes(call(professions(),"valid",i))){var row=new JsonObject();row.addProperty("id",i);row.addProperty("name",names[i]);row.addProperty("selected",role(p)==i);rows.add(row);}
            out.add("professions",rows);out.addProperty("selectionCostItem","mod_1cab0b39:profession_switch_scroll");out.addProperty("selectionCostCount",1);return out;
        }
        int r=args.get("profession_id").getAsInt();if(r>=names.length||!yes(call(professions(),"valid",r)))throw new IllegalArgumentException("profession_not_installed");
        String[][] skills=(String[][])field(professions(),"SKILLS"),descriptions=(String[][])field(professions(),"DESCRIPTIONS"),ids=(String[][])field(professions(),"IDS");
        int[][] cost=(int[][])field(professions(),"COST"),cooldown=(int[][])field(professions(),"COOLDOWN"),length=(int[][])field(professions(),"LENGTH");
        out.addProperty("id",r);out.addProperty("name",names[r]);for(int i=0;i<cost[r-1].length;i++){
            var row=new JsonObject();row.addProperty("skill",i);row.addProperty("id",ids[r-1][i]);row.addProperty("name",skills[r-1][i]);row.addProperty("description",descriptions[r-1][i]);row.addProperty("baseCost",cost[r-1][i]);row.addProperty("baseCooldownMs",cooldown[r-1][i]*50L);row.addProperty("baseDurationMs",length[r-1][i]*50L);row.addProperty("requiredLevel",need(p,true,i));row.addProperty("unlocked",level(p)>=need(p,true,i));rows.add(row);
        }out.add("skills",rows);out.addProperty("valuesSource","native_declared_arrays; modifiers may change actual costs/timings; query status after casting");var passive=new JsonArray();for(int i=cost[r-1].length;i<skills[r-1].length;i++){var row=new JsonObject();row.addProperty("name",skills[r-1][i]);row.addProperty("description",descriptions[r-1][i]);row.addProperty("passive",true);passive.add(row);}out.add("passives",passive);return out;
    }
    static JsonObject talents(ServerPlayer p,JsonObject args){
        Class<?> cls=type("local.sao.talents.Talent"),state=type("local.sao.talents.TalentData");Object[] values=(Object[])call(cls,"values");int[] ranks=(int[])call(state,"ranks",p);int lv=number(call(state,"level",p));
        var out=new JsonObject();out.addProperty("availablePoints",number(call(state,"available",p)));out.addProperty("level",lv);var rows=new JsonArray();
        int offset=args.has("offset")?args.get("offset").getAsInt():0,end=Math.min(values.length,offset+(args.has("limit")?args.get("limit").getAsInt():8));
        for(int i=Math.min(offset,values.length);i<end;i++){var n=values[i];var row=new JsonObject();row.addProperty("node",i);row.addProperty("id",((Enum<?>)n).name().toLowerCase(java.util.Locale.ROOT));row.addProperty("title",(String)field(n,"title"));row.addProperty("description",(String)field(n,"description"));row.addProperty("rank",ranks[i]);row.addProperty("maxRank",number(field(n,"max")));row.addProperty("levelCap",number(call(n,"cap",lv)));row.addProperty("nextRequiredLevel",number(call(n,"requiredLevel",ranks[i]+1)));row.addProperty("parent",number(field(n,"parent")));row.addProperty("parentRank",number(field(n,"parentRank")));row.addProperty("canBuy",yes(call(cls,"canBuy",lv,ranks,i)));row.addProperty("canRefund",yes(call(cls,"canRefund",ranks,i)));rows.add(row);}
        out.add("nodes",rows);out.addProperty("offset",offset);out.addProperty("totalCount",values.length);out.addProperty("returnedCount",rows.size());out.addProperty("complete",end>=values.length);if(end<values.length)out.addProperty("nextOffset",end);return out;
    }
    static JsonObject attributes(ServerPlayer p){
        Class<?> cls=type("local.sao.points.Stat"),state=type("local.sao.points.PointsData");Object[] values=(Object[])call(cls,"values");int[] ranks=(int[])call(state,"ranks",p);var out=new JsonObject();out.addProperty("availablePoints",number(call(state,"available",p)));out.addProperty("level",number(call(state,"level",p)));var rows=new JsonArray();
        for(int i=0;i<values.length;i++){var n=values[i];var row=new JsonObject();row.addProperty("node",i);row.addProperty("id",((Enum<?>)n).name().toLowerCase(java.util.Locale.ROOT));row.addProperty("title",(String)call(n,"title"));row.addProperty("rank",ranks[i]);row.addProperty("maxRanks",number(call(n,"maxRanks")));row.addProperty("step",(Number)call(n,"step"));row.addProperty("cap",(Number)call(n,"cap"));row.addProperty("eligible",yes(call(n,"eligible",role(p))));row.addProperty("restriction",(String)call(n,"restriction"));rows.add(row);}
        out.add("nodes",rows);return out;
    }
    static void action(ServerPlayer p,int action,int value){
        try {
            Class<?> network=type(BASE+"SaoNetwork"),packet=type(BASE+"SaoNetwork$Action");Object request=packet.getConstructor(int.class,int.class).newInstance(action,value);
            var method=network.getDeclaredMethod("handleAction",ServerPlayer.class,CompoundTag.class,int.class,packet);method.setAccessible(true);method.invoke(null,p,data(p),style(p),request);call(network,"sync",p);
        }catch(InvocationTargetException e){throw new IllegalStateException("native_rpg_action_failed",e.getCause());}
        catch(ReflectiveOperationException e){throw new IllegalStateException("native_rpg_binding_unavailable",e);}
    }
    static JsonObject mutate(ServerPlayer p,String op,JsonObject args){
        var before=status(p);String reason="native_action_refused";boolean success=false;
        switch(op){
            case "sao.profession.choose"->{int r=args.get("profession_id").getAsInt();if(!yes(call(professions(),"valid",r)))throw new IllegalArgumentException("profession_not_installed");if(role(p)==r){success=true;reason="already_selected";}else{action(p,5,r);success=role(p)==r;if(success)reason="profession_selected";else if(data(p).getInt("cdProfessionSwitch")>0||data(p).getInt("cdProfessionCombat")>0)reason="combat_or_switch_cooldown";else if(!yes(call(player(),"has",p,"profession_switch_scroll",1)))reason="profession_switch_scroll_required";}}
            case "sao.loadout.bind"->{boolean profession=args.get("kind").getAsString().equals("profession");int slot=args.get("slot").getAsInt(),skill=args.get("skill").getAsInt();if(slot>=(profession?6:2)||skill>=(profession?6:4))throw new IllegalArgumentException("loadout_slot_or_skill_out_of_range");action(p,profession?9:8,slot*(profession?6:4)+skill);success=number(call(type(BASE+"SkillLoadout"),"get",data(p),style(p),profession,slot))==skill;reason=success?"bound":"native_binding_refused";}
            case "sao.skill.cast"->{
                boolean profession=args.get("kind").getAsString().equals("profession");int slot=args.get("slot").getAsInt();
                if(slot>=(profession?6:2))throw new IllegalArgumentException("loadout_slot_out_of_range");
                int skill=number(call(type(BASE+"SkillLoadout"),"get",data(p),style(p),profession,slot));
                if(skill<0){reason="slot_not_equipped";break;}
                if(level(p)<need(p,profession,skill)){reason="level_requirement";break;}
                String blocked=castGate(p,profession,skill);if(blocked!=null){reason=blocked;break;}
                int oldResource=number(call(player(),"resource",p)),oldCd=cooldown(data(p),profession,role(p),style(p),skill),oldActivity=activity(data(p),profession);
                action(p,profession?11:10,slot);
                success=CastEvidence.started(oldResource,number(call(player(),"resource",p)),oldCd,cooldown(data(p),profession,role(p),style(p),skill),oldActivity,activity(data(p),profession));
                reason=success?"cast_started_not_hit_confirmed":"native_cast_refused_check_resource_cooldown_and_target";
            }
            case "sao.talent.buy","sao.talent.refund"->{int node=args.get("node").getAsInt();Object[] values=(Object[])call(type("local.sao.talents.Talent"),"values");if(node>=values.length)throw new IllegalArgumentException("talent_node_out_of_range");int[] was=(int[])call(type("local.sao.talents.TalentData"),"ranks",p);String message=(String)call(type("local.sao.talents.TalentData"),op.endsWith(".buy")?"buy":"refund",p,node);call(type("local.sao.talents.TalentNetwork"),"sync",p);int[] now=(int[])call(type("local.sao.talents.TalentData"),"ranks",p);success=was[node]!=now[node];reason=success?"talent_updated":message;}
            case "sao.attribute.buy","sao.attribute.refund"->{int node=args.get("node").getAsInt();Object[] values=(Object[])call(type("local.sao.points.Stat"),"values");if(node>=values.length)throw new IllegalArgumentException("attribute_node_out_of_range");success=yes(call(type("local.sao.points.PointsData"),op.endsWith(".buy")?"allocate":"refund",p,values[node]));reason=success?"attribute_updated":"native_attribute_refused_check_points_profession_and_combat";}
            default->throw new IllegalArgumentException("unsupported_rpg_operation");
        }
        var out=new JsonObject();out.addProperty("ok",success);out.addProperty("reason",reason);out.addProperty("changed",!before.equals(status(p)));out.add("before",before);out.add("after",status(p));return out;
    }
}
