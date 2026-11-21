package dev.god.godvoice;

import com.google.gson.*;
import de.maxhenkel.voicechat.api.*;
import de.maxhenkel.voicechat.api.events.*;
import de.maxhenkel.voicechat.api.audiochannel.AudioChannel;
import de.maxhenkel.voicechat.api.audiochannel.AudioPlayer;
import de.maxhenkel.voicechat.api.opus.*;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sound.sampled.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.messaging.PluginMessageListener;

/** Optional SVC transport. No model loop, player impersonation, public JSON or forced client mod. */
public final class PaperVoicePlugin extends JavaPlugin implements Listener,PluginMessageListener {
    public static final String CHANNEL="mcagent:voice";
    private static final UUID GODDESS=UUID.fromString("b2f9ceb0-8271-3470-b99f-e1c3ffe4edbd");
    private static final String GODDESS_VOICE="feiyu-tlm-changchun-cn-20261111";
    private static final java.util.regex.Pattern GODDESS_WHISPER=
        java.util.regex.Pattern.compile("^/minecraft:msg ([A-Za-z0-9_.-]{1,32}) (.{1,200})$");
    private final Gson gson=new Gson();
    private final Map<UUID,UUID> sessions=new HashMap<>();
    private final Set<UUID> eventCaptions=new HashSet<>();
    private final Map<UUID,SpeechLane<Job>> lanes=new HashMap<>();
    private final VoiceUploads uploads=new VoiceUploads();
    private final VoiceUploadTrace uploadTrace=new VoiceUploadTrace();
    private final VoiceSequences sequences=new VoiceSequences();
    private final NearbySpeechTurns turns = new NearbySpeechTurns();
    private final ConcurrentHashMap<UUID,Capture> captures=new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID,VoiceDelivery> deliveries=new ConcurrentHashMap<>();
    private volatile VoiceAudience.Snapshot snapshot=new VoiceAudience.Snapshot(0,Map.of());
    private volatile VoicechatServerApi api;
    private final Set<UUID> bridgePeers=new HashSet<>();
    private final VoicePresence presence=new VoicePresence(id->{VoicechatServerApi current=api;return current==null?null:current.getConnectionOf(id);});
    private volatile boolean stopping;
    private ExecutorService io,media,recognition;
    private ScheduledExecutorService captureClock;
    private VoiceLedger ledger;
    private NpcConversations npcs;
    private NpcSocial social;
    private YamlConfiguration profiles;
    private Path profileFile;
    private HttpClient http;
    private String backend,token;
    // Main-thread fence while the original finish is being durably reserved.
    private final Set<VoiceUploads.Key> finalizingUploads=new HashSet<>();
    private final AtomicInteger outstanding=new AtomicInteger();
    private int maximumSpeech,maximumSamples;
    private double distanceCap;

    private record PrivateRecipient(Player player, UUID session) {}
    private record VillagerReply(UUID listener, String event) {}

    private final class Job implements SpeechLane.Item {
        final UUID actor,session,request;final String fingerprint,text,voice;final byte[] audio;final long created=System.currentTimeMillis();
        final PrivateRecipient recipient;
        final Map<UUID,Player> audience;
        final double range;
        final VillagerReply villager;
        AudioPlayer player;SpeechFrames frames;OpusEncoder encoder;boolean cancelled;String cancelReason="PLAYBACK_INTERRUPTED";
        UUID channel;VoiceDelivery delivery;
        boolean waitingForTurn;
        Job(UUID a,UUID s,UUID r,String f,String t,String v,byte[] b,PrivateRecipient recipient,Map<UUID,Player> audience,double range,VillagerReply villager){
            actor=a;session=s;request=r;fingerprint=f;text=t;voice=v;audio=b;this.recipient=recipient;
            this.audience=audience;this.range=range;this.villager=villager;
        }
        public String id(){return request.toString();}public long createdAt(){return created;}
    }
    private static final class Capture {
        final UUID actor,session,request=UUID.randomUUID();final String name;final OpusDecoder decoder;
        final VoiceAudience.Window audience=new VoiceAudience.Window();
        final ByteArrayOutputStream pcm=new ByteArrayOutputStream();long last;boolean closed;
        final long startedAt=System.currentTimeMillis();final UUID originWorld;final double[] speakerBounds;double hearingRange=Double.POSITIVE_INFINITY;
        Capture(VoiceAudience.Actor actor,OpusDecoder decoder){this.actor=actor.id();session=actor.session();name=actor.name();this.decoder=decoder;originWorld=actor.world();speakerBounds=new double[]{actor.x(),actor.y(),actor.z(),actor.x(),actor.y(),actor.z()};}
    }

    @Override public void onEnable(){
        try{
            saveDefaultConfig();backend=getConfig().getString("backend","http://127.0.0.1:8857");
            URI endpoint=URI.create(backend);
            if(!"http".equals(endpoint.getScheme())||!"127.0.0.1".equals(endpoint.getHost())||endpoint.getUserInfo()!=null||endpoint.getQuery()!=null||endpoint.getFragment()!=null||!Set.of("","/").contains(endpoint.getPath()))throw new IllegalArgumentException("Backend must be exact loopback origin");
            backend="http://127.0.0.1:"+endpoint.getPort();
            Path secret=Path.of(getConfig().getString("backend-token-file","bridge.token"));if(!secret.isAbsolute())secret=getDataFolder().toPath().resolve(secret);
            token=Files.readString(secret).strip();if(token.length()<32||token.length()>128)throw new IllegalArgumentException("Private bridge token required");
            profileFile=getDataFolder().toPath().resolve("profiles.yml");profiles=YamlConfiguration.loadConfiguration(profileFile.toFile());
            ledger=new VoiceLedger(getDataFolder().toPath().resolve("receipts"));
            npcs=new NpcConversations(this,getDataFolder().toPath().resolve("npc-voices.json"));
            social=new NpcSocial(this,npcs);
            io=Executors.newSingleThreadExecutor(r->new Thread(r,"qiandeng-voice-ledger"));
            media=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32),r->new Thread(r,"qiandeng-voice-media"),new ThreadPoolExecutor.AbortPolicy());
            recognition=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(16),r->new Thread(r,"qiandeng-voice-asr"),new ThreadPoolExecutor.AbortPolicy());
            captureClock=Executors.newSingleThreadScheduledExecutor(r->new Thread(r,"qiandeng-voice-capture-clock"));
            http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
            maximumSpeech=Math.clamp(getConfig().getInt("max-concurrent-speech",16),1,32);
            maximumSamples=Math.clamp(getConfig().getInt("max-utterance-seconds",15),1,20)*48000;
            distanceCap=Math.clamp(getConfig().getDouble("caption-distance-cap",48),1,128);
            Bukkit.getPluginManager().registerEvents(this,this);
            Bukkit.getMessenger().registerIncomingPluginChannel(this,CHANNEL,this);Bukkit.getMessenger().registerOutgoingPluginChannel(this,CHANNEL);
            Objects.requireNonNull(getCommand("voice")).setExecutor(this::command);
            Objects.requireNonNull(getCommand("npcsocial")).setExecutor(social::command);
            Bukkit.getScheduler().runTaskTimer(this,this::snapshot,1,1);
            captureClock.scheduleAtFixedRate(this::expireCaptures,250,250,TimeUnit.MILLISECONDS);
            BukkitVoicechatService service=Bukkit.getServicesManager().load(BukkitVoicechatService.class);
            if(service==null)throw new IllegalStateException("SVC Bukkit API unavailable");
            service.registerPlugin(new VoicechatPlugin(){
                public String getPluginId(){return "qiandengji_voice";}
                public void registerEvents(EventRegistration registration){
                    registration.registerEvent(VoicechatServerStartedEvent.class,event->{api=event.getVoicechat();main(()->{for(Player player:Bukkit.getOnlinePlayers())syncPresence(player);});getLogger().info("SVC API ready; captions stay private and ASR stays on CPU");});
                    registration.registerEvent(VoicechatServerStoppedEvent.class,event->{api=null;closeCaptures();sequences.clear();turns.clear();main(()->{presence.close();for(UUID actor:new ArrayList<>(lanes.keySet()))cancelSpeech(actor,"VOICE_SERVER_STOPPED");});});
                    registration.registerEvent(MicrophonePacketEvent.class,PaperVoicePlugin.this::microphone);
                    registration.registerEvent(EntitySoundPacketEvent.class,PaperVoicePlugin.this::soundOffered,1000);
                    registration.registerEvent(StaticSoundPacketEvent.class,PaperVoicePlugin.this::soundOffered,1000);
                    registration.registerEvent(PlayerStateChangedEvent.class,event->{UUID actor=event.getPlayerUuid();if(event.isDisconnected()||event.isDisabled()){dropCapture(actor);sequences.remove(actor);}main(()->{Player player=Bukkit.getPlayer(actor);if(player!=null)syncPresence(player);});});
                }
            });
        }catch(Exception failure){getLogger().severe("Voice bridge not enabled: "+failure.getClass().getSimpleName()+"; check private backend configuration");Bukkit.getPluginManager().disablePlugin(this);}
    }
    private void main(Runnable action){if(!stopping)Bukkit.getScheduler().runTask(this,action);}
    private void syncPresence(Player player){
        boolean client=bridgePeers.contains(player.getUniqueId()) && player.getListeningPluginChannels().contains(CHANNEL);
        boolean hosted=npcs!=null && npcs.hostedReady(player) && player.hasPermission("voicechat.listen");
        if(api!=null && (client||hosted) && player.hasPermission("qiandeng.voice.use"))presence.attach(player.getUniqueId());
        else presence.detach(player.getUniqueId());
    }
    @EventHandler public void registered(PlayerRegisterChannelEvent event){
        if(!event.getChannel().equals(CHANNEL))return;Player original=event.getPlayer();
        main(()->{if(Bukkit.getPlayer(original.getUniqueId())==original)syncPresence(original);});
    }
    @EventHandler public void unregistered(PlayerUnregisterChannelEvent event){
        if(!event.getChannel().equals(CHANNEL))return;
        UUID actor=event.getPlayer().getUniqueId();bridgePeers.remove(actor);syncPresence(event.getPlayer());eventCaptions.remove(actor);
    }
    private void snapshot(){
        Map<UUID,VoiceAudience.Actor> all=new HashMap<>();
        for(Player p:Bukkit.getOnlinePlayers()){
            UUID session=sessions.computeIfAbsent(p.getUniqueId(),key->UUID.randomUUID());Location at=p.getLocation();
            all.put(p.getUniqueId(),new VoiceAudience.Actor(p.getUniqueId(),session,at.getWorld().getUID(),at.getX(),at.getY(),at.getZ(),p.getName(),profiles.getBoolean(p.getUniqueId()+".captions",getConfig().getBoolean("captions-default",true))));
        }
        if(npcs!=null)npcs.sample(all);
        if(npcs!=null && Bukkit.getCurrentTick()%20==0){
            for(var profile:npcs.profiles())if(profile.kind().equals("numen")){
                Player player=Bukkit.getPlayer(profile.id());
                if(player!=null)syncPresence(player);
            }
        }
        snapshot=new VoiceAudience.Snapshot(System.currentTimeMillis(),all);
        for(var lane:new ArrayList<>(lanes.values())){
            var current=lane.current();
            if(current!=null&&current.villager!=null&&!current.cancelled&&!live(current))
                cancelSpeech(current.actor,"VILLAGER_OR_LISTENER_UNAVAILABLE");
        }
        turns.update(snapshot, System.currentTimeMillis());
        uploads.expire(System.currentTimeMillis());
    }
    @EventHandler public void quit(PlayerQuitEvent event){
        if(npcs!=null)npcs.disconnected(event.getPlayer());
        UUID actor=event.getPlayer().getUniqueId();bridgePeers.remove(actor);presence.forget(actor);sessions.remove(actor);eventCaptions.remove(actor);uploads.disconnect(actor);dropCapture(actor);sequences.remove(actor);
        cancelSpeech(actor,"ACTOR_DISCONNECTED");
        turns.forget(actor);
    }
    @EventHandler public void worldChanged(PlayerChangedWorldEvent event){
        UUID actor=event.getPlayer().getUniqueId();uploads.disconnect(actor);dropCapture(actor);cancelSpeech(actor,"ACTOR_WORLD_CHANGED");
        turns.forget(actor);
    }
    private void cancelSpeech(UUID actor,String reason){
        SpeechLane<Job> lane=lanes.get(actor);if(lane==null)return;
        for(Job job:lane.removeWaiting(j->true)){job.cancelled=true;terminal(job,"cancelled",reason);outstanding.decrementAndGet();}
        Job active=lane.current();if(active!=null){active.cancelled=true;active.cancelReason=reason;if(active.frames!=null)active.frames.cancel();if(active.player!=null)active.player.stopPlaying();else finish(active,"cancelled",reason);}
    }
    private Entity source(Job job){
        if(job.villager==null)return job.session.equals(sessions.get(job.actor))?Bukkit.getPlayer(job.actor):null;
        return npcs.villagerListener(job.actor,job.villager.listener(),job.villager.event())==null?null:npcs.live(job.actor);
    }
    private boolean live(Job job){return !stopping&&!job.cancelled&&source(job)!=null;}
    private VoicechatConnection privateConnection(PrivateRecipient recipient){
        Player player=recipient.player();
        UUID id=player.getUniqueId();
        VoicechatServerApi current=api;
        if(current==null||Bukkit.getPlayer(id)!=player||!recipient.session().equals(sessions.get(id))
                ||!player.hasPermission("voicechat.listen"))return null;
        var connection=current.getConnectionOf(id);
        return connection!=null&&connection.isInstalled()&&connection.isConnected()&&!connection.isDisabled()
            &&connection.getPlayer().getPlayer()==player?connection:null;
    }

    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void goddessWhisper(PlayerCommandPreprocessEvent event){
        Player goddess=event.getPlayer();
        if(!GODDESS.equals(goddess.getUniqueId())||!goddess.isOp()||!goddess.hasPermission("minecraft.command.msg"))return;
        var command=GODDESS_WHISPER.matcher(event.getMessage());
        if(!command.matches())return;
        Player target=Bukkit.getPlayerExact(command.group(1));
        String voice=getConfig().getString("goddess-private-voice",GODDESS_VOICE);
        String body=command.group(2);
        if(target==null||target==goddess||!validVoice(voice)||body.isBlank()
                ||body.codePoints().anyMatch(c->Character.isISOControl(c)||c==0xa7))return;
        UUID session=sessions.get(target.getUniqueId());
        if(session==null)return;
        var recipient=new PrivateRecipient(target,session);
        if(privateConnection(recipient)==null)return;
        // Let the native private command finish. The audio job cannot cancel or replace its text.
        main(()->{
            if(Bukkit.getPlayer(GODDESS)!=goddess||!goddess.isOp()||privateConnection(recipient)==null)return;
            try {
                submit(goddess,UUID.randomUUID(),hash("private-tts\0"+target.getUniqueId()+"\0"+voice+"\0"+body),
                    body,voice,null,recipient);
            } catch(IllegalArgumentException ignored) {
                // The original text was already handled by Minecraft.
            }
        });
    }
    private void saveProfiles(Player original,Runnable committed){
        String document=profiles.saveToString();UUID actor=original.getUniqueId(),session=sessions.get(actor);
        io.execute(()->{try{
            Path temporary=profileFile.resolveSibling("profiles.yml.writing");Files.writeString(temporary,document,StandardCharsets.UTF_8);Files.move(temporary,profileFile,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
            main(()->{if(Objects.equals(session,sessions.get(actor))&&Bukkit.getPlayer(actor)==original)committed.run();});
        }catch(IOException failure){main(()->error(Bukkit.getPlayer(actor),"VOICE_PROFILE_NOT_SAVED_QUERY_BEFORE_RECONNECT"));}});
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void spokenChat(AsyncPlayerChatEvent event){
        Player original=event.getPlayer();String text=event.getMessage();
        main(()->{
            if(Bukkit.getPlayer(original.getUniqueId())!=original||!profiles.getBoolean(original.getUniqueId()+".auto-speak",false))return;
            try{submitText(original,UUID.randomUUID(),text,profiles.getString(original.getUniqueId()+".voice",""));}
            catch(IllegalArgumentException full){error(original,full.getMessage());}
        });
    }
    private boolean command(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof Player p)){
            if((sender instanceof ConsoleCommandSender||sender instanceof RemoteConsoleCommandSender)&&args.length>=2&&args.length<=3&&args[0].equalsIgnoreCase("status")){
                Player receiver=Bukkit.getPlayerExact(args[1]),speaker=args.length==3?Bukkit.getPlayerExact(args[2]):null;
                if(receiver==null||(args.length==3&&speaker==null))sender.sendMessage("VOICE_PLAYER_OFFLINE: /voice status <online receiver> [online speaker]");
                else connectionStatus(sender,receiver,speaker);
            }else sender.sendMessage("Read-only diagnostic: /voice status <online receiver> [online speaker]. Player requests remain owned by their connection.");
            return true;
        }
        try{
            String action=args.length==0?"help":args[0].toLowerCase(Locale.ROOT);
            switch(action){
                case "help"->p.sendMessage("[语音] 玩家用 Simple Voice Chat 客户端说话；首次使用需完成语音设置，麦克风可保持静音。/voice status 检查本人收听。Agent：/voice voices → /voice voice <音色ID> → /voice auto on，让本人公屏发言同时发声；也可 /voice say <短句>。/voice status <请求ID> 查结果；/voice captions off 关闭字幕。");
                case "auto"->{if(args.length!=2||!Set.of("on","off").contains(args[1]))throw new IllegalArgumentException("AUTO_ON_OR_OFF_REQUIRED");if(args[1].equals("on")&&profiles.getString(p.getUniqueId()+".voice","").isBlank())throw new IllegalArgumentException("VOICE_NOT_SELECTED");profiles.set(p.getUniqueId()+".auto-speak",args[1].equals("on"));saveProfiles(p,()->p.sendMessage("[语音] 本人公屏发言自动配音已"+(args[1].equals("on")?"开启":"关闭")+"；私聊和系统提示不会配音。"));}
                case "captions"->{if(args.length!=2||!Set.of("on","off").contains(args[1]))throw new IllegalArgumentException("CAPTIONS_ON_OR_OFF_REQUIRED");profiles.set(p.getUniqueId()+".captions",args[1].equals("on"));saveProfiles(p,()->p.sendMessage("[语音] 附近字幕已"+(args[1].equals("on")?"开启":"关闭")+"。"));}
                case "voices","voice"->{
                    String selected=action.equals("voice")&&args.length==2?args[1]:null;
                    if(action.equals("voices")&&args.length!=1)throw new IllegalArgumentException("USE_VOICE_VOICES_WITHOUT_ARGUMENTS");
                    if(action.equals("voice")&&(selected==null||!selected.matches("[A-Za-z0-9_.-]{1,96}")))throw new IllegalArgumentException("VOICE_ID_REQUIRED");
                    UUID actor=p.getUniqueId(),session=sessions.computeIfAbsent(actor,k->UUID.randomUUID());
                    media.execute(()->{try{JsonArray voices=jsonRequest("GET","/v1/voices",null,Map.of()).getAsJsonArray("voices");main(()->{
                        if(!session.equals(sessions.get(actor)))return;Player current=Bukkit.getPlayer(actor);if(current==null)return;
                        if(selected!=null){boolean found=false;for(var row:voices)if(row.getAsJsonObject().get("id").getAsString().equals(selected))found=true;
                            if(!found){error(current,"VOICE_NOT_FOUND");return;}profiles.set(actor+".voice",selected);saveProfiles(current,()->current.sendMessage("[语音] 已选音色 "+selected+"；下一步：/voice say 你好。"));
                        }else{List<String> names=new ArrayList<>();for(var row:voices)names.add(row.getAsJsonObject().get("id").getAsString());current.sendMessage("[语音] 音色："+String.join("、",names)+"。选择：/voice voice <ID>。");}
                    });}catch(Exception failure){main(()->error(Bukkit.getPlayer(actor),"VOICE_BACKEND_UNAVAILABLE"));}});
                }
                case "say"->{if(args.length<2)throw new IllegalArgumentException("TEXT_REQUIRED");submitText(p,UUID.randomUUID(),String.join(" ",Arrays.copyOfRange(args,1,args.length)),profiles.getString(p.getUniqueId()+".voice",""));}
                case "status"->{if(args.length==1){connectionStatus(p,p,null);break;}if(args.length!=2)throw new IllegalArgumentException("REQUEST_ID_REQUIRED");UUID id=UUID.fromString(args[1]);VoiceLedger.Entry row=ledger.get(p.getUniqueId(),id);reply(p,id,row==null?"not_found":row.state(),row==null?"":row.reason());}
                case "stop"->{cancelSpeech(p.getUniqueId(),"OWNER_CANCELLED");p.sendMessage("[语音] 已取消本人待播放语音；已发送的声音无法撤回。");}
                default->p.sendMessage("[语音] 未识别操作。下一步：/voice。");
            }
        }catch(Exception failure){error(p,failure instanceof IllegalArgumentException?failure.getMessage():"VOICE_REQUEST_FAILED");}
        return true;
    }
    private void connectionStatus(CommandSender recipient,Player receiver,Player speaker){
        VoicechatServerApi current=api;VoicechatConnection connection=current==null?null:current.getConnectionOf(receiver.getUniqueId());
        boolean installed=connection!=null&&connection.isInstalled(),connected=connection!=null&&connection.isConnected(),disabled=connection!=null&&connection.isDisabled();
        boolean isolated=connection!=null&&connection.isInGroup()&&connection.getGroup()!=null&&connection.getGroup().getType()==Group.Type.ISOLATED;
        boolean canListen=receiver.hasPermission("voicechat.listen");
        String code=presence.isConnected(receiver.getUniqueId())?"VOICE_BRIDGE_CONNECTED":VoiceDiagnostics.connection(current!=null,installed,connected,disabled,canListen,isolated);
        if(!installed && npcs!=null && npcs.profile(receiver.getUniqueId())!=null && npcs.live(receiver.getUniqueId())==receiver){
            code=current==null?"VOICE_SERVER_STARTING":!canListen?"VOICE_LISTEN_PERMISSION_MISSING":isolated?"VOICE_ISOLATED_GROUP":
                 npcs.hostedReady(receiver)&&presence.isConnected(receiver.getUniqueId())?"VOICE_HOSTED_NPC_READY":"VOICE_HOSTED_NPC_NOT_READY";
        }
        double range=current==null?distanceCap:Math.min(distanceCap,current.getVoiceChatDistance());
        var profile=npcs==null?null:npcs.profile(receiver.getUniqueId());
        if(profile!=null)range=Math.min(range,profile.range());
        recipient.sendMessage("[语音] "+receiver.getName()+" "+code+"；installed="+installed+", connected="+connected+", disabled="+disabled+", listen="+canListen+", isolatedGroup="+isolated+"；附近距离="+range+"。"+VoiceDiagnostics.hint(code));
        if(speaker!=null){
            boolean same=receiver.getWorld().equals(speaker.getWorld());
            double distance=same?receiver.getEyeLocation().distance(speaker.getEyeLocation()):Double.NaN;
            recipient.sendMessage("[语音位置] "+receiver.getName()+" → "+speaker.getName()+"；sameWorld="+same+"；distance="+(same?String.format(Locale.ROOT,"%.1f",distance):"different_world")+"；inRange="+(same&&distance<=range)+"。实体声音还需客户端实际加载声源；服务端无法代替耳听确认。");
        }
    }
    private void soundOffered(EntitySoundPacketEvent event){
        if(event.isCancelled()||!SoundPacketEvent.SOURCE_PLUGIN.equals(event.getSource())||event.getPacket().getOpusEncodedData().length==0)return;
        soundOffered(event.getPacket().getChannelId(),event.getReceiverConnection());
    }
    private void soundOffered(StaticSoundPacketEvent event){
        if(event.isCancelled()||!SoundPacketEvent.SOURCE_PLUGIN.equals(event.getSource())||event.getPacket().getOpusEncodedData().length==0)return;
        soundOffered(event.getPacket().getChannelId(),event.getReceiverConnection());
    }
    private void soundOffered(UUID channel, VoicechatConnection receiver){
        VoiceDelivery delivery=deliveries.get(channel);
        // SVC emits this before UDP send and permission checks. Count offers, never acknowledgements.
        if(delivery!=null&&receiver!=null&&receiver.isInstalled()&&receiver.isConnected()&&!receiver.isDisabled())delivery.offered(receiver.getPlayer().getUuid());
    }
    private static boolean validVoice(String voice){return voice!=null&&voice.matches("[A-Za-z0-9_.-]{1,96}");}
    /** Server-only bridge: exact registered body and owner, never a client-selected voice identity. */
    /** Publicly named companion bodies. Identity and original ownership are verified at lookup. */
    public Map<UUID,String> publicCompanionNames(){
        var result=new LinkedHashMap<UUID,String>();
        if(npcs!=null)for(var profile:npcs.profiles())if(profile.kind().equals("maid")
                && npcs.live(profile.id()) instanceof org.bukkit.entity.LivingEntity body && !body.isInvisible())
            result.put(profile.id(),profile.display());
        return Map.copyOf(result);
    }
    public String npcVoiceProfiles(){return npcs==null?"[]":npcs.catalogue().toString();}
    boolean naturalNpcDialogue(NpcDialoguePolicy.Profile profile,Player speaker,String text,String scope,Set<UUID> recipients,String medium){
        return social!=null&&social.natural(profile,speaker,text,scope,recipients,medium);
    }
    public boolean acceptNaturalMaidChat(Player speaker,String text,Set<UUID> recipients){
        return npcs!=null&&npcs.naturalMaidChat(speaker,text,recipients);
    }
    public String npcRelationship(UUID body, UUID speaker, boolean privateView) throws java.io.IOException {
        if (!Bukkit.isPrimaryThread() || social == null) return null;
        var row = social.view(body, speaker, privateView);
        return row == null ? null : row.toString();
    }
    public String queueNpcPrivateConversation(UUID body, UUID speakerId, String message) throws java.io.IOException {
        if (!Bukkit.isPrimaryThread() || social == null || body == null || speakerId == null)
            throw new IllegalArgumentException("npc_private_dialogue_unavailable");
        var speaker = Bukkit.getPlayer(speakerId);
        if (speaker == null) throw new IllegalArgumentException("npc_private_dialogue_unavailable");
        return social.queue(body, speaker, message, true).toString();
    }

    /**
     * Native server bridge for a signed or unsigned message already resolved to a specific recipient.
     * Returns null if the service is unavailable or the body has no registered Numen profile,
     * an empty string for a handled rejection, or the canonical request ID when accepted.
     * A storage error is a handled failure and must never fall back to a second recipient delivery.
     */
    public String queueHostedPrivateConversation(UUID body, UUID speakerId, String message) throws java.io.IOException {
        if (!Bukkit.isPrimaryThread() || !isEnabled() || npcs == null || social == null || body == null) return null;
        var profile = npcs.profile(body);
        if (profile == null || !profile.kind().equals("numen")) return null;
        try {
            return queueNpcPrivateConversation(body, speakerId, message);
        } catch (IllegalArgumentException denied) {
            return "";
        }
    }

    public boolean bindHostedNpcVoice(UUID actor,UUID owner,java.util.function.Function<String,Boolean> input){
        return Bukkit.isPrimaryThread()&&npcs!=null&&npcs.bind(actor,owner,input);
    }
    private boolean villagerBridge(Plugin caller){
        return Bukkit.isPrimaryThread()&&isEnabled()&&npcs!=null&&caller!=null&&caller.isEnabled()
                &&Bukkit.getPluginManager().getPlugin("qiandeng-villager-quests")==caller;
    }
    /** Registered bridge only. The inbox must enqueue and return immediately on the server thread. */
    public boolean bindVillagerNpcVoice(Plugin caller,UUID actor,java.util.function.Function<String,Boolean> inbox){
        return villagerBridge(caller)&&npcs.bindVillager(actor,inbox);
    }
    /** Speak only to the player who addressed this body in the original, still current turn. */
    public String speakVillagerReply(Plugin caller,UUID actor,UUID listener,String heardEventId,String text){
        if(!villagerBridge(caller))throw new IllegalArgumentException("VILLAGER_VOICE_BRIDGE_REQUIRED");
        return submitVillagerSpeech(actor,listener,heardEventId,text,false);
    }
    public boolean finishVillagerPrivateReply(Plugin caller,UUID actor,UUID listener,String event,String text) throws java.io.IOException {
        if(!villagerBridge(caller)||social==null)return false;
        return social.finishVillager(actor,listener,UUID.fromString(event),text);
    }
    private String submitVillagerSpeech(UUID actor,UUID listener,String heardEventId,String text,boolean direct){
        var profile=npcs.profile(actor);
        if(profile==null||profile.residentId()==null)throw new IllegalArgumentException("VILLAGER_VOICE_IDENTITY_MISMATCH");
        NpcDialoguePolicy.text(text);
        if(text.length()>200)throw new IllegalArgumentException("TEXT_REQUIRED_MAX_200");
        UUID request=NpcDialoguePolicy.speechId(actor,heardEventId);
        String fingerprint=hash((direct?"villager-private-tts\0":"villager-tts\0")+listener+"\0"+profile.voice()+"\0"+text);
        var old=ledger.get(actor,request);
        if(old!=null){
            if(!old.fingerprint().equals(fingerprint))throw new IllegalArgumentException("REQUEST_ID_REUSED");
            return npcSpeechStatus(actor,heardEventId);
        }
        var player=npcs.villagerListener(actor,listener,heardEventId);
        if(player==null||npcs.privateVillagerTurn(actor,listener,heardEventId)!=direct)throw new IllegalArgumentException("VILLAGER_VOICE_TURN_EXPIRED");
        var session=sessions.get(listener);
        if(session==null||privateConnection(new PrivateRecipient(player,session))==null)
            throw new IllegalArgumentException("VOICE_LISTENER_UNAVAILABLE");
        submit(new Job(actor,null,request,fingerprint,text,profile.voice(),null,direct?new PrivateRecipient(player,session):null,
                Map.of(listener,player),profile.range(),new VillagerReply(listener,heardEventId)));
        return "{\"state\":\"submitted\",\"requestId\":\""+request+"\",\"actualHearingVerified\":false}";
    }
    public void publishNpcSpeech(UUID actor,String original,String text,long occurredAt){
        if(Bukkit.isPrimaryThread()&&npcs!=null)npcs.said(actor,original,text,occurredAt);
    }
    public String speakHostedNpc(UUID actor,UUID owner,String original,String text,long occurredAt){
        if(!Bukkit.isPrimaryThread()||npcs==null)throw new IllegalStateException("NPC_VOICE_NOT_READY");
        var profile=npcs.profile(actor);
        if(profile==null||!profile.kind().equals("numen")||!profile.owner().equals(owner)||!(npcs.live(actor) instanceof Player player))throw new IllegalArgumentException("NPC_IDENTITY_MISMATCH");
        UUID request=NpcDialoguePolicy.speechId(actor,original);
        // Query the original result before age checks: a restart never creates a new speech request.
        var old=ledger.get(actor,request);
        if(old!=null){if(!old.fingerprint().equals(hash("tts\0"+profile.voice()+"\0"+text)))throw new IllegalArgumentException("REQUEST_ID_REUSED");return npcSpeechStatus(actor,original);}
        if(!NpcDialoguePolicy.fresh(occurredAt,System.currentTimeMillis()))return "{\"state\":\"skipped\",\"reason\":\"stale_speech\"}";
        NpcDialoguePolicy.text(text);
        npcs.said(actor,original,text,occurredAt);
        npcs.nearbySpokenText(player,profile,request,text);
        submitText(player,request,text,profile.voice(),profile.range());
        return "{\"state\":\"submitted\",\"requestId\":\""+request+"\",\"actualHearingVerified\":false}";
    }
    boolean wantsCaptions(Player player){
        return profiles.getBoolean(player.getUniqueId()+".captions",getConfig().getBoolean("captions-default",true));
    }
    public String npcSpeechStatus(UUID actor,String original){
        UUID request=NpcDialoguePolicy.speechId(actor,original);var row=ledger.get(actor,request);
        var result=new JsonObject();result.addProperty("requestId",request.toString());result.addProperty("state",row==null?"not_found":row.state());
        result.addProperty("reason",row==null?"":row.reason());result.addProperty("actualHearingVerified",false);
        if(row!=null&&row.delivery()!=null)result.add("delivery",gson.toJsonTree(row.delivery()));return result.toString();
    }
    private void submitText(Player p,UUID id,String text,String voice){
        submitText(p,id,text,voice,distanceCap);
    }
    private void submitText(Player p,UUID id,String text,String voice,double range){
        if(text==null||text.isBlank()||text.length()>200)throw new IllegalArgumentException("TEXT_REQUIRED_MAX_200");
        if(!validVoice(voice))throw new IllegalArgumentException("VOICE_NOT_SELECTED");
        submit(p,id,hash("tts\0"+voice+"\0"+text),text,voice,null,null,null,range);
    }
    private void submit(Player p,UUID id,String fingerprint,String text,String voice,byte[] audio){
        submit(p,id,fingerprint,text,voice,audio,null);
    }
    private void submit(Player p,UUID id,String fingerprint,String text,String voice,byte[] audio,PrivateRecipient recipient){
        submit(p,id,fingerprint,text,voice,audio,recipient,null,distanceCap);
    }
    boolean socialVoiceReady(NpcDialoguePolicy.Profile profile,Player requester){
        var session=sessions.get(requester.getUniqueId());
        if(session==null||privateConnection(new PrivateRecipient(requester,session))==null)return false;
        if(profile.residentId()!=null)
            return npcs.hostedReady(npcs.live(profile.id())) && validVoice(profile.voice());
        if(profile.kind().equals("numen"))
            return npcs.live(profile.id()) instanceof Player speaker && npcs.hostedReady(speaker) && validVoice(profile.voice());
        var bridge=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");
        if(bridge==null||!bridge.isEnabled())return false;
        try{
            return Boolean.TRUE.equals(bridge.getClass().getMethod("canRenderResidentReply",UUID.class,UUID.class,Player.class)
                .invoke(bridge,profile.id(),profile.owner(),requester));
        }catch(ReflectiveOperationException unavailable){return false;}
    }
    String speakSocialReply(NpcDialoguePolicy.Profile profile,UUID conversation,String reply,Player requester,
                            boolean privateDialogue,Map<UUID,Player> textAudience){
        if(profile.residentId()!=null){
            if(!privateDialogue || textAudience.size()!=1 || textAudience.get(requester.getUniqueId())!=requester)return null;
            submitVillagerSpeech(profile.id(),requester.getUniqueId(),conversation.toString(),reply,true);
            return NpcDialoguePolicy.speechId(profile.id(),conversation.toString()).toString();
        }
        if(profile.kind().equals("maid")){
            var bridge=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");
            if(bridge==null||!bridge.isEnabled())return null;
            try{
                return (String)bridge.getClass().getMethod("renderResidentReply",UUID.class,UUID.class,UUID.class,String.class,Set.class)
                    .invoke(bridge,profile.id(),profile.owner(),conversation,reply,Set.copyOf(textAudience.keySet()));
            }catch(ReflectiveOperationException unavailable){return null;}
        }
        if(!(npcs.live(profile.id()) instanceof Player speaker) || !npcs.hostedReady(speaker))return null;
        var listener=new PrivateRecipient(requester,sessions.get(requester.getUniqueId()));
        if(privateDialogue && (listener.session()==null || privateConnection(listener)==null))return null;
        // The social request is single-use. A private reply can never fall back to a nearby channel.
        var id=NpcDialoguePolicy.speechId(profile.id(),"social_"+conversation);
        var fingerprint=hash("social-tts\0"+conversation+"\0"+privateDialogue+"\0"+requester.getUniqueId()+"\0"+profile.voice()+"\0"+reply);
        submit(speaker,id,fingerprint,reply,profile.voice(),null,privateDialogue?listener:null,Map.copyOf(textAudience),profile.range());
        return id.toString();
    }
    private void submit(Player p,UUID id,String fingerprint,String text,String voice,byte[] audio,PrivateRecipient recipient,
                        Map<UUID,Player> audience,double range){
        UUID actor=p.getUniqueId(),session=sessions.computeIfAbsent(actor,k->UUID.randomUUID());
        submit(new Job(actor,session,id,fingerprint,text,voice,audio,recipient,audience,range,null));
    }
    private void submit(Job job){
        UUID actor=job.actor,id=job.request;
        VoiceLedger.Entry existing=ledger.get(actor,id);
        if(existing!=null){if(!existing.fingerprint().equals(job.fingerprint))throw new IllegalArgumentException("REQUEST_ID_REUSED");reply(Bukkit.getPlayer(actor),id,existing.state(),existing.reason());return;}
        if(api==null)throw new IllegalArgumentException("VOICE_SERVER_STARTING");
        if(outstanding.incrementAndGet()>maximumSpeech){outstanding.decrementAndGet();throw new IllegalArgumentException("VOICE_QUEUE_FULL");}
        io.execute(()->{
            try{
                boolean fresh=ledger.reserve(actor,id,job.fingerprint);
                main(()->{
                    finalizingUploads.remove(new VoiceUploads.Key(actor,id));
                    if(!fresh){outstanding.decrementAndGet();VoiceLedger.Entry row=ledger.get(actor,id);reply(Bukkit.getPlayer(actor),id,row.state(),row.reason());return;}
                    if(!live(job)){terminal(job,"cancelled","ACTOR_DISCONNECTED");outstanding.decrementAndGet();return;}
                    SpeechLane<Job> lane=lanes.computeIfAbsent(actor,k->new SpeechLane<>());
                    String result=lane.offer(job);
                    if(!result.equals("queued")){terminal(job,"failed","VOICE_QUEUE_FULL");outstanding.decrementAndGet();return;}
                    if(job.recipient==null)reply(Bukkit.getPlayer(actor),id,"queued","");
                    begin(actor);
                });
            }catch(Exception failure){outstanding.decrementAndGet();main(()->{finalizingUploads.remove(new VoiceUploads.Key(actor,id));reply(Bukkit.getPlayer(actor),id,"failed",failure instanceof IllegalArgumentException?failure.getMessage():"VOICE_RECEIPT_STORAGE_UNAVAILABLE");});}
        });
    }
    private void begin(UUID actor){
        SpeechLane<Job> lane=lanes.get(actor);if(lane==null||lane.current()!=null)return;Job job=lane.begin();if(job==null)return;
        if(job.recipient!=null&&privateConnection(job.recipient)==null){finish(job,"cancelled","PRIVATE_LISTENER_UNAVAILABLE");return;}
        media.execute(()->{
            String stage="prepare";
            try{
                byte[] wav;
                if(job.audio==null){JsonObject request=new JsonObject();request.addProperty("actor",job.actor.toString());request.addProperty("requestId",job.request.toString());request.addProperty("voice",job.voice);request.addProperty("text",job.text);wav=request("POST","/v1/tts",gson.toJson(request).getBytes(StandardCharsets.UTF_8),Map.of("Content-Type","application/json"));}
                else wav=request("POST","/v1/normalize",job.audio,Map.of("Content-Type","audio/wav"));
                stage="decode";short[] pcm=pcm(wav);
                main(()->awaitSpeechTurn(job,pcm));
            }catch(Exception failure){String reason=VoiceDiagnostics.preparationFailure(stage,failure);if(failure instanceof InterruptedException)Thread.currentThread().interrupt();getLogger().warning("Voice preparation failed: request="+job.request+" stage="+stage+" code="+reason);main(()->finish(job,"failed",reason));}
        });
    }
    /** Shared with the native maid playback through the Bukkit plugin API. */
    public boolean publicSpeechTurn(org.bukkit.entity.Entity body, UUID request, double range, boolean start) {
        if (!Bukkit.isPrimaryThread()) return false;
        long now=System.currentTimeMillis();
        if (!start) { turns.end(body.getUniqueId(),request,now); return true; }
        var at=body.getLocation();
        return turns.begin(body.getUniqueId(),request,new NearbySpeechTurns.Place(body.getWorld().getUID(),
                at.getX(),at.getY(),at.getZ(),range),now);
    }
    private void awaitSpeechTurn(Job job,short[] pcm) {
        var lane=lanes.get(job.actor);
        if (lane==null || lane.current()!=job) return;
        if (!live(job) || api==null) { finish(job,"cancelled","ACTOR_OR_VOICE_SESSION_CHANGED"); return; }
        if (!takeTurnOrWait(job,pcm)) return;
        io.execute(()->{try{ledger.transition(job.actor,job.request,job.fingerprint,"playing","");main(()->play(job,pcm));}
            catch(IOException failure){main(()->finish(job,"failed","VOICE_RECEIPT_STORAGE_UNAVAILABLE"));}});
    }
    private boolean takeTurnOrWait(Job job,short[] pcm) {
        Entity speaker=source(job);
        if(speaker==null){finish(job,"cancelled","ACTOR_OR_VOICE_SESSION_CHANGED");return false;}
        if (job.recipient==null && !publicSpeechTurn(speaker,job.request,Math.min(job.range,Math.min(distanceCap,api.getVoiceChatDistance())),true)) {
            if (!job.waitingForTurn) {
                job.waitingForTurn=true;
                reply(Bukkit.getPlayer(job.actor),job.request,"queued","WAITING_FOR_NEARBY_SPEAKER");
                io.execute(()->{try{ledger.transition(job.actor,job.request,job.fingerprint,"queued","WAITING_FOR_NEARBY_SPEAKER");}
                    catch(IOException error){main(()->finish(job,"failed","VOICE_RECEIPT_STORAGE_UNAVAILABLE"));}});
            }
            Bukkit.getScheduler().runTaskLater(this,()->awaitSpeechTurn(job,pcm),3L);
            return false;
        }
        job.waitingForTurn=false;
        return true;
    }
    private void play(Job job,short[] pcm){
        var lane=lanes.get(job.actor);if(lane==null||lane.current()!=job)return;
        if(!live(job)||api==null){finish(job,"cancelled","ACTOR_OR_VOICE_SESSION_CHANGED");return;}
        // A real microphone may have opened while the playback receipt was being flushed.
        if(!takeTurnOrWait(job,pcm))return;
        try{
            Entity speaker=source(job);job.channel=UUID.randomUUID();
            AudioChannel channel;
            if(job.recipient==null){
                var nearby=api.createEntityAudioChannel(job.channel,api.fromEntity(speaker));
                if(nearby==null)throw new IllegalStateException("No entity audio channel");
                nearby.setDistance((float)Math.min(job.range,Math.min(distanceCap,api.getVoiceChatDistance())));
                if(npcs!=null && npcs.configured(job.actor))nearby.setFilter(listener->{
                    if(job.audience!=null && job.audience.get(listener.getUuid())!=listener.getPlayer())return false;
                    var actors=snapshot.actors();
                    var speakerPosition=actors.get(job.actor);var observer=actors.get(listener.getUuid());
                    if(speakerPosition==null || observer==null || !speakerPosition.world().equals(observer.world()))return false;
                    double dx=speakerPosition.x()-observer.x(),dy=speakerPosition.y()-observer.y(),dz=speakerPosition.z()-observer.z();
                    return dx*dx+dy*dy+dz*dz<=job.range*job.range;
                });
                channel=nearby;
            }else{
                var connection=privateConnection(job.recipient);
                if(connection==null){finish(job,"cancelled","PRIVATE_LISTENER_UNAVAILABLE");return;}
                var direct=api.createStaticAudioChannel(job.channel);
                if(direct==null)throw new IllegalStateException("No private audio channel");
                direct.addTarget(connection);
                direct.setFilter(listener->listener.getPlayer()==job.recipient.player());
                channel=direct;
            }
            job.delivery=new VoiceDelivery();deliveries.put(job.channel,job.delivery);
            job.frames=new SpeechFrames(pcm);job.encoder=api.createEncoder();job.player=api.createAudioPlayer(channel,job.encoder,job.frames);
            job.player.setOnStopped(()->{try{job.encoder.close();}finally{main(()->finish(job,job.frames.completed()&&!job.cancelled?"sent":"cancelled",job.frames.completed()&&!job.cancelled?VoiceDelivery.completionReason(job.delivery.summary()):job.cancelReason));}});
            job.player.startPlaying();if(job.recipient==null)reply(Bukkit.getPlayer(job.actor),job.request,"playing","");
        }catch(Exception failure){if(job.encoder!=null)job.encoder.close();finish(job,"failed","VOICE_PLAYBACK_UNAVAILABLE");}
    }
    private void finish(Job job,String state,String reason){
        SpeechLane<Job> lane=lanes.get(job.actor);if(lane==null||lane.current()!=job)return;
        turns.end(job.actor,job.request,System.currentTimeMillis());
        if(job.channel!=null)deliveries.remove(job.channel);
        lane.finish(job);terminal(job,state,reason);outstanding.decrementAndGet();begin(job.actor);
    }
    private void terminal(Job job,String state,String reason){
        VoiceDelivery.Summary delivery=job.delivery==null?null:job.delivery.summary();
        io.execute(()->{try{ledger.transition(job.actor,job.request,job.fingerprint,state,reason,delivery);main(()->{if(job.villager==null&&job.recipient==null&&job.session.equals(sessions.get(job.actor)))reply(Bukkit.getPlayer(job.actor),job.request,state,reason);});}catch(IOException failure){main(()->error(Bukkit.getPlayer(job.actor),"VOICE_RESULT_UNKNOWN_DO_NOT_REPLAY"));}});
    }
    private byte[] request(String method,String route,byte[] body,Map<String,String> headers)throws Exception{
        var builder=HttpRequest.newBuilder(URI.create(backend+route)).timeout(Duration.ofSeconds(route.equals("/v1/tts")?100:30)).header("Authorization","Bearer "+token);
        headers.forEach(builder::header);builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofByteArray(body));
        var response=http.send(builder.build(),HttpResponse.BodyHandlers.ofInputStream());
        try(var input=response.body()){
            int status=response.statusCode();
            if(status!=200)throw new VoiceDiagnostics.BackendFailure(switch(status){case 401,403->"VOICE_MEDIA_AUTH_REJECTED";case 429,503->"VOICE_MEDIA_BUSY";case 400,413,422->"VOICE_AUDIO_INPUT_REJECTED";default->"VOICE_AUDIO_PREPARATION_FAILED";});
            byte[] bytes=input.readNBytes(VoiceUploads.MAX_BYTES+1);if(bytes.length>VoiceUploads.MAX_BYTES)throw new VoiceDiagnostics.BackendFailure("VOICE_AUDIO_TOO_LARGE");return bytes;
        }
    }
    private JsonObject jsonRequest(String method,String route,byte[] body,Map<String,String> headers)throws Exception{return JsonParser.parseString(new String(request(method,route,body,headers),StandardCharsets.UTF_8)).getAsJsonObject();}
    private static short[] pcm(byte[] wav)throws Exception{
        try(AudioInputStream stream=AudioSystem.getAudioInputStream(new ByteArrayInputStream(wav))){
            AudioFormat format=stream.getFormat();if(format.getSampleRate()!=48000||format.getChannels()!=1||format.getSampleSizeInBits()!=16||format.isBigEndian()||!format.getEncoding().equals(AudioFormat.Encoding.PCM_SIGNED))throw new IOException("NORMALIZED_PCM_REQUIRED");
            byte[] data=stream.readNBytes(48000*2*30+2);if(data.length==0||data.length>48000*2*30||data.length%2!=0)throw new IOException("AUDIO_DURATION_INVALID");short[] result=new short[data.length/2];ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(result);return result;
        }
    }
    private static byte[] wav(byte[] pcm)throws IOException{
        ByteArrayOutputStream out=new ByteArrayOutputStream();try(AudioInputStream stream=new AudioInputStream(new ByteArrayInputStream(pcm),new AudioFormat(48000,16,1,true,false),pcm.length/2)){AudioSystem.write(stream,AudioFileFormat.Type.WAVE,out);}return out.toByteArray();
    }
    private void microphone(MicrophonePacketEvent event){
        VoicechatServerApi current=api;var sender=event.getSenderConnection();if(stopping||event.isCancelled()||current==null||sender==null||sender.isDisabled())return;
        UUID id=sender.getPlayer().getUuid();var receiver=event.getReceiverConnection();if(receiver!=null&&!receiver.getPlayer().getUuid().equals(id))return;
        var observed=snapshot;var actor=observed.actors().get(id);long now=System.currentTimeMillis();if(actor==null)return;
        long sequence=event.getPacket().toStaticSoundPacket().getSequenceNumber();if(!sequences.observe(id,actor.session(),sequence))return;
        var group=sender.getGroup();
        if(group!=null && !Group.Type.OPEN.equals(group.getType())){dropCapture(id);return;}
        byte[] opus=event.getPacket().getOpusEncodedData();
        if(opus.length>4096){dropCapture(id);return;}
        double distance=event.getPacket().isWhispering()?current.getServerConfig().getDouble("whisper_distance",24):current.getVoiceChatDistance();
        turns.microphone(id,actor.session(),new NearbySpeechTurns.Place(actor.world(),actor.x(),actor.y(),actor.z(),
                Math.min(distance,distanceCap)),opus.length==0,now);
        // Open group audio is audible nearby. Captions still require an ungrouped, fresh audience.
        if(group!=null){dropCapture(id);return;}
        if(now-observed.at()>200)return;
        Capture capture=captures.get(id);
        if(capture==null){if(captures.size()>=16)return;Capture next=new Capture(actor,current.createDecoder());Capture old=captures.putIfAbsent(id,next);if(old!=null){next.decoder.close();capture=old;}else capture=next;}
        synchronized(capture){
            if(capture.closed||!capture.session.equals(actor.session())){dropCapture(id);return;}
            if(opus.length==0){flush(capture);return;}
            try{
                short[] decoded=capture.decoder.decode(opus);if(decoded.length>5760){dropCapture(id);return;}
                if(!capture.originWorld.equals(actor.world())){dropCapture(id);return;}
                capture.hearingRange=Math.min(capture.hearingRange,Math.min(distance,distanceCap));
                double[] point={actor.x(),actor.y(),actor.z()};for(int i=0;i<3;i++){capture.speakerBounds[i]=Math.min(capture.speakerBounds[i],point[i]);capture.speakerBounds[i+3]=Math.max(capture.speakerBounds[i+3],point[i]);}
                capture.audience.observe(observed,id,Math.min(distance,distanceCap),now);
                for(short sample:decoded){capture.pcm.write(sample&255);capture.pcm.write((sample>>>8)&255);}capture.last=now;
                if(capture.pcm.size()/2>=maximumSamples)flush(capture);
            }catch(Exception invalid){dropCapture(id);}
        }
    }
    private void expireCaptures(){long now=System.currentTimeMillis();for(Capture capture:captures.values())synchronized(capture){if(!capture.closed&&capture.last>0&&now-capture.last>=800)flush(capture);}}
    private void flush(Capture capture){
        if(capture.closed)return;capture.closed=true;captures.remove(capture.actor,capture);capture.decoder.close();
        byte[] pcm=capture.pcm.toByteArray();var listeners=capture.audience.finish();UUID world=capture.audience.world();
        if(pcm.length<48000/5*2||listeners.isEmpty()||world==null)return;
        try{recognition.execute(()->{
            try{
                JsonObject result=jsonRequest("POST","/v1/asr",wav(pcm),Map.of("Content-Type","audio/wav","X-Actor",capture.actor.toString(),"X-Request-Id",capture.request.toString()));
                String text=result.get("text").getAsString().replaceAll("[\\p{Cntrl}§]"," ").strip();if(text.isEmpty())return;
                main(()->{Set<UUID> audience=VoiceAudience.deliverable(listeners,world,snapshot);for(UUID id:audience){Player target=Bukkit.getPlayer(id);if(target==null)continue;
                    JsonObject row=new JsonObject();row.addProperty("type","nearby_voice");row.addProperty("speaker",capture.name);row.addProperty("speakerUuid",capture.actor.toString());row.addProperty("utteranceId",capture.request.toString());row.addProperty("text",text);
                    // System text, not Player.chat(): ASR must not run commands,
                    // become a global shout or trigger chat-to-TTS a second time.
                    if(eventCaptions.contains(id)&&target.getListeningPluginChannels().contains(CHANNEL))send(target,row);else target.sendMessage("[附近][语音识别] "+capture.name+"："+text);
                }maidHeard(capture,text,audience);});
            }catch(Exception failure){getLogger().warning("ASR segment unavailable; no replay ("+failure.getClass().getSimpleName()+")");}
        });}catch(RejectedExecutionException busy){getLogger().warning("ASR queue full; segment dropped without blocking the server");}
    }
    private void maidHeard(Capture capture,String text,Set<UUID> audience){
        if(!capture.session.equals(sessions.get(capture.actor)))return;
        Player speaker=Bukkit.getPlayer(capture.actor);if(speaker==null||!speaker.getWorld().getUID().equals(capture.originWorld))return;
        boolean residents=npcs!=null&&npcs.enabled();
        if(residents&&npcs.voice(capture.actor,capture.originWorld,capture.request,capture.startedAt,text,audience))return;
        var maid=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");if(maid==null||!maid.isEnabled())return;
        String method=residents?"acceptPersonalNearbyVoice":"acceptNearbyVoice";
        try{maid.getClass().getMethod(method,UUID.class,UUID.class,UUID.class,long.class,long.class,double[].class,double.class,String.class,Set.class)
            .invoke(maid,capture.actor,capture.originWorld,capture.request,capture.startedAt,capture.last,capture.speakerBounds.clone(),capture.hearingRange,text,audience);}
        catch(NoSuchMethodException oldBridge){/* Optional integration; ordinary nearby captions remain available. */}
        catch(ReflectiveOperationException failure){getLogger().warning("Maid speech delivery unavailable; original ASR retained without replay");}
    }
    private void dropCapture(UUID id){Capture capture=captures.remove(id);if(capture!=null)synchronized(capture){if(!capture.closed){capture.closed=true;capture.decoder.close();}}}
    private void closeCaptures(){for(UUID id:captures.keySet())dropCapture(id);}
    @Override public void onPluginMessageReceived(String channel,Player p,byte[] message){
        if(stopping||!channel.equals(CHANNEL)||message.length<2)return;
        UUID requestId=null,session=null;VoiceUploads.Snapshot chunkBefore=null;
        try{
            UUID actor=p.getUniqueId();session=sessions.computeIfAbsent(actor,key->UUID.randomUUID());
            if(message[0]==2){
                if(message.length<17)throw new IllegalArgumentException("UPLOAD_CHUNK_INVALID");
                ByteBuffer buffer=ByteBuffer.wrap(message,1,message.length-1);UUID id=new UUID(buffer.getLong(),buffer.getLong());requestId=id;var key=new VoiceUploads.Key(actor,id);
                chunkBefore=uploads.snapshot(key,session,System.currentTimeMillis());
                if(finalizingUploads.contains(key))return;
                // A delayed/duplicate frame cannot downgrade a queued or completed
                // transmission. The connection still owns the ledger lookup.
                VoiceLedger.Entry old=ledger.get(actor,id);if(old!=null){reply(p,id,old.state(),old.reason());return;}
                if(message.length<22||message.length>21+VoiceUploads.CHUNK){uploads.discard(key,session);throw new IllegalArgumentException("UPLOAD_CHUNK_INVALID");}
                int sequence=buffer.getInt();byte[] data=new byte[buffer.remaining()];buffer.get(data);
                try{uploads.chunk(key,session,sequence,data,System.currentTimeMillis());}
                catch(IllegalArgumentException failure){
                    uploads.discard(key,session);throw failure;
                }
                return;
            }
            if(message[0]!=1||message.length>8193)throw new IllegalArgumentException("VOICE_PROTOCOL_INVALID");
            JsonObject data=JsonParser.parseString(new String(message,1,message.length-1,StandardCharsets.UTF_8)).getAsJsonObject();
            if(data.has("actor")||data.has("playerUuid"))throw new IllegalArgumentException("CONNECTION_OWNS_ACTOR");
            UUID id=UUID.fromString(data.get("requestId").getAsString());requestId=id;String op=data.get("op").getAsString();var key=new VoiceUploads.Key(actor,id);
            switch(op){
                case "subscribe"->{if(data.has("captions")&&data.get("captions").getAsString().equals("events"))eventCaptions.add(actor);else eventCaptions.remove(actor);reply(p,id,"subscribed","");}
                case "say"->submitText(p,id,data.get("text").getAsString(),data.has("voice")?data.get("voice").getAsString():profiles.getString(actor+".voice",""));
                case "status"->{VoiceLedger.Entry row=ledger.get(actor,id);reply(p,id,row==null?"not_found":row.state(),row==null?"":row.reason());}
                case "begin"->{String format=data.get("format").getAsString();if(!format.equals("wav"))throw new IllegalArgumentException("UPLOAD_PCM16_WAV_REQUIRED");int bytes=data.get("bytes").getAsInt();String digest=data.get("sha256").getAsString();if(data.get("bytes").getAsDouble()!=bytes||bytes<1||bytes>VoiceUploads.MAX_BYTES||!digest.matches("[0-9a-f]{64}"))throw new IllegalArgumentException("UPLOAD_SIZE_OR_DIGEST_INVALID");VoiceLedger.Entry old=ledger.get(actor,id);if(old!=null){if(!old.fingerprint().equals(hash("wav\0"+digest)))throw new IllegalArgumentException("REQUEST_ID_REUSED");reply(p,id,old.state(),old.reason());break;}reply(p,id,uploads.begin(key,session,bytes,digest,format,System.currentTimeMillis()),"");}
                case "finish"->{if(finalizingUploads.contains(key))break;VoiceLedger.Entry old=ledger.get(actor,id);if(old!=null){reply(p,id,old.state(),old.reason());break;}var audio=uploads.finish(key,session,System.currentTimeMillis());finalizingUploads.add(key);try{submit(p,id,hash("wav\0"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(audio.bytes()))),null,null,audio.bytes());}catch(Exception failure){finalizingUploads.remove(key);throw failure;}}
                default->throw new IllegalArgumentException("VOICE_OPERATION_UNKNOWN");
            }
            // A proxy may register CHANNEL for every vanilla client. Require a
            // valid adapter request before advertising a bridge connection.
            bridgePeers.add(actor);syncPresence(p);
        }catch(Exception failure){String code=failure instanceof IllegalArgumentException?failure.getMessage():"VOICE_PROTOCOL_INVALID";
            if(message[0]==2){var diagnostic=uploadTrace.rejection(p.getUniqueId(),session,requestId,message,chunkBefore,code,p.getListeningPluginChannels().contains(CHANNEL),Bukkit.getPlayer(p.getUniqueId())==p,System.currentTimeMillis());if(diagnostic!=null)getLogger().warning("VOICE_UPLOAD_REJECT "+gson.toJson(diagnostic));}
            if(requestId!=null)reply(p,requestId,"failed",code==null?"VOICE_PROTOCOL_INVALID":code.replaceAll("[^A-Za-z0-9_]",""));else error(p,code);}
    }
    private void reply(Player p,UUID request,String state,String reason){
        if(p!=null&&npcs!=null&&npcs.live(p.getUniqueId())==p)return; // Internal receipt, not a new NPC chat input.
        if(p==null)return;JsonObject row=new JsonObject();row.addProperty("type","voice_result");row.addProperty("requestId",request.toString());row.addProperty("state",state);row.addProperty("reason",reason);
        row.addProperty("actualHearingVerified",false);
        VoiceLedger.Entry receipt=ledger.get(p.getUniqueId(),request);
        if(receipt!=null&&receipt.state().equals(state)&&receipt.delivery()!=null)row.add("delivery",gson.toJsonTree(receipt.delivery()));
        if(!reason.isEmpty())row.addProperty("nextStep",VoiceDiagnostics.hint(reason));
        if(p.getListeningPluginChannels().contains(CHANNEL)){send(p,row);return;}
        if(state.equals("playing"))return;
        p.sendMessage("[语音] "+state+(reason.isEmpty()?"":"（"+reason+"）"+VoiceDiagnostics.hint(reason))+"。查询：/voice status "+request);
    }
    private void send(Player p,JsonObject row){byte[] data=gson.toJson(row).getBytes(StandardCharsets.UTF_8);if(data.length>16_000)return;byte[] payload=new byte[data.length+1];payload[0]=1;System.arraycopy(data,0,payload,1,data.length);p.sendPluginMessage(this,CHANNEL,payload);}
    private void error(Player p,String code){if(p!=null)p.sendMessage("[语音] "+(code==null?"VOICE_REQUEST_FAILED":code.replaceAll("[^A-Za-z0-9_]",""))+"。音色用 /voice voices；结果未知先查原请求，不重复发送。");}
    private static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}}
    @Override public void onDisable(){
        presence.close();stopping=true;closeCaptures();
        for(var lane:lanes.values()){Job job=lane.current();if(job!=null){job.cancelled=true;if(job.frames!=null)job.frames.cancel();if(job.player!=null)job.player.stopPlaying();}}
        if(captureClock!=null)captureClock.shutdownNow();if(media!=null)media.shutdownNow();if(recognition!=null)recognition.shutdownNow();if(io!=null)io.shutdown();
    }
}
