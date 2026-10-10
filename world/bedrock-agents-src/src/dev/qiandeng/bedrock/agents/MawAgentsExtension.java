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
import java.util.function.BiConsumer;
import org.geysermc.event.subscribe.Subscribe;
import org.geysermc.geyser.api.connection.GeyserConnection;
import org.geysermc.geyser.api.command.*;
import org.geysermc.geyser.api.util.TriState;
import org.geysermc.geyser.api.event.lifecycle.GeyserDefineCommandsEvent;
import org.geysermc.geyser.api.event.bedrock.SessionJoinEvent;
import org.geysermc.geyser.api.event.bedrock.SessionDisconnectEvent;
import org.geysermc.geyser.api.extension.Extension;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.cumulus.form.*;
import org.jose4j.json.internal.json_simple.JSONValue;
import org.jose4j.json.internal.json_simple.parser.JSONParser;

/** A separate server-owned Geyser extension; model resource extension stays unchanged. */
public final class MawAgentsExtension implements Extension {
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final Map<GeyserConnection,Long> inFlight=Collections.synchronizedMap(new WeakHashMap<>());
    private final Map<GeyserConnection,UiSession> sessions=Collections.synchronizedMap(new WeakHashMap<>());
    private static final class UiSession {
        final String id=UUID.randomUUID().toString();
        boolean bound;
        String acknowledged="",displayed="";
        int failures;
    }
    @Subscribe public void commands(GeyserDefineCommandsEvent event) {
        event.register(Command.<CommandSource>builder(this).source(CommandSource.class).name("menu").description("我的 Agent 同伴：模型配置与目标").permission("mawagent.menu",TriState.TRUE).suggestedOpOnly(false).executableOnConsole(false).playerOnly(true).bedrockOnly(true).executor((source,command,args)->{if(source.connection()!=null)menu(source.connection());}).build());
        event.register(Command.<CommandSource>builder(this).source(CommandSource.class).name("maid").description("车万女仆：原生 LLM 服务与人格配置").permission("mawagent.maid",TriState.TRUE).suggestedOpOnly(false).executableOnConsole(false).playerOnly(true).bedrockOnly(true).executor((source,command,args)->{if(source.connection()!=null)maidMenu(source.connection());}).build());
        logger().info("MAW_AGENTS ready nativeForms=true modelKeysRedacted=true clientRequired=false command=/mawagent menu");
        logger().info("MAW_MAID_FORMS ready nativeConfig=true permission=native_operator ownerOnly=true command=/mawagent maid");
        logger().info("MAW_VISUAL_MENUS ready welcomeButtons=true ownEntityClick=true controls=true privateEvents=true");
    }
    @Subscribe public void join(SessionJoinEvent event) {
        if(event.connection() instanceof GeyserSession session){
            UiSession state=new UiSession();sessions.put(session,state);
            session.scheduleInEventLoop(()->pollUi(session,state),1,TimeUnit.SECONDS);
            session.scheduleInEventLoop(()->{
                if(!session.isClosed())show(session,MaidForms.welcome(()->menu(session),()->maidMenu(session)));
            },4,TimeUnit.SECONDS);
        }
    }
    @Subscribe public void disconnect(SessionDisconnectEvent event){sessions.remove(event.connection());inFlight.remove(event.connection());}
    private void pollUi(GeyserSession session,UiSession state){
        if(session.isClosed()||sessions.get(session)!=state)return;
        Map<String,Object> args=map("sessionId",state.id);
        if(state.bound&&!state.acknowledged.isEmpty())args.put("ackEventId",state.acknowledged);
        String action=state.bound?"bedrock.poll":"bedrock.bind";
        exchange(session,action,args,(data,error)->{
            if(session.isClosed()||sessions.get(session)!=state)return;
            if(error!=null){state.failures++;if(error.equals("bedrock_menu_session_expired")||error.equals("owner_connection_not_online"))state.bound=false;}
            else{
                state.failures=0;state.bound=true;
                if(data.get("event") instanceof Map<?,?> raw&&inFlight.getOrDefault(session,0L)<=System.currentTimeMillis()){
                    @SuppressWarnings("unchecked") Map<String,Object> event=(Map<String,Object>)raw;
                    try{
                        String id=Objects.toString(event.get("eventId"));UUID.fromString(id);
                        UUID target=UUID.fromString(Objects.toString(event.get("targetUuid")));
                        if(!Long.valueOf(1).equals(event.get("schemaVersion"))||!session.playerEntity().uuid().toString().equals(event.get("ownerUuid")))throw new IllegalArgumentException();
                        state.acknowledged=id;
                        if(!state.displayed.equals(id)){
                            state.displayed=id;
                            if(event.get("kind").equals("maid"))maidPanel(session,target.toString());
                            else if(event.get("kind").equals("companion"))companionPanel(session,target.toString());
                        }
                    }catch(RuntimeException ignored){/* Never show untrusted or another owner's event. */}
                }
            }
            session.scheduleInEventLoop(()->pollUi(session,state),Math.min(10,1<<Math.min(state.failures,3)),TimeUnit.SECONDS);
        });
    }
    private static void show(GeyserConnection c,Form form){if(c instanceof GeyserSession session)session.executeInEventLoop(()->{if(!session.isClosed())session.sendForm(form);});else c.sendForm(form);}
    private void request(GeyserConnection c,String action,Map<String,Object> args,Consumer<Map<String,Object>> done) {
        long now=System.currentTimeMillis();synchronized(inFlight){if(inFlight.getOrDefault(c,0L)>now)return;inFlight.put(c,now+15000);}
        exchange(c,action,args,(result,error)->{
            inFlight.remove(c);
            if(error!=null){message(c,"操作未完成："+explain(error));return;}
            done.accept(result);
        });
    }
    private void exchange(GeyserConnection c,String action,Map<String,Object> args,BiConsumer<Map<String,Object>,String> done) {
        try {
            Path config=dataFolder().getParent().getParent().resolve("maw-agents-private.json");Map<String,Object> settings=parse(Files.readString(config,StandardCharsets.UTF_8));
            String endpoint=Objects.toString(settings.get("endpoint")),secret=Objects.toString(settings.get("secret"));URI uri=URI.create(endpoint);
            if(!"http".equals(uri.getScheme())||!"127.0.0.1".equals(uri.getHost())||!"/ui".equals(uri.getPath())||uri.getRawQuery()!=null||uri.getUserInfo()!=null||!secret.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("invalid_private_bridge");
            UUID owner=c.playerEntity().uuid();String name=c.javaUsername();if(owner==null||name==null)throw new IllegalArgumentException("java_identity_unavailable");
            byte[] body=JSONValue.toJSONString(map("ownerUuid",owner.toString(),"playerName",name,"action",action,"arguments",args)).getBytes(StandardCharsets.UTF_8);
            HttpRequest req=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(12)).header("Content-Type","application/json").header("X-Maw-Bridge",secret).POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
            http.sendAsync(req,HttpResponse.BodyHandlers.ofInputStream()).whenComplete((response,error)->{
                if(error!=null){complete(c,done,Map.of(),"bridge_reply_unknown");return;}
                try(InputStream input=response.body()){
                    byte[] bytes=input.readNBytes(1048577);if(bytes.length>1048576)throw new IOException();Map<String,Object> result=parse(new String(bytes,StandardCharsets.UTF_8));
                    if(response.statusCode()!=200||!Boolean.TRUE.equals(result.get("ok"))){complete(c,done,Map.of(),Objects.toString(result.get("code"),"operation_failed"));return;}
                    complete(c,done,result,null);
                }catch(Exception ex){complete(c,done,Map.of(),"bridge_reply_unknown");}
            });
        }catch(Exception error){complete(c,done,Map.of(),"bridge_not_ready");}
    }
    private static void complete(GeyserConnection c,BiConsumer<Map<String,Object>,String> done,Map<String,Object> data,String error){if(c instanceof GeyserSession session)session.executeInEventLoop(()->{if(!session.isClosed())done.accept(data,error);});else done.accept(data,error);}
    private static String explain(String code){return switch(code){case "select_hosted_driver_first"->"先在控制方式中选择服务器托管。";case "configure_model_and_key_first"->"请先保存模型名称和 API Key。";case "body_busy_stop_before_reconfigure","hosted_brain_busy_stop_first"->"同伴还在忙，请先暂停，再查看状态。";case "model_host_not_enabled_by_operator","model_endpoint_requires_allowed_https_host"->"该模型服务地址尚未由服主启用。";case "model_result_unknown_review_before_new_goal","body_reconciliation_required"->"上次结果不明，已暂停；需要服主核对，不能直接重试。";case "maid_mod_unavailable"->"当前世界没有启用车万女仆。";case "maid_not_owned_nearby_alive"->"请靠近属于你的女仆，再打开面板。";case "maid_site_requires_operator"->"全服模型服务需要服主管理。";case "maid_settings_changed_refresh","maid_controls_changed_refresh","maid_site_changed_refresh"->"设置已经变化，请重新打开面板后保存。";case "maid_sleeping"->"女仆正在睡觉，请等她醒来后再调整工作。";case "task_disabled","unknown_or_hidden_task"->"暂时不能选择这项工作，请检查女仆的工具和工作条件。";case "maid_model_not_in_site","maid_site_not_enabled"->"这个模型服务暂不可用，请选择已启用的服务。";case "bridge_reply_unknown"->"暂时没有收到回执。操作可能已提交，请先查看状态，不要重复创建或下达目标。";case "bridge_not_ready","owner_connection_not_online"->"同伴管理暂未就绪，请稍后重试。";default->"设置未能保存，请检查填写内容后重新打开面板。";};}
    private void message(GeyserConnection c,String content){show(c,SimpleForm.builder().title("同伴管理").content(content).button("返回菜单").validResultHandler(r->menu(c)).build());}
    private void menu(GeyserConnection c){request(c,"menu",Map.of(),data->{
        var form=SimpleForm.builder().title("我的 Agent 同伴").content("同伴由服务端常驻；主人离线后也可行动。\n模型设置和访问令牌仅属于你的账号。")
            .button("配置模型 / API Key").button("创建常驻同伴").button("外部 Agent 接入").button("我的车万女仆");
        List<Map<String,Object>> bodies=rows(data.get("companions"));for(var body:bodies)form.button(Objects.toString(body.get("name"))+" · "+Objects.toString(body.get("status")));
        show(c,form.validResultHandler(r->{int n=r.clickedButtonId();if(n==0)profiles(c,rows(data.get("profiles")));else if(n==1)show(c,AgentForms.create(args->request(c,"create",args,result->menu(c))));else if(n==2)external(c,Objects.toString(data.get("endpoint")));else if(n==3)maidMenu(c);else if(n>=4&&n-4<bodies.size())detail(c,bodies.get(n-4),rows(data.get("profiles")));}).build());
    });}
    private void maidMenu(GeyserConnection c){request(c,"maid.menu",Map.of(),data->{
        boolean admin=Boolean.TRUE.equals(data.get("canEditSites"));List<Map<String,Object>> maids=rows(data.get("maids")),sites=rows(data.get("sites"));
        var form=SimpleForm.builder().title("我的车万女仆").content("空手对自己的女仆按交互键，也能打开面板。\n附近 32 格内的女仆会显示在这里。\n"+(Boolean.TRUE.equals(data.get("llmEnabled"))?"智能聊天已启用。":"服主已关闭智能聊天。")+"\n"+(admin?"你可以管理全服模型服务。":"模型服务和 API Key 由服主管理。")+(maids.isEmpty()?"\n未发现自己的女仆，请先靠近已驯服的女仆。":""));
        if(admin)form.button("管理全服 LLM 服务 / API Key");for(var maid:maids)form.button(Objects.toString(maid.get("name"))+" · "+Objects.toString(maid.get("effectiveModel"),"未配置"));form.button("返回同伴菜单");
        show(c,form.validResultHandler(r->{int i=r.clickedButtonId();if(admin&&i==0){maidSites(c,sites);return;}int index=i-(admin?1:0);if(index>=0&&index<maids.size())maidPanel(c,Objects.toString(maids.get(index).get("maidUuid")));else menu(c);}).build());
    });}
    private void companionPanel(GeyserConnection c,String id){request(c,"menu",Map.of(),data->{var body=rows(data.get("companions")).stream().filter(b->id.equals(b.get("bodyId"))).findFirst();if(body.isPresent())detail(c,body.get(),rows(data.get("profiles")));else menu(c);});}
    private void maidPanel(GeyserConnection c,String id){request(c,"maid.detail",map("maidUuid",id),data->{
        @SuppressWarnings("unchecked") Map<String,Object> maid=(Map<String,Object>)data.get("maid");
        show(c,MaidForms.panel(maid,()->request(c,"maid.menu",Map.of(),menu->maidSelectSite(c,maid,rows(menu.get("sites")))),
            ()->request(c,"maid.tasks",map("maidUuid",id),tasks->{
                @SuppressWarnings("unchecked") Map<String,Object> current=(Map<String,Object>)tasks.get("maid");
                show(c,MaidForms.controls(current,rows(tasks.get("tasks")),args->request(c,"maid.controls",args,saved->maidPanel(c,id))));
            }),()->maidMenu(c)));
    });}
    private void maidSites(GeyserConnection c,List<Map<String,Object>> sites){
        List<Map<String,Object>> editable=sites.stream().filter(s->Boolean.TRUE.equals(s.get("editable"))).toList();
        var form=SimpleForm.builder().title("女仆模型服务 · 全服共用").content("这里配置全服女仆可用的模型服务。已有 Key 不会显示；只保存设置，不会自动开始聊天。").button("添加 OpenAI 兼容服务");
        for(var site:editable)form.button(Objects.toString(site.get("siteId"))+" · "+(Boolean.TRUE.equals(site.get("enabled"))?"启用":"关闭")+" · "+(Boolean.TRUE.equals(site.get("keyConfigured"))?"已有 Key":"未配 Key"));form.button("返回");
        show(c,form.validResultHandler(r->{int i=r.clickedButtonId();if(i<0||i>editable.size()){maidMenu(c);return;}show(c,MaidForms.site(i==0?Map.of():editable.get(i-1),args->request(c,"maid.site.save",args,result->maidMenu(c))));}).build());
    }
    private void maidSelectSite(GeyserConnection c,Map<String,Object> maid,List<Map<String,Object>> sites){
        List<Map<String,Object>> enabled=sites.stream().filter(s->Boolean.TRUE.equals(s.get("enabled"))&&!MaidForms.strings(s.get("models")).isEmpty()).toList();
        var form=SimpleForm.builder().title(Objects.toString(maid.get("name"))+" · 选择模型服务").content("当前服务："+Objects.toString(maid.get("effectiveSiteId"),"无")+"\n当前模型："+Objects.toString(maid.get("effectiveModel"),"无")+"\n先选择服务，再设置模型和人格。"+(enabled.isEmpty()?"\n暂无可用模型服务，请由服主配置。":""));
        for(var site:enabled)form.button(Objects.toString(site.get("siteId")));form.button("返回");
        show(c,form.validResultHandler(r->{int i=r.clickedButtonId();if(i<0||i>=enabled.size()){maidPanel(c,Objects.toString(maid.get("maidUuid")));return;}show(c,MaidForms.settings(maid,enabled.get(i),args->request(c,"maid.settings",args,result->maidPanel(c,Objects.toString(maid.get("maidUuid"))))));}).build());
    }
    private void profiles(GeyserConnection c,List<Map<String,Object>> profiles){var form=SimpleForm.builder().title("我的模型配置").content("支持 OpenAI 兼容、DeepSeek、Claude。已有 Key 不回显；留空表示保留。\n输入框不是密码框，请留意录屏。") .button("添加模型");for(var p:profiles)form.button(Objects.toString(p.get("name"))+" · "+(Boolean.TRUE.equals(p.get("keyConfigured"))?"已配置 Key":"尚无 Key"));show(c,form.validResultHandler(r->{int i=r.clickedButtonId();if(i>=0&&i<=profiles.size())show(c,AgentForms.profile(i==0?Map.of():profiles.get(i-1),args->request(c,"profile.save",args,result->message(c,"模型配置已保存。"))));}).build());}
    private void detail(GeyserConnection c,Map<String,Object> body,List<Map<String,Object>> profiles){String id=Objects.toString(body.get("bodyId"));String content="身体："+id+"\n状态："+body.get("status")+" / "+body.get("driver")+"\n生命："+Objects.toString(body.get("health"),"离线")+"\n坐标："+Objects.toString(body.get("position"),"未知")+(body.containsKey("brain")?"\n大脑："+body.get("brain"):"");show(c,SimpleForm.builder().title(Objects.toString(body.get("name"))).content(content).button("下达目标").button("暂停行动").button("控制方式 / 模型 / 行动许可").button("返回").validResultHandler(r->{switch(r.clickedButtonId()){case 0->show(c,AgentForms.task(args->{args.put("companion",id);request(c,"task",args,result->message(c,"目标已提交；可回菜单查看状态。"));}));case 1->request(c,"stop",map("companion",id),result->menu(c));case 2->show(c,AgentForms.settings(body,profiles,args->{args.put("companion",id);request(c,"settings",args,result->menu(c));}));default->menu(c);}}).build());}
    private void external(GeyserConnection c,String endpoint){show(c,SimpleForm.builder().title("外部 Agent 接入").content("MCP 地址：\n"+endpoint+"\n\n外部 Agent 自己选择模型，无需交出模型 Key。\n访问令牌只允许操作你的同伴。生成新令牌会让旧令牌失效。").button("生成 / 更换我的访问令牌").button("返回").validResultHandler(r->{if(r.clickedButtonId()!=0){menu(c);return;}show(c,ModalForm.builder().title("更换访问令牌").content("旧令牌将立即失效。新令牌只显示这一次，请私下保存。确认生成？").button1("生成新令牌").button2("取消").validResultHandler(confirm->{if(confirm.clickedFirst())request(c,"token",Map.of(),result->message(c,"访问地址：\n"+result.get("endpoint")+"\n\nAuthorization: Bearer\n"+result.get("token")+"\n\n只显示这一次，请妥善保存。"));else menu(c);}).build());}).build());}
    @SuppressWarnings("unchecked") static Map<String,Object> parse(String raw)throws Exception{return (Map<String,Object>)new JSONParser().parse(raw);}
    @SuppressWarnings("unchecked") static List<Map<String,Object>> rows(Object value){return value instanceof List<?> list?(List<Map<String,Object>>)list:List.of();}
}
