package org.afuhome.agentfriend;

import java.util.*;

/** Small discovery index of existing routes; definitions and rules stay in their owning plugins. */
final class GameplayGuide {
    record Entry(String id,String name,String command,String state,String note) { }
    record Query(int page,boolean json) { }
    static Query parse(String[] args){
        int page=1;boolean json=false,seen=false;
        for(int i=2;i<args.length;i++){
            if(args[i].equals("--json")&&!json){json=true;continue;}
            if(args[i].equals("--page")&&!seen&&++i<args.length){seen=true;try{page=Integer.parseInt(args[i]);}catch(NumberFormatException invalid){throw new IllegalArgumentException("页码必须是正整数");}continue;}
            throw new IllegalArgumentException("只接受 --page 页码、--json");
        }
        if(page<1||page>100)throw new IllegalArgumentException("页码需为1至100");return new Query(page,json);
    }
    static List<Entry> entries(Set<String> enabled,boolean nativeRpg,boolean trialBuilt,boolean cameraReady){
        var out=new ArrayList<Entry>();boolean rpg=nativeRpg&&enabled.contains("VortexRPG");
        add(out,"profession","六职业与升级","/mycli profession list",rpg,"定位、装备和成长查info；当前不开放换职");
        add(out,"skills","技能与天赋","/mycli skills list",rpg,"按info看目标、费用、学习点；完整洗点未开放");
        add(out,"quests","RPG任务","/mycli tasks list",rpg,"info→accept→实际行动→claim；放弃用abandon <ID>");
        add(out,"trial","结伴试炼塔","/mycli arena status",trialBuilt,"单人或结伴，从第1层起；清层自动下楼；不是遗迹入口");
        add(out,"dungeons","遗迹与攻略Boss","/mycli dungeon list",enabled.contains("AgentFriend"),"按info核对难度、装备和职业搭配；占用或故障时换目标");
        add(out,"party","组队协作","/mycli guild party status",rpg,"队长create/invite，对方accept；建队不等于副本参战");
        add(out,"events","随机集结活动","/mycli world events",enabled.contains("WorldEvents"),"公告邀请，自主参加；集结结束不会中止已开始的挑战");
        add(out,"rank","冒险等级与考试","/mycli guild exam status",enabled.contains("AgentFriend"),"声望、考试和RPG等级分别核对；完成后本人交付");
        add(out,"trade","金币、交易与回收","/mycli trade --help",enabled.contains("Vault"),"RPG商店/委托/回收共用金币；村民仍用实物；拍卖交付尚未开放");
        add(out,"storage","远程个人箱与补给","/mycli arena stash inventory",enabled.contains("AgentFriend"),"按真实槽位putslot；公共补给guild shared，箱子与随身背包分开");
        add(out,"npc","NPC与剧情","/mycli world npcs",enabled.contains("NPCSpeak"),"先读人物ID与实际位置，再靠近world talk；剧情不由客户端编造");
        add(out,"explore","探索、双城与地标","/mycli waypoint list",enabled.contains("AgentFriend"),"核对世界key/UUID；传送后确认落点，不把同坐标当同世界");
        add(out,"photos","女神相机与照片展览","/mycli photo status",cameraReady,"拍照默认2魔力，成片入个人箱；是否公开由本人选择");
        add(out,"archive","日记、公告与档案","/mycli archive status",enabled.contains("AgentFriend"),"写书、署名、持久归档与恢复；作者内容不等于任务证明");
        out.add(new Entry("appearance","皮肤与YSM","/appearance list","external_service","由登录/模型代理提供，选皮肤用/skins；按实际回执判断，Paper不代确认"));
        add(out,"voice","附近语音与字幕","/voice help",enabled.contains("QiandengVoice"),"可用本人音频上传或显式TTS；原版/基岩无需强制装语音模组");
        add(out,"pvp","自愿竞技","/mycli pvp status",enabled.contains("AgentFriend"),"按开放状态和本人意愿参加，不能把NPC或队友当怪物");
        add(out,"protect","建筑与拆建边界","/mycli protect --help",enabled.contains("AgentFriend"),"城区可放不可拆、野外按实际区域判断；副本建筑不可破坏");
        return List.copyOf(out);
    }
    private static void add(List<Entry> out,String id,String name,String command,boolean ready,String note){
        out.add(new Entry(id,name,command,ready?"query_available":"unavailable",ready?note:"组件或场地未就绪；先查状态，不反复执行动作"));
    }
    static List<Entry> page(List<Entry> entries,int page){int from=(page-1)*6;return from>=entries.size()?List.of():entries.subList(from,Math.min(from+6,entries.size()));}
}
