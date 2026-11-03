package org.afuhome.agentfriend.tests;

import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import com.google.gson.Gson;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Only the marked loopback lab can reproduce a Windows reader denying rename
 * during the real manager's reward transaction. Never included in release JARs. */
public final class HealthDungeonFixture extends JavaPlugin {
    private JavaPlugin af;
    private Object manager;
    private Process reader;
    private PrintWriter input;
    private BufferedReader output;
    private boolean armed,held;
    private final Gson json=new Gson();
    private static Field field(Object object,String name)throws Exception{Class<?> type=object.getClass();while(type!=null){try{Field f=type.getDeclaredField(name);f.setAccessible(true);return f;}catch(NoSuchFieldException absent){type=type.getSuperclass();}}throw new NoSuchFieldException(name);}
    private static Object get(Object object,String name)throws Exception{return field(object,name).get(object);}
    private static void set(Object object,String name,Object value)throws Exception{field(object,name).set(object,value);}
    @Override public void onEnable(){
        Path root=Path.of("").toAbsolutePath().normalize();
        if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=25990||!Files.isRegularFile(root.resolve(".health-fixture")))throw new IllegalStateException("marked dedicated lab required");
        try {
            af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");manager=get(af,"siteDungeons");
            Path executable=root.resolve("hold-config-file.exe"),target=af.getDataFolder().toPath().resolve("config.yml").toAbsolutePath();
            if(!Files.isRegularFile(executable)||!target.normalize().startsWith(root))throw new IllegalStateException("owned reader and target required");
            reader=new ProcessBuilder(executable.toString(),target.toString()).redirectErrorStream(true).start();
            input=new PrintWriter(reader.getOutputStream(),true);output=new BufferedReader(new InputStreamReader(reader.getInputStream()));
            getServer().getCommandMap().register("healthqa",new Command("healthdungeonqa"){
                public boolean execute(CommandSender sender,String label,String[] args){
                    if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                    try{command(sender,args);}catch(Exception error){throw new IllegalStateException(error);}return true;
                }
            });
        }catch(Exception error){throw new IllegalStateException(error);}
    }
    private void lock()throws IOException {input.println("hold");if(!"held".equals(output.readLine()))throw new IOException("fixture reader did not acquire target");held=true;}
    private void unlock()throws IOException {if(held){input.println("release");if(!"released".equals(output.readLine()))throw new IOException("fixture reader did not release target");held=false;}}
    private final class ReceiptLockConfig extends YamlConfiguration {
        @Override public String saveToString(){
            String image=super.saveToString();
            if(armed&&getConfigurationSection("site-dungeons.receipts")!=null){
                var receipts=getConfigurationSection("site-dungeons.receipts");
                boolean hasOwnedReceipt=receipts.getKeys(false).stream().anyMatch(id->getConfigurationSection("site-dungeons.receipts."+id+".undead_crypt")!=null);
                if(hasOwnedReceipt){armed=false;try{lock();}catch(IOException error){throw new IllegalStateException(error);}}
            }
            return image;
        }
    }
    @SuppressWarnings("unchecked") private void command(CommandSender sender,String[] args)throws Exception {
        if(args.length==1&&Set.of("chunks","chunks-existing").contains(args[0])){chunks(args[0].equals("chunks-existing"));sender.sendMessage("MC_HEALTH_CHUNKS_STARTED");return;}
        Map<String,Object> runs=(Map<String,Object>)get(manager,"runs");
        if(args.length==1&&args[0].equals("storage")){
            Class<?> store=Class.forName("org.afuhome.agentfriend.DurableConfigStore",true,af.getClass().getClassLoader());
            Method audit=store.getDeclaredMethod("audit",JavaPlugin.class);audit.setAccessible(true);
            Map<String,Object> state=new LinkedHashMap<>((Map<String,Object>)audit.invoke(null,af));
            Player actor=Bukkit.getPlayerExact("ag_HealthQA");
            if(actor==null)throw new IllegalStateException("owned lab actor required");
            var receipt=af.getConfig().getConfigurationSection("site-dungeons.receipts."+actor.getUniqueId());
            state.put("memoryReceipts",receipt==null?0:receipt.getKeys(false).size());
            state.put("ordinaryCounter",af.getConfig().getInt("storage-qa-counter"));
            state.put("rewardQueue",af.getConfig().getConfigurationSection("dungeon-rewards."+actor.getUniqueId())==null?Map.of():af.getConfig().getConfigurationSection("dungeon-rewards."+actor.getUniqueId()).getValues(false));
            sender.sendMessage("MC_HEALTH_STORAGE "+json.toJson(state));return;
        }
        if(args.length==1&&args[0].equals("ordinary-save")){
            af.getConfig().set("storage-qa-counter",af.getConfig().getInt("storage-qa-counter")+1);af.saveConfig();sender.sendMessage("MC_HEALTH_ORDINARY_SAVED");return;
        }
        if(args.length==1&&args[0].equals("release")){unlock();}
        else if(args.length==1&&Set.of("seed","seed-journal","seed-storage-fault","seed-unknown-fault").contains(args[0])){
            if(!runs.isEmpty())throw new IllegalStateException("no other fixture run allowed");
            Player p=Bukkit.getPlayerExact("ag_HealthQA");if(p==null)throw new IllegalStateException("owned lab player required");
            Object site=((Map<?,?>)get(manager,"sites")).get("undead_crypt");
            List<?> rooms=(List<?>)get(site,"rooms");World world=Bukkit.getWorld((String)get(site,"world"));
            Object room=rooms.getLast();Method center=room.getClass().getDeclaredMethod("center",World.class);center.setAccessible(true);
            Location at=(Location)center.invoke(room,world);at.getBlock().setType(Material.AIR);at.clone().add(0,1,0).getBlock().setType(Material.AIR);at.clone().add(0,-1,0).getBlock().setType(Material.STONE);
            p.setGameMode(GameMode.SURVIVAL);p.setInvulnerable(true);p.teleport(at);
            ReceiptLockConfig config=new ReceiptLockConfig();config.loadFromString(af.getConfig().saveToString());
            config.set("site-dungeons.receipts",null);config.set("site-dungeons.claimed."+p.getUniqueId(),null);
            set(af,"newConfig",config);
            Class<?> type=Class.forName(manager.getClass().getName()+"$Run",true,manager.getClass().getClassLoader());
            Constructor<?> constructor=type.getDeclaredConstructors()[0];constructor.setAccessible(true);
            Class<?> mode=Class.forName(manager.getClass().getName()+"$Mode",true,manager.getClass().getClassLoader());Object run=constructor.newInstance(site,mode.getEnumConstants()[0]);
            set(run,"stage",rooms.size()-1);set(run,"phase","fighting");
            if(args[0].endsWith("-fault")){
                set(run,"phase","moving");set(run,"fault","data_unavailable");set(run,"pauseReason","runtime_error");set(run,"pausedAt",System.currentTimeMillis());
                set(run,"storageFault",args[0].equals("seed-storage-fault"));
            }
            ((Set<UUID>)get(run,"party")).add(p.getUniqueId());((Map<UUID,Integer>)get(run,"attendance")).put(p.getUniqueId(),rooms.size()-1);
            ((Set<UUID>)get(run,"roomParticipants")).add(p.getUniqueId());
            Map<Integer,Set<UUID>> attendance=(Map<Integer,Set<UUID>>)get(run,"roomAttendance");for(int n=0;n<rooms.size()-1;n++)attendance.put(n,Set.of(p.getUniqueId()));
            runs.put("undead_crypt",run);Method persist=manager.getClass().getDeclaredMethod("persist");persist.setAccessible(true);persist.invoke(manager);armed=args[0].equals("seed");
        }else if(args.length!=1||!args[0].equals("status"))throw new IllegalArgumentException("seed/release/status");
        Object run=runs.get("undead_crypt");YamlConfiguration disk=YamlConfiguration.loadConfiguration(new File(af.getDataFolder(),"config.yml"));
        var receipt=disk.getConfigurationSection("site-dungeons.receipts");int receiptCount=0;if(receipt!=null)for(String id:receipt.getKeys(false))if(receipt.isConfigurationSection(id+".undead_crypt"))receiptCount++;
        sender.sendMessage("MC_HEALTH_DUNGEON {\"active\":"+(run!=null)+",\"held\":"+held+",\"diskStage\":"+disk.getInt("site-dungeons.runs.undead_crypt.stage",-1)+",\"receipts\":"+receiptCount+(run==null?"":",\"phase\":\""+get(run,"phase")+"\",\"stage\":"+get(run,"stage")+",\"fault\":\""+get(run,"fault")+"\",\"attendance\":"+((Map<?,?>)get(run,"attendance")).values()+",\"resets\":"+get(run,"resets"))+"}");
    }
    @SuppressWarnings({"unchecked","rawtypes"}) private void chunks(boolean existing)throws Exception {
        JavaPlugin ol=(JavaPlugin)Bukkit.getPluginManager().getPlugin("OlEncounters");
        Class<?> bridge=Class.forName("com.olencounters.compat.YouerChunks",true,ol.getClass().getClassLoader());
        Method load=bridge.getMethod("load",World.class,int.class,int.class,boolean.class,CompletableFuture.class);
        World world=Bukkit.getWorld("world");Map<String,Object> proof=new LinkedHashMap<>();proof.put("existing",existing);proof.put("passed",false);
        java.util.function.BiFunction<Boolean,Integer,CompletableFuture<org.bukkit.Chunk>> request=(generate,x)->{
            try{return (CompletableFuture<org.bukkit.Chunk>)load.invoke(null,world,x,500,generate,new CompletableFuture<>());}catch(Exception error){return CompletableFuture.failedFuture(error);}
        };
        if(existing){
            if(world.isChunkLoaded(500,500)||!world.isChunkGenerated(500,500))throw new IllegalStateException("restart requires a genuine cold persisted chunk");
            world.getChunkAtAsync(500,500,false).thenCompose(before->{proof.put("nativeColdReturnedNull",before==null);return request.apply(false,500);}).whenComplete((chunk,error)->{
                proof.put("loadedExisting",chunk!=null);finishChunks(proof,error);
            });return;
        }
        if(world.isChunkGenerated(500,500)||world.isChunkGenerated(900,500))throw new IllegalStateException("fresh isolated chunk coordinates required");
        world.getChunkAtAsync(500,500,true).thenCompose(before->{
            proof.put("nativeColdReturnedNull",before==null);return request.apply(false,500);
        }).thenCompose(forbidden->{
            proof.put("generationDenied",forbidden==null&&!world.isChunkGenerated(500,500));return request.apply(true,500);
        }).thenCompose(generated->{
            proof.put("generatedWhenAllowed",generated!=null&&world.isChunkGenerated(500,500));
            CompletableFuture<Object> ended=new CompletableFuture<>();ended.complete("ended");
            try{return (CompletableFuture<org.bukkit.Chunk>)load.invoke(null,world,900,500,true,ended);}catch(Exception error){return CompletableFuture.failedFuture(error);}
        }).handle((ignored,error)->{
            proof.put("endedSearchRejected",error!=null&&!world.isChunkGenerated(900,500));return null;
        }).thenCompose(ignored->{
            try{
                Object config=ol.getClass().getMethod("getConfigManager").invoke(ol);
                Object preset=config.getClass().getMethod("getLocationPreset",String.class).invoke(config,"health_qa");
                Object finder=ol.getClass().getMethod("getLocationFinder").invoke(ol);
                Class<?> meteor=Class.forName("com.olencounters.event.MeteorType",true,ol.getClass().getClassLoader());Object type=Enum.valueOf((Class)meteor,"SMALL");
                Method search=finder.getClass().getMethod("findSuitableLocationAsync",World.class,meteor,preset.getClass(),int.class,int.class);
                return (CompletableFuture<?>)search.invoke(finder,world,type,preset,24,80);
            }catch(Exception error){return CompletableFuture.failedFuture(error);}
        }).whenComplete((found,error)->{
            proof.put("actualLocationSearchFound",found instanceof Optional<?> value&&value.isPresent());finishChunks(proof,error);
        });
    }
    private void finishChunks(Map<String,Object> proof,Throwable error){
        if(error!=null)proof.put("error",error.toString());
        List<String> required=Boolean.TRUE.equals(proof.get("existing"))?List.of("nativeColdReturnedNull","loadedExisting"):List.of("nativeColdReturnedNull","generationDenied","generatedWhenAllowed","endedSearchRejected","actualLocationSearchFound");
        proof.put("passed",error==null&&required.stream().allMatch(key->Boolean.TRUE.equals(proof.get(key))));
        try{getDataFolder().mkdirs();Files.writeString(getDataFolder().toPath().resolve(Boolean.TRUE.equals(proof.get("existing"))?"chunks-existing.json":"chunks.json"),json.toJson(proof));}catch(IOException failure){throw new IllegalStateException(failure);}
    }
    @Override public void onDisable(){try{unlock();if(input!=null)input.println("quit");if(reader!=null&&!reader.waitFor(3,java.util.concurrent.TimeUnit.SECONDS))reader.destroyForcibly();}catch(Exception error){getLogger().warning("owned reader cleanup failed");}}
}
