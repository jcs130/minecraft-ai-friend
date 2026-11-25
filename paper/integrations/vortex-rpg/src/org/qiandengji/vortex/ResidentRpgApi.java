package org.qiandengji.vortex;

import com.google.gson.*;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.persistence.model.PlayerSnapshot;
import io.vortexcore.rpg.ResidentActors;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.entity.*;

/** A resident's own durable Vortex profile and original spell executor, without a network player. */
final class ResidentRpgApi {
    private final VortexCorePlugin vortex;
    private final VortexBridge bridge;
    private final Set<UUID> loaded=new HashSet<>(),ready=new HashSet<>();
    private final Map<UUID,CompletableFuture<PlayerSnapshot>> reads=new HashMap<>();
    private final Map<UUID,CompletableFuture<?>> writes=new HashMap<>();
    private final Set<UUID> reportedBootFailures=new HashSet<>();
    private final ResidentSwordArts swordArts;
    ResidentRpgApi(VortexCorePlugin vortex,VortexBridge bridge) {this(vortex,bridge,null);}
    ResidentRpgApi(VortexCorePlugin vortex,VortexBridge bridge,ResidentSwordArts swordArts) {
        this.vortex=vortex; this.bridge=bridge; this.swordArts=swordArts;
    }
    private Player actor(UUID id){
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main_thread_required");
        try{var af=Bukkit.getPluginManager().getPlugin("AgentFriend");return (Player)af.getClass().getClassLoader()
            .loadClass("org.afuhome.agentfriend.ResidentCli").getMethod("residentPlayer",UUID.class).invoke(null,id);
        }catch(ReflectiveOperationException e){throw new IllegalStateException("resident_identity_unavailable",e);}
    }
    void tick(UUID id,String requested){
        if(ready.contains(id))return;
        try{load(id,requested);}
        catch(RuntimeException failure){
            if(reportedBootFailures.add(id))vortex.getLogger().log(java.util.logging.Level.WARNING,
                "Resident RPG profile could not be initialized for "+id,failure);
        }
    }
    private void load(UUID id,String requested){
        var p=actor(id);if(p==null||!p.isOnline())return;
        var profiles=vortex.playerProfileService();
        if(!loaded.contains(id)){
            // A native resident never enters the real player-join lifecycle.
            // Apply the original repository snapshot on the game thread once.
            var read=reads.computeIfAbsent(id,key->vortex.playerDataRepository().loadPlayer(key));
            if(!read.isDone()||read.isCompletedExceptionally()||read.isCancelled())return;
            var saved=read.join();
            var profile=profiles.profile(p);
            profile.applySnapshot(saved==null?PlayerSnapshot.create(id):saved);
            loaded.add(id);
            reads.remove(id);
            vortex.classSkillService().applyLiveAttributes(p,profile);
        }
        var profile=profiles.profile(id).orElseThrow();
        var pending=writes.get(id);if(pending!=null){if(!pending.isDone()||pending.isCompletedExceptionally())return;writes.remove(id);}
        String selected=vortex.classSkillService().selectedClassDefinition(profile).map(c->c.id()).orElse("");
        if(selected.isEmpty()&&!requested.isEmpty()){
            if(vortex.classSkillService().classProfile(requested).isEmpty())throw new IllegalArgumentException("unknown_vortex_class");
            writes.put(id,vortex.classSkillService().chooseClass(p,profile,requested).thenCompose(v->profiles.qiandengjiSave(p)));return;
        }
        // A saved class is authoritative. A changed config never resets it or grants another starting kit.
        ResidentActors.register(p);vortex.qiandengjiMana().refillFull(id);if(swordArts!=null)swordArts.restore(p,profile);ready.add(id);
    }
    boolean usesSwords(UUID id) {
        return swordArts!=null && ready.contains(id) && vortex.playerProfileService().profile(id).filter(swordArts::isSwordsman).isPresent();
    }
    String state(UUID id){
        if(!ready.contains(id)){
            String reason=reads.containsKey(id)&&reads.get(id).isCompletedExceptionally()?"profile_read_unconfirmed"
                :writes.containsKey(id)&&writes.get(id).isCompletedExceptionally()?"profile_save_unconfirmed"
                :reportedBootFailures.contains(id)?"profile_initialization_failed":"profile_loading";
            return new Gson().toJson(Map.of("available",false,"backend","vortex","reason",reason,"abilities",List.of(),"skills",List.of()));
        }
        var value=JsonParser.parseString(bridge.selfState(actor(id))).getAsJsonObject();
        value.addProperty("profession",value.get("combat").getAsString());value.addProperty("title",value.get("className").getAsString());value.addProperty("progressionSystem","VortexRPG");
        var profile=vortex.playerProfileService().profile(id).orElseThrow();
        value.add("skills",new Gson().toJsonTree(bridge.availableSpells(actor(id),profile)));
        if(usesSwords(id)&&vortex.classSkillService().unlockedSkillIds(profile).contains("dual_blades"))
            value.addProperty("specialization","dual_blades");
        var unlocked=vortex.classSkillService().unlockedSkillIds(profile);
        value.add("learnable",new Gson().toJsonTree(vortex.classSkillService().skillsFor(profile).stream()
            .filter(skill->!unlocked.contains(skill.id())).limit(64)
            .map(skill->Map.of("id",skill.id(),"name",skill.displayName(),"level",skill.requiredLevel(),"cost",skill.cost())).toList()));
        return value.toString();
    }
    String swordReflex(UUID id, UUID targetId) {
        if (!usesSwords(id)) return "";
        return swordArts.reflex(actor(id), vortex.playerProfileService().profile(id).orElseThrow(), targetId);
    }
    String reflex(UUID id,boolean fighting){
        if(!ready.contains(id))return "";var p=actor(id);var state=vortex.playerProfileService().profile(id).orElseThrow();
        if(fighting&&bridge.healingCircleSuggested(p,state))return HealingCircle.ID;
        var allowed=bridge.availableSpells(p,state);
        for(var spell:vortex.spellbookService().editorSpellSnapshots().stream().sorted(Comparator.comparing(s->s.id())).toList()){
            if(!allowed.contains(spell.id())||vortex.spellbookService().qiandengjiCooldown(id,spell.id())>0
                ||!vortex.qiandengjiMana().hasMana(id,io.vortexcore.combat.ManaGate.cost(vortex,spell.id())))continue;
            boolean damage=spell.mechanics().stream().anyMatch(m->"damage".equals(m.get("type")));
            boolean heal=spell.mechanics().stream().anyMatch(m->"heal".equals(m.get("type")));
            if(damage&&fighting&&hostileInSpellRange(p,spell))return spell.id();
            if(heal&&injuredSpellTarget(p,spell))return spell.id();
            if(fighting&&spell.id().equals("fortify")&&!p.hasPotionEffect(org.bukkit.potion.PotionEffectType.RESISTANCE))return spell.id();
        }return "";
    }
    private boolean injuredSpellTarget(Player p,io.vortexcore.rpg.SpellbookService.EditorSpellSnapshot spell){
        for(var targeter:spell.targeters()){
            String type=String.valueOf(targeter.get("type"));
            if((type.equals("self")||type.equals("nearby_player"))&&p.getHealth()<=p.getMaxHealth()-2)return true;
            if(type.equals("nearby_player")&&targeter.get("range") instanceof Number n&&Double.isFinite(n.doubleValue())&&n.doubleValue()>0&&n.doubleValue()<=64)
                if(io.vortexcore.combat.PartySpellTargets.allies(p,n.doubleValue()).stream().anyMatch(ally->ally.getHealth()<=ally.getMaxHealth()-2))return true;
        }return false;
    }
    private boolean hostileInSpellRange(Player p,io.vortexcore.rpg.SpellbookService.EditorSpellSnapshot spell){
        // Selection is advisory. The original executor repeats resource, target and protection gates.
        for(var targeter:spell.targeters())if("nearby_monster".equals(targeter.get("type"))&&targeter.get("range") instanceof Number n){
            double range=n.doubleValue();if(!Double.isFinite(range)||range<=0||range>64)continue;
            try{var method=Class.forName("local.qdj.maids.brain.ResidentBodyAccess").getMethod("visibleHostile",UUID.class,UUID.class,double.class);
                for(var entity:p.getNearbyEntities(range,range,range))if(Boolean.TRUE.equals(method.invoke(null,p.getUniqueId(),entity.getUniqueId(),range)))return true;
            }catch(ReflectiveOperationException unavailable){return false;}
        }return false;
    }
    boolean mana(UUID id,double amount,boolean spend){
        if(!ready.contains(id)||!Double.isFinite(amount)||amount<0)return false;
        return spend?vortex.qiandengjiMana().consumeMana(id,amount):vortex.qiandengjiMana().hasMana(id,amount);
    }
    boolean refill(UUID id){if(!ready.contains(id))return false;vortex.qiandengjiMana().refillFull(id);return true;}
    void xp(UUID id,long amount){
        if(amount<0||!ready.contains(id))throw new IllegalArgumentException("vortex_profile_not_ready");
        vortex.playerProfileService().grantExperience(actor(id),amount,"native_resident_activity");
    }
    void combatXp(UUID id,long cumulative){
        if(cumulative<0||!ready.contains(id))throw new IllegalArgumentException("vortex_profile_not_ready");
        var profile=vortex.playerProfileService().profile(id).orElseThrow();String key="qiandengji.resident.combatXp";
        long previous=Long.parseLong(profile.metadata().getOrDefault(key,"0"));if(cumulative<=previous)return;
        // Progress marker and XP are persisted in the same original Vortex profile snapshot.
        profile.putMetadata(key,Long.toString(cumulative));xp(id,cumulative-previous);
    }
}
