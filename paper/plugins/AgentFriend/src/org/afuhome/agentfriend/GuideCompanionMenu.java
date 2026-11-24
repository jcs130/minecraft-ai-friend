package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.lang.reflect.InvocationTargetException;
import java.util.List;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import static org.afuhome.agentfriend.AdventureMenuModel.*;

/** The original guide body remains authoritative. This menu only projects owner actions. */
final class GuideCompanionMenu {
    private record Profession(String id,String label,String icon) {}
    private static final List<Profession> CLASSES=List.of(
        new Profession("knight","骑士","IRON_SWORD"),
        new Profession("mage","法师","BLAZE_ROD"),
        new Profession("ranger","游侠","BOW"),
        new Profession("cleric","牧师","GLISTERING_MELON_SLICE"),
        new Profession("beastmaster","驯兽师","LEAD"),
        new Profession("engineer","工程师","REDSTONE"));
    private final AgentFriendPlugin plugin;
    private final PlayerAdventureMenus menus;

    GuideCompanionMenu(AgentFriendPlugin plugin,PlayerAdventureMenus menus){this.plugin=plugin;this.menus=menus;}

    String view(Player player,Page page,String detail,List<Button> buttons){
        JsonObject state=status(player);
        if(!bool(state,"enabled"))return message(buttons,"伙伴暂未开放。");
        if(!state.has("guide")){
            buttons.add(action(22,"claim","LANTERN","领取我的伙伴"));
            return message(buttons,"领一位冒险伙伴。她可以陪你找路、练技能，也能听懂附近的文字和语音。");
        }
        var guide=state.getAsJsonObject("guide");
        if(!bool(guide,"confirmed"))return message(buttons,"正在核对原伙伴的领取记录。");
        var rpg=state.has("rpg")?state.getAsJsonObject("rpg"):new JsonObject();
        String summary=guide.get("name").getAsString();
        if(bool(rpg,"available")){
            String job=rpg.get("className").getAsString();
            summary+=" · Lv."+rpg.get("level").getAsInt()+" · "+(rpg.get("combat").getAsString().isBlank()?"未选职业":job);
        }
        if(page==Page.GUIDE_COMPANION){
            if(detail.startsWith("voices:")){
                if(!bool(state,"loaded"))return message(buttons,"原伙伴暂未加载，靠近后再选择声音。");
                try{
                    var catalog=invoke(player,"action","voices","");
                    var voices=catalog.getAsJsonArray("voices");
                    int pageIndex=Integer.parseInt(detail.substring(7));
                    int start=pageIndex*CONTENT.length;
                    for(int i=start;i<Math.min(voices.size(),start+CONTENT.length);i++){
                        var voice=voices.get(i).getAsJsonObject();
                        String id=voice.get("id").getAsString(),label=voice.get("name").getAsString();
                        buttons.add(new Button(CONTENT[i-start],Action.GUIDE_ACTION,"voice-select:"+id,"NOTE_BLOCK",
                            (bool(voice,"current")?"已选 · ":"")+label,
                            List.of(!bool(voice,"chatVoiceAvailable")?"仅预录事件音，聊天音色未接入":
                                bool(voice,"chineseFallback")?"原包音效保留，聊天使用中文音色":
                                bool(voice,"chineseChatVoice")?"中文声音包与中文聊天音色":"原包克隆音色，语言未确认",
                                "点击切换当前伙伴的声音包")));
                    }
                    if(pageIndex>0)buttons.add(action(28,"voices:"+(pageIndex-1),"ARROW","上一页"));
                    if(start+CONTENT.length<voices.size())buttons.add(action(30,"voices:"+(pageIndex+1),"ARROW","下一页"));
                    return message(buttons,summary+" · 声音选择\n中文聊天使用中文音色；非中文声音包保留原音效，聊天不硬用日语声线读中文。");
                }catch(Exception unavailable){return message(buttons,"靠近你的伙伴后选择声音包。也可输入 /qdmaid guide voice。");}
            }
            buttons.add(action(10,"recall","ENDER_PEARL","召回原伙伴"));
            if(bool(state,"loaded")){
                buttons.add(action(12,"bag","CHEST","整理伙伴装备"));
                buttons.add(action(14,"voices:0","NOTE_BLOCK","聊天音色与声音包"));
                buttons.add(action(16,"rename-help","NAME_TAG","更改名字"));
                buttons.add(button(20,Action.GUIDE_CLASS,"IRON_SWORD","选择职业"));
                buttons.add(button(24,Action.GUIDE_SKILLS,"ENCHANTED_BOOK","查看与学习技能"));
            }
            return message(buttons,summary+(bool(state,"loaded")?"\n靠近后叫她的名字，就可以说话。":"\n原伙伴暂未加载，可以尝试召回。"));
        }
        if(!bool(rpg,"available"))return message(buttons,summary+" · 正在读取职业档案。");
        if(page==Page.GUIDE_CLASS){
            if(!rpg.get("combat").getAsString().isBlank())return message(buttons,summary+" · 职业已选择。");
            for(int i=0;i<CLASSES.size();i++){
                Profession role=CLASSES.get(i);
                if(detail.isEmpty())buttons.add(new Button(CONTENT[i],Action.GUIDE_CLASS_DETAIL,role.id,role.icon,role.label,List.of("先查看确认")));
                else if(role.id.equals(detail)){
                    buttons.add(action(22,"choose:"+role.id,role.icon,"确认选择 · "+role.label));
                    return message(buttons,"给 "+guide.get("name").getAsString()+" 选择"+role.label+"。职业按现有 RPG 规则生效。");
                }
            }
            return message(buttons,summary+" · 请选择她要修习的职业。");
        }
        if(rpg.get("combat").getAsString().isBlank())return message(buttons,"先给伙伴选一个职业。");
        var learnable=rpg.has("learnable")?rpg.getAsJsonArray("learnable"):new com.google.gson.JsonArray();
        int points=rpg.get("skillPoints").getAsInt();
        String progress=summary+"\n学习点 "+points;
        if(!detail.isEmpty()&&!detail.startsWith("page:")){
            for(var node:learnable){
                var skill=node.getAsJsonObject();
                if(!detail.equals(skill.get("id").getAsString()))continue;
                String name=skill.get("name").getAsString();
                int cost=skill.get("cost").getAsInt(),level=skill.get("level").getAsInt();
                if(points>=cost&&rpg.get("level").getAsInt()>=level)buttons.add(action(22,"learn:"+detail,"ENCHANTED_BOOK","确认学习 · "+name));
                return message(buttons,progress+"\n"+name+" · "+cost+" 学习点 · Lv."+level);
            }
            return message(buttons,progress+"\n该技能已学会或当前不可学。");
        }
        int start=detail.startsWith("page:")?Integer.parseInt(detail.substring(5))*CONTENT.length:0;
        for(int i=start;i<Math.min(learnable.size(),start+CONTENT.length);i++){
            var skill=learnable.get(i).getAsJsonObject();
            buttons.add(new Button(CONTENT[i-start],Action.GUIDE_SKILL_DETAIL,skill.get("id").getAsString(),
                "ENCHANTED_BOOK",skill.get("name").getAsString(),
                List.of("Lv."+skill.get("level").getAsInt()+" · "+skill.get("cost").getAsInt()+" 学习点")));
        }
        if(start>0)buttons.add(new Button(28,Action.GUIDE_SKILL_DETAIL,"page:"+(start/CONTENT.length-1),"ARROW","上一页",List.of()));
        if(start+CONTENT.length<learnable.size())buttons.add(new Button(30,Action.GUIDE_SKILL_DETAIL,"page:"+(start/CONTENT.length+1),"ARROW","下一页",List.of()));
        if(rpg.has("abilities")&&!rpg.getAsJsonArray("abilities").isEmpty()){
            var spells=new java.util.ArrayList<String>();
            for(var ability:rpg.getAsJsonArray("abilities"))
                spells.add(ability.getAsJsonObject().get("name").getAsString());
            progress+="\n可施放 "+String.join("、",spells);
        }
        return message(buttons,progress);
    }

    private static Button action(int slot,String payload,String icon,String title){
        return new Button(slot,Action.GUIDE_ACTION,payload,icon,title,List.of());
    }
    private static String message(List<Button> buttons,String summary){
        buttons.add(button(4,Action.NONE,"LANTERN",summary.split("\n",2)[0],summary));
        return summary;
    }
    private static boolean bool(JsonObject row,String key){return row.has(key)&&row.get(key).getAsBoolean();}

    private JsonObject status(Player actor){
        try{return invoke(actor,null,"","");}
        catch(Exception incompatible){return new JsonObject();}
    }
    private JsonObject invoke(Player actor,String verb,String action,String value)throws Exception{
        var bridge=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");
        if(bridge==null||!bridge.isEnabled())return new JsonObject();
        String json=verb==null?(String)bridge.getClass().getMethod("playerGuideStatus",Player.class).invoke(bridge,actor)
            :(String)bridge.getClass().getMethod("playerGuideAction",Player.class,String.class,String.class)
                .invoke(bridge,actor,action,value);
        return JsonParser.parseString(json).getAsJsonObject();
    }

    void perform(Player actor,String payload){
        if(payload.startsWith("voices:")){
            menus.open(actor,Page.GUIDE_COMPANION,payload);
            return;
        }
        if(payload.equals("rename-help")){
            actor.sendMessage("§b先在铁砧上给命名牌改名，再拿着它使用你的伙伴。也可输入 /qdmaid guide rename <新名字>。");
            return;
        }
        String[] args=payload.split(":",2);
        try{
            var result=invoke(actor,"action",args[0],args.length==2?args[1]:"");
            if(result.has("requestId")&&args.length==2){
                complete(actor,result.get("requestId").getAsString(),args[0].equals("choose")?Page.GUIDE_CLASS:Page.GUIDE_SKILLS,0);
            }else if(args[0].equals("voice-select"))menus.open(actor,Page.GUIDE_COMPANION,"voices:0");
            else if(args[0].equals("claim"))menus.open(actor,Page.GUIDE_COMPANION,"");
        }catch(Exception error){
            Throwable cause=error instanceof InvocationTargetException?error.getCause():error;
            actor.sendMessage("§e伙伴 · "+(cause.getClass().getSimpleName().equals("CompatibilityException")
                ?cause.getMessage():"本次结果尚未确认，请重新查看原伙伴。"));
        }
    }

    private void complete(Player actor,String request,Page page,int attempts){
        if(!actor.isOnline())return;
        try {
            var result=invoke(actor,"action","receipt",request);
            String status=result.has("status")?result.get("status").getAsString():"unknown";
            if(status.equals("completed")){
                actor.sendMessage("§a伙伴的成长已保存。");
                if(attempts==0)menus.open(actor,page,"");
                return;
            }
            if(status.equals("accepted")&&attempts<5){
                Bukkit.getScheduler().runTaskLater(plugin,()->complete(actor,request,page,attempts+1),20);
                return;
            }
            actor.sendMessage("§e技能或职业未确认生效（"+status+"）。原请求 "+request);
        }catch(Exception unavailable){
            actor.sendMessage("§e暂时无法确认成长结果。原请求 "+request);
        }
    }
}
