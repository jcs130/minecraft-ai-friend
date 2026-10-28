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
    static boolean common(String raw){return COMMON.contains(skillId(raw.trim().split("\\s+",2)[0]));}
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
    JsonArray abilities(Player p){
        JsonObject s=state(p);JsonArray out=s.has("abilities")?s.getAsJsonArray("abilities"):new JsonArray();
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
            JsonObject s=state(p);if(!s.has("available")||!s.get("available").getAsBoolean()){p.sendMessage("§e角色仍在加载；稍后查询 /mycli status，未替你选职或接任务。");return true;}
            if(Arrays.asList(args).contains("--json")){var out=new JsonObject();out.addProperty("readOnly",true);out.addProperty("backend","vortex");out.addProperty("class",s.has("combat")?s.get("combat").getAsString():"");out.addProperty("helpCommand","/mycli --help");out.addProperty("rulesCommand","/mycli rules");out.addProperty("nextCommand","/mycli status");p.sendMessage("MC_INTRO "+out);return true;}
            p.sendMessage("§6[破晓攻略·MMORPG] 原版装备与附魔继续有效；旧四职业与专属技能已归档。基础生存技人人可用，无需选职或学习：/mycli skills list common。");
            boolean chosen=s.has("combat")&&!s.get("combat").getAsString().isEmpty();
            p.sendMessage("§b[1 职业] "+(chosen?"已选 "+s.get("combat").getAsString()+"，不用重选。":"先 /mycli profession list，再按本人偏好 profession choose <ID>；不自动选职。"));
            p.sendMessage("§b[2 技能] /mycli skills list 查本职可用技；skills info <ID>看目标、等级和耗魔；cast <ID>施放，skills prepare <ID>设置武器点击技；learn只按详情花点。");
            p.sendMessage("§b[3 冒险] /mycli tasks list → tasks info <ID> → tasks accept <ID>，打怪/探索后 tasks status/claim <ID>。四件护甲+本职业武器或法器备齐后 /mycli dungeon list。补给 guild shared；个人箱 arena stash。");
            return true;
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
            if(group.equals("status")&&args.length>1&&args[1].equalsIgnoreCase("full"))return false;
            if(Set.of("skills","spells","技能").contains(group)&&args.length>=3&&Set.of("info","explain","status").contains(args[1].toLowerCase(Locale.ROOT))&&COMMON.contains(skillId(args[2]))){
                if(Arrays.stream(args).skip(3).anyMatch(a->!a.equals("--json"))){p.sendMessage("§e[invalid_argument] 查询只接受一个技能ID；下一步：/mycli skills --help");return true;}
                var entry=SpellGuide.find(skillId(args[2]));var data=entry.json();data.addProperty("available",true);data.addProperty("common",true);data.addProperty("queryOnly",true);Long cooldown=owner.readBasicCooldown(p,entry.id());data.add("cooldownRemainingMs",cooldown==null?JsonNull.INSTANCE:new JsonPrimitive(cooldown));
                if(entry.id().equals("blink"))data.addProperty("aimHint","瞄准前方可站立的地面；平视空中可能没有合法落点，拒绝时不扣魔力。");
                if(Arrays.asList(args).contains("--json"))p.sendMessage("MC_RPG "+data);else p.sendMessage("§b[技能] "+entry.name()+"（"+entry.id()+"）；通用技能，无需学习；"+entry.effect()+"；目标："+entry.target()+"；"+entry.costLine()+(entry.id().equals("blink")?"；瞄准前方可站立的地面，空中无落点会拒绝":"")+"。用法："+entry.command());return true;
            }
            String[] normalized=args.clone();
            normalized[0]=switch(group){case "职业"->"profession";case "spells","技能"->"skills";case "任务路线"->"tasks";default->group;};
            if(normalized[0].equals("skills")&&normalized.length>2&&COMMON.contains(skillId(normalized[2])))normalized[2]=skillId(normalized[2]);
            boolean handled=delegate(p,normalized);if(group.equals("status")&&!Arrays.asList(args).contains("--json"))adventureProgress(p,false,false);return handled;
        }
        if(group.equals("cast")||group.equals("施法")||group.equals("咏唱")) {
            String id=args.length>1?skillId(args[1]):"";
            if(COMMON.contains(id)){
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
