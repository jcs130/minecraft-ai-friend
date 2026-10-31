package org.afuhome.appearance;

import com.google.gson.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.messaging.PluginMessageListener;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Appearance only: original bodies, native selection handler and existing Minecraft channels. */
public final class NativeAppearance extends JavaPlugin implements Listener,PluginMessageListener {
    private static final String CHANNEL="mcagent:appearance", ASSETS="mcagent:ysm_asset";
    private static final Gson JSON=new Gson();
    private final String epoch=UUID.randomUUID().toString();
    private final NativeYsm nativeYsm=new NativeYsm();
    private final SelfAppearance selections=new SelfAppearance();
    private final Map<UUID,Map<String,Object>> states=new LinkedHashMap<>();
    private final Map<UUID,String> sent=new HashMap<>();
    private final Map<UUID,Long> refreshed=new HashMap<>(),requested=new HashMap<>();
    private final Map<UUID,Transfer> transfers=new HashMap<>();
    private ModelCatalog models;
    private AutomaticAppearance automatic;
    private BedrockProjection projection;
    private String requestedRevision="";
    private long modelReloaded;
    private String diagnostic="";
    private record Transfer(ModelCatalog.Asset asset,String request,int index) {}

    @Override public void onEnable() {
        try {
            Files.createDirectories(getDataFolder().toPath());
            Path config=getDataFolder().toPath().resolve("models.json");
            if(!Files.exists(config))Files.writeString(config,JSON.toJson(Map.of(
                "publicModelRoot",getServer().getWorldContainer().toPath().toAbsolutePath().resolve("config/yes_steve_model/custom").normalize().toString(),
                "automaticAssignment",Map.of("enabled",false,"models",List.of(Map.of("model","qd_frieren","texture","texture")),"excludedUuids",List.of())))+"\n");
            models=new ModelCatalog(config,NativeYsm.VERSION);automatic=new AutomaticAppearance(config);projection=new BedrockProjection(config);
            getServer().getPluginManager().registerEvents(this,this);
            getServer().getMessenger().registerIncomingPluginChannel(this,ASSETS,this);
            getServer().getMessenger().registerOutgoingPluginChannel(this,CHANNEL);
            getServer().getMessenger().registerOutgoingPluginChannel(this,ASSETS);
            Objects.requireNonNull(getCommand("appearance")).setExecutor(this);
            getServer().getScheduler().runTaskTimerAsynchronously(this,()->{
                try{
                    models.scan();automatic.reload();String revision=models.revision();long now=System.currentTimeMillis();
                    if(!revision.isEmpty()&&!revision.equals(requestedRevision)&&now-modelReloaded>=30000&&isEnabled()){
                        requestedRevision=revision;modelReloaded=now;
                        getServer().getScheduler().runTask(this,()->getServer().dispatchCommand(getServer().getConsoleSender(),"ysm model reload"));
                    }
                }catch(Exception unavailable){models.invalidate();}
            },1,100);
            getServer().getScheduler().runTaskTimer(this,this::poll,20,20);
            getServer().getScheduler().runTaskTimer(this,this::transfer,2,2);
        }catch(Exception unavailable){getLogger().severe("Native appearance configuration unavailable; gameplay authentication is unchanged.");getServer().getPluginManager().disablePlugin(this);}
    }
    @Override public void onDisable(){states.clear();sent.clear();transfers.clear();getServer().getMessenger().unregisterIncomingPluginChannel(this);getServer().getMessenger().unregisterOutgoingPluginChannel(this);}
    @EventHandler public void quit(PlayerQuitEvent event){
        UUID id=event.getPlayer().getUniqueId();states.remove(id);sent.remove(id);refreshed.remove(id);transfers.remove(id);requested.remove(id);selections.left(id);automatic.left(id);
        byte[] bytes=JSON.toJson(Map.of("schemaVersion",1,"source",NativeYsm.SOURCE,"type","remove","epoch",epoch,"playerUuid",id.toString())).getBytes(StandardCharsets.UTF_8);
        for(Player recipient:getServer().getOnlinePlayers())if(recipient.getListeningPluginChannels().contains(CHANNEL))recipient.sendPluginMessage(this,CHANNEL,bytes);
    }
    private Collection<Player> actors(){
        Map<UUID,Player> players=new LinkedHashMap<>();
        for(Player player:getServer().getOnlinePlayers())players.put(player.getUniqueId(),player);
        for(World world:getServer().getWorlds())for(Player player:world.getEntitiesByClass(Player.class))if(player.isValid()&&!player.hasMetadata("NPC"))players.putIfAbsent(player.getUniqueId(),player);
        return players.values().stream().limit(40).toList();
    }
    private Map<String,Object> row(Player player,NativeYsm.State value){
        Map<String,Object> row=new LinkedHashMap<>();row.put("schemaVersion",1);row.put("type","state");row.put("source",NativeYsm.SOURCE);row.put("epoch",epoch);
        row.put("playerUuid",player.getUniqueId().toString());row.put("playerName",player.getName());
        row.put("ysmVersion",NativeYsm.VERSION);row.put("protocolVersion",NativeYsm.PROTOCOL);row.put("jarSha256",NativeYsm.JAR_SHA);
        row.put("available",value!=null&&!value.disabled());
        if(value==null){row.put("reason",nativeYsm.reason());row.put("stateStatus","unsupported");row.put("message","原生YSM状态尚未确认；请稍后查询，未改变外观。");}
        else if(value.disabled()){row.put("reason","YSM_MODEL_DISABLED");row.put("stateStatus","unsupported");row.put("message","原生YSM外观已停用，当前使用普通皮肤。");}
        else {
            row.put("entityId",player.getEntityId());row.put("modelId",value.model());row.put("texture",value.texture());row.put("mandatory",value.mandatory());row.put("animation","");row.put("stateStatus","confirmed");
            ModelCatalog.Asset asset=models.get(value.model());boolean web=asset!=null&&asset.available()&&asset.textures().contains(value.texture());row.put("webAvailable",web);
            if(web){row.put("assetSha256",asset.sha256());row.put("assetBytes",asset.gzip().length);row.put("message","原生模型与公开网页资源已确认。");}
            else {row.put("webReason",asset==null?"YSM_SOURCE_NOT_REGISTERED":asset.reason()==null?"YSM_TEXTURE_NOT_REGISTERED":asset.reason());row.put("message","原生模型已确认；网页需要可公开的原始模型资源，加密原包暂仅原生客户端显示。");}
        }
        return row;
    }
    private void tell(Player player,String text){player.sendMessage("[外观] "+text);}
    private void apply(Player player,NativeYsm.State state,SelfAppearance.Selection selection){
        try{nativeYsm.select(player,state,selection.model(),selection.texture());}
        catch(Exception unavailable){automatic.unknown(player.getUniqueId());tell(player,"原生服务未确认这次换装；请 /appearance status 查询，未重复提交。仍可正常游戏。");}
    }
    private void poll(){
        Collection<Player> actors=actors();
        Set<UUID> current=new HashSet<>();Map<UUID,NativeYsm.State> observed=new HashMap<>();
        for(Player player:actors){
            current.add(player.getUniqueId());var value=nativeYsm.read(player);observed.put(player.getUniqueId(),value);states.put(player.getUniqueId(),row(player,value));
            if(value==null&&!nativeYsm.diagnostic().equals(diagnostic)){diagnostic=nativeYsm.diagnostic();getLogger().warning("Native appearance unavailable: "+diagnostic);}
        }
        states.keySet().retainAll(current);
        for(Player player:actors){
            UUID id=player.getUniqueId();var value=observed.get(id);if(value==null)continue;
            boolean ready=player.isValid()&&!player.isDead();
            String message=selections.observe(id,value.body(),0,ready,value.model(),value.texture(),System.currentTimeMillis());if(message!=null)tell(player,message);
            if(value.disabled())continue;
            boolean observer=player.getGameMode()==GameMode.SPECTATOR;
            boolean tracked=!Set.of("unassigned","excluded").contains(automatic.status(id).get("phase"));
            if(player.hasMetadata("NPC")||observer&&!tracked)continue;
            try {
                var action=automatic.tick(id,value.body(),0,id.toString(),ready,1,value.model(),value.texture(),nativeYsm.catalog(player),states.values(),selections,System.currentTimeMillis());
                if(action!=null){tell(player,action.message());if(action.selection()!=null)apply(player,value,action.selection());}
            }catch(Exception unavailable){/* Missing native catalog is not a default appearance. */}
        }
        long now=System.currentTimeMillis();
        StringBuilder revision=new StringBuilder();for(var entry:states.entrySet())revision.append(entry.getKey()).append(JSON.toJson(entry.getValue()));
        String serial=revision.toString();
        for(Player recipient:getServer().getOnlinePlayers()){
            if(!recipient.getListeningPluginChannels().contains(CHANNEL))continue;
            UUID id=recipient.getUniqueId();
            if(serial.equals(sent.get(id))&&now-refreshed.getOrDefault(id,0L)<5000)continue;
            for(var row:states.values()){byte[] bytes=JSON.toJson(row).getBytes(StandardCharsets.UTF_8);if(bytes.length<=2048)recipient.sendPluginMessage(this,CHANNEL,bytes);}
            sent.put(id,serial);refreshed.put(id,now);
        }
        try{projection.write(epoch,states.values(),NativeYsm.SOURCE);}catch(Exception unavailable){/* Optional private projection cannot change the actual body. */}
    }
    private boolean mayRead(Player recipient,String id){
        for(Player actor:actors()){
            var row=states.get(actor.getUniqueId());if(row!=null&&Boolean.TRUE.equals(row.get("available"))&&id.equals(row.get("modelId"))&&recipient.getWorld().equals(actor.getWorld())&&recipient.canSee(actor))return true;
        }return false;
    }
    @Override public void onPluginMessageReceived(String channel,Player player,byte[] bytes){
        if(!channel.equals(ASSETS)||bytes.length>512)return;
        try {
            var request=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
            String id=request.get("modelId").getAsString(),sha=request.get("sha256").getAsString(),token=request.get("requestId").getAsString();
            if(!"get".equals(request.get("type").getAsString())||!token.matches("[a-f0-9]{32}")||!ModelCatalog.validId(id))return;
            long now=System.currentTimeMillis();UUID owner=player.getUniqueId();if(now-requested.getOrDefault(owner,0L)<500||transfers.containsKey(owner))return;
            requested.put(owner,now);var asset=models.get(id);
            if(asset==null||!asset.available()||!asset.sha256().equals(sha)||!mayRead(player,id))return;
            transfers.put(owner,new Transfer(asset,token,0));
        }catch(RuntimeException invalid){/* Ignore malformed client requests. */}
    }
    private void transfer(){
        for(var entry:new ArrayList<>(transfers.entrySet())){
            Player player=getServer().getPlayer(entry.getKey());Transfer transfer=entry.getValue();
            if(player==null||!player.isOnline()||models.get(transfer.asset.id())!=transfer.asset||!mayRead(player,transfer.asset.id())){transfers.remove(entry.getKey());continue;}
            byte[] data=transfer.asset.gzip();int count=(data.length+12287)/12288,index=transfer.index,end=Math.min(count,index+2);
            for(;index<end;index++){
                var row=Map.of("schemaVersion",1,"type","chunk","requestId",transfer.request,"sha256",transfer.asset.sha256(),"index",index,"count",count,"bytes",data.length,"data",Base64.getEncoder().encodeToString(Arrays.copyOfRange(data,index*12288,Math.min(data.length,(index+1)*12288))));
                player.sendPluginMessage(this,ASSETS,JSON.toJson(row).getBytes(StandardCharsets.UTF_8));
            }
            if(index==count)transfers.remove(entry.getKey());else transfers.put(entry.getKey(),new Transfer(transfer.asset,transfer.request,index));
        }
    }
    @Override public boolean onCommand(CommandSender source,Command command,String label,String[] args){
        if(!(source instanceof Player player)){
            if(args.length==5&&args[0].equals("admin")&&args[1].equals("set")
                    &&(source instanceof ConsoleCommandSender||source instanceof RemoteConsoleCommandSender)){
                var targets=actors().stream().filter(actor->actor.getName().equals(args[2])||actor.getUniqueId().toString().equals(args[2])).toList();
                if(targets.size()!=1){source.sendMessage("目标须在线且唯一；重名时请指定UUID，未换装。");return true;}
                Player target=targets.getFirst();var state=nativeYsm.read(target);
                try{
                    if(state==null||!nativeYsm.catalog(target).getOrDefault(args[3],List.of()).contains(args[4]))throw new IllegalArgumentException();
                    automatic.manual(target.getUniqueId(),args[3],args[4],System.currentTimeMillis());
                    nativeYsm.select(target,state,args[3],args[4]);source.sendMessage("MC_APPEARANCE_REQUESTED 原生请求已提交，以实际模型读回为准。");
                }catch(Exception unavailable){source.sendMessage("原生状态或模型授权未确认；请查询实际模型，未绕过原生规则。");}
                return true;
            }
            source.sendMessage("AgentAppearanceNative 0.4.0；原生YSM2.6.5；实际模型见角色 /appearance status。");return true;
        }
        if(!player.isOnline()){tell(player,"请先完成游戏登录并进入世界。");return true;}
        if(args.length==1&&args[0].equals("status")){
            var value=nativeYsm.read(player);var row=row(player,value);tell(player,(String)row.get("message"));
            if(value!=null)tell(player,"当前："+value.model()+" / "+value.texture()+"；自选用 /appearance list，再 /appearance set <模型> [贴图]。");
            player.sendMessage("MC_APPEARANCE_STATUS "+JSON.toJson(row));player.sendMessage("MC_APPEARANCE_ASSIGNMENT "+JSON.toJson(automatic.status(player.getUniqueId())));return true;
        }
        if(args.length>=1&&args[0].equals("list")){
            try{
                int page=args.length==2?Integer.parseInt(args[1]):1;if(args.length>2||page<1||page>512)throw new IllegalArgumentException();
                var choices=new ArrayList<>(nativeYsm.catalog(player).entrySet());int begin=(page-1)*10;
                tell(player,"原生可选模型 第"+page+"/"+Math.max(1,(choices.size()+9)/10)+"页；加密原包仅原生客户端显示。");
                if(begin>=choices.size())tell(player,"这一页没有模型；用 /appearance list 1 返回。");
                for(int i=begin;i<Math.min(begin+10,choices.size());i++){var item=choices.get(i);tell(player,item.getKey()+" ："+String.join(", ",item.getValue()));}
                if(begin+10<choices.size())tell(player,"下一页 /appearance list "+(page+1));
            }catch(Exception unavailable){tell(player,"目录未就绪或页码无效；稍后 /appearance list 1，未换装。");}return true;
        }
        if(args.length>=1&&args[0].equals("set")){
            var value=nativeYsm.read(player);if(value==null){tell(player,"原生YSM状态未确认；稍后 /appearance status，未换装。");return true;}
            try{
                var result=selections.begin(player.getUniqueId(),value.body(),0,player.getUniqueId().toString(),true,1,nativeYsm.catalog(player),args,System.currentTimeMillis());
                tell(player,result.message());if(result.selection()!=null){automatic.manual(player.getUniqueId(),result.selection().model(),result.selection().texture(),System.currentTimeMillis());apply(player,value,result.selection());}
            }catch(Exception unavailable){tell(player,"原生目录暂不可用；稍后查询，未更换外观。");}return true;
        }
        tell(player,"/appearance status 看本人；/appearance list [页码] 选模型；/appearance set <模型> [贴图] 换本人。普通皮肤继续 /skin。");return true;
    }
}
