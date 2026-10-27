package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/** Optional Vortex front door. Legacy storage stays read-only; no second RPG engine. */
final class NativeRpg {
    static final Set<String> COMMON = Set.of("home", "travel", "prospect", "night", "feather");
    private final AgentFriendPlugin owner;
    private final boolean selected;
    NativeRpg(AgentFriendPlugin owner) {
        this.owner=owner;
        selected="vortex".equals(owner.getConfig().getString("rpg-backend", "legacy"));
    }
    boolean selected(){return selected;}
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
        for(String id:List.of("home","travel","prospect","night","feather")){
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
    private void adventureProgress(Player p,boolean json){
        var exam=owner.skillAssessments().summary(p);var guild=owner.guild().progressState(p);
        if(json){var out=new JsonObject();out.addProperty("rank",owner.guild().adventurerRankName(p));out.addProperty("reputation",owner.guild().reputation(p));out.add("exam",exam);out.add("guild",guild);p.sendMessage("MC_ADVENTURE "+out);return;}
        p.sendMessage("§b[冒险] "+owner.guild().adventurerRankName(p)+"；声望 "+owner.guild().reputation(p)+"；证书 "+exam.get("certificateCount").getAsInt()+"。考试：/mycli guild exam status；探索委托：/mycli guild status；攻略与积分：/mycli dungeon status");
        if(exam.has("nextCommand"))p.sendMessage("§e[考试下一步] "+exam.get("nextAction").getAsString()+" "+exam.get("nextCommand").getAsString());
        if(!guild.get("status").getAsString().equals("none"))p.sendMessage("§e[在途委托] "+guild.get("title").getAsString()+"；下一步："+guild.get("nextCommand").getAsString());
    }
    boolean route(Player p,String[] args) {
        if(!selected)return false;
        if(args.length==0)return delegate(p,"--help");
        String group=args[0].toLowerCase(Locale.ROOT);
        if(group.equals("class"))group="profession";
        if(group.equals("quests"))group="tasks";
        if(group.equals("tasks")&&args.length>1){
            String action=args[1].toLowerCase(Locale.ROOT);
            if(Set.of("menu","pause","resume").contains(action)||action.equals("list")&&args.length>2&&!args[2].equals("--json"))return false;
            if(action.equals("info")&&args.length>2){
                try{if(!Boolean.TRUE.equals(call("hasQuest",new Class<?>[]{String.class},args[2])))return false;}
                catch(RuntimeException unavailable){return delegate(p,args);}
            }
        }
        if(group.equals("rpg"))return route(p,Arrays.copyOfRange(args,1,args.length));
        if(group.equals("help")&&args.length>1&&!Set.of("profession","skills","cast","tasks","status").contains(args[1].toLowerCase(Locale.ROOT)))return false;
        if(Set.of("help","--help","-h","guide","capabilities","list").contains(group)){
            if(group.equals("help")&&args.length>1)return delegate(p,args[1],"--help");
            return delegate(p,"--help");
        }
        if(group.equals("intro")){
            p.sendMessage("§6[入门] 规则：/mycli rules；先选职业，再学技能、打怪练级、组队攻略。公共装备：/mycli guild shared");
            return delegate(p,"status");
        }
        if(group.equals("progress")){delegate(p,Arrays.asList(args).contains("--json")?new String[]{"tasks","status","--json"}:new String[]{"tasks","status"});adventureProgress(p,Arrays.asList(args).contains("--json"));return true;}
        if(group.equals("guild")&&args.length>=2&&args[1].equalsIgnoreCase("party")){
            try{backend();}catch(RuntimeException e){p.sendMessage("§e"+e.getMessage());return true;}
            Bukkit.dispatchCommand(p,"vortexrpg:party "+String.join(" ",Arrays.copyOfRange(args,2,args.length)));return true;
        }
        if(Set.of("status","profession","职业","skills","spells","技能","tasks","任务路线").contains(group)) {
            String[] normalized=args.clone();
            normalized[0]=switch(group){case "职业"->"profession";case "spells","技能"->"skills";case "任务路线"->"tasks";default->group;};
            boolean handled=delegate(p,normalized);if(group.equals("status")&&!Arrays.asList(args).contains("--json"))adventureProgress(p,false);return handled;
        }
        if(group.equals("cast")||group.equals("施法")||group.equals("咏唱")) {
            String id=args.length>1?args[1].toLowerCase(Locale.ROOT):"";
            if(COMMON.contains(id))return false;
            String[] normalized=args.clone();normalized[0]="cast";return delegate(p,normalized);
        }
        return false;
    }
}
