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
    private final Set<UUID> pending=ConcurrentHashMap.newKeySet();
    private final Gson gson=new GsonBuilder().registerTypeAdapter(Instant.class,(JsonSerializer<Instant>)(value,type,context)->new JsonPrimitive(value.toString())).create();
    @Override public void onEnable(){
        saveDefaultConfig();
        if(!new java.io.File(getDataFolder(),"city-facilities.yml").exists())saveResource("city-facilities.yml",false);
        city=YamlConfiguration.loadConfiguration(new java.io.File(getDataFolder(),"city-facilities.yml"));
        // A preview must never silently add a second combat/stat authority.
        // Production migration needs an explicitly reviewed AgentFriend handoff.
        if(Bukkit.getPluginManager().isPluginEnabled("AgentFriend")){
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
            validateShops();getLogger().info("Vortex精炼CLI就绪；独立预览，不迁移正式玩家。");
        }catch(Exception|LinkageError error){
            getLogger().severe("Vortex适配不可用："+error.getClass().getSimpleName());
            if(vortex!=null)Bukkit.getPluginManager().disablePlugin(vortex);
            Bukkit.getPluginManager().disablePlugin(this);
        }
    }
    private UnifiedPlayer profile(Player p){
        if(vortex.playerProfileService().qiandengjiLoading(p.getUniqueId()))throw new IllegalStateException("角色资料仍在加载，请稍后查询 status；不要重复执行。");
        return vortex.playerProfileService().profile(p.getUniqueId()).orElseThrow(()->new IllegalStateException("角色资料尚不可用，请稍后查询 status。"));
    }
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] raw){
        if(!(sender instanceof Player p)){sender.sendMessage("此入口只操作本人角色。");return true;}
        BridgeRules.Request r;
        try{r=BridgeRules.parse(raw);}catch(IllegalArgumentException e){p.sendMessage("[RPG] "+e.getMessage());return true;}
        try{
            if(r.help()){help(p,r);return true;}
            if(!getConfig().getStringList("allowed-worlds").contains(p.getWorld().getName()))throw new IllegalArgumentException("当前世界未开放Vortex预览。");
            var state=profile(p);
            switch(r.group()){
                case "status"->emit(p,r,Map.of("authority","VortexRPG","class",vortex.classSkillService().selectedClassDefinition(state).map(c->c.id()).orElse("none"),"level",state.level(),"xp",state.experience(),"nextLevelXp",vortex.playerProfileService().experienceToNextLevel(state),"mana",Math.round(mana.getMana(p.getUniqueId())),"maxMana",Math.round(mana.getMaxMana(p)),"preview",true),"职业 "+vortex.classSkillService().selectedClassDefinition(state).map(c->BridgeRules.className(c.id())).orElse("未选择")+"；战斗Lv."+state.level()+"；距升级 "+vortex.playerProfileService().experienceToNextLevel(state)+"；魔力 "+Math.round(mana.getMana(p.getUniqueId()))+"/"+Math.round(mana.getMaxMana(p))+"。下一步：/mycli "+(vortex.classSkillService().hasClass(state)?"skills status":"profession list"));
                case "class"->classes(p,state,r);
                case "skills"->skills(p,state,r);
                case "cast"->{String id=BridgeRules.id(r);write(p,r,()->vortex.spellbookService().cast(p,state,id),false,"技能已执行；效果以现场和 status 为准。");}
                case "quests"->quests(p,r);
                case "shop"->shop(p,r);
                case "town"->town(p,r);
                default->throw new IllegalArgumentException("查看 /mycli --help");
            }
        }catch(Exception e){emit(p,r,Map.of("success",false,"reason","unavailable","message",safeError(e)),safeError(e));}
        return true;
    }
    private void classes(Player p,UnifiedPlayer state,BridgeRules.Request r){
        switch(r.action()){
            case "status"->{noArgs(r);String id=vortex.classSkillService().selectedClassDefinition(state).map(c->c.id()).orElse("none");emit(p,r,Map.of("class",id,"queryOnly",true),id.equals("none")?"尚未选职。下一步：/mycli profession list":BridgeRules.className(id)+"；技能：/mycli skills status");}
            case "list"->{noArgs(r);var ids=vortex.classSkillService().registeredClassIds();emit(p,r,Map.of("classes",ids),String.join("；",ids.stream().map(id->id+" "+BridgeRules.className(id)).toList())+"。详情：/mycli profession info <ID>");}
            case "info"->{String id=BridgeRules.id(r);var d=vortex.classSkillService().classProfile(id).orElseThrow(()->new IllegalArgumentException("未知职业"));emit(p,r,Map.of("id",id,"starterSpell",d.starterSpellId(),"queryOnly",true),BridgeRules.className(id)+"；起始技能 "+d.starterSpellId()+"。主动选择：/mycli profession choose "+id);}
            case "choose"->{String id=BridgeRules.id(r);if(vortex.classSkillService().classProfile(id).isEmpty())throw new IllegalArgumentException("未知职业");write(p,r,()->vortex.classSkillService().chooseClass(p,state,id),true,"职业已选择并保存。下一步：/mycli skills list");}
            default->throw new IllegalArgumentException("class 仅 list/info/choose；查询不自动选职。");
        }
    }
    private void skills(Player p,UnifiedPlayer state,BridgeRules.Request r){
        switch(r.action()){
            case "list", "status"->{noArgs(r);var ids=vortex.spellbookService().availableSpells(state);emit(p,r,Map.of("available",ids,"skillPoints",vortex.classSkillService().unspentSkillPoints(state)),"可用技："+String.join("、",ids)+"；学习点 "+vortex.classSkillService().unspentSkillPoints(state)+"。详情：/mycli skills info <ID>");}
            case "info"->{String id=BridgeRules.id(r);var spell=vortex.spellbookService().editorSpellSnapshots().stream().filter(s->s.id().equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("未知技能"));emit(p,r,Map.of("id",id,"available",vortex.spellbookService().availableSpells(state).contains(id),"definition",spell),vortex.spellbookService().spellLabel(id)+"；"+(vortex.spellbookService().availableSpells(state).contains(id)?"已可用":"尚未解锁")+"。施放：/mycli cast "+id);}
            case "learn"->{String id=BridgeRules.id(r);write(p,r,()->vortex.classSkillService().unlockSkill(p,state,id).thenAccept(result->{if(!result.success())throw new IllegalStateException(result.message());}),true,"技能已学习并保存；查询：/mycli skills list");}
            default->throw new IllegalArgumentException("skills 仅 list/info/learn；无需准备另一个技能系统。");
        }
    }
    private void quests(Player p,BridgeRules.Request r){
        switch(r.action()){
            case "list"->{noArgs(r);var defs=quests.registry().all().values().stream().filter(q->q.id().startsWith("qd_")).toList();emit(p,r,Map.of("quests",defs),String.join("；",defs.stream().map(q->q.id()+" "+q.name()).toList())+"。详情：/mycli tasks info <ID>");}
            case "info"->{String id=BridgeRules.id(r);var q=quest(id);emit(p,r,Map.of("quest",q,"queryOnly",true),q.name()+"："+q.description()+"。主动接取：/mycli tasks accept "+id);}
            case "status"->{noArgs(r);async(p,r,quests.questData(p.getUniqueId()).thenApply(data->Map.<String,Object>of("quests",data.quests(),"completed",data.completedQuestLog())),"任务进度已查询；完成目标后主动 claim，不会自动报名。");}
            case "accept"->{String id=BridgeRules.id(r);quest(id);write(p,r,()->quests.startQuest(p,id).thenAccept(result->{if(!result.success())throw new IllegalStateException(result.message());}),false,"任务已接取并保存；查询：/mycli tasks status");}
            case "claim"->{String id=BridgeRules.id(r);quest(id);write(p,r,()->quests.completeQuest(p,id).thenAccept(ok->{if(!ok)throw new IllegalStateException("目标未完成、已领取或当前不能交付；查询 quests status。");}),false,"任务已交付；查询：/mycli tasks status");}
            default->throw new IllegalArgumentException("quests 仅 list/info/status/accept/claim。");
        }
    }
    private QuestDefinition quest(String id){if(!id.startsWith("qd_"))throw new IllegalArgumentException("此入口只列出已适配的冒险任务。");return quests.registry().find(id).orElseThrow(()->new IllegalArgumentException("未知任务"));}
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
    private void help(Player p,BridgeRules.Request r){String text=switch(r.group()){case "class"->"class list/info <ID>/choose <ID>：查询只读；choose选择一次并授予原生初始装备。";case "skills"->"skills list/info <ID>/learn <技能ID>：learn消耗原生技能点；cast <法术ID>使用原生冷却和效果。";case "quests"->"quests list/info <ID>/status/accept <ID>/claim <ID>：查询只读；接取、领奖均主动执行。";case "shop"->"shop list/info <ID>/open <ID>：报价用绿宝石；open不扣款，购买用原版交易窗口协议。";default->"沿用现有入口：status、profession、skills、cast、tasks、trade、waypoint。先查 status；/mycli <分组> --help 按需读。支持 --json。";};emit(p,r,Map.of("help",text,"queryOnly",true),text);}
    private static void noArgs(BridgeRules.Request r){if(!r.arguments().isEmpty())throw new IllegalArgumentException("此查询无额外参数");}
    private void write(Player p,BridgeRules.Request r,java.util.function.Supplier<CompletableFuture<Void>> operation,boolean save,String success){
        if(!pending.add(p.getUniqueId()))throw new IllegalStateException("上一操作仍在确认，请稍后查询；不要重复执行。");
        try{CompletableFuture<Void> f=operation.get();if(save)f=f.thenCompose(ignored->vortex.playerProfileService().qiandengjiSave(p).thenApply(snapshot->null));
            f.whenComplete((ignored,error)->Bukkit.getScheduler().runTask(this,()->{pending.remove(p.getUniqueId());if(p.isOnline())emit(p,r,Map.of("success",error==null,"saved",error==null&&save,"reason",error==null?"completed":"failed","message",error==null?success:safeError(error)),error==null?success:safeError(error));}));
        }catch(Exception error){pending.remove(p.getUniqueId());throw error;}
    }
    private void async(Player p,BridgeRules.Request r,CompletableFuture<Map<String,Object>> f,String text){f.whenComplete((data,error)->Bukkit.getScheduler().runTask(this,()->{if(p.isOnline())emit(p,r,error==null?data:Map.of("success",false,"message",safeError(error)),error==null?text:safeError(error));}));}
    private static String safeError(Throwable error){while(error.getCause()!=null)error=error.getCause();String s=error.getMessage();if(s==null)return "操作失败；先查 status，勿自动重试。";if(s.startsWith("Spell is on cooldown"))return "技能正在冷却，请等待后查询，不要反复施放。";if(s.startsWith("Class already selected"))return "已有职业；此操作不会重置职业和装备。";if(s.startsWith("Revision conflict"))return "保存版本冲突，结果待确认；先查 status，勿自动重试。";return s.length()>180?s.substring(0,180):s;}
    private void emit(Player p,BridgeRules.Request r,Map<String,?> data,String text){if(r.json())p.sendMessage("MC_RPG "+gson.toJson(data));else p.sendMessage("[RPG] "+text);}
}
