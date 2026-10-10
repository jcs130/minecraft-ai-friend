package dev.qiandeng.bedrock.agents;

import static dev.qiandeng.bedrock.agents.AgentForms.map;
import java.util.*;
import java.util.function.Consumer;
import org.geysermc.cumulus.form.CustomForm;
import org.geysermc.cumulus.form.SimpleForm;

/** Bedrock views of TLM's native site and per-maid fields, never copies a stored key. */
public final class MaidForms {
    public static SimpleForm welcome(Runnable companions,Runnable maids){
        return SimpleForm.builder().title("My Agent World · 同伴面板")
            .content("用按钮管理自己的同伴，无需输入命令。\n\n平时空手对自己的女仆或 Agent 同伴按交互键，可以再次打开面板。手机点交互，手柄用交互键。")
            .button("我的 Agent 同伴").button("我的车万女仆").button("开始游玩")
            .validResultHandler(r->{if(r.clickedButtonId()==0)companions.run();else if(r.clickedButtonId()==1)maids.run();}).build();
    }
    public static SimpleForm panel(Map<String,Object> maid,Runnable model,Runnable controls,Runnable back){
        String content="生命："+number(maid.get("health"))+" / "+number(maid.get("maxHealth"))+"    饱食："+number(maid.get("hunger"))+
            "\n工作："+taskName(Objects.toString(maid.get("taskId")))+
            "\n跟随："+(Boolean.TRUE.equals(maid.get("follow"))?"跟着我":"留在附近")+
            "    拾取："+(Boolean.TRUE.equals(maid.get("pickup"))?"开启":"关闭")+
            "\n模型："+Objects.toString(maid.get("effectiveModel"),"尚未配置")+
            (Boolean.TRUE.equals(maid.get("sleeping"))?"\n正在睡觉，醒来后才能调整工作。":"");
        return SimpleForm.builder().title(Objects.toString(maid.get("name"))+" · 我的女仆").content(content)
            .button("模型 / 人格 / 聊天语言").button("工作 / 跟随 / 拾取").button("返回女仆列表")
            .validResultHandler(r->{if(r.clickedButtonId()==0)model.run();else if(r.clickedButtonId()==1)controls.run();else back.run();}).build();
    }
    public static CustomForm controls(Map<String,Object> maid,List<Map<String,Object>> tasks,Consumer<Map<String,Object>> save){
        String current=Objects.toString(maid.get("taskId"));
        List<Map<String,Object>> available=tasks.stream().filter(t->Boolean.TRUE.equals(t.get("enabled"))||current.equals(t.get("id"))).toList();
        List<String> ids=available.stream().map(t->Objects.toString(t.get("id"))).toList();
        if(ids.isEmpty())throw new IllegalArgumentException("maid_tasks_empty");
        return CustomForm.builder().title("女仆工作与行动")
            .label(Objects.toString(maid.get("name"))+"\n选择工作后仍需准备相应工具和材料；不会自动赠送工具。")
            .dropdown("工作",ids.stream().map(MaidForms::taskName).toList(),Math.max(0,ids.indexOf(current)))
            .toggle("跟随我（关闭后留在附近）",Boolean.TRUE.equals(maid.get("follow")))
            .toggle("自动拾取物品",Boolean.TRUE.equals(maid.get("pickup")))
            .validResultHandler(r->{int i=r.asDropdown(1);if(i<0||i>=ids.size())return;
                save.accept(map("maidUuid",maid.get("maidUuid"),"controlRevision",maid.get("controlRevision"),"taskId",ids.get(i),"follow",r.asToggle(2),"pickup",r.asToggle(3)));
            }).build();
    }
    private static String number(Object value){return value instanceof Number n?String.format(Locale.ROOT,"%.1f",n.doubleValue()):"未知";}
    static String taskName(String id){
        String key=id.startsWith("touhou_little_maid:")?id.substring(id.indexOf(':')+1):id;
        return switch(key){case "idle"->"空闲";case "attack"->"近战护卫";case "ranged_attack"->"弓箭护卫";case "crossbow_attack"->"弩箭护卫";case "danmaku_attack"->"弹幕护卫";case "trident_attack"->"三叉戟护卫";case "farm"->"种植与收获";case "sugar_cane"->"照料甘蔗";case "melon"->"收获瓜类";case "cocoa"->"照料可可";case "honey"->"采蜜";case "grass"->"清理花草";case "snow"->"清雪";case "feed"->"给主人喂食";case "shears"->"剪毛";case "milk"->"挤奶";case "torch"->"放置火把";case "feed_animal"->"繁殖动物";case "extinguishing"->"灭火";case "board_games"->"下棋";case "gun_attack"->"枪械护卫";case "fishing"->"钓鱼";default->id;};
    }
    public static CustomForm site(Map<String,Object> old,Consumer<Map<String,Object>> save){
        boolean fresh=old.isEmpty();String sid=Objects.toString(old.getOrDefault("siteId","maw_qwen"));
        return CustomForm.builder().title("女仆 LLM 服务 · 全服配置")
            .label("此服务可供全服女仆选择。保存不调用模型；Key 留空保留已有值。输入框会显示新输入的 Key，请避开录屏。")
            .input(fresh?"新服务 ID（英文 / 数字 / 下划线）":"服务 ID（已有 ID 不可改）","例如 maw_qwen",sid)
            .input("完整聊天接口地址（包含 /chat/completions）","https://…/v1/chat/completions",Objects.toString(old.getOrDefault("url","https://coding.dashscope.aliyuncs.com/v1/chat/completions")))
            .input("模型 ID（英文逗号分隔，最多 24 个）","qwen3.7-plus",String.join(",",strings(old.getOrDefault("models",List.of("qwen3.7-plus")))))
            .input(Boolean.TRUE.equals(old.get("keyConfigured"))?"API Key（已保存；留空保持）":"API Key","留空不会清空原 Key","")
            .toggle("启用此服务",Boolean.TRUE.equals(old.get("enabled")))
            .toggle("接口支持 thinking 字段",Boolean.TRUE.equals(old.get("hasThinkingField")))
            .validResultHandler(r->{
                String id=r.asInput(1).trim();if(!fresh&&!sid.equals(id))return;
                List<String> models=Arrays.stream(r.asInput(3).split(",",-1)).map(String::trim).toList();
                save.accept(map("siteId",id,"revision",old.getOrDefault("revision","new"),"url",r.asInput(2).trim(),"models",models,"apiKey",r.asInput(4).trim(),"enabled",r.asToggle(5),"hasThinkingField",r.asToggle(6)));
            }).build();
    }
    public static CustomForm settings(Map<String,Object> maid,Map<String,Object> site,Consumer<Map<String,Object>> save){
        List<String> models=strings(site.get("models"));if(models.isEmpty())throw new IllegalArgumentException("maid_models_empty");
        int selected=Math.max(0,models.indexOf(Objects.toString(maid.get("model"))));
        return CustomForm.builder().title("女仆人格与模型")
            .label(Objects.toString(maid.get("name"))+"\n服务："+site.get("siteId")+"\n仅修改这只女仆；保留原生记忆、语音设置和工作进度。")
            .dropdown("使用的模型",models,selected)
            .dropdown("聊天语言",List.of("简体中文","English"),Objects.equals(maid.get("language"),"en_us")?1:0)
            .input("自定义人格（留空使用原模型的人设）","例如：温柔的探险伙伴，用中文回答",Objects.toString(maid.getOrDefault("customSetting","")))
            .validResultHandler(r->{int index=r.asDropdown(1),language=r.asDropdown(2);if(index<0||index>=models.size()||language<0||language>1)return;
                save.accept(map("maidUuid",maid.get("maidUuid"),"revision",maid.get("revision"),"siteId",site.get("siteId"),"model",models.get(index),"language",language==0?"zh_cn":"en_us","customSetting",r.asInput(3)));
            }).build();
    }
    static List<String> strings(Object value){return value instanceof List<?> list?list.stream().map(Objects::toString).toList():List.of();}
}
