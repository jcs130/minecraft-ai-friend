package dev.qiandeng.bedrock.agents;

import static dev.qiandeng.bedrock.agents.AgentForms.map;
import java.util.*;
import java.util.function.Consumer;
import org.geysermc.cumulus.form.CustomForm;

/** Bedrock views of TLM's native site and per-maid fields, never copies a stored key. */
public final class MaidForms {
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
