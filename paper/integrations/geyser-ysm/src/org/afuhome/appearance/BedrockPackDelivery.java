package org.afuhome.appearance;

import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.geysermc.geyser.api.entity.property.type.GeyserIntEntityProperty;
import org.geysermc.geyser.api.event.bedrock.SessionLoadResourcePacksEvent;
import org.geysermc.geyser.api.pack.*;
import org.geysermc.geyser.entity.type.player.AvatarEntity;
import org.geysermc.geyser.session.GeyserSession;

/** Each connection pins the exact pack it downloaded. Slot IDs from different packs never mix. */
final class BedrockPackDelivery {
    record Published(BedrockPack.Snapshot snapshot,ResourcePack pack) { }
    record Applied(AvatarEntity entity,int slot,int extra) { }
    private final BedrockPack compiler;
    private final GeyserIntEntityProperty modelProperty,extraProperty;
    private volatile Published current;
    private volatile Map<UUID,BedrockState.Entry> states=Map.of();
    private final Map<GeyserSession,Published> downloaded=new ConcurrentHashMap<>();
    private final Set<GeyserSession> joined=ConcurrentHashMap.newKeySet();
    private final Map<GeyserSession,Map<UUID,Applied>> applied=new ConcurrentHashMap<>();
    private final Map<GeyserSession,String> notified=new ConcurrentHashMap<>();
    private final AtomicLong changed=new AtomicLong(),restored=new AtomicLong();
    private String catalogRevision="";
    private volatile String reason="YSM_BEDROCK_PACK_PREPARING";
    BedrockPackDelivery(Path template,Path output,GeyserIntEntityProperty modelProperty,GeyserIntEntityProperty extraProperty) throws Exception {
        this.compiler=new BedrockPack(template,output);this.modelProperty=Objects.requireNonNull(modelProperty);this.extraProperty=Objects.requireNonNull(extraProperty);
    }
    void scan(ModelCatalog models,Map<UUID,BedrockState.Entry> fresh) throws Exception {
        states=Map.copyOf(fresh);
        if(!models.revision().equals(catalogRevision)) {
            var snapshot=compiler.build(models);
            current=new Published(snapshot,ResourcePack.create(PackCodec.path(snapshot.path())));
            catalogRevision=models.revision();
        }
        reason="";
    }
    void unavailable(String why){states=Map.of();reason=why;}
    void load(SessionLoadResourcePacksEvent e) {
        if(!(e.connection() instanceof GeyserSession session))return;
        // Prototype is pinned to the real codec/client version used in acceptance.
        // Other supported Geyser versions keep ordinary skins and gameplay.
        if(session.protocolVersion()!=2193)return;
        Published pack=current;
        if(pack!=null && !pack.snapshot.variants().isEmpty() && e.register(pack.pack))downloaded.put(session,pack);
    }
    void join(GeyserSession session){if(downloaded.containsKey(session))joined.add(session);}
    void drop(GeyserSession session){downloaded.remove(session);joined.remove(session);applied.remove(session);notified.remove(session);}
    void retain(Collection<GeyserSession> online){downloaded.keySet().removeIf(s->s.isClosed());joined.retainAll(online);applied.keySet().retainAll(online);notified.keySet().retainAll(online);}
    void refresh(GeyserSession session,AtomicInteger budget) {
        Published connection=downloaded.get(session);if(connection==null || !joined.contains(session) || session.isClosed())return;
        Map<UUID,Applied> previous=applied.computeIfAbsent(session,s->new HashMap<>());
        Set<UUID> candidates=new HashSet<>(states.keySet());candidates.addAll(previous.keySet());int sent=0;
        for(UUID uuid:candidates) {
            AvatarEntity entity=uuid.equals(session.getPlayerEntity().uuid())?session.getPlayerEntity():session.getEntityCache().getPlayerEntity(uuid);
            if(entity==null||!entity.isValid()){previous.remove(uuid);continue;}
            var row=states.get(uuid);
            var variant=row!=null && row.entityId()==entity.getEntityId() && uuid.equals(row.uuid()) ? connection.snapshot.select(row) : null;
            Published latest=current;
            if(variant==null && row!=null && row.entityId()==entity.getEntityId() && latest!=null && latest.snapshot.select(row)!=null && !latest.snapshot.revision().equals(notified.get(session))) {
                notified.put(session,latest.snapshot.revision());
                session.sendMessage("§e[角色外观] 有新的角色模型资源，重新连接服务器后即可加载。当前暂用普通外观。");
            }
            int slot=variant==null?0:variant.slot(),extra=variant==null?0:variant.extras().getOrDefault(row.animation(),0);
            Applied old=previous.get(uuid);
            if(old!=null && old.entity==entity && old.slot==slot && old.extra==extra)continue;
            if(old==null && slot==0)continue;
            if(sent>=4 || !takeBudget(budget))break;
            entity.updatePropertiesBatched(updater->{updater.update(modelProperty,slot);updater.update(extraProperty,extra);},true);
            previous.put(uuid,new Applied(entity,slot,extra));sent++;changed.incrementAndGet();if(slot==0)restored.incrementAndGet();
        }
    }
    static boolean takeBudget(AtomicInteger budget){int n;do{n=budget.get();if(n<=0)return false;}while(!budget.compareAndSet(n,n-1));return true;}
    Map<String,Object> status() {
        var pack=current;Map<String,Object> out=new LinkedHashMap<>();out.put("delivery","resource_pack");out.put("reason",reason);out.put("applied",changed.get());out.put("restored",restored.get());out.put("sessions",joined.size());
        out.put("packRevision",pack==null?"":pack.snapshot.revision());out.put("variants",pack==null?0:pack.snapshot.variants().size());out.put("unavailable",pack==null?Map.of():pack.snapshot.rejected());
        out.put("reconnectForUpdatedPack",true);out.put("fullAnimationParity",false);out.put("deviceVisualsVerified",false);
        out.put("packProtocols",List.of(2193));
        out.put("sessionPacks",downloaded.entrySet().stream().map(e->Map.of("uuid",Objects.toString(e.getKey().getPlayerEntity().uuid(),"pending"),"revision",e.getValue().snapshot.revision())).toList());
        out.put("readyPlayers",pack==null?0:states.values().stream().filter(s->pack.snapshot.select(s)!=null).count());out.put("assignedPlayers",states.size());return out;
    }
    List<Map<String,Object>> projected(){return states.values().stream().map(s->Map.<String,Object>of("uuid",s.uuid().toString(),"entityId",s.entityId(),"model",s.modelId())).toList();}
}
