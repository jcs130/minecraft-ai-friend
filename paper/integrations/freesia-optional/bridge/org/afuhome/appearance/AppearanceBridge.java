package org.afuhome.appearance;

import com.google.gson.Gson;
import com.google.inject.Inject;
import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Dependency;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import meow.kikir.freesia.velocity.Freesia;
import meow.kikir.freesia.velocity.network.ysm.YsmMapperPayloadManager.AppearanceState;
import net.kyori.adventure.text.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.nio.file.Path;

/** Server-authoritative metadata; no client handshake emulation or gameplay action. */
@Plugin(id="agentappearance", name="AgentAppearance", version="0.2.0",
    dependencies={@Dependency(id="freesia"), @Dependency(id="packetevents")})
public final class AppearanceBridge {
    private static final MinecraftChannelIdentifier CHANNEL = MinecraftChannelIdentifier.from("mcagent:appearance");
    private static final MinecraftChannelIdentifier ASSETS = MinecraftChannelIdentifier.from("mcagent:ysm_asset");
    private final ModelCatalog models = new ModelCatalog(Path.of("plugins/agentappearance/models.json"));
    private final Map<UUID,Transfer> transfers = new ConcurrentHashMap<>();
    private final Map<UUID,Long> requested = new ConcurrentHashMap<>();
    private record Transfer(ModelCatalog.Asset asset, String request, int index) { }
    private static final Gson JSON = new Gson();
    private static final String YSM_SHA = "ec51cfae84d219a45fac5098a31bfe980bcb7c2d8b413e8fffbd05a411a85680";
    private volatile String requestedRevision="";
    private long modelReloaded;
    private final ProxyServer server;
    private final Map<UUID,String> last = new ConcurrentHashMap<>();
    private final Map<UUID,Map<String,Object>> states = new ConcurrentHashMap<>();
    private final Map<UUID,Set<UUID>> delivered = new ConcurrentHashMap<>();
    private final Map<UUID,Long> refreshed = new ConcurrentHashMap<>();
    private final String epoch = UUID.randomUUID().toString();
    @Inject public AppearanceBridge(ProxyServer server) { this.server=server; }

    @Subscribe public void start(ProxyInitializeEvent event) {
        server.getChannelRegistrar().register(ASSETS);
        server.getCommandManager().register(server.getCommandManager().metaBuilder("appearance").plugin(this).build(), new Commands());
        server.getScheduler().buildTask(this,this::poll).repeat(Duration.ofSeconds(1)).schedule();
        server.getScheduler().buildTask(this,()->{
            try {
                models.scan();String revision=models.revision();
                if(!revision.isEmpty() && !revision.equals(requestedRevision) && Freesia.registedWorkers.size()==1 && System.nanoTime()-modelReloaded>Duration.ofSeconds(30).toNanos()) {
                    // Reload only YSM's Worker catalog, never the game server/plugins/world.
                    modelReloaded=System.nanoTime();
                    requestedRevision=revision;
                    // YSM reload completes asynchronously and may return no command feedback.
                    // Dispatch once per source revision; never create a repeated reload loop.
                    Freesia.registedWorkers.values().iterator().next().dispatchCommandToWorker("ysm model reload",feedback->{});
                }
            } catch(Exception ignored) { models.invalidate(); }
        }).repeat(Duration.ofSeconds(5)).schedule();
        server.getScheduler().buildTask(this,this::transfer).repeat(Duration.ofMillis(100)).schedule();
    }
    @Subscribe public void left(DisconnectEvent event) {
        UUID uuid=event.getPlayer().getUniqueId();last.remove(uuid);states.remove(uuid);delivered.remove(uuid);refreshed.remove(uuid);
        transfers.remove(uuid);requested.remove(uuid);
    }
    @Subscribe public void stop(ProxyShutdownEvent event) { transfers.clear(); requested.clear(); server.getChannelRegistrar().unregister(ASSETS); }
    @Subscribe public void assetRequest(PluginMessageEvent event) {
        if(!event.getIdentifier().equals(ASSETS))return;
        event.setResult(PluginMessageEvent.ForwardResult.handled());
        if(!(event.getSource() instanceof Player player) || event.getData().length>512)return;
        try {
            var request=com.google.gson.JsonParser.parseString(new String(event.getData(),StandardCharsets.UTF_8)).getAsJsonObject();
            String id=request.get("modelId").getAsString(), hash=request.get("sha256").getAsString(), token=request.get("requestId").getAsString();
            if(!request.get("type").getAsString().equals("get") || !token.matches("[a-f0-9]{32}") || !ModelCatalog.validId(id))return;
            long now=System.nanoTime();if(now-requested.getOrDefault(player.getUniqueId(),0L)<Duration.ofMillis(500).toNanos() || transfers.containsKey(player.getUniqueId()))return;
            requested.put(player.getUniqueId(),now);
            ModelCatalog.Asset asset=models.get(id);
            if(asset==null || !asset.available() || !asset.sha256().equals(hash) || !mayRead(player,id))return;
            transfers.put(player.getUniqueId(),new Transfer(asset,token,0));
        } catch(RuntimeException ignored) { }
    }
    private boolean mayRead(Player recipient,String id) {
        return server.getAllPlayers().stream().anyMatch(owner->{
            Map<String,Object> state=states.get(owner.getUniqueId());
            return sameBackend(owner,recipient) && state!=null && Boolean.TRUE.equals(state.get("available")) && id.equals(state.get("modelId"));
        });
    }
    private void transfer() {
        for(var entry:transfers.entrySet()) {
            Player player=server.getPlayer(entry.getKey()).orElse(null);Transfer transfer=entry.getValue();
            if(player==null || models.get(transfer.asset.id())!=transfer.asset || !mayRead(player,transfer.asset.id())) {transfers.remove(entry.getKey(),transfer);continue;}
            byte[] data=transfer.asset.gzip();int count=(data.length+12287)/12288, index=transfer.index;
            int end=Math.min(count,index+2);
            for(;index<end;index++) {
                byte[] part=Arrays.copyOfRange(data,index*12288,Math.min(data.length,(index+1)*12288));
                Map<String,Object> row=Map.of("schemaVersion",1,"type","chunk","requestId",transfer.request,"sha256",transfer.asset.sha256(),"index",index,"count",count,"bytes",data.length,"data",Base64.getEncoder().encodeToString(part));
                if(!player.sendPluginMessage(ASSETS,JSON.toJson(row).getBytes(StandardCharsets.UTF_8)))break;
            }
            if(index==count)transfers.remove(entry.getKey(),transfer);
            else transfers.replace(entry.getKey(),transfer,new Transfer(transfer.asset,transfer.request,index));
        }
    }
    private void poll() {
        if (Freesia.mapperManager==null) return;
        Collection<Player> players=server.getAllPlayers();
        if (players.size()>40) return; // Matches the existing game connection budget.
        for (Player owner:players) {
            AppearanceState nativeState=Freesia.mapperManager.appearanceState(owner);
            Map<String,Object> row=new LinkedHashMap<>();
            row.put("schemaVersion",1);row.put("source","freesia_worker");row.put("epoch",epoch);
            row.put("playerUuid",owner.getUniqueId().toString());row.put("playerName",owner.getUsername());
            row.put("ysmVersion","2.4.1");row.put("protocolVersion","2.4.0");row.put("jarSha256",YSM_SHA);
            row.put("available",nativeState!=null);
            if(nativeState!=null) {
                String model=nativeState.state().getStringTagValueOrDefault("model_id","");
                String texture=nativeState.state().getStringTagValueOrDefault("select_texture","");
                String animation=nativeState.state().getStringTagValueOrDefault("animation","");
                if(!ModelCatalog.validId(model) || !texture.matches("[\\p{L}\\p{N}_.-]{1,96}") || animation.length()>96) {
                    row.put("available",false);row.put("reason","YSM_WORKER_STATE_UNSUPPORTED");
                } else {
                    row.put("entityId",nativeState.entityId());row.put("modelId",model);row.put("texture",texture);
                    row.put("mandatory",nativeState.state().getBoolean("mandatory"));row.put("animation",animation);
                    ModelCatalog.Asset asset=models.get(model);
                    row.put("webAvailable",asset!=null && asset.available() && asset.textures().contains(texture));
                    if(asset!=null && asset.available() && asset.textures().contains(texture)) {
                        row.put("assetSha256",asset.sha256());row.put("assetBytes",asset.gzip().length);
                    } else row.put("webReason",asset==null?"YSM_SOURCE_NOT_REGISTERED":asset.reason()==null?"YSM_TEXTURE_NOT_REGISTERED":asset.reason());
                }
            } else row.put("reason","YSM_WORKER_STATE_UNAVAILABLE");
            states.put(owner.getUniqueId(),row);
            String serial=JSON.toJson(row);
            if(!serial.equals(last.put(owner.getUniqueId(),serial))) for(Set<UUID> set:delivered.values()) set.remove(owner.getUniqueId());
        }
        Set<UUID> online=new HashSet<>();for(Player p:players)online.add(p.getUniqueId());
        states.keySet().removeIf(uuid->!online.contains(uuid));
        for(Player recipient:players) {
            Set<UUID> sent=delivered.computeIfAbsent(recipient.getUniqueId(),uuid->ConcurrentHashMap.newKeySet());
            for(UUID uuid:Set.copyOf(sent)) if(!online.contains(uuid) || server.getPlayer(uuid).filter(owner->sameBackend(owner,recipient)).isEmpty()) {
                send(recipient,Map.of("schemaVersion",1,"source","freesia_worker","epoch",epoch,"type","remove","playerUuid",uuid.toString()));sent.remove(uuid);
            }
            long now=System.nanoTime();
            if(now-refreshed.getOrDefault(recipient.getUniqueId(),0L)>=Duration.ofSeconds(5).toNanos()) {
                sent.clear();refreshed.put(recipient.getUniqueId(),now);
            }
            // Metadata is public appearance. The viewer may bind only a native entity
            // that its own connection currently tracks; this is not a tracker proof.
            for(Player owner:players) {
                if(sent.contains(owner.getUniqueId()) || !sameBackend(owner,recipient)) continue;
                Map<String,Object> state=states.get(owner.getUniqueId());if(state==null)continue;
                Map<String,Object> row=new LinkedHashMap<>(state);row.put("type","state");
                if(send(recipient,row))sent.add(owner.getUniqueId());
            }
        }
    }
    private boolean sameBackend(Player a,Player b) {
        return a.getCurrentServer().isPresent() && b.getCurrentServer().isPresent() &&
            a.getCurrentServer().get().getServerInfo().equals(b.getCurrentServer().get().getServerInfo());
    }
    private boolean send(Player player,Map<String,Object> row) {
        byte[] bytes=JSON.toJson(row).getBytes(StandardCharsets.UTF_8);
        return bytes.length<=2048 && player.sendPluginMessage(CHANNEL,bytes);
    }
    private void tell(CommandSource source,String text) { source.sendMessage(Component.text(text)); }
    private final class Commands implements SimpleCommand {
        @Override public void execute(Invocation invocation) {
            CommandSource source=invocation.source();String[] args=invocation.arguments();
            if(args.length==1 && args[0].equals("list")) { tell(source,"MC_APPEARANCE_CATALOG "+JSON.toJson(models.catalog()));return; }
            if(args.length==0 || args.length==1 && args[0].equals("status")) {
                if(!(source instanceof Player player)) { tell(source,"MC_APPEARANCE_STATUS players="+states.size()+" worker="+!Freesia.registedWorkers.isEmpty());return; }
                Map<String,Object> state=states.get(player.getUniqueId());tell(source,"MC_APPEARANCE_STATUS "+JSON.toJson(state==null?Map.of("available",false,"reason","等待模型 Worker 状态；稍后重试 /appearance status"):state));return;
            }
            if(args.length==5 && args[0].equals("admin") && args[1].equals("set")) {
                if(source!=server.getConsoleCommandSource()) { tell(source,"仅服务器控制台可分配模型。请联系服主；查看本人状态用 /appearance status。");return; }
                Player target=server.getPlayer(args[2]).orElse(null);
                if(target==null || !models.catalog().getOrDefault(args[3],List.of()).contains(args[4]) || !args[3].matches("[a-zA-Z0-9_/-]{1,96}") || !args[4].matches("[a-zA-Z0-9_.-]{1,96}")) { tell(source,"目标须在线，且模型/材质必须来自 /appearance list；含中文的模型由原 YSM 菜单选择。");return; }
                if(Freesia.registedWorkers.size()!=1) { tell(source,"模型 Worker 未就绪或数量异常；等待恢复后再试，玩家可继续游戏。");return; }
                String command="ysm model set "+target.getUsername()+" \""+args[3]+"\" "+args[4]+" true";
                Freesia.registedWorkers.values().iterator().next().dispatchCommandToWorker(command,feedback->{
                    if(feedback==null) {tell(source,"Worker 未确认；先查 /appearance status，勿当作成功。");return;}
                    tell(source,"MC_APPEARANCE_REQUESTED 已请求；以实际 Worker 状态为准。若提示玩家不存在，等待模型服务恢复后重试。");
                    source.sendMessage(Component.text("[YSM Worker] ").append(feedback));
                });
                return;
            }
            tell(source,"/appearance status 查看实际模型；/appearance list 查看已核对模型。客户端未装 YSM 仍可正常游戏。控制台：appearance admin set <在线玩家> <模型> <材质>。");
        }
    }
}
