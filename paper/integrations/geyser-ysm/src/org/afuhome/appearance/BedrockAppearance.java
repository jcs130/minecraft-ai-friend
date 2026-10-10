package org.afuhome.appearance;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.geysermc.event.PostOrder;
import org.geysermc.event.subscribe.Subscribe;
import org.geysermc.geyser.GeyserImpl;
import org.geysermc.geyser.api.command.*;
import org.geysermc.geyser.api.event.bedrock.SessionSkinApplyEvent;
import org.geysermc.geyser.api.event.lifecycle.*;
import org.geysermc.geyser.api.extension.Extension;
import org.geysermc.geyser.api.skin.*;
import org.geysermc.geyser.entity.type.player.AvatarEntity;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.geyser.skin.SkinManager;
import org.geysermc.geyser.skin.SkinProvider;

/** Geyser-only adapter. Changes appearance packets, never gameplay entities or UUIDs. */
public final class BedrockAppearance implements Extension {
    record Ready(BedrockState.Entry state,BedrockModel model) { }
    record Tracked(AvatarEntity entity,SkinData original,String key) { }
    private volatile Map<UUID,Ready> ready=Map.of();
    private volatile Map<String,String> unavailable=Map.of();
    private final Map<GeyserSession,Map<UUID,Tracked>> tracked=new ConcurrentHashMap<>();
    private final Map<GeyserSession,Map<UUID,Long>> requested=new ConcurrentHashMap<>();
    private final LinkedHashMap<String,BedrockModel> cache=new LinkedHashMap<>(32,0.75f,true);
    private final Map<String,String> rejected=new HashMap<>();
    private final Set<GeyserSession> queued=ConcurrentHashMap.newKeySet();
    private final Map<GeyserSession,List<Map<String,Object>>> bindings=new ConcurrentHashMap<>();
    private final AtomicInteger packetBudget=new AtomicInteger();
    private ScheduledExecutorService scheduler;
    private ModelCatalog models;
    private Path stateFile;
    private volatile boolean enabled;
    private volatile String reason="YSM_BEDROCK_DISABLED";
    private final AtomicLong applied=new AtomicLong(),restored=new AtomicLong();
    private long scanned;

    @Subscribe public void start(GeyserPostInitializeEvent event) {
        try {
            Files.createDirectories(dataFolder());Path config=dataFolder().resolve("config.json");
            if(!Files.exists(config))Files.writeString(config,"{\"enabled\":false,\"modelsConfig\":\"\",\"stateFile\":\"\"}\n");
            JsonObject options=JsonParser.parseString(Files.readString(config)).getAsJsonObject();
            enabled=options.get("enabled").getAsBoolean();if(!enabled)return;
            // Reflection is intentional: Java inlines static final String constants.
            if(!"git-master-f66329d".equals(GeyserImpl.class.getField("GIT_VERSION").get(null)) || !"1249".equals(GeyserImpl.class.getField("BUILD_NUMBER").get(null)))throw new IllegalStateException("YSM_BEDROCK_GEYSER_VERSION_MISMATCH");
            Path modelConfig=Path.of(options.get("modelsConfig").getAsString());stateFile=Path.of(options.get("stateFile").getAsString());
            if(!modelConfig.isAbsolute() || !stateFile.isAbsolute())throw new IllegalStateException("YSM_BEDROCK_ABSOLUTE_PATH_REQUIRED");
            models=new ModelCatalog(modelConfig);
            scheduler=Executors.newSingleThreadScheduledExecutor(r->{Thread thread=new Thread(r,"ysm-bedrock-assets");thread.setDaemon(true);return thread;});
            scheduler.scheduleWithFixedDelay(this::poll,0,1,TimeUnit.SECONDS);
            logger().info("Original YSM player geometry adapter enabled; device visuals and native animations require separate acceptance.");
        } catch(Exception error) { enabled=false;reason=message(error);logger().error(reason+"; existing Geyser gameplay remains available."); }
    }
    @Subscribe public void commands(GeyserDefineCommandsEvent event) {
        event.register(Command.builder(this).name("status").source(CommandSource.class).description("YSM基岩外观适配状态")
            .permission("agentappearance.bedrock.status").suggestedOpOnly(true).executableOnConsole(true).bedrockOnly(false)
            .executor((source,command,args)->source.sendMessage(new Gson().toJson(status()))).build());
    }
    @Subscribe public void stop(GeyserShutdownEvent event) {
        enabled=false;ready=Map.of();if(scheduler!=null)scheduler.shutdownNow();tracked.clear();requested.clear();queued.clear();bindings.clear();
    }
    @Subscribe(postOrder=PostOrder.LAST) public void skin(SessionSkinApplyEvent event) {
        if(!enabled || !(event.connection() instanceof GeyserSession session))return;
        AvatarEntity entity=entity(session,event.uuid());if(entity==null)return;
        Ready target=select(ready.get(event.uuid()),entity.uuid(),entity.getEntityId());
        SkinData original=event.skinData();
        tracked.computeIfAbsent(session,s->new ConcurrentHashMap<>()).put(event.uuid(),new Tracked(entity,original,key(target)));
        if(target!=null) {event.skin(target.model.skin());event.geometry(target.model.geometry());applied.incrementAndGet();}
    }
    static Ready select(Ready row,UUID uuid,int entityId) {
        return row!=null && row.state.uuid().equals(uuid) && row.state.entityId()==entityId ? row : null;
    }
    private static String key(Ready row) {return row==null?null:row.state.epoch()+":"+row.state.entityId()+":"+row.model.key();}
    private static AvatarEntity entity(GeyserSession session,UUID uuid) {
        return uuid.equals(session.getPlayerEntity().uuid())?session.getPlayerEntity():session.getEntityCache().getPlayerEntity(uuid);
    }
    private void poll() {
        try {
            long now=System.currentTimeMillis();if(now-scanned>=5000) {scanned=now;models.scan();}
            Map<UUID,BedrockState.Entry> states=BedrockState.read(stateFile,now);
            Map<UUID,Ready> next=new HashMap<>();Map<String,String> failed=new TreeMap<>();
            Set<String> used=new HashSet<>();long usedBytes=0;
            for(var state:states.values()) {
                var asset=models.get(state.modelId());
                if(asset==null || !asset.available() || !state.sha256().equals(asset.sha256())) {failed.put(state.modelId(),"YSM_BEDROCK_SOURCE_REVISION_UNAVAILABLE");continue;}
                String id=asset.sha256()+":"+state.texture();BedrockModel model=cache.get(id);
                if(rejected.containsKey(id)) {failed.put(state.modelId(),rejected.get(id));continue;}
                try {
                    if(model==null) {model=BedrockModel.convert(asset,state.texture());cache.put(id,model);}
                    long bytes=model.skin().skinData().length+model.geometry().geometryData().length()*2L;
                    if(!used.contains(id) && (used.size()>=32 || usedBytes+bytes>32*1024*1024)) {failed.put(state.modelId(),"YSM_BEDROCK_ACTIVE_ASSET_BUDGET");continue;}
                    if(used.add(id))usedBytes+=bytes;
                    next.put(state.uuid(),new Ready(state,model));
                } catch(Exception error) {String why=message(error);failed.put(state.modelId(),why);rejected.put(id,why);}
            }
            // At most 32 converted skins / 32 MiB, LRU; in-use values remain immutable.
            while(cache.size()>32 || cache.values().stream().mapToLong(m->m.skin().skinData().length+m.geometry().geometryData().length()*2L).sum()>32*1024*1024)cache.remove(cache.keySet().iterator().next());
            if(rejected.size()>64)rejected.clear();
            ready=Map.copyOf(next);unavailable=Map.copyOf(failed);reason="";
        } catch(Exception error) {ready=Map.of();reason=message(error);}
        try {
            var sessions=geyserApi().onlineConnections().stream().filter(GeyserSession.class::isInstance).map(GeyserSession.class::cast).toList();
            tracked.keySet().retainAll(sessions);requested.keySet().retainAll(sessions);bindings.keySet().retainAll(sessions);
            // One bounded sweep per second, mutations stay on each Geyser session event loop.
            packetBudget.set(32);
            for(GeyserSession session:sessions)if(!session.isClosed() && queued.add(session))session.executeInEventLoop(()->{try{refresh(session);}finally{queued.remove(session);}});
            writeStatus();
        } catch(Exception error) {reason=message(error);}
    }
    private void refresh(GeyserSession session) {
        if(!enabled || session.isClosed())return;
        List<Map<String,Object>> observed=new ArrayList<>();
        session.getEntityCache().forEachPlayerEntity(player->{if(observed.size()<40)observed.add(Map.of("uuid",player.uuid().toString(),"entityId",player.getEntityId(),"valid",player.isValid(),"name",player.getUsername()));});
        bindings.put(session,List.copyOf(observed));
        Map<UUID,Tracked> seen=tracked.computeIfAbsent(session,s->new ConcurrentHashMap<>());
        Set<UUID> candidates=new HashSet<>(seen.keySet());candidates.addAll(ready.keySet());int sent=0;
        for(UUID uuid:candidates) {
            AvatarEntity entity=entity(session,uuid);Tracked previous=seen.get(uuid);
            if(entity==null || !entity.isValid()) {seen.remove(uuid);continue;}
            Ready target=select(ready.get(uuid),entity.uuid(),entity.getEntityId());String key=key(target);
            // Geyser returns fallback skins before firing SessionSkinApplyEvent for
            // profiles without texture properties (common for offline Agents).
            if((previous==null || previous.entity()!=entity) && target!=null && SkinManager.GameProfileData.from(entity)==null) {
                previous=new Tracked(entity,SkinProvider.determineFallbackSkinData(uuid),null);seen.put(uuid,previous);
            }
            if(previous==null || previous.entity()!=entity) {
                if(target!=null && sent<4) {
                    Map<UUID,Long> pending=requested.computeIfAbsent(session,s->new ConcurrentHashMap<>());long now=System.nanoTime();
                    if(now-pending.getOrDefault(uuid,0L)>TimeUnit.SECONDS.toNanos(10) && takeBudget()) {pending.put(uuid,now);SkinManager.requestAndHandleSkinAndCape(entity,session,null);sent++;}
                }continue;
            }
            if(Objects.equals(previous.key(),key) || sent>=4 || !takeBudget())continue;
            SkinData data=target==null?previous.original():new SkinData(target.model.skin(),previous.original().cape(),target.model.geometry());
            SkinManager.sendSkinPacket(session,entity,data);sent++;
            seen.put(uuid,new Tracked(entity,previous.original(),key));if(target==null)restored.incrementAndGet();else applied.incrementAndGet();
        }
        Map<UUID,Long> pending=requested.get(session);if(pending!=null)pending.keySet().removeIf(uuid->!candidates.contains(uuid));
    }
    private boolean takeBudget() {int remaining;do {remaining=packetBudget.get();if(remaining<=0)return false;}while(!packetBudget.compareAndSet(remaining,remaining-1));return true;}
    private Map<String,Object> status() {
        Map<String,Object> status=new LinkedHashMap<>();status.putAll(Map.of("schemaVersion",1,"enabled",enabled,"readyPlayers",ready.size(),"sessions",tracked.size(),"applied",applied.get(),"restored",restored.get(),
            "reason",reason,"unavailable",unavailable,"fullAnimationParity",false,"deviceVisualsVerified",false));
        status.put("bindings",List.copyOf(bindings.values()));status.put("projected",ready.values().stream().map(r->Map.of("uuid",r.state.uuid().toString(),"entityId",r.state.entityId(),"model",r.state.modelId())).toList());return status;
    }
    private void writeStatus() throws Exception {
        Path target=dataFolder().resolve("status.json"),pending=Files.createTempFile(dataFolder(),".status-",".tmp");
        try {Files.writeString(pending,new Gson().toJson(status()));Files.move(pending,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
        finally {Files.deleteIfExists(pending);}
    }
    private static String message(Exception error) {String text=error.getMessage();return text!=null && text.startsWith("YSM_")?text:"YSM_BEDROCK_ADAPTER_UNAVAILABLE";}
}
