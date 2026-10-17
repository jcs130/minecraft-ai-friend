package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/** Presentation only: build an RPG journal from native evidence, never award progress.
 * A map marker, a public clue and a completed objective are deliberately distinct. */
final class QuestGuidance {
    private QuestGuidance() { }
    static JsonObject map(JsonObject info, JsonObject evidence, String reason, int count,
            String world, double x, double y, double z, boolean survival, JsonObject photo) {
        JsonObject out = base();
        if (!info.has("map") || !info.has("returnTo") || reason.equals("map_binding_missing_or_invalid"))
            return phase(out, "check_map_binding", "核对地图接单记录", "原地图绑定暂不可读，保留当前委托，请服主核对；不要反复放弃重接。", "/mycli guild map");
        JsonObject map = info.getAsJsonObject("map"), home = info.getAsJsonObject("returnTo");
        boolean sameWorld = text(map, "worldUuid").equals(world);
        double distance = sameWorld ? Math.hypot(number(map,"x")-x, number(map,"z")-z) : -1;
        boolean surveyed = flag(evidence,"surveyed"), inside = flag(evidence,"validCurrentTarget");
        boolean arrived = sameWorld && (distance <= 64 || inside || surveyed);
        boolean photos = !flag(photo,"required") || flag(photo,"ready");
        boolean returned = surveyed && flag(evidence,"returned");
        String kind = text(evidence,"mode").isEmpty()?text(info,"targetKind"):text(evidence,"mode");
        JsonObject nav = map.deepCopy(); nav.remove("title"); nav.remove("icon");
        nav.addProperty("dimensionMatches",sameWorld); nav.addProperty("horizontalDistance",Math.ceil(distance));
        nav.addProperty("precision","map_marker"); nav.addProperty("entranceVerified",false);
        out.add("navigation",nav); out.add("returnTo",home.deepCopy());
        out.addProperty("targetMatch",inside); out.addProperty("ready",survival && surveyed && photos && returned);
        objective(out,"travel","抵达地图标记附近",arrived);
        objective(out,"enter",kind.equals("treasure")?"亲自打开新的天然藏宝箱":"找到入口并进入目标遗迹",inside || surveyed);
        objective(out,"survey","实地走查",surveyed);
        if(flag(photo,"required")) objective(out,"photograph","拍摄合格的现场照片",photos);
        objective(out,"return","回接单点交回记录",returned && photos);
        objective(out,"claim","交付本阶段",false);
        if (!survival) return phase(out,"resume_survival","恢复可调查状态","存活后以生存模式落地步行；已有走查记录保留。","/mycli tasks status");
        if(reason.equals("current_chunk_unloaded")){out.addProperty("ready",false);return phase(out,"wait_for_terrain","等待现场数据就绪","先等地形加载，再查当前任务；未知不能当作遗迹不存在，也不用重新接单。","/mycli tasks status");}
        if(reason.equals("map_destination_already_completed")) {
            out.addProperty("ready",false);return phase(out,"destination_completed","该目的地已经结算","保留旧记录；查看其他可接任务，复制地图不能重复领奖。","/mycli tasks list exploration");
        }
        if(!sameWorld) return phase(out,"travel_to_map_world","前往地图所属世界","先经本人已知门户或地点回地图所属世界；异维度的同坐标不是目标。","/mycli guild map");
        if(!arrived) return phase(out,"travel_to_marker","前往地图标记附近","按地图前往 X="+integer(map,"x")+"、Z="+integer(map,"z")+"，直线约"+(int)Math.ceil(distance)+"格；这是目标参考位置，抵达后还要找入口。","/mycli tasks status");
        if(!surveyed && !inside) {
            boolean started = number(evidence,"distinctZones")>0 || !text(evidence,"structureInstance").isEmpty();
            String hint = info.has("clue") ? text(info.getAsJsonObject("clue"),"approachHint") : "";
            String action = started ? "回到已记录的同一座遗迹内部继续；不必放弃重接，也不要换一座凑数。"
                    : "已到标记附近，尚未确认进入目标。标记不是入口；先勘察周围洞口、楼梯和通道，避免脚下直挖。";
            if(!hint.isEmpty()) action += hint;
            if(kind.equals("unknown")) action += "目标类型待现场核实：遗迹需进入走查，埋藏宝藏需亲自新开天然宝箱；红叉本身不能区分。";
            out.getAsJsonArray("missingConditions").add(started?"返回原遗迹的有效调查区域":"进入原图对应的真实目标");
            return phase(out,started?"resume_same_structure":"find_entrance",started?"回到原遗迹继续":"寻找实际入口",action,"/mycli tasks status");
        }
        if(!surveyed) {
            JsonObject rules=evidence.getAsJsonObject("requirements");
            if(rules==null) return phase(out,"check_survey","核对走查条件","当前条件暂不可读，请核查原委托，不凭空报告完成。","/mycli tasks status");
            deficit(out,"不同分区",number(evidence,"distinctZones"),count,"处");
            deficit(out,"新路线",number(evidence,"distance"),number(rules,"minDistance"),"格");
            deficit(out,"有效行进",number(evidence,"movingSeconds"),number(rules,"minMovingSeconds"),"秒");
            deficit(out,"内部区段",number(evidence,"distinctSections"),kind.equals("treasure")?0:number(rules,"minSections"),"段");
            deficit(out,"上下高差",number(evidence,"heightSpan"),kind.equals("treasure")?0:number(rules,"minHeightSpan"),"格");
            String action=number(evidence,"heightSpan")<number(rules,"minHeightSpan")?"沿可走通道探索上下层，再走未经过的位置。":"沿通道步行走到未经过的位置，边调查边核对缺项。";
            action += "分区是同一目标内每"+integer(rules,"zoneSize")+"格划分的位置，不是多座遗迹；站着等、反复原路和传送不计新路线。";
            if(kind.equals("structure")) action += "本路线不要求开启新宝箱，也不要求拆毁或清空遗迹。";
            return phase(out,"survey","在同一目标内走查",action,"/mycli tasks status");
        }
        if(!photos) {
            out.getAsJsonArray("missingConditions").add("合格现场照片 "+integer(photo,"photographedRegions")+"/"+integer(photo,"requiredRegions"));
            return phase(out,"photograph","走查已完成，补拍现场照片",inside?"对准当地景物拍照；用相册核对合格结果，成片自动进入个人奖励箱。":"先回原目标现场再拍照；走查证据已保留，返程点或旧照片不能代替本场实拍。","/mycli photo menu");
        }
        if(!returned) {
            int radius=integer(evidence.getAsJsonObject("requirements"),"returnRadius");
            out.getAsJsonArray("missingConditions").add("回接单点"+radius+"格内（含高度差）");
            return phase(out,"return_to_acceptance_point","走查与照片已齐，返回交付","回接单点 X="+integer(home,"x")+"、Y="+integer(home,"y")+"、Z="+integer(home,"z")+" 的"+radius+"格内；这是接单时实测位置，不是遗迹入口。","/mycli guild map");
        }
        return phase(out,"ready_to_submit","本阶段就绪，交付记录","用 /mycli guild claim 交付本阶段；整张委托完成后，再查看考试是否可以交卷。","/mycli guild claim");
    }
    /** Extend ordinary structure/biome/dimension surveys with the same journal presentation. */
    static JsonObject exploration(JsonObject original, JsonObject photo) {
        JsonObject out=original.deepCopy();out.addProperty("readOnly",true);
        boolean done=flag(out,"ready"),photos=!flag(photo,"required")||flag(photo,"ready");
        out.add("objectives",new JsonArray());
        objective(out,"enter","抵达本阶段有效调查区域",flag(out,"targetMatch")||done);
        objective(out,"survey","完成实际走查",done);
        if(flag(photo,"required"))objective(out,"photograph","拍摄合格的现场照片",photos);
        objective(out,"claim","交付本阶段",false);
        if(done&&!photos){out.addProperty("ready",false);out.getAsJsonArray("missingConditions").add("本阶段合格现场照片");
            return phase(out,"photograph","走查已完成，补拍现场照片","在本阶段目标现场对准景物拍照；走查记录保留，旧照片不能代替本场实拍。","/mycli photo menu");}
        return finish(out,text(out,"phase"));
    }
    private static JsonObject base(){JsonObject out=new JsonObject();out.addProperty("readOnly",true);out.addProperty("ready",false);out.addProperty("targetMatch",false);out.add("objectives",new JsonArray());out.add("missingConditions",new JsonArray());return out;}
    private static void objective(JsonObject out,String id,String title,boolean done){JsonObject row=new JsonObject();row.addProperty("id",id);row.addProperty("title",title);row.addProperty("state",done?"completed":"pending");out.getAsJsonArray("objectives").add(row);}
    private static void deficit(JsonObject out,String title,double current,double required,String unit){if(current<required)out.getAsJsonArray("missingConditions").add(title+" "+Math.round(current*10)/10.0+"/"+Math.round(required*10)/10.0+unit);}
    private static JsonObject phase(JsonObject out,String phase,String title,String action,String command){out.addProperty("phase",phase);out.addProperty("summary",title);out.addProperty("nextAction",action);out.addProperty("nextCommand",command);return finish(out,phase);}
    private static JsonObject finish(JsonObject out,String phase){int completed=0;boolean current=false;for(JsonElement value:out.getAsJsonArray("objectives")){JsonObject row=value.getAsJsonObject();if(text(row,"state").equals("completed")){completed++;continue;}if(!current){row.addProperty("state","current");current=true;}}
        out.addProperty("completedObjectives",completed);out.addProperty("totalObjectives",out.getAsJsonArray("objectives").size());out.addProperty("progress",out.getAsJsonArray("objectives").isEmpty()?0:completed/(double)out.getAsJsonArray("objectives").size());return out;}
    static boolean flag(JsonObject j,String k){return j!=null&&j.has(k)&&!j.get(k).isJsonNull()&&j.get(k).getAsBoolean();}
    static String text(JsonObject j,String k){return j!=null&&j.has(k)&&!j.get(k).isJsonNull()?j.get(k).getAsString():"";}
    private static double number(JsonObject j,String k){return j!=null&&j.has(k)&&!j.get(k).isJsonNull()?j.get(k).getAsDouble():0;}
    private static int integer(JsonObject j,String k){return (int)Math.floor(number(j,k));}
}
