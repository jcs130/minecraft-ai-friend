package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.File;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Chest;
import org.bukkit.block.DoubleChest;
import org.bukkit.block.Barrel;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.block.BlockDropItemEvent;
import org.bukkit.event.entity.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.*;
import org.bukkit.inventory.*;

/** Opt-in life challenges, observed on the server thread without performing participants' actions. */
final class LifeChallenges implements Listener {
    private final AgentFriendPlugin plugin;
    private final ChallengeStore store;
    private Map<String,ChallengeRun.Definition> catalog=Map.of();
    private final Map<UUID,ChallengeRun> runs=new LinkedHashMap<>();
    private final Map<UUID,UUID> active=new HashMap<>();
    private final Map<UUID,ChallengeInventory> bags=new HashMap<>();
    private final Map<UUID,Window> windows=new HashMap<>();
    private final Map<UUID,Drop> drops=new HashMap<>();
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private final Set<UUID> explicitJson=new HashSet<>();
    private final Map<UUID,ChallengeCli.Request> commands=new HashMap<>();
    private boolean closing;
    private record Window(UUID run,Inventory inventory,ChallengeInventory.Snapshot before,boolean backpack) { }
    private record Drop(UUID run,UUID recipient,String kind,Material material,int count,long expires) { }
    private record Menu(UUID owner,Map<Integer,String> actions) { }
    LifeChallenges(AgentFriendPlugin plugin) {
        this.plugin=plugin;store=new ChallengeStore(plugin.getDataFolder().toPath().resolve("challenge-runs"));
        if(!new File(plugin.getDataFolder(),"life-challenges.yml").exists())plugin.saveResource("life-challenges.yml",false);
        reload();
        try {
            for(ChallengeRun r:store.load()){
                runs.put(r.id,r);
                if(r.active()){r.end("interrupted","server_restart",now());store.save(r);}
            }
        }catch(Exception e){store.error.set("archive_invalid");plugin.getLogger().severe("Challenge archive preserved; recording disabled: "+e);}
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin,"mcagent:challenge");
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
    }
    boolean reload() {
        try{
            YamlConfiguration y=new YamlConfiguration();y.load(new File(plugin.getDataFolder(),"life-challenges.yml"));
            if(y.getInt("schema-version")!=1)throw new IllegalArgumentException("schema-version");
            var section=y.getConfigurationSection("challenges");if(section==null||section.getKeys(false).isEmpty()||section.getKeys(false).size()>12)throw new IllegalArgumentException("challenge count");
            Map<String,ChallengeRun.Definition> next=new LinkedHashMap<>();
            for(String id:section.getKeys(false)){
                var s=section.getConfigurationSection(id);if(s==null)throw new IllegalArgumentException("definition");
                String type=s.getString("type","");
                var d=new ChallengeRun.Definition(id,s.getString("title",""),s.getString("description",""),type,s.getInt("seconds",600),s.getInt("count",1),ChallengeRun.Definition.roles(type),ChallengeRun.Definition.steps(type));
                next.put(id,d);
            }
            catalog=Collections.unmodifiableMap(next);return true;
        }catch(Exception e){plugin.getLogger().warning("Challenge config rejected; previous rules retained: "+e.getMessage());return false;}
    }
    void admin(CommandSender sender,String[] args){
        if(args.length==3&&args[2].equalsIgnoreCase("reload")){sender.sendMessage("生活挑战配置重载："+reload()+"；在办规则保持。");return;}
        sender.sendMessage("生活挑战：templates="+catalog.size()+" active="+active.values().stream().distinct().count()+" records="+runs.size()+" journal="+(store.error.get().isEmpty()?"ready":store.error.get())+"；mycli admin challenges reload");
    }
    private static long now(){return System.currentTimeMillis();}
    private boolean eligible(Player p){return p!=null&&p.isOnline()&&!p.isDead()&&!plugin.isObserver(p)&&!plugin.isDowned(p)&&Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(p.getGameMode());}
    private ChallengeRun current(Player p){UUID id=active.get(p.getUniqueId());return id==null?null:runs.get(id);}
    private ChallengeRun running(Player p,String type){ChallengeRun r=current(p);return r!=null&&r.state.equals("running")&&r.definition.type().equals(type)&&store.error.get().isEmpty()?r:null;}
    private void error(Player p,String reason,String instruction){
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("status","denied");out.addProperty("reason",reason);out.addProperty("errorCode",reason);out.addProperty("nextAction",instruction);
        out.addProperty("retryable",false);out.addProperty("nextCommand","/mycli challenge --help");
        human(p,"§e[生活挑战] "+instruction);emit(p,out);
    }
    private boolean machine(Player p){var request=commands.get(p.getUniqueId());return plugin.communication().compact(p)||explicitJson.contains(p.getUniqueId())||request!=null&&request.json();}
    private void human(Player p,String message){
        if(!machine(p))p.sendMessage(message);
        // Machine clients receive one structured reply. Only their actually attached Eyes
        // receive the readable counterpart; never broadcast it or repeat it to the Agent.
        else for(Player eye:plugin.attachedEyes(p))eye.sendMessage(message);
    }
    private void emit(Player p,JsonObject out){
        var request=commands.get(p.getUniqueId());out.addProperty("trigger",request==null?"server_observation":request.verb());
        if(request!=null)out.addProperty("readOnly",request.readOnly());
        if(!out.has("schemaVersion"))out.addProperty("schemaVersion",1);
        if(request!=null&&request.json()&&out.has("nextCommand")&&!out.get("nextCommand").getAsString().contains("--json"))out.addProperty("nextCommand",out.get("nextCommand").getAsString()+" --json");
        plugin.communication().stamp(p,out);p.sendPluginMessage(plugin,"mcagent:challenge",out.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));if(machine(p))p.sendMessage("MC_CHALLENGE "+out);
    }
    void jsonCommand(Player p,String[] args){String[] formatted=Arrays.copyOf(args,args.length+1);formatted[args.length]="--json";command(p,formatted);}
    void command(Player p,String[] args){
        boolean json=Arrays.asList(args).contains("--json");if(json)explicitJson.add(p.getUniqueId());
        try{
            var request=ChallengeCli.parse(args);commands.put(p.getUniqueId(),request);
            if(plugin.isDowned(p)&&!request.readOnly()){error(p,"downed","倒地时等待队友救援；可用 /mycli challenge status 查询进度。");return;}
            switch(request.action()){
                case "list" -> list(p,request.page());
                case "info" -> {var d=catalog.get(request.value(0));if(d==null){error(p,"unknown_challenge","项目不存在；用 /mycli challenge list 查看实际ID。");return;}detail(p,d);}
                case "menu" -> {menu(p);JsonObject out=new JsonObject();out.addProperty("type","menu");out.addProperty("status","opened");out.addProperty("nextCommand","/mycli challenge status");emit(p,out);}
                case "create" -> start(p,request.value(0));
                case "join" -> join(p,UUID.fromString(request.value(0)),request.value(1));
                case "start" -> begin(p);
                case "cancel" -> {ChallengeRun r=current(p);if(r==null){showLatest(p);return;}r.end("cancelled","participant_cancelled",now(),p.getUniqueId());changed(r);}
                case "status","result" -> {
                    if(request.values().isEmpty()&&latest(p)==null){showLatest(p);return;}
                    ChallengeRun r=request.values().isEmpty()?latest(p):runs.get(UUID.fromString(request.value(0)));
                    if(r==null||!r.contains(p.getUniqueId())){error(p,"record_unavailable","仅可查询本人参加的场次；/mycli challenge history 查看自己的场次编号。");return;}show(p,r,request.action().equals("result"));
                }
                case "history" -> history(p,request.page());
                default -> throw new IllegalArgumentException();
            }
        }catch(IllegalArgumentException invalid){error(p,"invalid_argument",(invalid.getMessage()==null?"参数格式不符":invalid.getMessage())+"；/mycli challenge --help 查看用法。");}
        finally{commands.remove(p.getUniqueId());explicitJson.remove(p.getUniqueId());}
    }
    private List<ChallengeRun> history(Player p){return runs.values().stream().filter(r->r.contains(p.getUniqueId())).sorted(Comparator.comparingLong((ChallengeRun r)->r.created).reversed()).toList();}
    private ChallengeRun latest(Player p){ChallengeRun r=current(p);return r!=null?r:history(p).stream().findFirst().orElse(null);}
    private void showLatest(Player p){ChallengeRun r=latest(p);if(r!=null)show(p,r,false);else{emit(p,summary(p));human(p,"§7[生活挑战] 暂无记录；/mycli challenge list 查看项目。");}}
    private void list(Player p,int page){
        List<JsonObject> rows=new ArrayList<>();for(var d:catalog.values()){
            JsonObject row=new JsonObject();row.addProperty("id",d.id());row.addProperty("title",d.title());row.addProperty("players",d.roles().size());row.addProperty("seconds",d.seconds());row.addProperty("nextCommand","/mycli challenge info "+d.id());rows.add(row);
        }
        JsonObject out=paged("catalog","list",rows,page);emit(p,out);
        for(var row:out.getAsJsonArray("items")){var d=row.getAsJsonObject();human(p,"§b[生活挑战] "+d.get("title").getAsString()+" · "+d.get("players").getAsInt()+"人 · "+d.get("nextCommand").getAsString());}
        if(out.has("nextCommand"))human(p,"§7下一页："+out.get("nextCommand").getAsString());
    }
    private void history(Player p,int page){
        List<JsonObject> rows=new ArrayList<>();for(var r:history(p)){JsonObject row=new JsonObject();row.addProperty("runId",r.id.toString());row.addProperty("challengeId",r.definition.id());row.addProperty("title",r.definition.title());row.addProperty("state",state(p,r).get("state").getAsString());row.addProperty("success",r.state.equals("completed")&&store.durable(r));row.addProperty("nextCommand","/mycli challenge result "+r.id);rows.add(row);}
        JsonObject out=paged("history","history",rows,page);emit(p,out);
        if(rows.isEmpty())human(p,"§7[生活挑战] 暂无记录；/mycli challenge list 查看项目。");
        for(var row:out.getAsJsonArray("items")){var d=row.getAsJsonObject();human(p,"§b[生活挑战] "+d.get("title").getAsString()+" · "+d.get("nextCommand").getAsString());}
        if(out.has("nextCommand"))human(p,"§7下一页："+out.get("nextCommand").getAsString());
    }
    private static JsonObject paged(String type,String query,List<JsonObject> rows,int page){
        int pages=ChallengeCli.pages(rows.size());if(page>pages)throw new IllegalArgumentException("页码范围1–"+pages);
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("type",type);out.addProperty("readOnly",true);out.addProperty("page",page);out.addProperty("pages",pages);out.addProperty("total",rows.size());JsonArray items=new JsonArray();
        rows.stream().skip((long)(page-1)*ChallengeCli.PAGE_SIZE).limit(ChallengeCli.PAGE_SIZE).forEach(items::add);out.add("items",items);
        if(page<pages)out.addProperty("nextCommand","/mycli challenge "+query+" --page "+(page+1));return out;
    }
    private static JsonObject definition(ChallengeRun.Definition d){JsonObject out=ChallengeRun.JSON.toJsonTree(d).getAsJsonObject();out.addProperty("schemaVersion",1);out.addProperty("ruleVersion",d.version());out.addProperty("track","live_world");return out;}
    private void detail(Player p,ChallengeRun.Definition d){
        JsonObject out=definition(d);out.addProperty("type","detail");out.addProperty("readOnly",true);out.addProperty("nextCommand","/mycli challenge create "+d.id());
        out.addProperty("consumption","报名免费；使用自己的物资与技能，原玩法消耗照常；无额外奖励");
        emit(p,out);human(p,"§6["+d.title()+"] "+d.description());
        human(p,"§7报名免费，使用自己的物资与已学技能；原玩法消耗照常。成绩为本次生活实测，无额外奖励；/mycli challenge create "+d.id()+" 自愿报名。");
    }
    private void start(Player p,String id){
        var d=catalog.get(id);if(d==null)throw new IllegalArgumentException();
        if(!eligible(p)){error(p,"not_playing","请用在线生存角色参加；倒地时先等队友救援。");return;}
        if(current(p)!=null){
            if(!current(p).definition.id().equals(id)){error(p,"active_challenge","已有另一项挑战；先 /mycli challenge status 核对，需换项目时主动 cancel。");return;}
            show(p,current(p),false);return;
        } // A retried create cannot create a second attempt.
        if(!store.error.get().isEmpty()||runs.size()>=10_000||new HashSet<>(active.values()).size()>=32){error(p,"recording_unavailable","记录服务暂不可用；请联系房管，恢复后再报名，现有记录保留。");return;}
        ChallengeRun r=new ChallengeRun(p.getUniqueId(),d,now());runs.put(r.id,r);active.put(p.getUniqueId(),r.id);changed(r);
    }
    private void join(Player p,UUID id,String role){
        ChallengeRun r=runs.get(id);
        if(r!=null&&r.active()&&r.contains(p.getUniqueId())&&Objects.equals(r.role(p.getUniqueId()),role)){show(p,r,false);return;}
        if(!store.error.get().isEmpty()||!eligible(p)||current(p)!=null||r==null||!r.join(p.getUniqueId(),role,now())){error(p,"join_unavailable","需要空闲生存角色、等候中的场次和未占用分工。由队长发场次编号；或打开 /mycli challenge menu 选择等候队伍。");return;}
        active.put(p.getUniqueId(),id);changed(r);
    }
    private void begin(Player p){
        if(!store.error.get().isEmpty()){error(p,"recording_unavailable","证据记录暂不可用，请联系房管核对；本次未开始。");return;}
        ChallengeRun r=current(p);
        if(r!=null&&r.state.equals("running")&&r.owner.equals(p.getUniqueId())){show(p,r,false);return;}
        if(r==null||!r.state.equals("forming")||!r.owner.equals(p.getUniqueId())||r.members.size()!=r.definition.roles().size()){
            error(p,"party_not_ready","由队长创建并等待各分工本人加入；/mycli challenge status --verbose 查看空缺，齐备后队长 /mycli challenge start 开始。");return;}
        JsonObject initial=new JsonObject();initial.addProperty("serverVersion",Bukkit.getVersion());initial.addProperty("pluginVersion",plugin.getDescription().getVersion());initial.addProperty("initialConditions","participants_own_resources");JsonArray players=new JsonArray();
        for(UUID id:r.members.values()){
            Player member=Bukkit.getPlayer(id);
            if(!eligible(member)||!member.getItemOnCursor().getType().isAir()||member.getOpenInventory().getTopInventory().getType()!=InventoryType.CRAFTING){error(p,"player_not_ready","各成员先关闭窗口、收好光标物品，并保持在线存活，再 /mycli challenge start。");return;}
            if(r.definition.type().equals("backpack") && count(member,Material.COBBLESTONE)<r.definition.count()) {error(p,"missing_material","先准备至少 "+r.definition.count()+" 个普通圆石，再 /mycli challenge start。不要放在任务袋或奖励箱。");return;}
            if(r.definition.type().equals("supply")&&(count(member,Material.OAK_LOG)>0||count(member,Material.OAK_PLANKS)>0)){error(p,"old_materials","各成员先把随身橡木原木、橡木木板收好；开始后本轮采集并交接，其他工具物资可保留。");return;}
            JsonObject person=new JsonObject();person.addProperty("uuid",id.toString());person.addProperty("name",member.getName());person.addProperty("mode",member.getGameMode().name());person.addProperty("world",member.getWorld().getKey().toString());
            person.addProperty("x",member.getLocation().getX());person.addProperty("y",member.getLocation().getY());person.addProperty("z",member.getLocation().getZ());person.addProperty("inventoryHash",ChallengeRun.sha(new Gson().toJson(playerItems(member))));
            person.addProperty("profession",plugin.professions().ledger.profile(id).get("combat").getAsString());players.add(person);
        }
        initial.add("players",players);if(!r.begin(p.getUniqueId(),initial,now()))return;
        if(r.definition.type().equals("backpack"))bags.put(r.id,new ChallengeInventory(identity(new ItemStack(Material.COBBLESTONE)),r.definition.count()));
        changed(r);
    }
    JsonObject summary(Player p){ChallengeRun r=latest(p);if(r==null){JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("type","status");out.addProperty("readOnly",true);out.addProperty("state","none");out.addProperty("title","生活能力挑战");out.addProperty("nextCommand","/mycli challenge list");return out;}return state(p,r);}
    JsonObject activeSummary(Player p){ChallengeRun r=current(p);if(r==null)return null;JsonObject out=new JsonObject();out.addProperty("title",r.definition.title());out.addProperty("state",state(p,r).get("state").getAsString());out.addProperty("nextCommand","/mycli challenge status");return out;}
    private JsonObject state(Player p,ChallengeRun r){
        JsonObject out=new JsonObject();boolean durable=store.durable(r);
        out.addProperty("schemaVersion",1);out.addProperty("type","status");out.addProperty("readOnly",true);out.addProperty("runId",r.id.toString());out.addProperty("challengeId",r.definition.id());out.addProperty("title",r.definition.title());out.addProperty("ruleVersion",r.definition.version());
        out.addProperty("state",!store.error.get().isEmpty()?"unknown":r.state.equals("completed")&&!durable?"settling":r.state);out.addProperty("reason",store.error.get().isEmpty()?r.reason:"evidence_write_failed");out.addProperty("durable",durable);out.addProperty("success",r.state.equals("completed")&&durable);
        out.addProperty("completedSteps",r.completed);out.addProperty("totalSteps",r.definition.steps().size());out.addProperty("nextStep",r.nextStep());out.addProperty("role",r.role(p.getUniqueId()));
        out.addProperty("startedAt",r.started);out.addProperty("deadline",r.deadline);out.addProperty("track","live_world");out.addProperty("autonomy","unverified");
        out.addProperty("nextAction",advice(r));out.addProperty("nextCommand",r.state.equals("forming")?r.owner.equals(p.getUniqueId())&&r.members.size()==r.definition.roles().size()?"/mycli challenge start":"/mycli challenge status --verbose":r.active()?"/mycli challenge status":"/mycli challenge result "+r.id);
        return out;
    }
    private void details(JsonObject out,ChallengeRun r){
        out.addProperty("endedAt",r.ended);out.add("rule",definition(r.definition));
        JsonArray missing=new JsonArray();for(int i=r.completed;i<r.definition.steps().size();i++)missing.add(step(r.definition.steps().get(i)));out.add("missingConditions",missing);
        JsonArray members=new JsonArray();r.members.forEach((role,id)->{JsonObject m=new JsonObject();m.addProperty("role",role);m.addProperty("uuid",id.toString());Player online=Bukkit.getPlayer(id);m.addProperty("name",online==null?"离线成员":online.getName());members.add(m);});out.add("members",members);
        JsonArray vacancies=new JsonArray();for(String role:r.definition.roles())if(!r.members.containsKey(role)){JsonObject v=new JsonObject();v.addProperty("role",role);v.addProperty("label",roleName(role));v.addProperty("joinCommand","/mycli challenge join "+r.id+" "+role);vacancies.add(v);}out.add("vacancies",vacancies);
    }
    private String advice(ChallengeRun r){
        if(!store.error.get().isEmpty())return "证据保存异常，不能宣布通过。请联系房管核对原记录，不要重复交付。";
        if(r.state.equals("forming"))return r.members.size()==r.definition.roles().size()?"人员齐备；按info备好物资、关闭窗口后队长 /mycli challenge start。":"等待"+(r.definition.roles().size()-r.members.size())+"个分工；/mycli challenge status --verbose 查看加入命令。";
        if(r.state.equals("completed"))return store.durable(r)?"本轮全部条件已核验并保存。可用 result 查看证据；没有额外领奖步骤。":"正在保存证据；稍后查 status，暂不算完成。";
        if(!r.active())return reason(r.reason)+"；已有物资和游戏进度保留。查 result 核对缺项，需要重试时重新 create。";
        return switch(r.nextStep()){
            case "bag_open"->"打开本人的黄色大背包：/minepacks:backpack open。准备 "+r.definition.count()+" 个普通圆石。";
            case "bag_deposit"->"存入至少 "+r.definition.count()+" 个普通圆石，收好光标并关闭大背包。";
            case "bag_reopen"->"重新打开本人的大背包，核对刚存入的圆石。";
            case "bag_return"->"取回刚存入的物品，恢复开始时两边数量，收好光标再关闭。";
            case "wood_gathered"->"采集者亲手砍橡木并捡起至少 "+r.definition.count()+" 个原木。受保护建筑不可拆，先找可采的树。";
            case "wood_handoff"->"采集者把至少 "+r.definition.count()+" 个原木作为一堆丢给本队木匠，由木匠捡起。";
            case "planks_crafted"->"木匠把本轮原木合成至少 "+(r.definition.count()*4)+" 块橡木木板，取走合成结果。";
            case "planks_handoff"->"木匠把至少 "+(r.definition.count()*4)+" 块木板作为一堆丢给本队收货者，由收货者捡起。";
            case "chest_delivered"->"收货者打开有权限的实体箱子或木桶，存入至少 "+(r.definition.count()*4)+" 块木板，收好光标并关闭。";
            case "teammate_revived"->"正常组队挑战；同伴战斗倒地时，救援者在4格内连续停留10秒扶起。不要故意制造伤害。";
            default->"两人留在同一场挑战内，共同清完本层或本室；换场次或离场不计。";
        };
    }
    private static String reason(String value){return switch(value){case "server_restart","server_stopped"->"服务器维护中断";case "participant_disconnected"->"成员断线，动作结果须重新核对";case "participant_cancelled"->"成员主动取消";case "time_limit"->"超过本场时限";case "party_wait_limit"->"等候组队超过5分钟";case "inventory_changed"->"物品总量发生额外变化，本轮无法证明存取守恒";case "cursor_not_empty"->"关闭时光标仍有物品，本轮无法确认完整归还";case "observation_unconfirmed"->"未收到一致的实际库存结果，结果未知";case "participant_unavailable"->"成员死亡或离开可参测角色状态";case "handoff_lost"->"交接物被其他人捡走或合堆，无法核对本轮交接";default->"本轮已中断（"+value+"）";};}
    private static String roleName(String role){return switch(role){case "learner"->"旅人";case "gatherer"->"采集者";case "maker"->"木匠";case "receiver"->"收货者";case "rescuer"->"救援者";default->"同伴";};}
    private static String step(String key){return switch(key){case "bag_open"->"打开本人大背包";case "bag_deposit"->"存入并关闭";case "bag_reopen"->"重开核对";case "bag_return"->"取回、关闭并确认守恒";case "wood_gathered"->"采集者砍木并捡起";case "wood_handoff"->"原木交到木匠手中";case "planks_crafted"->"木匠实际完成合成";case "planks_handoff"->"木板交到收货者手中";case "chest_delivered"->"木板存入合法实体箱";case "teammate_revived"->"连续靠近救起同伴";default->"同场共同清场";};}
    private void show(Player p,ChallengeRun r,boolean evidence){
        var request=commands.get(p.getUniqueId());JsonObject out=state(p,r);
        if(request!=null&&request.verbose())details(out,r);
        if(evidence){List<JsonObject> rows=r.events.asList().stream().map(JsonElement::getAsJsonObject).map(JsonObject::deepCopy).toList();JsonObject page=paged("result","result "+r.id,rows,request==null?1:request.page());for(String key:List.of("page","pages","total","items","nextCommand"))if(page.has(key))out.add(key,page.get(key));}
        emit(p,out);human(p,"§b["+r.definition.title()+"] "+r.completed+"/"+r.definition.steps().size()+" · "+advice(r));
        if(request!=null&&request.verbose()&&!machine(p)){
            for(var vacancy:out.getAsJsonArray("vacancies"))human(p,"§e待加入："+vacancy.getAsJsonObject().get("label").getAsString()+" · "+vacancy.getAsJsonObject().get("joinCommand").getAsString());
            for(var missing:out.getAsJsonArray("missingConditions"))human(p,"§7○ "+missing.getAsString());
        }
        if(evidence&&!machine(p))for(int i=0;i<r.definition.steps().size();i++)human(p,(i<r.completed?"§a✓ ":"§7○ ")+step(r.definition.steps().get(i)));
    }
    private void changed(ChallengeRun r){
        if(!r.active()){for(UUID id:r.members.values()){active.remove(id,r.id);windows.remove(id);}bags.remove(r.id);drops.values().removeIf(d->d.run.equals(r.id));}
        int version=r.revision;
        // Capture only the originating command. Its asynchronous durable receipt must keep
        // --json and readOnly=false without turning subsequent observations into commands.
        Map<UUID,ChallengeCli.Request> requests=new HashMap<>();for(UUID id:r.members.values())if(commands.containsKey(id))requests.put(id,commands.get(id));
        store.save(r).whenComplete((ok,failure)->{
            if(closing||!plugin.isEnabled())return;
            Bukkit.getScheduler().runTask(plugin,()->{
                if(r.revision!=version)return;
                for(UUID id:r.members.values()){Player p=Bukkit.getPlayer(id);if(p!=null){var request=requests.get(id);if(request!=null)commands.put(id,request);try{show(p,r,false);}finally{if(request!=null)commands.remove(id);}}}
            });
        });
    }
    private void observed(ChallengeRun r,UUID actor,String kind,JsonObject detail){int revision=r.revision;if(r.observe(actor,kind,detail,now())||revision!=r.revision)changed(r);}
    private void interrupt(ChallengeRun r,String reason){interrupt(r,reason,null);}
    private void interrupt(ChallengeRun r,String reason,UUID actor){if(r.active()){r.end("interrupted",reason,now(),actor);changed(r);}}
    private void tick(){
        for(UUID id:new HashSet<>(active.values())){ChallengeRun r=runs.get(id);int old=r.revision;r.expire(now());if(old!=r.revision)changed(r);}
        drops.values().removeIf(d->d.expires<now());
    }
    @EventHandler(priority=EventPriority.MONITOR) public void quit(PlayerQuitEvent e){ChallengeRun r=current(e.getPlayer());if(r!=null)interrupt(r,"participant_disconnected",e.getPlayer().getUniqueId());}
    @EventHandler(priority=EventPriority.MONITOR) public void died(PlayerDeathEvent e){ChallengeRun r=current(e.getEntity());if(r!=null)interrupt(r,"participant_unavailable",e.getEntity().getUniqueId());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void mode(PlayerGameModeChangeEvent e){ChallengeRun r=current(e.getPlayer());if(r!=null&&!Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(e.getNewGameMode()))interrupt(r,"participant_unavailable",e.getPlayer().getUniqueId());}
    void shutdown(){closing=true;for(UUID id:new HashSet<>(active.values())){ChallengeRun r=runs.get(id);r.end("interrupted","server_stopped",now());store.save(r);}store.close();if(!store.error.get().isEmpty())plugin.getLogger().severe("Challenge journal: "+store.error.get());}

    // Native inventory observation, with a fresh record independent of completed tutorial flags.
    private static String identity(ItemStack item){ItemStack one=item.clone();one.setAmount(1);return ChallengeRun.sha(Base64.getEncoder().encodeToString(one.serializeAsBytes()));}
    private static Map<String,Integer> items(ItemStack[] contents){Map<String,Integer> out=new TreeMap<>();for(ItemStack item:contents)if(item!=null&&!item.getType().isAir()&&!BackpackShortcutMigration.isShortcut(item))out.merge(identity(item),item.getAmount(),Integer::sum);return out;}
    private static Map<String,Integer> playerItems(Player p){var list=new ArrayList<ItemStack>(Arrays.asList(p.getInventory().getContents()));list.add(p.getItemOnCursor());return items(list.toArray(ItemStack[]::new));}
    private static ChallengeInventory.Snapshot snapshot(Player p,Inventory inv){return new ChallengeInventory.Snapshot(playerItems(p),items(inv.getContents()),p.getItemOnCursor().getType().isAir());}
    private boolean ownBag(Player p,Inventory inv){
        var minepacks=Bukkit.getPluginManager().getPlugin("Minepacks");if(minepacks==null||!minepacks.isEnabled()||inv.getHolder()==null)return false;
        try{Class<?> api=Class.forName("at.pcgamingfreaks.Minepacks.Bukkit.API.Backpack",false,minepacks.getClass().getClassLoader());return api.isInstance(inv.getHolder())&&p.getUniqueId().equals(api.getMethod("getOwnerId").invoke(inv.getHolder()));}
        catch(ReflectiveOperationException ignored){return false;}
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void opened(InventoryOpenEvent e){
        if(!(e.getPlayer() instanceof Player p))return;ChallengeRun r=current(p);if(r==null||!r.state.equals("running"))return;
        boolean bag=r.definition.type().equals("backpack")&&ownBag(p,e.getInventory());
        boolean chest=r.definition.type().equals("supply")&&r.nextStep().equals("chest_delivered")&&r.role(p.getUniqueId()).equals("receiver")&&physicalChest(e.getInventory());
        if(!bag&&!chest)return;
        Window old=windows.get(p.getUniqueId());if(old!=null&&old.inventory==e.getInventory())return;
        var before=snapshot(p,e.getInventory());windows.put(p.getUniqueId(),new Window(r.id,e.getInventory(),before,bag));
        if(bag){ChallengeInventory cycle=bags.get(r.id);if(cycle!=null)bagResult(r,p,cycle.open(before),before);}
    }
    private static boolean physicalChest(Inventory inv){return inv.getHolder() instanceof Chest||inv.getHolder() instanceof DoubleChest||inv.getHolder() instanceof Barrel;}
    @EventHandler(priority=EventPriority.MONITOR) public void closed(InventoryCloseEvent e){
        menus.remove(e.getInventory());if(!(e.getPlayer() instanceof Player p))return;
        Window window=windows.remove(p.getUniqueId());if(window==null||window.inventory!=e.getInventory())return;
        Bukkit.getScheduler().runTask(plugin,()->{
            ChallengeRun r=current(p);if(r==null||!r.id.equals(window.run)||!r.state.equals("running"))return;
            if(windows.containsKey(p.getUniqueId())){interrupt(r,"observation_unconfirmed");return;}
            var after=snapshot(p,window.inventory);
            if(window.backpack){ChallengeInventory cycle=bags.get(r.id);if(cycle!=null)bagResult(r,p,cycle.close(after),after);}
            else if(ChallengeInventory.deposit(window.before,after,identity(new ItemStack(Material.OAK_PLANKS)),r.definition.count()*4)){
                JsonObject proof=inventoryProof(after);Location at=window.inventory.getLocation();if(at!=null){proof.addProperty("world",at.getWorld().getKey().toString());proof.addProperty("x",at.getBlockX());proof.addProperty("y",at.getBlockY());proof.addProperty("z",at.getBlockZ());}
                proof.addProperty("delivered",after.container().getOrDefault(identity(new ItemStack(Material.OAK_PLANKS)),0)-window.before.container().getOrDefault(identity(new ItemStack(Material.OAK_PLANKS)),0));observed(r,p.getUniqueId(),"chest_delivered",proof);
            }
        });
    }
    private void bagResult(ChallengeRun r,Player p,String result,ChallengeInventory.Snapshot snapshot){
        if(Set.of("inventory_changed","cursor_not_empty").contains(result)){interrupt(r,result);return;}
        if(r.definition.steps().contains(result))observed(r,p.getUniqueId(),result,inventoryProof(snapshot));
    }
    private static JsonObject inventoryProof(ChallengeInventory.Snapshot s){
        JsonObject out=new JsonObject();out.addProperty("playerHash",ChallengeRun.sha(new Gson().toJson(s.player())));out.addProperty("containerHash",ChallengeRun.sha(new Gson().toJson(s.container())));out.addProperty("totalHash",ChallengeRun.sha(new Gson().toJson(new TreeMap<>(s.total()))));out.addProperty("cursorEmpty",s.cursorEmpty());
        String stone=identity(new ItemStack(Material.COBBLESTONE));out.addProperty("playerCobblestone",s.player().getOrDefault(stone,0));out.addProperty("bagCobblestone",s.container().getOrDefault(stone,0));return out;
    }
    private static int count(Player p,Material material){int sum=0;for(ItemStack item:p.getInventory().getContents())if(plain(item,material))sum+=item.getAmount();ItemStack cursor=p.getItemOnCursor();if(plain(cursor,material))sum+=cursor.getAmount();return sum;}
    private static boolean plain(ItemStack item,Material material){return item!=null&&item.getType()==material&&!item.hasItemMeta();}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void harvested(BlockDropItemEvent e){
        Player p=e.getPlayer();ChallengeRun r=running(p,"supply");
        if(r==null||!r.nextStep().equals("wood_gathered")||!r.role(p.getUniqueId()).equals("gatherer")||e.getBlockState().getType()!=Material.OAK_LOG)return;
        for(Item item:e.getItems())if(plain(item.getItemStack(),Material.OAK_LOG)&&item.getItemStack().getAmount()>=r.definition.count())track(item,new Drop(r.id,p.getUniqueId(),"wood_gathered",Material.OAK_LOG,r.definition.count(),now()+120_000));
    }
    private void track(Item item,Drop drop){if(drops.size()<128)drops.put(item.getUniqueId(),drop);else {ChallengeRun r=runs.get(drop.run);if(r!=null)interrupt(r,"observation_unconfirmed");}}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void dropped(PlayerDropItemEvent e){
        Player p=e.getPlayer();ChallengeRun r=running(p,"supply");if(r==null)return;String kind=r.nextStep();
        String giver=kind.equals("wood_handoff")?"gatherer":kind.equals("planks_handoff")?"maker":"";
        if(!r.role(p.getUniqueId()).equals(giver))return;
        Material material=kind.equals("wood_handoff")?Material.OAK_LOG:Material.OAK_PLANKS;int amount=r.definition.count()*(material==Material.OAK_LOG?1:4);
        if(plain(e.getItemDrop().getItemStack(),material)&&e.getItemDrop().getItemStack().getAmount()>=amount)track(e.getItemDrop(),new Drop(r.id,r.members.get(material==Material.OAK_LOG?"maker":"receiver"),kind,material,amount,now()+120_000));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void picked(EntityPickupItemEvent e){
        Drop d=drops.get(e.getItem().getUniqueId());if(d==null)return;
        if(!(e.getEntity() instanceof Player p)||!p.getUniqueId().equals(d.recipient)){ChallengeRun r=runs.get(d.run);if(r!=null)interrupt(r,"handoff_lost");return;}
        int received=e.getItem().getItemStack().getAmount()-e.getRemaining();if(received<d.count)return;
        int before=count(p,d.material);UUID itemId=e.getItem().getUniqueId();drops.remove(itemId);
        Bukkit.getScheduler().runTask(plugin,()->{
            ChallengeRun r=running(p,"supply");if(r==null||!r.id.equals(d.run)||!r.nextStep().equals(d.kind))return;
            int after=count(p,d.material);
            if(after-before!=received){interrupt(r,"observation_unconfirmed");return;}
            JsonObject proof=new JsonObject();proof.addProperty("entityUuid",itemId.toString());proof.addProperty("material",d.material.getKey().toString());proof.addProperty("received",received);proof.addProperty("before",before);proof.addProperty("after",after);proof.addProperty("provenance","observed_transfer_amounts");observed(r,p.getUniqueId(),d.kind,proof);
        });
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void merged(ItemMergeEvent e){
        Drop a=drops.get(e.getEntity().getUniqueId()),b=drops.get(e.getTarget().getUniqueId());
        for(Drop d:Arrays.asList(a,b))if(d!=null){ChallengeRun r=runs.get(d.run);if(r!=null)interrupt(r,"handoff_lost");}
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void crafted(CraftItemEvent e){
        if(!(e.getWhoClicked() instanceof Player p))return;ChallengeRun r=running(p,"supply");
        if(r==null||!r.nextStep().equals("planks_crafted")||!r.role(p.getUniqueId()).equals("maker")
                ||!(e.getRecipe() instanceof Keyed recipe)||!recipe.getKey().equals(NamespacedKey.minecraft("oak_planks")))return;
        CraftingInventory inv=e.getInventory();int logs=count(p,Material.OAK_LOG)+matrixCount(inv,Material.OAK_LOG),planks=count(p,Material.OAK_PLANKS);
        Bukkit.getScheduler().runTask(plugin,()->{
            if(current(p)!=r||!r.state.equals("running")||!r.nextStep().equals("planks_crafted"))return;
            int used=logs-count(p,Material.OAK_LOG)-matrixCount(inv,Material.OAK_LOG),made=count(p,Material.OAK_PLANKS)-planks;
            if(used<=0&&made<=0)return;
            if(used<r.definition.count()||made!=used*4){interrupt(r,"observation_unconfirmed");return;}
            JsonObject proof=new JsonObject();proof.addProperty("recipe","minecraft:oak_planks");proof.addProperty("logsConsumed",used);proof.addProperty("planksProduced",made);observed(r,p.getUniqueId(),"planks_crafted",proof);
        });
    }
    private static int matrixCount(CraftingInventory inv,Material material){int n=0;for(ItemStack item:inv.getMatrix())if(plain(item,material))n+=item.getAmount();return n;}
    void rescued(UUID rescuer,UUID target){
        Player p=Bukkit.getPlayer(rescuer),other=Bukkit.getPlayer(target);if(p==null||other==null)return;ChallengeRun r=running(p,"rescue");if(r==null||!r.contains(target)||!eligible(p)||!eligible(other))return;
        String context=plugin.dungeon().challengeContext(rescuer);if(context.isEmpty())context=plugin.siteDungeons().challengeContext(rescuer);if(context.isEmpty())return;
        var team=plugin.trialRescue().team(rescuer);if(team==null||!team.members().contains(target)||!team.contains().test(p.getLocation())||!team.contains().test(other.getLocation()))return;
        JsonObject proof=new JsonObject();proof.addProperty("activity",context);proof.addProperty("target",target.toString());proof.addProperty("healthAfter",other.getHealth());proof.addProperty("method","nearby_teammate_10_seconds");observed(r,rescuer,"teammate_revived",proof);
    }
    void roomCleared(String context,Set<UUID> present){
        for(UUID id:new HashSet<>(active.values())){ChallengeRun r=runs.get(id);if(!r.state.equals("running")||!r.definition.type().equals("rescue")||!present.containsAll(r.members.values()))continue;
            if(r.members.values().stream().map(Bukkit::getPlayer).anyMatch(p->!eligible(p)))continue;
            JsonObject proof=new JsonObject();proof.addProperty("activity",context);proof.addProperty("bothPresent",true);observed(r,r.members.get("rescuer"),"room_cleared",proof);
        }
    }
    private static ItemStack icon(Material material,String title,String... lines){ItemStack item=new ItemStack(material);var meta=item.getItemMeta();meta.setDisplayName(title);meta.setLore(Arrays.asList(lines));item.setItemMeta(meta);return item;}
    private void menu(Player p){
        Inventory inv=Bukkit.createInventory(null,45,"生活能力挑战");Map<Integer,String> actions=new HashMap<>();int slot=10;
        for(var d:catalog.values()){inv.setItem(slot,icon(Material.WRITABLE_BOOK,"§b"+d.title(),"§7"+d.roles().size()+"人 · "+d.seconds()/60+"分钟","§e点击查看说明"));actions.put(slot,"detail "+d.id());if(++slot>=22)break;}
        ChallengeRun r=current(p);if(r!=null){inv.setItem(31,icon(Material.CLOCK,"§e本轮进度 "+r.completed+"/"+r.definition.steps().size(),"§7点击查询；不会推进任务"));actions.put(31,"status");if(r.state.equals("forming")&&r.owner.equals(p.getUniqueId())){inv.setItem(33,icon(Material.LIME_DYE,"§a人员就位，开始计时"));actions.put(33,"begin");}inv.setItem(35,icon(Material.BARRIER,"§c取消本轮挑战","§7仅结束记录，保留物品与原任务"));actions.put(35,"cancel");}
        else {int index=27;for(ChallengeRun waiting:runs.values())if(waiting.state.equals("forming")&&index<31){inv.setItem(index,icon(Material.PLAYER_HEAD,"§a加入："+waiting.definition.title(),"§7点击选择尚空缺的分工"));actions.put(index++,"joinmenu "+waiting.id);}}
        inv.setItem(40,icon(Material.BOOK,"§b我的最近记录"));actions.put(40,"history");menus.put(inv,new Menu(p.getUniqueId(),actions));p.openInventory(inv);
    }
    private void detailMenu(Player p,String id){var d=catalog.get(id);if(d==null)return;detail(p,d);Inventory inv=Bukkit.createInventory(null,27,d.title());Map<Integer,String> actions=new HashMap<>();int i=0;for(String s:d.steps())inv.setItem(i++,icon(Material.PAPER,"§f"+step(s)));
        inv.setItem(13,icon(Material.LIME_DYE,"§a自愿报名","§7先报名、准备物资、队长开始计时","§7过程不额外发物品或发奖励"));actions.put(13,"start "+id);inv.setItem(22,icon(Material.ARROW,"§7返回"));actions.put(22,"menu");menus.put(inv,new Menu(p.getUniqueId(),actions));p.openInventory(inv);}
    private void joinMenu(Player p,UUID id){ChallengeRun r=runs.get(id);if(r==null||!r.state.equals("forming"))return;Inventory inv=Bukkit.createInventory(null,27,"选择本轮分工");Map<Integer,String> actions=new HashMap<>();int i=10;for(String role:r.definition.roles())if(!r.members.containsKey(role)){inv.setItem(i,icon(Material.LIME_DYE,"§a"+roleName(role),"§7点击本人加入该分工"));actions.put(i++,"join "+r.id+" "+role);}menus.put(inv,new Menu(p.getUniqueId(),actions));p.openInventory(inv);}
    @EventHandler(priority=EventPriority.HIGHEST) public void menuClick(InventoryClickEvent e){Menu m=menus.get(e.getView().getTopInventory());if(m==null)return;e.setCancelled(true);if(!(e.getWhoClicked() instanceof Player p)||!m.owner.equals(p.getUniqueId()))return;String action=m.actions.get(e.getRawSlot());if(action==null)return;p.closeInventory();if(action.startsWith("detail "))detailMenu(p,action.substring(7));else if(action.startsWith("joinmenu "))joinMenu(p,UUID.fromString(action.substring(9)));else command(p,("challenge "+action).split(" "));}
    @EventHandler(priority=EventPriority.HIGHEST) public void menuDrag(InventoryDragEvent e){if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
}
