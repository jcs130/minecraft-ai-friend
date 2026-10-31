package org.qiandengji.vortex;

import com.google.gson.Gson;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.world.ExpeditionPartyManager;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Existing guild party facade, using only the native manager and original permissions. */
final class NativeParties {
    private static final Set<String> BASIC=Set.of("status","plan","create","invite","accept","decline","leave","disband","kick","menu");
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
        if(action.equals("plan")){
            if(!p.hasPermission("vortex.player.party.info")){send(p,json,false,"permission_denied","缺少原生队伍查询权限；未执行", "/mycli guild party status");return;}
            plan(p,json,args);return;
        }
        int count=Set.of("invite","kick").contains(action)?1:0;
        if(args.size()!=count||count==1&&!args.getFirst().matches("[\\p{L}\\p{N}_.]{1,16}")){send(p,json,false,"invalid_argument","参数不匹配；未执行。用法：/mycli guild party "+action+(count==1?" <在线玩家名>":""),"/mycli guild party --help");return;}
        String permission="vortex.player.party."+switch(action){case "status"->"info";case "menu"->"gui";default->action;};
        if(!p.hasPermission(permission)){send(p,json,false,"permission_denied","缺少组队权限 "+permission+"；请联系服主核对","/mycli guild party status");return;}
        var manager=vortex.expeditionPartyManager();var before=manager.partyOf(p.getUniqueId());
        if(action.equals("status")){status(p,json,before);return;}
        if(action.equals("create")&&before.isEmpty()&&manager.pendingInviteOf(p.getUniqueId()).isPresent()){
            send(p,json,false,"invite_pending","你已有有效邀请；先 accept 入队，或本人 decline 后再创建自己的队伍","/mycli guild party accept");return;
        }
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
        String message=switch(action){case "create"->"已创建原生队伍，目前只有你一人；/mycli guild party invite <在线名字>，等对方本人 accept";case "invite"->"已向 "+target.getName()+" 发送邀请，需对方主动 accept，口头答应不算入队";case "accept"->"已加入队伍；先查队伍状态集合，未自动传送或登记副本。队友传送：/mycli locate tp <队友名字>，8魔力/20秒冷却";case "decline"->"已拒绝邀请";case "leave"->"已离开队伍";case "disband"->"已解散队伍";case "kick"->"已移出该成员";default->"队伍已更新";};
        send(p,json,true,"completed",message,"/mycli guild party status");
        if(action.equals("invite"))target.sendMessage("§b[组队邀请] "+p.getName()+" 邀请你组队。接受：/mycli guild party accept；拒绝：/mycli guild party decline");
        if(action.equals("disband"))before.ifPresent(party->party.members().stream().filter(id->!id.equals(p.getUniqueId())).map(Bukkit::getPlayer).filter(Objects::nonNull).forEach(member->member.sendMessage("§e[队伍] 队长已解散队伍；你的副本参与状态另用 /mycli dungeon status 核对。")));
    }
    private void plan(Player p,boolean json,List<String> names){
        if(names.size()<2||names.size()>5||names.stream().anyMatch(n->!n.matches("[\\p{L}\\p{N}_.]{1,16}"))){
            send(p,json,false,"invalid_argument","plan <发起者> <伙伴...>：2到5个名字，四人列四个；只读，不会代建队或接受邀请", "/mycli guild party --help");return;
        }
        var manager=vortex.expeditionPartyManager();var actors=new ArrayList<PartyFormation.Actor>();
        var teams=new HashMap<UUID,PartyFormation.Team>();var invites=new HashMap<UUID,PartyFormation.Invitation>();
        for(String name:names){
            Player actor=Bukkit.getPlayerExact(name);
            if(actor==null){send(p,json,false,"player_offline","目标名字不在线；保留原队伍，重连后再核对名册", "/mycli guild party status");return;}
            UUID id=actor.getUniqueId();actors.add(new PartyFormation.Actor(id,actor.getName(),actor.isOnline()));
            manager.partyOf(id).ifPresent(s->teams.put(id,new PartyFormation.Team(s.partyId(),s.leaderId(),s.members())));
            manager.pendingInviteOf(id).ifPresent(i->invites.put(id,new PartyFormation.Invitation(i.partyId(),i.inviterId())));
        }
        try{
            var view=PartyFormation.plan(p.getUniqueId(),actors,teams,invites);
            if(json)p.sendMessage("MC_RPG "+gson.toJson(view));
            else p.sendMessage("§b[多人结伴·"+view.get("phase")+"] "+view.get("explanation")+"；本人下一步："+view.get("nextCommand"));
        }catch(IllegalArgumentException invalid){send(p,json,false,"invalid_argument","名单须包含本人且名字和UUID不能重复；未执行", "/mycli guild party status");}
    }
    private void status(Player p,boolean json,Optional<ExpeditionPartyManager.PartySnapshot> party){
        var view=NativePartyView.state(vortex,p);
        if(json)p.sendMessage("MC_RPG "+gson.toJson(view));
        else p.sendMessage("§b[队伍·"+view.get("phase")+"] "+view.get("nextAction")+"。下一步："+view.get("nextCommand")
            +(party.isPresent()?"。队长 "+name(party.get().leaderId())+"；成员 "+String.join("；",party.get().members().stream().map(id->name(id)+"["+PlayerLocationView.relativeText(p,Bukkit.getPlayer(id))+"]").toList()):""));
    }
    private static String name(UUID id){Player online=Bukkit.getPlayer(id);return online==null?id.toString():online.getName();}
    private void send(Player p,boolean json,boolean ok,String reason,String message,String next){if(json)p.sendMessage("MC_RPG "+gson.toJson(Map.of("type","party","success",ok,"reason",reason,"message",message,"nextCommand",next,"sessionOnly",true)));else p.sendMessage("§b[队伍 "+reason+"] "+message+"。下一步："+next);}
}
