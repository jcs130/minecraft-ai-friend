package org.qiandengji.vortex;

import com.google.gson.Gson;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.world.ExpeditionPartyManager;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Existing guild party facade, using only the native manager and original permissions. */
final class NativeParties {
    private static final Set<String> BASIC=Set.of("status","create","invite","accept","decline","leave","disband","kick","menu");
    private static final Set<String> ADVANCED=Set.of("promote","demote","transfer","chat","toggle","summon","ready","rename");
    private final VortexCorePlugin vortex;private final Gson gson=new Gson();
    NativeParties(VortexCorePlugin vortex){this.vortex=vortex;}
    void command(Player p,String[] raw){
        boolean json=Arrays.asList(raw).contains("--json");var args=new ArrayList<String>();
        for(String s:raw){if(s.equals("--json"))continue;if(s.startsWith("-")){send(p,json,false,"invalid_argument","未知选项；未执行","/mycli guild party --help");return;}args.add(s);}
        String action=args.isEmpty()?"status":args.removeFirst().toLowerCase(Locale.ROOT);
        action=switch(action){case "info","list"->"status";case "join"->"accept";case "gui","open"->"menu";default->action;};
        if(!BASIC.contains(action)){
            if(ADVANCED.contains(action)&&!json){Bukkit.dispatchCommand(p,"vortexrpg:party "+String.join(" ",raw));return;}
            send(p,json,false,ADVANCED.contains(action)?"unsupported_format":"invalid_argument","该操作不在简明组队入口中；未执行。高级原命令沿用原生帮助","/mycli guild party --help");return;
        }
        int count=Set.of("invite","kick").contains(action)?1:0;
        if(args.size()!=count||count==1&&!args.getFirst().matches("[\\p{L}\\p{N}_.]{1,16}")){send(p,json,false,"invalid_argument","参数不匹配；未执行。用法：/mycli guild party "+action+(count==1?" <在线玩家名>":""),"/mycli guild party --help");return;}
        String permission="vortex.player.party."+switch(action){case "status"->"info";case "menu"->"gui";default->action;};
        if(!p.hasPermission(permission)){send(p,json,false,"permission_denied","缺少组队权限 "+permission+"；请联系服主核对","/mycli guild party status");return;}
        var manager=vortex.expeditionPartyManager();var before=manager.partyOf(p.getUniqueId());
        if(action.equals("status")){status(p,json,before);return;}
        if(!io.vortexcore.combat.PlayerStateGate.allowed(p)){send(p,json,false,"player_state_blocked","当前不能执行组队动作；先等待救援或使用生存角色","/mycli status");return;}
        if(action.equals("menu")){Bukkit.dispatchCommand(p,"vortexrpg:party gui");send(p,json,true,"menu_requested","已请求打开组队菜单，不代表已接受邀请或加入副本","/mycli guild party status");return;}
        Player target=count==1?Bukkit.getPlayerExact(args.getFirst()):null;
        if(count==1&&target==null){send(p,json,false,"player_offline","目标不在线或名字不匹配；从当前可见玩家名单复制名字","/mycli locate list");return;}
        ExpeditionPartyManager.PartyResult result=switch(action){
            case "create"->manager.createParty(p.getUniqueId());case "invite"->manager.invite(p.getUniqueId(),target.getUniqueId());
            case "accept"->manager.acceptInvite(p.getUniqueId());case "decline"->manager.declineInvite(p.getUniqueId());
            case "leave"->manager.leave(p.getUniqueId());case "disband"->manager.disband(p.getUniqueId());
            case "kick"->manager.kick(p.getUniqueId(),target.getUniqueId());default->throw new IllegalStateException("unreachable");};
        if(!result.success()){String reason=result.message().toLowerCase(Locale.ROOT);String message=reason.contains("pending")||reason.contains("expired")?"没有有效的待接受邀请；请让队长重新邀请，不会自行加入":reason.contains("already in a party")?"已经在队伍中；先查当前成员，不自动退出或换队":reason.contains("leader")||reason.contains("officer")||reason.contains("rank")?"需要队长或相应管理身份；不会提升权限":reason.contains("full")?"队伍人数已满；请队长协调空位":reason.contains("yourself")?"不能邀请或踢出自己；退出用 leave":reason.contains("create a party first")?"尚未建队；由队长先 create":reason.contains("not in")?"当前不在对应队伍中；先查本人状态":"队伍状态已变化；先查成员与邀请，不重复提交";
            send(p,json,false,reason.contains("pending")||reason.contains("expired")?"invite_required":"party_rejected",message,"/mycli guild party status");return;
        }
        String message=switch(action){case "create"->"已创建原生队伍；下一步邀请在线队友";case "invite"->"已向 "+target.getName()+" 发送邀请，需对方主动 accept";case "accept"->"已接受邀请并加入队伍；进入副本仍须本人在集结期 dungeon join <ID>";case "decline"->"已拒绝邀请";case "leave"->"已离开队伍";case "disband"->"已解散队伍";case "kick"->"已移出该成员";default->"队伍已更新";};
        send(p,json,true,"completed",message,"/mycli guild party status");
        if(action.equals("invite"))target.sendMessage("§b[组队邀请] "+p.getName()+" 邀请你组队。接受：/mycli guild party accept；拒绝：/mycli guild party decline");
        if(action.equals("disband"))before.ifPresent(party->party.members().stream().filter(id->!id.equals(p.getUniqueId())).map(Bukkit::getPlayer).filter(Objects::nonNull).forEach(member->member.sendMessage("§e[队伍] 队长已解散队伍；你的副本参与状态另用 /mycli dungeon status 核对。")));
    }
    private void status(Player p,boolean json,Optional<ExpeditionPartyManager.PartySnapshot> party){
        var out=new LinkedHashMap<String,Object>();out.put("type","party");out.put("queryOnly",true);out.put("sessionOnly",true);out.put("inParty",party.isPresent());
        String next=party.isPresent()?"/mycli dungeon list":"/mycli guild party create";out.put("nextCommand",next);
        String text="尚未组队；可由队长创建，再 invite 玩家，对方 accept";
        if(party.isPresent()){var s=party.get();var members=s.members().stream().map(id->Map.of("uuid",id.toString(),"name",name(id),"role",s.roles().get(id).name())).sorted(Comparator.comparing(row->row.get("name"))).toList();out.put("leader",name(s.leaderId()));out.put("members",members);text="队长 "+name(s.leaderId())+"；成员 "+String.join("、",s.members().stream().map(NativeParties::name).sorted().toList())+"；Vortex队伍为会话状态，副本仍须分别 start/join";}
        if(json)p.sendMessage("MC_RPG "+gson.toJson(out));else p.sendMessage("§b[队伍] "+text+"。下一步："+next);
    }
    private static String name(UUID id){Player online=Bukkit.getPlayer(id);return online==null?id.toString():online.getName();}
    private void send(Player p,boolean json,boolean ok,String reason,String message,String next){if(json)p.sendMessage("MC_RPG "+gson.toJson(Map.of("type","party","success",ok,"reason",reason,"message",message,"nextCommand",next,"sessionOnly",true)));else p.sendMessage("§b[队伍 "+reason+"] "+message+"。下一步："+next);}
}
