package dev.qiandeng.bedrock.agents;

import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.geysermc.cumulus.form.*;
import org.geysermc.cumulus.form.impl.FormDefinitions;

/** Executes real pinned Cumulus codecs/callbacks, not a screenshot or phone test. */
public final class AgentFormsSmoke {
    static int checks;
    static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);checks++;}
    static String json(Form form){return FormDefinitions.instance().codecFor(form).jsonData(form);}
    static void respond(Form form,String data)throws Exception{FormDefinitions.instance().definitionFor(form).handleFormResponse(form,data);}
    public static void main(String[]args)throws Exception{
        AtomicReference<Map<String,Object>> sent=new AtomicReference<>();
        Map<String,Object> old=new LinkedHashMap<>(Map.of("profileId","qwen","name","Qwen","provider","openai","model","qwen3.7-plus","baseUrl","https://coding.dashscope.aliyuncs.com/v1","keyConfigured",true));
        // A malicious caller including apiKey still must not cause a default-value leak.
        old.put("apiKey","MUST_NEVER_BE_DISPLAYED");CustomForm profile=AgentForms.profile(old,sent::set);String text=json(profile);
        check(!text.contains("MUST_NEVER_BE_DISPLAYED"),"stored key leaked");check(text.contains("API Key")&&text.contains("留空保持"),"key status missing");
        respond(profile,"[\"Qwen新配置\",0,\"qwen3.7-plus\",\"https://coding.dashscope.aliyuncs.com/v1\",\"\"]");
        check(sent.get().get("apiKey").equals(""),"blank key changed");check(sent.get().get("profileId").equals("qwen"),"profile owner reference changed");check(sent.get().get("provider").equals("openai"),"protocol mismatch");
        CustomForm create=AgentForms.create(sent::set);respond(create,"[\"MawNewBody\"]");String aid=(String)sent.get().get("action_id");respond(create,"[\"MawNewBody\"]");
        check(sent.get().get("action_id").equals(aid),"same form submit created another id");UUID.fromString(aid);check(sent.get().get("name").equals("MawNewBody"),"name callback");
        CustomForm settings=AgentForms.settings(Map.of("driver","external","profileId","qwen","permissionMode","ask"),List.of(old),sent::set);respond(settings,"[1,0,1]");
        check(sent.get().get("driver").equals("hosted"),"hosted setting");check(sent.get().get("permissionMode").equals("bypass"),"permission setting");check(sent.get().get("profileId").equals("qwen"),"selected model");
        CustomForm task=AgentForms.task(sent::set);respond(task,"[\"种田，完成后停下\"]");check(sent.get().get("text").equals("种田，完成后停下"),"goal callback");
        Map<String,Object> site=new LinkedHashMap<>(Map.of("siteId","maw_qwen","url","https://coding.dashscope.aliyuncs.com/v1/chat/completions","models",List.of("qwen3.7-plus","qa-other"),"revision","qa-revision","keyConfigured",true,"apiKey","MUST_NEVER_BE_DISPLAYED"));
        CustomForm maidSite=MaidForms.site(site,sent::set);String maidJson=json(maidSite);
        check(!maidJson.contains("MUST_NEVER_BE_DISPLAYED"),"maid key leaked");check(maidJson.contains("/chat/completions")&&maidJson.contains("全服配置"),"native URL/scope missing");
        respond(maidSite,"[null,\"maw_qwen\",\"https://coding.dashscope.aliyuncs.com/v1/chat/completions\",\"qwen3.7-plus,qa-other\",\"\",true,false]");
        check(sent.get().get("apiKey").equals(""),"maid blank key retention");check(sent.get().get("revision").equals("qa-revision"),"maid site CAS");
        check(sent.get().get("models").equals(List.of("qwen3.7-plus","qa-other")),"maid model list");check(sent.get().get("enabled").equals(true),"maid enabled field");
        CustomForm maidSettings=MaidForms.settings(Map.of("maidUuid","00000000-0000-0000-0000-000000000001","name","测试女仆","model","qa-other","revision","maid-cas","customSetting","原生人设"),site,sent::set);
        check(json(maidSettings).contains("原生人设"),"native persona missing");respond(maidSettings,"[null,1,0,\"温柔的探险伙伴\"]");
        check(sent.get().get("model").equals("qa-other"),"maid selected model");check(sent.get().get("language").equals("zh_cn"),"maid Chinese");
        check(sent.get().get("revision").equals("maid-cas")&&sent.get().get("maidUuid").equals("00000000-0000-0000-0000-000000000001"),"maid owner identity/CAS");
        check(sent.get().get("customSetting").equals("温柔的探险伙伴"),"maid persona callback");
        System.out.println("{\"ok\":true,\"checks\":"+checks+",\"actualPhoneTested\":false}");
    }
}
