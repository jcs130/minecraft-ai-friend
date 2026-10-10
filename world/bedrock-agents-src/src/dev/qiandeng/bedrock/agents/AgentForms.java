package dev.qiandeng.bedrock.agents;

import java.util.*;
import java.util.function.Consumer;
import org.geysermc.cumulus.form.*;

/** Native Cumulus forms: no chat commands or client mod needed for key entry. */
public final class AgentForms {
    static final List<String> PROVIDERS=List.of("openai","deepseek","anthropic");
    public static CustomForm profile(Map<String,Object> old,Consumer<Map<String,Object>> save) {
        String provider=Objects.toString(old.getOrDefault("provider","openai"));int selected=Math.max(0,PROVIDERS.indexOf(provider));
        return CustomForm.builder().title("配置同伴模型 · 密钥仅本人设置")
            .input("配置名称","例如：Qwen CodingPlan",Objects.toString(old.getOrDefault("name","Qwen CodingPlan")))
            .dropdown("接口协议",List.of("OpenAI 兼容（Qwen / 大多数服务）","DeepSeek","Claude / Anthropic"),selected)
            .input("模型名称","服务商提供的 model ID",Objects.toString(old.getOrDefault("model","qwen3.7-plus")))
            .input("API 基址","https://…/v1",Objects.toString(old.getOrDefault("baseUrl","https://coding.dashscope.aliyuncs.com/v1")))
            .input(Boolean.TRUE.equals(old.get("keyConfigured"))?"API Key（已保存；留空保持）":"API Key","仅输入框内填写；不要发聊天","")
            .validResultHandler(result->{
                int index=result.asDropdown(1);if(index<0||index>=PROVIDERS.size())return;
                save.accept(map("profileId",old.getOrDefault("profileId","model_"+UUID.randomUUID().toString().substring(0,8)),"name",result.asInput(0).trim(),"provider",PROVIDERS.get(index),"model",result.asInput(2).trim(),"baseUrl",result.asInput(3).trim(),"apiKey",result.asInput(4).trim()));
            }).build();
    }
    public static CustomForm create(Consumer<Map<String,Object>> save) {
        String action=UUID.randomUUID().toString();
        return CustomForm.builder().title("创建常驻同伴")
            .input("游戏名字（1–16 个英文字母、数字、下划线）","例如 MawCompanion","")
            .validResultHandler(result->save.accept(map("name",result.asInput(0).trim(),"action_id",action))).build();
    }
    public static CustomForm task(Consumer<Map<String,Object>> save) {
        return CustomForm.builder().title("给同伴一个目标")
            .input("你希望她做什么？","例如：在安全空地种一小片田，完成后停下","")
            .validResultHandler(result->save.accept(map("text",result.asInput(0)))).build();
    }
    public static CustomForm settings(Map<String,Object> body,List<Map<String,Object>> profiles,Consumer<Map<String,Object>> save) {
        List<String> labels=new ArrayList<>();int profileIndex=0;
        for(int i=0;i<profiles.size();i++){Map<String,Object> p=profiles.get(i);labels.add(Objects.toString(p.get("name"))+" / "+Objects.toString(p.get("model")));if(Objects.equals(p.get("profileId"),body.get("profileId")))profileIndex=i;}
        if(labels.isEmpty()){labels.add("尚未配置（可先使用外部 Agent）");profiles=List.of(map("profileId","default"));}
        List<Map<String,Object>> choices=List.copyOf(profiles);List<String> modes=List.of("ask","bypass","observe");
        return CustomForm.builder().title("同伴的控制方式")
            .dropdown("谁负责思考？",List.of("外部 Agent（自己提供模型）","服务器托管（使用我的模型 Key）"),Objects.equals(body.get("driver"),"hosted")?1:0)
            .dropdown("托管模型",labels,profileIndex)
            .dropdown("这个同伴的行动许可",List.of("规则许可（某些动作须主人在线确认）","独立行动（本身体可挖掘、建造、战斗）","只观察（不改世界）"),Math.max(0,modes.indexOf(body.get("permissionMode"))))
            .validResultHandler(result->{int driver=result.asDropdown(0),profile=result.asDropdown(1),mode=result.asDropdown(2);if(driver<0||driver>1||profile<0||profile>=choices.size()||mode<0||mode>=modes.size())return;save.accept(map("driver",driver==0?"external":"hosted","profileId",choices.get(profile).get("profileId"),"permissionMode",modes.get(mode)));}).build();
    }
    static Map<String,Object> map(Object... values){Map<String,Object> out=new LinkedHashMap<>();for(int i=0;i<values.length;i+=2)out.put((String)values[i],values[i+1]);return out;}
}
