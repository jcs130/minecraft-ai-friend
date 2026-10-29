package org.qiandengji.vortex;

import java.util.*;
import java.util.regex.*;

/** Contextual recovery for native rejections; never infers completion from a failed future. */
public final class RpgFailure {
    public record Advice(String reason,String message,String nextCommand,String outcome,Long retryAfterMs){
        public String text(){return "["+reason+"] "+message+"。下一步："+nextCommand;}
        public Map<String,Object> data(){var out=new LinkedHashMap<String,Object>();out.put("success",false);out.put("reason",reason);out.put("message",message);out.put("nextCommand",nextCommand);out.put("outcome",outcome);out.put("retryPolicy","先核对状态和条件；不自动重放消耗动作");out.put("saveState",outcome.equals("unknown")?"unverified":"not_applicable");out.put("saved",false);if(retryAfterMs!=null)out.put("retryAfterMs",retryAfterMs);return out;}
    }
    public static Advice describe(Throwable error,BridgeRules.Request request){
        Set<Throwable> seen=Collections.newSetFromMap(new IdentityHashMap<>());while(error.getCause()!=null&&seen.add(error))error=error.getCause();
        String raw=Objects.toString(error.getMessage(),""),lower=raw.toLowerCase(Locale.ROOT);
        if(error instanceof BridgeRules.InvalidArgument invalid)return a("invalid_argument",raw.replaceFirst("^\\[invalid_argument] ","").split("；未执行。下一步：",2)[0],invalid.nextCommand(),"not_executed");
        String id=request.arguments().size()==1?request.arguments().getFirst():null;
        String skill=id==null?"/mycli skills list":"/mycli skills info "+id;
        String query=switch(request.group()){case "class"->"/mycli profession status";case "skills","cast"->skill;case "quests"->"/mycli tasks status"+(id==null?"":" "+id);default->"/mycli status";};
        if(lower.startsWith("spell is on cooldown")||raw.startsWith("技能尚在冷却")||raw.startsWith("技能正在冷却")){
            Matcher m=Pattern.compile("(?:for |剩余[：:]?\\s*)([0-9]+(?:\\.[0-9]+)?)s").matcher(raw);Long left=m.find()?(long)Math.ceil(Double.parseDouble(m.group(1))*1000):null;
            return new Advice("cooldown","技能冷却中"+(left==null?"":"，还需约"+((left+999)/1000)+"秒")+"；结束后再施放，不连续重试",skill,"not_executed",left);
        }
        if(lower.contains("no_valid_target")||lower.contains("no valid target"))return a("no_valid_target","范围内没有符合技能条件的目标；本次未命中，已撤销耗魔与冷却；先靠近可见敌人再施放",skill,"rolled_back");
        if(raw.contains("魔力不足")||lower.contains("not enough mana")||lower.contains("insufficient mana"))return a("insufficient_mana","魔力不足，本次未施放；等待恢复并核对当前魔力与技能费用","/mycli status","not_executed");
        if(lower.contains("requires level")||raw.contains("需要等级")||lower.startsWith("reach level")){
            Matcher m=Pattern.compile("(?:level |等级[：:]?\\s*)([0-9]+)").matcher(raw);return a("level_required","等级不足"+(m.find()?"，需要Lv."+m.group(1):"")+"；先完成当前等级的讨伐或探索任务，未花学习点","/mycli tasks list","not_executed");
        }
        if(lower.contains("skill point")||raw.contains("技能点不足")||raw.contains("需要技能点"))return a("insufficient_skill_points","学习点不足；先通过任务和战斗升级，再按详情核对费用，未学习扣点",skill,"not_executed");
        if(lower.contains("talent point")||raw.contains("天赋点不足"))return a("insufficient_talent_points","天赋点不足；学习点与天赋点分别计算，升级后查询天赋树","/mycli skills tree","not_executed");
        if(lower.contains("prerequisite")||raw.contains("前置"))return a("prerequisite_required","前置条件尚未满足；按详情依次完成前置，不重复提交当前学习或接取",request.group().equals("quests")&&id!=null?"/mycli tasks info "+id:skill,"not_executed");
        if(lower.contains("already selected")||raw.contains("已经选择职业")||raw.contains("已有职业"))return a("class_already_selected","已有职业，本次没有重选、重置或重复发装备","/mycli profession status","not_executed");
        if(lower.contains("already unlocked")||lower.contains("already allocated")||raw.contains("已解锁")||raw.contains("已经解锁")||raw.contains("已学习"))return a("already_learned","已学会此节点，本次未重复扣点；主动技和被动天赋按详情使用",skill,"not_executed");
        if(lower.contains("choose a class first")||raw.contains("先选择职业"))return a("class_required","请先查看六职业，再主动选择；本次未执行","/mycli profession list","not_executed");
        if(lower.contains("unknown class")||raw.contains("unknown_class"))return a("unknown_class","职业ID不存在；从目录复制准确ID","/mycli profession list","not_executed");
        if(lower.contains("unknown task")||raw.contains("unknown_task"))return a("unknown_task","任务ID不存在；从当前任务目录复制准确ID","/mycli tasks list","not_executed");
        if(lower.contains("belongs to")||raw.contains("所属职业"))return a("class_mismatch","该节点不属于本人职业；查看本职技能，不会替你改职业","/mycli skills list","not_executed");
        if(raw.contains("上一操作仍在确认"))return a("operation_pending","上一操作仍在确认；先查状态，不叠加新的学习、领奖或施法","/mycli status","unknown");
        if(raw.contains("角色资料")&&(raw.contains("加载")||raw.contains("不可用")))return a("profile_loading","角色资料尚未就绪；稍后查询一次，不重新选职或接任务","/mycli status","not_executed");
        if(lower.contains("revision conflict")||raw.contains("保存版本冲突"))return a("save_conflict","保存冲突，结果尚未确认；先查询原操作状态，持续异常请联系服主",query,"unknown");
        if(raw.contains("目标未完成、已领取"))return a("quest_not_claimable","当前不能交付：目标未完成、已领取或存在待核对奖励；查询准确进度后按回执处理",query,"not_executed");
        if(raw.contains("当前状态不能"))return a("player_state_blocked","当前角色不能执行；倒地先等待队友救援，观战者使用对应生存角色","/mycli status","not_executed");
        return a("service_unavailable","服务暂不可用，结果未确认；先查原操作状态，不重复消耗，持续异常请将时间和命令告知服主",query,"unknown");
    }
    private static Advice a(String code,String text,String next,String outcome){return new Advice(code,text,next,outcome,null);}
}
