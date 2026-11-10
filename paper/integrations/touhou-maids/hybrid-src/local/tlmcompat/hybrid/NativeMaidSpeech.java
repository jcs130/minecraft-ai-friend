package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.*;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.response.ResponseChat;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import de.maxhenkel.voicechat.api.*;
import de.maxhenkel.voicechat.api.audiochannel.AudioPlayer;
import de.maxhenkel.voicechat.api.audiochannel.LocationalAudioChannel;
import de.maxhenkel.voicechat.api.events.*;
import de.maxhenkel.voicechat.api.opus.OpusEncoder;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sound.sampled.*;
import local.tlmcompat.qiandengji.ReceiptJournal;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** One configured native companion, one existing media service, no new model loop. */
final class NativeMaidSpeech implements AutoCloseable {
    private final HybridMaidPlugin plugin;
    private final UUID maidId,ownerId;
    private final String backend,token,voice;
    private final ReceiptJournal receipts;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final ExecutorService worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(2),r->new Thread(r,"maid-voice-media"),new ThreadPoolExecutor.AbortPolicy());
    private final Set<LLMMessage> seen=Collections.newSetFromMap(new IdentityHashMap<>());
    private final LinkedHashMap<String,short[]> ambientCache=new LinkedHashMap<>();
    private final AutoCloseable soundHook;
    private volatile VoicechatServerApi api;
    private final MaidAmbientPolicy ambientPolicy=new MaidAmbientPolicy();
    private final MaidVoiceClips originalClips;
    private volatile boolean closed;
    private boolean historyInitialized;
    private long nextAmbient;
    private volatile Job active;
    private String lastState="ready",lastReason="",lastRequest="";
    private record Stamp(Player player,UUID world){}
    private static final class Job {
        final EntityMaid maid;final String request,text,kind;final UUID world;final Map<UUID,Stamp> listeners;final MaidVoiceClips.Clip original;
        volatile Set<UUID> audible=Set.of();volatile boolean cancelled,exhausted;boolean finished;final AtomicInteger offers=new AtomicInteger();
        AudioPlayer player;OpusEncoder encoder;UUID channel;LocationalAudioChannel spatial;Future<?> media;int offset;
        Job(EntityMaid maid,String request,String text,String kind,Map<UUID,Stamp> listeners,MaidVoiceClips.Clip original){this.maid=maid;this.request=request;this.text=text;this.kind=kind;this.listeners=Map.copyOf(listeners);this.original=original;world=maid.getBukkitEntity().getWorld().getUID();}
    }
    static NativeMaidSpeech create(HybridMaidPlugin plugin){
        Path path=plugin.getDataFolder().toPath().resolve("companion-speech.json");
        if(!Files.exists(path))return null;
        try{return new NativeMaidSpeech(plugin,JsonParser.parseString(Files.readString(path)).getAsJsonObject());}
        catch(Exception|LinkageError error){plugin.getLogger().warning("Companion speech not enabled: "+error.getClass().getSimpleName()+"; text dialogue remains available");return null;}
    }
    private NativeMaidSpeech(HybridMaidPlugin plugin,JsonObject config)throws Exception{
        this.plugin=plugin;if(config.get("schema").getAsInt()!=1)throw new IllegalArgumentException("Unknown voice config");
        maidId=UUID.fromString(config.get("maidId").getAsString());ownerId=UUID.fromString(config.get("ownerId").getAsString());
        JsonObject brain=JsonParser.parseString(Files.readString(plugin.getDataFolder().toPath().resolve("brain-routing.json"))).getAsJsonObject();
        if(!maidId.toString().equals(brain.get("maidId").getAsString())||!ownerId.toString().equals(brain.get("ownerId").getAsString()))throw new IllegalArgumentException("Companion identity mismatch");
        voice=config.get("voice").getAsString();if(!voice.matches("[A-Za-z0-9_.-]{1,96}"))throw new IllegalArgumentException("Explicit voice required");
        originalClips=config.has("ambientPack")?new MaidVoiceClips(config.getAsJsonObject("ambientPack")):null;
        URI uri=URI.create(config.get("backend").getAsString());
        if(!"http".equals(uri.getScheme())||!"127.0.0.1".equals(uri.getHost())||uri.getPort()<1||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!Set.of("","/").contains(uri.getPath()))throw new IllegalArgumentException("Exact loopback media origin required");
        backend="http://127.0.0.1:"+uri.getPort();token=Files.readString(Path.of(config.get("tokenFile").getAsString())).strip();
        if(token.length()<32||token.length()>128)throw new IllegalArgumentException("Private media token required");
        receipts=new ReceiptJournal(plugin.getDataFolder().toPath().resolve("speech-receipts"));
        BukkitVoicechatService service=Bukkit.getServicesManager().load(BukkitVoicechatService.class);
        if(service==null)throw new IllegalStateException("Existing voicechat service required");
        soundHook=local.qdj.maids.brain.MaidSpeechControl.bind(maidId,ownerId,this::ambient);
        service.registerPlugin(new VoicechatPlugin(){
            public String getPluginId(){return "qiandengji_maid_voice";}
            public void registerEvents(EventRegistration events){
                events.registerEvent(VoicechatServerStartedEvent.class,event->api=event.getVoicechat());
                events.registerEvent(VoicechatServerStoppedEvent.class,event->{api=null;main(()->cancel("voice_service_stopped"));});
                events.registerEvent(LocationalSoundPacketEvent.class,event->{Job job=active;if(job!=null&&!event.isCancelled()&&Objects.equals(job.channel,event.getPacket().getChannelId())&&event.getPacket().getOpusEncodedData().length>0&&event.getReceiverConnection()!=null&&event.getReceiverConnection().isConnected()&&!event.getReceiverConnection().isDisabled())job.offers.incrementAndGet();},1000);
            }
        });
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,5,5);
    }
    private void main(Runnable action){if(!closed&&plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,()->{if(!closed)action.run();});}
    private boolean valid(EntityMaid maid){return !closed&&maid.isAlive()&&!maid.isRemoved()&&maidId.equals(maid.getUUID())&&ownerId.equals(maid.getOwnerUUID())&&plugin.sharedDialogueEnabled(maid)&&!maid.isSilent();}
    JsonObject describe(EntityMaid maid){
        JsonObject out=new JsonObject();out.addProperty("enabled",valid(maid));
        if(!maidId.equals(maid.getUUID())||!ownerId.equals(maid.getOwnerUUID())){out.addProperty("reason","shared_voice_not_enabled_for_this_maid");return out;}
        out.addProperty("voice",voice);out.addProperty("transport","simple_voice_chat_position");
        out.addProperty("ambientSource",originalClips==null?"native_event_chinese_tts":"original_chinese_recordings");
        out.addProperty("ambientIdleEnabled",false);out.addProperty("ambientMinimumGapSeconds",90);
        if(originalClips!=null)out.addProperty("ambientPack",originalClips.pack());
        out.addProperty("state",lastState);out.addProperty("reason",lastReason);out.addProperty("requestId",lastRequest);out.addProperty("hearingVerified",false);
        out.addProperty("nextStep","听音需 Simple Voice Chat；/voice status 查询本连接。无语音模组仍可读附近文字。sent只证明音频发送，不证明真人耳听。");return out;
    }
    private Map<UUID,Stamp> listeners(EntityMaid maid,Set<UUID> allowed){
        Map<UUID,Stamp> result=new HashMap<>();VoicechatServerApi current=api;if(current==null)return result;
        for(Player p:maid.getBukkitEntity().getLocation().getNearbyPlayers(8)){
            if(allowed!=null&&!allowed.contains(p.getUniqueId())||!p.canSee(maid.getBukkitEntity()))continue;
            var c=current.getConnectionOf(p.getUniqueId());if(c!=null&&c.isInstalled()&&c.isConnected()&&!c.isDisabled())result.put(p.getUniqueId(),new Stamp(p,p.getWorld().getUID()));
        }return result;
    }
    void reply(EntityMaid maid,String operation,String text,Set<UUID> allowed){submit(maid,"r_"+UUID.nameUUIDFromBytes(operation.getBytes(java.nio.charset.StandardCharsets.UTF_8)),text,"reply",allowed);}
    private void submit(EntityMaid maid,String request,String raw,String kind,Set<UUID> allowed){
        submit(maid,request,raw,kind,allowed,null);
    }
    private void submit(EntityMaid maid,String request,String raw,String kind,Set<UUID> allowed,MaidVoiceClips.Clip original){
        if(!valid(maid)||request.length()>48)return;
        String text=raw==null?"":raw.replaceAll("[\\p{Cntrl}§]"," ").strip();if(text.isEmpty())return;if(text.length()>200)text=text.substring(0,200);
        if(!kind.equals("ambient"))nextAmbient=System.nanoTime()+MaidAmbientPolicy.GLOBAL_GAP;
        if(!kind.equals("ambient"))plugin.conversationSpoken();
        if(!maid.getAiChatManager().getTTSModel().isBlank()){lastState="unavailable";lastReason="native_tts_already_configured";return;}
        Map<UUID,Stamp> listeners=listeners(maid,allowed);
        // Quiet/unattended areas must not create thousands of ambient receipt files.
        if(kind.equals("ambient")&&listeners.isEmpty())return;
        try{
            if(receipts.read(maidId,request)!=null)return; // Never replay a voice whose outcome survived restart.
            receipts.reserve(maidId,ownerId,request,"speech",voice+"\n"+kind+"\n"+text+(original==null?"":"\n"+original.sourceSha256()));
            Job job=new Job(maid,request,text,kind,listeners,original);
            if(listeners.isEmpty()){finish(job,"skipped","no_connected_voice_listener");return;}
            if(active!=null&&active.kind.equals("ambient")&&!kind.equals("ambient"))cancel("ambient_interrupted_for_reply");
            if(active!=null){finish(job,"skipped","companion_already_speaking");return;}
            active=job;if(kind.equals("ambient"))plugin.conversationSpoken();finishRecord(job,"preparing","");
            if(original!=null){play(job,original.samples());return;}
            short[] cached=kind.equals("ambient")?ambientCache.get(text):null;
            if(cached!=null){play(job,cached);return;}
            job.media=worker.submit(()->{try{short[] pcm=synthesize(job);main(()->{if(job!=active)return;if(kind.equals("ambient")){ambientCache.put(job.text,pcm);while(ambientCache.size()>16)ambientCache.remove(ambientCache.keySet().iterator().next());}play(job,pcm);});}
                catch(Exception error){main(()->{if(job==active)finish(job,"failed","media_unavailable_no_replay");});}});
        }catch(Exception error){if(active!=null&&active.request.equals(request))active=null;lastState="unknown";lastReason="speech_receipt_unavailable_no_replay";}
    }
    private short[] synthesize(Job job)throws Exception{
        JsonObject data=new JsonObject();data.addProperty("actor",maidId.toString());data.addProperty("requestId",UUID.nameUUIDFromBytes(job.request.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString());data.addProperty("voice",voice);data.addProperty("text",job.text);
        var req=HttpRequest.newBuilder(URI.create(backend+"/v1/tts")).timeout(Duration.ofSeconds(100)).header("Authorization","Bearer "+token).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(data.toString())).build();
        var response=http.send(req,HttpResponse.BodyHandlers.ofInputStream());
        byte[] bytes;try(var input=response.body()){if(response.statusCode()!=200)throw new IOException("Media preparation refused");bytes=input.readNBytes(2_900_001);if(bytes.length>2_900_000)throw new IOException("Audio too large");}
        try(var audio=AudioSystem.getAudioInputStream(new ByteArrayInputStream(bytes))){
            AudioFormat f=audio.getFormat();if(f.getSampleRate()!=48000||f.getChannels()!=1||f.getSampleSizeInBits()!=16||f.isBigEndian()||!f.getEncoding().equals(AudioFormat.Encoding.PCM_SIGNED))throw new IOException("Normalized PCM required");
            byte[] pcm=audio.readNBytes(2_880_001);if(pcm.length==0||pcm.length>2_880_000||pcm.length%2!=0)throw new IOException("Invalid audio duration");short[] result=new short[pcm.length/2];ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(result);return result;
        }
    }
    private void refresh(Job job){
        Set<UUID> ids=new HashSet<>();if(valid(job.maid)&&job.world.equals(job.maid.getBukkitEntity().getWorld().getUID()))for(var entry:job.listeners.entrySet()){
            Player p=Bukkit.getPlayer(entry.getKey());if(p==entry.getValue().player&&p.isOnline()&&p.getWorld().getUID().equals(job.world)&&p.canSee(job.maid.getBukkitEntity())&&p.getLocation().distanceSquared(job.maid.getBukkitEntity().getLocation())<=64)ids.add(p.getUniqueId());
        }job.audible=Set.copyOf(ids);
        if(job.spatial!=null&&api!=null&&job.world.equals(job.maid.getBukkitEntity().getWorld().getUID()))job.spatial.updateLocation(api.createPosition(job.maid.getX(),job.maid.getEyeY(),job.maid.getZ()));
    }
    private void play(Job job,short[] pcm){
        if(job!=active)return;refresh(job);
        if(job.audible.isEmpty()||api==null){finish(job,"cancelled","audience_or_entity_changed");return;}
        try{
            // Positional packets also play when the client projects or temporarily lacks the native entity UUID.
            job.channel=UUID.randomUUID();var channel=api.createLocationalAudioChannel(job.channel,api.fromServerLevel(job.maid.getBukkitEntity().getWorld()),api.createPosition(job.maid.getX(),job.maid.getEyeY(),job.maid.getZ()));job.spatial=channel;
            if(channel==null)throw new IllegalStateException("Position channel unavailable");channel.setDistance(8);channel.setFilter(p->job.audible.contains(p.getUuid()));
            job.encoder=api.createEncoder();job.player=api.createAudioPlayer(channel,job.encoder,()->{
                if(job.cancelled||job.audible.isEmpty())return null;
                if(job.offset>=pcm.length){job.exhausted=true;return null;}short[] frame=new short[960];int n=Math.min(960,pcm.length-job.offset);System.arraycopy(pcm,job.offset,frame,0,n);job.offset+=n;return frame;
            });
            job.player.setOnStopped(()->{job.encoder.close();main(()->finish(job,job.exhausted&&!job.cancelled?"sent":"cancelled",job.exhausted&&!job.cancelled?(job.offers.get()>0?"hearing_unverified":"no_packet_receiver"):"playback_interrupted"));});
            finishRecord(job,"playing","");job.player.startPlaying();
        }catch(Exception error){if(job.encoder!=null)job.encoder.close();finish(job,"failed","playback_unavailable_no_replay");}
    }
    private void finishRecord(Job job,String state,String reason)throws Exception{
        JsonObject result=new JsonObject();result.addProperty("voice",voice);result.addProperty("kind",job.kind);result.addProperty("reason",reason);result.addProperty("packetOffers",job.offers.get());result.addProperty("hearingVerified",false);result.addProperty("retryAllowed",false);
        result.addProperty("audioSource",job.original==null?"server_tts":"original_chinese_maid_pack");
        if(job.original!=null)result.addProperty("originalAudioSha256",job.original.sourceSha256());
        result.addProperty("transport","simple_voice_chat_position");result.addProperty("connectedListeners",job.listeners.size());
        JsonArray listeners=new JsonArray();job.listeners.keySet().stream().sorted().forEach(id->listeners.add(id.toString()));result.add("listenerUuids",listeners);
        receipts.finish(maidId,job.request,state,result);if(active==job||active==null){lastRequest=job.request;lastState=state;lastReason=reason;}
    }
    private void finish(Job job,String state,String reason){if(job.finished)return;job.finished=true;try{finishRecord(job,state,reason);}catch(Exception error){if(active==job||active==null){lastState="unknown";lastReason="speech_receipt_unavailable_no_replay";}}if(active==job)active=null;}
    private void cancel(String reason){Job job=active;if(job==null)return;job.cancelled=true;job.audible=Set.of();if(job.media!=null)job.media.cancel(true);if(job.player!=null)job.player.stopPlaying();finish(job,"cancelled",reason);}
    private void ambient(EntityMaid maid,String sound){
        if(!Bukkit.isPrimaryThread()||!valid(maid)||System.nanoTime()<nextAmbient||active!=null)return;
        var target=maid.getTarget();boolean fighting=target!=null&&target.isAlive()&&maid.distanceToSqr(target)<=64&&maid.hasLineOfSight(target);
        var world=maid.getBukkitEntity().getWorld();
        if(!MaidAmbientPolicy.matchesScene(sound,maid.getTask().getUid().toString(),fighting,maid.hurtTime>0,maid.isSleeping()||maid.isMaidInSittingPose(),world.getTime()%24000,world.hasStorm(),maid.level().canSeeSky(maid.blockPosition())))return;
        double frequency=maid.getConfigManager().getSoundFreq()*com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig.GLOBAL_MAID_SOUND_FREQUENCY.get()/100.0;
        if(frequency<=0||frequency<1&&maid.getRandom().nextDouble()>frequency)return;
        List<Player> audience=maid.getBukkitEntity().getLocation().getNearbyPlayers(8).stream().filter(p->p.isOnline()&&!p.isDead()&&p.getGameMode()!=org.bukkit.GameMode.SPECTATOR&&p.canSee(maid.getBukkitEntity())).toList();
        MaidVoiceClips.Clip original=originalClips==null?null:originalClips.next(sound);
        if(originalClips!=null&&original==null)return; // Curated pack omissions stay quiet, never invent a fallback line.
        String text=ambientPolicy.choose(sound,System.nanoTime(),!audience.isEmpty());if(text==null)return;
        if(original!=null)text=original.text();
        nextAmbient=System.nanoTime()+MaidAmbientPolicy.GLOBAL_GAP;
        String operation="a_"+UUID.randomUUID();
        int delivered=0;
        for(Player p:audience){p.sendMessage("[附近·女仆] "+maid.getName().getString()+"："+text);delivered++;}
        plugin.publishPublicSpeech(maid,operation,text,delivered);
        submit(maid,operation,text,"ambient",null,original);
    }
    private void tick(){
        EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(maidId));
        if(maid==null||!valid(maid)){cancel("companion_unavailable");return;}
        if(active!=null){refresh(active);if(active.audible.isEmpty())cancel("audience_left");}
        List<LLMMessage> history=new ArrayList<>(maid.getAiChatManager().getHistory().getDeque());Collections.reverse(history);
        if(!historyInitialized){seen.addAll(history);historyInitialized=true;return;}
        seen.retainAll(history);
        for(LLMMessage row:history)if(seen.add(row)&&row.role()==Role.ASSISTANT&&(row.toolCalls()==null||row.toolCalls().isEmpty())&&!row.message().isBlank())try{
            String key="n_"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((row.gameTime()+"\n"+row.message()).getBytes(java.nio.charset.StandardCharsets.UTF_8))).substring(0,40);
            submit(maid,key,new ResponseChat(row.message()).getChatText(),"owner_reply",Set.of(ownerId));
        }catch(Exception error){lastState="unavailable";lastReason="invalid_native_reply";}
    }
    @Override public void close(){cancel("service_stopped");closed=true;try{soundHook.close();}catch(Exception ignored){}worker.shutdownNow();http.shutdownNow();ambientCache.clear();seen.clear();}
}
