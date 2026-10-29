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
    final int goalLimit;
    JsonObject persisted;boolean armed;String goalId="",lastReply="";long notBefore;
    CancelToken activeCancel;CompletableFuture<?> activeHttp;
    final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    static final ExecutorService IO=Executors.newFixedThreadPool(2,job->{Thread t=new Thread(job,"maw-numen-model");t.setDaemon(true);return t;});
    static final Semaphore CALLS=new Semaphore(2);

    HeadlessBrain(HeadlessRuntime r,UUID body) {
        this.r=r;this.body=body;owner=UUID.fromString(text(r.bodies.get(body),"ownerUuid",36));goalLimit=goalLimit(r.config);
        file=r.directory.resolve("brains").resolve(body+".json");
        persisted=Files.exists(file)?read(file):object("phase","idle","day",LocalDate.now(ZoneOffset.UTC),"callsToday",0,"callsThisGoal",0);
        if(persisted.has("pendingRequest")){persisted.addProperty("phase","unknown");persisted.addProperty("code","model_result_unknown_no_automatic_retry");persistState();}
        log=ConvoLog.atFile(r.directory.resolve("conversations").resolve(body+".jsonl"));history=new ConvoState(msg->log.append(msg,null));history.preload(log.load(64));
        if(persisted.has("lastReply"))lastReply=text(persisted,"lastReply",2000);
        SerialCalls serial=new SerialCalls(new SerialCalls.Port(){
            public boolean isProgram(LlmToolCall call){return Set.of("lua","mod_action").contains(call.name());}
            public void interrupt(LlmToolCall call,String why){if(call.name().equals("mod_action"))r.cancel(body,actionId(call));else ServerPrograms.interrupt(body,actionId(call),why);}
            public void cutOff(LlmToolCall call,boolean stopBody){if(call.name().equals("mod_action"))r.cancel(body,actionId(call));else ServerPrograms.cutOff(body,actionId(call),stopBody);}
            public void invoke(LlmToolCall call,Consumer<SerialCalls.Settled> done){
                try {
                    if(persistenceUnavailable){done.accept(SerialCalls.Settled.of(object("ok",false,"code","brain_state_persistence_failed_no_automatic_retry").toString()));return;}
                    JsonObject args=JsonParser.parseString(call.arguments()).getAsJsonObject();args.addProperty("companion",body.toString());
                    if(call.name().equals("lua")) {
                        JsonObject accepted=r.lua(body,actionId(call),text(args,"code",16384),end->done.accept(SerialCalls.Settled.of(modelView(end).toString())));
                        if(!accepted.has("phase")||text(accepted,"phase",16).equals("unknown"))done.accept(SerialCalls.Settled.of(accepted.toString()));
                    }else if(call.name().equals("mod_action")) {
                        JsonObject accepted=r.modAction(body,actionId(call),text(args,"operation",80),HeadlessRuntime.modArguments(args),end->done.accept(SerialCalls.Settled.of(modelView(end).toString())));
                        if(!accepted.has("phase")||text(accepted,"phase",16).equals("unknown"))done.accept(SerialCalls.Settled.of(accepted.toString()));
                    }else if(call.name().equals("finish")) {
                        armed=false;persisted.addProperty("phase","completed");lastReply=text(args,"summary",2000);persisted.addProperty("lastReply",lastReply);if(!persistState()){done.accept(SerialCalls.Settled.of(object("ok",false,"code","brain_state_persistence_failed_no_automatic_retry").toString()));return;}
                        r.event(body,"goal_completed",lastReply,false,System.currentTimeMillis());done.accept(SerialCalls.Settled.of(object("ok",true,"completed",true).toString()));
                    }else if(Set.of("operations","mod_operations","mod_query","get_state").contains(call.name()))done.accept(SerialCalls.Settled.of(modelView(r.invoke(owner,call.name(),args)).toString()));
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
            public String injectionPreamble(){return modelView(r.snapshot(body,true)).toString();}
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
    boolean persistenceUnavailable;
    static int goalLimit(JsonObject config) {
        if(!config.has("modelCallsPerGoal"))return 24;
        try {
            if(!config.get("modelCallsPerGoal").isJsonPrimitive()||!config.getAsJsonPrimitive("modelCallsPerGoal").isNumber())throw new ArithmeticException();
            int value=config.get("modelCallsPerGoal").getAsBigDecimal().intValueExact();
            if(value<1||value>100)throw new ArithmeticException();
            return value;
        }catch(ArithmeticException invalid){throw new IllegalArgumentException("model_calls_per_goal_must_be_integer_1_to_100");}
    }
    boolean persistState() {
        try {write(file,persisted);return true;}
        catch(IllegalStateException failure) {
            persistenceUnavailable=true;armed=false;
            persisted.addProperty("phase",persisted.has("pendingRequest")?"unknown":"paused");
            persisted.addProperty("code","brain_state_persistence_failed_no_automatic_retry");
            org.slf4j.LoggerFactory.getLogger("maw-numen-server").error("Numen brain {} paused: durable state unavailable",body,failure);
            return false;
        }
    }
    String actionId(LlmToolCall call){return "brain-"+hash(goalId+":"+call.id()).substring(0,48);}
    JsonObject selected(){return r.profile(owner,text(r.bodies.get(body),"profileId",32),false);}
    String modelUnavailable(){
        if(persistenceUnavailable)return "brain_state_persistence_failed_review_before_new_goal";
        if(persisted.has("pendingRequest")||"unknown".equals(text(persisted,"phase",30)))return "model_result_unknown_review_before_new_goal";
        JsonObject p=selected();if(text(p,"apiKey",4096).isBlank()||text(p,"model",120).isBlank())return "configure_model_and_key_first";
        if(history.snapshot().size()>150)return "conversation_limit_start_new_goal";
        return null;
    }
    void task(String text) {
        if(busy())throw new IllegalArgumentException("hosted_brain_busy_stop_first");
        String unavailable=modelUnavailable();if(unavailable!=null&&!unavailable.equals("conversation_limit_start_new_goal"))throw new IllegalArgumentException(unavailable);
        // A new explicit goal starts a bounded working conversation. The full
        // prior transcript and durable action receipts remain on disk.
        log.appendClearBoundary();history.replaceAll(List.of());
        if(!lastReply.isBlank())history.addUser("上一目标的回复（历史摘要，不是当前状态）："+lastReply);
        lastReply="";persisted.addProperty("lastReply","");persisted.remove("code");
        goalId=UUID.randomUUID().toString();armed=true;
        persisted.addProperty("goalId",goalId);persisted.addProperty("goal",text);persisted.addProperty("phase","active");persisted.addProperty("callsThisGoal",0);if(!persistState())throw new IllegalStateException("brain_state_persistence_failed_goal_not_started");
        loop.push(List.of(new EventQueue.Entry(EventTypes.QUERY,text,System.currentTimeMillis(),true)));
    }
    void tick(){if(armed)loop.tick();}
    void arrived(EventQueue.Entry entry){if(armed)loop.push(List.of(entry));}
    void died(){loop.halt(HaltReason.DEATH);}
    void respawned(){loop.respawned();}
    void stop(String reason){
        armed=false;loop.halt(reason.equals("server_stopping")?HaltReason.DISCONNECT:HaltReason.OWNER_STOP,reason);
        if(activeCancel!=null)activeCancel.cancel();if(activeHttp!=null)activeHttp.cancel(true);
        if(persisted.has("pendingRequest")){if(!"unknown".equals(text(persisted,"phase",30)))persisted.addProperty("code","cancelled_model_result_unknown_no_retry");persisted.addProperty("phase","unknown");}
        else persisted.addProperty("phase","stopped");persistState();
    }
    boolean busy(){return armed||loop.status().busy();}
    JsonObject status(){
        LoopStatus s=loop.status();return object("active",armed,"phase",persisted.get("phase"),"loopPhase",s.phase(),"hold",s.hold(),"callsToday",persisted.get("callsToday"),"callsThisGoal",persisted.get("callsThisGoal"),"code",persisted.has("code")?persisted.get("code"):JsonNull.INSTANCE,"requestPending",persisted.has("pendingRequest"),"lastRequestBytes",persisted.has("lastRequestBytes")?persisted.get("lastRequestBytes"):JsonNull.INSTANCE,"lastReply",persisted.has("lastReply")?persisted.get("lastReply"):new JsonPrimitive(""));
    }
    void failClosed(String code,CancelToken cancel){
        armed=false;persisted.addProperty("phase","unknown");persisted.addProperty("code",code);persistState();
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
        if(today>=limit||goal>=goalLimit||!CALLS.tryAcquire()) {armed=false;persisted.addProperty("phase","paused");persisted.addProperty("code",today>=limit?"daily_model_budget_reached":goal>=goalLimit?"goal_model_budget_reached":"model_concurrency_busy");persistState();cancel.cancel();loop.halt(HaltReason.OWNER_STOP,"model_budget_or_concurrency_limit");return;}
        Prepared prepared;
        try {JsonObject profile=selected();r.validateEndpoint(text(profile,"baseUrl",250));prepared=prepare(profile,request);}
        catch(RuntimeException error){
            CALLS.release();armed=false;persisted.addProperty("phase","paused");persisted.addProperty("code",error instanceof ModelFailure f?f.code:"model_request_preparation_failed");
            persistState();cancel.cancel();loop.halt(HaltReason.OWNER_STOP,"model_request_not_sent");return;
        }
        persisted.addProperty("lastRequestBytes",prepared.bytes);
        persisted.addProperty("callsToday",today+1);persisted.addProperty("callsThisGoal",goal+1);persisted.addProperty("pendingRequest",UUID.randomUUID().toString());
        if(!persistState()){
            persisted.remove("pendingRequest");persisted.addProperty("callsToday",today);persisted.addProperty("callsThisGoal",goal);
            persisted.addProperty("phase","paused");persisted.addProperty("code","brain_state_persistence_failed_request_not_sent");
            CALLS.release();cancel.cancel();loop.halt(HaltReason.OWNER_STOP,"brain_state_persistence_failed_request_not_sent");return;
        }
        activeCancel=cancel;
        // No redirect and no transport retry: an uncertain paid request is never silently repeated.
        CompletableFuture<Answer> future=CompletableFuture.supplyAsync(()->request(prepared,cancel),IO).orTimeout(65,TimeUnit.SECONDS);activeHttp=future;
        future.whenComplete((answer,error)->r.requests.add(()->{
            activeHttp=null;activeCancel=null;CALLS.release();
            if(cancel.isCancelled())return;
            if(error!=null){
                Throwable cause=error;while(cause.getCause()!=null&&cause!=cause.getCause())cause=cause.getCause();
                if(cause instanceof ModelFailure failure&&!failure.unknown){
                    armed=false;persisted.remove("pendingRequest");persisted.addProperty("phase","paused");persisted.addProperty("code",failure.code);persistState();
                    cancel.cancel();loop.halt(HaltReason.OWNER_STOP,failure.code);r.event(body,"model_paused",failure.code,true,System.currentTimeMillis());
                }else failClosed(cause instanceof ModelFailure failure?failure.code:"model_transport_outcome_unknown_no_retry",cancel);
                return;
            }
            persisted.remove("pendingRequest");persisted.addProperty("phase","active");persisted.addProperty("lastUsageTokens",answer.usage.total());
            lastReply=answer.turn.content();if(lastReply.length()>2000)lastReply=lastReply.substring(0,2000);persisted.addProperty("lastReply",lastReply);if(!persistState()){cancel.cancel();loop.halt(HaltReason.OWNER_STOP,"brain_state_persistence_failed");return;}
            done.accept(new ModelOutcome.Answered(answer.turn,answer.usage));
            if(answer.turn.toolCalls().isEmpty()){armed=false;persisted.addProperty("phase","completed");persistState();r.event(body,"reply",lastReply,false,System.currentTimeMillis());}
        }));
    }
    record Answer(AssistantTurn turn,Usage usage){}
    record Prepared(LlmProvider provider,HttpRequest request,String origin,int bytes){}
    static final class ModelFailure extends RuntimeException {
        final String code;final boolean unknown;
        ModelFailure(String code,boolean unknown){super(code);this.code=code;this.unknown=unknown;}
    }
    static Prepared prepare(JsonObject config,ModelRequest request) {
            LlmProvider provider=switch(text(config,"provider",24)){case "anthropic"->new AnthropicProvider();case "deepseek"->new DeepSeekProvider();default->new OpenAIProvider();};
            List<JsonObject> messages=new ArrayList<>();String origin=provider.getClass().getSimpleName()+"/"+text(config,"model",120);
            for(var msg:ProtocolView.forWire(request.messages()))switch(msg){
                case ConvoState.Msg.User u->messages.add(provider.buildUserMessage(u.content()));
                case ConvoState.Msg.Assistant a->messages.addAll(provider.assistantToRequestItems(a.turn().sameOrigin(origin)?a.turn():a.turn().withoutProviderPrivateFields()));
                case ConvoState.Msg.Tool t->messages.add(provider.buildToolResultMessage(t.toolCallId(),t.content()));
                default->throw new IllegalStateException("invalid_protocol_view");
            }
            JsonObject body=provider.buildRequestBody(text(config,"model",120),request.systemPrompt(),messages,provider.buildToolList(request.tools()));provider.applyGenerationParams(body,null,4096);
            byte[] payload=body.toString().getBytes(StandardCharsets.UTF_8);if(payload.length>524288)throw new ModelFailure("model_context_limit_request_not_sent",false);
            String base=text(config,"baseUrl",250).replaceAll("/+$","");String url=base.endsWith(provider.chatPath())?base:base+provider.chatPath();
            HttpRequest.Builder builder=HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(payload));
            provider.authHeaders(text(config,"apiKey",4096)).forEach(builder::header);
            return new Prepared(provider,builder.build(),origin,payload.length);
    }
    Answer request(Prepared prepared,CancelToken cancel) {
        try {
            CompletableFuture<HttpResponse<InputStream>> sending=http.sendAsync(prepared.request,HttpResponse.BodyHandlers.ofInputStream());Runnable unhook=cancel.onCancel(()->sending.cancel(true));
            try {
                HttpResponse<InputStream> response=sending.get(60,TimeUnit.SECONDS);
                try(InputStream input=response.body()){
                    Runnable close=cancel.onCancel(()->{try{input.close();}catch(IOException ignored){}});
                    try {
                        if(response.statusCode()!=200)throw new ModelFailure("model_http_"+response.statusCode()+"_no_automatic_retry",false);
                        byte[] bytes=input.readNBytes(1048577);if(bytes.length>1048576)throw new ModelFailure("model_response_limit",false);
                        if(cancel.isCancelled())throw new ModelFailure("model_cancelled_outcome_unknown_no_retry",true);
                        try {
                            JsonObject json=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
                            return new Answer(prepared.provider.parseResponseBody(json).withOrigin(prepared.origin),prepared.provider.usage(json.has("usage")?json.getAsJsonObject("usage"):null));
                        }catch(RuntimeException invalid){throw new ModelFailure("invalid_model_response_no_automatic_retry",false);}
                    }finally{close.run();}
                }
            }finally{unhook.run();}
        }catch(ModelFailure error){throw error;}
        catch(Exception error){throw new CompletionException(new ModelFailure("model_transport_outcome_unknown_no_retry",true));}
    }
    /** Only the hosted model view is compacted. MCP and the ledger retain full data. */
    static JsonObject modelView(JsonObject original) {
        JsonObject out=original.deepCopy();
        if(original.has("before")&&original.has("after")&&original.get("before").isJsonObject()&&original.get("after").isJsonObject()) {
            JsonObject before=original.getAsJsonObject("before"),after=original.getAsJsonObject("after"),effects=new JsonObject();
            if(before.has("menu")&&after.has("menu")) {
                int previous=before.getAsJsonObject("menu").get("containerId").getAsInt(),current=after.getAsJsonObject("menu").get("containerId").getAsInt();
                effects.addProperty("menuChanged",previous!=current);effects.addProperty("openContainerId",current);
            }
            if(before.has("inventory")&&after.has("inventory"))effects.addProperty("inventoryChanged",!before.get("inventory").equals(after.get("inventory")));
            out.add("observedEffects",effects);
        }
        if(out.has("nativeState")&&out.get("nativeState").isJsonObject()&&out.getAsJsonObject("nativeState").has("self")) {
            JsonObject self=out.getAsJsonObject("nativeState").getAsJsonObject("self").deepCopy();
            self.remove("motion");self.remove("ysm");out.add("self",self);
        }
        if(out.has("nativeState")&&out.has("menu")&&out.getAsJsonObject("nativeState").has("menu")) {
            JsonObject nativeMenu=out.getAsJsonObject("nativeState").getAsJsonObject("menu"),menu=out.getAsJsonObject("menu");
            for(String key:List.of("windowId","stateId","controlHash","selectedHotbarSlot","menuType","slotRoles","cookingPot","dataValues"))
                if(nativeMenu.has(key))menu.add(key,nativeMenu.get(key).deepCopy());
        }
        out.remove("before");out.remove("nativeState");
        if(out.has("after")&&out.get("after").isJsonObject())out.add("after",modelView(out.getAsJsonObject("after")));
        if(out.has("currentAction")&&out.get("currentAction").isJsonObject()) {
            JsonObject action=out.getAsJsonObject("currentAction"),brief=new JsonObject();
            for(String key:List.of("action_id","operation","phase","ok","code"))if(action.has(key))brief.add(key,action.get(key).deepCopy());
            out.add("currentAction",brief);
        }
        if(out.has("inventory")&&out.get("inventory").isJsonArray())out.add("inventory",occupied(out.getAsJsonArray("inventory")));
        if(out.has("menu")&&out.get("menu").isJsonObject()) {
            JsonObject menu=out.getAsJsonObject("menu");
            if(menu.has("slots"))menu.add("slots",occupied(menu.getAsJsonArray("slots")));
        }
        return out;
    }
    static JsonArray occupied(JsonArray slots) {
        JsonArray out=new JsonArray();for(JsonElement slot:slots) {
            JsonObject stack=slot.getAsJsonObject();if(!stack.has("empty")||!stack.get("empty").getAsBoolean())out.add(stack.deepCopy());
        }return out;
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
    String prompt(){return "你是 My Agent World 中有持久身体的生存同伴。主人可离线。完成当前目标后 finish，保持中文简明回复。没有 OP，不能凭空生成物资。先 get_state、operations 查询真实 API，不猜函数/参数。Lua 是原生 Numen 程序，动作异步并串行，回执提供实际终态。numen.time.wait 的单位是秒，等3秒写 numen.time.wait(3)，不要传毫秒数。模型回执省略重复的 before/nativeState 和空槽位，保留真实槽位编号及非空物品的完整组件；需要完整菜单或模组状态时用 mod_query 按需查询。菜单打开与否看 after.menu.containerId/menuType 和 observedEffects；Lua 的 nothing visibly changed 提示未覆盖所有菜单变化，不代表菜单没有打开。operations 按组或完整函数 ID 查询用法，读取 returnTypes 中的实际字段，模组玩法（Ars 法术、Create、农夫乐事、殖民地等）通过 mod_operations 发现，不能只在 numen.* 分组中寻找；首次读模组目录，再按 operation 查询参数，用 mod_query 读取、mod_action 执行。不要反复请求整个目录。只使用 availableWithoutClient=true 的 SERVER 函数；没有客户端 UI、文件或网络能力。世界坐标必须绝对坐标。遇 unknown 不重试。不要伤害玩家、村民、宠物或破坏别人的建筑。有限预算，每目标最多"+goalLimit+"次请求。不要把模型配置或密钥写进聊天。原生能力分组："+r.operations(null).toString();}
}
