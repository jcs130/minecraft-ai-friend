package org.qiandengji.mcbot;

import com.dwinovo.numen.api.brain.*;
import com.dwinovo.numen.api.entity.*;
import com.google.gson.*;
import java.util.*;
import java.util.concurrent.*;
import net.minecraft.server.MinecraftServer;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.CraftServer;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.messaging.PluginMessageListener;

/** Optional game-client transport. It contains no LLM, account passwords or API keys. */
public final class McbotPaper extends JavaPlugin implements PluginMessageListener,Listener {
    private MinecraftServer minecraft;
    private Bindings bindings;
    private final Map<UUID,Flow> owners=new HashMap<>(),bodies=new HashMap<>();
    private int maxTicks;
    private static final class Task {
        final long id;final boolean readOnly,autonomous;
        Task(long id,boolean readOnly,boolean autonomous){this.id=id;this.readOnly=readOnly;this.autonomous=autonomous;}
    }
    private static final class Flight {
        final String tool;final JsonObject args;final Receipts.Key key;final String job;final Task task;
        boolean cancelled;
        Flight(String tool,JsonObject args,Receipts.Key key,Task task){this.tool=tool;this.args=args;this.key=key;this.task=task;job=UUID.randomUUID().toString();}
    }
    private record Permit(String id,long task,UUID world,int x,int y,int z,String action,String before,boolean allowed){}
    private final class Flow {
        final Player owner;final Receipts receipts=new Receipts(2048,262144);
        final UUID connection=UUID.randomUUID();final ArrayDeque<Long> rate=new ArrayDeque<>();
        final Tasks tasks=new Tasks();
        NumenPlayer body;UUID epoch;ClientDriverBook.Lease lease;NativeCalls calls;
        Task task;Flight flight;Permit permit;String lastState="";boolean creating,closed,blocked;
        Flow(Player owner){this.owner=owner;}
        boolean online(){return !closed&&owner.isOnline()&&Bukkit.getPlayer(owner.getUniqueId())==owner;}
        boolean current(){return online()&&body!=null&&lease!=null&&lease.current();}
        boolean takeRate(){long now=System.nanoTime();while(!rate.isEmpty()&&now-rate.peekFirst()>1_000_000_000L)rate.removeFirst();if(rate.size()>=60)return false;rate.addLast(now);return true;}
        void stop(String why){if(flight!=null){flight.cancelled=true;receipts.interrupt(flight.key.task());}if(calls!=null)calls.cancel();task=null;permit=null;}
        void close(){if(closed)return;closed=true;NumenPlayer last=body;stop("连接关闭");if(lease!=null)lease.close();
            if(last!=null){bodies.remove(last.getUUID(),this);
                if(!last.isRemoved()&&last.isOwnedByPlayer(owner.getUniqueId())&&!com.dwinovo.numen.api.mcp.server.McpMode.instance().driving(owner.getUniqueId(),last.getUUID()))Companions.dormant(minecraft,last);
            }
        }
        void lost(){blocked=true;stop("驾驶席或身体已改变");if(body!=null)bodies.remove(body.getUUID(),this);body=null;lease=null;calls=null;state(this,"companion_state","身体或驾驶席已改变；旧任务未自动恢复，请显式召回。");}
    }
    @Override public void onEnable(){
        try{
            Class.forName("com.dwinovo.numen.api.brain.ClientDrivers",true,getClassLoader());
            Class.forName("com.dwinovo.numen.tools.ExactFurnaceOutput",true,getClassLoader());
        }catch(ClassNotFoundException missing){throw new IllegalStateException("mcbot需要匹配的Numen API和内容候选；未注册接入通道。",missing);}
        saveDefaultConfig();maxTicks=getConfig().getInt("max-action-ticks",2400);if(maxTicks<200||maxTicks>6000)throw new IllegalArgumentException("max-action-ticks outside 200..6000");
        minecraft=((CraftServer)Bukkit.getServer()).getServer();
        try{bindings=new Bindings(getDataFolder().toPath().resolve("bindings.json"));}catch(Exception bad){throw new IllegalStateException("绑定资料无法验证；拒绝覆盖或新建替代账号。",bad);}
        getServer().getMessenger().registerIncomingPluginChannel(this,Wire.IN,this);getServer().getMessenger().registerOutgoingPluginChannel(this,Wire.OUT);
        Bukkit.getPluginManager().registerEvents(this,this);
        getServer().getCommandMap().register("qiandengji",new Command("mcbot"){
            @Override public boolean execute(CommandSender sender,String label,String[] args){
                if(!(sender instanceof Player p)){sender.sendMessage("mcbot Paper compatibility backend 0.1.0; player-owned commands only.");return true;}
                if(args.length==0){p.sendMessage("[mcbot] 本人同伴：/mcbot summon <名字>、list、dismiss；RPG：/mcbot command mycli status");return true;}
                JsonObject request=Wire.envelope(switch(args[0]){case"summon"->"summon";case"dismiss"->"dismiss";default->"companion_status";});
                if(Set.of("summon","dismiss").contains(args[0])){
                    if(args.length!=2){p.sendMessage("[mcbot] 用法：/mcbot "+args[0]+" <名字>");return true;}request.addProperty("name",args[1]);
                }
                try{
                    Flow f=flow(p);
                    if(args[0].equals("ping")){p.sendMessage("[mcbot] Paper后端已就绪；这不表示同伴任务已完成。");return true;}
                    if(args[0].equals("command")){
                        if(!f.current())throw new IllegalArgumentException("请先召唤本人的同伴");
                        if(f.flight!=null||f.task!=null)throw new IllegalArgumentException("先结束客户端当前任务再执行主人命令");
                        String command=Policy.command(String.join(" ",Arrays.copyOfRange(args,1,args.length)));
                        f.task=new Task(System.nanoTime()&Long.MAX_VALUE,false,false);JsonObject a=new JsonObject();a.addProperty("command",command);
                        JsonObject tool=Wire.envelope("tool_call");tool.addProperty("task_id",f.task.id);tool.addProperty("seq",Integer.MIN_VALUE);tool.addProperty("tool","command");tool.add("args",a);
                        invoke(f,tool,true);return true;
                    }
                    handle(f,request);
                }catch(RuntimeException invalid){p.sendMessage("[mcbot] "+invalid.getMessage());}return true;
            }
        });
        Bukkit.getScheduler().runTaskTimer(this,()->{
            for(Flow f:List.copyOf(owners.values())){
                if(!f.online()){f.close();owners.remove(f.owner.getUniqueId(),f);continue;}
                if(f.body!=null&&!f.current())continue;
                if(f.body==null)attach(f);
                state(f,"companion_state",null);
            }
        },10,10);
        getLogger().info("Independent mcbot game-client backend enabled; native Numen driver and executor, no model credentials.");
    }
    private Flow flow(Player p){if(!p.hasPermission("qiandengji.mcbot.use"))throw new IllegalArgumentException("没有mcbot接入权限");if(((CraftPlayer)p).getHandle() instanceof NumenPlayer)throw new IllegalArgumentException("服务端身体不能冒充主人连接");Flow f=owners.get(p.getUniqueId());if(f!=null&&f.owner!=p){f.close();owners.remove(p.getUniqueId());}return owners.computeIfAbsent(p.getUniqueId(),id->new Flow(p));}
    @Override public void onPluginMessageReceived(String channel,Player owner,byte[] bytes){
        if(!channel.equals(Wire.IN)||!owner.isOnline())return;
        Flow f;
        try{f=flow(owner);}catch(IllegalArgumentException denied){return;}
        if(!f.takeRate())return;
        JsonObject message;
        try{message=Wire.decode(bytes);}catch(RuntimeException malformed){return;}
        try{handle(f,message);}catch(RuntimeException bad){
            String kind=message.get("kind").getAsString();
            if(Set.of("summon","dismiss","companion_status").contains(kind))state(f,kind.equals("summon")?"summon_result":kind.equals("dismiss")?"dismiss_result":"companion_state","DENIED:"+bad.getMessage(),true);
            else error(f,message,"DENIED:"+bad.getMessage());
        }
    }
    private void handle(Flow f,JsonObject e){
        switch(Wire.string(e,"kind",1,48)){
            case "companion_status"->{attach(f);state(f,"companion_state","本人同伴状态。",true);}
            case "summon"->summon(f,Wire.string(e,"name",1,16));
            case "dismiss"->dismiss(f,Wire.string(e,"name",1,16));
            case "task_begin"->{
                requireBody(f,e);long id=Wire.integer(e,"task_id",1,Long.MAX_VALUE);
                if(e.has("recovery_spatial")||e.has("continue_construction"))throw new IllegalArgumentException("Paper后端尚不支持mcbot建筑续建检查点；没有恢复旧动作。");
                if(f.flight!=null)throw new IllegalArgumentException("已有动作尚未结束；先取消并等待真实终态。");
                boolean readOnly=Wire.bool(e,"read_only",true),autonomous=Wire.bool(e,"autonomous",false);
                if(f.tasks.begin(id,readOnly,autonomous,f.task==null?null:f.task.id)){f.task=new Task(id,readOnly,autonomous);f.permit=null;}
            }
            case "task_end"->{if(f.task!=null&&e.has("task_id")&&Wire.integer(e,"task_id",1,Long.MAX_VALUE)==f.task.id)f.stop("任务结束");}
            case "cancel"->{if(!e.has("task_id")||Wire.integer(e,"task_id",0,Long.MAX_VALUE)==0||f.task!=null&&Wire.integer(e,"task_id",0,Long.MAX_VALUE)==f.task.id)f.stop("主人取消");JsonObject reply=Wire.envelope("cancel_ack");reply.addProperty("text","本连接的取消已提交；在途效果以终态和现场为准。");send(f,reply);}
            case "authorize"->{
                requireBody(f,e);String id=Wire.string(e,"authorization_id",1,64);
                boolean allowed=Wire.bool(e,"allow",true);Permit p=f.permit;
                boolean match=p!=null&&p.id().equals(id)&&f.task!=null&&!f.task.readOnly&&p.task()==f.task.id
                        &&e.has("task_id")&&Wire.integer(e,"task_id",1,Long.MAX_VALUE)==f.task.id;
                if(match)f.permit=new Permit(p.id(),p.task(),p.world(),p.x(),p.y(),p.z(),p.action(),p.before(),allowed);
                JsonObject reply=Wire.envelope("tool_result");reply.addProperty("seq",e.has("seq")?(int)Wire.integer(e,"seq",Integer.MIN_VALUE,Integer.MAX_VALUE):-1);reply.addProperty("ok",match&&allowed);
                reply.addProperty("feedback",match?(allowed?"已确认本任务的具体一格改动，其他改动仍须确认。":"已拒绝该改动。"):"DENIED:批准编号已失效；没有授予其他操作。");send(f,reply);
            }
            case "tool_call"->invoke(f,e,false);
            case "answer"->error(f,e,"DENIED:本地反问由mcbot客户端处理；服务端没有接收新的动作。");
            default->error(f,e,"UNSUPPORTED:未知mcbot消息；未执行。");
        }
    }
    private boolean attach(Flow f){
        if(f.current())return true;
        if(f.blocked)return false;
        Bindings.Binding binding=bindings.get(f.owner.getUniqueId());if(binding==null||binding.paused())return false;
        var entry=CompanionRegistry.get(minecraft).find(binding.body());if(entry==null||!f.owner.getUniqueId().equals(entry.owner()))return false;
        NumenPlayer body=NumenPlayer.findByUuid(minecraft,binding.body());if(body==null||!body.isAlive()||body.isRemoved())return false;
        ClientDriverBook.Lease lease=ClientDrivers.acquire(((CraftPlayer)f.owner).getHandle(),body,f.connection,f::lost);
        if(lease==null)return false;
        f.body=body;f.epoch=UUID.randomUUID();f.lease=lease;
        bodies.put(body.getUUID(),f);return true;
    }
    private void summon(Flow f,String name){
        Policy.bodyName(name);
        if(f.creating)throw new IllegalArgumentException("原召唤仍在接纳中，不要重复创建");
        if(f.flight!=null||f.task!=null)throw new IllegalArgumentException("BUSY:先结束当前任务再召回，避免打断在途动作。");
        Bindings.Binding old=bindings.get(f.owner.getUniqueId());
        if(old!=null&&!old.name().equalsIgnoreCase(name))throw new IllegalArgumentException("本客户端已绑定 "+old.name()+"；同名召回会保留背包，不会自动另建角色。");
        var registry=CompanionRegistry.get(minecraft);UUID existing=null;
        for(UUID id:registry.all()){
            var entry=registry.find(id);if(entry==null||!entry.name().equalsIgnoreCase(name))continue;
            if(!f.owner.getUniqueId().equals(entry.owner())||existing!=null&&!existing.equals(id))throw new IllegalArgumentException("NAME_TAKEN:名字已有其他身份或历史重名，未创建替代账号。");
            existing=id;
        }
        var cached=Bukkit.getOfflinePlayerIfCached(name);
        if(cached!=null&&!cached.getUniqueId().equals(existing))throw new IllegalArgumentException("NAME_TAKEN:名字已有玩家身份；不能冒领或另建同名身体。");
        if(existing!=null&&com.dwinovo.numen.api.mcp.server.McpMode.instance().driving(f.owner.getUniqueId(),existing))throw new IllegalArgumentException("DRIVER_BUSY:原生MCP正在控制此身体；请先停止原控制端。");
        f.creating=true;
        try{Companions.summonFor(((CraftPlayer)f.owner).getHandle(),name,false,arrival->{
            f.creating=false;
            if(arrival.problem()!=null||arrival.body()==null){state(f,"summon_result",arrival.problem()==null?"召唤尚未确认。":arrival.problem().getString(),true);return;}
            NumenPlayer body=arrival.body();
            try{bindings.put(f.owner.getUniqueId(),new Bindings.Binding(body.getUUID(),body.getGameProfile().getName(),false));}
            catch(Exception failure){getLogger().severe("mcbot binding persistence unavailable; no automatic new identity is created");state(f,"summon_result","绑定保存失败，结果未知；请查询原Numen名册，不要另建同名角色。",true);return;}
            if(!f.online()){
                if(!com.dwinovo.numen.api.mcp.server.McpMode.instance().driving(f.owner.getUniqueId(),body.getUUID()))Companions.dormant(minecraft,body);
                return;
            }
            f.blocked=false;attach(f);state(f,"summon_result",f.current()?"原生身体已就绪；重复同名召回复用身份和背包。":"身体已入册，驾驶席暂不可用；未启动动作。",true);
        });}catch(RuntimeException failure){f.creating=false;throw failure;}
    }
    private void dismiss(Flow f,String name){
        Bindings.Binding b=bindings.get(f.owner.getUniqueId());if(b==null||!b.name().equalsIgnoreCase(name))throw new IllegalArgumentException("没有本人匹配的mcbot绑定");
        if(com.dwinovo.numen.api.mcp.server.McpMode.instance().driving(f.owner.getUniqueId(),b.body()))throw new IllegalArgumentException("DRIVER_BUSY:原生MCP正在控制此身体；请先停止原控制端。");
        f.stop("收回同伴");if(f.lease!=null)f.lease.close();
        NumenPlayer body=NumenPlayer.findByUuid(minecraft,b.body());
        try{bindings.put(f.owner.getUniqueId(),new Bindings.Binding(b.body(),b.name(),true));}catch(Exception failure){throw new IllegalStateException("未能保存收回状态；没有删除角色。");}
        if(body!=null&&body.isOwnedByPlayer(f.owner.getUniqueId()))Companions.dormant(minecraft,body);
        state(f,"dismiss_result","同伴已收回，原身份与背包保留；同名召唤继续。",true);
    }
    private void requireBody(Flow f,JsonObject e){
        if(!f.current())throw new IllegalArgumentException("没有可用的本人身体，先summon或companion_status核对");
        if(e.has("body_id")&&!Wire.string(e,"body_id",36,36).equals(f.epoch.toString()))throw new IllegalArgumentException("BODY_DIED:原身体实例已改变，旧动作未派发。");
    }
    private void invoke(Flow f,JsonObject e,boolean chat){
        requireBody(f,e);int seq=(int)Wire.integer(e,"seq",Integer.MIN_VALUE,Integer.MAX_VALUE);long task=e.has("task_id")?Wire.integer(e,"task_id",0,Long.MAX_VALUE):0;
        String tool=Wire.string(e,"tool",1,48);JsonObject args=Wire.args(e);
        boolean allowAccept=Wire.bool(e,"accept",false);
        if(!Policy.TOOLS.contains(tool))throw new IllegalArgumentException("UNSUPPORTED_TOOL:Paper后端尚不支持 "+tool+"；没有执行。");
        boolean readOnly=Policy.readOnly(tool,args);
        if(!readOnly&&(f.task==null||f.task.id!=task||f.task.readOnly))throw new IllegalArgumentException("READ_ONLY:需要当前非只读任务；查询不会授予动作权限。");
        Receipts.Key key=new Receipts.Key(task,seq);Receipts.State prior=f.receipts.begin(key,e.toString());
        if(prior==Receipts.State.COMPLETE){sendBytes(f,f.receipts.response(key));return;}
        if(prior!=Receipts.State.NEW){error(f,e,"RESULT_UNKNOWN:"+prior+"；原请求未重放，请查询状态。");return;}
        if(f.flight!=null){complete(f,key,new Toolbox.Result(false,"BUSY:原动作未结束，本次未执行。",new JsonObject()),chat);return;}
        Flight flight=new Flight(tool,args.deepCopy(),key,f.task);f.flight=flight;
        NativeCalls nativeCalls=new NativeCalls(f.body,f.owner.getUniqueId(),()->f.current()&&f.flight==flight&&!flight.cancelled&&(readOnly||f.task==flight.task));
        f.calls=nativeCalls;Toolbox toolbox=new Toolbox(f.body,nativeCalls);
        CompletableFuture<Toolbox.Result> result;
        try{result=toolbox.execute(tool,args);}catch(RuntimeException bad){result=CompletableFuture.failedFuture(bad);}
        boolean accepted=allowAccept&&!result.isDone();
        if(accepted){JsonObject ack=Wire.envelope("job_ack");ack.addProperty("seq",seq);ack.addProperty("job_id",flight.job);ack.addProperty("tool",tool);ack.addProperty("text","ACCEPTED:本次已受理，等待这条job的真实终态，不要重复派发。");ack.addProperty("cap_ticks",maxTicks);send(f,ack);}
        if(!result.isDone())Bukkit.getScheduler().runTaskLater(this,()->{if(f.flight==flight){flight.cancelled=true;nativeCalls.cancel();}},accepted?maxTicks:Math.min(maxTicks,1600));
        result.whenComplete((value,failure)->{
            if(f.flight!=flight)return;f.flight=null;
            if(!f.online())return;
            if(failure!=null){while(failure instanceof CompletionException&&failure.getCause()!=null)failure=failure.getCause();value=new Toolbox.Result(false,"执行未完成："+failure.getMessage()+"；可能已有部分效果，先核对现场，勿自动重放。",new JsonObject());}
            if(value==null)value=new Toolbox.Result(false,"RESULT_UNKNOWN:未取得终态；先查询现场。",new JsonObject());
            if(f.permit!=null&&!f.permit.allowed()&&f.task!=null&&f.permit.task()==task){Permit p=f.permit;JsonObject d=value.data().deepCopy();d.addProperty("authorization_id",p.id());d.addProperty("authorization_summary","仅确认世界 "+p.world()+" 的 ("+p.x()+", "+p.y()+", "+p.z()+") 一次 "+p.action()+"；原状态 "+p.before()+"。不批准其他位置或整条路线。");JsonArray changes=new JsonArray();JsonObject change=new JsonObject();change.addProperty("x",p.x());change.addProperty("y",p.y());change.addProperty("z",p.z());change.addProperty("action",p.action());change.addProperty("before",p.before());changes.add(change);d.add("changes",changes);value=new Toolbox.Result(false,"NEED_CONFIRM:这条路线遇到一格需要确认的改动；批准仅限所列位置和原状态，不授权整条未知路线。",d);}
            if(accepted){JsonObject job=Wire.envelope("job_event");job.addProperty("seq",seq);job.addProperty("job_id",flight.job);job.addProperty("tool",tool);job.addProperty("phase",flight.cancelled?"cancelled":value.ok()?"done":"failed");job.addProperty("text",value.feedback());job.add("data",identity(f,value.data()));byte[] packet=bounded(job);f.receipts.finish(key,packet);sendBytes(f,packet);}
            else complete(f,key,value,chat);
            if(chat)f.task=null;
        });
    }
    private void complete(Flow f,Receipts.Key key,Toolbox.Result result,boolean chat){JsonObject out=Wire.envelope("tool_result");out.addProperty("seq",key.seq());out.addProperty("ok",result.ok());out.addProperty("feedback",result.feedback());out.add("data",identity(f,result.data()));byte[] bytes=bounded(out);f.receipts.finish(key,bytes);sendBytes(f,bytes);if(chat)f.owner.sendMessage("[mcbot] "+result.feedback());}
    private JsonObject identity(Flow f,JsonObject data){JsonObject d=data.deepCopy();if(f.body!=null){d.addProperty("body_id",f.epoch.toString());d.addProperty("companion_uuid",f.body.getUUID().toString());d.addProperty("owner_uuid",f.owner.getUniqueId().toString());d.addProperty("body_continuity_id",f.body.getUUID().toString());d.addProperty("world_id",f.body.getBukkitEntity().getWorld().getUID().toString());d.addProperty("alive",f.body.isAlive());}return d;}
    private void error(Flow f,JsonObject request,String message){JsonObject e=Wire.envelope("tool_result");int seq=-1;try{if(request.has("seq"))seq=(int)Wire.integer(request,"seq",Integer.MIN_VALUE,Integer.MAX_VALUE);}catch(IllegalArgumentException ignored){}e.addProperty("seq",seq);e.addProperty("ok",false);e.addProperty("feedback",message);send(f,e);}
    private void state(Flow f,String kind,String message){state(f,kind,message,false);}
    private void state(Flow f,String kind,String message,boolean force){
        JsonObject e=Wire.envelope(kind);e.addProperty("companion",f.body==null?"":f.body.getGameProfile().getName());e.addProperty("companion_uuid",f.body==null?"":f.body.getUUID().toString());
        if(f.body!=null){e.addProperty("body_id",f.epoch.toString());e.addProperty("body_state",f.body.isAlive()?"alive":"dead");}
        String fingerprint=e.toString();if(!force&&fingerprint.equals(f.lastState))return;f.lastState=fingerprint;
        e.addProperty("text",message==null?"本人同伴状态。":message);send(f,e);
    }
    private byte[] bounded(JsonObject object){try{return Wire.encode(object);}catch(IllegalArgumentException limit){JsonObject small=Wire.envelope(object.get("kind").getAsString());for(String k:List.of("seq","job_id","tool","phase"))if(object.has(k))small.add(k,object.get(k));small.addProperty("ok",false);small.addProperty(small.get("kind").getAsString().equals("job_event")?"text":"feedback","RESULT_UNKNOWN:回执过大；结果未重放，请查询当前状态。");if(small.has("phase"))small.addProperty("phase","failed");return Wire.encode(small);}}
    private void send(Flow f,JsonObject e){sendBytes(f,bounded(e));}
    private void sendBytes(Flow f,byte[] bytes){if(f.online()&&bytes!=null)f.owner.sendPluginMessage(this,Wire.OUT,bytes);}
    @EventHandler public void quit(PlayerQuitEvent e){Flow f=owners.remove(e.getPlayer().getUniqueId());if(f!=null&&f.owner==e.getPlayer())f.close();}
    @EventHandler public void death(PlayerDeathEvent e){
        Flow f=bodies.get(e.getEntity().getUniqueId());if(f==null)return;
        Bindings.Binding b=bindings.get(f.owner.getUniqueId());
        try{if(b!=null)bindings.put(f.owner.getUniqueId(),new Bindings.Binding(b.body(),b.name(),true));}
        catch(Exception failure){getLogger().severe("mcbot death pause could not be persisted; this connection remains stopped");}
        f.blocked=true;if(f.lease!=null)f.lease.close();else f.lost();
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void breaking(BlockBreakEvent e){guard(e.getPlayer(),e.getBlock(),"break",e.getBlock().getBlockData().getAsString(),e);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void placing(BlockPlaceEvent e){guard(e.getPlayer(),e.getBlock(),"place",e.getBlockReplacedState().getBlockData().getAsString(),e);}
    private void guard(Player actor,org.bukkit.block.Block block,String action,String before,Cancellable event){
        Flow f=bodies.get(actor.getUniqueId());if(f==null||f.flight==null)return;Flight flight=f.flight;
        if(!f.current()||f.task==null||f.task.readOnly){event.setCancelled(true);return;}
        boolean route=Set.of("move_to","follow","collect").contains(flight.tool);
        if(!route){
            boolean primitive=(flight.tool.equals("break_block")&&action.equals("break")||flight.tool.equals("place_block")&&action.equals("place"))
                    &&flight.args.has("x")&&flight.args.has("y")&&flight.args.has("z")
                    &&flight.args.get("x").getAsInt()==block.getX()&&flight.args.get("y").getAsInt()==block.getY()&&flight.args.get("z").getAsInt()==block.getZ();
            if(primitive)return;
            event.setCancelled(true);Bukkit.getScheduler().runTask(this,()->{if(f.flight==flight&&f.calls!=null)f.calls.cancel();});return;
        }
        boolean walkOnly=Wire.bool(flight.args,"walk_only",false)||(flight.args.has("may_alter_terrain")&&!Wire.bool(flight.args,"may_alter_terrain",false));if(f.task.autonomous&&!walkOnly)return;
        Permit p=f.permit;
        if(!walkOnly&&p!=null&&p.allowed()&&p.task()==f.task.id&&p.world().equals(block.getWorld().getUID())&&p.x()==block.getX()&&p.y()==block.getY()&&p.z()==block.getZ()&&p.action().equals(action)&&p.before().equals(before)){f.permit=null;return;}
        event.setCancelled(true);
        if(!walkOnly&&f.permit==null)f.permit=new Permit(UUID.randomUUID().toString(),f.task.id,block.getWorld().getUID(),block.getX(),block.getY(),block.getZ(),action,before,false);
        Bukkit.getScheduler().runTask(this,()->{if(f.flight==flight&&f.calls!=null)f.calls.cancel();});
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void damage(EntityDamageByEntityEvent e){Flow f=bodies.get(e.getDamager().getUniqueId());if(f==null||f.flight==null||!f.flight.tool.equals("attack"))return;if(!(e.getEntity() instanceof org.bukkit.entity.Monster)||e.getEntity().getCustomName()!=null||!f.body.getBukkitEntity().getWorld().equals(e.getEntity().getWorld())||!((Player)f.body.getBukkitEntity()).hasLineOfSight(e.getEntity()))e.setCancelled(true);}
    @Override public void onDisable(){for(Flow f:List.copyOf(owners.values()))f.close();owners.clear();bodies.clear();}
}
