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
        AtomicReference<String> clicked=new AtomicReference<>();
        SimpleForm welcome=MaidForms.welcome(()->clicked.set("companions"),()->clicked.set("maids"));
        check(json(welcome).contains("无需输入命令")&&json(welcome).contains("交互键"),"controller entry instructions");
        respond(welcome,"1");check("maids".equals(clicked.get()),"direct maid welcome button");
        respond(welcome,"0");check("companions".equals(clicked.get()),"direct Numen welcome button");
        Map<String,Object> maid=AgentForms.map("maidUuid","00000000-0000-0000-0000-000000000001","name","我的女仆","health",17.5,"maxHealth",20,"hunger",18,"taskId","touhou_little_maid:idle","follow",true,"pickup",false,"controlRevision","native-controls-cas");
        SimpleForm panel=MaidForms.panel(maid,()->clicked.set("model"),()->clicked.set("controls"),()->clicked.set("back"));
        check(json(panel).contains("17.5")&&json(panel).contains("空闲"),"actual health/native job in panel");
        respond(panel,"0");check("model".equals(clicked.get()),"model graphical entry");respond(panel,"1");check("controls".equals(clicked.get()),"controls graphical entry");
        List<Map<String,Object>> tasks=List.of(Map.of("id","touhou_little_maid:idle","enabled",true),Map.of("id","touhou_little_maid:farm","enabled",true),Map.of("id","test:disabled","enabled",false));
        CustomForm controls=MaidForms.controls(maid,tasks,sent::set);String controlsJson=json(controls);
        check(controlsJson.contains("种植与收获")&&!controlsJson.contains("test:disabled"),"localized available native task options");
        respond(controls,"[null,1,false,true]");
        check(sent.get().get("taskId").equals("touhou_little_maid:farm"),"real task id kept");
        check(sent.get().get("follow").equals(false)&&sent.get().get("pickup").equals(true),"controller toggle callbacks");
        check(sent.get().get("controlRevision").equals("native-controls-cas")&&sent.get().get("maidUuid").equals(maid.get("maidUuid")),"owner/control CAS kept");
        System.out.println("{\"ok\":true,\"checks\":"+checks+",\"actualPhoneTested\":false}");
    }
}
