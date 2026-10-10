package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.File;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.*;
import org.bukkit.inventory.*;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;

/** Native, private capability examinations; observations cannot be submitted by chat/CLI. */
final class SkillAssessments implements Listener {
    static final String CHANNEL="mcagent:exam";
    private final AgentFriendPlugin plugin;
    private final ProfessionLedger ledger;
    private AssessmentCatalog catalog;
    private boolean validLedger=true;
    private final Map<UUID,Run> runs=new HashMap<>();
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private final BukkitTask task;
    private int tick;
    private double lastSampleMs,maxSampleMs;
    private Map<UUID,JsonObject> sampleWrites;
    private List<Runnable> sampleNotices;
    private static final String[] RANKS={"青铜","黑铁","白银","黄金","白金","钻石"};
    private static final String[] DIVISIONS={"III","II","I"};
    private record Menu(UUID owner,List<String> ids,String detail,boolean promotion) { }
    private static final class Ally {
        final UUID id,world;final AssessmentCatalog.Point start;
        AssessmentCatalog.Point previous;long sampled,until;double movement;boolean resistance;
        Ally(Player p,long until) {id=p.getUniqueId();world=p.getWorld().getUID();start=point(p);previous=start;sampled=System.currentTimeMillis();this.until=until;}
    }
    private static final class Run {
        UUID id;AssessmentCatalog.Definition definition;AssessmentCatalog.Grade grade;
        String market="",state="active",reason="prepare_skill",castSkill="",lease="";
        long started,castAt,expires;int castLevel;
        SkillTrajectory trajectory;
        JsonObject proofs=new JsonObject(),savedMeasurements=new JsonObject();
        final Map<UUID,Ally> allies=new LinkedHashMap<>();
        double combatSupport;int checkpoint;
    }
    SkillAssessments(AgentFriendPlugin plugin) {
        this.plugin=plugin;ledger=plugin.professions().ledger;
        for(String name:List.of("skill-assessments.yml","adventurer-grades.yml"))if(!new File(plugin.getDataFolder(),name).exists())plugin.saveResource(name,false);
        reload();validateLedger();
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin,CHANNEL);
        task=Bukkit.getScheduler().runTaskTimer(plugin,this::sample,5L,5L);
    }
    private boolean available() {return catalog!=null&&ledger.ready()&&validLedger;}
    boolean promotionsEnabled() {return catalog!=null&&catalog.promotions;}
    boolean reload() {
        try {
            AssessmentCatalog next=AssessmentCatalog.load(plugin.getDataFolder()),previous=catalog;catalog=next;
            if(plugin.taskMarket()!=null&&!plugin.taskMarket().reload()){catalog=previous;throw new IllegalArgumentException("market assessment references; both catalogs retained");}
            return true;
        }
        catch(Exception error) {plugin.getLogger().warning("Assessment reload rejected; previous definitions retained: "+error.getMessage());return false;}
    }
    private void validateLedger() {
        if(!ledger.ready()){validLedger=false;return;}
        try {
            for(var entry:ledger.data().getAsJsonObject("players").entrySet()) {
                JsonObject profile=entry.getValue().getAsJsonObject();if(!profile.has("academy"))continue;
                JsonObject a=profile.getAsJsonObject("academy");
                if(a.has("grade")&&(a.get("grade").getAsInt()<0||a.get("grade").getAsInt()>17))throw new IllegalArgumentException("grade");
                if(a.has("certificates")&&(a.getAsJsonObject("certificates").size()>32||a.getAsJsonObject("certificates").keySet().stream().anyMatch(s->!s.matches("[a-z0-9_]{2,40}"))))throw new IllegalArgumentException("certificates");
                if(a.has("history")&&a.getAsJsonArray("history").size()>16)throw new IllegalArgumentException("history");
                if(a.has("active")) {
                    Run run=decode(a.getAsJsonObject("active"));
                    if(run.state.equals("active")) {run.state="interrupted";run.reason="server_restart";}
                    UUID id=UUID.fromString(entry.getKey());if(Bukkit.getPlayer(id)!=null)runs.put(id,run);
                }
            }
        }catch(RuntimeException invalid) {validLedger=false;runs.clear();plugin.getLogger().severe("Assessment records retained, examination writes disabled: "+invalid.getMessage());}
    }
    private JsonObject academy(UUID id) {
        JsonObject p=ledger.profile(id);return p.has("academy")?p.getAsJsonObject("academy"):new JsonObject();
    }
    private static JsonObject academy(JsonObject data,UUID id) {
        JsonObject p=ProfessionLedger.profile(data,id);if(!p.has("academy"))p.add("academy",new JsonObject());return p.getAsJsonObject("academy");
    }
    boolean hasCertificate(Player p,String id) {
        JsonObject a=academy(p.getUniqueId());return available()&&a.has("certificates")&&a.getAsJsonObject("certificates").has(id);
    }
    int grade(Player p) {
        int legacy=plugin.guild().legacyRank(p);
        if(!available()||!promotionsEnabled()||!plugin.guild().hasJoined(p)||plugin.isObserver(p))return legacy*3;
        JsonObject a=academy(p.getUniqueId());
        if(!a.has("grade")&&!ledger.write(data->{JsonObject row=academy(data,p.getUniqueId());row.addProperty("grade",legacy*3);
            row.addProperty("migrationRank",legacy);row.addProperty("migratedAt",System.currentTimeMillis());}))return legacy*3;
        return academy(p.getUniqueId()).get("grade").getAsInt();
    }
    String gradeName(Player p) {int g=grade(p);return RANKS[g/3]+" "+DIVISIONS[g%3];}
    boolean busy(Player p) {Run r=runs.get(p.getUniqueId());return r!=null&&r.market.isEmpty()&&Set.of("active","ready").contains(r.state);}
    boolean canAttachContract(Player p,String id) {
        Run r=runs.get(p.getUniqueId());return r!=null&&r.state.equals("active")&&r.definition.primitive().equals("contract_record")
                &&plugin.taskMarket().suppliesAssessmentProof(id,r.definition.proofs());
    }
    AssessmentCatalog.Definition definition(String id) {return catalog==null?null:catalog.definitions.get(id);}
    private String eligibility(Player p,AssessmentCatalog.Definition d) {
        if(!available())return "data_unavailable";
        if(p.getGameMode()!=GameMode.SURVIVAL||p.isDead()||plugin.isObserver(p)||plugin.isDowned(p))return "survival_required";
        if(!plugin.guild().hasJoined(p))return "guild_registration_required";
        if(plugin.pvpParticipant(p)||plugin.dungeonParticipant(p)&&d!=null&&!d.primitive().equals("contract_record"))return "activity_active";
        if(d==null||!d.enabled())return "course_unavailable";
        if(!d.prerequisite().isEmpty()&&!hasCertificate(p,d.prerequisite()))return "certificate_required:"+d.prerequisite();
        if(d.course()!=null) {
            if(!p.getWorld().getUID().equals(d.course().world()))return "wrong_world";
            if(point(p).distance(d.course().start())>d.radius()+1||!safeGround(p))return "go_to_start";
        }
        return "ready";
    }
    private String promotionGate(Player p,AssessmentCatalog.Grade g) {
        if(!promotionsEnabled()||g==null)return "promotion_unavailable";
        if(g.index()!=grade(p)+1)return "grade_changed";
        if(plugin.guild().reputation(p)<g.fame())return "fame_required:"+g.fame();
        if(g.index()%3==0&&!plugin.guild().promotionHistoryMet(g.index()/3,p))return "history_required";
        for(List<String> group:g.prerequisites())if(group.stream().noneMatch(id->hasCertificate(p,id)))return "certificate_required:"+String.join("|",group);
        JsonObject a=academy(p.getUniqueId());Set<String> certificates=a.has("certificates")?a.getAsJsonObject("certificates").keySet():Set.of();
        if(!AssessmentCatalog.distinctGroups(g.prerequisites(),certificates))return "distinct_certificates_required";
        return "ready";
    }
    private void start(Player p,String id,boolean promotion) {
        AssessmentCatalog.Definition d=definition(id);String deny=eligibility(p,d);
        if(!deny.equals("ready")){reply(p,deny,d);return;}
        if(busy(p)||!plugin.getConfig().getString("guild-players."+p.getUniqueId()+".active.id","").isEmpty()) {reply(p,"task_slot_busy",d);return;}
        AssessmentCatalog.Grade g=promotion&&grade(p)<17?catalog.grades.get(grade(p)+1):null;
        if(promotion) {
            deny=promotionGate(p,g);
            if(!deny.equals("ready")||!g.fresh().contains(id)){reply(p,deny.equals("ready")?"choose_promotion_topic":deny,d);return;}
        }
        Run r=newRun(d,"");r.grade=g;
        if(!save(p,r)){reply(p,"data_unavailable",d);return;}
        runs.put(p.getUniqueId(),r);
        if(d.primitive().equals("native_lesson")) {plugin.featureTutorials().show(p);plugin.traversalPractice().command(p,"start");reuseTraining(p,r);}
        show(p);p.sendMessage("§a考试已开始："+d.title()+"。"+d.description()+"；技能需本人主动准备、施放并实际操作，查询不收费。");
    }
    private Run newRun(AssessmentCatalog.Definition d,String market) {
        Run r=new Run();r.id=UUID.randomUUID();r.definition=d;r.market=market;r.started=System.currentTimeMillis();
        r.expires=r.started+d.timeout()*1000L;if(d.course()!=null)r.trajectory=new SkillTrajectory(d);return r;
    }
    /** Called before observations as well as on the 5-tick sampler. Market step token owns the run. */
    private Run current(Player p) {
        Run r=runs.get(p.getUniqueId());
        if(r==null&&available()&&academy(p.getUniqueId()).has("active")) {
            try {r=decode(academy(p.getUniqueId()).getAsJsonObject("active"));if(r.state.equals("active")){r.state="interrupted";r.reason="server_restart";}runs.put(p.getUniqueId(),r);}
            catch(RuntimeException invalid){validLedger=false;plugin.getLogger().severe("Invalid assessment record retained for "+p.getUniqueId());return null;}
        }
        TaskMarketManager market=plugin.taskMarket();
        AssessmentCatalog.Definition d=market==null?null:market.activeAssessment(p);
        String token=d==null?"":market.stepToken(p);
        if(r!=null&&!r.market.isEmpty()&&!r.market.equals(token)) {
            if(d==null){if(r.state.equals("active"))r.state="cancelled";r.reason="market_step_finished";r.market="";save(p,r);return r;}
            runs.remove(p.getUniqueId());r=null;
        }
        if(d!=null&&(r==null||!r.market.equals(token))) {
            String deny=eligibility(p,d);if(!deny.equals("ready"))return null;
            r=newRun(d,token);if(!save(p,r))return null;runs.put(p.getUniqueId(),r);
            p.sendMessage("§b能力阶段已开始："+d.title()+"；/mycli guild exam status 查看当前目标。技能须在本阶段开始后施放。");
            if(d.primitive().equals("native_lesson")){plugin.featureTutorials().show(p);plugin.traversalPractice().command(p,"start");reuseTraining(p,r);}
        }
        return r;
    }
    void cast(Player p,String id) {
        Run r=current(p);if(r==null||!r.state.equals("active")||!r.definition.skills().contains(id))return;
        if(r.definition.primitive().equals("flight_route")) {
            FlightLeases.Lease lease=plugin.flightLeases().active(p);
            if(lease==null||!lease.skill().equals(id)||lease.started()<r.started)return;
            if(!r.lease.isEmpty()){interrupt(p,r,"flight_recast");return;}
            if(point(p).distance(r.definition.course().start())>r.definition.radius()+1){interrupt(p,r,"go_to_start");return;}
            r.lease=lease.token().toString();r.castSkill=id;r.castLevel=lease.level();r.castAt=lease.started();
            r.expires=Math.min(r.expires,lease.expires()+8000);r.reason="sampling";save(p,r);
        }else if(r.definition.primitive().equals("leap_route")) {
            if(r.castAt>0&&(!safeGround(p)||r.trajectory==null)){interrupt(p,r,"unsafe_path");return;}
            r.castSkill=id;r.castLevel=plugin.professions().level(p,id);r.castAt=System.currentTimeMillis();r.reason="sampling";
            r.trajectory.jump(p.getLocation().getY());save(p,r);
        }
    }
    void blessed(Player p,ProfessionCatalog.Skill skill,List<Player> beneficiaries,Map<UUID,Set<PotionEffectType>> applied) {
        for(Player target:beneficiaries)if(applied.getOrDefault(target.getUniqueId(),Set.of()).contains(PotionEffectType.RESISTANCE))
            for(Run previous:runs.values()){Ally a=previous.allies.get(target.getUniqueId());if(a!=null)a.resistance=false;}
        Run r=current(p);if(r==null||!r.state.equals("active")||!r.definition.primitive().equals("support_route")||!r.definition.skills().contains(skill.id()))return;
        if(r.castAt>0){interrupt(p,r,"support_recast");return;}
        r.castSkill=skill.id();r.castLevel=plugin.professions().level(p,skill.id());r.castAt=System.currentTimeMillis();
        for(Player ally:beneficiaries)if(ally!=p){Ally a=new Ally(ally,r.castAt+skill.ticks()*50L);a.resistance=applied.getOrDefault(ally.getUniqueId(),Set.of()).contains(PotionEffectType.RESISTANCE);r.allies.put(ally.getUniqueId(),a);}
        r.reason="support_observing";save(p,r);
    }
    private void reuseTraining(Player p,Run r) {
        if(!r.definition.reuseTraining())return;
        for(String proof:r.definition.proofs()) {
            boolean done=proof.equals("door_passage")||proof.equals("ladder_ascent")?plugin.traversalPractice().verified(p,proof):plugin.featureTutorials().verified(p,proof);
            if(done)r.proofs.addProperty(proof,"retained_server_training");
        }
        checkProofs(p,r);
    }
    void proof(Player p,String id,String evidence) {
        Run r=current(p);if(r==null||!r.state.equals("active")||!r.definition.proofs().contains(id)||evidence.length()>200)return;
        r.proofs.addProperty(id,evidence);checkProofs(p,r);if(r.state.equals("active"))save(p,r);
    }
    private void checkProofs(Player p,Run r) {
        if(r.definition.proofs().isEmpty())return;
        boolean ready=r.definition.allProofs()?r.definition.proofs().stream().allMatch(r.proofs::has):r.definition.proofs().stream().anyMatch(r.proofs::has);
        if(ready)ready(p,r);
    }
    void supportEvidence(Player caster,Player target,double amount,String kind) {
        Run r=runs.get(caster.getUniqueId());if(r==null||!r.state.equals("active")||!r.allies.containsKey(target.getUniqueId())||!Double.isFinite(amount)||amount<=0)return;
        Ally ally=r.allies.get(target.getUniqueId());if(System.currentTimeMillis()>ally.until||!target.getWorld().getUID().equals(ally.world))return;
        boolean first=r.combatSupport==0;r.combatSupport=Math.min(1000,r.combatSupport+amount);r.proofs.addProperty("combat_support",kind);if(first)save(caster,r);
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void unsafeDamage(EntityDamageEvent e) {
        if(!(e.getEntity() instanceof Player p)||e.getFinalDamage()<=0)return;
        Run r=runs.get(p.getUniqueId());
        if(r!=null&&r.state.equals("active")&&r.trajectory!=null&&r.castAt>0)interrupt(p,r,"external_damage");
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void damaged(EntityDamageByEntityEvent e) {
        if(!(e.getEntity() instanceof Player target))return;
        Entity damager=e.getDamager();if(damager instanceof Projectile shot&&shot.getShooter() instanceof Entity shooter)damager=shooter;
        if(!(damager instanceof Enemy)||e.getFinalDamage()<=0)return;
        Run own=runs.get(target.getUniqueId());if(own!=null&&own.state.equals("active")&&own.trajectory!=null)interrupt(target,own,"external_damage");
        if(!e.isApplicable(EntityDamageEvent.DamageModifier.RESISTANCE)||e.getDamage(EntityDamageEvent.DamageModifier.RESISTANCE)>=0)return;
        for(var entry:List.copyOf(runs.entrySet())) {
            Player caster=Bukkit.getPlayer(entry.getKey());Run r=entry.getValue();
            Ally a=r.allies.get(target.getUniqueId());var effect=target.getPotionEffect(PotionEffectType.RESISTANCE);
            if(caster!=null&&r.castSkill.equals("priest_blessing")&&a!=null&&a.resistance&&effect!=null&&effect.getAmplifier()==0)
                supportEvidence(caster,target,-e.getDamage(EntityDamageEvent.DamageModifier.RESISTANCE),"native_resistance");
        }
    }
    private void sample() {
        long began=System.nanoTime();tick++;
        if(!available())return;
        sampleWrites=new LinkedHashMap<>();sampleNotices=new ArrayList<>();
        try {
        for(Player p:Bukkit.getOnlinePlayers()) {
            Run r=current(p);if(r==null||!r.state.equals("active"))continue;
            AssessmentCatalog.Definition live=definition(r.definition.id());
            if(live==null||!live.enabled()){interrupt(p,r,"course_disabled");continue;}
            if(p.getGameMode()!=GameMode.SURVIVAL||p.isDead()||plugin.isDowned(p)||plugin.dungeonParticipant(p)&&!r.definition.primitive().equals("contract_record")||plugin.pvpParticipant(p)
                    ||p.isInsideVehicle()||p.isGliding()||p.hasPotionEffect(PotionEffectType.LEVITATION)){interrupt(p,r,"activity_changed");continue;}
            if(System.currentTimeMillis()>r.expires){interrupt(p,r,"timeout");continue;}
            if(r.definition.course()!=null&&!p.getWorld().getUID().equals(r.definition.course().world())){interrupt(p,r,"world_changed");continue;}
            if(r.trajectory!=null&&r.castAt>0)sampleTrajectory(p,r);
            if(r.definition.primitive().equals("support_route")&&r.castAt>0)sampleSupport(p,r);
            if(tick%4==0&&r.state.equals("active"))waypoint(p,r);
        }
        } finally {flushSamples();}
        lastSampleMs=(System.nanoTime()-began)/1e6;maxSampleMs=Math.max(maxSampleMs,lastSampleMs);
    }
    private void afterSave(Runnable notice) {if(sampleNotices==null)notice.run();else sampleNotices.add(notice);}
    private void flushSamples() {
        Map<UUID,JsonObject> writes=sampleWrites;List<Runnable> notices=sampleNotices;
        sampleWrites=null;sampleNotices=null;
        if(writes.isEmpty())return;
        // One forced atomic ledger replacement for this entire native sampling boundary.
        // Success messages and market completion wait until every included record is durable.
        if(!ledger.write(root->writes.forEach((id,data)->writeRecord(root,id,data)))) {
            validLedger=false;
            for(UUID id:writes.keySet()) {
                Run r=runs.get(id);if(r!=null){r.state="interrupted";r.reason="data_unavailable";}
                Player p=Bukkit.getPlayer(id);if(p!=null)p.sendMessage("§c考试进度保存失败，验收已停用；请联系服主检查存储，旧证书和声望保留。");
            }
            plugin.getLogger().severe("Assessment batch could not be saved; examination writes disabled until storage is repaired and the server restarts.");
            return;
        }
        notices.forEach(Runnable::run);
    }
    private void sampleTrajectory(Player p,Run r) {
        boolean flying=r.definition.primitive().equals("flight_route");FlightLeases.Lease lease=plugin.flightLeases().active(p);
        boolean powered=flying?lease!=null&&lease.token().toString().equals(r.lease)&&p.isFlying():!p.isFlying()&&plugin.professions().level(p,r.castSkill)>0;
        if(flying&&lease!=null&&!lease.token().toString().equals(r.lease)){interrupt(p,r,"flight_recast");return;}
        if(!flying&&!powered){interrupt(p,r,"skill_qualification_changed");return;}
        String result=r.trajectory.accept(new SkillTrajectory.Sample(System.currentTimeMillis(),point(p),p.getLocation().getYaw(),!p.isOnGround(),safeGround(p)),powered,
                flying&&(lease!=null&&lease.token().toString().equals(r.lease)||lease==null&&p.hasPotionEffect(PotionEffectType.SLOW_FALLING)));
        r.reason=result;
        if(Set.of("outside_course","impossible_displacement").contains(result)){interrupt(p,r,result);return;}
        if(result.equals("ready")){ready(p,r);return;}
        if(r.checkpoint!=r.trajectory.checkpoint()){r.checkpoint=r.trajectory.checkpoint();if(save(p,r))afterSave(()->p.sendMessage("§b已通过航点 "+r.checkpoint+"；/mycli guild exam status 查下一个目标。"));}
    }
    private void sampleSupport(Player p,Run r) {
        long now=System.currentTimeMillis();
        for(Ally a:r.allies.values()) {
            Player ally=Bukkit.getPlayer(a.id);if(ally==null||ally.isDead()||plugin.isDowned(ally)||ally.getGameMode()!=GameMode.SURVIVAL
                    ||!ally.getWorld().getUID().equals(a.world)||now>a.until||ally.isInsideVehicle()||ally.isFlying()||ally.isGliding())continue;
            AssessmentCatalog.Point at=point(ally);long delta=now-a.sampled;double distance=at.distance(a.previous);
            if(delta>0&&delta<=750&&distance<=Math.max(3,delta/1000.0*10))a.movement=Math.min(64,a.movement+Math.hypot(at.x()-a.previous.x(),at.z()-a.previous.z()));
            a.previous=at;a.sampled=now;
        }
        long moved=r.allies.values().stream().filter(a->a.movement>=r.definition.allyMovement()).count();
        if(r.allies.size()>=r.definition.allies()&&moved>=r.definition.allies()&&(!r.definition.combatSupport()||r.combatSupport>0))ready(p,r);
        else if(r.allies.isEmpty()||r.allies.values().stream().allMatch(a->now>a.until))interrupt(p,r,"support_effect_expired");
    }
    private boolean safeGround(Player p) {
        if(!p.isOnGround()||p.isInWater()||p.isInsideVehicle()||p.isGliding())return false;
        Location at=p.getLocation();if(!at.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4))return false;
        var support=at.clone().subtract(0,.08,0).getBlock();
        return !support.isLiquid()&&support.getType().isSolid()&&!Set.of(Material.MAGMA_BLOCK,Material.CAMPFIRE,Material.SOUL_CAMPFIRE,Material.CACTUS,Material.POWDER_SNOW).contains(support.getType())
                &&support.getBoundingBox().getMaxY()>=at.getY()-.12;
    }
    private static AssessmentCatalog.Point point(Player p) {Location at=p.getLocation();return new AssessmentCatalog.Point(at.getX(),at.getY(),at.getZ());}
    private AssessmentCatalog.Point target(Run r) {
        if(r.definition.course()==null)return null;var c=r.definition.course();
        if(r.castAt==0)return c.start();int next=r.trajectory==null?r.checkpoint:r.trajectory.checkpoint();return next<c.checkpoints().size()?c.checkpoints().get(next):c.landing();
    }
    private void waypoint(Player p,Run r) {
        AssessmentCatalog.Point target=target(r);if(target==null||!p.getWorld().getUID().equals(r.definition.course().world()))return;
        Location at=new Location(p.getWorld(),target.x(),target.y()+.1,target.z());
        if(p.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)&&p.getLocation().distanceSquared(at)<64*64)
            p.spawnParticle(Particle.END_ROD,at,4,.4,.2,.4,.01);
    }
    private void ready(Player p,Run r) {
        if(!r.state.equals("active"))return;r.state="ready";r.reason="ready";
        if(!save(p,r)){r.state="active";r.reason="data_unavailable";return;}
        afterSave(()->announceReady(p,r));
    }
    private void announceReady(Player p,Run r) {
        if(!r.market.isEmpty())plugin.taskMarket().worldAction(p,GuildManager.Goal.SKILL_ASSESSMENT,r.definition.id(),"assessment:"+r.id,System.currentTimeMillis());
        p.sendMessage("§a实操达成："+r.definition.title()+"；"+(r.market.isEmpty()?"/mycli guild exam submit 交付证书或晋级":"/mycli guild claim 交付本阶段")+"，不会自动发物品或技能点。");show(p);
    }
    private void interrupt(Player p,Run r,String reason) {
        if(!r.state.equals("active"))return;r.state="interrupted";r.reason=reason;save(p,r);
        afterSave(()->p.sendMessage("§e考试中断："+reason+"。"+next(r)+" 已花的技能魔力与冷却照常，声望和旧证书保持。"));
    }
    void qualificationChanged(Player p) {
        Run r=runs.get(p.getUniqueId());if(r!=null&&r.state.equals("active")&&r.castAt>0)interrupt(p,r,"skill_qualification_changed");
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void teleport(PlayerTeleportEvent e) {
        Run r=runs.get(e.getPlayer().getUniqueId());if(r!=null)interrupt(e.getPlayer(),r,"teleport");
        for(var entry:runs.entrySet())if(entry.getValue().allies.remove(e.getPlayer().getUniqueId())!=null) {
            Player caster=Bukkit.getPlayer(entry.getKey());if(caster!=null)save(caster,entry.getValue());
        }
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void mode(PlayerGameModeChangeEvent e) {qualificationChanged(e.getPlayer());}
    @EventHandler(priority=EventPriority.MONITOR) public void death(PlayerDeathEvent e) {qualificationChanged(e.getEntity());}
    @EventHandler(priority=EventPriority.MONITOR) public void quit(PlayerQuitEvent e) {
        Run r=runs.get(e.getPlayer().getUniqueId());if(r!=null)interrupt(e.getPlayer(),r,"logout");runs.remove(e.getPlayer().getUniqueId());
        menus.entrySet().removeIf(x->x.getValue().owner.equals(e.getPlayer().getUniqueId()));
        for(var entry:runs.entrySet())entry.getValue().allies.remove(e.getPlayer().getUniqueId());
    }
    boolean submitMarket(Player p) {
        Run r=current(p);if(r==null||r.market.isEmpty())return false;return submit(p,r);
    }
    private boolean submit(Player p,Run r) {
        if(r.state.equals("submitted")){p.sendMessage("§e本次考试已交付；/mycli guild certificates 查看证书，不会重复发放。");show(p);return true;}
        if(!r.state.equals("ready")){reply(p,"practice_incomplete",r.definition);show(p);return false;}
        if(r.grade!=null) {String gate=promotionGate(p,r.grade);if(!gate.equals("ready")){reply(p,gate,r.definition);return false;}}
        JsonObject active=record(r);active.addProperty("state","submitted");active.addProperty("reason","submitted");active.addProperty("submittedAt",System.currentTimeMillis());
        JsonObject proof=active.deepCopy();proof.remove("definition");proof.addProperty("assessmentId",r.definition.id());proof.addProperty("version",r.definition.version());
        UUID id=p.getUniqueId();
        if(!ledger.write(data->{JsonObject a=academy(data,id);
            if(!a.has("active")||!a.getAsJsonObject("active").get("runId").getAsString().equals(r.id.toString()))throw new IllegalStateException("run changed");
            if(!a.has("certificates"))a.add("certificates",new JsonObject());
            if(a.getAsJsonObject("certificates").size()>=32&&!a.getAsJsonObject("certificates").has(r.definition.id()))throw new IllegalStateException("certificate capacity");
            a.getAsJsonObject("certificates").add(r.definition.id(),proof.deepCopy());
            if(r.grade!=null){if(!a.has("grade")||a.get("grade").getAsInt()!=r.grade.index()-1)throw new IllegalStateException("grade changed");a.addProperty("grade",r.grade.index());}
            a.add("active",active);history(a,proof);
        })) {reply(p,"data_unavailable",r.definition);return false;}
        r.state="submitted";r.reason="submitted";
        if(r.grade!=null){plugin.guild().mirrorPromotion(p,r.grade.index()/3);p.sendMessage("§6晋级考试通过："+gradeName(p)+"。没有额外声望或技能点，失败不降级。");}
        else p.sendMessage("§a已取得能力证书："+r.definition.title()+"；/mycli guild certificates 查看，可用于对应技能升级或晋级条件。");
        show(p);return true;
    }
    private static void history(JsonObject a,JsonObject proof) {
        JsonArray history=a.has("history")?a.getAsJsonArray("history"):new JsonArray();
        if(history.asList().stream().noneMatch(x->x.getAsJsonObject().get("runId").equals(proof.get("runId"))))history.add(proof.deepCopy());
        while(history.size()>16)history.remove(0);a.add("history",history);
    }
    private boolean save(Player p,Run r) {
        if(!available())return false;JsonObject data=record(r);
        if(sampleWrites!=null){sampleWrites.put(p.getUniqueId(),data);return true;}
        return ledger.write(root->writeRecord(root,p.getUniqueId(),data));
    }
    private static void writeRecord(JsonObject root,UUID id,JsonObject data) {
        JsonObject a=academy(root,id);
            if(a.has("active")&&!a.getAsJsonObject("active").get("runId").equals(data.get("runId"))) {
                JsonObject previous=a.getAsJsonObject("active").deepCopy();
                AssessmentCatalog.Definition d=AssessmentCatalog.frozen(previous.remove("definition").getAsString());
                previous.addProperty("assessmentId",d.id());previous.addProperty("version",d.version());history(a,previous);
            }
            a.add("active",data);
    }
    private JsonObject record(Run r) {
        JsonObject o=new JsonObject();o.addProperty("runId",r.id.toString());o.addProperty("definition",AssessmentCatalog.snapshot(r.definition));
        o.addProperty("marketToken",r.market);o.addProperty("state",r.state);o.addProperty("reason",r.reason);o.addProperty("startedAt",r.started);
        o.addProperty("expiresAt",r.expires);o.addProperty("castAt",r.castAt);o.addProperty("castSkill",r.castSkill);o.addProperty("castLevel",r.castLevel);o.addProperty("flightLease",r.lease);
        o.addProperty("executionSource","unknown_client");o.add("measurements",measurements(r));o.add("proofs",r.proofs.deepCopy());
        if(r.grade!=null)o.add("promotion",AssessmentCatalog.JSON.toJsonTree(r.grade));return o;
    }
    private Run decode(JsonObject o) {
        if(o.toString().length()>24000)throw new IllegalArgumentException("run size");Run r=new Run();r.id=UUID.fromString(o.get("runId").getAsString());
        r.definition=AssessmentCatalog.frozen(o.get("definition").getAsString());r.market=o.get("marketToken").getAsString();r.state=o.get("state").getAsString();
        if(!Set.of("active","ready","interrupted","submitted","cancelled").contains(r.state)||r.market.length()>80)throw new IllegalArgumentException("run state/token");
        r.reason=o.get("reason").getAsString();r.started=o.get("startedAt").getAsLong();r.expires=o.get("expiresAt").getAsLong();r.castAt=o.get("castAt").getAsLong();
        r.castSkill=o.get("castSkill").getAsString();r.castLevel=o.get("castLevel").getAsInt();r.lease=o.get("flightLease").getAsString();
        r.proofs=o.getAsJsonObject("proofs").deepCopy();r.savedMeasurements=o.getAsJsonObject("measurements").deepCopy();
        r.combatSupport=r.savedMeasurements.has("combatSupport")?r.savedMeasurements.get("combatSupport").getAsDouble():0;
        if(o.has("promotion")){r.grade=AssessmentCatalog.JSON.fromJson(o.get("promotion"),AssessmentCatalog.Grade.class);
            if(r.grade.index()<1||r.grade.index()>17||r.grade.prerequisites().size()>8||r.grade.fresh().size()>12||!r.grade.fresh().contains(r.definition.id()))throw new IllegalArgumentException("promotion record");}
        return r;
    }
    private JsonObject measurements(Run r) {
        JsonObject o=r.trajectory!=null?r.trajectory.measurements():r.savedMeasurements.deepCopy();
        if(!r.allies.isEmpty()){JsonArray a=new JsonArray();for(Ally ally:r.allies.values()){JsonObject entry=new JsonObject();entry.addProperty("uuid",ally.id.toString());entry.addProperty("distance",Math.round(ally.movement*100)/100.0);a.add(entry);}o.add("beneficiaries",a);}
        o.addProperty("combatSupport",r.combatSupport);return o;
    }
    JsonObject summary(Player p) {
        JsonObject out=new JsonObject();out.addProperty("available",available());out.addProperty("gradeIndex",grade(p));out.addProperty("division",3-grade(p)%3);
        out.addProperty("gradeName",gradeName(p));Run r=runs.get(p.getUniqueId());
        if(r!=null){out.addProperty("examId",r.definition.id());out.addProperty("runId",r.id.toString());out.addProperty("state",r.state);out.addProperty("reason",r.reason);out.addProperty("nextAction",next(r));}
        JsonObject a=academy(p.getUniqueId());out.addProperty("certificateCount",a.has("certificates")?a.getAsJsonObject("certificates").size():0);return out;
    }
    private String next(Run r) {
        if(r.state.equals("submitted"))return "/mycli guild certificates";
        if(r.state.equals("ready"))return r.market.isEmpty()?"/mycli guild exam submit":"/mycli guild claim";
        if(Set.of("interrupted","cancelled").contains(r.state))return r.market.isEmpty()?"落地后 /mycli guild exam start "+(r.grade!=null?"promotion ":"")+r.definition.id():"/mycli guild exam retry；从本阶段重新实操";
        if(r.castAt==0&&!r.definition.skills().isEmpty())return "/mycli skills info "+r.definition.skills().getFirst()+"；主动学习、准备并施放后实际移动";
        if(r.definition.primitive().equals("flight_route"))return "依次经过航点；保持空中水平移动、转向、升降，面朝前方后退，再到降落台稳定停留2秒";
        return r.definition.description();
    }
    void show(Player p) {
        Run r=current(p);JsonObject out=summary(p);out.addProperty("type","status");out.addProperty("schemaVersion",1);out.addProperty("subjectUuid",p.getUniqueId().toString());out.addProperty("scope","self");
        if(r!=null){out.addProperty("version",r.definition.version());out.add("requirements",AssessmentCatalog.JSON.toJsonTree(r.definition));out.add("measured",measurements(r));
            AssessmentCatalog.Point target=target(r);if(target!=null){JsonObject at=AssessmentCatalog.JSON.toJsonTree(target).getAsJsonObject();at.addProperty("worldUuid",r.definition.course().world().toString());out.add("target",at);}
            p.sendMessage("§b"+r.definition.title()+"："+r.state+"；"+next(r));
            if(target!=null)p.sendMessage("§e当前目标 "+r.definition.course().world()+" X="+target.x()+" Y="+target.y()+" Z="+target.z()+"，距离 "+Math.round(point(p).distance(target))+"格；测量 "+measurements(r));
        }else p.sendMessage("§e没有在办考试；/mycli guild exam list 看题目，或 /mycli guild exam promotion 查下一阶。");
        send(p,"MC_GUILD_EXAM",out);
    }
    private void send(Player p,String prefix,JsonObject out) {
        out.addProperty("schemaVersion",1);out.addProperty("subjectUuid",p.getUniqueId().toString());out.addProperty("scope","self");
        p.sendMessage(prefix+" "+out);byte[] bytes=out.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);if(bytes.length<=24000)p.sendPluginMessage(plugin,CHANNEL,bytes);
    }
    private void reply(Player p,String reason,AssessmentCatalog.Definition d) {
        p.sendMessage("§e未开始/未交付："+reason+"。"+(reason.equals("go_to_start")&&d!=null&&d.course()!=null?"请正常前往出发台 "+d.course().world()+" "+d.course().start()+"，落地后开考。":
                reason.equals("task_slot_busy")?"先 /mycli guild status 或 guild exam status 查看当前任务；交付或主动放弃后再开考。":
                reason.startsWith("certificate_required")?"/mycli guild certificates 查看已取得证书；/mycli guild exam list 选择所缺能力题。":
                reason.equals("course_unavailable")?"该场地尚未开放；选择列表中已开放的题目，或联系服主勘察并配置场地。":
                "请 /mycli guild exam promotion 或 guild exam info "+(d==null?"<ID>":d.id())+" 查看条件，准备好后重试。"));
    }
    void certificates(Player p) {
        JsonObject out=summary(p);out.addProperty("type","certificates");JsonArray list=new JsonArray();JsonObject a=academy(p.getUniqueId());
        if(a.has("certificates"))for(var entry:a.getAsJsonObject("certificates").entrySet()) {
            JsonObject r=entry.getValue().getAsJsonObject();JsonObject item=new JsonObject();item.addProperty("id",entry.getKey());item.addProperty("runId",r.get("runId").getAsString());
            item.add("measured",r.get("measurements").deepCopy());item.addProperty("executionSource",r.get("executionSource").getAsString());list.add(item);
            p.sendMessage("§a✓ "+entry.getKey()+" · 已认证；动作记录不代表已测自主规划能力。");
        }
        out.add("certificates",list);send(p,"MC_GUILD_CERTIFICATES",out);
    }
    private void promotion(Player p) {
        int grade=grade(p);JsonObject out=summary(p);out.addProperty("type","promotion");out.addProperty("fame",plugin.guild().reputation(p));
        p.sendMessage("§6冒险者 "+gradeName(p)+"；声望 "+plugin.guild().reputation(p)+"。小段晋级需要本人选择并完成考试，不自动跳段。");
        if(catalog!=null&&grade<17){var g=catalog.grades.get(grade+1);out.add("nextGrade",AssessmentCatalog.JSON.toJsonTree(g));String gate=promotionGate(p,g);out.addProperty("eligibility",gate);
            out.addProperty("fameRemaining",Math.max(0,g.fame()-plugin.guild().reputation(p)));
            if(g.index()%3==0)out.addProperty("historyRequirement",plugin.guild().promotionHistoryAdvice(g.index()/3));
            p.sendMessage("§e下一阶："+RANKS[g.index()/3]+" "+DIVISIONS[g.index()%3]+"，最低声望 "+g.fame()+"；"+g.description()+"；当前："+gate);
            p.sendMessage("§b现场考试任选 "+String.join("、",g.fresh())+"；/mycli guild exam start promotion <题目ID>。旧大段已映射同段III，声望/技能点/奖励保持。");}
        send(p,"MC_GUILD_EXAM",out);
    }
    void command(Player p,String[] args) {
        String action=args.length>2?args[2].toLowerCase(Locale.ROOT):"menu";
        switch(action) {
            case "menu" -> menu(p,false);
            case "list" -> {for(var d:catalog==null?List.<AssessmentCatalog.Definition>of():catalog.definitions.values().stream().sorted(Comparator.comparing(AssessmentCatalog.Definition::id)).toList())p.sendMessage("§e"+d.id()+" · "+d.title()+" ["+(d.enabled()?"开放":"待勘察场地")+"] "+d.description());promotion(p);}
            case "info" -> {AssessmentCatalog.Definition d=args.length>3?definition(args[3]):null;if(d==null){reply(p,"unknown_exam",null);break;}JsonObject o=AssessmentCatalog.JSON.toJsonTree(d).getAsJsonObject();o.addProperty("type","definition");o.addProperty("eligibility",eligibility(p,d));send(p,"MC_GUILD_EXAM",o);p.sendMessage("§b"+d.title()+"："+d.description()+"；限时"+d.timeout()+"秒。/mycli guild exam start "+d.id());}
            case "start" -> {if(args.length<4){reply(p,"choose_exam",null);break;}boolean promotion=args[3].equals("promotion");if(promotion&&args.length<5){promotion(p);break;}start(p,args[promotion?4:3],promotion);}
            case "status" -> show(p);
            case "promotion", "rank" -> promotion(p);
            case "submit" -> {Run r=current(p);if(r==null)reply(p,"no_exam",null);else if(!r.market.isEmpty())p.sendMessage("§e此题属于市场委托；请 /mycli guild claim 交付，不能独立重复结算。");else submit(p,r);}
            case "cancel" -> {Run r=current(p);if(r==null)break;if(!r.market.isEmpty()){p.sendMessage("§e请 /mycli guild abandon 放弃市场委托；不会暗中释放当前阶段。");break;}r.state="cancelled";r.reason="player_cancelled";save(p,r);show(p);}
            case "retry" -> {Run r=current(p);if(r==null||r.market.isEmpty()||!r.state.equals("interrupted")){reply(p,"retry_market_interrupted_only",null);break;}String gate=eligibility(p,r.definition);if(!gate.equals("ready")){reply(p,gate,r.definition);break;}Run next=newRun(r.definition,r.market);if(save(p,next)){runs.put(p.getUniqueId(),next);show(p);}}
            default -> p.sendMessage("§e/mycli guild exam list|info <ID>|start <ID>|start promotion <ID>|status|submit|cancel|retry；guild certificates 查看证书。");
        }
    }
    private void menu(Player p,boolean promotion) {
        List<String> ids=catalog==null?List.of():catalog.definitions.keySet().stream().sorted().toList();
        if(promotion&&grade(p)<17)ids=catalog.grades.get(grade(p)+1).fresh();
        Inventory inv=Bukkit.createInventory(null,45,promotion?"晋级考试 · 选择专长":"公会 · 训练与考试");
        for(int i=0;i<ids.size();i++){var d=definition(ids.get(i));inv.setItem(i,icon(Material.WRITABLE_BOOK,d.title(),d.description(),d.enabled()?"点击查看条件，自行确认开考":"场地待勘察，暂不能开考",hasCertificate(p,d.id())?"已有证书，可重练":"未认证"));}
        inv.setItem(36,icon(Material.EXPERIENCE_BOTTLE,gradeName(p)+" · 晋级考试","查看下一阶，并选择现场专长题"));inv.setItem(37,icon(Material.BOOK,"我的能力证书"));
        inv.setItem(38,icon(Material.CLOCK,"当前考试与目标"));inv.setItem(40,icon(Material.BARRIER,"关闭"));
        menus.put(inv,new Menu(p.getUniqueId(),List.copyOf(ids),"",promotion));p.openInventory(inv);
    }
    private ItemStack icon(Material type,String name,String... lore) {ItemStack item=new ItemStack(type);var meta=item.getItemMeta();meta.setDisplayName(name);meta.setLore(List.of(lore));item.setItemMeta(meta);return item;}
    @EventHandler(priority=EventPriority.HIGHEST) public void click(InventoryClickEvent e) {
        Menu m=menus.get(e.getView().getTopInventory());if(m==null)return;e.setCancelled(true);
        if(!(e.getWhoClicked() instanceof Player p)||!m.owner.equals(p.getUniqueId())||e.getRawSlot()<0||e.getRawSlot()>=e.getView().getTopInventory().getSize())return;
        int slot=e.getRawSlot();p.closeInventory();
        if(!m.detail.isEmpty()){if(slot==11)start(p,m.detail,m.promotion);else if(slot==15)menu(p,m.promotion);return;}
        if(slot<m.ids.size()){String id=m.ids.get(slot);var d=definition(id);Inventory inv=Bukkit.createInventory(null,27,d.title()+" · 确认开考");
            inv.setItem(4,icon(Material.BOOK,d.title(),d.description(),"条件："+eligibility(p,d),"限时"+d.timeout()+"秒；技能消耗照常；不自动花点"));
            inv.setItem(11,icon(Material.EMERALD,"主动开始考试"));inv.setItem(15,icon(Material.ARROW,"返回"));menus.put(inv,new Menu(p.getUniqueId(),List.of(),id,m.promotion));p.openInventory(inv);
        }else if(slot==36){promotion(p);menu(p,true);}else if(slot==37)certificates(p);else if(slot==38)show(p);
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void drag(InventoryDragEvent e) {if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e) {menus.remove(e.getInventory());}
    String bookPage(Player p) {
        JsonObject a=academy(p.getUniqueId());String ids=a.has("certificates")?String.join("、",a.getAsJsonObject("certificates").keySet()):"未认证";
        return "§6冒险者认证§r\n\n"+gradeName(p)+"\n声望 "+plugin.guild().reputation(p)+"\n\n能力证书："+ids+"\n\n公会→训练与考试\n/mycli guild exam promotion\n查看下一级缺项。\n\n旧资历保留，声望达标后主动考试，不自动花点。";
    }
    void admin(CommandSender sender,String[] args) {
        if(args.length>2&&args[2].equals("reload"))sender.sendMessage(reload()?"考试与18阶目录已热加载；在途定义保持冻结。":"配置错误，已保留上次有效目录；修正两份配置后再加载。");
        else sender.sendMessage("Assessment catalog="+(catalog==null?0:catalog.definitions.size())+" ledger="+available()+" active="+runs.values().stream().filter(r->r.state.equals("active")).count()+" sampleMs="+lastSampleMs+" peakMs="+maxSampleMs);
    }
    void shutdown() {task.cancel();for(var entry:List.copyOf(runs.entrySet())){Player p=Bukkit.getPlayer(entry.getKey());if(p!=null)interrupt(p,entry.getValue(),"server_restart");}menus.clear();}
}
