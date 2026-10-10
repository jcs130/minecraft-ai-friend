package dev.qiandeng.maw.numenserver;

import static dev.qiandeng.maw.numenserver.PrivateStore.*;
import com.dwinovo.numen.agent.http.CancelToken;
import com.dwinovo.numen.agent.inbox.*;
import com.dwinovo.numen.agent.llm.*;
import com.dwinovo.numen.agent.loop.*;
import com.dwinovo.numen.agent.provider.*;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.program.ServerPrograms;
import com.google.gson.*;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Upstream portable AgentLoop + SerialCalls, hosted by the server rather than a game client. */
final class HeadlessBrain {
    final HeadlessRuntime r;final UUID body,owner;final Path file;
    final ConvoLog log;final ConvoState history;final AgentLoop loop;
    JsonObject persisted;boolean armed;String goalId="",lastReply="";long notBefore;
    CancelToken activeCancel;CompletableFuture<?> activeHttp;
    final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    static final ExecutorService IO=Executors.newFixedThreadPool(2,job->{Thread t=new Thread(job,"maw-numen-model");t.setDaemon(true);return t;});
    static final Semaphore CALLS=new Semaphore(2);

    HeadlessBrain(HeadlessRuntime r,UUID body) {
        this.r=r;this.body=body;owner=UUID.fromString(text(r.bodies.get(body),"ownerUuid",36));
        file=r.directory.resolve("brains").resolve(body+".json");
        persisted=Files.exists(file)?read(file):object("phase","idle","day",LocalDate.now(ZoneOffset.UTC),"callsToday",0,"callsThisGoal",0);
        if(persisted.has("pendingRequest")){persisted.addProperty("phase","unknown");persisted.addProperty("code","model_result_unknown_no_automatic_retry");write(file,persisted);}
        log=ConvoLog.atFile(r.directory.resolve("conversations").resolve(body+".jsonl"));history=new ConvoState(msg->log.append(msg,null));history.preload(log.load(64));
        SerialCalls serial=new SerialCalls(new SerialCalls.Port(){
            public boolean isProgram(LlmToolCall call){return Set.of("lua","mod_action").contains(call.name());}
            public void interrupt(LlmToolCall call,String why){if(call.name().equals("mod_action"))r.cancel(body,actionId(call));else ServerPrograms.interrupt(body,actionId(call),why);}
            public void cutOff(LlmToolCall call,boolean stopBody){if(call.name().equals("mod_action"))r.cancel(body,actionId(call));else ServerPrograms.cutOff(body,actionId(call),stopBody);}
            public void invoke(LlmToolCall call,Consumer<SerialCalls.Settled> done){
                try {
                    JsonObject args=JsonParser.parseString(call.arguments()).getAsJsonObject();args.addProperty("companion",body.toString());
                    if(call.name().equals("lua")) {
                        JsonObject accepted=r.lua(body,actionId(call),text(args,"code",16384),end->done.accept(SerialCalls.Settled.of(end.toString())));
                        if(!accepted.has("phase")||text(accepted,"phase",16).equals("unknown"))done.accept(SerialCalls.Settled.of(accepted.toString()));
                    }else if(call.name().equals("mod_action")) {
                        JsonObject accepted=r.modAction(body,actionId(call),text(args,"operation",80),HeadlessRuntime.modArguments(args),end->done.accept(SerialCalls.Settled.of(end.toString())));
                        if(!accepted.has("phase")||text(accepted,"phase",16).equals("unknown"))done.accept(SerialCalls.Settled.of(accepted.toString()));
                    }else if(call.name().equals("finish")) {
                        armed=false;persisted.addProperty("phase","completed");lastReply=text(args,"summary",2000);persisted.addProperty("lastReply",lastReply);write(file,persisted);
                        r.event(body,"goal_completed",lastReply,false,System.currentTimeMillis());done.accept(SerialCalls.Settled.of(object("ok",true,"completed",true).toString()));
                    }else if(Set.of("operations","mod_operations","mod_query","get_state").contains(call.name()))done.accept(SerialCalls.Settled.of(r.invoke(owner,call.name(),args).toString()));
                    else done.accept(SerialCalls.Settled.of(object("ok",false,"code","unknown_hosted_tool").toString()));
                }catch(RuntimeException ex){done.accept(SerialCalls.Settled.of(object("ok",false,"code",HeadlessRuntime.safeCode(ex)).toString()));}
            }
        });
        ToolPort tools=new ToolPort(){
            public void run(List<LlmToolCall> calls,Sink sink){serial.run(calls,sink);}
            public void arrived(EventQueue.Entry entry,boolean urgent){serial.arrived(entry,urgent);}
            public List<String> cancel(boolean stopBody){return serial.cancel(stopBody);}
        };
        HostPort host=new HostPort(){
            public long now(){return System.currentTimeMillis();}
            public int initiativeLevel(){return 3;}
            public boolean externallyDriven(){return !armed||!text(r.bodies.get(body),"driver",16).equals("hosted");}
            public String injectionPreamble(){return r.snapshot(body,true).toString();}
            public boolean bodyTaskRunning(){return ServerPrograms.running(body);}
            public String activity(){return persisted.has("goal")?text(persisted,"goal",2000):null;}
        };
        ModelPort model=new ModelPort(){
            public String unavailable(){return modelUnavailable();}
            public ModelRequest turnRequest(){return new ModelRequest(history.snapshot(),specs(),prompt());}
            public void call(ModelRequest request,CancelToken cancel,Consumer<Delta> delta,Consumer<ModelOutcome> done){callModel(request,cancel,done);}
        };
        MemoryPort memory=new MemoryPort(){
            public boolean compactionDue(){return false;}
            public Compaction compaction(boolean auto){throw new IllegalStateException("manual_new_goal_required");}
            public void clear(){log.appendClearBoundary();history.replaceAll(List.of());}
        };
        loop=new AgentLoop(text(r.bodies.get(body),"name",16),model,tools,history,new EventQueue(EventQueue.Journal.NONE),memory,host);
    }
    String actionId(LlmToolCall call){return "brain-"+hash(goalId+":"+call.id()).substring(0,48);}
    JsonObject selected(){return r.profile(owner,text(r.bodies.get(body),"profileId",32),false);}
    String modelUnavailable(){
        if(persisted.has("pendingRequest")||"unknown".equals(text(persisted,"phase",30)))return "model_result_unknown_review_before_new_goal";
        JsonObject p=selected();if(text(p,"apiKey",4096).isBlank()||text(p,"model",120).isBlank())return "configure_model_and_key_first";
        if(history.snapshot().size()>150)return "conversation_limit_start_new_goal";
        return null;
    }
    void task(String text) {
        if(busy())throw new IllegalArgumentException("hosted_brain_busy_stop_first");
        String unavailable=modelUnavailable();if(unavailable!=null)throw new IllegalArgumentException(unavailable);
        goalId=UUID.randomUUID().toString();armed=true;
        persisted.addProperty("goalId",goalId);persisted.addProperty("goal",text);persisted.addProperty("phase","active");persisted.addProperty("callsThisGoal",0);write(file,persisted);
        loop.push(List.of(new EventQueue.Entry(EventTypes.QUERY,text,System.currentTimeMillis(),true)));
    }
    void tick(){if(armed)loop.tick();}
    void arrived(EventQueue.Entry entry){if(armed)loop.push(List.of(entry));}
    void died(){loop.halt(HaltReason.DEATH);}
    void respawned(){loop.respawned();}
    void stop(String reason){
        armed=false;loop.halt(reason.equals("server_stopping")?HaltReason.DISCONNECT:HaltReason.OWNER_STOP,reason);
        if(activeCancel!=null)activeCancel.cancel();if(activeHttp!=null)activeHttp.cancel(true);
        if(persisted.has("pendingRequest")){persisted.addProperty("phase","unknown");persisted.addProperty("code","cancelled_model_result_unknown_no_retry");}
        else persisted.addProperty("phase","stopped");write(file,persisted);
    }
    boolean busy(){return armed||loop.status().busy();}
    JsonObject status(){
        LoopStatus s=loop.status();return object("active",armed,"phase",persisted.get("phase"),"loopPhase",s.phase(),"hold",s.hold(),"callsToday",persisted.get("callsToday"),"callsThisGoal",persisted.get("callsThisGoal"),"lastReply",persisted.has("lastReply")?persisted.get("lastReply"):new JsonPrimitive(""));
    }
    void failClosed(String code,CancelToken cancel){
        armed=false;persisted.addProperty("phase","unknown");persisted.addProperty("code",code);write(file,persisted);
        cancel.cancel();loop.halt(HaltReason.OWNER_STOP,code);r.event(body,"model_paused",code,true,System.currentTimeMillis());
    }
    void callModel(ModelRequest request,CancelToken cancel,Consumer<ModelOutcome> done) {
        // AgentLoop normally asks the model to acknowledge every tool batch.
        // Our explicit finish tool is a terminal boundary, so do not make another paid call.
        if(!armed){loop.halt(HaltReason.EXTERNAL,"goal_completed");return;}
        String day=LocalDate.now(ZoneOffset.UTC).toString();
        if(!day.equals(text(persisted,"day",20))){persisted.addProperty("day",day);persisted.addProperty("callsToday",0);}
        int today=persisted.get("callsToday").getAsInt(),goal=persisted.get("callsThisGoal").getAsInt();
        int limit=r.config.has("dailyModelCallsPerBody")?r.config.get("dailyModelCallsPerBody").getAsInt():100;
        if(today>=limit||goal>=24||!CALLS.tryAcquire()) {armed=false;persisted.addProperty("phase","paused");persisted.addProperty("code",today>=limit?"daily_model_budget_reached":goal>=24?"goal_model_budget_reached":"model_concurrency_busy");write(file,persisted);cancel.cancel();loop.halt(HaltReason.OWNER_STOP,"model_budget_or_concurrency_limit");return;}
        JsonObject profile=selected();r.validateEndpoint(text(profile,"baseUrl",250));
        persisted.addProperty("callsToday",today+1);persisted.addProperty("callsThisGoal",goal+1);persisted.addProperty("pendingRequest",UUID.randomUUID().toString());write(file,persisted);
        activeCancel=cancel;
        // No redirect and no transport retry: an uncertain paid request is never silently repeated.
        CompletableFuture<Answer> future=CompletableFuture.supplyAsync(()->request(profile,request,cancel),IO).orTimeout(65,TimeUnit.SECONDS);activeHttp=future;
        future.whenComplete((answer,error)->r.requests.add(()->{
            activeHttp=null;activeCancel=null;CALLS.release();
            if(cancel.isCancelled())return;
            if(error!=null){failClosed("model_request_failed_or_unknown_no_retry",cancel);return;}
            persisted.remove("pendingRequest");persisted.addProperty("phase","active");persisted.addProperty("lastUsageTokens",answer.usage.total());
            lastReply=answer.turn.content();if(lastReply.length()>2000)lastReply=lastReply.substring(0,2000);persisted.addProperty("lastReply",lastReply);write(file,persisted);
            done.accept(new ModelOutcome.Answered(answer.turn,answer.usage));
            if(answer.turn.toolCalls().isEmpty()){armed=false;persisted.addProperty("phase","completed");write(file,persisted);r.event(body,"reply",lastReply,false,System.currentTimeMillis());}
        }));
    }
    record Answer(AssistantTurn turn,Usage usage){}
    Answer request(JsonObject config,ModelRequest request,CancelToken cancel) {
        try {
            LlmProvider provider=switch(text(config,"provider",24)){case "anthropic"->new AnthropicProvider();case "deepseek"->new DeepSeekProvider();default->new OpenAIProvider();};
            List<JsonObject> messages=new ArrayList<>();String origin=provider.getClass().getSimpleName()+"/"+text(config,"model",120);
            for(var msg:ProtocolView.forWire(request.messages()))switch(msg){
                case ConvoState.Msg.User u->messages.add(provider.buildUserMessage(u.content()));
                case ConvoState.Msg.Assistant a->messages.addAll(provider.assistantToRequestItems(a.turn().sameOrigin(origin)?a.turn():a.turn().withoutProviderPrivateFields()));
                case ConvoState.Msg.Tool t->messages.add(provider.buildToolResultMessage(t.toolCallId(),t.content()));
                default->throw new IllegalStateException("invalid_protocol_view");
            }
            JsonObject body=provider.buildRequestBody(text(config,"model",120),request.systemPrompt(),messages,provider.buildToolList(request.tools()));provider.applyGenerationParams(body,null,4096);
            byte[] payload=body.toString().getBytes(StandardCharsets.UTF_8);if(payload.length>524288)throw new IllegalArgumentException("model_context_limit");
            String base=text(config,"baseUrl",250).replaceAll("/+$","");String url=base.endsWith(provider.chatPath())?base:base+provider.chatPath();
            HttpRequest.Builder builder=HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(payload));
            provider.authHeaders(text(config,"apiKey",4096)).forEach(builder::header);
            CompletableFuture<HttpResponse<InputStream>> sending=http.sendAsync(builder.build(),HttpResponse.BodyHandlers.ofInputStream());Runnable unhook=cancel.onCancel(()->sending.cancel(true));
            try {
                HttpResponse<InputStream> response=sending.get(60,TimeUnit.SECONDS);
                try(InputStream input=response.body()){
                    Runnable close=cancel.onCancel(()->{try{input.close();}catch(IOException ignored){}});
                    try {
                        byte[] bytes=input.readNBytes(1048577);if(bytes.length>1048576||response.statusCode()!=200||cancel.isCancelled())throw new IllegalStateException("model_http_failed");
                        JsonObject json=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
                        return new Answer(provider.parseResponseBody(json).withOrigin(origin),provider.usage(json.has("usage")?json.getAsJsonObject("usage"):null));
                    }finally{close.run();}
                }
            }finally{unhook.run();}
        }catch(Exception error){throw new CompletionException(new IllegalStateException("model_request_failed_no_retry"));}
    }
    List<IToolSpec> specs() {
        List<IToolSpec> list=new ArrayList<>();
        for(var item:HeadlessHttp.catalog()){JsonObject tool=item.getAsJsonObject();if(!Set.of("operations","mod_operations","mod_query","mod_action","get_state","lua").contains(tool.get("name").getAsString())||r.mods==null&&tool.get("name").getAsString().startsWith("mod_"))continue;
            JsonObject schema=tool.getAsJsonObject("inputSchema").deepCopy();schema.getAsJsonObject("properties").remove("companion");schema.getAsJsonObject("properties").remove("lease_id");schema.getAsJsonObject("properties").remove("action_id");
            JsonArray required=new JsonArray();for(var k:schema.getAsJsonArray("required"))if(!Set.of("companion","lease_id","action_id").contains(k.getAsString()))required.add(k.deepCopy());schema.add("required",required);list.add(spec(tool.get("name").getAsString(),tool.get("description").getAsString(),schema));
        }
        list.add(spec("finish","Finish this goal once actual results are checked; explain outcome or what blocked progress.",object("type","object","properties",object("summary",HeadlessHttp.property("string","Concise result, based on observations.")),"required",new Gson().toJsonTree(List.of("summary")),"additionalProperties",false)));return list;
    }
    static IToolSpec spec(String name,String description,JsonObject schema){return new IToolSpec(){public String name(){return name;}public String description(){return description;}@SuppressWarnings("unchecked")public Map<String,Object> parameterSchema(){return new Gson().fromJson(schema,Map.class);}};}
    String prompt(){return "你是 My Agent World 中有持久身体的生存同伴。主人可离线。完成当前目标后 finish，保持中文简明回复。没有 OP，不能凭空生成物资。先 get_state、operations 查询真实 API，不猜函数/参数。Lua 是原生 Numen 程序，动作异步并串行，回执提供实际终态。只使用 availableWithoutClient=true 的 SERVER 函数；没有客户端 UI、文件或网络能力。世界坐标必须绝对坐标。遇 unknown 不重试。不要伤害玩家、村民、宠物或破坏别人的建筑。有限预算，每目标最多24次请求。不要把模型配置或密钥写进聊天。原生能力分组："+r.operations(null).toString();}
}
