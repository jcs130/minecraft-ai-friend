package org.qiandengji.vortex;

import com.google.gson.*;
import java.time.Instant;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.quest.*;
import io.vortexcore.combat.ManaManager;
import io.vortexcore.item.CustomItemService;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.*;
import org.bukkit.plugin.java.JavaPlugin;
import java.util.*;
import java.util.concurrent.*;

/** Native Vortex API adapter, not a second XP, mana, class or quest implementation. */
public final class VortexBridge extends JavaPlugin {
    private VortexCorePlugin vortex;
    private QuestService quests;
    private ManaManager mana;
    private CustomItemService items;
    private YamlConfiguration city;
    private final AuctionSafety auctionSafety=new AuctionSafety();
    public void partyCommand(Player player,String[] args){if(!Bukkit.isPrimaryThread())throw new IllegalStateException("party command requires primary thread");new NativeParties(vortex).command(player,args);}
    private final Set<UUID> pending=ConcurrentHashMap.newKeySet();
    private final Gson gson=new GsonBuilder().registerTypeAdapter(Instant.class,(JsonSerializer<Instant>)(value,type,context)->new JsonPrimitive(value.toString())).create();
    @Override public void onEnable(){
        saveDefaultConfig();
        if(!new java.io.File(getDataFolder(),"city-facilities.yml").exists())saveResource("city-facilities.yml",false);
        city=YamlConfiguration.loadConfiguration(new java.io.File(getDataFolder(),"city-facilities.yml"));
        // A preview must never silently add a second combat/stat authority.
        // Production migration needs an explicitly reviewed AgentFriend handoff.
        if(Bukkit.getPluginManager().isPluginEnabled("AgentFriend")&&!legacyRetired()){
            getLogger().severe("拒绝双重RPG权威：此候选只允许独立验证；先完成现有职业和技能迁移。");
            Bukkit.getPluginManager().disablePlugin(Bukkit.getPluginManager().getPlugin("VortexRPG"));
            Bukkit.getPluginManager().disablePlugin(this);return;
        }
        try{
            vortex=(VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG");
            if(!vortex.getPluginMeta().getVersion().equals("1.2.2-alpha"))throw new IllegalStateException("Vortex版本未验证");
            quests=vortex.qiandengjiQuests();
            mana=vortex.qiandengjiMana();
            items=vortex.qiandengjiItems();
            Objects.requireNonNull(quests);Objects.requireNonNull(mana);
            validateShops();Bukkit.getPluginManager().registerEvents(new TwinCityGates(this),this);
            vortex.spellbookService().addCastListener((player,id)->Bukkit.getScheduler().runTask(this,()->{
                FortifyDefence.confirmed(player,id);
                notifyAgentFriend("nativeCastConfirmed",new Class<?>[]{Player.class,String.class},player,id);
            }));
            Bukkit.getPluginManager().registerEvents(new org.bukkit.event.Listener(){
                @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR)
                public void killed(org.bukkit.event.entity.EntityDeathEvent event){
                    Player p=event.getEntity().getKiller();
                    if(p!=null&&event.getEntity() instanceof org.bukkit.entity.Monster)notifyAgentFriend("nativeKillConfirmed",new Class<?>[]{Player.class},p);
                }
            },this);
            auctionSafety.install(vortex);
            getLogger().info("Vortex精炼CLI就绪；原生职业/技能/经验/魔力为唯一权威。原生拍卖交付故障已阻止新增操作。");
        }catch(Exception|LinkageError error){
            getLogger().severe("Vortex适配不可用："+error.getClass().getSimpleName());
            if(vortex!=null)Bukkit.getPluginManager().disablePlugin(vortex);
            Bukkit.getPluginManager().disablePlugin(this);
        }
    }
    @Override public void onDisable(){auctionSafety.restore();}
    private void notifyAgentFriend(String name,Class<?>[] types,Object...args){
        var af=Bukkit.getPluginManager().getPlugin("AgentFriend");if(af==null||!af.isEnabled())return;
        try{af.getClass().getMethod(name,types).invoke(af,args);}catch(Exception error){getLogger().warning("冒险证明未能确认："+name+"；不伪造考试完成。");}
    }
    public void recordDungeonCompletion(Player p,String site,String run){
        if(!Bukkit.isPrimaryThread()||!site.matches("[a-z0-9_]{1,48}"))throw new IllegalArgumentException("场次参数无效");
        UUID.fromString(run);quests.progressObjectiveByType(p,QuestObjectiveType.KILL_BOSS,"site_"+site,1);
    }
    public boolean hasQuest(String id){return quests.registry().find(id).isPresent();}
    /** Native definitions/PDC, never a renamed ordinary stick or book. */
    public boolean hasUsableDungeonWeapon(Player p){
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main thread required");
        String selected=vortex.classSkillService().selectedClassDefinition(profile(p)).map(c->c.id()).orElse("");
        if(selected.isEmpty())return false;
        var stacks=new ArrayList<ItemStack>(Arrays.asList(p.getInventory().getStorageContents()));
        stacks.add(p.getInventory().getItemInOffHand());
        for(ItemStack item:stacks){
            if(item==null||item.getAmount()<1)continue;
            var def=items.definition(items.resolveId(item));
            if(def.isPresent()&&def.get().material()==item.getType()&&def.get().hasAbilityHook()
                    &&selected.equals(def.get().requiredClassId()))return true;
        }return false;
    }
    private boolean legacyRetired(){
        if(!getConfig().getString("backend","preview").equals("vortex"))return false;
        try{return Boolean.TRUE.equals(Bukkit.getPluginManager().getPlugin("AgentFriend").getClass().getMethod("nativeRpgSelected").invoke(Bukkit.getPluginManager().getPlugin("AgentFriend")));}
        catch(Exception e){return false;}
    }
    // Narrow public ABI consumed by AgentFriend without importing native classes.
    // No full metadata, raw profile or credentials are exposed to clients.
    public String selfState(Player p){
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main thread required");
        var state=profile(p);String id=vortex.classSkillService().selectedClassDefinition(state).map(c->c.id()).orElse("");
        return gson.toJson(Map.of("available",true,"backend","vortex","combat",id,"level",state.level(),"xp",state.experience(),
            "skillPoints",vortex.classSkillService().unspentSkillPoints(state),"activeSkill",vortex.spellbookService().activeSpellId(state).orElse(""),
            "mana",Map.of("current",mana.getMana(p.getUniqueId()),"max",mana.getMaxMana(p)),
            "economy",Map.of("available",vortex.qiandengjiVault().isAvailable(),"balance",vortex.qiandengjiVault().balance(p)),
            "abilities",vortex.spellbookService().editorSpellSnapshots().stream().filter(s->vortex.spellbookService().availableSpells(state).contains(s.id())).limit(48).map(s->Map.of(
                "id","mycli:"+s.id(),"name",vortex.spellbookService().spellLabel(s.id()),"level",1,"learned",true,
                "cooldownRemainingMs",vortex.spellbookService().qiandengjiCooldown(p.getUniqueId(),s.id()),
                "cooldownMs",s.cooldownMillis(),"manaCost",io.vortexcore.combat.ManaGate.cost(vortex,s.id()))).toList()));
    }
    public boolean consumeCommonMana(Player p,double amount){
        if(!Bukkit.isPrimaryThread()||!Double.isFinite(amount)||amount<0||!p.isOnline())return false;
        profile(p);return mana.consumeMana(p.getUniqueId(),amount);
    }
    /** Internal bounded advice context supplied by AgentFriend, never by command arguments. */
    public void describeJourney(Player p,String contextJson,boolean intro,boolean json){
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main thread required");
        var context=JsonParser.parseString(contextJson).getAsJsonObject();
        var request=new BridgeRules.Request("status","list",List.of(),json,false);
        profile(p);
        quests.questData(p.getUniqueId()).thenApply(data->data).orTimeout(5,TimeUnit.SECONDS).whenComplete((questsData,error)->{if(!isEnabled())return;Bukkit.getScheduler().runTask(this,()->{
            if(!p.isOnline())return;
            try{
                if(error!=null)throw new IllegalStateException("任务资料暂不可用，未推断为空任务",error);
                var state=profile(p);String id=vortex.classSkillService().selectedClassDefinition(state).map(c->c.id()).orElse("");
                var missing=new ArrayList<String>();if(context.has("missingEquipment"))context.getAsJsonArray("missingEquipment").forEach(v->missing.add(v.getAsString()));
                var facts=new RpgJourney.Facts(id,state.level(),p.getHealth(),p.getMaxHealth(),p.getFoodLevel(),mana.getMana(p.getUniqueId()),
                    cooldown(context,"foodCooldownMs"),cooldown(context,"selfhealCooldownMs"),
                    !p.isDead()&&(!context.has("canAct")||context.get("canAct").getAsBoolean()),
                    context.has("downed")&&context.get("downed").getAsBoolean(),context.has("inDungeon")&&context.get("inDungeon").getAsBoolean(),
                    pending.contains(p.getUniqueId()),quests.qiandengjiPendingRewards(p.getUniqueId()),missing,p.getWorld().getName());
                var advice=RpgJourney.next(facts,quests.registry().all().values(),questsData);
                var out=new LinkedHashMap<String,Object>();out.put("readOnly",true);out.put("queryOnly",true);out.put("backend","vortex");out.put("authority","VortexRPG");
                out.put("class",intro?id:id.isEmpty()?"none":id);out.put("level",state.level());out.put("xp",state.experience());
                out.put("nextLevelXp",vortex.playerProfileService().experienceToNextLevel(state));out.put("health",p.getHealth());out.put("maxHealth",p.getMaxHealth());out.put("food",p.getFoodLevel());out.put("mode",p.getGameMode().name());
                out.put("mana",Math.round(mana.getMana(p.getUniqueId())));out.put("maxMana",Math.round(mana.getMaxMana(p)));out.put("pending",pending.contains(p.getUniqueId()));
                boolean economyReady=vortex.qiandengjiVault().isAvailable();
                out.put("economy",economyReady?Map.of("available",true,"balance",vortex.qiandengjiVault().balance(p),"currency","金币"):Map.of("available",false,"currency","金币"));
                out.put("preview",!getConfig().getString("backend","preview").equals("vortex"));out.put("guide",advice.data());out.put("nextAction",advice.action());out.put("verifyCommand",advice.verify());
                if(!advice.command().isEmpty())out.put("nextCommand",advice.command());
                out.put("helpCommand","/mycli --help");out.put("rulesCommand","/mycli rules");
                if(json){p.sendMessage((intro?"MC_INTRO ":"MC_RPG ")+gson.toJson(out));return;}
                p.sendMessage("[RPG] "+(intro?"[破晓攻略] ":"[状态] ")+BridgeRules.className(id)+" Lv."+state.level()+"；生命 "+Math.round(p.getHealth())+"/"+Math.round(p.getMaxHealth())+"；饱食 "+p.getFoodLevel()+"/20；魔力 "+out.get("mana")+"/"+out.get("maxMana")+"；金币 "+(economyReady?vortex.qiandengjiVault().balance(p):"未就绪"));
                p.sendMessage("[RPG] "+advice.text());
                if(intro){
                    var starter=vortex.classSkillService().classProfile(id).map(c->c.starterSpellId()).filter(s->s!=null&&!s.isBlank());
                    p.sendMessage("[RPG] "+starter.map(s->"本职起始技 "+s+"；目标/耗魔：/mycli skills info "+s).orElse("基础技无需选职或学习：/mycli skills list common")+"。个人箱：/mycli arena stash；交易金币：/mycli trade wallet。规则：/mycli rules");
                }
            }catch(Exception|LinkageError failure){failure(p,request,failure);}
        });});
    }
    private static long cooldown(JsonObject context,String key){return context.has(key)&&!context.get(key).isJsonNull()?Math.max(0,context.get(key).getAsLong()):-1;}
    public void tradeCommand(Player p,String[] raw){
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main thread required");profile(p);
        boolean json=Arrays.asList(raw).contains("--json");var words=new ArrayList<>(Arrays.asList(raw));words.removeIf(s->s.equals("--json"));
        String action=words.isEmpty()?"":words.getFirst().toLowerCase(Locale.ROOT);
        boolean menu=words.equals(List.of("auction","menu"));
        if(!(words.size()==1&&Set.of("wallet","auction").contains(action))&&!menu||menu&&json){p.sendMessage("[RPG] [invalid_argument] 用法：/mycli trade wallet [--json] 或 trade auction [--json]；打开菜单：trade auction menu。未交易。");return;}
        if(action.equals("auction")){if(json)p.sendMessage("MC_RPG "+gson.toJson(Map.of("queryOnly",true,"available",false,"changed",false,"reason","auction_unavailable","nextCommand","/mycli trade wallet")));else p.sendMessage(AuctionSafety.MESSAGE);return;}
        if(!vortex.qiandengjiVault().isAvailable()){if(json)p.sendMessage("MC_RPG "+gson.toJson(Map.of("queryOnly",true,"available",false,"reason","economy_unavailable","nextCommand","/mycli trade wallet")));else p.sendMessage("[RPG] [economy_unavailable] 金币服务未就绪；本次未交易，不能把未知余额当作0。稍后查询：/mycli trade wallet");return;}
        var out=new LinkedHashMap<String,Object>();out.put("queryOnly",true);out.put("available",true);out.put("currency","金币");out.put("balance",vortex.qiandengjiVault().balance(p));out.put("auctionAvailable",false);out.put("nextCommand","/mycli tasks list");
        String text="金币余额 "+out.get("balance")+"；Vortex任务奖励到账此账户，和背包绿宝石、旧试炼余额分别记账。玩家拍卖交付故障暂时维护；本次只查询，不扣款。公共补给：/mycli guild shared。";
        if(json)p.sendMessage("MC_RPG "+gson.toJson(out));else p.sendMessage("[RPG] "+text);
    }
    private UnifiedPlayer profile(Player p){
        if(vortex.playerProfileService().qiandengjiLoading(p.getUniqueId()))throw new IllegalStateException("角色资料仍在加载，请稍后查询 status；不要重复执行。");
        return vortex.playerProfileService().profile(p.getUniqueId()).orElseThrow(()->new IllegalStateException("角色资料尚不可用，请稍后查询 status。"));
    }
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] raw){
        if(!(sender instanceof Player p)){sender.sendMessage("此入口只操作本人角色。");return true;}
        BridgeRules.Request r;
        try{r=BridgeRules.parse(raw);}catch(IllegalArgumentException e){if(Arrays.asList(raw).contains("--json"))p.sendMessage("MC_RPG "+gson.toJson(Map.of("success",false,"reason","invalid_argument","changed",false,"message",e.getMessage(),"nextCommand",e instanceof BridgeRules.InvalidArgument invalid?invalid.nextCommand():"/mycli --help")));else p.sendMessage("[RPG] "+e.getMessage());return true;}
        try{
            if(r.help()){help(p,r);return true;}
            if(!getConfig().getString("backend","preview").equals("vortex")&&!getConfig().getStringList("allowed-worlds").contains(p.getWorld().getName()))throw new IllegalArgumentException("当前世界未开放Vortex预览。");
            var state=profile(p);
            if(skillFailure(p,state,r))return true;
            switch(r.group()){
                case "status"->status(p,state,r);
                case "class"->classes(p,state,r);
                case "skills"->skills(p,state,r);
                case "cast"->{String id=BridgeRules.id(r);write(p,r,()->vortex.spellbookService().cast(p,state,id),false,"技能已执行；效果以现场和 status 为准。");}
                case "quests"->quests(p,r);
                case "shop"->shop(p,r);
                case "town"->town(p,r);
                default->throw new IllegalArgumentException("查看 /mycli --help");
            }
        }catch(Exception|LinkageError e){failure(p,r,e);}
        return true;
    }
    private void status(Player p,UnifiedPlayer state,BridgeRules.Request r){
        String id=vortex.classSkillService().selectedClassDefinition(state).map(c->c.id()).orElse("none");
        String next="/mycli "+(id.equals("none")?"profession list":"tasks status");
        var data=new LinkedHashMap<String,Object>();
        data.put("authority","VortexRPG");data.put("class",id);data.put("level",state.level());data.put("xp",state.experience());
        data.put("nextLevelXp",vortex.playerProfileService().experienceToNextLevel(state));data.put("mana",Math.round(mana.getMana(p.getUniqueId())));data.put("maxMana",Math.round(mana.getMaxMana(p)));
        data.put("health",p.getHealth());data.put("maxHealth",p.getMaxHealth());data.put("food",p.getFoodLevel());data.put("mode",p.getGameMode().name());
        data.put("pending",pending.contains(p.getUniqueId()));data.put("queryOnly",true);data.put("nextCommand",next);
        data.put("economy",Map.of("available",vortex.qiandengjiVault().isAvailable(),"balance",vortex.qiandengjiVault().balance(p)));data.put("preview",!getConfig().getString("backend","preview").equals("vortex"));
        emit(p,r,data,"[状态] "+BridgeRules.className(id)+" Lv."+state.level()+"；生命 "+Math.round(p.getHealth())+"/"+Math.round(p.getMaxHealth())+"；饱食 "+p.getFoodLevel()+"；魔力 "+data.get("mana")+"/"+data.get("maxMana")+"；升级还需 "+data.get("nextLevelXp")+"经验"+(pending.contains(p.getUniqueId())?"；上一操作确认中，勿重复执行":"")+"。下一步："+next);
    }
    private void classes(Player p,UnifiedPlayer state,BridgeRules.Request r){
        switch(r.action()){
            case "status"->{noArgs(r);String id=vortex.classSkillService().selectedClassDefinition(state).map(c->c.id()).orElse("none");emit(p,r,Map.of("class",id,"queryOnly",true),id.equals("none")?"尚未选职。下一步：/mycli profession list":BridgeRules.className(id)+"；技能：/mycli skills status");}
            case "menu"->{noArgs(r);vortex.classSkillService().openClassMenu(p,state);if(r.json())emit(p,r,Map.of("requestedMenu","profession","selectionConfirmed",false,"nextCommand","/mycli profession status"),"已请求打开职业菜单；尚未选择。");}
            case "list"->{noArgs(r);var ids=vortex.classSkillService().registeredClassIds();emit(p,r,Map.of("classes",ids),String.join("；",ids.stream().map(id->id+" "+BridgeRules.className(id)).toList())+"。详情：/mycli profession info <ID>");}
            case "info"->{String id=BridgeRules.id(r);var d=vortex.classSkillService().classProfile(id).orElseThrow(()->new IllegalArgumentException("[unknown_class] 未知职业 "+id+"；未执行。下一步：/mycli profession list"));emit(p,r,Map.of("id",id,"starterSpell",d.starterSpellId(),"queryOnly",true),BridgeRules.className(id)+"；起始技能 "+d.starterSpellId()+"。主动选择：/mycli profession choose "+id);}
            case "choose"->{String id=BridgeRules.id(r);if(vortex.classSkillService().classProfile(id).isEmpty())throw new IllegalArgumentException("[unknown_class] 未知职业 "+id+"；未执行。下一步：/mycli profession list");write(p,r,()->vortex.classSkillService().chooseClass(p,state,id),true,"职业已选择并保存。下一步：/mycli skills list");}
            default->throw new IllegalArgumentException("class 仅 list/info/choose；查询不自动选职。");
        }
    }
    private boolean skillFailure(Player p,UnifiedPlayer state,BridgeRules.Request r){
        if(!(r.group().equals("cast")||r.group().equals("skills")&&Set.of("info","explain","status","learn","prepare","equip").contains(r.action()))||r.arguments().size()!=1)return false;
        String id=r.arguments().getFirst();
        if(SkillTransition.COMMON.contains(id))return false;
        boolean spell=vortex.spellbookService().editorSpellSnapshots().stream().anyMatch(s->s.id().equals(id));
        boolean node=vortex.classSkillService().skillsFor(state).stream().anyMatch(s->s.id().equals(id))
            ||vortex.classSkillService().selectedClass(state).flatMap(c->vortex.qiandengjiTalents().registry().find(c)).flatMap(t->t.find(id)).isPresent();
        boolean executing=r.group().equals("cast")||Set.of("prepare","equip").contains(r.action());
        if(executing&&node&&!spell){emit(p,r,Map.of("success",false,"reason","skill_node_not_castable","skill",id,"nextCommand","/mycli skills info "+id,"changed",false),"[skill_node_not_castable] "+id+" 是学习/天赋节点，不能当作施法ID；不扣魔力。查看对应主动技能：/mycli skills info "+id);return true;}
        if(executing&&spell&&!vortex.spellbookService().availableSpells(state).contains(id)){
            boolean chosen=vortex.classSkillService().hasClass(state);String next=chosen?"/mycli skills info "+id:"/mycli profession list";
            emit(p,r,Map.of("success",false,"reason",chosen?"skill_locked":"class_required","skill",id,"nextCommand",next,"changed",false),"["+(chosen?"skill_locked":"class_required")+"] "+id+(chosen?" 尚未满足本职/等级/学习条件；":" 需要先选择职业；")+"未施法、不扣魔力。下一步："+next);return true;
        }
        if(spell||node)return false;
        boolean chosen=vortex.classSkillService().hasClass(state);String next=SkillTransition.next(chosen);
        emit(p,r,Map.of("success",false,"reason",SkillTransition.reason(id),"skill",id,"nextCommand",next,"changed",false),SkillTransition.message(id,chosen));return true;
    }
    private void skills(Player p,UnifiedPlayer state,BridgeRules.Request r){
        if(Set.of("explain","status").contains(r.action())&&r.arguments().size()==1){skills(p,state,new BridgeRules.Request(r.group(),"info",r.arguments(),r.json(),r.help()));return;}
        if(r.action().equals("list")&&r.arguments().equals(List.of("common"))){emit(p,r,Map.of("common",SkillTransition.COMMON,"queryOnly",true),"基础：home归乡、selfheal圣愈、food饱食、blink闪现、starbolt星芒箭、frostnova寒霜、give造物；其他通用：travel/prospect/night/feather。无需选职或学习，耗魔与冷却按详情。详情：/mycli skills info <ID>");return;}
        switch(r.action()){
            case "tree"->{noArgs(r);var tree=vortex.classSkillService().selectedClass(state).flatMap(c->vortex.qiandengjiTalents().registry().find(c)).orElseThrow(()->new IllegalArgumentException("先选择职业；/mycli profession list"));
                async(p,r,vortex.qiandengjiTalents().talentData(p.getUniqueId()).thenApply(data->Map.<String,Object>of("talentPoints",data.talentPoints(),"allocated",data.allocatedNodes(),"nodes",tree.nodes(),"summary","天赋点 "+data.talentPoints()+"；"+String.join("、",tree.nodes().values().stream().map(n->n.id()+" "+n.displayName()+"("+n.cost()+"点)").toList())+"。查看条件：/mycli skills info <ID>")),"天赋资料暂不可用");}
            case "menu"->{noArgs(r);vortex.classSkillService().openSkillMenu(p,state);if(r.json())emit(p,r,Map.of("requestedMenu","skills","learningConfirmed",false,"nextCommand","/mycli skills status"),"已请求打开技能菜单；尚未学习。");}
            case "list", "status", "mine", "points"->{noArgs(r);var ids=vortex.spellbookService().availableSpells(state);var learnable=vortex.classSkillService().skillsFor(state).stream().filter(k->!vortex.classSkillService().unlockedSkillIds(state).contains(k.id())).toList();
                String active=vortex.spellbookService().activeSpellId(state).orElse("");
                emit(p,r,Map.of("available",ids,"common",SkillTransition.COMMON,"learnable",learnable,"skillPoints",vortex.classSkillService().unspentSkillPoints(state),"activeSpell",active),
                    "基础：home/selfheal/food/blink/starbolt/frostnova/give；其他通用：travel/prospect/night/feather；职业可用："+String.join("、",ids)+"；当前点击技 "+(active.isEmpty()?"未设置":active)+"；学习点 "+vortex.classSkillService().unspentSkillPoints(state)+"；可学："+String.join("、",learnable.stream().map(k->k.id()+"("+k.cost()+"点,Lv"+k.requiredLevel()+")").toList())+"。详情：/mycli skills info <ID>");}
            case "prepare", "equip"->{String id=BridgeRules.id(r);if(SkillTransition.COMMON.contains(id)){emit(p,r,Map.of("success",false,"reason","common_direct_cast","changed",false,"nextCommand","/mycli skills info "+id),"基础通用技直接施放或用原法杖绑定；无需学习，也不占职业点击技。下一步：/mycli skills info "+id);return;}write(p,r,()->{vortex.spellbookService().setActiveSpell(state,id);return CompletableFuture.completedFuture(null);},true,"已设置点击技能并保存；施放：/mycli cast "+id);}
            case "info"->{String id=BridgeRules.id(r);
                var node=vortex.classSkillService().skillsFor(state).stream().filter(k->k.id().equals(id)).findFirst();
                if(node.isPresent()){
                    var k=node.get();boolean learned=vortex.classSkillService().unlockedSkillIds(state).contains(id);String granted=k.grantedSpellId();
                    int points=vortex.classSkillService().unspentSkillPoints(state);
                    var out=new LinkedHashMap<String,Object>();out.put("skill",k);out.put("learned",learned);out.put("queryOnly",true);out.put("playerLevel",state.level());out.put("skillPoints",points);
                    String next=learned?"/mycli skills list":state.level()<k.requiredLevel()||points<k.cost()?"/mycli tasks list":"/mycli skills learn "+id;
                    String text=k.displayName()+"；"+(learned?"已学会":"需要Lv"+k.requiredLevel()+"、"+k.cost()+"学习点；当前Lv"+state.level()+"、"+points+"点")+"；"+k.description();
                    if(granted!=null&&!granted.isBlank()){
                        var spell=vortex.spellbookService().editorSpellSnapshots().stream().filter(s->s.id().equals(granted)).findFirst();
                        out.put("grantedSpellId",granted);out.put("available",vortex.spellbookService().availableSpells(state).contains(granted));
                        if(spell.isPresent()){var s=spell.get();out.put("definition",s);text+="；主动技 "+granted+"，消耗 "+io.vortexcore.combat.ManaGate.cost(vortex,granted)+"魔力，冷却 "+s.cooldownMillis()/1000.0+"秒；目标："+SkillTransition.targets(s.targeters())+"；效果："+SkillTransition.effects(s.mechanics());}
                        if(learned)next="/mycli cast "+granted;
                    }else text+="；被动常驻，学会后自动生效，无需prepare或cast";
                    out.put("nextCommand",next);emit(p,r,out,text+"。下一步："+next);return;
                }
                if(SkillTransition.COMMON.contains(id)){emit(p,r,Map.of("id",id,"common",true,"available",true,"learned",true),"通用技能已可用，无需选职、学习或花点；原效果与安全检查保留。施放：/mycli cast "+id);return;}
                var talent=vortex.classSkillService().selectedClass(state).flatMap(c->vortex.qiandengjiTalents().registry().find(c)).flatMap(tree->tree.find(id));
                if(talent.isPresent()){var n=talent.get();String classId=vortex.classSkillService().selectedClassDefinition(state).orElseThrow().id();async(p,r,vortex.qiandengjiTalents().talentData(p.getUniqueId()).thenApply(data->{boolean learned=data.allocatedNodes().entrySet().stream().anyMatch(e->e.getKey().toString().equalsIgnoreCase(classId)&&e.getValue().contains(id));String next=learned?"/mycli skills tree":"/mycli skills learn "+id;return Map.<String,Object>of("talent",n,"queryOnly",true,"learned",learned,"talentPoints",data.talentPoints(),"nextCommand",next,"summary",n.displayName()+"；"+(learned?"已学会，自动生效":"消耗 "+n.cost()+"天赋点，当前 "+data.talentPoints())+"；前置 "+(n.prerequisites().isEmpty()?"无":String.join("、",n.prerequisites()))+"；"+n.description()+"。被动天赋无需施放。下一步："+next);}),"天赋资料暂不可用");return;}
                var spell=vortex.spellbookService().editorSpellSnapshots().stream().filter(s->s.id().equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("未知技能"));
                boolean available=vortex.spellbookService().availableSpells(state).contains(id);String next="/mycli cast "+id,condition="已可用";
                if(!available){
                    if(!vortex.classSkillService().hasClass(state)){condition="尚未选择职业";next="/mycli profession list";}
                    else if(!spell.requiredClasses().isEmpty()&&!spell.requiredClasses().contains(vortex.classSkillService().selectedClass(state).orElseThrow().commandId())){condition="不属于本人职业，需要 "+String.join("/",spell.requiredClasses());next="/mycli skills list";}
                    else if(state.level()<spell.minLevel()){condition="尚未达到Lv"+spell.minLevel();next="/mycli tasks list";}
                    else{condition="尚未学习对应节点";next=vortex.classSkillService().skillsFor(state).stream().filter(k->id.equals(k.grantedSpellId())).map(k->"/mycli skills info "+k.id()).findFirst().orElse("/mycli skills list");}
                }
                var out=new LinkedHashMap<String,Object>();out.put("id",id);out.put("available",available);out.put("queryOnly",true);out.put("definition",spell);out.put("nextCommand",next);
                if(!FortifyDefence.effects(id).isEmpty())out.put("serverEffects",FortifyDefence.effects(id));
                emit(p,r,out,vortex.spellbookService().spellLabel(id)+"；"+condition+"；需要Lv"+spell.minLevel()+"；消耗 "+io.vortexcore.combat.ManaGate.cost(vortex,id)+"魔力；冷却 "+spell.cooldownMillis()/1000.0+"秒；目标："+SkillTransition.targets(spell.targeters())+"；效果："+SkillTransition.effects(spell.mechanics())+FortifyDefence.description(id)+"。下一步："+next);}
            case "learn"->{String id=BridgeRules.id(r);
                if(SkillTransition.COMMON.contains(id)){emit(p,r,Map.of("id",id,"common",true,"learned",true,"changed",false),"通用技能已可用，无需重复学习或花点。施放：/mycli cast "+id);return;}
                if(vortex.classSkillService().skillsFor(state).stream().noneMatch(k->k.id().equals(id))&&vortex.classSkillService().selectedClass(state).flatMap(c->vortex.qiandengjiTalents().registry().find(c)).flatMap(tree->tree.find(id)).isPresent()){
                    write(p,r,()->vortex.qiandengjiTalents().allocateNode(p,id).thenAccept(result->{if(!result.success())throw new IllegalStateException(result.message());}),true,"天赋已学习并保存；查询：/mycli skills tree");return;}
                write(p,r,()->vortex.classSkillService().unlockSkill(p,state,id).thenAccept(result->{if(!result.success())throw new IllegalStateException(result.message());}),true,"技能已学习并保存；查询：/mycli skills list");}
            default->throw new IllegalArgumentException("skills list/info/learn/prepare/menu；不再使用旧升级或准备槽系统。查询：/mycli skills list");
        }
    }
    private void quests(Player p,BridgeRules.Request r){
        switch(r.action()){
            case "list"->{noArgs(r);int level=profile(p).level();async(p,r,quests.questData(p.getUniqueId()).thenApply(data->{
                var rank=List.of("ready_to_claim","active","available","level_required","prerequisite_required","cooldown","completed");
                var defs=quests.registry().all().values().stream().sorted(Comparator.<QuestDefinition>comparingInt(q->rank.indexOf(RpgJourney.availability(q,data,level))).thenComparingInt(QuestDefinition::requiredLevel).thenComparingInt(q->q.objectives().stream().mapToInt(QuestObjectiveDefinition::amount).sum()).thenComparing(QuestDefinition::id)).toList();
                var shown=BridgeRules.page(defs,r);var out=new LinkedHashMap<String,Object>(BridgeRules.pagination(defs.size(),r));out.put("quests",shown);out.put("queryOnly",true);
                out.put("states",shown.stream().map(q->Map.of("id",q.id(),"state",RpgJourney.availability(q,data,level))).toList());
                out.put("summary","[任务 "+r.page()+"/"+BridgeRules.pages(defs.size())+"] "+String.join("；",shown.stream().map(q->q.id()+" "+q.name()+"["+RpgJourney.label(RpgJourney.availability(q,data,level))+"]").toList())+"。任选讨伐/巡访/制作，详情：/mycli tasks info <ID>"+BridgeRules.nextPage(defs.size(),r));return out;
            }),"任务列表暂不可用，不根据空结果重接任务。");}
            case "info"->{String id=BridgeRules.id(r);var q=quest(id);int level=profile(p).level();async(p,r,quests.questData(p.getUniqueId()).thenApply(data->Map.<String,Object>of("quest",q,"queryOnly",true,"state",RpgJourney.availability(q,data,level),"nextCommand",QuestText.nextCommand(q,data,level),"summary",QuestText.info(q,data,level))),"任务详情暂不可用，不重复接取。");}
            case "status"->{String focus=r.arguments().isEmpty()?null:BridgeRules.id(r);if(focus!=null)quest(focus);async(p,r,quests.questData(p.getUniqueId()).thenApply(data->{
                if(focus!=null){var progress=data.quests().get(focus);int awaiting=quests.qiandengjiPendingRewards(p.getUniqueId());String summary=progress==null?focus+"："+(data.completedQuestLog().contains(focus)?"已交付；下一步：/mycli tasks list":"未接取；先读条件：/mycli tasks info "+focus):QuestText.progress(quest(focus),progress);if(awaiting>0)summary+="；有 "+awaiting+"笔奖励待核对，勿重复领取，请联系服主。";return Map.<String,Object>of("id",focus,"summary",summary,"pendingRewardCount",awaiting,"queryOnly",true);}
                var active=data.quests().values().stream().filter(v->v.state()==QuestState.ACTIVE).sorted(Comparator.comparing(QuestProgress::questId)).toList();
                var shown=BridgeRules.page(active,r);
                var lines=shown.stream().map(v->quests.registry().find(v.questId()).map(q->QuestText.progress(q,v)).orElse(v.questId()+"：任务定义暂不可用，勿重复接取")).toList();
                String summary=active.isEmpty()?"当前没有进行中的任务。选择冒险：/mycli tasks list":String.join("；",lines)+BridgeRules.nextPage(active.size(),r);
                if(!data.completedQuestLog().isEmpty())summary+="；已交付 "+data.completedQuestLog().size()+"项";
                int awaiting=quests.qiandengjiPendingRewards(p.getUniqueId());
                if(awaiting>0)summary+="；有 "+awaiting+"笔奖励待核对，勿重复领取，请联系服主。";
                var out=new LinkedHashMap<String,Object>(BridgeRules.pagination(active.size(),r));out.put("quests",shown);out.put("activeCount",active.size());out.put("completedCount",data.completedQuestLog().size());out.put("pendingRewardCount",awaiting);out.put("summary",summary);out.put("queryOnly",true);return out;
            }),"查询暂不可用；不要重复接取。");}
            case "accept"->{String id=BridgeRules.id(r);quest(id);write(p,r,()->quests.startQuest(p,id).thenAccept(result->{if(!result.success())throw new IllegalStateException(result.message());}),false,"任务已接取并保存；查询：/mycli tasks status");}
            case "claim"->{String id=BridgeRules.id(r);quest(id);write(p,r,()->quests.completeQuest(p,id).thenAccept(ok->{if(!ok)throw new IllegalStateException("目标未完成、已领取或当前不能交付；查询：/mycli tasks status");}),false,"任务已交付，奖励已确认；查询：/mycli tasks status");}
            default->throw new IllegalArgumentException("quests 仅 list/info/status/accept/claim。");
        }
    }
    private QuestDefinition quest(String id){return quests.registry().find(id).orElseThrow(()->new IllegalArgumentException("[unknown_task] 未知任务 "+id+"；未执行。下一步：/mycli tasks list"));}
    private ItemStack offerItem(ConfigurationSection c){String id=c.getString("vortex-item");return id!=null?items.create(id,c.getInt("amount",1)):new ItemStack(Objects.requireNonNull(Material.matchMaterial(c.getString("material",""))),c.getInt("amount",1));}
    private void validateShops(){var shops=getConfig().getConfigurationSection("shops");if(shops==null)return;for(String id:shops.getKeys(false)){var offers=shops.getConfigurationSection(id+".offers");if(offers==null)throw new IllegalStateException("商店无商品");for(String offer:offers.getKeys(false)){var c=offers.getConfigurationSection(offer);if(c.getInt("emeralds")<1||c.getInt("emeralds")>64||c.getInt("amount")<1||c.getInt("amount")>64)throw new IllegalStateException("商品数量无效");offerItem(c);}}}
    private void shop(Player p,BridgeRules.Request r){
        var shops=getConfig().getConfigurationSection("shops");
        if(r.action().equals("list")){noArgs(r);emit(p,r,Map.of("shops",shops.getKeys(false)),String.join("、",shops.getKeys(false))+"。详情：/mycli trade info <ID>");return;}
        String id=BridgeRules.id(r);var c=shops.getConfigurationSection(id);if(c==null)throw new IllegalArgumentException("未知商店");var offers=c.getConfigurationSection("offers");
        if(r.action().equals("info")){var rows=offers.getKeys(false).stream().map(k->Map.<String,Object>of("id",k,"item",offers.getString(k+".vortex-item",offers.getString(k+".material","")),"amount",offers.getInt(k+".amount"),"emeralds",offers.getInt(k+".emeralds"))).toList();emit(p,r,Map.of("id",id,"offers",rows,"currency","emerald","queryOnly",true),c.getString("name")+"；"+String.join("；",offers.getKeys(false).stream().map(k->k+"×"+offers.getInt(k+".amount")+" / "+offers.getInt(k+".emeralds")+"绿宝石").toList())+"。交易：/mycli trade open "+id);return;}
        if(!r.action().equals("open"))throw new IllegalArgumentException("shop 仅 list/info/open；交易沿用原版村民窗口协议。");
        if(p.getItemOnCursor()!=null&&!p.getItemOnCursor().getType().isAir())throw new IllegalArgumentException("请先清空光标物品再打开交易。");
        Merchant merchant=Bukkit.createMerchant(c.getString("name"));List<MerchantRecipe> recipes=new ArrayList<>();
        for(String key:offers.getKeys(false)){var item=offers.getConfigurationSection(key);var recipe=new MerchantRecipe(offerItem(item),0,999999,false);recipe.addIngredient(new ItemStack(Material.EMERALD,item.getInt("emeralds")));recipes.add(recipe);}
        merchant.setRecipes(recipes);p.openMerchant(merchant,true);
        emit(p,r,Map.of("opened",true,"currency","emerald","purchaseConfirmed",false),"已打开原版交易窗口；尚未购买。按窗口报价交易，库存确认后再继续。");
    }
    private void town(Player p,BridgeRules.Request r){var facilities=city.getConfigurationSection("facilities");if(r.action().equals("list")){noArgs(r);var ids=facilities.getKeys(false);emit(p,r,Map.of("state","surveyed_not_operating","world","aincrad","facilities",ids),"起始之城："+String.join("、",ids.stream().map(id->facilities.getString(id+".name")).toList())+"。建筑已勘察，设施未开业；详情：/mycli waypoint info <ID>");return;}if(!r.action().equals("info"))throw new IllegalArgumentException("town 仅 list/info，查询不会传送或建造。");String id=BridgeRules.id(r);var c=facilities.getConfigurationSection(id);if(c==null)throw new IllegalArgumentException("未知设施");emit(p,r,Map.of("id",id,"world","aincrad","entrance",c.getIntegerList("entrance"),"function",c.getString("function"),"state","surveyed_not_operating"),c.getString("name")+"；aincrad入口 "+c.getIntegerList("entrance")+"；用途："+c.getString("function")+"。尚未开业，不会自动接任务。");}
    private void help(Player p,BridgeRules.Request r){String text=switch(r.group()){case "class"->"profession list/info <ID>/choose <ID>/menu：查询只读；choose选择一次并授予原生初始装备。";case "skills"->"skills list/info <ID>/learn <ID>/prepare <法术ID>/tree/menu：learn花学习点或天赋点，详情会注明；被动不能cast。施放：/mycli cast <法术ID>";case "quests"->"tasks list/info <ID>/status/accept <ID>/claim <ID>：查询只读；接取和领奖需主动执行。旧探索委托：/mycli guild status。";case "shop"->"shop list/info <ID>/open <ID>：预览商店用绿宝石；打开不购买。正式交易沿用 /mycli trade --help。";default->"先查 /mycli status。RPG：profession、skills、cast、tasks；按需 /mycli <分组> --help。考试与声望：/mycli progress；副本：/mycli dungeon list。个人箱：/mycli arena stash；公共补给：/mycli guild shared。默认短文本，可选 --json。";};emit(p,r,Map.of("help",text,"queryOnly",true),text);}
    private static void noArgs(BridgeRules.Request r){if(!r.arguments().isEmpty())throw new IllegalArgumentException("此查询无额外参数");}
    private void write(Player p,BridgeRules.Request r,java.util.function.Supplier<CompletableFuture<Void>> operation,boolean save,String success){
        if(!io.vortexcore.combat.PlayerStateGate.allowed(p))throw new IllegalStateException("当前状态不能执行；请先等待救援或使用对应生存角色。查询：/mycli status");
        if(!pending.add(p.getUniqueId()))throw new IllegalStateException("上一操作仍在确认，请稍后查询；不要重复执行。");
        try{CompletableFuture<Void> f=operation.get();if(save)f=f.thenCompose(ignored->vortex.playerProfileService().qiandengjiSave(p).thenApply(snapshot->null));
            f.whenComplete((ignored,error)->Bukkit.getScheduler().runTask(this,()->{pending.remove(p.getUniqueId());if(!p.isOnline())return;if(error!=null){failure(p,r,error);return;}boolean durable=save||r.group().equals("quests");emit(p,r,Map.of("success",true,"saved",durable,"saveState",durable?"saved":"not_applicable","reason","completed","message",success),success);}));
        }catch(Exception|LinkageError error){pending.remove(p.getUniqueId());throw error;}
    }
    private void async(Player p,BridgeRules.Request r,CompletableFuture<Map<String,Object>> f,String text){f.whenComplete((data,error)->Bukkit.getScheduler().runTask(this,()->{if(p.isOnline()){if(error!=null)failure(p,r,error);else emit(p,r,data,String.valueOf(data.getOrDefault("summary",text)));}}));}
    private void failure(Player p,BridgeRules.Request r,Throwable error){var advice=RpgFailure.describe(error,r);if(advice.reason().equals("service_unavailable"))getLogger().warning("RPG "+r.group()+"/"+r.action()+" failed: "+error.getClass().getSimpleName());emit(p,r,advice.data(),advice.text());}
    private static String safeError(Throwable error){while(error.getCause()!=null)error=error.getCause();String s=error.getMessage();if(s==null)return "操作失败；先查 status，勿自动重试。";if(s.startsWith("Spell is on cooldown"))return "技能正在冷却，请等待后查询，不要反复施放。";if(s.startsWith("Class already selected"))return "已有职业；此操作不会重置职业和装备。";if(s.startsWith("Revision conflict"))return "保存版本冲突，结果待确认；先查 status，勿自动重试。";return s.length()>180?s.substring(0,180):s;}
    private void emit(Player p,BridgeRules.Request r,Map<String,?> data,String text){if(r.json())p.sendMessage("MC_RPG "+gson.toJson(data));else p.sendMessage("[RPG] "+text);}
}
