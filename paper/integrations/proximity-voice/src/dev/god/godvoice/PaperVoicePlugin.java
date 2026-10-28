package dev.god.godvoice;

import com.google.gson.*;
import de.maxhenkel.voicechat.api.*;
import de.maxhenkel.voicechat.api.events.*;
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
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.messaging.PluginMessageListener;

/** Optional SVC transport. No model loop, player impersonation, public JSON or forced client mod. */
public final class PaperVoicePlugin extends JavaPlugin implements Listener,PluginMessageListener {
    public static final String CHANNEL="mcagent:voice";
    private final Gson gson=new Gson();
    private final Map<UUID,UUID> sessions=new HashMap<>();
    private final Set<UUID> eventCaptions=new HashSet<>();
    private final Map<UUID,SpeechLane<Job>> lanes=new HashMap<>();
    private final VoiceUploads uploads=new VoiceUploads();
    private final VoiceSequences sequences=new VoiceSequences();
    private final ConcurrentHashMap<UUID,Capture> captures=new ConcurrentHashMap<>();
    private volatile VoiceAudience.Snapshot snapshot=new VoiceAudience.Snapshot(0,Map.of());
    private volatile VoicechatServerApi api;
    private volatile boolean stopping;
    private ExecutorService io,media,recognition;
    private ScheduledExecutorService captureClock;
    private VoiceLedger ledger;
    private YamlConfiguration profiles;
    private Path profileFile;
    private HttpClient http;
    private String backend,token;
    private final AtomicInteger outstanding=new AtomicInteger();
    private int maximumSpeech,maximumSamples;
    private double distanceCap;

    private final class Job implements SpeechLane.Item {
        final UUID actor,session,request;final String fingerprint,text,voice;final byte[] audio;final long created=System.currentTimeMillis();
        AudioPlayer player;SpeechFrames frames;OpusEncoder encoder;boolean cancelled;String cancelReason="PLAYBACK_INTERRUPTED";
        Job(UUID a,UUID s,UUID r,String f,String t,String v,byte[] b){actor=a;session=s;request=r;fingerprint=f;text=t;voice=v;audio=b;}
        public String id(){return request.toString();}public long createdAt(){return created;}
    }
    private static final class Capture {
        final UUID actor,session,request=UUID.randomUUID();final String name;final OpusDecoder decoder;
        final VoiceAudience.Window audience=new VoiceAudience.Window();
        final ByteArrayOutputStream pcm=new ByteArrayOutputStream();long last;boolean closed;
        Capture(VoiceAudience.Actor actor,OpusDecoder decoder){this.actor=actor.id();session=actor.session();name=actor.name();this.decoder=decoder;}
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
            Bukkit.getScheduler().runTaskTimer(this,this::snapshot,1,1);
            captureClock.scheduleAtFixedRate(this::expireCaptures,250,250,TimeUnit.MILLISECONDS);
            BukkitVoicechatService service=Bukkit.getServicesManager().load(BukkitVoicechatService.class);
            if(service==null)throw new IllegalStateException("SVC Bukkit API unavailable");
            service.registerPlugin(new VoicechatPlugin(){
                public String getPluginId(){return "qiandengji_voice";}
                public void registerEvents(EventRegistration registration){
                    registration.registerEvent(VoicechatServerStartedEvent.class,event->{api=event.getVoicechat();getLogger().info("SVC API ready; captions stay private and ASR stays on CPU");});
                    registration.registerEvent(VoicechatServerStoppedEvent.class,event->{api=null;closeCaptures();sequences.clear();main(()->{for(UUID actor:new ArrayList<>(lanes.keySet()))cancelSpeech(actor,"VOICE_SERVER_STOPPED");});});
                    registration.registerEvent(MicrophonePacketEvent.class,PaperVoicePlugin.this::microphone);
                    registration.registerEvent(PlayerStateChangedEvent.class,event->{if(event.isDisconnected()||event.isDisabled()){dropCapture(event.getPlayerUuid());sequences.remove(event.getPlayerUuid());}});
                }
            });
        }catch(Exception failure){getLogger().severe("Voice bridge not enabled: "+failure.getClass().getSimpleName()+"; check private backend configuration");Bukkit.getPluginManager().disablePlugin(this);}
    }
    private void main(Runnable action){if(!stopping)Bukkit.getScheduler().runTask(this,action);}
    private void snapshot(){
        Map<UUID,VoiceAudience.Actor> all=new HashMap<>();
        for(Player p:Bukkit.getOnlinePlayers()){
            UUID session=sessions.computeIfAbsent(p.getUniqueId(),key->UUID.randomUUID());Location at=p.getLocation();
            all.put(p.getUniqueId(),new VoiceAudience.Actor(p.getUniqueId(),session,at.getWorld().getUID(),at.getX(),at.getY(),at.getZ(),p.getName(),profiles.getBoolean(p.getUniqueId()+".captions",getConfig().getBoolean("captions-default",true))));
        }
        snapshot=new VoiceAudience.Snapshot(System.currentTimeMillis(),all);
        uploads.expire(System.currentTimeMillis());
    }
    @EventHandler public void quit(PlayerQuitEvent event){
        UUID actor=event.getPlayer().getUniqueId();sessions.remove(actor);eventCaptions.remove(actor);uploads.disconnect(actor);dropCapture(actor);sequences.remove(actor);
        cancelSpeech(actor,"ACTOR_DISCONNECTED");
    }
    @EventHandler public void worldChanged(PlayerChangedWorldEvent event){
        UUID actor=event.getPlayer().getUniqueId();uploads.disconnect(actor);dropCapture(actor);cancelSpeech(actor,"ACTOR_WORLD_CHANGED");
    }
    private void cancelSpeech(UUID actor,String reason){
        SpeechLane<Job> lane=lanes.get(actor);if(lane==null)return;
        for(Job job:lane.removeWaiting(j->true)){job.cancelled=true;terminal(job,"cancelled",reason);outstanding.decrementAndGet();}
        Job active=lane.current();if(active!=null){active.cancelled=true;active.cancelReason=reason;if(active.frames!=null)active.frames.cancel();if(active.player!=null)active.player.stopPlaying();else finish(active,"cancelled",reason);}
    }
    private boolean live(Job job){return !stopping&&!job.cancelled&&job.session.equals(sessions.get(job.actor))&&Bukkit.getPlayer(job.actor)!=null;}
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
        if(!(sender instanceof Player p)){sender.sendMessage("Use the authenticated player's /voice command.");return true;}
        try{
            String action=args.length==0?"help":args[0].toLowerCase(Locale.ROOT);
            switch(action){
                case "help"->p.sendMessage("[语音] 玩家用 Simple Voice Chat 客户端说话；附近角色收到字幕。Agent：/voice voices → /voice voice <音色ID> → /voice auto on，让本人公屏发言同时发声；也可 /voice say <短句>。/voice status <请求ID> 查结果；/voice captions off 关闭字幕。");
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
                case "status"->{if(args.length!=2)throw new IllegalArgumentException("REQUEST_ID_REQUIRED");UUID id=UUID.fromString(args[1]);VoiceLedger.Entry row=ledger.get(p.getUniqueId(),id);reply(p,id,row==null?"not_found":row.state(),row==null?"":row.reason());}
                case "stop"->{cancelSpeech(p.getUniqueId(),"OWNER_CANCELLED");p.sendMessage("[语音] 已取消本人待播放语音；已发送的声音无法撤回。");}
                default->p.sendMessage("[语音] 未识别操作。下一步：/voice。");
            }
        }catch(Exception failure){error(p,failure instanceof IllegalArgumentException?failure.getMessage():"VOICE_REQUEST_FAILED");}
        return true;
    }
    private void submitText(Player p,UUID id,String text,String voice){
        if(text==null||text.isBlank()||text.length()>200)throw new IllegalArgumentException("TEXT_REQUIRED_MAX_200");
        if(voice==null||!voice.matches("[A-Za-z0-9_.-]{1,96}"))throw new IllegalArgumentException("VOICE_NOT_SELECTED");
        submit(p,id,hash("tts\0"+voice+"\0"+text),text,voice,null);
    }
    private void submit(Player p,UUID id,String fingerprint,String text,String voice,byte[] audio){
        VoiceLedger.Entry existing=ledger.get(p.getUniqueId(),id);
        if(existing!=null){if(!existing.fingerprint().equals(fingerprint))throw new IllegalArgumentException("REQUEST_ID_REUSED");reply(p,id,existing.state(),existing.reason());return;}
        if(api==null)throw new IllegalArgumentException("VOICE_SERVER_STARTING");
        if(outstanding.incrementAndGet()>maximumSpeech){outstanding.decrementAndGet();throw new IllegalArgumentException("VOICE_QUEUE_FULL");}
        UUID actor=p.getUniqueId(),session=sessions.computeIfAbsent(actor,k->UUID.randomUUID());
        Job job=new Job(actor,session,id,fingerprint,text,voice,audio);
        io.execute(()->{
            try{
                boolean fresh=ledger.reserve(actor,id,fingerprint);
                main(()->{
                    if(!fresh){outstanding.decrementAndGet();VoiceLedger.Entry row=ledger.get(actor,id);reply(Bukkit.getPlayer(actor),id,row.state(),row.reason());return;}
                    if(!live(job)){terminal(job,"cancelled","ACTOR_DISCONNECTED");outstanding.decrementAndGet();return;}
                    SpeechLane<Job> lane=lanes.computeIfAbsent(actor,k->new SpeechLane<>());
                    String result=lane.offer(job);
                    if(!result.equals("queued")){terminal(job,"failed","VOICE_QUEUE_FULL");outstanding.decrementAndGet();return;}
                    reply(Bukkit.getPlayer(actor),id,"queued","");begin(actor);
                });
            }catch(Exception failure){outstanding.decrementAndGet();main(()->error(Bukkit.getPlayer(actor),failure instanceof IllegalArgumentException?failure.getMessage():"VOICE_RECEIPT_STORAGE_UNAVAILABLE"));}
        });
    }
    private void begin(UUID actor){
        SpeechLane<Job> lane=lanes.get(actor);if(lane==null||lane.current()!=null)return;Job job=lane.begin();if(job==null)return;
        media.execute(()->{
            try{
                byte[] wav;
                if(job.audio==null){JsonObject request=new JsonObject();request.addProperty("actor",job.actor.toString());request.addProperty("requestId",job.request.toString());request.addProperty("voice",job.voice);request.addProperty("text",job.text);wav=request("POST","/v1/tts",gson.toJson(request).getBytes(StandardCharsets.UTF_8),Map.of("Content-Type","application/json"));}
                else wav=request("POST","/v1/normalize",job.audio,Map.of("Content-Type","audio/wav"));
                short[] pcm=pcm(wav);
                io.execute(()->{try{ledger.transition(job.actor,job.request,job.fingerprint,"playing","");main(()->play(job,pcm));}
                    catch(IOException failure){main(()->finish(job,"failed","VOICE_RECEIPT_STORAGE_UNAVAILABLE"));}});
            }catch(Exception failure){main(()->finish(job,"failed","VOICE_AUDIO_UNAVAILABLE_QUERY_STATUS"));}
        });
    }
    private void play(Job job,short[] pcm){
        if(!live(job)||api==null){finish(job,"cancelled","ACTOR_OR_VOICE_SESSION_CHANGED");return;}
        try{
            Player source=Bukkit.getPlayer(job.actor);var channel=api.createEntityAudioChannel(UUID.randomUUID(),api.fromEntity(source));
            if(channel==null)throw new IllegalStateException("No entity audio channel");
            channel.setDistance((float)Math.min(distanceCap,api.getVoiceChatDistance()));
            job.frames=new SpeechFrames(pcm);job.encoder=api.createEncoder();job.player=api.createAudioPlayer(channel,job.encoder,job.frames);
            job.player.setOnStopped(()->{try{job.encoder.close();}finally{main(()->finish(job,job.frames.completed()&&!job.cancelled?"sent":"cancelled",job.frames.completed()&&!job.cancelled?"":job.cancelReason));}});
            job.player.startPlaying();reply(source,job.request,"playing","");
        }catch(Exception failure){if(job.encoder!=null)job.encoder.close();finish(job,"failed","VOICE_PLAYBACK_UNAVAILABLE");}
    }
    private void finish(Job job,String state,String reason){
        SpeechLane<Job> lane=lanes.get(job.actor);if(lane==null||lane.current()!=job)return;
        lane.finish(job);terminal(job,state,reason);outstanding.decrementAndGet();begin(job.actor);
    }
    private void terminal(Job job,String state,String reason){
        io.execute(()->{try{ledger.transition(job.actor,job.request,job.fingerprint,state,reason);main(()->{if(job.session.equals(sessions.get(job.actor)))reply(Bukkit.getPlayer(job.actor),job.request,state,reason);});}catch(IOException failure){main(()->error(Bukkit.getPlayer(job.actor),"VOICE_RESULT_UNKNOWN_DO_NOT_REPLAY"));}});
    }
    private byte[] request(String method,String route,byte[] body,Map<String,String> headers)throws Exception{
        var builder=HttpRequest.newBuilder(URI.create(backend+route)).timeout(Duration.ofSeconds(route.equals("/v1/tts")?100:30)).header("Authorization","Bearer "+token);
        headers.forEach(builder::header);builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofByteArray(body));
        var response=http.send(builder.build(),HttpResponse.BodyHandlers.ofInputStream());
        try(var input=response.body()){byte[] bytes=input.readNBytes(VoiceUploads.MAX_BYTES+1);if(bytes.length>VoiceUploads.MAX_BYTES||response.statusCode()!=200)throw new IOException("VOICE_BACKEND_REJECTED");return bytes;}
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
        VoicechatServerApi current=api;var sender=event.getSenderConnection();if(stopping||current==null||sender==null||sender.isDisabled())return;
        UUID id=sender.getPlayer().getUuid();var receiver=event.getReceiverConnection();if(receiver!=null&&!receiver.getPlayer().getUuid().equals(id))return;
        var observed=snapshot;var actor=observed.actors().get(id);long now=System.currentTimeMillis();if(actor==null||now-observed.at()>200)return;
        long sequence=event.getPacket().toStaticSoundPacket().getSequenceNumber();if(!sequences.observe(id,actor.session(),sequence))return;
        if(sender.isInGroup()){dropCapture(id);return;}
        Capture capture=captures.get(id);
        if(capture==null){if(captures.size()>=16)return;Capture next=new Capture(actor,current.createDecoder());Capture old=captures.putIfAbsent(id,next);if(old!=null){next.decoder.close();capture=old;}else capture=next;}
        synchronized(capture){
            if(capture.closed||!capture.session.equals(actor.session())){dropCapture(id);return;}
            byte[] opus=event.getPacket().getOpusEncodedData();if(opus.length==0){flush(capture);return;}if(opus.length>4096){dropCapture(id);return;}
            try{
                short[] decoded=capture.decoder.decode(opus);if(decoded.length>5760){dropCapture(id);return;}
                double distance=event.getPacket().isWhispering()?current.getServerConfig().getDouble("whisper_distance",24):current.getVoiceChatDistance();
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
                main(()->{for(UUID id:VoiceAudience.deliverable(listeners,world,snapshot)){Player target=Bukkit.getPlayer(id);if(target==null)continue;
                    JsonObject row=new JsonObject();row.addProperty("type","nearby_voice");row.addProperty("speaker",capture.name);row.addProperty("speakerUuid",capture.actor.toString());row.addProperty("utteranceId",capture.request.toString());row.addProperty("text",text);
                    if(eventCaptions.contains(id)&&target.getListeningPluginChannels().contains(CHANNEL))send(target,row);else target.sendMessage("[附近语音] "+capture.name+"："+text);
                }});
            }catch(Exception failure){getLogger().warning("ASR segment unavailable; no replay ("+failure.getClass().getSimpleName()+")");}
        });}catch(RejectedExecutionException busy){getLogger().warning("ASR queue full; segment dropped without blocking the server");}
    }
    private void dropCapture(UUID id){Capture capture=captures.remove(id);if(capture!=null)synchronized(capture){if(!capture.closed){capture.closed=true;capture.decoder.close();}}}
    private void closeCaptures(){for(UUID id:captures.keySet())dropCapture(id);}
    @Override public void onPluginMessageReceived(String channel,Player p,byte[] message){
        if(stopping||!channel.equals(CHANNEL)||message.length<2)return;
        UUID requestId=null;
        try{
            UUID actor=p.getUniqueId(),session=sessions.computeIfAbsent(actor,key->UUID.randomUUID());
            if(message[0]==2){if(message.length<22||message.length>21+VoiceUploads.CHUNK)throw new IllegalArgumentException("UPLOAD_CHUNK_INVALID");ByteBuffer buffer=ByteBuffer.wrap(message,1,message.length-1);UUID id=new UUID(buffer.getLong(),buffer.getLong());int sequence=buffer.getInt();byte[] data=new byte[buffer.remaining()];buffer.get(data);uploads.chunk(new VoiceUploads.Key(actor,id),session,sequence,data,System.currentTimeMillis());return;}
            if(message[0]!=1||message.length>8193)throw new IllegalArgumentException("VOICE_PROTOCOL_INVALID");
            JsonObject data=JsonParser.parseString(new String(message,1,message.length-1,StandardCharsets.UTF_8)).getAsJsonObject();
            if(data.has("actor")||data.has("playerUuid"))throw new IllegalArgumentException("CONNECTION_OWNS_ACTOR");
            UUID id=UUID.fromString(data.get("requestId").getAsString());requestId=id;String op=data.get("op").getAsString();var key=new VoiceUploads.Key(actor,id);
            switch(op){
                case "subscribe"->{if(data.has("captions")&&data.get("captions").getAsString().equals("events"))eventCaptions.add(actor);else eventCaptions.remove(actor);reply(p,id,"subscribed","");}
                case "say"->submitText(p,id,data.get("text").getAsString(),data.has("voice")?data.get("voice").getAsString():profiles.getString(actor+".voice",""));
                case "status"->{VoiceLedger.Entry row=ledger.get(actor,id);reply(p,id,row==null?"not_found":row.state(),row==null?"":row.reason());}
                case "begin"->{String format=data.get("format").getAsString();if(!format.equals("wav"))throw new IllegalArgumentException("UPLOAD_PCM16_WAV_REQUIRED");int bytes=data.get("bytes").getAsInt();String digest=data.get("sha256").getAsString();if(data.get("bytes").getAsDouble()!=bytes||bytes<1||bytes>VoiceUploads.MAX_BYTES||!digest.matches("[0-9a-f]{64}"))throw new IllegalArgumentException("UPLOAD_SIZE_OR_DIGEST_INVALID");VoiceLedger.Entry old=ledger.get(actor,id);if(old!=null){if(!old.fingerprint().equals(hash("wav\0"+digest)))throw new IllegalArgumentException("REQUEST_ID_REUSED");reply(p,id,old.state(),old.reason());return;}reply(p,id,uploads.begin(key,session,bytes,digest,format,System.currentTimeMillis()),"");}
                case "finish"->{var audio=uploads.finish(key,session,System.currentTimeMillis());submit(p,id,hash("wav\0"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(audio.bytes()))),null,null,audio.bytes());}
                default->throw new IllegalArgumentException("VOICE_OPERATION_UNKNOWN");
            }
        }catch(Exception failure){String code=failure instanceof IllegalArgumentException?failure.getMessage():"VOICE_PROTOCOL_INVALID";if(requestId!=null)reply(p,requestId,"failed",code==null?"VOICE_PROTOCOL_INVALID":code.replaceAll("[^A-Za-z0-9_]",""));else error(p,code);}
    }
    private void reply(Player p,UUID request,String state,String reason){
        if(p==null)return;JsonObject row=new JsonObject();row.addProperty("type","voice_result");row.addProperty("requestId",request.toString());row.addProperty("state",state);row.addProperty("reason",reason);
        if(p.getListeningPluginChannels().contains(CHANNEL)){send(p,row);return;}
        if(state.equals("playing")||state.equals("sent"))return;
        p.sendMessage("[语音] "+state+(reason.isEmpty()?"":"（"+reason+"）")+"。查询：/voice status "+request);
    }
    private void send(Player p,JsonObject row){byte[] data=gson.toJson(row).getBytes(StandardCharsets.UTF_8);if(data.length>16_000)return;byte[] payload=new byte[data.length+1];payload[0]=1;System.arraycopy(data,0,payload,1,data.length);p.sendPluginMessage(this,CHANNEL,payload);}
    private void error(Player p,String code){if(p!=null)p.sendMessage("[语音] "+(code==null?"VOICE_REQUEST_FAILED":code.replaceAll("[^A-Za-z0-9_]",""))+"。音色用 /voice voices；结果未知先查原请求，不重复发送。");}
    private static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}}
    @Override public void onDisable(){
        stopping=true;closeCaptures();
        for(var lane:lanes.values()){Job job=lane.current();if(job!=null){job.cancelled=true;if(job.frames!=null)job.frames.cancel();if(job.player!=null)job.player.stopPlaying();}}
        if(captureClock!=null)captureClock.shutdownNow();if(media!=null)media.shutdownNow();if(recognition!=null)recognition.shutdownNow();if(io!=null)io.shutdown();
    }
}
