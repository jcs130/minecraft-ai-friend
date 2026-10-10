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
        System.out.println("{\"ok\":true,\"checks\":"+checks+",\"actualPhoneTested\":false}");
    }
}
