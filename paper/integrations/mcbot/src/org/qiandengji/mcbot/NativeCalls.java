package org.qiandengji.mcbot;

import com.dwinovo.numen.api.entity.NumenPlayer;
import com.dwinovo.numen.api.brain.ConnectionCalls;
import com.dwinovo.numen.api.program.*;
import com.dwinovo.numen.api.script.Modules;
import com.dwinovo.numen.api.agent.loop.Program;
import com.dwinovo.numen.script.*;
import com.google.gson.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

/** Every native operation shares Numen's one program lane and permission layer. */
public final class NativeCalls {
    private static final Gson JSON=new Gson();
    private final NumenPlayer body;
    private final UUID owner;
    private final BooleanSupplier current;
    private String active;
    private CompletableFuture<JsonElement> pending;
    private ConnectionCalls.Lease lifetime;
    public NativeCalls(NumenPlayer body,UUID owner,BooleanSupplier current){this.body=body;this.owner=owner;this.current=current;}
    public CompletableFuture<JsonElement> expression(String expression){
        var result=new CompletableFuture<JsonElement>();
        if(!current.getAsBoolean()){result.completeExceptionally(new IllegalStateException("连接、任务或身体已失效；未派发后续动作。"));return result;}
        if(active!=null){result.completeExceptionally(new IllegalStateException("同一身体已有程序，未重复派发。"));return result;}
        String id=ConnectionCalls.PREFIX+UUID.randomUUID();
        final ConnectionCalls.Lease scope;
        try{scope=ConnectionCalls.open(body.getUUID(),id,current);}catch(RuntimeException denied){result.completeExceptionally(denied);return result;}
        active=id;pending=result;lifetime=scope;
        try { ServerPrograms.run(body,body.getUUID(),owner,new ServerPrograms.Request(id,"return "+expression,Modules.of(body.getUUID()),true),
                NetworkTransport.INSTANCE,CallObserver.NONE,outcome->{
                    scope.close();if(id.equals(active)){active=null;pending=null;lifetime=null;}
                    if(outcome.ending().status()==ScriptCall.Status.OK)result.complete(JSON.toJsonTree(outcome.returned()));
                    else result.completeExceptionally(new Failed(outcome));
                }); } catch(RuntimeException failure) {
            scope.close();if(id.equals(active)){active=null;pending=null;lifetime=null;}
            result.completeExceptionally(failure);
        }
        return result;
    }
    public CompletableFuture<JsonElement> call(String function,List<Object> args,Map<String,Object> options){return expression(code(function,args,options));}
    public static String code(String function,List<Object> args,Map<String,Object> options){return ScriptEngine.IN_USE.call(function,args,options);}
    public static String code(String function,Object... args){return code(function,List.of(args),Map.of());}
    public void cancel(){String id=active;var result=pending;if(id!=null){
        if(lifetime!=null)lifetime.close();
        ServerPrograms.cutOff(body.getUUID(),id,true);
        if(result!=null)result.completeExceptionally(new CancellationException("已取消；在途效果先查询核对，不自动重放。"));
    }}
    public static final class Failed extends RuntimeException {
        public final Program.Outcome outcome;
        public Failed(Program.Outcome outcome){super(outcome.message());this.outcome=outcome;}
    }
}
