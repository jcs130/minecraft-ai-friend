package org.afuhome.agentfriend;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/** Shared by ordinary saveConfig and the dungeon transaction. Commit state once;
 * retry publication only. A reader of config.yml cannot lock an adventure. */
final class DurableConfigStore {
    static final String REVISION="__agentfriend_storage.revision";
    private static final Map<JavaPlugin,State> STATES=new IdentityHashMap<>();
    private static final class State {
        final DurableConfigFiles files;final JavaPlugin owner;
        BukkitTask retry;boolean loaded,failed,reportedPending;int delay=20;
        State(JavaPlugin plugin)throws IOException {
            owner=plugin;Files.createDirectories(plugin.getDataFolder().toPath());
            files=new DurableConfigFiles(plugin.getDataFolder().toPath().resolve("config.yml"));
        }
        void arm(){
            if(failed||retry!=null||!owner.isEnabled()||!files.needsFlush()||Boolean.TRUE.equals(files.audit().get("commitUnknown")))return;
            retry=Bukkit.getScheduler().runTaskLater(owner,()->{
                retry=null;
                if(files.flush()){
                    delay=20;
                    if(reportedPending){owner.getLogger().info("MC_AGENT_STATE_PROJECTION_READY "+files.audit());reportedPending=false;}
                }else{delay=Math.min(100,delay*2);arm();}
            },delay);
        }
    }
    private DurableConfigStore(){}
    private static synchronized State state(JavaPlugin plugin)throws IOException {
        State existing=STATES.get(plugin);
        if(existing==null){existing=new State(plugin);STATES.put(plugin,existing);}
        if(existing.failed)throw new IOException("state_recovery_requires_operator");return existing;
    }
    private static byte[] published(JavaPlugin plugin)throws IOException {
        Path file=plugin.getDataFolder().toPath().resolve("config.yml");
        if(!Files.exists(file))return "{}\n".getBytes(StandardCharsets.UTF_8);
        if(Files.size(file)>DurableConfigFiles.MAX_IMAGE)throw new IOException("state_image_size_limit");
        return Files.readAllBytes(file);
    }
    private static long revision(byte[] image)throws IOException {
        try{
            var cfg=new YamlConfiguration();cfg.loadFromString(new String(image,StandardCharsets.UTF_8));Object value=cfg.get(REVISION);
            if(value==null)return 0;
            if(!(value instanceof Integer||value instanceof Long)||((Number)value).longValue()<0)throw new IOException("state_revision_invalid");
            return ((Number)value).longValue();
        }
        catch(Exception invalid){throw new IOException("state_yaml_invalid_preserve_files",invalid);}
    }
    static String beforeReload(JavaPlugin plugin){
        State state=null;
        try {
            state=state(plugin);
            if(!state.loaded){
                byte[] disk=published(plugin);byte[] selected=state.files.initialize(disk,revision(disk));
                if(revision(selected)!=state.files.revision())throw new IOException("state_record_revision_mismatch");
                state.loaded=true;return new String(selected,StandardCharsets.UTF_8);
            }
            if(state.files.pending())return new String(state.files.accepted(),StandardCharsets.UTF_8);
            byte[] disk=published(plugin);state.files.adoptPublished(disk,revision(disk));return new String(disk,StandardCharsets.UTF_8);
        }catch(IOException error){
            if(state!=null){state.failed=true;try{state.files.close();}catch(IOException close){error.addSuppressed(close);}}
            throw new IllegalStateException("agentfriend_state_recovery_unavailable; preserve original files",error);
        }
    }
    static void afterReload(JavaPlugin plugin,String image){
        try{plugin.getConfig().loadFromString(image);state(plugin).arm();}
        catch(Exception error){throw new IllegalStateException("agentfriend_state_load_failed; preserve original files",error);}
    }
    static void onEnable(JavaPlugin plugin){plugin.getConfig();try{state(plugin).arm();}catch(IOException error){throw new IllegalStateException(error);}}
    static void save(JavaPlugin plugin){
        try{persist(plugin);}catch(IOException error){throw new IllegalStateException("agentfriend_state_commit_unavailable; inspect original receipt before retry",error);}
    }
    static void persist(JavaPlugin plugin)throws IOException {
        if(!Bukkit.isPrimaryThread())throw new IOException("state_write_requires_server_thread");
        var config=plugin.getConfig();State state=state(plugin);
        long previous=config.getLong(REVISION,0),next=state.files.revision()+1;
        if(previous!=state.files.revision())throw new IOException("state_memory_revision_conflict");
        config.set(REVISION,next);
        try{state.files.commit(config.saveToString().getBytes(StandardCharsets.UTF_8),next);}
        catch(IOException failure){config.set(REVISION,previous);throw failure;}
        if(state.files.pending()&&!state.reportedPending){
            state.reportedPending=true;
            plugin.getLogger().warning("MC_AGENT_STATE_PROJECTION_DELAYED durable=true "+state.files.audit());
        }
        state.arm();
    }
    static Map<String,Object> audit(JavaPlugin plugin){
        synchronized(DurableConfigStore.class){State state=STATES.get(plugin);return state==null?Map.of("initialized",false):state.files.audit();}
    }
    static void close(JavaPlugin plugin){
        State state;synchronized(DurableConfigStore.class){state=STATES.remove(plugin);}
        if(state==null)return;if(state.retry!=null)state.retry.cancel();
        try{state.files.close();}catch(IOException error){plugin.getLogger().warning("State writer close failed; durable records preserved: "+error.getClass().getSimpleName());}
    }
}
