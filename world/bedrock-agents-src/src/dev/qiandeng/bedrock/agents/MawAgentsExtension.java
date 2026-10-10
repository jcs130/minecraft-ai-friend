package dev.qiandeng.bedrock.agents;

import static dev.qiandeng.bedrock.agents.AgentForms.map;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.geysermc.event.subscribe.Subscribe;
import org.geysermc.geyser.api.connection.GeyserConnection;
import org.geysermc.geyser.api.command.*;
import org.geysermc.geyser.api.util.TriState;
import org.geysermc.geyser.api.event.lifecycle.GeyserDefineCommandsEvent;
import org.geysermc.geyser.api.event.bedrock.SessionJoinEvent;
import org.geysermc.geyser.api.extension.Extension;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.cumulus.form.*;
import org.jose4j.json.internal.json_simple.JSONValue;
import org.jose4j.json.internal.json_simple.parser.JSONParser;

/** A separate server-owned Geyser extension; model resource extension stays unchanged. */
public final class MawAgentsExtension implements Extension {
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final Map<GeyserConnection,Long> inFlight=Collections.synchronizedMap(new WeakHashMap<>());
    @Subscribe public void commands(GeyserDefineCommandsEvent event) {
        event.register(Command.<CommandSource>builder(this).source(CommandSource.class).name("menu").description("我的 Agent 同伴：模型配置与目标").permission("mawagent.menu",TriState.TRUE).suggestedOpOnly(false).executableOnConsole(false).playerOnly(true).bedrockOnly(true).executor((source,command,args)->{if(source.connection()!=null)menu(source.connection());}).build());
        event.register(Command.<CommandSource>builder(this).source(CommandSource.class).name("maid").description("车万女仆：原生 LLM 服务与人格配置").permission("mawagent.maid",TriState.TRUE).suggestedOpOnly(false).executableOnConsole(false).playerOnly(true).bedrockOnly(true).executor((source,command,args)->{if(source.connection()!=null)maidMenu(source.connection());}).build());
        logger().info("MAW_AGENTS ready nativeForms=true modelKeysRedacted=true clientRequired=false command=/mawagent menu");
        logger().info("MAW_MAID_FORMS ready nativeConfig=true permission=native_operator ownerOnly=true command=/mawagent maid");
    }
    @Subscribe public void join(SessionJoinEvent event) {
        if(event.connection() instanceof GeyserSession session)session.scheduleInEventLoop(()->{
            if(session.isClosed())return;
            show(session,SimpleForm.builder().title("My Agent World").content("欢迎！你可以给常驻同伴配置模型、下达目标，也可以把身体交给外部 Agent。\n\n设置入口：/mawagent menu").button("管理我的同伴").button("开始游玩").validResultHandler(r->{if(r.clickedButtonId()==0)menu(session);}).build());
        },4,TimeUnit.SECONDS);
    }
    private static void show(GeyserConnection c,Form form){if(c instanceof GeyserSession session)session.executeInEventLoop(()->{if(!session.isClosed())session.sendForm(form);});else c.sendForm(form);}
    private void request(GeyserConnection c,String action,Map<String,Object> args,Consumer<Map<String,Object>> done) {
        long now=System.currentTimeMillis();synchronized(inFlight){if(inFlight.getOrDefault(c,0L)>now)return;inFlight.put(c,now+15000);}
        try {
            Path config=dataFolder().getParent().getParent().resolve("maw-agents-private.json");Map<String,Object> settings=parse(Files.readString(config,StandardCharsets.UTF_8));
            String endpoint=Objects.toString(settings.get("endpoint")),secret=Objects.toString(settings.get("secret"));URI uri=URI.create(endpoint);
            if(!"http".equals(uri.getScheme())||!"127.0.0.1".equals(uri.getHost())||!"/ui".equals(uri.getPath())||uri.getRawQuery()!=null||uri.getUserInfo()!=null||!secret.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("invalid_private_bridge");
            UUID owner=c.playerEntity().uuid();String name=c.javaUsername();if(owner==null||name==null)throw new IllegalArgumentException("java_identity_unavailable");
            byte[] body=JSONValue.toJSONString(map("ownerUuid",owner.toString(),"playerName",name,"action",action,"arguments",args)).getBytes(StandardCharsets.UTF_8);
            HttpRequest req=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(12)).header("Content-Type","application/json").header("X-Maw-Bridge",secret).POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
            http.sendAsync(req,HttpResponse.BodyHandlers.ofInputStream()).whenComplete((response,error)->{
                inFlight.remove(c);
                if(error!=null){message(c,"服务端暂时没有回执。操作可能已提交，请查看同伴状态；不要重复创建或下达同一目标。");return;}
                try(InputStream input=response.body()){
                    byte[] bytes=input.readNBytes(1048577);if(bytes.length>1048576)throw new IOException();Map<String,Object> result=parse(new String(bytes,StandardCharsets.UTF_8));
                    if(response.statusCode()!=200||!Boolean.TRUE.equals(result.get("ok"))){String code=Objects.toString(result.get("code"),"operation_failed");message(c,"操作未完成："+explain(code));return;}
                    if(c instanceof GeyserSession session)session.executeInEventLoop(()->{if(!session.isClosed())done.accept(result);});else done.accept(result);
                }catch(Exception ex){message(c,"无法读取服务端回执，请查看同伴状态。");}
            });
        }catch(Exception error){inFlight.remove(c);message(c,"同伴管理连接尚未就绪，请稍后打开菜单。");}
    }
    private static String explain(String code){return switch(code){case "select_hosted_driver_first"->"先在控制方式中选择服务器托管。";case "configure_model_and_key_first"->"请先保存模型名称和 API Key。";case "body_busy_stop_before_reconfigure","hosted_brain_busy_stop_first"->"同伴还在忙，请先暂停，再查看状态。";case "model_host_not_enabled_by_operator"->"该模型服务地址尚未由服主启用。";case "model_result_unknown_review_before_new_goal","body_reconciliation_required"->"上次结果不明，已暂停；需要服主核对，不能直接重试。";default->code.matches("[a-z0-9_]{1,100}")?code:"operation_failed";};}
    private void message(GeyserConnection c,String content){show(c,SimpleForm.builder().title("同伴管理").content(content).button("返回菜单").validResultHandler(r->menu(c)).build());}
    private void menu(GeyserConnection c){request(c,"menu",Map.of(),data->{
        var form=SimpleForm.builder().title("我的 Agent 同伴").content("同伴由服务端常驻；主人离线后也可行动。\n模型设置和访问令牌仅属于你的账号。")
            .button("配置模型 / API Key").button("创建常驻同伴").button("外部 Agent 接入").button("车万女仆 · LLM 配置");
        List<Map<String,Object>> bodies=rows(data.get("companions"));for(var body:bodies)form.button(Objects.toString(body.get("name"))+" · "+Objects.toString(body.get("status")));
        show(c,form.validResultHandler(r->{int n=r.clickedButtonId();if(n==0)profiles(c,rows(data.get("profiles")));else if(n==1)show(c,AgentForms.create(args->request(c,"create",args,result->menu(c))));else if(n==2)external(c,Objects.toString(data.get("endpoint")));else if(n==3)maidMenu(c);else if(n>=4&&n-4<bodies.size())detail(c,bodies.get(n-4),rows(data.get("profiles")));}).build());
    });}
    private void maidMenu(GeyserConnection c){request(c,"maid.menu",Map.of(),data->{
        boolean admin=Boolean.TRUE.equals(data.get("canEditSites"));List<Map<String,Object>> maids=rows(data.get("maids")),sites=rows(data.get("sites"));
        var form=SimpleForm.builder().title("车万女仆 · LLM 配置").content("使用女仆模组自己的聊天引擎与配置。\n附近 32 格内属于你的女仆会显示在这里。\n"+(Boolean.TRUE.equals(data.get("llmEnabled"))?"LLM 功能已启用。":"服主已关闭 LLM 功能。")+"\n"+(admin?"你可以管理全服模型服务。":"模型服务和 API Key 由服主管理。")+(maids.isEmpty()?"\n未发现自己的女仆，请先靠近已驯服的女仆。":""));
        if(admin)form.button("管理全服 LLM 服务 / API Key");for(var maid:maids)form.button(Objects.toString(maid.get("name"))+" · "+Objects.toString(maid.get("effectiveModel"),"未配置"));form.button("返回同伴菜单");
        show(c,form.validResultHandler(r->{int i=r.clickedButtonId();if(admin&&i==0){maidSites(c,sites);return;}int index=i-(admin?1:0);if(index>=0&&index<maids.size())maidSelectSite(c,maids.get(index),sites);else menu(c);}).build());
    });}
    private void maidSites(GeyserConnection c,List<Map<String,Object>> sites){
        List<Map<String,Object>> editable=sites.stream().filter(s->Boolean.TRUE.equals(s.get("editable"))).toList();
        var form=SimpleForm.builder().title("女仆模型服务 · 全服共用").content("复用车万女仆的原生 llm.json。Key 从不回显，保存后原生引擎立即可读；不会自动发起模型请求。").button("添加 OpenAI 兼容服务");
        for(var site:editable)form.button(Objects.toString(site.get("siteId"))+" · "+(Boolean.TRUE.equals(site.get("enabled"))?"启用":"关闭")+" · "+(Boolean.TRUE.equals(site.get("keyConfigured"))?"已有 Key":"未配 Key"));form.button("返回");
        show(c,form.validResultHandler(r->{int i=r.clickedButtonId();if(i<0||i>editable.size()){maidMenu(c);return;}show(c,MaidForms.site(i==0?Map.of():editable.get(i-1),args->request(c,"maid.site.save",args,result->maidMenu(c))));}).build());
    }
    private void maidSelectSite(GeyserConnection c,Map<String,Object> maid,List<Map<String,Object>> sites){
        List<Map<String,Object>> enabled=sites.stream().filter(s->Boolean.TRUE.equals(s.get("enabled"))&&!MaidForms.strings(s.get("models")).isEmpty()).toList();
        var form=SimpleForm.builder().title(Objects.toString(maid.get("name"))+" · 选择模型服务").content("当前服务："+Objects.toString(maid.get("effectiveSiteId"),"无")+"\n当前模型："+Objects.toString(maid.get("effectiveModel"),"无")+"\n先选择服务，再设置模型和人格。"+(enabled.isEmpty()?"\n暂无可用模型服务，请由服主配置。":""));
        for(var site:enabled)form.button(Objects.toString(site.get("siteId")));form.button("返回");
        show(c,form.validResultHandler(r->{int i=r.clickedButtonId();if(i<0||i>=enabled.size()){maidMenu(c);return;}show(c,MaidForms.settings(maid,enabled.get(i),args->request(c,"maid.settings",args,result->maidMenu(c))));}).build());
    }
    private void profiles(GeyserConnection c,List<Map<String,Object>> profiles){var form=SimpleForm.builder().title("我的模型配置").content("支持 OpenAI 兼容、DeepSeek、Claude。已有 Key 不回显；留空表示保留。\n输入框不是密码框，请留意录屏。") .button("添加模型");for(var p:profiles)form.button(Objects.toString(p.get("name"))+" · "+(Boolean.TRUE.equals(p.get("keyConfigured"))?"已配置 Key":"尚无 Key"));show(c,form.validResultHandler(r->{int i=r.clickedButtonId();if(i>=0&&i<=profiles.size())show(c,AgentForms.profile(i==0?Map.of():profiles.get(i-1),args->request(c,"profile.save",args,result->message(c,"模型配置已保存。"))));}).build());}
    private void detail(GeyserConnection c,Map<String,Object> body,List<Map<String,Object>> profiles){String id=Objects.toString(body.get("bodyId"));String content="身体："+id+"\n状态："+body.get("status")+" / "+body.get("driver")+"\n生命："+Objects.toString(body.get("health"),"离线")+"\n坐标："+Objects.toString(body.get("position"),"未知")+(body.containsKey("brain")?"\n大脑："+body.get("brain"):"");show(c,SimpleForm.builder().title(Objects.toString(body.get("name"))).content(content).button("下达目标").button("暂停行动").button("控制方式 / 模型 / 行动许可").button("返回").validResultHandler(r->{switch(r.clickedButtonId()){case 0->show(c,AgentForms.task(args->{args.put("companion",id);request(c,"task",args,result->message(c,"目标已提交；可回菜单查看状态。"));}));case 1->request(c,"stop",map("companion",id),result->menu(c));case 2->show(c,AgentForms.settings(body,profiles,args->{args.put("companion",id);request(c,"settings",args,result->menu(c));}));default->menu(c);}}).build());}
    private void external(GeyserConnection c,String endpoint){show(c,SimpleForm.builder().title("外部 Agent 接入").content("MCP 地址：\n"+endpoint+"\n\n外部 Agent 自己选择模型，无需交出模型 Key。\n访问令牌只允许操作你的同伴。生成新令牌会让旧令牌失效。").button("生成 / 更换我的访问令牌").button("返回").validResultHandler(r->{if(r.clickedButtonId()!=0){menu(c);return;}show(c,ModalForm.builder().title("更换访问令牌").content("旧令牌将立即失效。新令牌只显示这一次，请私下保存。确认生成？").button1("生成新令牌").button2("取消").validResultHandler(confirm->{if(confirm.clickedFirst())request(c,"token",Map.of(),result->message(c,"访问地址：\n"+result.get("endpoint")+"\n\nAuthorization: Bearer\n"+result.get("token")+"\n\n只显示这一次，请妥善保存。"));else menu(c);}).build());}).build());}
    @SuppressWarnings("unchecked") static Map<String,Object> parse(String raw)throws Exception{return (Map<String,Object>)new JSONParser().parse(raw);}
    @SuppressWarnings("unchecked") static List<Map<String,Object>> rows(Object value){return value instanceof List<?> list?(List<Map<String,Object>>)list:List.of();}
}
