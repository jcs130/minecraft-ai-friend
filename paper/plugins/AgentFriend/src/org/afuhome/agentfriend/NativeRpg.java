package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/** Optional Vortex front door. Legacy storage stays read-only; no second RPG engine. */
final class NativeRpg {
    static final List<String> COMMON_IDS = List.of("home","selfheal","food","blink","starbolt","frostnova","give","travel","prospect","night","feather");
    static final Set<String> COMMON = Set.copyOf(COMMON_IDS);
    private final AgentFriendPlugin owner;
    private final boolean selected;
    NativeRpg(AgentFriendPlugin owner) {
        this.owner=owner;
        selected="vortex".equals(owner.getConfig().getString("rpg-backend", "legacy"));
    }
    boolean selected(){return selected;}
    private void invocationIndex(Player p){
        var out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("kind","skill_invocations");
        out.addProperty("queryOnly",true);var entries=new JsonArray();var commands=new LinkedHashMap<String,String>();
        for(String id:COMMON_IDS){var e=commonGuide(id);var row=new JsonObject();
            row.addProperty("id",id);commands.put(id,e.command());
            row.add("invocation",new Gson().toJsonTree(AgentCommunicationContract.invocation(id,e.command())));entries.add(row);}
        out.addProperty("revision",AgentCommunicationContract.invocationRevision(commands));
        out.add("entries",entries);p.sendMessage("MC_RPG "+out);
    }
    static boolean common(String raw){return COMMON.contains(skillId(raw.trim().split("\\s+",2)[0]));}
    private static SpellGuide.Entry commonGuide(String id){
        var e=SpellGuide.find(id);String scaling=switch(id){
            case "starbolt"->"固定基础伤害5；Vortex角色每20级+1，最多+2；不再计旧熟练度。";
            case "frostnova"->"基础伤害2、减速4秒；Vortex角色每20级+1伤害，最多+2；不再计旧熟练度。";
            case "prospect"->"基础半径24格；Vortex角色每5级+2，最多40；刻印工具再+8；固定标记12秒。";
            default->"基础效果固定；当前职业成长统一用Vortex学习点和天赋。";
        };
        String requires="通用技能，无需选职或学习；使用同一个Vortex魔力池与原冷却。"+(Set.of("night","feather").contains(id)?"":e.requires());
        String tip=id.equals("selfheal")?"给自己恢复生命；团队治疗使用本职已学技能，查询 /mycli skills list。":e.tip();
        String name=id.equals("frostnova")?"寒霜术（霜环）":e.name();
        return new SpellGuide.Entry(e.id(),name,e.category(),e.icon(),e.command(),e.effect(),e.target(),e.mana(),e.cooldownSeconds(),requires,e.failure(),scaling,tip);
    }
    static String skillId(String id){return switch(id.toLowerCase(Locale.ROOT)){case "归乡","归乡术","回城"->"home";case "传送点术"->"travel";case "探矿","探矿术"->"prospect";case "夜视","夜视术"->"night";case "羽落","羽落术"->"feather";case "圣愈术"->"selfheal";case "范围治疗"->"heal";case "饱食术"->"food";case "闪现术","闪现"->"blink";case "星芒箭"->"starbolt";case "寒霜","寒霜术","冰霜","霜环","霜环术"->"frostnova";case "造物","造物术"->"give";case "焰浪"->"flamewave";case "飞行术"->"flight";case "跃空术"->"leap";case "探敌术","心眼"->"sense";default->id.toLowerCase(Locale.ROOT);};}
    private Plugin backend() {
        Plugin p=Bukkit.getPluginManager().getPlugin("QiandengjiRpg");
        if(p==null||!p.isEnabled())throw new IllegalStateException("RPG服务未就绪；稍后查询 /mycli status，不要重复执行。");
        return p;
    }
    private Object call(String method,Class<?>[] types,Object...args) {
        try {return backend().getClass().getMethod(method,types).invoke(backend(),args);}
        catch(Exception error){throw new IllegalStateException("RPG资料暂不可用；稍后查询 /mycli status，不要重复执行。");}
    }
    JsonObject state(Player p) {
        try{return JsonParser.parseString((String)call("selfState",new Class<?>[]{Player.class},p)).getAsJsonObject();}
        catch(RuntimeException unavailable){var out=new JsonObject();out.addProperty("available",false);out.addProperty("backend","vortex");return out;}
    }
    JsonElement mana(Player p){JsonObject s=state(p);return s.has("mana")?s.get("mana"):JsonNull.INSTANCE;}
    JsonObject party(Player p){
        try{return JsonParser.parseString((String)call("partyState",new Class<?>[]{Player.class},p)).getAsJsonObject();}
        catch(RuntimeException unavailable){var out=new JsonObject();out.addProperty("available",false);return out;}
    }
    JsonObject viewerState(Player p){
        try{return JsonParser.parseString((String)call("viewerState",new Class<?>[]{Player.class},p)).getAsJsonObject();}
        catch(RuntimeException unavailable){var out=new JsonObject();out.addProperty("available",false);out.addProperty("backend","vortex");return out;}
    }
    JsonObject recyclingState(Player p){
        try{return JsonParser.parseString((String)call("recyclingState",new Class<?>[]{Player.class},p)).getAsJsonObject();}
        catch(RuntimeException unavailable){var out=new JsonObject();out.addProperty("available",false);out.addProperty("pending",true);return out;}
    }
    void settleRecycling(Player p,String quote,long coins,String snapshot,Runnable remove,java.util.function.Consumer<String> finish){
        call("settleRecycling",new Class<?>[]{Player.class,String.class,long.class,String.class,Runnable.class,java.util.function.Consumer.class},p,quote,coins,snapshot,remove,finish);
    }
    double goldBalance(UUID owner){return ((Number)call("goldBalance",new Class<?>[]{UUID.class},owner)).doubleValue();}
    JsonObject settleMoney(Player p,String request,long delta,String snapshot,Runnable domainWrite){
        return JsonParser.parseString((String)call("settleMoney",new Class<?>[]{Player.class,String.class,long.class,String.class,Runnable.class},p,request,delta,snapshot,domainWrite)).getAsJsonObject();
    }
    void saveConfigVerified(){
        java.nio.file.Path file=owner.getDataFolder().toPath().resolve("config.yml"),temp=file.resolveSibling("config.yml.gold.tmp");
        try{
            byte[] bytes=owner.getConfig().saveToString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            try(var channel=java.nio.channels.FileChannel.open(temp,java.nio.file.StandardOpenOption.CREATE,java.nio.file.StandardOpenOption.TRUNCATE_EXISTING,java.nio.file.StandardOpenOption.WRITE)){
                var buffer=java.nio.ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
            }
            java.nio.file.Files.move(temp,file,java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }catch(java.io.IOException error){throw new IllegalStateException("domain save unconfirmed",error);}
    }
    JsonArray abilities(Player p){
        return abilities(p,state(p));
    }
    JsonArray abilities(Player p,JsonObject s){
        JsonArray out=s.has("abilities")?s.getAsJsonArray("abilities"):new JsonArray();
        if(!s.has("mana"))return out;
        for(String id:COMMON_IDS){
            var guide=SpellGuide.find(id);var row=new JsonObject();row.addProperty("id","mycli:"+id);row.addProperty("name",guide.name());row.addProperty("level",1);
            row.addProperty("cooldownMs",guide.cooldownSeconds()*1000L);Long left=owner.readBasicCooldown(p,id);
            row.add("cooldownRemainingMs",left==null?JsonNull.INSTANCE:new JsonPrimitive(left));row.addProperty("manaCost",guide.mana());
            row.addProperty("icon","minecraft:"+guide.icon().name().toLowerCase(Locale.ROOT));out.add(row);
        }return out;
    }
    int level(Player p){var s=state(p);return s.has("level")?s.get("level").getAsInt():1;}
    boolean usableClassItem(Player p){
        try{return Boolean.TRUE.equals(call("hasUsableDungeonWeapon",new Class<?>[]{Player.class},p));}
        catch(RuntimeException unavailable){return false;}
    }
    String profession(Player p){var s=state(p);return s.has("combat")?s.get("combat").getAsString():"";}
    boolean hasMana(Player p,double amount){
        if(!Double.isFinite(amount)||amount<0)return false;
        JsonElement value=mana(p);
        if(!value.isJsonObject()){p.sendMessage("§eRPG魔力资料仍在加载；稍后 /mycli status。");return false;}
        boolean enough=value.getAsJsonObject().get("current").getAsDouble()+.0001>=amount;
        if(!enough)p.sendMessage("§e魔力不足，需要 "+Math.round(amount)+"；等恢复后再试。查询：/mycli status");
        return enough;
    }
    boolean spend(Player p,double amount){
        if(!Double.isFinite(amount)||amount<0)return false;
        try{return (Boolean)call("consumeCommonMana",new Class<?>[]{Player.class,double.class},p,amount);}
        catch(RuntimeException e){p.sendMessage("§eRPG魔力服务未就绪，本次未执行；查询：/mycli status");return false;}
    }
    boolean delegate(Player p,String...args) {
        try {backend();}
        catch(RuntimeException e){p.sendMessage("§e"+e.getMessage());return true;}
        // dispatchCommand does not produce a chat packet, and validation remains
        // in the native adapter. No console escalation or guessed player name.
        Bukkit.dispatchCommand(p,"qdrpg "+String.join(" ",args));return true;
    }
    void siteCompleted(Player p,String site,String run){
        try{call("recordDungeonCompletion",new Class<?>[]{Player.class,String.class,String.class},p,site,run);}
        catch(RuntimeException unavailable){owner.getLogger().warning("Native RPG objective pending verification for "+p.getUniqueId()+" / "+site+"; original dungeon receipt retained");}
    }
    private void adventureProgress(Player p,boolean json,boolean details){
        var exam=owner.skillAssessments().summary(p);var guild=owner.guild().progressState(p);
        if(json){var out=new JsonObject();out.addProperty("rank",owner.guild().adventurerRankName(p));out.addProperty("reputation",owner.guild().reputation(p));out.add("exam",exam);out.add("guild",guild);p.sendMessage("MC_ADVENTURE "+out);return;}
        if(!details){p.sendMessage("§b[冒险] "+owner.guild().adventurerRankName(p)+"；声望 "+owner.guild().reputation(p)+"；证书 "+exam.get("certificateCount").getAsInt()+"；"+(owner.isDowned(p)?"倒地，等待队友救援":owner.dungeonParticipant(p)?"副本参战中":owner.pvpParticipant(p)?"竞技中":"自由活动")+"。分项进度：/mycli progress");return;}
        p.sendMessage("§b[冒险] "+owner.guild().adventurerRankName(p)+"；声望 "+owner.guild().reputation(p)+"；证书 "+exam.get("certificateCount").getAsInt()+"。考试：/mycli guild exam status；探索委托：/mycli guild status；攻略与积分：/mycli dungeon status");
        if(details&&exam.has("nextCommand"))p.sendMessage("§e[考试下一步] "+exam.get("nextAction").getAsString()+" "+exam.get("nextCommand").getAsString());
        if(details&&!guild.get("status").getAsString().equals("none"))p.sendMessage("§e[在途委托] "+guild.get("title").getAsString()+"；下一步："+guild.get("nextCommand").getAsString());
    }
    private boolean journey(Player p,boolean intro,boolean json){
        try{
            var context=new JsonObject();context.addProperty("canAct",owner.nativeRpgMayAct(p));
            context.addProperty("downed",owner.isDowned(p));context.addProperty("inDungeon",owner.dungeonParticipant(p));
            context.addProperty("keepInventory",Boolean.TRUE.equals(p.getWorld().getGameRuleValue(org.bukkit.GameRule.KEEP_INVENTORY)));
            if(owner.trialRescue()!=null)context.add("rescue",owner.trialRescue().state(p));
            if(owner.dungeon().isParticipant(p))context.add("trial",owner.dungeon().guidance(p));
            var guild=owner.guild().progressState(p);
            if(guild.has("activeId")&&!guild.get("activeId").getAsString().isEmpty()&&!(guild.has("retired")&&guild.get("retired").getAsBoolean())){
                var brief=new JsonObject();for(String key:List.of("activeId","title","status","nextCommand","advice","requiresWorldAction"))if(guild.has(key))brief.add(key,guild.get(key).deepCopy());
                if(brief.has("advice")&&brief.get("advice").getAsString().length()>500)brief.addProperty("advice",brief.get("advice").getAsString().substring(0,500));
                context.add("guild",brief);
            }
            context.add("missingEquipment",new Gson().toJsonTree(DungeonLoadout.missing(p)));
            for(String id:List.of("food","selfheal")){
                Long left=owner.readBasicCooldown(p,id);context.add(id+"CooldownMs",left==null?JsonNull.INSTANCE:new JsonPrimitive(left));
            }
            call("describeJourney",new Class<?>[]{Player.class,String.class,boolean.class,boolean.class},p,context.toString(),intro,json);
        }catch(RuntimeException unavailable){p.sendMessage("§e[service_unavailable] RPG指引资料暂不可用；未替你选职或接任务。稍后查询：/mycli status");}
        // status/intro/status full all return through this fast path before the
        // generic delegate branch below. Publish the actual chat observation here.
        owner.communication().chatPolicy(p,json);
        return true;
    }
    boolean route(Player p,String[] args) {
        if(!selected)return false;
        if(args.length==0){AgentCliCatalog.commandHelp(p,new String[]{"--help"});return true;}
        // Global output flags work before the group as well as after its arguments.
        if(args[0].equals("--json")){
            if(args.length==1){AgentCliCatalog.commandHelp(p,new String[]{"--help","--json"});return true;}
            var words=new ArrayList<>(Arrays.asList(args));words.removeIf(a->a.equals("--json"));
            if(words.isEmpty()){AgentCliCatalog.commandHelp(p,new String[]{"--help","--json"});return true;}
            words.add("--json");String[] moved=words.toArray(String[]::new);
            return route(p,moved);
        }
        String group=args[0].toLowerCase(Locale.ROOT);
        if(group.equals("class"))group="profession";
        if(group.equals("quests"))group="tasks";
        if(group.equals("rpg"))return route(p,Arrays.copyOfRange(args,1,args.length));
        if(group.equals("help")&&!(args.length==2&&args[1].equalsIgnoreCase("full"))){AgentCliCatalog.commandHelp(p,Arrays.copyOfRange(args,1,args.length));return true;}
        // Use the shared catalog, including all existing non-RPG groups and pages.
        // Archive text after -- is literal, so its original parser retains control.
        if(!Set.of("archive","档案").contains(group)&&Arrays.stream(args).anyMatch(a->a.equals("--help")||a.equals("-h"))){AgentCliCatalog.commandHelp(p,args);return true;}
        if(group.equals("tasks")&&args.length>1){
            String action=args[1].toLowerCase(Locale.ROOT);
            if(Set.of("menu","pause","resume").contains(action)||action.equals("list")&&args.length>2&&!args[2].startsWith("--"))return false;
            if(action.equals("info")&&args.length>2){
                try{if(!Boolean.TRUE.equals(call("hasQuest",new Class<?>[]{String.class},args[2])))return false;}
                catch(RuntimeException unavailable){return delegate(p,args);}
            }
        }
        if(group.equals("guide")&&(args.length==1||Set.of("start","magic","next","onboarding").contains(args[1])))return route(p,Arrays.asList(args).contains("--json")?new String[]{"intro","--json"}:new String[]{"intro"});
        if(group.equals("intro")){
            if(Arrays.stream(args).skip(1).anyMatch(a->!a.equals("--json"))){p.sendMessage("§e[invalid_argument] intro 无位置参数；未执行。下一步：/mycli intro");return true;}
            return journey(p,true,Arrays.asList(args).contains("--json"));
        }
        if(group.equals("status")&&Arrays.stream(args).skip(1).allMatch(a->a.equals("--json"))){
            boolean json=Arrays.asList(args).contains("--json");journey(p,false,json);if(!json)adventureProgress(p,false,false);return true;
        }
        if(group.equals("trade")&&args.length>=2&&Set.of("wallet","auction").contains(args[1].toLowerCase(Locale.ROOT))){
            try{call("tradeCommand",new Class<?>[]{Player.class,String[].class},p,Arrays.copyOfRange(args,1,args.length));}
            catch(RuntimeException unavailable){p.sendMessage("§e[service_unavailable] 金币资料暂不可用；未进行交易。稍后查询：/mycli trade wallet");}return true;
        }
        if(group.equals("progress")){
            // Explicit legacy sections must reach their real parser, never be ignored.
            if(Arrays.stream(args).skip(1).anyMatch(a->!a.equals("--json")))return false;
            boolean json=Arrays.asList(args).contains("--json");delegate(p,json?new String[]{"tasks","status","--json"}:new String[]{"tasks","status"});adventureProgress(p,json,true);return true;
        }
        if(group.equals("guild")&&args.length>=2&&args[1].equalsIgnoreCase("party")){
            try{call("partyCommand",new Class<?>[]{Player.class,String[].class},p,Arrays.copyOfRange(args,2,args.length));}
            catch(RuntimeException e){p.sendMessage("§e[service_unavailable] 组队服务暂不可用；先查 /mycli guild party status，不重复创建或接受邀请。");}return true;
        }
        if(Set.of("status","profession","职业","skills","spells","技能","tasks","任务路线").contains(group)) {
            if(Set.of("skills","spells","技能").contains(group)&&args.length>=3&&args[1].equalsIgnoreCase("list")&&args[2].equalsIgnoreCase("passive")){
                for(int i=3;i<args.length;i++)if(!args[i].equals("--json")){p.sendMessage("§e[invalid_argument] passive 仅接受可选--json；未执行。下一步：/mycli skills list passive");return true;}
                FoundationGrowth.describe(p,Arrays.asList(args).contains("--json"));return true;
            }
            if(group.equals("status")&&args.length>1&&args[1].equalsIgnoreCase("full")){
                if(Arrays.stream(args).skip(2).anyMatch(a->!a.equals("--json"))){p.sendMessage("§e[invalid_argument] status full 仅接受可选--json；未执行。下一步：/mycli status");return true;}
                boolean json=Arrays.asList(args).contains("--json");journey(p,false,json);if(!json)adventureProgress(p,false,false);return true;
            }
            if(Set.of("skills","spells","技能").contains(group)&&args.length>=3&&Set.of("info","explain","status").contains(args[1].toLowerCase(Locale.ROOT))&&COMMON.contains(skillId(args[2]))){
                if(Arrays.stream(args).skip(3).anyMatch(a->!a.equals("--json"))){p.sendMessage("§e[invalid_argument] 查询只接受一个技能ID；下一步：/mycli skills --help");return true;}
                var entry=commonGuide(skillId(args[2]));var data=entry.json();data.addProperty("available",true);data.addProperty("common",true);data.addProperty("queryOnly",true);
                data.add("invocation",new Gson().toJsonTree(AgentCommunicationContract.invocation(entry.id(),entry.command())));
                Long cooldown=owner.readBasicCooldown(p,entry.id());data.add("cooldownRemainingMs",cooldown==null?JsonNull.INSTANCE:new JsonPrimitive(cooldown));
                if(entry.id().equals("blink"))data.addProperty("aimHint","瞄准安全地面优先到该处；平视空气时沿水平朝向选25格内最远安全落点。不会穿墙、穿封闭天花板或落入悬空/危险地面；拒绝不扣魔力或冷却。");
                if(Arrays.asList(args).contains("--json"))p.sendMessage("MC_RPG "+data);else p.sendMessage("§b[技能] "+entry.name()+"（"+entry.id()+"）；通用技能，无需学习；"+entry.effect()+"；目标："+entry.target()+"；"+entry.costLine()+"；当前冷却 "+(cooldown==null?"未知，请先核对":cooldown==0?"已就绪":((cooldown+999)/1000)+"秒，等结束后再施放")+(entry.id().equals("blink")?"；不会穿墙或进入危险落点；拒绝未耗魔、无冷却":"")+"。用法："+entry.command());return true;
            }
            String[] normalized=args.clone();
            normalized[0]=switch(group){case "职业"->"profession";case "spells","技能"->"skills";case "任务路线"->"tasks";default->group;};
            if(normalized[0].equals("skills")&&normalized.length>2&&COMMON.contains(skillId(normalized[2])))normalized[2]=skillId(normalized[2]);
            boolean handled=delegate(p,normalized);
            if(handled&&normalized[0].equals("skills")&&(normalized.length==1||Set.of("status","list").contains(normalized[1].toLowerCase(Locale.ROOT)))
                &&(normalized.length<3||normalized[2].equals("--json"))){
                if(Arrays.asList(args).contains("--json"))invocationIndex(p);
                else p.sendMessage("§7[技能用法] travel 是地点管理：/mycli waypoint menu；其他技能先查 /mycli skills info <ID>，按其用法执行。");
            }
            if(group.equals("status")&&!Arrays.asList(args).contains("--json"))adventureProgress(p,false,false);return handled;
        }
        if(group.equals("cast")||group.equals("施法")||group.equals("咏唱")) {
            String id=args.length>1?skillId(args[1]):"";
            if(COMMON.contains(id)){
                var entry=commonGuide(id);
                if(!AgentCommunicationContract.castable(id,entry.command())){
                    var data=entry.json();data.addProperty("success",false);data.addProperty("changed",false);
                    data.addProperty("reason","command_route_mismatch");data.addProperty("queryOnly",false);
                    data.addProperty("nextCommand",entry.command());
                    data.add("invocation",new Gson().toJsonTree(AgentCommunicationContract.invocation(id,entry.command())));
                    if(Arrays.asList(args).contains("--json"))p.sendMessage("MC_RPG "+data);
                    else p.sendMessage("§e[command_route_mismatch] "+entry.name()+"不是cast入口；用法："+entry.command()+"。本次未执行、未扣费；不能将原参数直接附加到新入口。");
                    return true;
                }
                boolean unsupported=Arrays.stream(args).skip(2).anyMatch(a->a.startsWith("-"));
                boolean excess=!Set.of("give","prospect").contains(id)&&args.length>2||id.equals("prospect")&&args.length>3;
                if(unsupported||excess){
                    var data=new JsonObject();data.addProperty("success",false);data.addProperty("reason",unsupported?"unsupported_format":"invalid_argument");data.addProperty("changed",false);data.addProperty("nextCommand","/mycli skills info "+id);
                    data.addProperty("message",unsupported?"基础技能沿用原效果回执，请去掉格式选项；本次未执行":"参数过多；本次未执行");
                    if(Arrays.asList(args).contains("--json"))p.sendMessage("MC_RPG "+data);else p.sendMessage("§e[invalid_argument] "+data.get("message").getAsString()+"。下一步：/mycli skills info "+id);return true;
                }
                return false;
            }
            String[] normalized=args.clone();normalized[0]="cast";if(normalized.length>1)normalized[1]=id;return delegate(p,normalized);
        }
        return false;
    }
}
