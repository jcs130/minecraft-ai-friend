package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.File;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Consumer;
import org.bukkit.*;
import org.bukkit.boss.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.server.PluginDisableEvent;
import org.bukkit.inventory.*;

/** Optional RPG presentation over the existing authoritative game ledgers.
 * Reading never enrols, chooses a route, accepts a commission or prints loot. */
final class RpgCampaign implements Listener {
    private record Menu(UUID owner,Inventory inventory,String npc,Map<Integer,String> actions) { }
    private record Frozen(String text,RpgStoryRules.Chapter chapter) { }
    private final AgentFriendPlugin plugin;
    private final File contentFile,ledgerFile;
    private final YamlConfiguration ledger=new YamlConfiguration();
    private final Map<UUID,Frozen> frozen=new HashMap<>();
    private final Map<UUID,Menu> menus=new HashMap<>();
    private final Map<UUID,BossBar> bars=new HashMap<>();
    private final RpgStoryNpcs npcs;
    private RpgStoryContent content;
    private String ledgerHash;
    RpgCampaign(AgentFriendPlugin plugin)throws Exception{
        this.plugin=plugin;contentFile=new File(plugin.getDataFolder(),"rpg-story.yml");ledgerFile=new File(plugin.getDataFolder(),"rpg-story-ledger.yml");
        if(!contentFile.exists())plugin.saveResource("rpg-story.yml",false);content=RpgStoryContent.load(contentFile);
        if(ledgerFile.exists()){if(ledgerFile.length()>16_777_216)throw new IllegalArgumentException("story ledger too large");ledger.load(ledgerFile);ledgerHash=hash(Files.readAllBytes(ledgerFile.toPath()));}
        npcs=new RpgStoryNpcs(plugin,content,(p,id)->{talk(p,id,"greeting",false);npcMenu(p,id);});
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,40L,40L);
    }
    String reload(){try{
        var next=RpgStoryContent.load(contentFile);
        var players=ledger.getConfigurationSection("players");if(players!=null)for(String uid:players.getKeys(false)){
            String text=ledger.getString("players."+uid+".active.definition","");if(text.isEmpty())continue;
            for(var stage:RpgStoryContent.thaw(text).stages())if(Set.of(RpgStoryRules.Kind.TALK,RpgStoryRules.Kind.TALK_OR_GRADUATE).contains(stage.kind())&&next.npc(stage.reference())==null)throw new IllegalArgumentException("active chapter still needs NPC "+stage.reference());
        }
        content=next;npcs.reload(next);return "success";
    }catch(Exception invalid){plugin.getLogger().warning("RPG content retained: "+invalid.getMessage());return "invalid_configuration";}}
    JsonArray places(){return npcs.places();}
    private String base(Player p){return "players."+p.getUniqueId();}
    private boolean eligible(Player p){return p.isOnline()&&!p.isDead()&&!plugin.isObserver(p)&&Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(p.getGameMode());}
    private static boolean flag(JsonObject o,String key){return o.has(key)&&!o.get(key).isJsonNull()&&o.get(key).getAsBoolean();}
    private static String string(JsonObject o,String key,String fallback){return o.has(key)&&!o.get(key).isJsonNull()?o.get(key).getAsString():fallback;}
    private RpgStoryRules.Chapter active(Player p){String text=ledger.getString(base(p)+".active.definition","");if(text.isEmpty())return null;
        Frozen old=frozen.get(p.getUniqueId());if(old!=null&&old.text.equals(text))return old.chapter;
        try{var chapter=RpgStoryContent.thaw(text);frozen.put(p.getUniqueId(),new Frozen(text,chapter));return chapter;}catch(Exception invalid){throw new IllegalStateException("已接章节记录暂不可读；保留原档，联系服主检查，不重新报名覆盖。");}}
    private Set<String> settled(Player p){var section=plugin.getConfig().getConfigurationSection("guild-players."+p.getUniqueId()+".everDone");return section==null?Set.of():Set.copyOf(section.getKeys(false));}
    private boolean completed(Player p,String id){return ledger.contains(base(p)+".completed."+id);}
    private RpgStoryRules.Facts facts(Player p,RpgStoryRules.Chapter chapter){var guide=plugin.worldLife().guideState(p);var conversations=new HashSet<String>();
        if(chapter!=null)for(var stage:chapter.stages())if(ledger.getBoolean(base(p)+".active.talks."+stage.id()))conversations.add(stage.id()+"@"+stage.reference());
        var combat=plugin.combatRpg();var floors=new HashSet<Integer>();
        // Only durable, contiguous formal clears qualify. Practice tower scores,
        // entering the map and reading a guide cannot complete a conquest chapter.
        if(combat!=null)for(int n=1;n<=combat.floor(p);n++)floors.add(n);
        return new RpgStoryRules.Facts(plugin.guild().hasJoined(p),flag(guide,"started"),flag(guide,"catalog"),flag(guide,"cast"),flag(guide,"commission"),ledger.getString(base(p)+".route",""),conversations,settled(p),
                combat!=null&&!combat.profession(p).isEmpty(),combat==null?1:combat.level(p),floors,plugin.professions().preparedCombatSkill(p));}
    private RpgStoryRules.Chapter next(Player p){return content.chapters.stream().filter(c->!completed(p,c.id())&&c.requires().stream().allMatch(id->completed(p,id))).findFirst().orElse(null);}
    private boolean sideDone(Player p,RpgStoryContent.Side side){return settled(p).containsAll(side.contracts());}
    private boolean sideAvailable(Player p,RpgStoryContent.Side side){return side.requires().stream().allMatch(id->{var prior=content.side(id);return prior!=null&&sideDone(p,prior);});}
    JsonObject state(Player p){var out=new JsonObject();out.addProperty("title",content.title);out.addProperty("enabled",content.enabled);out.addProperty("revision",content.revision);out.addProperty("enrolled",active(p)!=null);out.addProperty("route",ledger.getString(base(p)+".route",""));out.addProperty("tracking",ledger.getBoolean(base(p)+".tracking",false));
        JsonArray completed=new JsonArray();for(var c:content.chapters)if(completed(p,c.id()))completed.add(c.id());out.add("completedChapters",completed);out.addProperty("completedChapterCount",completed.size());
        var chapter=active(p);if(chapter==null){var next=next(p);out.addProperty("status",next==null?"completed":"not_started");out.addProperty("nextCommand",next==null?"/mycli world story list side":"/mycli world story start "+next.id());out.addProperty("advice",next==null?"旅途仍在继续，可以看看居民支线、自由探索和公会委托。":"下一章："+next.title()+"。查看详情不会报名；用start自愿开始。");return out;}
        var progress=RpgStoryRules.evaluate(chapter,facts(p,chapter));out.addProperty("chapter",chapter.id());out.addProperty("chapterTitle",chapter.title());out.addProperty("acceptedRevision",ledger.getInt(base(p)+".active.revision"));out.addProperty("acceptedAt",ledger.getLong(base(p)+".active.started-at"));out.addProperty("verifiedSteps",ledger.getInt(base(p)+".active.cursor"));out.addProperty("eligibleSteps",progress.completed());out.addProperty("totalSteps",progress.total());out.addProperty("status",progress.ready()?"verification_pending":"active");
        if(!progress.ready()){var stage=chapter.stages().get(progress.completed());out.addProperty("stage",stage.id());out.addProperty("stageTitle",stage.title());out.addProperty("advice",stage.description());out.addProperty("nextCommand",stage.nextCommand());var missing=new JsonArray();missing.add(stage.title());out.add("missingConditions",missing);
            if(Set.of(RpgStoryRules.Kind.TALK,RpgStoryRules.Kind.TALK_OR_GRADUATE).contains(stage.kind())){var target=npcs.view(stage.reference());if(target!=null)out.add("target",target);}}
        else{out.addProperty("advice","真实条件已齐，正在保存章节回执；保存失败不会宣布完成。");out.addProperty("nextCommand","/mycli world story status");}
        // Point to the current commission; never replace it with a suggested side quest.
        String task=plugin.getConfig().getString("guild-players."+p.getUniqueId()+".active.id","");if(!task.isEmpty()){out.addProperty("activeCommission",task);out.addProperty("commissionCommand",plugin.nativeRpgSelected()?"/mycli guild status":"/mycli tasks status");}return out;
    }
    void command(Player p,String[] raw){boolean json=Arrays.asList(raw).contains("--json");
        try{var words=new ArrayList<String>();int page=1;boolean pageSet=false;for(int i=2;i<raw.length;i++){String word=raw[i];if(word.equals("--json"))continue;if(word.equals("--page")){if(pageSet||i+1==raw.length||!raw[i+1].matches("[1-9][0-9]{0,4}"))throw new IllegalArgumentException("页码用 --page 正整数");page=Integer.parseInt(raw[++i]);pageSet=true;continue;}if(word.startsWith("--"))throw new IllegalArgumentException("未知参数："+word);words.add(word);}if(page<1)throw new IllegalArgumentException("页码必须大于零");
            String action=words.isEmpty()?"status":words.removeFirst().toLowerCase(Locale.ROOT);if(pageSet&&!action.equals("list"))throw new IllegalArgumentException("该动作不使用页码");if(action.equals("menu")&&Arrays.asList(raw).contains("--json"))throw new IllegalArgumentException("menu打开原版界面，不提供--json；使用 /mycli world story menu。");
            switch(action){
                case "status"->{require(words,0,0);emit(p,"status",state(p),true,json);}
                case "list"->{require(words,0,1);listing(p,words.isEmpty()?"chapter":words.getFirst(),page);}
                case "info"->{require(words,1,1);info(p,words.getFirst(),json);}
                case "start"->{require(words,0,1);start(p,words.isEmpty()?"":words.getFirst(),json);}
                case "cancel"->{require(words,0,0);writeAllowed(p);if(!commit(y->y.set(base(p)+".active",null)))throw new IllegalStateException("章节取消未保存；请先查询，勿重复操作。");removeBar(p.getUniqueId());emit(p,"cancel",state(p),false,json);}
                case "choose"->{require(words,1,1);choose(p,words.getFirst(),json);}
                case "track"->{require(words,0,1);writeAllowed(p);String value=words.isEmpty()?"on":words.getFirst();if(!Set.of("on","off").contains(value))throw new IllegalArgumentException("track on|off");if(!commit(y->y.set(base(p)+".tracking",value.equals("on"))))throw new IllegalStateException("追踪设置未保存");if(value.equals("off"))removeBar(p.getUniqueId());emit(p,"track",state(p),false,json);}
                case "talk"->{require(words,1,2);talk(p,words.getFirst(),words.size()==2?words.get(1):"greeting",json);}
                case "menu"->{require(words,0,1);if(words.isEmpty())journalMenu(p);else npcMenu(p,words.getFirst());}
                default->throw new IllegalArgumentException("world story status|list [chapter|npc|side]|info <ID>|start [章节]|choose <路线>|talk <NPC> [话题]|track on|off|cancel|menu");
            }
        }catch(IllegalArgumentException|IllegalStateException invalid){plugin.communication().error(p,"STORY_ACTION_DENIED",invalid.getMessage(),false,"/mycli world story status");}}
    private static void require(List<String> words,int min,int max){if(words.size()<min||words.size()>max)throw new IllegalArgumentException("参数数量不对；/mycli world story --help 查看用法。");}
    private void writeAllowed(Player p){if(!content.enabled)throw new IllegalStateException("剧情暂未开放；现有公会、技能与委托仍可使用。");if(!eligible(p))throw new IllegalStateException("请在已登录、生存或冒险角色的连接上进行剧情；观战连接可以查询。");}
    private void emit(Player p,String type,JsonObject out,boolean readOnly,boolean json){out.addProperty("schemaVersion",1);out.addProperty("type",type);out.addProperty("scope","self");out.addProperty("playerUuid",p.getUniqueId().toString());out.addProperty("readOnly",readOnly);plugin.communication().stamp(p,out);
        if(!json){p.sendMessage("§6【千灯纪 · "+content.title+"】"+string(out,"chapterTitle",string(out,"title","旅途手记")));if(out.has("advice"))p.sendMessage("§f"+out.get("advice").getAsString());
            JsonObject target=out.has("target")&&out.get("target").isJsonObject()?out.getAsJsonObject("target"):out;
            if(target.has("world")&&target.has("x")&&target.has("y")&&target.has("z"))p.sendMessage("§7"+string(target,"name","目标")+"："+target.get("world").getAsString()+" ("+target.get("x").getAsInt()+", "+target.get("y").getAsInt()+", "+target.get("z").getAsInt()+")，"+(flag(target,"loaded")?"走到8格内交谈。":"登记位置，走近后重查；不要挖掘寻找。"));
            if(out.has("nextCommand"))p.sendMessage("§e下一步 "+out.get("nextCommand").getAsString());}else p.sendMessage("MC_STORY "+out);}
    private void start(Player p,String id,boolean json){writeAllowed(p);var current=active(p);if(current!=null){if(!id.isEmpty()&&!current.id().equals(id))throw new IllegalStateException("当前章节仍在进行，先继续或取消剧情追踪；不会放弃你的公会委托。");emit(p,"start",state(p),false,json);return;}
        var chosen=id.isEmpty()?next(p):content.chapter(id);if(chosen==null)throw new IllegalArgumentException("暂无该章节，先 story list 查目录。");if(completed(p,chosen.id())){emit(p,"start",state(p),false,json);return;}if(chosen.requires().stream().anyMatch(prior->!completed(p,prior)))throw new IllegalStateException("先完成前置章节："+String.join("、",chosen.requires()));
        long now=System.currentTimeMillis();if(!commit(y->{String b=base(p)+".active.";y.set(b+"definition",RpgStoryContent.freeze(chosen));y.set(b+"revision",content.revision);y.set(b+"started-at",now);y.set(b+"cursor",0);y.set(base(p)+".tracking",true);} ))throw new IllegalStateException("章节报名未保存；原任务保持，请查询后再决定。");refresh(p,false);emit(p,"start",state(p),false,json);}
    private void choose(Player p,String route,boolean json){writeAllowed(p);if(!RpgStoryRules.ROUTES.contains(route))throw new IllegalArgumentException("路线为combat/crafting/exploration/supply/engineering/life；这是旅途偏好，不代选职业或接单。");if(!commit(y->y.set(base(p)+".route",route)))throw new IllegalStateException("路线偏好未保存");refresh(p,false);var out=state(p);out.addProperty("nextCommand","/mycli tasks list "+route);out.addProperty("advice","已记下你的旅途偏好。当前委托继续保留；先看实际条件，再自行接单。");emit(p,"choose",out,false,json);}
    private void info(Player p,String id,boolean json){var chapter=content.chapter(id);if(chapter!=null){var current=active(p);if(current!=null&&current.id().equals(id))chapter=current;
            var rows=new ArrayList<JsonObject>();for(var s:chapter.stages()){var j=new JsonObject();j.addProperty("id",s.id());j.addProperty("title",s.title());j.addProperty("description",s.description());j.addProperty("nextCommand",s.nextCommand());rows.add(j);}plugin.communication().list(p,"story_chapter","/mycli world story info "+id,rows,1);return;}
        var npc=content.npc(id);if(npc!=null){var out=npcs.view(id);out.addProperty("greeting",npc.greeting());var topics=new JsonArray();for(var t:npc.topics()){var j=new JsonObject();j.addProperty("id",t.id());j.addProperty("title",t.title());j.addProperty("nextCommand","/mycli world story talk "+id+" "+t.id());topics.add(j);}out.add("topics",topics);out.addProperty("advice","走到人物8格内交谈；查询人物资料不会记入剧情。");emit(p,"npc",out,true,json);return;}
        var side=content.side(id);if(side!=null){var out=new JsonObject();out.addProperty("title",side.title());out.addProperty("advice",side.introduction());out.addProperty("available",sideAvailable(p,side));out.addProperty("completed",sideDone(p,side));out.addProperty("npc",side.npc());var contracts=new JsonArray();for(String task:side.contracts())contracts.add(task);out.add("contracts",contracts);out.addProperty("nextCommand","/mycli tasks info "+side.contracts().getFirst());emit(p,"side",out,true,json);return;}throw new IllegalArgumentException("未知剧情、人物或支线ID；先 story list。");}
    private void listing(Player p,String kind,int page){if(kind.equals("ranking")){if(plugin.combatRpg()==null)throw new IllegalStateException("战斗成长不可用");plugin.combatRpg().rankings(p);return;}var rows=new ArrayList<JsonObject>();switch(kind){case "chapter"->{for(var c:content.chapters){var j=new JsonObject();j.addProperty("id",c.id());j.addProperty("title",c.title());j.addProperty("completed",completed(p,c.id()));j.addProperty("available",c.requires().stream().allMatch(id->completed(p,id)));j.addProperty("nextCommand","/mycli world story info "+c.id());rows.add(j);}}
            case "npc"->{for(var n:content.npcs)rows.add(npcs.view(n.id()));}
            case "side"->{for(var s:content.sides){var j=new JsonObject();j.addProperty("id",s.id());j.addProperty("title",s.title());j.addProperty("npc",s.npc());j.addProperty("available",sideAvailable(p,s));j.addProperty("completed",sideDone(p,s));j.addProperty("nextCommand","/mycli world story info "+s.id());rows.add(j);}}
            default->throw new IllegalArgumentException("list chapter|npc|side|ranking");}plugin.communication().list(p,"story_"+kind,"/mycli world story list "+kind+" --page "+page,rows,page);}
    private void talk(Player p,String id,String topic,boolean json){writeAllowed(p);var npc=content.npc(id);if(npc==null)throw new IllegalArgumentException("人物ID不存在，先 story list npc。");if(!npcs.nearby(p,id))throw new IllegalStateException("请先走到「"+npc.name()+"」8格内；story info "+id+" 查询实际或登记位置，不会远程代替交谈。");
        RpgStoryContent.Topic chosen=topic.equals("greeting")?null:npc.topics().stream().filter(t->t.id().equals(topic)).findFirst().orElseThrow(()->new IllegalArgumentException("话题不存在，先 story info "+id));
        refresh(p,false);var chapter=active(p);RpgStoryRules.Stage talking=null;if(chapter!=null){var progress=RpgStoryRules.evaluate(chapter,facts(p,chapter));if(!progress.ready()){var s=chapter.stages().get(progress.completed());if(Set.of(RpgStoryRules.Kind.TALK,RpgStoryRules.Kind.TALK_OR_GRADUATE).contains(s.kind())&&s.reference().equals(id))talking=s;}}
        var proof=talking;if(proof!=null&&!commit(y->y.set(base(p)+".active.talks."+proof.id(),true)))throw new IllegalStateException("对话已经发生，但剧情记录未保存；请先查status，不宣布完成。");
        String text=chosen==null?npc.greeting():chosen.text();String next="/mycli world story status";
        if(chosen!=null){switch(chosen.action()){
            case "route"->{choose(p,chosen.target(),json);next="/mycli tasks list "+chosen.target();}
            case "progress"->{var g=plugin.guild().progressState(p);if(g.has("advice"))text+=" "+g.get("advice").getAsString();next=string(g,"nextCommand","/mycli world story status");}
            case "rules"->next="/mycli rules";case "supplies"->next="/mycli guild shared";case "backpack"->next="/minepacks:backpack open";case "rewards"->next="/mycli arena stash pages";
            case "skills"->next="/mycli skills list common";case "guide"->next="/mycli world guide start";case "tasks"->next="/mycli tasks info "+chosen.target();case "photo"->next="/mycli photo menu";case "encounter"->next="/mycli dungeon info "+chosen.target();default->{}
        }}
        refresh(p,false);var out=new JsonObject();out.addProperty("npc",id);out.addProperty("name",npc.name());out.addProperty("topic",topic);out.addProperty("advice",text);out.addProperty("nextCommand",next);out.addProperty("source","authored_dialogue_and_live_server_state");
        p.sendMessage("§6["+npc.name()+"] §f"+text);var body=npcs.entity(id);if(body!=null)plugin.npcSpeech("story-npcs",body,p,text);
        if(json)emit(p,"dialogue",out,false,true);else p.sendMessage("§e下一步 "+next);
    }
    private void refresh(Player p,boolean announce){var chapter=active(p);if(chapter==null||!eligible(p))return;var result=RpgStoryRules.evaluate(chapter,facts(p,chapter));int before=ledger.getInt(base(p)+".active.cursor");if(result.completed()<=before)return;
        if(!commit(y->{y.set(base(p)+".active.cursor",result.completed());if(result.ready()){String history=base(p)+".completed."+chapter.id();y.set(history+".at",System.currentTimeMillis());y.set(history+".definition",RpgStoryContent.freeze(chapter));y.set(history+".accepted-revision",y.getInt(base(p)+".active.revision"));y.set(base(p)+".last-completed",chapter.id());y.set(base(p)+".active",null);}}))return;
        if(announce){var out=state(p);out.addProperty("advice",result.ready()?"章节「"+chapter.title()+"」已完成，真实经历已记入旅途手记。":"新的旅途目标："+string(out,"stageTitle","查看手记"));emit(p,"progress",out,false,false);}
    }
    private static String hash(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    private boolean commit(Consumer<YamlConfiguration> mutation){String before=ledger.saveToString();try{
        String actual=ledgerFile.exists()?hash(Files.readAllBytes(ledgerFile.toPath())):null;if(!Objects.equals(actual,ledgerHash))throw new IllegalStateException("story ledger changed outside this process");
        mutation.accept(ledger);File tmp=new File(ledgerFile.getParentFile(),ledgerFile.getName()+".tmp");ledger.save(tmp);
        try{Files.move(tmp.toPath(),ledgerFile.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException fallback){Files.move(tmp.toPath(),ledgerFile.toPath(),StandardCopyOption.REPLACE_EXISTING);}ledgerHash=hash(Files.readAllBytes(ledgerFile.toPath()));return true;
    }catch(Exception error){try{ledger.loadFromString(before);}catch(Exception impossible){throw new IllegalStateException(impossible);}plugin.getLogger().warning("Story progress not committed: "+error.getMessage());return false;}}
    private void tick(){for(Player p:Bukkit.getOnlinePlayers()){try{if(!eligible(p)||!content.enabled){removeBar(p.getUniqueId());continue;}refresh(p,!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p));updateBar(p);
                Menu m=menus.get(p.getUniqueId());if(m!=null&&!m.npc.isEmpty()&&!npcs.nearby(p,m.npc))p.closeInventory();
            }catch(RuntimeException error){removeBar(p.getUniqueId());plugin.getLogger().warning("Story view unavailable for one player: "+error.getClass().getSimpleName());}}}
    private void updateBar(Player p){if(!ledger.getBoolean(base(p)+".tracking")||active(p)==null||plugin.dungeonParticipant(p)||plugin.pvpParticipant(p)||plugin.getConfig().contains("guild-players."+p.getUniqueId()+".active")){removeBar(p.getUniqueId());return;}
        var s=state(p);var bar=bars.computeIfAbsent(p.getUniqueId(),id->Bukkit.createBossBar("旅途目标",BarColor.YELLOW,BarStyle.SOLID));String text="§e剧情 · "+string(s,"chapterTitle",content.title)+" §f｜"+string(s,"stageTitle","记录旅途");if(text.length()>112)text=text.substring(0,112);bar.setTitle(text);bar.setProgress(Math.min(1,s.has("eligibleSteps")?(double)s.get("eligibleSteps").getAsInt()/Math.max(1,s.get("totalSteps").getAsInt()):0));
        Set<Player> wanted=new HashSet<>(plugin.attachedEyes(p));wanted.add(p);for(Player old:Set.copyOf(bar.getPlayers()))if(!wanted.contains(old))bar.removePlayer(old);for(Player target:wanted)if(!bar.getPlayers().contains(target))bar.addPlayer(target);
    }
    private void removeBar(UUID id){var bar=bars.remove(id);if(bar!=null)bar.removeAll();}
    private static ItemStack item(Material type,String title,String... lore){var item=new ItemStack(type);var meta=item.getItemMeta();meta.setDisplayName(title);var lines=new ArrayList<String>();for(String text:lore)for(int i=0;i<text.length()&&lines.size()<9;i+=34)lines.add("§7"+text.substring(i,Math.min(i+34,text.length())));meta.setLore(lines);item.setItemMeta(meta);return item;}
    private void open(Player p,Inventory inv,String npc,Map<Integer,String> actions){p.openInventory(inv);menus.put(p.getUniqueId(),new Menu(p.getUniqueId(),inv,npc,Map.copyOf(actions)));}
    private void journalMenu(Player p){var inv=Bukkit.createInventory(null,54,"千灯纪 · 旅途手记");var actions=new HashMap<Integer,String>();var state=state(p);inv.setItem(4,item(Material.WRITABLE_BOOK,"§6"+content.title,string(state,"advice","每个人都可以走自己的路。"),string(state,"nextCommand","/mycli world story status")));actions.put(4,"status");
        int slot=9;for(var c:content.chapters){boolean done=completed(p,c.id());inv.setItem(slot,item(done?Material.ENCHANTED_BOOK:Material.BOOK,(done?"§a已完成 · ":"§e")+c.title(),c.introduction(),"点击查看章节；明确点击开始才报名。"));actions.put(slot++,"chapter:"+c.id());}
        slot=27;for(var n:content.npcs){inv.setItem(slot,item(Material.VILLAGER_SPAWN_EGG,"§e"+n.name(),n.role(),"查看人物与话题；交谈需走到8格内。"));actions.put(slot++,"npc:"+n.id());}
        inv.setItem(45,item(Material.BELL,"§b居民支线","看人物的请求、真实委托与完成情况"));actions.put(45,"sides");inv.setItem(46,item(Material.COMPASS,"§b六条旅途路线","选择偏好不会自动接单或选择职业。"));actions.put(46,"routes");inv.setItem(47,item(Material.CHEST,"§e补给与储物","公共箱、大背包、个人奖励箱分别使用。"));actions.put(47,"storage");inv.setItem(49,item(Material.BARRIER,"§7关闭"));actions.put(49,"close");inv.setItem(51,item(Material.MAP,"§e继续当前委托","保留已有任务；查看真实进度。"));actions.put(51,"commission");open(p,inv,"",actions);
    }
    private void npcMenu(Player p,String id){var npc=content.npc(id);if(npc==null)throw new IllegalArgumentException("人物ID不存在");var inv=Bukkit.createInventory(null,54,npc.name()+" · 对话");var actions=new HashMap<Integer,String>();inv.setItem(4,item(Material.WRITABLE_BOOK,"§6"+npc.name(),npc.greeting(),"交谈需要人物8格内，人物资料可随时查看。"));actions.put(4,"talk:"+id+":greeting");int slot=9;
        for(var t:npc.topics()){inv.setItem(slot,item(Material.PAPER,"§f"+t.title(),t.text()));actions.put(slot++,"talk:"+id+":"+t.id());}
        slot=36;for(String offer:npc.offers()){var task=plugin.taskMarket().find(p,offer);if(task==null)continue;inv.setItem(slot,item(task.icon(),"§e委托 · "+task.title(),task.description(),"先查看，明确接取后才占用公会任务槽。"));actions.put(slot++,"offer:"+offer);}
        inv.setItem(49,item(Material.BOOK,"§b回旅途手记"));actions.put(49,"journal");open(p,inv,npcs.nearby(p,id)?id:"",actions);
    }
    private void chapterMenu(Player p,String id){var c=content.chapter(id);if(c==null)throw new IllegalArgumentException("章节不存在");var inv=Bukkit.createInventory(null,27,c.title());var actions=new HashMap<Integer,String>();inv.setItem(4,item(Material.BOOK,"§e"+c.title(),c.introduction()));inv.setItem(11,item(Material.PAPER,"§f查看分步条件","只读，保留在途任务。"));actions.put(11,"chapter-info:"+id);inv.setItem(13,item(Material.LIME_DYE,"§a开始本章","自愿报名剧情；公会委托、职业和技能另行选择。"));actions.put(13,"start:"+id);inv.setItem(15,item(Material.BOOK,"§b返回手记"));actions.put(15,"journal");open(p,inv,"",actions);}
    private void offerMenu(Player p,String id){var task=plugin.taskMarket().find(p,id);if(task==null)throw new IllegalArgumentException("该委托暂不可接，先查询任务目录。");var inv=Bukkit.createInventory(null,27,"委托 · "+task.title());var actions=new HashMap<Integer,String>();inv.setItem(4,item(task.icon(),"§e"+task.title(),task.description(),"每阶段实际达标后 guild claim；最终奖励进入个人箱。"));inv.setItem(11,item(Material.PAPER,"§f完整条件与奖励","免费查询，不接单。"));actions.put(11,"offer-info:"+id);inv.setItem(13,item(Material.LIME_DYE,"§a接取这张委托","与原公会共用任务槽，有在途委托时服务器会拒绝。"));actions.put(13,"accept:"+id);inv.setItem(15,item(Material.BOOK,"§b返回手记"));actions.put(15,"journal");open(p,inv,"",actions);}
    private void sideMenu(Player p){var inv=Bukkit.createInventory(null,54,"千灯纪 · 居民支线");var actions=new HashMap<Integer,String>();int slot=0;for(var side:content.sides){if(slot>=36)break;inv.setItem(slot,item(sideDone(p,side)?Material.ENCHANTED_BOOK:Material.BOOK,(sideDone(p,side)?"§a已完成 · ":sideAvailable(p,side)?"§e":"§7后续 · ")+side.title(),side.introduction(),"委托人："+content.npc(side.npc()).name()));actions.put(slot++,"side:"+side.id());}inv.setItem(49,item(Material.BOOK,"§b回旅途手记"));actions.put(49,"journal");open(p,inv,"",actions);}
    private void routeMenu(Player p){var inv=Bukkit.createInventory(null,27,"千灯纪 · 选择旅途偏好");var actions=new HashMap<Integer,String>();String chosen=ledger.getString(base(p)+".route","");String[] ids={"combat","crafting","exploration","supply","engineering","life"},names={"讨伐与战斗","装备与制造","探索与旅行","后勤与供货","工程与建造","生活与记录"};Material[] icons={Material.IRON_SWORD,Material.ANVIL,Material.COMPASS,Material.CHEST,Material.BRICKS,Material.WRITABLE_BOOK};for(int i=0;i<ids.length;i++){inv.setItem(10+i,item(icons[i],(chosen.equals(ids[i])?"§a当前 · ":"§e")+names[i],"点击只选择旅途偏好，不自动接单，不改变职业。","之后可随时改选；原委托继续保留。"));actions.put(10+i,"choose:"+ids[i]);}inv.setItem(22,item(Material.BOOK,"§b回旅途手记"));actions.put(22,"journal");open(p,inv,"",actions);}
    @EventHandler public void click(InventoryClickEvent event){if(!(event.getWhoClicked() instanceof Player p))return;var menu=menus.get(p.getUniqueId());if(menu==null||menu.inventory!=event.getView().getTopInventory())return;event.setCancelled(true);if(!menu.owner.equals(p.getUniqueId()))return;String action=menu.actions.get(event.getRawSlot());if(action==null)return;p.closeInventory();Bukkit.getScheduler().runTask(plugin,()->{if(p.isOnline())dispatch(p,action);});}
    private void dispatch(Player p,String action){
        try{String[] a=action.split(":",3);switch(a[0]){case "close"->{}case "journal"->journalMenu(p);case "status"->command(p,new String[]{"world","story","status"});case "sides"->sideMenu(p);case "routes"->routeMenu(p);case "choose"->{choose(p,a[1],false);journalMenu(p);}case "storage"->{p.sendMessage("§e公共补给 /mycli guild shared；大背包 /minepacks:backpack open；个人奖励箱 /mycli arena stash pages。三个入口分别使用。");}case "commission"->plugin.taskMarket().routes().command(p,new String[]{"tasks","status"});case "npc"->npcMenu(p,a[1]);case "chapter"->chapterMenu(p,a[1]);case "chapter-info","side"->info(p,a[1],false);case "start"->start(p,a[1],false);case "talk"->{talk(p,a[1],a[2],false);npcMenu(p,a[1]);}case "offer"->offerMenu(p,a[1]);case "offer-info"->plugin.taskMarket().routes().command(p,new String[]{"tasks","info",a[1]});case "accept"->{writeAllowed(p);plugin.guild().command(p,new String[]{"guild","accept",a[1]});}default->throw new IllegalArgumentException("菜单动作已失效，重新打开手记。");}}
        catch(RuntimeException invalid){plugin.communication().error(p,"STORY_ACTION_DENIED",invalid.getMessage(),false,"/mycli world story status");}}
    @EventHandler public void drag(InventoryDragEvent event){var menu=menus.get(event.getWhoClicked().getUniqueId());if(menu!=null&&menu.inventory==event.getView().getTopInventory()&&event.getRawSlots().stream().anyMatch(i->i<menu.inventory.getSize()))event.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent event){var m=menus.get(event.getPlayer().getUniqueId());if(m!=null&&m.inventory==event.getInventory())menus.remove(event.getPlayer().getUniqueId());}
    @EventHandler public void quit(PlayerQuitEvent event){menus.remove(event.getPlayer().getUniqueId());frozen.remove(event.getPlayer().getUniqueId());removeBar(event.getPlayer().getUniqueId());}
    @EventHandler public void disable(PluginDisableEvent event){if(event.getPlugin()==plugin){for(UUID id:Set.copyOf(bars.keySet()))removeBar(id);menus.clear();}}
}
