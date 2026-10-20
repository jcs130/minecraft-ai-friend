package org.afuhome.appearance;

import com.google.gson.*;
import com.github.retrooper.packetevents.protocol.nbt.*;
import com.velocitypowered.api.proxy.Player;
import meow.kikir.freesia.velocity.Freesia;
import meow.kikir.freesia.velocity.network.ysm.VirtualYsmPacketProxyImpl;
import java.nio.file.*;
import java.util.*;
import java.time.Duration;

/** Numen bodies have no Velocity login or Worker mirror. Use Freesia's public virtual-body API. */
final class NativeCompanions {
    record Row(UUID id, String name, int entityId, String dimension, String backend, String model, String texture, String epoch) {}
    private record Live(Row row, VirtualYsmPacketProxyImpl proxy) {}
    private final Path config;
    private final Map<UUID,Live> live = new HashMap<>();
    private final Map<UUID,Long> refreshed = new HashMap<>();
    private volatile Map<UUID,Row> current = Map.of();
    NativeCompanions(Path config) { this.config = config; }

    static Map<UUID,Row> parse(JsonObject root, long now) {
        if (!root.has("schemaVersion") || root.get("schemaVersion").getAsInt()!=1
                || !"numen_server".equals(root.get("source").getAsString())) return Map.of();
        long age=now-root.get("observedAt").getAsLong();
        if (age < -5000 || age > 15000) return Map.of();
        String epoch=root.get("epoch").getAsString(); UUID.fromString(epoch);
        var entries=root.getAsJsonArray("players"); if(entries.size()>16)return Map.of();
        Map<UUID,Row> rows=new LinkedHashMap<>();
        for(var item:entries) {
            var o=item.getAsJsonObject(); UUID id=UUID.fromString(o.get("playerUuid").getAsString());
            String name=o.get("playerName").getAsString(), backend=o.get("backend").getAsString();
            String model=o.get("modelId").getAsString(), texture=o.get("texture").getAsString();
            String dimension=o.get("dimension").getAsString();int entity=o.get("entityId").getAsInt();
            if(entity<0 || !name.matches("[a-zA-Z0-9_]{1,16}") || !backend.matches("[a-zA-Z0-9_-]{1,64}")
                    || !model.matches("[a-zA-Z0-9_-]{1,96}") || !texture.matches("[a-zA-Z0-9_.-]{1,96}")
                    || !dimension.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")) return Map.of();
            if(rows.put(id,new Row(id,name,entity,dimension,backend,model,texture,epoch))!=null)return Map.of();
        }
        return Map.copyOf(rows);
    }

    synchronized Map<UUID,Map<String,Object>> poll(ModelCatalog models, String wireEpoch) {
        Map<UUID,Row> rows=Map.of();
        try {
            var options=JsonParser.parseString(Files.readString(config)).getAsJsonObject();
            if(options.has("numenCompanionStateFile")) {
                Path file=Path.of(options.get("numenCompanionStateFile").getAsString());
                if(!file.isAbsolute() || !file.getFileName().toString().equals("appearance_state.json")
                        || Files.isSymbolicLink(file) || Files.size(file)>65536) throw new IllegalArgumentException();
                rows=parse(JsonParser.parseString(Files.readString(file)).getAsJsonObject(),System.currentTimeMillis());
            }
        } catch(Exception invalid) { rows=Map.of(); }
        Map<UUID,Row> accepted=new LinkedHashMap<>();
        Map<UUID,Map<String,Object>> states=new LinkedHashMap<>();
        for(var row:rows.values()) {
            if(Freesia.PROXY_SERVER.getPlayer(row.id()).isPresent())continue; // A real login always takes precedence.
            var asset=models.get(row.model());
            if(asset==null || !asset.available() || !asset.textures().contains(row.texture()))continue;
            var existing=live.get(row.id());
            if(existing==null || !existing.row().equals(row)) {
                var proxy=new VirtualYsmPacketProxyImpl(row.id());
                // Set ID before data: no implicit tracker fetch for a body without a proxy login.
                proxy.setPlayerEntityId(row.entityId());
                var state=new NBTCompound();
                state.setTag("model_id",new NBTString(row.model()));
                state.setTag("select_texture",new NBTString(row.texture()));
                state.setTag("animation",new NBTString("idle"));
                state.setTag("mandatory",new NBTByte((byte)1));
                state.setTag("play_animation",new NBTInt(0));
                state.setTag("instance_id",new NBTInt(0));
                state.setTag("molang_vars",new NBTCompound());
                proxy.setEntityDataRaw(state);
                live.put(row.id(),new Live(row,proxy));refreshed.clear();
            }
            accepted.put(row.id(),row);
            Map<String,Object> s=new LinkedHashMap<>();
            // source is the existing wire-family discriminator. Authority is explicit below.
            s.put("schemaVersion",1);s.put("source","freesia_worker");s.put("stateAuthority","numen_server");
            s.put("epoch",wireEpoch);s.put("playerUuid",row.id().toString());s.put("playerName",row.name());
            s.put("entityId",row.entityId());s.put("modelId",row.model());s.put("texture",row.texture());
            s.put("available",true);s.put("stateStatus","confirmed");s.put("webAvailable",true);
            s.put("ysmVersion","2.4.1");s.put("protocolVersion","2.4.0");
            s.put("jarSha256","ec51cfae84d219a45fac5098a31bfe980bcb7c2d8b413e8fffbd05a411a85680");
            s.put("mandatory",true);s.put("animation","idle");s.put("workerConnected",!Freesia.registedWorkers.isEmpty());
            s.put("assetSha256",asset.sha256());s.put("assetBytes",asset.gzip().length);
            s.put("message","常驻角色模型已由服务器确认；网页收到资源后显示。");
            states.put(row.id(),s);
        }
        for(var previous:live.entrySet())if(!accepted.containsKey(previous.getKey())) {
            var reset=new NBTCompound();
            reset.setTag("model_id",new NBTString("default"));reset.setTag("select_texture",new NBTString("default"));
            reset.setTag("mandatory",new NBTByte((byte)0));reset.setTag("animation",new NBTString("idle"));
            reset.setTag("play_animation",new NBTInt(0));reset.setTag("instance_id",new NBTInt(0));reset.setTag("molang_vars",new NBTCompound());
            previous.getValue().proxy().setEntityDataRaw(reset);
            for(Player recipient:Freesia.PROXY_SERVER.getAllPlayers())
                if(visible(previous.getKey(),recipient)&&Freesia.mapperManager.isPlayerInstalledYsm(recipient))previous.getValue().proxy().sendEntityStateTo(recipient);
        }
        live.keySet().retainAll(accepted.keySet());current=Map.copyOf(accepted);
        return states;
    }

    boolean visible(UUID id, Player recipient) {
        Row row=current.get(id);
        return row!=null && recipient.getCurrentServer().map(s->s.getServerInfo().getName().equals(row.backend())).orElse(false);
    }
    boolean mayRead(Player recipient,String model) {
        return current.values().stream().anyMatch(r->r.model().equals(model)&&visible(r.id(),recipient));
    }
    synchronized void refresh(Player recipient) {
        if(!Freesia.mapperManager.isPlayerInstalledYsm(recipient))return;
        long now=System.nanoTime();
        if(now-refreshed.getOrDefault(recipient.getUniqueId(),0L)<Duration.ofSeconds(5).toNanos())return;
        refreshed.put(recipient.getUniqueId(),now);
        for(var entry:live.entrySet())if(visible(entry.getKey(),recipient))entry.getValue().proxy().sendEntityStateTo(recipient);
    }
}
