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
    private final ExamSupplies supplies;
    private AssessmentCatalog catalog;
    private boolean validLedger=true;
    private final Map<UUID,Run> runs=new HashMap<>();
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private final BukkitTask task;
    private int tick;
    private double lastSampleMs,maxSampleMs;
    private Map<UUID,JsonObject> sampleWrites;
    private Map<UUID,Run> sampleCandidates;
    private List<Runnable> sampleNotices;
    private static final String[] RANKS={"青铜","黑铁","白银","黄金","白金","钻石"};
    private static final String[] DIVISIONS={"III","II","I"};
    private record Menu(UUID owner,List<String> ids,String detail,boolean promotion,int targetGrade) {
        Menu(UUID owner,List<String> ids,String detail,boolean promotion) { this(owner,ids,detail,promotion,-1); }
    }
    private static final class Ally {
        final UUID id,world;final AssessmentCatalog.Point start;
        AssessmentCatalog.Point previous;long sampled,until;double movement;boolean resistance;
        Ally(Player p,long until) {id=p.getUniqueId();world=p.getWorld().getUID();start=point(p);previous=start;sampled=System.currentTimeMillis();this.until=until;}
        Ally(Ally a) {id=a.id;world=a.world;start=a.start;previous=a.previous;sampled=a.sampled;until=a.until;movement=a.movement;resistance=a.resistance;}
    }
    private static final class Run {
        UUID id;AssessmentCatalog.Definition definition;AssessmentCatalog.Grade grade;
        String market="",state="active",reason="prepare_skill",castSkill="",lease="";
        long started,castAt,expires;int castLevel,rankRulesVersion;
        SkillTrajectory trajectory;
        JsonObject proofs=new JsonObject(),savedMeasurements=new JsonObject();
        final Map<UUID,Ally> allies=new LinkedHashMap<>();
        double combatSupport;int checkpoint;
    }
    SkillAssessments(AgentFriendPlugin plugin) {
        this.plugin=plugin;ledger=plugin.nativeRpgSelected()
            ?ProfessionLedger.academy(new File(plugin.getDataFolder(),"adventure-certificates.json").toPath(),plugin.professions().ledger)
            :plugin.professions().ledger;
        supplies=new ExamSupplies(plugin,this);
        for(String name:List.of("skill-assessments.yml","adventurer-grades.yml"))if(!new File(plugin.getDataFolder(),name).exists())plugin.saveResource(name,false);
        reload();validateLedger();
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin,CHANNEL);
        task=Bukkit.getScheduler().runTaskTimer(plugin,this::sample,5L,5L);
    }
    private boolean available() {return catalog!=null&&ledger.ready()&&validLedger;}
    boolean promotionsEnabled() {return catalog!=null&&catalog.promotions;}
    // ABI retained for callers compiled against the former independent point ledger.
    boolean rankPointLedgerReady() { return fameLedgerReady(); }
    private boolean fameLedgerReady() { return available() && promotionsEnabled(); }
    boolean legacyPointCreditAllowed(Player p) {
        JsonObject a=academy(p.getUniqueId());
        return !(a.has("progressionPolicy")&&a.get("progressionPolicy").getAsString().equals("fame_v1"))
                &&(!a.has("rankPointsStarted") || !a.get("rankPointsStarted").getAsBoolean());
    }
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
                if(a.has("rankPointsStarted")&&(!a.get("rankPointsStarted").isJsonPrimitive()||!a.getAsJsonPrimitive("rankPointsStarted").isBoolean()))
                    throw new IllegalArgumentException("rank points migration flag");
                if(a.has("certificates")&&(a.getAsJsonObject("certificates").size()>32||a.getAsJsonObject("certificates").keySet().stream().anyMatch(s->!s.matches("[a-z0-9_]{2,40}"))))throw new IllegalArgumentException("certificates");
                if(a.has("history")&&a.getAsJsonArray("history").size()>16)throw new IllegalArgumentException("history");
                if(a.has("active")) {
                    Run run=decode(a.getAsJsonObject("active"));
                    if(run.state.equals("active")&&!durableRecord(run)) {run.state="interrupted";run.reason="server_restart";}
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
    int readGrade(Player p) {
        int legacy=plugin.guild().readLegacyRank(p);
        if(!available()||!promotionsEnabled()||!plugin.guild().hasJoined(p)||plugin.isObserver(p))return legacy*3;
        JsonObject a=academy(p.getUniqueId());return a.has("grade")?a.get("grade").getAsInt():legacy*3;
    }
    String gradeName(Player p) {int g=readGrade(p);return RANKS[g/3]+" "+DIVISIONS[g%3];}
    private Run observed(Player p) {
        Run r=runs.get(p.getUniqueId());
        if(r!=null || !available()) return r;
        JsonObject a=academy(p.getUniqueId());
        if(!a.has("active")) return null;
        r=decode(a.getAsJsonObject("active"));
        if(r.state.equals("active")&&!durableRecord(r)){r.state="interrupted";r.reason="server_restart";}
        return r;
    }
    private boolean occupiesExamSlot(Run r) {return r!=null&&r.market.isEmpty()&&(Set.of("active","ready").contains(r.state)||canResume(r));}
    boolean busy(Player p) {return occupiesExamSlot(observed(p));}
    private static boolean durableSurvey(Run r) {
        return r.definition.primitive().equals("contract_record")&&r.definition.proofs().contains("survey");
    }
    private static boolean durableRecord(Run r) {
        return ExamLifecyclePolicy.durable(r.definition.primitive());
    }
    private static boolean shelter(AssessmentCatalog.Definition d) {
        return d.primitive().equals("contract_record")&&d.proofs().contains("shelter");
    }
    private static String description(AssessmentCatalog.Definition d) {
        return shelter(d)?"开始本场实操后本人建好小屋，七项现场验收通过后一次交卷；正常传送和重连保留进度，不需另接或交付建屋委托。":d.description();
    }
    boolean recordingShelter(Player p) {
        Run r=observed(p);
        return available()&&r!=null&&Set.of("active","ready").contains(r.state)&&shelter(r.definition)
                &&System.currentTimeMillis()<r.expires&&p.getGameMode()==GameMode.SURVIVAL
                &&!p.isDead()&&!plugin.isDowned(p)&&!plugin.isObserver(p);
    }
    private static Run copy(Run r) {
        if(r==null)return null;Run n=new Run();n.id=r.id;n.definition=r.definition;n.grade=r.grade;n.market=r.market;
        n.state=r.state;n.reason=r.reason;n.castSkill=r.castSkill;n.lease=r.lease;
        n.started=r.started;n.castAt=r.castAt;n.expires=r.expires;n.castLevel=r.castLevel;n.rankRulesVersion=r.rankRulesVersion;
        n.trajectory=r.trajectory==null?null:r.trajectory.copy();n.proofs=r.proofs.deepCopy();n.savedMeasurements=r.savedMeasurements.deepCopy();
        r.allies.forEach((id,a)->n.allies.put(id,new Ally(a)));n.combatSupport=r.combatSupport;n.checkpoint=r.checkpoint;return n;
    }
    boolean canAttachContract(Player p,String id) {
        Run r=runs.get(p.getUniqueId());return r!=null&&r.state.equals("active")&&r.definition.primitive().equals("contract_record")&&!shelter(r.definition)
                &&plugin.taskMarket().suppliesAssessmentProof(id,r.definition.proofs());
    }
    AssessmentCatalog.Definition definition(String id) {return catalog==null?null:catalog.definitions.get(id);}
    String photoExam(Player p) {Run r=runs.get(p.getUniqueId());return r!=null&&r.state.equals("active")&&r.definition.proofs().contains("survey_photo")?r.id.toString():"";}
    JsonObject mapClue(Player p,int mapId,UUID world,int x,int z) {return supplies.mapClue(p,mapId,world,x,z);}
    long photoStarted(Player p) {Run r=runs.get(p.getUniqueId());return r==null?Long.MAX_VALUE:r.started;}
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
    private String promotionGate(Player p,AssessmentCatalog.Grade g,boolean usesRankPoints) {
        if(!promotionsEnabled()||g==null)return "promotion_unavailable";
        int grade=readGrade(p);
        if(g.index()!=grade+1)return "grade_changed";
        // Frozen runs may carry rankRulesVersion=1; it is archival, not a second gate.
        if(!available())return "data_unavailable";
        if(!plugin.guild().hasJoined(p))return "guild_registration_required";
        if(p.getGameMode()!=GameMode.SURVIVAL||p.isDead()||plugin.isDowned(p)||plugin.isObserver(p))return "survival_required";
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
        if(busy(p)||(shelter(d)?plugin.guild().hasAdventureContract(p):plugin.guild().hasActiveContract(p))) {reply(p,"task_slot_busy",d);return;}
        int grade=readGrade(p);
        AssessmentCatalog.Grade g=promotion&&grade<17?catalog.grades.get(grade+1):null;
        if(promotion) {
            deny=promotionGate(p,g,true);
            if(!deny.equals("ready")||!g.fresh().contains(id)){reply(p,deny.equals("ready")?"choose_promotion_topic":deny,d);return;}
        }
        Run r=newRun(d,"");r.grade=g;
        if(!save(p,r)){reply(p,"data_unavailable",d);return;}
        runs.put(p.getUniqueId(),copy(r));
        supplies.automaticPhoto(p,d,r.id,result->supplyReply(p,result,plugin.communication().compact(p)));
        if(d.primitive().equals("native_lesson")&&!d.proofs().contains("native_cast")) {plugin.featureTutorials().enroll(p);plugin.traversalPractice().command(p,"start");reuseTraining(p,r);}
        show(p);if(!plugin.communication().compact(p))p.sendMessage("§a考试已开始："+d.title()+"。"+description(d)+"；公会→训练与考试→当前考试指引，按步骤操作。");
    }
    private Run newRun(AssessmentCatalog.Definition d,String market) {
        Run r=new Run();r.id=UUID.randomUUID();r.definition=d;r.market=market;r.started=System.currentTimeMillis();
        // Housing starts a real actor/time measurement window, never a second contract.
        if(d.primitive().equals("contract_record"))r.reason=shelter(d)?"awaiting_structure":"awaiting_contract";
        r.expires=r.started+d.timeout()*1000L;if(d.course()!=null)r.trajectory=new SkillTrajectory(d);return r;
    }
    /** Called before observations as well as on the 5-tick sampler. Market step token owns the run. */
    private Run current(Player p) {
        if(!available())return null;
        Run r=copy(runs.get(p.getUniqueId()));
        if(r==null&&available()&&academy(p.getUniqueId()).has("active")) {
            try {r=decode(academy(p.getUniqueId()).getAsJsonObject("active"));if(r.state.equals("active")&&!durableRecord(r)){r.state="interrupted";r.reason="server_restart";}runs.put(p.getUniqueId(),copy(r));}
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
            r=newRun(d,token);if(!save(p,r))return null;runs.put(p.getUniqueId(),copy(r));
            p.sendMessage("§b能力阶段已开始："+d.title()+"；/mycli guild exam status 查看当前目标。技能须在本阶段开始后施放。");
            if(d.primitive().equals("native_lesson")&&!d.proofs().contains("native_cast")){plugin.featureTutorials().enroll(p);plugin.traversalPractice().command(p,"start");reuseTraining(p,r);}
        }
        return r;
    }
    private boolean canResume(Run r) {
        return ExamLifecyclePolicy.resumable(r.definition.primitive(),r.state,r.reason,r.expires,System.currentTimeMillis())
                &&definition(r.definition.id())!=null&&definition(r.definition.id()).enabled();
    }
    private void resume(Player p) {
        Run r=current(p);if(r==null||!canResume(r)){reply(p,"resume_unavailable",r==null?null:r.definition);return;}
        if(p.getGameMode()!=GameMode.SURVIVAL||p.isDead()||plugin.isObserver(p)||plugin.isDowned(p)){reply(p,"survival_required",r.definition);return;}
        if(!durableRecord(r)) {
            if(plugin.pvpParticipant(p)||plugin.dungeonParticipant(p)||r.trajectory==null
                    ||!p.getWorld().getUID().equals(r.definition.course().world())||!r.trajectory.resumeAt(point(p),safeGround(p))) {
                reply(p,"resume_at_verified_checkpoint_or_start",r.definition);return;
            }
            r.trajectory.suspend();r.castAt=0;r.castSkill="";r.castLevel=0;r.lease="";r.allies.clear();
        }
        r.state="active";r.reason=shelter(r.definition)?"awaiting_structure":durableRecord(r)?"resumed":"prepare_skill";
        if(!save(p,r)){reply(p,"data_unavailable",r.definition);return;}
        p.sendMessage("§a本场考试已显式恢复；原run、证明和截止时间保持。连续动作须重新施放，技能魔力与冷却照常。");show(p);
    }
    void cast(Player p,String id) {
        Run r=current(p);if(r==null||!r.state.equals("active")||System.currentTimeMillis()>=r.expires||!r.definition.skills().contains(id))return;
        if(r.definition.primitive().equals("flight_route")) {
            FlightLeases.Lease lease=plugin.flightLeases().active(p);
            if(lease==null||!lease.skill().equals(id)||lease.started()<r.started)return;
            if(!r.lease.isEmpty()){interrupt(p,r,"flight_recast");return;}
            if(r.trajectory==null||!r.trajectory.resumeAt(point(p),safeGround(p))){interrupt(p,r,"go_to_start");return;}
            r.lease=lease.token().toString();r.castSkill=id;r.castLevel=lease.level();r.castAt=lease.started();
            r.reason="sampling";save(p,r);
        }else if(r.definition.primitive().equals("leap_route")) {
            if(r.trajectory==null||!r.trajectory.resumeAt(point(p),safeGround(p))){interrupt(p,r,"go_to_start");return;}
            if(r.castAt>0&&!safeGround(p)){interrupt(p,r,"unsafe_path");return;}
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
        int originalProofCount=r.proofs.size();
        for(String proof:r.definition.proofs()) {
            if(r.proofs.has(proof))continue;
            boolean done=proof.equals("door_passage")||proof.equals("ladder_ascent")?plugin.traversalPractice().verified(p,proof):plugin.featureTutorials().verified(p,proof);
            if(done)r.proofs.addProperty(proof,"retained_server_training");
        }
        checkProofs(p,r);
        if(r.state.equals("active")&&r.proofs.size()>originalProofCount)save(p,r);
    }
    void proof(Player p,String id,String evidence) {
        Run r=current(p);if(r==null||!r.state.equals("active")||System.currentTimeMillis()>=r.expires
                ||id.equals("shelter")||!r.definition.proofs().contains(id)||evidence==null||evidence.length()>200)return;
        r.proofs.addProperty(id,evidence);checkProofs(p,r);if(r.state.equals("active"))save(p,r);
    }
    void siteCompleted(Player p,String site,String run,long startedAt) {
        Run r=current(p);
        // Claims may arrive after a different exam starts. Only the fresh,
        // fully witnessed completion event is valid examination evidence.
        if(r==null||!r.state.equals("active")||!r.definition.primitive().equals("contract_record")
                ||startedAt<=0||startedAt<r.started||System.currentTimeMillis()>r.expires)return;
        proof(p,"native_clear","site:"+site+":"+run);
    }
    private void checkProofs(Player p,Run r) {
        if(r.definition.proofs().isEmpty())return;
        boolean ready=r.definition.allProofs()?r.definition.proofs().stream().allMatch(r.proofs::has):r.definition.proofs().stream().anyMatch(r.proofs::has);
        if(ready)ready(p,r);
    }
    void supportEvidence(Player caster,Player target,double amount,String kind) {
        Run r=copy(runs.get(caster.getUniqueId()));if(r==null||!r.state.equals("active")||!r.allies.containsKey(target.getUniqueId())||!Double.isFinite(amount)||amount<=0)return;
        Ally ally=r.allies.get(target.getUniqueId());if(System.currentTimeMillis()>ally.until||!target.getWorld().getUID().equals(ally.world))return;
        boolean first=r.combatSupport==0;r.combatSupport=Math.min(1000,r.combatSupport+amount);r.proofs.addProperty("combat_support",kind);if(first)save(caster,r);else runs.put(caster.getUniqueId(),copy(r));
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
        sampleWrites=new LinkedHashMap<>();sampleCandidates=new LinkedHashMap<>();sampleNotices=new ArrayList<>();
        try {
        for(Player p:Bukkit.getOnlinePlayers()) {
            Run r=current(p);if(r==null||!(r.state.equals("active")||r.state.equals("ready")&&shelter(r.definition)))continue;
            AssessmentCatalog.Definition live=definition(r.definition.id());
            if(live==null||!live.enabled()){interrupt(p,r,"course_disabled");continue;}
            if(p.getGameMode()!=GameMode.SURVIVAL||p.isDead()||plugin.isDowned(p)||plugin.dungeonParticipant(p)&&!r.definition.primitive().equals("contract_record")||plugin.pvpParticipant(p)
                    ||p.isInsideVehicle()||p.isGliding()||p.hasPotionEffect(PotionEffectType.LEVITATION)){
                if(!durableRecord(r))interrupt(p,r,"activity_changed");
                continue;
            }
            if(System.currentTimeMillis()>r.expires){interrupt(p,r,"timeout");continue;}
            if(r.definition.course()!=null&&!p.getWorld().getUID().equals(r.definition.course().world())){if(!durableRecord(r))interrupt(p,r,"world_changed");continue;}
            if(shelter(r.definition)&&tick%4==0)observeHouse(p,r);
            if(r.trajectory!=null&&r.castAt>0)sampleTrajectory(p,r);
            if(r.definition.primitive().equals("support_route")&&r.castAt>0)sampleSupport(p,r);
            sampleCandidates.put(p.getUniqueId(),copy(r));
            if(tick%4==0&&r.state.equals("active"))waypoint(p,r);
        }
        } finally {flushSamples();}
        lastSampleMs=(System.nanoTime()-began)/1e6;maxSampleMs=Math.max(maxSampleMs,lastSampleMs);
    }
    private void afterSave(Runnable notice) {if(sampleNotices==null)notice.run();else sampleNotices.add(notice);}
    private void flushSamples() {
        Map<UUID,JsonObject> writes=sampleWrites;Map<UUID,Run> candidates=sampleCandidates;List<Runnable> notices=sampleNotices;
        sampleWrites=null;sampleCandidates=null;sampleNotices=null;
        if(writes.isEmpty()){candidates.forEach((id,r)->runs.put(id,copy(r)));return;}
        // One forced atomic ledger replacement for this entire native sampling boundary.
        // Success messages and market completion wait until every included record is durable.
        if(!ledger.write(root->writes.forEach((id,data)->writeRecord(root,id,data)))) {
            validLedger=false;
            for(UUID id:writes.keySet()) {
                // Keep the pre-boundary run, not a half-ready candidate.
                Player p=Bukkit.getPlayer(id);if(p!=null)p.sendMessage("§c考试进度保存失败，验收已停用；请联系服主检查存储，旧证书和声望保留。");
            }
            plugin.getLogger().severe("Assessment batch could not be saved; examination writes disabled until storage is repaired and the server restarts.");
            return;
        }
        candidates.forEach((id,r)->runs.put(id,copy(r)));
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
        if(Set.of("outside_course","impossible_displacement","sampling_gap").contains(result)){interrupt(p,r,result);return;}
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
        AssessmentCatalog.Point target=target(r);if(target==null||!p.getWorld().getUID().equals(r.definition.course().world())){plugin.targetGuides().remove(p.getUniqueId(),"assessment");return;}
        Location at=new Location(p.getWorld(),target.x(),target.y()+.1,target.z());
        if(p.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)&&p.getLocation().distanceSquared(at)<64*64)
            plugin.targetGuides().show(p,"assessment",at);
        else plugin.targetGuides().remove(p.getUniqueId(),"assessment");
    }
    private StarterHouseValidator.Result inspectHouse(Player p,Run r) {
        if(!HouseEvidence.available(plugin))return new StarterHouseValidator.Result(false,false,false,false,false,false,false,0,0,0,"housing_storage_unavailable");
        return StarterHouseInspection.inspect(p,HouseEvidence.placementsSince(plugin,p,r.started));
    }
    private void houseEvidence(Player p,Run r,StarterHouseValidator.Result result) {
        JsonObject evidence=StarterHouseInspection.json(result);
        evidence.addProperty("actorUuid",p.getUniqueId().toString());evidence.addProperty("runId",r.id.toString());
        evidence.addProperty("startedAt",r.started);evidence.addProperty("observedAt",System.currentTimeMillis());
        r.proofs.add("shelter",evidence);r.savedMeasurements.add("houseChecks",evidence.deepCopy());
    }
    private boolean proofsReady(Run r) {
        return !r.definition.proofs().isEmpty()&&(r.definition.allProofs()?r.definition.proofs().stream().allMatch(r.proofs::has):r.definition.proofs().stream().anyMatch(r.proofs::has));
    }
    private void observeHouse(Player p,Run r) {
        StarterHouseValidator.Result result=inspectHouse(p,r);
        if(result.ready()) {
            if(r.state.equals("active")){houseEvidence(p,r,result);if(proofsReady(r))ready(p,r);else save(p,r);}
        }
        // Travel or unloaded chunks do not erase a witnessed structure. Status and submit
        // recheck current geometry; no certificate can be issued from the retained attestation alone.
    }
    private void ready(Player p,Run r) {
        if(!r.state.equals("active"))return;r.state="ready";r.reason="ready";
        if(!save(p,r)){r.state="active";r.reason="data_unavailable";return;}
        afterSave(()->announceReady(p,r));
    }
    private void announceReady(Player p,Run r) {
        plugin.communication().taskTransition(p,"assessment",r.id.toString(),"ready",r.market.isEmpty()?"/mycli guild exam submit":"/mycli guild claim");
        if(!r.market.isEmpty())plugin.taskMarket().worldAction(p,GuildManager.Goal.SKILL_ASSESSMENT,r.definition.id(),"assessment:"+r.id,System.currentTimeMillis());
        p.sendMessage("§a实操达成："+r.definition.title()+"；"+(r.market.isEmpty()?"/mycli guild exam submit 交付证书或晋级":"/mycli guild claim 交付本阶段")+"，不会自动发物品或技能点。");show(p);
    }
    private void interrupt(Player p,Run r,String reason) {
        if(!r.state.equals("active")&&!(r.state.equals("ready")&&shelter(r.definition)))return;
        Run n=copy(r);n.state="interrupted";n.reason=reason;
        if(n.trajectory!=null){n.trajectory.suspend();n.checkpoint=n.trajectory.checkpoint();n.castAt=0;n.castSkill="";n.castLevel=0;n.lease="";}
        if(!save(p,n))return;
        r.state=n.state;r.reason=n.reason;r.trajectory=n.trajectory;r.checkpoint=n.checkpoint;r.castAt=n.castAt;r.castSkill=n.castSkill;r.castLevel=n.castLevel;r.lease=n.lease;
        afterSave(()->p.sendMessage("§e考试中断："+reason+"。"+next(n)+" 已花的技能魔力与冷却照常，声望和旧证书保持。"));
    }
    void qualificationChanged(Player p) {
        Run r=runs.get(p.getUniqueId());if(r!=null&&r.state.equals("active")&&r.castAt>0)interrupt(p,r,"skill_qualification_changed");
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void teleport(PlayerTeleportEvent e) {
        // Server-event exams allow ordinary travel; continuous movement exams do not.
        Run r=runs.get(e.getPlayer().getUniqueId());if(r!=null&&!durableRecord(r))interrupt(e.getPlayer(),r,"teleport");
        for(var entry:List.copyOf(runs.entrySet()))if(entry.getValue().allies.containsKey(e.getPlayer().getUniqueId())) {
            Run n=copy(entry.getValue());n.allies.remove(e.getPlayer().getUniqueId());
            Player caster=Bukkit.getPlayer(entry.getKey());if(caster!=null)save(caster,n);
        }
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void mode(PlayerGameModeChangeEvent e) {qualificationChanged(e.getPlayer());}
    @EventHandler(priority=EventPriority.MONITOR) public void death(PlayerDeathEvent e) {qualificationChanged(e.getEntity());}
    @EventHandler(priority=EventPriority.MONITOR) public void quit(PlayerQuitEvent e) {
        Run r=runs.get(e.getPlayer().getUniqueId());if(r!=null&&!durableRecord(r))interrupt(e.getPlayer(),r,"logout");runs.remove(e.getPlayer().getUniqueId());
        menus.entrySet().removeIf(x->x.getValue().owner.equals(e.getPlayer().getUniqueId()));
        for(var entry:runs.entrySet())entry.getValue().allies.remove(e.getPlayer().getUniqueId());
    }
    boolean submitMarket(Player p) {
        Run r=current(p);if(r==null||r.market.isEmpty())return false;return submit(p,r);
    }
    private boolean submit(Player p,Run r) {
        if(!available()){reply(p,"data_unavailable",r.definition);return false;}
        if(r.state.equals("submitted")){p.sendMessage("§e本次考试已交付；/mycli guild certificates 查看证书，不会重复发放。");show(p);return true;}
        if(System.currentTimeMillis()>=r.expires){interrupt(p,r,"timeout");reply(p,"timeout",r.definition);return false;}
        String storedState=r.state;
        Run candidate=copy(r);
        if(shelter(r.definition)&&Set.of("active","ready").contains(r.state)) {
            StarterHouseValidator.Result result=inspectHouse(p,r);
            if(!result.ready()){reply(p,"practice_incomplete",r.definition);show(p);return false;}
            houseEvidence(p,candidate,result);
            if(proofsReady(candidate)){candidate.state="ready";candidate.reason="ready";}
        }
        if(!candidate.state.equals("ready")){reply(p,"practice_incomplete",r.definition);show(p);return false;}
        if(p.getGameMode()!=GameMode.SURVIVAL||p.isDead()||plugin.isObserver(p)||plugin.isDowned(p)){reply(p,"survival_required",r.definition);return false;}
        if(!plugin.guild().hasJoined(p)){reply(p,"guild_registration_required",r.definition);return false;}
        int fromGrade=readGrade(p);
        if(r.grade!=null) {String gate=promotionGate(p,r.grade,r.rankRulesVersion==1);if(!gate.equals("ready")){reply(p,gate,r.definition);return false;}}
        JsonObject active=record(candidate);active.addProperty("state","submitted");active.addProperty("reason","submitted");active.addProperty("submittedAt",System.currentTimeMillis());
        JsonObject proof=active.deepCopy();proof.remove("definition");proof.addProperty("assessmentId",r.definition.id());proof.addProperty("version",r.definition.version());
        UUID id=p.getUniqueId();
        if(!ledger.write(data->{JsonObject a=academy(data,id);
            if(!a.has("active")||!a.getAsJsonObject("active").get("runId").getAsString().equals(r.id.toString())
                    ||!a.getAsJsonObject("active").get("state").getAsString().equals(storedState)
                    ||a.getAsJsonObject("active").get("startedAt").getAsLong()!=r.started
                    ||System.currentTimeMillis()>=r.expires)throw new IllegalStateException("run changed");
            if(!a.has("certificates"))a.add("certificates",new JsonObject());
            if(a.getAsJsonObject("certificates").size()>=32&&!a.getAsJsonObject("certificates").has(r.definition.id()))throw new IllegalStateException("certificate capacity");
            a.getAsJsonObject("certificates").add(r.definition.id(),proof.deepCopy());
            if(r.grade!=null)advanceGrade(a,fromGrade,r.grade.index());
            a.add("active",active);history(a,proof);
        })) {reply(p,"data_unavailable",r.definition);return false;}
        candidate.state="submitted";candidate.reason="submitted";runs.put(id,copy(candidate));
        plugin.communication().taskTransition(p,"assessment",r.id.toString(),"complete","/mycli guild exam promotion");
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
        if(sampleWrites!=null){sampleWrites.put(p.getUniqueId(),data);sampleCandidates.put(p.getUniqueId(),copy(r));return true;}
        if(!ledger.write(root->writeRecord(root,p.getUniqueId(),data)))return false;
        runs.put(p.getUniqueId(),copy(r));return true;
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
        if(r.grade!=null){o.add("promotion",AssessmentCatalog.JSON.toJsonTree(r.grade));if(r.rankRulesVersion!=0)o.addProperty("rankRulesVersion",r.rankRulesVersion);}return o;
    }
    private Run decode(JsonObject o) {
        if(o.toString().length()>24000)throw new IllegalArgumentException("run size");Run r=new Run();r.id=UUID.fromString(o.get("runId").getAsString());
        r.definition=AssessmentCatalog.frozen(o.get("definition").getAsString());r.market=o.get("marketToken").getAsString();r.state=o.get("state").getAsString();
        if(!Set.of("active","ready","interrupted","submitted","cancelled").contains(r.state)||r.market.length()>80)throw new IllegalArgumentException("run state/token");
        r.reason=o.get("reason").getAsString();r.started=o.get("startedAt").getAsLong();r.expires=o.get("expiresAt").getAsLong();r.castAt=o.get("castAt").getAsLong();
        r.castSkill=o.get("castSkill").getAsString();r.castLevel=o.get("castLevel").getAsInt();r.lease=o.get("flightLease").getAsString();
        r.proofs=o.getAsJsonObject("proofs").deepCopy();r.savedMeasurements=o.getAsJsonObject("measurements").deepCopy();
        r.combatSupport=r.savedMeasurements.has("combatSupport")?r.savedMeasurements.get("combatSupport").getAsDouble():0;
        if(r.definition.course()!=null){
            r.checkpoint=r.savedMeasurements.has("checkpoints")?r.savedMeasurements.get("checkpoints").getAsInt():0;
            if(Set.of("active","interrupted").contains(r.state)){r.trajectory=SkillTrajectory.restore(r.definition,r.savedMeasurements);r.checkpoint=r.trajectory.checkpoint();}
        }
        if(o.has("promotion")){r.grade=AssessmentCatalog.JSON.fromJson(o.get("promotion"),AssessmentCatalog.Grade.class);
            if(o.has("rankRulesVersion")){r.rankRulesVersion=o.get("rankRulesVersion").getAsInt();if(r.rankRulesVersion!=1)throw new IllegalArgumentException("promotion rules");}
            if(r.grade.index()<1||r.grade.index()>17||r.grade.prerequisites().size()>8||r.grade.fresh().size()>12||!r.grade.fresh().contains(r.definition.id()))throw new IllegalArgumentException("promotion record");}
        return r;
    }
    private JsonObject measurements(Run r) {
        JsonObject o=r.trajectory!=null?r.trajectory.measurements():r.savedMeasurements.deepCopy();
        if(!r.allies.isEmpty()){JsonArray a=new JsonArray();for(Ally ally:r.allies.values()){JsonObject entry=new JsonObject();entry.addProperty("uuid",ally.id.toString());entry.addProperty("distance",Math.round(ally.movement*100)/100.0);a.add(entry);}o.add("beneficiaries",a);}
        o.addProperty("combatSupport",r.combatSupport);return o;
    }
    private JsonObject standing(Player p) {
        int grade = readGrade(p);
        JsonObject out = new JsonObject();
        out.addProperty("available", available());
        int fame=plugin.guild().reputation(p),target=catalog!=null&&grade<17?catalog.grades.get(grade+1).fame():fame;
        out.addProperty("fame",fame);out.addProperty("fameTarget",target);out.addProperty("fameRemaining",Math.max(0,target-fame));
        out.addProperty("gradeIndex", grade);
        out.addProperty("division", 3-grade%3);
        out.addProperty("gradeName", RANKS[grade/3]+" "+DIVISIONS[grade%3]);
        JsonObject academy = academy(p.getUniqueId());
        out.addProperty("certificateCount", academy.has("certificates") ? academy.getAsJsonObject("certificates").size() : 0);
        return out;
    }

    JsonObject summary(Player p) {
        JsonObject out=standing(p);Run r=observed(p);
        if(r!=null){out.addProperty("examId",r.definition.id());out.addProperty("runId",r.id.toString());out.addProperty("state",r.state);out.addProperty("reason",r.reason);out.addProperty("nextAction",next(r));
            out.addProperty("startedAt",r.started);out.addProperty("expiresAt",r.expires);
            out.addProperty("nextCommand",safeNextCommand(r));
            if(shelter(r.definition))merge(out,resultSnapshot(p,r));
            out.addProperty("purpose",r.grade==null?"certificate":"promotion");
            if (r.state.equals("submitted") && promotionsEnabled() && readGrade(p) < 17) {
                out.addProperty("nextAction", r.grade == null ? "证书已入档。查看下一段晋级所缺的委托和考题。" : "本场晋级已入档。查看下一段条件。");
                out.addProperty("nextCommand", "/mycli guild exam promotion");
            }
            if(durableSurvey(r)&&r.state.equals("active")) {
                JsonObject contract=plugin.taskMarket().progressState(p);
                if(contract.has("guidance")){JsonObject g=contract.getAsJsonObject("guidance");out.addProperty("reason",g.get("phase").getAsString());out.addProperty("phase",g.get("phase").getAsString());out.addProperty("summary",g.get("summary").getAsString());out.addProperty("nextAction",g.get("nextAction").getAsString());out.addProperty("nextCommand",g.get("nextCommand").getAsString());}
                else {out.addProperty("reason","awaiting_contract");out.addProperty("phase","choose_contract");out.addProperty("nextAction","选择当前可接的调查委托，先从入门走查开始；普通走查不需要藏宝图。");out.addProperty("nextCommand","/mycli guild exam status");}
            }
        }
        return out;
    }
    private static void merge(JsonObject out,JsonObject fields) {fields.entrySet().forEach(e->out.add(e.getKey(),e.getValue().deepCopy()));}
    /** Read-only live result for status/info/guide/journal; never creates a run or a proof. */
    JsonObject resultSnapshot(Player p) {
        Run r=observed(p);return r==null?new JsonObject():resultSnapshot(p,r);
    }
    private JsonObject resultSnapshot(Player p,Run r) {
        JsonObject out=new JsonObject();
        if(!shelter(r.definition))return out;
        if(r.state.equals("submitted")) {
            JsonElement stored=r.proofs.get("shelter");
            if(stored!=null&&stored.isJsonObject()) {
                JsonObject evidence=stored.getAsJsonObject();out.add("result",evidence.deepCopy());
                if(evidence.has("checks"))out.add("houseChecks",evidence.get("checks").deepCopy());
            }
            out.addProperty("available",available());out.addProperty("reason","submitted");out.addProperty("phase","complete");
            out.addProperty("summary","本场证书已入档，不要求返回旧房屋");out.addProperty("nextAction","查看原证书或下一段晋级条件，不重复交卷");
            out.addProperty("nextCommand","/mycli guild certificates");out.add("missingProofs",new JsonArray());return out;
        }
        StarterHouseValidator.Result result=inspectHouse(p,r);JsonObject house=StarterHouseInspection.json(result);
        out.add("result",house.deepCopy());out.add("houseChecks",house.get("checks").deepCopy());out.add("missingProofs",house.get("missingProofs").deepCopy());
        out.addProperty("available",available()&&house.get("available").getAsBoolean());out.addProperty("houseReason",result.reason());
        boolean live=Set.of("active","ready").contains(r.state),expired=System.currentTimeMillis()>=r.expires;
        String reason=!available()||result.reason().equals("housing_storage_unavailable")?"data_unavailable":!live?r.reason:expired?"timeout":!house.get("available").getAsBoolean()?"waiting_structure":result.ready()?"ready":"awaiting_structure";
        String command=!live||expired?safeNextCommand(r):result.ready()?"/mycli guild exam submit":"/mycli guild exam status";
        out.addProperty("reason",reason);out.addProperty("phase",live&&!expired?(result.ready()?"submit_exam":"awaiting_structure"):r.state);
        out.addProperty("canSubmit",live&&!expired&&result.ready());out.addProperty("persistedState",r.state);
        out.addProperty("proofRetained",r.proofs.has("shelter"));
        if(live&&!result.ready())out.addProperty("state","active");
        out.addProperty("summary",result.ready()?"房屋七项现场通过":"房屋现场仍有缺项或未知");
        out.addProperty("nextAction",!live||expired?next(r):StarterHouseInspection.examHint(result));out.addProperty("nextCommand",command);
        return out;
    }
    private String safeNextCommand(Run r) {
        if(r.state.equals("submitted"))return "/mycli guild certificates";
        if(canResume(r))return "/mycli guild exam resume";
        if(System.currentTimeMillis()>=r.expires||Set.of("cancelled","interrupted").contains(r.state))
            return r.market.isEmpty()?"/mycli guild exam start "+(r.grade!=null?"promotion ":"")+r.definition.id():"/mycli guild exam retry";
        if(r.state.equals("ready"))return r.market.isEmpty()?"/mycli guild exam submit":"/mycli guild claim";
        return "/mycli guild exam status";
    }
    private String next(Run r) {
        if(r.state.equals("submitted"))return "/mycli guild certificates";
        if(r.state.equals("ready")&&System.currentTimeMillis()<r.expires)return r.market.isEmpty()?"/mycli guild exam submit":"/mycli guild claim";
        if(canResume(r))return "/mycli guild exam resume；保留本场证明与原截止，连续动作须回合法起点或已验证航点重新施放";
        if(System.currentTimeMillis()>=r.expires&&!r.state.equals("submitted"))return "/mycli guild exam start "+(r.grade!=null?"promotion ":"")+r.definition.id()+"；原场已到期，历史保留";
        if(Set.of("interrupted","cancelled").contains(r.state))return r.market.isEmpty()?"落地后 /mycli guild exam start "+(r.grade!=null?"promotion ":"")+r.definition.id():"/mycli guild exam retry；从本阶段重新实操";
        if(r.definition.primitive().equals("contract_record")&&r.definition.proofs().contains("native_clear"))return "开考后新开一场遗迹，逐室实际参战并完成通关；无需返回首室，每日奖励上限不影响考试。传送和重连保留本场考试；/mycli guild exam status 查进度，ready 后 guild exam submit。";
        if(shelter(r.definition))return "开考后本人建设小屋，地面、墙、屋顶、外窗、通行门、床及本人施工七项现场通过后 /mycli guild exam submit 一次交卷；无需另接建屋委托或guild claim。";
        if(r.castAt==0&&!r.definition.skills().isEmpty())return "/mycli skills info "+r.definition.skills().getFirst()+"；主动学习、准备并施放后实际移动";
        if(r.definition.primitive().equals("flight_route"))return "依次经过航点；保持空中水平移动、转向、升降，面朝前方后退，再到降落台稳定停留2秒";
        return description(r.definition);
    }
    boolean canSupply(Player p,UUID run) {
        Run r=current(p);return r!=null&&r.id.equals(run)&&r.state.equals("active")&&System.currentTimeMillis()<r.expires
                &&p.isOnline()&&!p.isDead()&&!plugin.isObserver(p)&&p.getGameMode()==GameMode.SURVIVAL;
    }
    String supplyRun(Player p){Run r=runs.get(p.getUniqueId());return r==null?"":r.id.toString();}
    private void supplyReply(Player p,JsonObject out,boolean machine) {
        if(!p.isOnline())return;
        if(!machine) {
            String reason=out.has("reason")?out.get("reason").getAsString():"";
            p.sendMessage("§b考试备料："+(reason.equals("allocated_to_personal_storage")?"已发到你的个人箱。":reason.equals("taken_into_inventory")?"已免费取到主背包。":reason.equals("already_issued")?"已经发过，保留原份。":reason.equals("checking_existing_natural_structure")?"正在核验原有遗迹，稍后给出结果。":"请按清单查看材料和领取条件。"));
            if(out.has("nextCommand"))p.sendMessage("§a下一步："+out.get("nextCommand").getAsString());
            if(out.has("advice"))p.sendMessage("§7"+out.get("advice").getAsString());
        }
        send(p,"MC_GUILD_EXAM",out);
    }
    private void suppliesCommand(Player p,String[] args,boolean machine) {
        String action=args.length>3?args[3].toLowerCase(Locale.ROOT):"status";
        boolean item=Set.of("claim","info","take").contains(action);
        if(!Set.of("list","status","info","claim","take").contains(action)||args.length>(item?5:4)||item&&(args.length!=5||!(action.equals("take")?Set.of("photo","map","all"):Set.of("photo","map")).contains(args[4]))) {
            JsonObject error=new JsonObject();error.addProperty("type","supplies");error.addProperty("ok",false);error.addProperty("reason","invalid_arguments");
            error.addProperty("nextCommand","/mycli guild exam supplies --help");supplyReply(p,error,machine);return;
        }
        Run r=Set.of("claim","take").contains(action)?current(p):observed(p);AssessmentCatalog.Definition d=r==null?null:r.definition;
        if(Set.of("claim","take").contains(action)) {
            if(r==null){JsonObject error=new JsonObject();error.addProperty("type","supplies");error.addProperty("ok",false);error.addProperty("reason","active_exam_required");error.addProperty("nextCommand","/mycli guild exam status");supplyReply(p,error,machine);return;}
            if(action.equals("take"))supplies.take(p,d,r.id,args[4],out->supplyReply(p,out,machine));else supplies.claim(p,d,r.id,args[4],out->supplyReply(p,out,machine));return;
        }
        JsonObject out=item?supplies.status(p,d,args[4]):supplies.all(p,d);out.addProperty("type","supplies");out.addProperty("action",action);out.addProperty("readOnly",true);
        supplyReply(p,out,machine);
        if(!machine&&out.has("items"))for(var entry:out.getAsJsonArray("items")) {
            var row=entry.getAsJsonObject();p.sendMessage("§e"+row.get("name").getAsString()+" · "+row.get("status").getAsString()+"；"+row.get("advice").getAsString());
        }
    }
    private JsonObject guide(Player p,Run r) {
        JsonObject out=new JsonObject();JsonArray steps=new JsonArray();
        out.addProperty("title",r.definition.title());out.addProperty("currentCommand","/mycli guild exam status");
        if(shelter(r.definition)) {
            JsonObject snapshot=resultSnapshot(p,r);merge(out,snapshot);out.add("current",snapshot.deepCopy());
            guideStep(steps,"start","开启本人实操窗口","开考仅记录本人的开始时间；不生成或要求第二张建屋委托。","/mycli guild exam status");
            guideStep(steps,"build","本人现场建设",snapshot.get("nextAction").getAsString(),snapshot.get("nextCommand").getAsString());
            guideStep(steps,"submit","一次现场交卷","/mycli guild exam submit 当次复验七项并原子保存证明及证书；旧ready不能替代现存房屋。","/mycli guild exam submit");
        } else if(r.definition.proofs().contains("survey")) {
            String active=plugin.guild().hasActiveContract(p)?plugin.guild().activeId(p):"";
            guideStep(steps,"prepare","核对考试路线","摄影无需空地图或主背包空位，成片自动入个人奖励箱。普通走查不用藏宝图；选择原图寻宝路线时，可领取真正的遗迹探险图。","/mycli guild exam supplies list");
            guideStep(steps,"contract","选择有效委托",active.isEmpty()?"按contractOptions中available的准确ID接单，推荐入门走查；不必先找到神庙。寻宝则主手拿带目标的图，guild map确认，再接tm_map_hunt。":"你正在做 "+active+"；保留这张委托，按下方currentContract的冻结条件继续，不用重接。",active.isEmpty()?"/mycli guild exam status":"/mycli guild status");
            guideStep(steps,"survey","实地调查","亲自走过不同地点，满足区域数、行进距离、有效行进时间；有建筑/群系/高差要求时也必须满足。重复绕圈、站着等待和传送不计路线。","/mycli guild verify");
            if(r.definition.proofs().contains("survey_photo"))guideStep(steps,"photograph","在目标现场拍照","每个探索阶段至少1张合格照片；要求多种群系时每种各1张。对准景物，photo menu或photo take 唯一名字 first 1；photo album核查，旧照片不能代本场。","/mycli photo menu");
            guideStep(steps,"return","按本单返程交付","原图寻宝要回接单点16格内；其他委托只按本单要求返程。guild verify查缺项，齐全后guild claim逐阶段交付。","/mycli guild verify");
            guideStep(steps,"submit","取得证书或晋级","完成整张委托及照片后，考试state=ready才exam submit；purpose=promotion才是本次晋级，单拿证书不自动升段。","/mycli guild exam submit");
            JsonObject contract=plugin.taskMarket().examRequirements(p);if(contract!=null){out.add("currentContract",contract);if(contract.has("guidance")){out.add("current",contract.get("guidance"));out.addProperty("nextCommand",contract.getAsJsonObject("guidance").get("nextCommand").getAsString());}}
            if(!out.has("current")){JsonObject current=new JsonObject();current.addProperty("phase",r.state.equals("ready")?"submit_exam":"choose_contract");current.addProperty("summary",r.state.equals("ready")?"实操证明已齐，交付考试":"选择一张可接的调查委托");current.addProperty("nextAction",r.state.equals("ready")?"提交本场考试，取得证书或晋级。":"优先选择入门走查；普通走查无需藏宝图，地下墓穴适合作为进阶路线。");current.addProperty("nextCommand",r.state.equals("ready")?"/mycli guild exam submit":"/mycli guild exam status");out.add("current",current);}
            out.add("supplies",supplies.all(p,r.definition));
        } else {
            guideStep(steps,"prepare","查看准备条件",r.definition.primitive().equals("contract_record")&&r.definition.proofs().contains("native_clear")?next(r):description(r.definition),"/mycli guild exam info "+r.definition.id());
            if(!r.definition.skills().isEmpty())guideStep(steps,"skill","准备并施放技能","本人学习、准备并施放："+String.join("、",r.definition.skills())+"；只收技能原有魔力与冷却，不自动花技能点。","/mycli skills info "+r.definition.skills().getFirst());
            guideStep(steps,"practice","完成现场实操",next(r),"/mycli guild exam status");
            guideStep(steps,"submit","核验交付","state=ready后交付；中断或缺项看reason和nextCommand，不连续盲目重试。",r.market.isEmpty()?"/mycli guild exam submit":"/mycli guild claim");
        }
        out.add("steps",steps);return out;
    }
    private static void guideStep(JsonArray steps,String id,String title,String instruction,String command) {
        JsonObject row=new JsonObject();row.addProperty("order",steps.size()+1);row.addProperty("id",id);row.addProperty("title",title);row.addProperty("instruction",instruction);row.addProperty("command",command);steps.add(row);
    }
    private void contractGuidance(Player p, AssessmentCatalog.Definition d, JsonObject out) {
        if (!d.primitive().equals("contract_record") || d.proofs().stream().noneMatch(s -> Set.of("survey", "project", "supply").contains(s))) return;
        JsonObject options = plugin.taskMarket().assessmentContracts(p, d.proofs());
        out.add("contractOptions", options);
        if (plugin.guild().hasActiveContract(p)) {JsonObject current=plugin.taskMarket().progressState(p);
            out.addProperty("nextCommand",current.has("guidance")?current.getAsJsonObject("guidance").get("nextCommand").getAsString():"/mycli guild status");return;}
        for (var item : options.getAsJsonArray("items")) {
            JsonObject row = item.getAsJsonObject();
            if (row.has("acceptCommand")) { out.addProperty("nextCommand", row.get("acceptCommand").getAsString()); return; }
        }
        out.addProperty("nextCommand", "/mycli tasks list all");
        out.addProperty("advice", "没有符合本场考试且当前可接的委托；已完成的一次性履历不能重领。可先查看拒绝原因，或主动cancel后换考题；不会自动放弃或覆盖进度。");
    }
    void contractRejected(Player p, String id) {
        Run r=current(p); JsonObject out=new JsonObject();
        out.addProperty("type","contract_denied"); out.addProperty("ok",false);
        out.addProperty("reason","exam_contract_incompatible"); out.addProperty("requestedContractId",id);
        if(r!=null){out.addProperty("examId",r.definition.id());contractGuidance(p,r.definition,out);}
        if(!plugin.communication().compact(p))p.sendMessage("§e这张委托不计入当前考试；/mycli guild exam status 会列出本人可接的匹配委托与准确命令。原考试进度保留。");
        send(p,"MC_GUILD_EXAM",out);
    }
    void show(Player p) { show(p, plugin.communication().compact(p)); }
    private void show(Player p, boolean machine) {
        Run r=observed(p);JsonObject out=summary(p);out.addProperty("type","status");out.addProperty("schemaVersion",1);out.addProperty("subjectUuid",p.getUniqueId().toString());out.addProperty("scope","self");
        if(r!=null){out.addProperty("version",r.definition.version());out.add("requirements",AssessmentCatalog.JSON.toJsonTree(r.definition));out.getAsJsonObject("requirements").addProperty("description",description(r.definition));out.addProperty("evaluationPolicy",shelter(r.definition)?"direct_result_v1":"two_track_v1");out.add("measured",measurements(r));
            out.addProperty("purpose",r.grade==null?"certificate":"promotion");
            out.add("guide",guide(p,r));out.addProperty("guideCommand","/mycli guild exam guide");
            if(r.state.equals("active"))contractGuidance(p,r.definition,out);
            else if(r.state.equals("ready")&&!shelter(r.definition))out.addProperty("nextCommand",r.market.isEmpty()?"/mycli guild exam submit":"/mycli guild claim");
            if(r.definition.proofs().contains("survey_photo")) {
                out.add("photography",plugin.taskMarket().photoStatus(p));
                if(!machine)p.sendMessage("§b摄影实考：每个探索阶段至少1张合格实地照片；要求多种群系时，每种各拍一张。走查、返程照常；好构图额外纪念荣誉，不影响晋级。/mycli photo menu");
            }
            AssessmentCatalog.Point target=target(r);if(target!=null){JsonObject at=AssessmentCatalog.JSON.toJsonTree(target).getAsJsonObject();at.addProperty("worldUuid",r.definition.course().world().toString());out.add("target",at);}
            if(!machine){p.sendMessage("§b"+r.definition.title()+"："+(r.state.equals("active")?"进行中":r.state.equals("ready")?"可交卷":r.state.equals("submitted")?"已交卷":r.state.equals("interrupted")?"已中断":"已取消")+"；"+out.get("nextAction").getAsString());
                p.sendMessage("§e完整步骤与材料：公会→训练与考试→当前考试指引；或 /mycli guild exam guide。");
                if(out.has("nextCommand"))p.sendMessage("§a下一步："+out.get("nextCommand").getAsString()+"；只推荐，不自动接单或消费。");
                if(target!=null)p.sendMessage("§e当前目标 "+r.definition.course().world()+" X="+target.x()+" Y="+target.y()+" Z="+target.z()+"，距离 "+Math.round(point(p).distance(target))+"格；测量 "+measurements(r));}
        }else {out.addProperty("nextCommand","/mycli guild exam list");if(!machine)p.sendMessage("§e没有在办考试；/mycli guild exam list 看题目，或 /mycli guild exam promotion 查下一阶。");}
        send(p,"MC_GUILD_EXAM",out);
    }
    void jsonQuery(Player p,String[] args) {
        if(args.length==3&&(args[2].equalsIgnoreCase("promotion")||args[2].equalsIgnoreCase("rank"))){promotion(p,true);return;}
        if(args.length>=3&&args[2].equalsIgnoreCase("supplies")){suppliesCommand(p,args,true);return;}
        if(args.length==3&&args[2].equalsIgnoreCase("guide")){guideReply(p,true);return;}
        if(args.length==3&&args[2].equalsIgnoreCase("status")){show(p,true);return;}
        if(args.length==4&&args[2].equalsIgnoreCase("info")) {
            AssessmentCatalog.Definition d=definition(args[3]);if(d==null){JsonObject out=new JsonObject();out.addProperty("type","error");out.addProperty("ok",false);out.addProperty("reason","unknown_exam");out.addProperty("nextCommand","/mycli guild exam list");send(p,"MC_GUILD_EXAM",out);return;}
            info(p,d,true);return;
        }
        JsonObject out=new JsonObject();out.addProperty("type","error");out.addProperty("ok",false);out.addProperty("reason","invalid_arguments");
        out.addProperty("nextCommand","/mycli guild exam status --json");send(p,"MC_GUILD_EXAM",out);
    }
    private void info(Player p,AssessmentCatalog.Definition d,boolean machine) {
        JsonObject out=AssessmentCatalog.JSON.toJsonTree(d).getAsJsonObject();out.addProperty("description",description(d));out.addProperty("evaluationPolicy",shelter(d)?"direct_result_v1":"two_track_v1");out.addProperty("type","definition");out.addProperty("eligibility",eligibility(p,d));
        contractGuidance(p,d,out);
        Run r=observed(p);boolean same=r!=null&&r.definition.id().equals(d.id())&&Set.of("active","ready","interrupted").contains(r.state);
        if(same){
            if(System.currentTimeMillis()<r.expires&&(!r.state.equals("interrupted")||canResume(r)))
                out.addProperty("eligibility","in_progress");
            if(shelter(r.definition))merge(out,resultSnapshot(p,r));
            else out.addProperty("nextCommand",safeNextCommand(r));
        }
        else out.addProperty("nextCommand",busy(p)?"/mycli guild exam status":"/mycli guild exam start "+d.id());
        send(p,"MC_GUILD_EXAM",out);
        if(!machine)p.sendMessage("§b"+d.title()+"："+description(d)+"；限时"+d.timeout()+"秒。下一步："+out.get("nextCommand").getAsString());
    }
    /** Chat is a read-only projection, not the full mcagent:exam receipt. */
    static JsonObject chatProjection(JsonObject source) {
        if(chatFits(source))return source.deepCopy();
        boolean guideReply=source.has("type")&&new JsonPrimitive("guide").equals(source.get("type"));
        JsonObject projected=new JsonObject();
        source.entrySet().forEach(e->{if(!Set.of("guide","current").contains(e.getKey()))projected.add(e.getKey(),e.getValue());});
        JsonElement guide=source.get("guide");
        if(guide!=null) {
            if(guideReply&&guide.isJsonObject()) {
                JsonObject steps=new JsonObject();
                guide.getAsJsonObject().entrySet().forEach(e->{if(!Set.of("current","result").contains(e.getKey()))steps.add(e.getKey(),e.getValue());});
                projected.add("guide",steps);
            }
            if(!projected.has("guideCommand"))projected.addProperty("guideCommand","/mycli guild exam guide");
        }
        if(chatFits(projected))return projected.deepCopy();
        // Remove definition/measurement/UI expansion only after redundant guide copies.
        // Keep current domain facts at top level, including all seven live house checks.
        String[] facts={"type","scope","subjectUuid","schema","schemaVersion","examId","runId","state","reason",
                "startedAt","expiresAt","canSubmit","missingProofs","houseChecks","result","nextAction","nextCommand",
                "guideCommand","available","ok","phase","purpose","persistedState","proofRetained","houseReason"};
        JsonObject core=new JsonObject();
        for(String key:facts)if(projected.has(key))core.add(key,projected.get(key));
        if(guideReply&&projected.has("guide")) {
            JsonObject steps=new JsonObject(),g=projected.getAsJsonObject("guide");
            for(String key:List.of("title","currentCommand","nextCommand","steps"))if(g.has(key))steps.add(key,g.get(key));
            core.add("guide",steps);
        }
        if(chatFits(core))return core.deepCopy();
        // Pathological definitions/strings/nesting: omit whole fields, never slice JSON
        // or manufacture availability/completion. Bounded commands continue read-only queries.
        JsonObject compact=new JsonObject();compact.addProperty("compactTransport",true);compact.addProperty("readOnly",true);
        compact.addProperty("transportReason","chat_size_limit");
        compact.addProperty("queryCommand","/mycli guild exam status --json");
        compact.addProperty("menuCommand","/mycli guild exam menu");
        compact.addProperty("guideCommand","/mycli guild exam guide");
        for(String key:facts) {
            JsonElement value=source.get(key);if(value==null||key.equals("guideCommand"))continue;
            // Scalar identity/state/commands must not hide arbitrarily large nested data.
            if(!Set.of("missingProofs","houseChecks","result").contains(key)&&!value.isJsonPrimitive()&&!value.isJsonNull())continue;
            if(!chatFits(value))continue;
            compact.add(key,value);
            if(!chatFits(compact))compact.remove(key);
        }
        return compact.deepCopy();
    }
    /** Iterative, bounded size/depth check before any recursive Gson copy/serialization. */
    private static boolean chatFits(JsonElement value) {
        // Reserve 24 characters for every prefix emitted here, including certificates.
        final int budget=3776;
        Deque<Map.Entry<JsonElement,Integer>> pending=new ArrayDeque<>();
        pending.push(new AbstractMap.SimpleImmutableEntry<>(value,0));int length=0,nodes=0;
        while(!pending.isEmpty()) {
            var item=pending.pop();JsonElement e=item.getKey();int depth=item.getValue();
            if(depth>64||++nodes>budget)return false;
            if(e==null||e.isJsonNull())length+=4;
            else if(e.isJsonPrimitive()) {
                if(e.getAsString().length()>budget)return false;
                length+=e.toString().length();
            } else if(e.isJsonObject()) {
                JsonObject object=e.getAsJsonObject();length+=2+Math.max(0,object.size()-1);
                if(length+object.size()+pending.size()>budget)return false;
                for(var field:object.entrySet()) {
                    if(field.getKey().length()>budget)return false;
                    length+=new JsonPrimitive(field.getKey()).toString().length()+1;
                    if(length>budget)return false;
                    pending.push(new AbstractMap.SimpleImmutableEntry<>(field.getValue(),depth+1));
                }
            } else {
                JsonArray array=e.getAsJsonArray();length+=2+Math.max(0,array.size()-1);
                if(length+array.size()+pending.size()>budget)return false;
                for(JsonElement child:array)pending.push(new AbstractMap.SimpleImmutableEntry<>(child,depth+1));
            }
            if(length>budget)return false;
        }
        return true;
    }
    private void send(Player p,String prefix,JsonObject out) {
        out.addProperty("schemaVersion",1);out.addProperty("subjectUuid",p.getUniqueId().toString());out.addProperty("scope","self");
        p.sendMessage(prefix+" "+chatProjection(out));byte[] bytes=out.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);if(bytes.length<=24000)p.sendPluginMessage(plugin,CHANNEL,bytes);
    }
    private void reply(Player p,String reason,AssessmentCatalog.Definition d) {
        JsonObject out=new JsonObject();out.addProperty("type","error");out.addProperty("ok",false);out.addProperty("reason",reason);
        out.addProperty("nextCommand",reason.equals("guild_registration_required")?"/mycli guild join":reason.equals("task_slot_busy")?(busy(p)?"/mycli guild exam status":"/mycli guild status"):"/mycli guild exam promotion");
        if(reason.startsWith("fame_required:")){
            int fame=plugin.guild().reputation(p),target=Integer.parseInt(reason.substring("fame_required:".length()));
            out.addProperty("fame",fame);out.addProperty("fameTarget",target);out.addProperty("fameRemaining",Math.max(0,target-fame));
            var hint=fameHint(p);out.addProperty("nextCommand",hint.command());
            out.addProperty("errorMessage","公会声望 "+fame+"/"+target+"。"+hint.message());
        }
        if(d!=null&&shelter(d)&&reason.equals("practice_incomplete"))merge(out,resultSnapshot(p));
        if(reason.equals("guild_registration_required"))out.addProperty("errorMessage","尚未登记冒险者；先免费登记，再报名考试。");
        if(d!=null)out.addProperty("examId",d.id());send(p,"MC_GUILD_EXAM",out);
        if(reason.equals("guild_registration_required")){p.sendMessage("§e[考试] 尚未登记冒险者。免费登记：/mycli guild join");return;}
        if(plugin.communication().compact(p))return;
        if(reason.startsWith("fame_required:")){p.sendMessage("§e"+out.get("errorMessage").getAsString()+" · "+out.get("nextCommand").getAsString());return;}
        if(d!=null&&shelter(d)&&reason.equals("practice_incomplete")){p.sendMessage("§e"+out.get("nextAction").getAsString());return;}
        p.sendMessage("§e未开始/未交付："+reason+"。"+(reason.equals("go_to_start")&&d!=null&&d.course()!=null?"请正常前往出发台 "+d.course().world()+" "+d.course().start()+"，落地后开考。":
                reason.equals("task_slot_busy")?"先 /mycli guild status 或 guild exam status 查看当前任务；交付或主动放弃后再开考。":
                reason.startsWith("certificate_required")?"/mycli guild certificates 查看已取得证书；/mycli guild exam list 选择所缺能力题。":
                reason.equals("course_unavailable")?"该场地尚未开放；选择列表中已开放的题目，或联系服主勘察并配置场地。":
                reason.equals("practice_incomplete")&&d!=null&&d.primitive().equals("contract_record")?"本场需先完成并交付关联委托（/mycli guild claim）；交付后自动 ready，再 /mycli guild exam submit 交卷。":
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
    private static String gradeLabel(int grade) { return RANKS[grade/3]+" "+DIVISIONS[grade%3]; }

    static void advanceGrade(JsonObject academy,int expectedGrade,int target) {
        int stored=academy.has("grade") ? academy.get("grade").getAsInt() : expectedGrade;
        if(target<1 || target>GuildRankPoints.LAST_GRADE || stored!=expectedGrade || target!=expectedGrade+1)
            throw new IllegalStateException("grade changed");
        academy.addProperty("grade",target);
        academy.addProperty("progressionPolicy","fame_v1");
        // Tombstone the retired scoring epoch for rollback/ABI readers; never add a point balance.
        if(!academy.has("rankPointsStarted"))academy.addProperty("rankPointsStarted",true);
    }

    private void confirmDivision(Player p,int target) {
        int grade=readGrade(p);
        if(!fameLedgerReady() || !plugin.guild().hasJoined(p)){
            reply(p,fameLedgerReady()?"guild_registration_required":"promotion_unavailable",null);return;
        }
        if(target<1 || target>GuildRankPoints.LAST_GRADE || target%3==0){reply(p,"choose_promotion_topic",null);return;}
        boolean already=target==grade;
        if(!already) {
            if(target!=grade+1){reply(p,"grade_changed",null);return;}
            String gate=promotionGate(p,catalog.grades.get(target),true);
            if(!gate.equals("ready")){reply(p,gate,null);return;}
            if(busy(p)||plugin.guild().hasActiveContract(p)){reply(p,"task_slot_busy",null);return;}
            if(plugin.pvpParticipant(p)||plugin.dungeonParticipant(p)){reply(p,"activity_active",null);return;}
            if(!ledger.write(data->advanceGrade(academy(data,p.getUniqueId()),grade,target))){reply(p,"data_unavailable",null);return;}
            plugin.guild().mirrorPromotion(p,target/3);
        }
        JsonObject out=new JsonObject();
        out.addProperty("type","promotion_result");out.addProperty("purpose","promotion");out.addProperty("ok",true);
        out.addProperty("gradeIndex",target);out.addProperty("applied",!already);out.addProperty("reason",already?"already_promoted":"promoted");
        out.addProperty("nextCommand","/mycli guild exam promotion");send(p,"MC_GUILD_EXAM",out);
        if(!plugin.communication().compact(p))p.sendMessage("§a"+(already?"已登记此段位：":"晋级成功：")+gradeLabel(target));
    }

    private String contractCommand(Player p) {
        return plugin.guild().hasActiveContract(p)?"/mycli guild status":"/mycli guild board";
    }

    private GuildAdventureGuide.Hint fameHint(Player p) {
        if(plugin.guild().hasActiveContract(p))
            return new GuildAdventureGuide.Hint("查看并完成在办委托，交付增加公会声望","/mycli guild status");
        TaskMarketManager market=plugin.taskMarket();
        if(market!=null)for(var task:market.offers()){
            if(!market.offerState(task,p).equals("available"))continue;
            if(task.contract(0).fame()>0)
                return new GuildAdventureGuide.Hint("可接「"+task.title()+"」，交付增加公会声望；先查看任务条件","/mycli tasks info "+task.id());
        }
        return new GuildAdventureGuide.Hint("查看今日公会看板，选择可接的委托，交付增加公会声望","/mycli guild board");
    }

    static AssessmentCatalog.Grade displayedGrade(AssessmentCatalog.Grade grade) {
        return grade;
    }

    private JsonObject promotionInfo(Player p) {
        int grade=readGrade(p);
        JsonObject out=standing(p);
        out.addProperty("type","promotion");out.addProperty("fame",plugin.guild().reputation(p));
        Run run=observed(p);
        if(run!=null){
            JsonObject exam=new JsonObject();
            exam.addProperty("runId",run.id.toString());exam.addProperty("examId",run.definition.id());
            exam.addProperty("state",run.state);exam.addProperty("purpose",run.grade==null?"certificate":"promotion");
            if(run.grade!=null)exam.addProperty("rankRulesVersion",run.rankRulesVersion);
            out.add("currentOrLastExam",exam);
        }
        if(!fameLedgerReady() || grade==GuildRankPoints.LAST_GRADE){
            out.addProperty("eligibility",fameLedgerReady()?"max_grade":"promotion_unavailable");return out;
        }
        AssessmentCatalog.Grade g=catalog.grades.get(grade+1);
        boolean major=g.index()%3==0;
        out.add("nextGrade",AssessmentCatalog.JSON.toJsonTree(displayedGrade(g)));
        if(!major)out.add("optionalPracticalTopics",AssessmentCatalog.JSON.toJsonTree(g.fresh()));
        out.addProperty("promotionMode",major?"practical_exam":"confirm");
        out.addProperty("fameTarget",g.fame());
        out.addProperty("fameRemaining",Math.max(0,g.fame()-plugin.guild().reputation(p)));
        if(major)out.addProperty("historyRequirement",plugin.guild().promotionHistoryAdvice(g.index()/3));
        String gate=promotionGate(p,g,true),command,action;
        out.addProperty("eligibility",gate);
        if(occupiesExamSlot(run)){
            command=run.state.equals("ready")?"/mycli guild exam submit":"/mycli guild exam status";
            action=run.grade==null?"先完成在办的能力证书考试":"继续已报名的晋级考试";
        }else if(gate.equals("history_required")){
            JsonArray missing=plugin.guild().missingPromotionHistory(p,g.index()/3);
            out.add("missingHistory",missing);
            command=contractCommand(p);action="完成所缺的公会履历";
            if(!missing.isEmpty()){
                var step=missing.get(0).getAsJsonObject();command=step.get("nextCommand").getAsString();action=step.get("requirement").getAsString();
            }
        }else if(gate.startsWith("fame_required:")||plugin.guild().hasActiveContract(p)){
            command=contractCommand(p);action=plugin.guild().hasActiveContract(p)?"查看并完成在办委托":"在委托板选择适合本阶的委托";
        }else if(gate.startsWith("certificate_required:")){
            command="/mycli guild exam info "+gate.substring("certificate_required:".length()).split("\\|")[0];action="查看所缺能力证书的考题";
        }else if(gate.equals("ready")&&major){
            String topic=g.fresh().stream().filter(id->eligibility(p,definition(id)).equals("ready")).findFirst().orElse("");
            command=topic.isEmpty()?"/mycli guild exam info "+g.fresh().getFirst():"/mycli guild exam start promotion "+topic;
            action="选择并完成一场新的晋级实操";
        }else if(gate.equals("ready")&&(plugin.pvpParticipant(p)||plugin.dungeonParticipant(p))){
            out.addProperty("eligibility","activity_active");command="/mycli guild exam promotion";action="当前战斗活动结束后再确认晋级";
        }else if(gate.equals("ready")){
            command="/mycli guild exam start promotion "+g.index();action="确认晋升至 "+gradeLabel(g.index());
        }else if(gate.equals("guild_registration_required")){
            command="/mycli guild join";action="先免费登记冒险者";
        }else if(gate.equals("distinct_certificates_required")){
            command="/mycli guild certificates";action="核对本段所需的不同证书";
        }else{
            command="/mycli guild exam promotion";action="回到生存状态后查看晋级条件";
        }
        out.addProperty("nextCommand",command);out.addProperty("nextAction",action);return out;
    }

    private void promotion(Player p) { promotion(p,plugin.communication().compact(p)); }
    private void promotion(Player p,boolean machine) {
        JsonObject out=promotionInfo(p);
        if(!machine){
            p.sendMessage("§6冒险者 "+out.get("gradeName").getAsString()+" · 公会声望 "+out.get("fame").getAsInt());
            if(out.has("nextGrade")){
                int index=out.getAsJsonObject("nextGrade").get("index").getAsInt();
                p.sendMessage("§e下一阶 "+gradeLabel(index)+" · 声望 "+out.get("fame")+"/"+out.get("fameTarget")+"，还差 "+out.get("fameRemaining"));
                if(index%3==0)p.sendMessage("§e大段实操 · 最低声望 "+out.getAsJsonObject("nextGrade").get("fame")+" · "+out.get("historyRequirement").getAsString());
                if(out.has("missingHistory"))for(var entry:out.getAsJsonArray("missingHistory")){
                    var step=entry.getAsJsonObject();p.sendMessage("§e尚缺："+step.get("requirement").getAsString()+"。"
                            +(step.has("instruction")?step.get("instruction").getAsString()+"。":"")+step.get("nextCommand").getAsString());
                }
                p.sendMessage("§b"+out.get("nextAction").getAsString()+" · "+out.get("nextCommand").getAsString());
            }else p.sendMessage(fameLedgerReady()?"§a已达最高段位":"§e晋级暂未开放");
        }
        send(p,"MC_GUILD_EXAM",out);
    }
    void command(Player p,String[] args) {
        String action=args.length>2?args[2].toLowerCase(Locale.ROOT):"menu";
        switch(action) {
            case "menu" -> menu(p,false);
            case "list" -> {for(var d:catalog==null?List.<AssessmentCatalog.Definition>of():catalog.definitions.values().stream().sorted(Comparator.comparing(AssessmentCatalog.Definition::id)).toList())p.sendMessage("§e"+d.id()+" · "+d.title()+" ["+(d.enabled()?"开放":"待勘察场地")+"] "+description(d));promotion(p);}
            case "info" -> {AssessmentCatalog.Definition d=args.length>3?definition(args[3]):null;if(d==null){reply(p,"unknown_exam",null);break;}info(p,d,plugin.communication().compact(p));}
            case "start" -> {
                if(args.length<4){reply(p,"choose_exam",null);break;}
                boolean promotion=args[3].equalsIgnoreCase("promotion");
                if(promotion&&args.length==4){promotion(p);break;}
                if(args.length!=(promotion?5:4)){reply(p,"invalid_arguments",null);break;}
                if(promotion&&args[4].matches("[0-9]{1,2}"))confirmDivision(p,Integer.parseInt(args[4]));
                else start(p,args[promotion?4:3],promotion);
            }
            case "status" -> show(p);
            case "resume" -> resume(p);
            case "guide" -> {if(args.length==3){if(plugin.communication().compact(p))guideReply(p,true);else guideMenu(p);}else reply(p,"invalid_arguments",null);}
            case "supplies" -> suppliesCommand(p,args,plugin.communication().compact(p));
            case "promotion", "rank" -> promotion(p);
            case "submit" -> {Run r=current(p);if(r==null)reply(p,"no_exam",null);else if(!r.market.isEmpty())p.sendMessage("§e此题属于市场委托；请 /mycli guild claim 交付，不能独立重复结算。");else submit(p,r);}
            case "cancel" -> {Run r=current(p);if(r==null)break;if(!r.market.isEmpty()){p.sendMessage("§e请 /mycli guild abandon 放弃市场委托；不会暗中释放当前阶段。");break;}r.state="cancelled";r.reason="player_cancelled";save(p,r);show(p);}
            case "retry" -> {Run r=current(p);if(r==null||r.market.isEmpty()||!r.state.equals("interrupted")){reply(p,"retry_market_interrupted_only",null);break;}String gate=eligibility(p,r.definition);if(!gate.equals("ready")){reply(p,gate,r.definition);break;}Run next=newRun(r.definition,r.market);if(save(p,next)){runs.put(p.getUniqueId(),next);show(p);}}
            default -> p.sendMessage("§e/mycli guild exam promotion 查看分数和下一步；start promotion <目标段位数字或实操ID> 晋级；start <ID> 考证。");
        }
    }
    private void menu(Player p,boolean promotion) {
        List<String> ids=catalog==null?List.of():catalog.definitions.keySet().stream().sorted().toList();
        JsonObject progress=promotion?promotionInfo(p):null;
        int target=promotion&&progress.has("nextGrade")?progress.getAsJsonObject("nextGrade").get("index").getAsInt():-1;
        if(promotion)ids=target>0&&target%3==0?catalog.grades.get(target).fresh():List.of();
        Inventory inv=Bukkit.createInventory(null,45,promotion?"公会 · 冒险者晋级":"公会 · 训练与考试");
        for(int i=0;i<ids.size();i++){var d=definition(ids.get(i));inv.setItem(i,icon(Material.WRITABLE_BOOK,d.title(),description(d),d.enabled()?"点击查看条件，自行确认开考":"场地待勘察，暂不能开考",hasCertificate(p,d.id())?"已有证书，可重练":"未认证"));}
        if(target>0){
            String points="声望 "+progress.get("fame")+"/"+progress.get("fameTarget")+" · 还差 "+progress.get("fameRemaining");
            inv.setItem(22,icon(Material.EXPERIENCE_BOTTLE,gradeLabel(target),points,"公会声望 "+progress.get("fame"),progress.get("nextAction").getAsString()));
            if(target%3!=0)inv.setItem(11,icon(Material.EMERALD,"确认晋级 "+gradeLabel(target),points,"声望与证书条件达标后点击一次确认"));
            inv.setItem(24,icon(Material.WRITABLE_BOOK,"查看公会委托","进行中的委托可在公会菜单继续或交付"));
        }
        inv.setItem(36,icon(Material.EXPERIENCE_BOTTLE,gradeName(p)+" · 冒险者晋级","查看本阶分数、小段确认与大段考题"));inv.setItem(37,icon(Material.BOOK,"我的能力证书"));
        inv.setItem(38,icon(Material.CLOCK,"当前考试指引与材料","按步骤操作；材料领取、相机和任务入口"));inv.setItem(40,icon(Material.BARRIER,"关闭"));
        menus.put(inv,new Menu(p.getUniqueId(),List.copyOf(ids),"",promotion,target));p.openInventory(inv);
    }
    private ItemStack icon(Material type,String name,String... lore) {ItemStack item=new ItemStack(type);var meta=item.getItemMeta();meta.setDisplayName(name);meta.setLore(List.of(lore));item.setItemMeta(meta);return item;}
    private void guideReply(Player p,boolean machine) {
        Run r=observed(p);if(r==null){show(p,machine);return;}JsonObject out=new JsonObject();out.addProperty("type","guide");out.addProperty("examId",r.definition.id());out.addProperty("runId",r.id.toString());out.add("guide",guide(p,r));
        if(!machine){JsonObject g=out.getAsJsonObject("guide");if(g.has("current")){JsonObject c=g.getAsJsonObject("current");if(c.has("objectives"))TaskMarketManager.showGuidance(p,c);else p.sendMessage("§e【当前阶段】"+c.get("summary").getAsString()+"；"+c.get("nextAction").getAsString());}
            else for(var value:g.getAsJsonArray("steps")){var row=value.getAsJsonObject();p.sendMessage("§e"+row.get("order")+". "+row.get("title").getAsString()+"："+row.get("instruction").getAsString());}}
        send(p,"MC_GUILD_EXAM",out);
    }
    private void guideMenu(Player p) {
        Run r=observed(p);if(r==null){show(p);return;}JsonObject g=guide(p,r);Inventory inv=Bukkit.createInventory(null,45,"考试指引 · "+r.definition.title());
        for(var value:g.getAsJsonArray("steps")) {
            var row=value.getAsJsonObject();String text=row.get("instruction").getAsString();List<String> lore=new ArrayList<>();for(int i=0;i<text.length();i+=28)lore.add("§7"+text.substring(i,Math.min(text.length(),i+28)));
            lore.add("§a"+row.get("command").getAsString());inv.setItem(row.get("order").getAsInt()-1,icon(Material.BOOK,row.get("order")+". "+row.get("title").getAsString(),lore.toArray(String[]::new)));
        }
        if(g.has("current")) {
            JsonObject current=g.getAsJsonObject("current");
            List<String> currentLore=new ArrayList<>();String action=current.get("nextAction").getAsString();
            for(int i=0;i<action.length();i+=26)currentLore.add("§7"+action.substring(i,Math.min(action.length(),i+26)));
            currentLore.add("§a"+current.get("nextCommand").getAsString());
            inv.setItem(13,icon(Material.SPYGLASS,"➤ "+current.get("summary").getAsString(),currentLore.toArray(String[]::new)));
            if(current.has("objectives")){int slot=0;for(var value:current.getAsJsonArray("objectives")){JsonObject row=value.getAsJsonObject();String state=row.get("state").getAsString();
                inv.setItem(slot++,icon(state.equals("completed")?Material.LIME_DYE:state.equals("current")?Material.YELLOW_DYE:Material.GRAY_DYE,(state.equals("completed")?"§a✓ ":state.equals("current")?"§e➤ ":"§7○ ")+row.get("title").getAsString(),state.equals("completed")?"已完成；不必重做":state.equals("current")?"当前目标；下方望远镜查看下一步":"后续目标；完成当前步骤后继续"));}}
        }
        if(!shelter(r.definition)) {
        inv.setItem(20,icon(Material.CHEST,"个人奖励箱·取照片","拍照直接成片入箱，无需准备空地图"));
        inv.setItem(21,icon(Material.FILLED_MAP,"领取遗迹探险图","仅原图寻宝路线需要；天然遗迹有真实目标"));
        inv.setItem(22,icon(Material.CHEST,"免费取出考试材料","只取本场已发的材料到主背包","无需学习传送术；不扣魔力；背包满则保留"));
        inv.setItem(23,icon(Material.SPYGLASS,"现场拍照","打开女神相机，拍完查看合格结果"));
        inv.setItem(24,icon(Material.WRITABLE_BOOK,"选择探索委托","查看真实可接条件，再主动接单"));
        inv.setItem(31,icon(Material.EMERALD,"交付当前委托阶段","先核查；有缺项不会扣物或冒充通过"));
        }
        inv.setItem(30,icon(Material.CLOCK,"核查当前缺项",shelter(r.definition)?"现场验房，不接单、不交付":"查看原委托阶段验收"));
        inv.setItem(32,icon(Material.EXPERIENCE_BOTTLE,"验收并交卷",shelter(r.definition)?"一次现场复验七项，满足后取得证书或晋级":"实操和照片齐全，ready后领取证书或晋级"));inv.setItem(40,icon(Material.ARROW,"返回考试目录"));
        menus.put(inv,new Menu(p.getUniqueId(),List.of(),"@guide",false));p.openInventory(inv);
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void click(InventoryClickEvent e) {
        Menu m=menus.get(e.getView().getTopInventory());if(m==null)return;e.setCancelled(true);
        if(!(e.getWhoClicked() instanceof Player p)||!m.owner.equals(p.getUniqueId())||e.getRawSlot()<0||e.getRawSlot()>=e.getView().getTopInventory().getSize())return;
        int slot=e.getRawSlot();p.closeInventory();
        if(m.detail.equals("@guide")) {
            Bukkit.getScheduler().runTask(plugin,()->{if(!p.isOnline())return;switch(slot){
                case 20 -> plugin.dungeon().openStashPages(p);
                case 21 -> suppliesCommand(p,new String[]{"guild","exam","supplies","claim","map"},plugin.communication().compact(p));
                case 22 -> suppliesCommand(p,new String[]{"guild","exam","supplies","take","all"},plugin.communication().compact(p));
                case 23 -> plugin.photoCamera().command(p,new String[]{"photo","menu"});
                case 24 -> plugin.taskMarket().routes().open(p,"exploration",1);
                case 30 -> {Run active=observed(p);if(active!=null&&shelter(active.definition))show(p);else plugin.guild().command(p,new String[]{"guild","verify"});}
                case 31 -> plugin.guild().command(p,new String[]{"guild","claim"});
                case 32 -> command(p,new String[]{"guild","exam","submit"});
                case 40 -> menu(p,false);
                default -> guideReply(p,plugin.communication().compact(p));
            }});return;
        }
        if(!m.detail.isEmpty()){if(slot==11){
            if(m.promotion&&readGrade(p)+1!=m.targetGrade){reply(p,"grade_changed",null);return;}
            start(p,m.detail,m.promotion);
        }else if(slot==15)menu(p,m.promotion);return;}
        if(m.promotion&&slot==11&&m.targetGrade>0&&m.targetGrade%3!=0){confirmDivision(p,m.targetGrade);return;}
        if(m.promotion&&slot==22){promotion(p);return;}
        if(m.promotion&&slot==24){plugin.openGuildMenu(p);return;}
        if(slot<m.ids.size()){String id=m.ids.get(slot);var d=definition(id);Inventory inv=Bukkit.createInventory(null,27,d.title()+" · 确认开考");
            inv.setItem(4,icon(Material.BOOK,d.title(),description(d),"条件："+eligibility(p,d),"限时"+d.timeout()+"秒；技能消耗照常；不自动花点"));
            inv.setItem(11,icon(Material.EMERALD,"主动开始考试"));inv.setItem(15,icon(Material.ARROW,"返回"));menus.put(inv,new Menu(p.getUniqueId(),List.of(),id,m.promotion,m.targetGrade));p.openInventory(inv);
        }else if(slot==36){promotion(p);menu(p,true);}else if(slot==37)certificates(p);else if(slot==38)guideMenu(p);
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void drag(InventoryDragEvent e) {if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e) {menus.remove(e.getInventory());}
    String bookPage(Player p) {
        JsonObject a=academy(p.getUniqueId());String ids=a.has("certificates")?String.join("、",a.getAsJsonObject("certificates").keySet()):"未认证";
        return "§6冒险者认证§r\n\n"+gradeName(p)+"\n声望 "+plugin.guild().reputation(p)+"\n\n能力证书："+ids+"\n\n公会→训练与考试\n→当前考试指引与材料\n摄影不用空地图，成片进个人奖励箱；遗迹探险图可按需领取。\n\n/mycli guild exam guide\n旧资历保留，不自动花点。";
    }
    void admin(CommandSender sender,String[] args) {
        if(args.length>2&&args[2].equals("reload"))sender.sendMessage(reload()?"考试与18阶目录已热加载；在途定义保持冻结。":"配置错误，已保留上次有效目录；修正两份配置后再加载。");
        else sender.sendMessage("Assessment catalog="+(catalog==null?0:catalog.definitions.size())+" ledger="+available()+" active="+runs.values().stream().filter(r->r.state.equals("active")).count()+" sampleMs="+lastSampleMs+" peakMs="+maxSampleMs);
    }
    void shutdown() {task.cancel();for(var entry:List.copyOf(runs.entrySet())){Player p=Bukkit.getPlayer(entry.getKey());if(p!=null&&!durableRecord(entry.getValue()))interrupt(p,entry.getValue(),"server_restart");}menus.clear();}
}
