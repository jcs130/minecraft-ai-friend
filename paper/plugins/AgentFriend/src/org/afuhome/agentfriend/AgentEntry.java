package org.afuhome.agentfriend;

import com.google.gson.*;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import java.io.File;
import java.util.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

/** Private, bounded, read-only discovery and progress. Does not dispatch actions. */
final class AgentEntry {
    private final AgentFriendPlugin plugin;
    private final List<String> rules;
    AgentEntry(AgentFriendPlugin plugin) {
        this.plugin=plugin;
        File file=new File(plugin.getDataFolder(),"agent-guide.yml");
        if(!file.exists())plugin.saveResource("agent-guide.yml",false);
        var settings=YamlConfiguration.loadConfiguration(file);
        var candidate=settings.getStringList("rules");
        if(candidate.isEmpty()||candidate.size()>16||candidate.stream().anyMatch(s->s.isBlank()||s.length()>240||s.contains("\n")))
            throw new IllegalArgumentException("agent-guide.yml: rules must contain 1..16 short lines");
        rules=List.copyOf(candidate);
    }
    private static boolean flag(JsonObject o,String key){return o.has(key)&&o.get(key).getAsBoolean();}
    private static String label(String status){return switch(status){case "none"->"未接单";case "active"->"进行中";case "ready_to_submit"->"待交付";case "needs_verification"->"待主动验收";default->"需核对数据";};}
    private static JsonArray commands(String... values){JsonArray a=new JsonArray();for(String value:values)a.add(value);return a;}
    void intro(Player p) {
        JsonObject onboarding=plugin.agentCoach().entryState(p),out=new JsonObject(),self=new JsonObject();
        out.addProperty("schemaVersion",1);out.addProperty("scope","self");out.addProperty("playerUuid",p.getUniqueId().toString());
        out.addProperty("language","zh-CN");out.addProperty("readOnly",true);out.addProperty("observedAt",System.currentTimeMillis());
        self.addProperty("name",p.getName());self.addProperty("mode",p.getGameMode().name());self.addProperty("health",p.getHealth());self.addProperty("food",p.getFoodLevel());
        var mana=AuraSkillsApi.get().getUser(p.getUniqueId());
        self.addProperty("manaLoaded",mana!=null&&mana.isLoaded());
        if(mana!=null&&mana.isLoaded()){self.addProperty("mana",mana.getMana());self.addProperty("maxMana",mana.getMaxMana());}
        self.addProperty("adventurerRank",plugin.guild().adventurerRankName(p));out.add("self",self);
        out.addProperty("rulesCommand","/mycli rules");out.addProperty("stateCommand","/mycli status");
        out.addProperty("capabilitiesCommand","/mycli capabilities");out.addProperty("progressCommand","/mycli progress");
        out.addProperty("nextCommand",onboarding.has("nextCommand")?onboarding.get("nextCommand").getAsString():"/mycli rules");
        out.addProperty("nextAdvice",onboarding.has("message")?onboarding.get("message").getAsString():"这是观战账号；在对应生存角色的连接上进行任务和存取。");
        out.addProperty("mainlineGraduated",flag(onboarding,"completed"));
        out.addProperty("normalHelpAllowed",p.hasPermission("essentials.help"));out.addProperty("normalRulesAllowed",p.hasPermission("essentials.rules"));
        out.addProperty("inventoryAdvice","存取以服务器槽位和光标核对；超时结果未知，先重新查询，不自动重放。54格大背包与任务袋、个人奖励箱独立。");
        p.sendMessage("§6【千灯纪入门】规则 /mycli rules；能力 /mycli capabilities；我的进度 /mycli progress。查询不报名、不接单。");
        p.sendMessage("§b【本人】"+p.getName()+" · "+self.get("adventurerRank").getAsString()+" · 生命 "+Math.round(p.getHealth())+" · 饱食 "+p.getFoodLevel()
                +(flag(self,"manaLoaded")?" · 魔力 "+Math.round(mana.getMana())+"/"+Math.round(mana.getMaxMana()):" · 魔力尚未加载，等候后再查"));
        p.sendMessage("§e【建议下一步】"+out.get("nextAdvice").getAsString()+" "+out.get("nextCommand").getAsString());
        plugin.communication().stamp(p,out);p.sendMessage("MC_INTRO "+out);
    }
    void rules(Player p,String[] args) {
        int page=1,pages=(rules.size()+3)/4;
        try{if(args.length>2)throw new NumberFormatException();if(args.length==2)page=Integer.parseInt(args[1]);if(page<1||page>pages)throw new NumberFormatException();}
        catch(NumberFormatException e){p.sendMessage("§e用 /mycli rules [页码] 阅读规则；页码 1–"+pages+"，所有已登录玩家可读。");return;}
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("readOnly",true);out.addProperty("page",page);out.addProperty("pages",pages);out.addProperty("total",rules.size());
        JsonArray rows=new JsonArray();
        for(int i=(page-1)*4;i<Math.min(page*4,rules.size());i++){rows.add(rules.get(i));p.sendMessage("§f"+(i+1)+". "+rules.get(i));}
        out.add("rules",rows);if(page<pages)out.addProperty("nextCommand","/mycli rules "+(page+1));
        plugin.communication().stamp(p,out);p.sendMessage("MC_RULES "+out);
    }
    void capabilities(Player p,String[] args) {
        if(args.length>1&&Set.of("info","explain").contains(args[1].toLowerCase(Locale.ROOT))) {
            AgentCliCatalog.explain(p,args,2,false);return;
        }
        int from=args.length>1&&args[1].equalsIgnoreCase("list")?2:1;
        String[] listing=new String[args.length-from+1];listing[0]="list";
        System.arraycopy(args,from,listing,1,args.length-from);AgentCliCatalog.list(p,listing,false);
    }
    void progress(Player p,String[] args) {
        String filter=args.length>1?args[1].toLowerCase(Locale.ROOT):"all";
        if(args.length>3||!Set.of("all","main","training","guild").contains(filter)){plugin.communication().error(p,"INVALID_ARGUMENT","/mycli progress [all|main|training|guild] [页码]：第三个参数启用按需分页；查询不接单、不领奖。",false,"/mycli progress all 1");return;}
        List<JsonObject> rows=progressRows(p,filter);
        if(args.length==3) {
            try{plugin.communication().list(p,"progress","/mycli progress "+filter+" 1",rows,Integer.parseInt(args[2]));}
            catch(NumberFormatException invalid){plugin.communication().error(p,"INVALID_PAGE","页码必须是整数。",false,"/mycli progress "+filter+" 1");}
            return;
        }
        // Preserve the old MC_PROGRESS stream. Explicit paging opts into MC_PAGE.
        String snapshot=UUID.randomUUID().toString();long at=System.currentTimeMillis();
        for(int i=0;i<rows.size();i++) {
            JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("snapshotId",snapshot);
            out.addProperty("scope","self");out.addProperty("playerUuid",p.getUniqueId().toString());out.addProperty("readOnly",true);
            out.addProperty("page",i+1);out.addProperty("pages",rows.size());out.addProperty("total",rows.size());out.add("progress",rows.get(i));
            plugin.communication().stamp(p,out);
            out.addProperty("observedAt",at);
            if(out.toString().length()>3000) {
                out.remove("progress");out.addProperty("status","detail_available");out.addProperty("reason","progress_row_requires_pages");
                try{String detail=plugin.communication().store(p,"progress","/mycli progress "+filter+" 1",List.of(rows.get(i)));
                    out.addProperty("nextCommand","/mycli page "+detail+" 1");}
                catch(IllegalArgumentException tooLarge){out.addProperty("status","too_large");out.addProperty("nextCommand","/mycli progress "+filter+" 1");}
            }
            p.sendMessage("MC_PROGRESS "+out);
        }
    }
    List<JsonObject> progressRows(Player p,String filter) {
        if(plugin.isObserver(p)){JsonObject row=new JsonObject();row.addProperty("eligible",false);row.addProperty("reason","observer");row.addProperty("nextCommand","/mycli intro");return List.of(row);}
        JsonObject state=plugin.agentCoach().entryState(p),features=plugin.featureTutorials().progressState(p);
        var rows=new ArrayList<JsonObject>();
        if(filter.equals("all")||filter.equals("main")) {
            JsonObject main=new JsonObject();main.addProperty("section","main");main.addProperty("title","新手主线");
            main.addProperty("stage",state.get("step").getAsString());main.addProperty("graduated",flag(state,"completed"));
            main.addProperty("stageTitle",state.get("title").getAsString());main.addProperty("nextCommand",state.get("nextCommand").getAsString());
            main.add("conditions",state.get("checklist").deepCopy());JsonArray missing=new JsonArray();
            for(var e:state.getAsJsonArray("checklist"))if(!flag(e.getAsJsonObject(),"done"))missing.add(e.getAsJsonObject().get("title").getAsString());
            main.add("missingConditions",missing);var internship=state.getAsJsonObject("guide").deepCopy();
            internship.addProperty("completed",flag(internship,"catalog")&&flag(internship,"cast")&&flag(internship,"life"));main.add("internship",internship);
            main.addProperty("meaning","专项实练、三证实习和整条主线分别验收；只有graduated=true才表示入门主线完成。");rows.add(main);
        }
        if(filter.equals("all")||filter.equals("training")) {
            int done=0;for(var element:features.getAsJsonArray("lessons")) {
                JsonObject row=element.getAsJsonObject().deepCopy();row.addProperty("section","training");row.addProperty("enrolled",flag(features,"enrolled"));
                if(flag(row,"done"))done++;rows.add(row);
            }
        }
        if(filter.equals("all")||filter.equals("guild")) {
            JsonObject adventure=plugin.guild().progressState(p);adventure.addProperty("section","guild");rows.add(adventure);
            JsonObject life=plugin.lifeGuild().onboardingState(p);life.addProperty("section","guild");life.addProperty("kind","life");
            boolean active=!life.get("activeId").getAsString().isEmpty();life.addProperty("status",!active?"none":flag(life,"ready")?"ready_to_submit":"active");
            life.addProperty("nextCommand",!active?"/mycli life board":flag(life,"ready")?"/mycli life claim":"/mycli life status");
            JsonArray missing=new JsonArray();
            if(active)missing.add(life.has("missingAdvice")?life.get("missingAdvice").getAsString():flag(life,"ready")?"尚需 life claim 交付":"继续实际行动："+life.get("instruction").getAsString());
            life.add("missingConditions",missing);rows.add(life);
            JsonObject academy=plugin.skillAssessments().summary(p);academy.addProperty("section","guild");academy.addProperty("kind","assessment");academy.addProperty("title","能力认证与晋级考试");
            academy.addProperty("nextCommand","/mycli guild exam status");academy.add("missingConditions",academy.has("nextAction")?commands(academy.get("nextAction").getAsString()):new JsonArray());rows.add(academy);
        }
        return rows;
    }
}
