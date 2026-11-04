package org.qiandengji.tests;

import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import com.google.gson.Gson;

/** Real Youer verification, restricted to a marked loopback test world and actors. */
public final class SavedTaskReviewFixture extends JavaPlugin {
    private ClassLoader api;
    private final Gson json=new Gson();
    private final List<String> events=new ArrayList<>();
    private UUID watched;
    private Class<?> type(String path)throws Exception{return Class.forName("com.dwinovo.numen.api."+path,true,api);}
    private Object call(Object value,String method)throws Exception{return value.getClass().getMethod(method).invoke(value);}
    @Override public void onEnable(){
        try{
            if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=25988
                    ||!Files.readString(Path.of(".pr58-qa")).equals("PR58_QA_ONLY"))throw new IllegalStateException("Isolated fixture only");
            api=Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("numen_api")).getClass().getClassLoader();
            if(Files.exists(Path.of("pr58-body.uuid")))watched=UUID.fromString(Files.readString(Path.of("pr58-body.uuid")).trim());
            Class<?> watcher=type("event.NumenEvents$Watcher");
            Object listener=Proxy.newProxyInstance(api,new Class<?>[]{watcher},(proxy,method,args)->{
                if(method.getName().equals("takes")){
                    if(Objects.equals(watched,args[0])){events.add(args[1].toString());return true;}
                    return false;
                }
                if(method.getName().equals("toString"))return "PR58 own-body fixture";
                if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);
                return proxy==args[0];
            });
            type("event.NumenEvents").getMethod("watch",watcher).invoke(null,listener);
            getServer().getCommandMap().register("pr58fixture",new Command("reviewqa"){
                @Override public boolean execute(CommandSender sender,String label,String[] args){
                    if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender)||args.length!=1)return false;
                    try{run(sender,args[0]);}catch(Exception e){throw new IllegalStateException(e);}return true;
                }
            });
        }catch(Exception error){throw new IllegalStateException(error);}
    }
    private Object body()throws Exception{
        Player p=Bukkit.getPlayerExact("P58Body");if(p==null)return null;
        Object nms=call(p,"getHandle");if(!type("entity.NumenPlayer").isInstance(nms))throw new IllegalStateException("Not our companion");
        watched=p.getUniqueId();Files.writeString(Path.of("pr58-body.uuid"),watched.toString());
        return nms;
    }
    private Object registry(Object body)throws Exception{
        Object server=call(call(body,"level"),"getServer");
        return type("entity.CompanionRegistry").getMethod("get",Class.forName("net.minecraft.server.MinecraftServer",true,api)).invoke(null,server);
    }
    private Object entry(Object body)throws Exception{return registry(body).getClass().getMethod("find",UUID.class).invoke(registry(body),watched);}
    private Object task(Object body,String name,Object...args)throws Exception{
        Class<?> persistence=type("task.TaskPersistence");
        for(Method m:persistence.getDeclaredMethods())if(m.getName().equals(name)&&m.getParameterCount()==args.length+1){m.setAccessible(true);Object[] all=new Object[args.length+1];all[0]=body;System.arraycopy(args,0,all,1,args.length);return m.invoke(null,all);}
        throw new NoSuchMethodException(name);
    }
    private Map<String,Object> state(Object b)throws Exception{
        if(b==null)return Map.of("bodyPresent",false,"events",List.copyOf(events));
        Object e=entry(b);Map<String,Object> s=new LinkedHashMap<>();s.put("bodyPresent",true);s.put("uuid",watched.toString());
        s.put("taskName",call(e,"taskName"));s.put("taskLua",call(e,"taskLua"));s.put("taskOld",call(e,"taskOld"));s.put("events",List.copyOf(events));
        Player owner=Bukkit.getPlayerExact("ag_P58A");if(owner==null||!owner.getUniqueId().equals(call(e,"owner")))throw new IllegalStateException("Wrong fixture owner");
        s.put("ownerMatches",true);s.put("op",Bukkit.getPlayerExact("P58Body").isOp());return s;
    }
    private void run(CommandSender sender,String op)throws Exception{
        Object b=body();if(b==null){sender.sendMessage("REVIEW_QA "+json.toJson(state(null)));return;}
        state(b);
        switch(op){
            case "save"->task(b,"remember","qa_saved_lua","error('QA_OLD_LUA_MUST_NOT_RUN')");
            case "malformed"->task(b,"remember","qa_malformed_lua","not valid lua ((");
            case "fresh"->task(b,"remember","qa_new_explicit_intent","return 7");
            case "forget"->task(b,"forget");
            case "replay"->{Object left=task(b,"leftOver");if(left==null)throw new IllegalStateException("Fixture has no saved task");task(b,"replay",left);}
            case "legacy"->{
                Object old=entry(b);RecordComponent[] parts=old.getClass().getRecordComponents();Object[] values=new Object[parts.length];Class<?>[] types=new Class<?>[parts.length];
                for(int i=0;i<parts.length;i++){types[i]=parts[i].getType();values[i]=parts[i].getAccessor().invoke(old);switch(parts[i].getName()){
                    case "taskName"->values[i]="qa_legacy_saved";case "taskLua"->values[i]="";case "taskOld"->values[i]="old command retained for review";}}
                Object changed=old.getClass().getDeclaredConstructor(types).newInstance(values);
                registry(b).getClass().getMethod("put",UUID.class,old.getClass()).invoke(registry(b),watched,changed);
            }
            case "supersede"->{Object left=task(b,"leftOver");task(b,"remember","qa_new_explicit_intent","return 7");task(b,"superseded",left);}
            case "status"->{}
            default->throw new IllegalArgumentException("Unknown fixture operation");
        }
        sender.sendMessage("REVIEW_QA "+json.toJson(state(b)));
    }
}
