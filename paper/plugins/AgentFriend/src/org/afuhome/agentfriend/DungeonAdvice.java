package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Presentation of server observations only. Never starts a run, changes a
 * frozen task, spends mana, awards progress or polls an unavailable dungeon. */
final class DungeonAdvice {
    private DungeonAdvice() { }
    record Request(String[] args,boolean json,boolean verbose,int page) { }
    static final class Usage extends IllegalArgumentException {
        final String nextCommand;
        Usage(String message,String nextCommand){super(message);this.nextCommand=nextCommand;}
    }
    static Request parse(String[] raw){
        List<String> words=new ArrayList<>();boolean json=false,verbose=false;int page=1;boolean seenPage=false;
        for(int i=0;i<raw.length;i++){
            String word=raw[i];
            if(word.equals("--json")){if(json)throw new IllegalArgumentException("--json不可重复");json=true;}
            else if(word.equals("--verbose")){if(verbose)throw new IllegalArgumentException("--verbose不可重复");verbose=true;}
            else if(word.equals("--page")){if(seenPage||++i>=raw.length)throw new IllegalArgumentException("--page需要正整数");seenPage=true;try{page=Integer.parseInt(raw[i]);}catch(NumberFormatException e){throw new IllegalArgumentException("--page需要正整数");}if(page<1||page>100)throw new IllegalArgumentException("页码需为1–100");}
            else if(word.startsWith("--"))throw new IllegalArgumentException("未知选项："+word);
            else words.add(word);
        }
        if(words.isEmpty())words.add("dungeon");
        if(words.size()==1)words.add("list");
        String action=words.get(1).toLowerCase(Locale.ROOT);words.set(0,"dungeon");words.set(1,action);
        if(Set.of("abandon","cancel","quit").contains(action))throw new Usage("副本退出用 leave，不是放弃任务；留在原地，不自动回城。返城用 /mycli cast home，成功耗6魔力","/mycli dungeon leave");
        if(!Set.of("list","info","travel","start","join","status","resume","leave","claim","menu").contains(action))throw new IllegalArgumentException("未知动作；用 dungeon --help 分页查看");
        int size=words.size();
        boolean valid=switch(action){case "list","resume","leave"->size==2;case "info","travel","join"->size==3;case "start"->size==3||size==4;default->size==2||size==3;};
        if(!valid){
            if(action.equals("leave"))throw new Usage("leave 不带地点ID，只退出本人当前场次并留在原地；回城另用 /mycli cast home，成功耗6魔力","/mycli dungeon leave");
            throw new IllegalArgumentException("参数数量不符；先查该动作的 --help");
        }
        if(size>=3&&!words.get(2).matches("[a-z0-9_]{1,32}"))throw new IllegalArgumentException("地点ID需从 dungeon list 选择");
        if(size==4&&!Set.of("normal","adventure","apocalypse").contains(words.get(3)))throw new IllegalArgumentException("难度为normal、adventure、apocalypse");
        if(seenPage&&!action.equals("list"))throw new IllegalArgumentException("--page只用于地点列表");
        if(json&&action.equals("menu"))throw new IllegalArgumentException("此旧界面暂不支持--json，本次未打开；使用 dungeon menu");
        return new Request(words.toArray(String[]::new),json,verbose,page);
    }
    record Preparation(int stars,int recommendedLevel,String equipment,String party) { }
    static Preparation preparation(String id,int minimumLevel) {
        return switch(id) {
            case "undead_crypt" -> new Preparation(3,8,"铁制武器、铁甲、盾、熟食16、火把16","可单人；2–3人更稳：坦克或近战＋输出，有治疗更稳");
            case "creeping_crypt" -> new Preparation(3,10,"铁制武器、完整铁甲、盾、熟食16；准备解毒或治疗","可单人；建议坦克＋输出＋牧师，注意毒与远程敌人");
            case "bunker" -> new Preparation(4,12,"附魔铁制或钻石装备、盾、远程武器与弹药、熟食32","可单人；建议3–4人，坦克承伤、牧师恢复、输出清场");
            case "illager_camp" -> new Preparation(2,6,"铁制武器、铁甲、盾、熟食16；远程武器可选","可单人；建议近战或坦克＋输出，用盾应对弩箭");
            default -> new Preparation(2,Math.max(5,minimumLevel),"铁制武器、铁甲、盾、熟食16；至少准备一项战斗技能","可单人；建议坦克或近战＋输出，牧师提供恢复");
        };
    }
    static String skill(String role) {
        return switch(role) {
            case "warrior" -> "战士：sword_parry防护、sword_thrust近战";
            case "mage" -> "法师：远程输出与控制；当前可用技用 /mycli skills list 查询";
            case "priest" -> "牧师：healer_mend恢复、priest_blessing团队增益";
            case "tank" -> "坦克：tank_taunt吸引仇恨、tank_bastion防护";
            case "knight" -> "骑士：fortify防护承伤；后续节点用 /mycli skills list 查询";
            case "cleric" -> "牧师：mend恢复；范围治疗等后续节点用 /mycli skills list 查询";
            case "ranger" -> "游侠：hunter_mark标记目标，配合弓箭输出";
            case "beastmaster" -> "驯兽师：beast_call野性攻击；有效目标用技能详情查询";
            case "engineer" -> "工程师：deploy_turret机巧攻击；保持目标在技能范围内";
            default -> "先选职业；学习→准备→装备合适武器→施放，技能名称从 skills status 查";
        };
    }
    private static boolean yes(Map<String,?> f,String k){return Boolean.TRUE.equals(f.get(k));}
    private static String text(Map<String,?> f,String k){return Objects.toString(f.get(k),"");}
    private static long number(Map<String,?> f,String k){return f.get(k) instanceof Number n?Math.max(0,n.longValue()):0;}
    static Map<String,Object> evaluate(String id,String name,Map<String,?> f) {
        if(!id.matches("[a-z0-9_]{1,32}"))throw new IllegalArgumentException("invalid dungeon id");
        String base="/mycli dungeon ",state,reason,action,command;long retry=0;
        if(!yes(f,"configured")) {
            state="unavailable";reason="DUNGEON_UNAVAILABLE";
            action="此地点当前不可用；不要原地等待或重复开场，改选其他地点。原任务与进度保留。";command=base+"list";
        }else if(yes(f,"pendingReward")) {
            state="claimable";reason="REWARD_PENDING";
            action="已有真实待领奖凭据，直接结算；无需重新开场或再清一轮。";command=base+"claim "+id;
        }else if(yes(f,"participant")) {
            String phase=text(f,"phase");
            if(yes(f,"faulted")) {
                state="fault_paused";reason="DUNGEON_FAULT_PAUSED";
                action="原场次因服务故障暂停；等待不会推进。保留进度，联系服主；故障处理后本人只尝试一次 resume，再查状态。";command=base+"status "+id;
            }else if(yes(f,"paused")) {
                state="paused";reason="RETURN_TO_RUN";
                action="原场次等待成员回场；按房间坐标返回，勿另开一场。";command=base+"status "+id;
            }else if(phase.equals("returning")) {
                state="returning";reason="RETURN_AND_SETTLE";
                action="房间已清，返回首室 "+text(f,"firstRoom")+" 后领取结算；未结算不算委托清场。";command=base+"claim "+id;
            }else if(phase.equals("fighting")) {
                state="fighting";reason="DEFEAT_ROOM_ENEMIES";
                action="前往当前房间 "+text(f,"target")+"，击败剩余 "+number(f,"remainingMobs")+" 个场次敌人；仅查询不会清怪。";command=base+"status "+id;
            }else if(phase.equals("muster")) {
                state="muster";reason="MUSTER_STARTED";
                action="已开场，留在首室等待这次10秒集结完成；队友需在首室主动 join。无需重复 start。";command=base+"status "+id;
            }else {
                state="moving";reason="REACH_NEXT_ROOM";
                action="沿实际通道进入当前房间 "+text(f,"target")+"，到场才会触发战斗；不要在上一室等刷怪。";command=base+"status "+id;
            }
        }else if(yes(f,"otherActivity")) {
            state="blocked";reason="ANOTHER_ACTIVITY_ACTIVE";
            action="你仍在另一场活动，先处理原场次；本查询不会替你退出或重复开场。";command=base+"status";
        }else if(!text(f,"admissionReason").isEmpty()) {
            state="requirements";reason=text(f,"admissionReason");
            action=text(f,"admissionHint");command=text(f,"admissionCommand");
        }else if(f.containsKey("loadoutReady")&&!yes(f,"loadoutReady")){
            state="requirements";reason="EQUIPMENT_REQUIRED";
            action="缺少："+text(f,"missingLoadout")+"。穿齐四件护甲，携带近战武器、弓弩或本职业法器；不强制带剑。";command="/mycli guild shared";
        }else if(yes(f,"occupied")) {
            if(yes(f,"joinable")&&yes(f,"atFirstRoom")) {
                state="joinable";reason="PARTY_MUSTER_OPEN";
                action="此处已有队伍正在集结；若要参加，由本人主动加入。";command=base+"join "+id;
            }else {
                state="occupied";reason="DUNGEON_OCCUPIED";
                action="已有队伍进行中，你尚未参战；不要在场外等刷新，改选空闲地点。";command=base+"list";
            }
        }else if(number(f,"cooldownMs")>0) {
            state="cooldown";reason="DUNGEON_COOLDOWN";retry=number(f,"cooldownMs");
            action="场地还需 "+(retry+999)/1000+" 秒恢复。可先整备或改选空闲地点，不要连续查询或反复 start。";command=base+"list";
        }else if(yes(f,"atFirstRoom")) {
            state="ready";reason="DUNGEON_IDLE_READY";
            action="空闲可开；active=false 只表示尚未开场。你已到首室，可选普通难度开始。";command=base+"start "+id+" normal";
        }else if(yes(f,"atSite")) {
            state="approach";reason="WALK_TO_FIRST_ROOM";
            action="空闲可开；沿入口通道步行到首室 "+text(f,"firstRoom")+"，再 start。到入口不等于已进首室，不在地面反复等待。";command=base+"info "+id;
        }else {
            state="travel";reason="TRAVEL_TO_DUNGEON";
            action="空闲可开；先到入口（传送需8魔力），再沿实际通道走到首室 "+text(f,"firstRoom")+" 并 start，不是等系统自动开。";command=base+"travel "+id;
        }
        var out=new LinkedHashMap<String,Object>();out.put("state",state);out.put("reason",reason);out.put("name",name);
        out.put("available",yes(f,"configured"));out.put("activeMeaning","是否已有开启的场次，不代表是否开放");
        out.put("nextAction",action);out.put("nextCommand",command);out.put("retryAfterMs",retry);
        out.put("retryPolicy",retry>0?"到期后查询一次；不自动重放开场":"按下一步处理；不自动重放消耗动作");
        out.put("waitAtEntrance",false);return out;
    }
    static JsonObject attach(JsonObject original,Map<String,Object> advice) {
        if(original.has("ready")&&original.get("ready").getAsBoolean())return original;
        JsonObject out=original.deepCopy();out.addProperty("phase",advice.get("state").toString());out.addProperty("reason",advice.get("reason").toString());
        out.addProperty("summary",advice.get("name")+"："+label(advice.get("state").toString()));
        out.addProperty("nextAction",advice.get("nextAction").toString());out.addProperty("nextCommand",advice.get("nextCommand").toString());
        // Keep the full preparation card behind dungeon info; repeating the
        // same instructions at task/guild/status layers wastes context and can
        // force an otherwise small task receipt into a second pagination call.
        Map<String,Object> brief=new LinkedHashMap<>();
        for(String key:List.of("state","recommendedLevel","playerCombatLevel","currentEquipment","retryAfterMs"))if(advice.containsKey(key))brief.put(key,advice.get(key));
        out.add("adventure",new Gson().toJsonTree(brief));return out;
    }
    static String label(String state){return switch(state){case "unavailable"->"暂不可用，改选其他地点";case "claimable"->"有待领奖凭据";case "fault_paused"->"故障暂停，保留进度";case "cooldown"->"场地冷却";case "occupied"->"其他队伍进行中";case "ready","travel","approach"->"空闲可开";case "fighting"->"正在清怪";case "returning"->"返回首室结算";case "moving"->"前往下一室";case "muster","joinable"->"队伍正在集结";default->"按下一步处理";};}
}
