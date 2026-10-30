package org.afuhome.agentfriend;

import java.util.*;

/** Advice only: never enrolls, teleports, spends mana or supplies quest evidence. */
final class TrialGuide {
    static final String STATUS="/mycli arena status", TRAVEL="/mycli goto arena";
    record Facts(boolean built,boolean participant,boolean active,boolean paused,boolean spawned,boolean cleared,
                 int floor,int selfFloor,int remaining,int maxFloor,boolean observer,boolean canAct,boolean downed,
                 boolean inOtherActivity,boolean nearEntrance,double mana,long cooldownMs,List<String> missing) { }
    static Map<String,Object> next(Facts f){
        String reason,action,command;boolean worldAction=false;
        if(!f.built()){reason="trial_unavailable";action="试炼场尚未开放，先选其他冒险";command="/mycli dungeon list";}
        else if(f.observer()){reason="observer";action="观战账号不能开场或参赛；请用本人存活的生存角色";command="/mycli status";}
        else if(f.downed()){reason="downed";action="已倒地，等待队友4格内停留10秒或清层救援；不要退出或传送";command=STATUS;worldAction=true;}
        else if(!f.canAct()){reason="actor_unavailable";action="当前角色不能行动；先完成重生并恢复为存活的生存角色，不重复开场";command="/mycli status";}
        else if(f.participant()){
            if(f.paused()){reason="waiting_reconnect";action="本场暂停等待队友重连；不要重新开场";}
            else if(f.selfFloor()!=f.floor()){reason="participant_outside_floor";action="本人离开登记楼层；记录当前楼层并联系服主，不凿墙或重新开场";}
            else if(f.cleared()){reason="wait_next_floor";action="本层已清，约10秒自动下楼；不用另找第2层入口或手动传送";}
            else if(!f.spawned()){reason="wait_spawn";action="已参赛，等待本层刷怪，不重复start";}
            else{reason="fight_remaining";action="第"+f.floor()+"/"+f.maxFloor()+"层，尚有"+f.remaining()+"只；攻击实际可见敌人，清层后自动下楼";worldAction=true;}
            command=STATUS;
        }else if(f.inOtherActivity()){reason="other_activity";action="仍在遗迹或竞技场中；先核对并本人决定完成或退出，不混入试炼场";command="/mycli status";}
        else if(f.active()){reason="trial_busy";action="已有队伍挑战，不能加入另一场；先选其他遗迹，不在入口反复start";command="/mycli dungeon list";}
        else if(f.cooldownMs()>0){reason="trial_cooldown";action="全服试炼冷却还剩"+((f.cooldownMs()+999)/1000)+"秒，先做其他冒险";command="/mycli dungeon list";}
        else if(!f.missing().isEmpty()){reason="equipment_missing";action="缺少"+String.join("、",f.missing())+"；护甲要穿上，背包里有不算；武器可用近战、弓弩或本职业法器";command="/mycli guild shared";}
        else if(!f.nearEntrance()){
            if(f.mana()<0){reason="mana_unknown";action="入口传送需6魔力，当前读数未知；先核对状态，不重复传送";command="/mycli status";}
            else if(f.mana()<6){reason="travel_mana_required";action="入口在主世界 world（-596,92,-313），可步行；传送需6魔力，当前不足";command="/mycli status";worldAction=true;}
            else{reason="reach_trial_entrance";action="前往主世界 world（-596,92,-313）的试炼塔入口；传送成功耗6魔力。creeping_crypt是另一处遗迹";command=TRAVEL;}
        }else{reason="ready_to_start";action="已到入口，可单人或结伴。队员穿齐四甲、带武器并站普通按钮12格内；一人start免费开场。每次新开从第1层开始，历史通关不自动跳层；清层自动下楼";command="/mycli arena start";}
        var out=new LinkedHashMap<String,Object>();out.put("reason",reason);out.put("nextAction",action);out.put("nextCommand",command);
        out.put("verifyCommand",STATUS);out.put("requiresWorldAction",worldAction);out.put("queryOnly",true);
        out.put("canStart",reason.equals("ready_to_start"));out.put("entryMana",0);out.put("travelMana",6);out.put("checkpointMana",8);
        out.put("groupRule","entrance_nearby_eligible_players");out.put("radius",12);out.put("missingEquipment",f.missing());
        if(f.cooldownMs()>0)out.put("retryAfterMs",f.cooldownMs());return out;
    }
    static boolean goal(GuildManager.Goal goal){return Set.of(GuildManager.Goal.FLOOR,GuildManager.Goal.PARTY_FLOOR,
        GuildManager.Goal.FAST_FLOOR,GuildManager.Goal.NO_DEATH,GuildManager.Goal.LIGHT_FLOOR,GuildManager.Goal.STONE_FLOOR,
        GuildManager.Goal.WITCH_KILLS,GuildManager.Goal.CLAIMS).contains(goal);}
    static String route(){return "试炼塔在主世界 world（-596,92,-313），先 /mycli arena status；入口传送 /mycli goto arena（6魔力）。穿齐四甲并带武器，伙伴到按钮12格内，一人 /mycli arena start（开场免费）。每次新开从第1层开始，历史通关不自动跳层；清层自动下楼。已解锁第7层驿站可另用arena rest（8魔力）；不是creeping_crypt等遗迹入口。";}
}
