package org.afuhome.agentfriend.tests;

import java.lang.reflect.*;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Fake old checkpoints and timing controls in the dedicated loopback world only. */
public final class DungeonStorageFixture extends JavaPlugin {
    private Object manager;
    @Override public void onEnable(){
        if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=25982)throw new IllegalStateException("dedicated lab required");
        try{manager=get(Bukkit.getPluginManager().getPlugin("AgentFriend"),"siteDungeons");}
        catch(Exception e){throw new IllegalStateException(e);}
        getServer().getCommandMap().register("storageqa",new Command("dungeonstorageqa"){
            public boolean execute(CommandSender sender,String label,String[] args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                try{run(sender,args);}catch(Exception e){throw new IllegalStateException(e);}return true;
            }
        });
    }
    private static Field field(Object o,String name)throws Exception{Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);return f;}
    private static Object get(Object o,String name)throws Exception{return field(o,name).get(o);}
    private static void set(Object o,String name,Object v)throws Exception{field(o,name).set(o,v);}
    private void call(String name)throws Exception{Method m=manager.getClass().getDeclaredMethod(name);m.setAccessible(true);m.invoke(manager);}
    @SuppressWarnings("unchecked") private void run(CommandSender sender,String[] args)throws Exception{
        Map<String,Object> runs=(Map<String,Object>)get(manager,"runs");
        if(args[0].equals("seed")){
            if(!runs.isEmpty())throw new IllegalStateException("clear previous fake run first");
            Player p=Bukkit.getPlayerExact(args[1]);if(p==null||!p.getName().equals("ag_StorageQA"))throw new IllegalArgumentException("fake lab player required");
            Object site=((Map<?,?>)get(manager,"sites")).get("undead_crypt");
            Class<?> type=Class.forName(manager.getClass().getName()+"$Run",true,manager.getClass().getClassLoader());
            Constructor<?> constructor=type.getDeclaredConstructors()[0];constructor.setAccessible(true);
            Class<?> mode=Class.forName(manager.getClass().getName()+"$Mode",true,manager.getClass().getClassLoader());
            Object run=constructor.newInstance(site,mode.getEnumConstants()[0]);
            ((Set<UUID>)get(run,"party")).add(p.getUniqueId());((Map<UUID,Integer>)get(run,"attendance")).put(p.getUniqueId(),0);
            long now=System.currentTimeMillis();
            if(args[2].equals("old")){set(run,"started",now-7*3600_000L);set(run,"pausedAt",now-7*3600_000L+10_000);set(run,"fault","data_unavailable");set(run,"pauseReason","runtime_error");}
            else set(run,"readyAt",now+2500);
            runs.put("undead_crypt",run);call("persist");
        }else if(args[0].equals("clear")){
            for(Object r:runs.values()){Method m=manager.getClass().getDeclaredMethod("clean",r.getClass());m.setAccessible(true);m.invoke(manager,r);}runs.clear();call("persist");
        }else if(!args[0].equals("status"))throw new IllegalArgumentException("seed/clear/status");
        Object r=runs.get("undead_crypt");
        if(r==null){sender.sendMessage("MC_STORAGE_QA {\"active\":false}");return;}
        sender.sendMessage("MC_STORAGE_QA {\"active\":true,\"run\":\""+get(r,"id")+"\",\"started\":"+get(r,"started")
            +",\"fault\":\""+get(r,"fault")+"\",\"phase\":\""+get(r,"phase")+"\",\"faultPausedMillis\":"+get(r,"faultPausedMillis")
            +",\"retries\":"+get(r,"storageRetryAttempts")+",\"mobs\":"+((Map<?,?>)get(r,"mobs")).size()+"}");
    }
}
