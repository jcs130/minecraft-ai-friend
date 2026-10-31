package org.qiandengji.vortex;

import io.vortexcore.VortexCorePlugin;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Read the native party and invitation; never creates a shadow roster or accepts for a player. */
final class NativePartyView {
    private NativePartyView() {}
    static Map<String,Object> state(VortexCorePlugin vortex, Player p) {
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main thread required");
        var manager=vortex.expeditionPartyManager();var party=manager.partyOf(p.getUniqueId());
        var out=new LinkedHashMap<String,Object>();out.put("available",true);out.put("type","party");
        out.put("queryOnly",true);out.put("sessionOnly",true);out.put("inParty",party.isPresent());
        out.put("inviteStateKnown",true);out.put("location",PlayerLocationView.location(p));
        out.put("members",List.of());
        var invite=manager.pendingInviteOf(p.getUniqueId());
        out.put("pendingInvite",invite.map(i->Map.of("inviterUuid",i.inviterId().toString(),"inviter",name(i.inviterId()),
            "expiresInSeconds",Math.max(0,(i.expiresAtEpochMillis()-System.currentTimeMillis()+999)/1000),
            "acceptCommand","/mycli guild party accept","declineCommand","/mycli guild party decline")).orElse(null));
        if(party.isEmpty()) {
            if(invite.isPresent()) next(out,"invited","收到 "+name(invite.get().inviterId())+" 的有效组队邀请；本人接受后才算入队，不要另建队","/mycli guild party accept");
            else next(out,"not_in_party","尚未组队；口头约定不会建队。发起者先 create，再 invite <在线名字>；对方本人 accept。先查可见玩家名","/mycli locate list");
            return out;
        }
        var s=party.get();out.put("leaderUuid",s.leaderId().toString());out.put("leader",name(s.leaderId()));
        var members=s.members().stream().map(id->{var row=new LinkedHashMap<String,Object>();
            row.put("uuid",id.toString());row.put("name",name(id));row.put("role",s.roles().get(id).name());
            row.putAll(PlayerLocationView.relative(p,Bukkit.getPlayer(id)));return row;
        }).sorted(Comparator.comparing(row->(String)row.get("name"))).toList();out.put("members",members);
        out.put("memberCount",members.size());
        if(members.size()==1) {
            next(out,"awaiting_teammates","队伍只有你一人，还没有队友加入；invite <在线名字> 后等对方 accept，不能把独自开场当组队","/mycli locate list");return out;
        }
        Player leader=Bukkit.getPlayer(s.leaderId());
        if(leader==null||!leader.isOnline()) {next(out,"leader_offline","队长离线，先联系或等待重连；不要重复建队或开场","/mycli guild party status");return out;}
        List<String> apart=s.members().stream().map(Bukkit::getPlayer).filter(member->member==null||!member.isOnline()
            ||member.getWorld()!=leader.getWorld()||member.getLocation().distanceSquared(leader.getLocation())>144)
            .map(member->member==null?"离线成员":member.getName()).toList();
        if(!apart.isEmpty()) {
            String tp="/mycli locate tp "+leader.getName();
            out.put("rendezvousCommand",tp);out.put("rendezvousMana",8);out.put("rendezvousCooldownSeconds",20);
            next(out,"assembling","已入队，尚未集合："+String.join("、",apart)+"。队友可用 "+tp+" 到队长身边（8魔力、20秒冷却）；队长在安全地点等候",
                s.leaderId().equals(p.getUniqueId())?"/mycli guild party status":tp);
        } else next(out,"assembled","队伍已集合；按共同目标选择活动。试炼塔到入口附近登记，遗迹全员到首室后由队长 start；组队不等于副本已参战","/mycli dungeon list");
        out.put("activityHelp","/mycli guide team");
        return out;
    }
    private static void next(Map<String,Object> out,String phase,String action,String command) {
        out.put("phase",phase);out.put("nextAction",action);out.put("nextCommand",command);
        out.put("restartNote","原生队伍是会话状态；服务器重启后先查状态，必要时本人重新邀请/接受");
    }
    private static String name(UUID id){Player p=Bukkit.getPlayer(id);return p==null?id.toString():p.getName();}
}
