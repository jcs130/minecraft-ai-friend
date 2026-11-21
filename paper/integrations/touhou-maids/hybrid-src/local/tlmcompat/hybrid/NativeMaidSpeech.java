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
import java.nio.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sound.sampled.*;
import local.tlmcompat.qiandengji.ReceiptJournal;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Mob;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** One configured native companion, one existing media service, no new model loop. */
final class NativeMaidSpeech implements AutoCloseable {
    private final HybridMaidPlugin plugin;
    private final UUID maidId,ownerId;
    private final String voice;
    private final MaidSpeechMedia media;
    private final String requiredSoundPack;
    private final ReceiptJournal receipts;
    private final ExecutorService worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(2),r->new Thread(r,"maid-voice-media"),new ThreadPoolExecutor.AbortPolicy());
    private final Set<LLMMessage> seen=Collections.newSetFromMap(new IdentityHashMap<>());
    private final LinkedHashMap<String,short[]> ambientCache=new LinkedHashMap<>();
    private final AutoCloseable soundHook;
    private volatile VoicechatServerApi api;
    private final MaidAmbientPolicy ambientPolicy=new MaidAmbientPolicy();
    private final MaidVoiceClips originalClips;
    private final double gainDb;
    private final MaidSpeechVolume volume;
    private volatile boolean closed;
    private boolean historyInitialized;
    private long nextAmbient;
    private long lastSpeech = Long.MIN_VALUE;
    private final MaidCombatSpeech combatPolicy = new MaidCombatSpeech();
    private volatile Job active;
    private final MaidSpeechQueue<Job> waiting=new MaidSpeechQueue<>();
    private String lastState="ready",lastReason="",lastRequest="";
    private record Stamp(Player player,UUID world){}
    private static final class Job {
        final EntityMaid maid;final String request,text,kind;final UUID world;final Map<UUID,Stamp> listeners;final MaidVoiceClips.Clip original;
        volatile Set<UUID> audible=Set.of();volatile boolean cancelled,exhausted;boolean finished;final AtomicInteger offers=new AtomicInteger();
        final long created = System.nanoTime();
        AudioPlayer player;OpusEncoder encoder;UUID channel;LocationalAudioChannel spatial;Future<?> media;int offset;
        final UUID turn=UUID.randomUUID();
        short[] prepared;
        boolean holdingTurn;
        Job(EntityMaid maid,String request,String text,String kind,Map<UUID,Stamp> listeners,MaidVoiceClips.Clip original){this.maid=maid;this.request=request;this.text=text;this.kind=kind;this.listeners=Map.copyOf(listeners);this.original=original;world=maid.getBukkitEntity().getWorld().getUID();}
    }
    NativeMaidSpeech(HybridMaidPlugin plugin,JsonObject config,boolean registeredProfile,MaidSpeechMedia media)throws Exception{
        this.media=media;
        this.plugin=plugin;if(config.get("schema").getAsInt()!=1)throw new IllegalArgumentException("Unknown voice config");
        maidId=UUID.fromString(config.get("maidId").getAsString());ownerId=UUID.fromString(config.get("ownerId").getAsString());
        if(!registeredProfile){
            JsonObject brain=JsonParser.parseString(Files.readString(plugin.getDataFolder().toPath().resolve("brain-routing.json"))).getAsJsonObject();
            if(!maidId.toString().equals(brain.get("maidId").getAsString())||!ownerId.toString().equals(brain.get("ownerId").getAsString()))throw new IllegalArgumentException("Companion identity mismatch");
        }
        requiredSoundPack=config.has("requiredSoundPack")?config.get("requiredSoundPack").getAsString():null;
        voice=config.get("voice").getAsString();if(!voice.matches("[A-Za-z0-9_.-]{1,96}"))throw new IllegalArgumentException("Explicit voice required");
        gainDb=config.has("voiceGainDb")?config.get("voiceGainDb").getAsDouble():6;
        volume=new MaidSpeechVolume(gainDb);
        originalClips=config.has("ambientPack")?new MaidVoiceClips(config.getAsJsonObject("ambientPack")):null;
        receipts=new ReceiptJournal(plugin.getDataFolder().toPath().resolve("speech-receipts"));
        soundHook=requiredSoundPack!=null?()->{}:local.qdj.maids.brain.MaidSpeechControl.bind(maidId,ownerId,this::ambient);
    }
    void voiceService(VoicechatServerApi current){api=current;if(current==null)main(()->cancel("voice_service_stopped"));}
    void offered(LocationalSoundPacketEvent event){
        Job job=active;
        if(job!=null&&!event.isCancelled()&&Objects.equals(job.channel,event.getPacket().getChannelId())&&event.getPacket().getOpusEncodedData().length>0&&event.getReceiverConnection()!=null&&event.getReceiverConnection().isConnected()&&!event.getReceiverConnection().isDisabled())job.offers.incrementAndGet();
    }
    boolean forSelection(EntityMaid maid){
        return ownerId.equals(maid.getOwnerUUID()) && Objects.equals(requiredSoundPack,maid.getSoundPackId())
            && plugin.personal!=null && voice.equals(plugin.personal.selectedVoice(maid));
    }
    boolean idle(){return active==null&&waiting.peek()==null;}
    private void main(Runnable action){if(!closed&&plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,()->{if(!closed)action.run();});}
    private boolean valid(EntityMaid maid){return !closed&&maid.isAlive()&&!maid.isRemoved()&&maidId.equals(maid.getUUID())&&ownerId.equals(maid.getOwnerUUID())&&(requiredSoundPack!=null?(plugin.personalDialogue(maid)||plugin.guideVoice(maid))&&forSelection(maid):plugin.sharedDialogueEnabled(maid)||plugin.unifiedBody(maidId))&&!maid.isSilent();}
    JsonObject describe(EntityMaid maid){
        JsonObject out=new JsonObject();out.addProperty("enabled",valid(maid));
        if(!maidId.equals(maid.getUUID())||!ownerId.equals(maid.getOwnerUUID())){out.addProperty("reason","shared_voice_not_enabled_for_this_maid");return out;}
        out.addProperty("voice",voice);out.addProperty("transport","simple_voice_chat_position");
        out.addProperty("voiceGainDb",gainDb);
        out.addProperty("partnerRangeBlocks",MaidConversationRange.PARTNER);out.addProperty("visitorRangeBlocks",MaidConversationRange.VISITOR);
        out.addProperty("ambientSource",originalClips==null?"native_event_chinese_tts":"original_chinese_recordings");
        out.addProperty("combatTrigger","confirmed_damage_with_scene_change");
        out.addProperty("combatMinimumGapSeconds",MaidCombatSpeech.GAP/1_000_000_000L);
        out.addProperty("combatMaximumAgeSeconds",MaidCombatSpeech.MAX_AGE/1_000_000_000L);
        out.addProperty("ambientIdleEnabled",false);out.addProperty("ambientMinimumGapSeconds",90);
        out.addProperty("replyCharacterLimit",MaidShortReply.LIMIT);out.addProperty("waitingReply",waiting.peek()!=null);out.addProperty("maximumReplyWaitSeconds",10);
        if(originalClips!=null)out.addProperty("ambientPack",originalClips.pack());
        out.addProperty("state",lastState);out.addProperty("reason",lastReason);out.addProperty("requestId",lastRequest);out.addProperty("hearingVerified",false);
        out.addProperty("nextStep","听音需 Simple Voice Chat；/voice status 查询本连接。无语音模组仍可读附近文字。sent只证明音频发送，不证明真人耳听。");return out;
    }
    private Map<UUID,Stamp> listeners(EntityMaid maid,Set<UUID> allowed){
        Map<UUID,Stamp> result=new HashMap<>();VoicechatServerApi current=api;if(current==null)return result;
        for(Player p:maid.getBukkitEntity().getLocation().getNearbyPlayers(MaidConversationRange.PARTNER)){
            if(allowed!=null&&!allowed.contains(p.getUniqueId())||!p.canSee(maid.getBukkitEntity())||!MaidConversationRange.hears(maid,p))continue;
            var c=current.getConnectionOf(p.getUniqueId());if(c!=null&&c.isInstalled()&&c.isConnected()&&!c.isDisabled())result.put(p.getUniqueId(),new Stamp(p,p.getWorld().getUID()));
        }return result;
    }
    void reply(EntityMaid maid,String operation,String text,Set<UUID> allowed){submit(maid,"r_"+UUID.nameUUIDFromBytes(operation.getBytes(java.nio.charset.StandardCharsets.UTF_8)),text,"reply",allowed);}
    boolean readyFor(EntityMaid maid,Player listener){
        var settings=maid.getAiChatManager();
        boolean packSite=requiredSoundPack!=null && PersonalMaidDialogue.SITE.equals(settings.ttsSite);
        if(!valid(maid)||(!settings.getTTSModel().isBlank()&&!packSite)
                ||requiredSoundPack!=null&&com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.MaidAIChatSerializable.isNoTTSSite(settings.ttsSite))return false;
        return listeners(maid,Set.of(listener.getUniqueId())).containsKey(listener.getUniqueId());
    }
    String socialReply(EntityMaid maid,String operation,String text,Set<UUID> audience){
        if(text==null||text.isBlank()||text.length()>280||audience.stream().map(Bukkit::getPlayer)
                .noneMatch(player->player!=null&&readyFor(maid,player)))return null;
        String id="r_"+UUID.nameUUIDFromBytes(operation.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        submit(maid,id,text,"social_reply",audience);
        return id;
    }
    private void submit(EntityMaid maid,String request,String raw,String kind,Set<UUID> allowed){
        submit(maid,request,raw,kind,allowed,null);
    }
    private void submit(EntityMaid maid,String request,String raw,String kind,Set<UUID> allowed,MaidVoiceClips.Clip original){
        if(!valid(maid)||request.length()>48)return;
        String text=kind.equals("social_reply")?raw.strip():MaidShortReply.text(raw);if(text.isEmpty())return;
        if(!MaidCombatSpeech.lowPriority(kind))nextAmbient=System.nanoTime()+MaidAmbientPolicy.GLOBAL_GAP;
        if(!MaidCombatSpeech.lowPriority(kind))plugin.conversationSpoken();
        // Nearby personal replies have a text-only TLM callback. Only the native GUI calls its TTS site.
        var settings=maid.getAiChatManager();
        boolean packSite=requiredSoundPack!=null && PersonalMaidDialogue.SITE.equals(settings.ttsSite);
        if(requiredSoundPack!=null && com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.MaidAIChatSerializable.isNoTTSSite(settings.ttsSite)){lastState="skipped";lastReason="muted";return;}
        if(!settings.getTTSModel().isBlank() && !packSite){lastState="unavailable";lastReason="native_tts_already_configured";return;}
        Map<UUID,Stamp> listeners=listeners(maid,allowed);
        // Quiet/unattended areas must not create thousands of ambient receipt files.
        if(MaidCombatSpeech.lowPriority(kind)&&listeners.isEmpty())return;
        try{
            if(receipts.read(maidId,request)!=null)return; // Never replay a voice whose outcome survived restart.
            receipts.reserve(maidId,ownerId,request,"speech",voice+"\n"+kind+"\n"+text+(original==null?"":"\n"+original.sourceSha256()));
            Job job=new Job(maid,request,text,kind,listeners,original);
            if(listeners.isEmpty()){finish(job,"skipped","no_connected_voice_listener");return;}
            if(active!=null&&MaidCombatSpeech.lowPriority(active.kind)&&!MaidCombatSpeech.lowPriority(kind))cancel("ambient_interrupted_for_reply");
            if(active!=null){
                if(MaidCombatSpeech.lowPriority(kind)){finish(job,"skipped","companion_already_speaking");return;}
                // Reserve the original request once; keep only the freshest reply, never a backlog.
                finishRecord(job,"queued","previous_reply_playing");
                Job displaced=waiting.offer(job,System.nanoTime());
                if(displaced!=null)finish(displaced,"skipped","newer_reply_waiting");
                return;
            }
            var displaced=waiting.take();if(displaced!=null)finish(displaced.item(),"skipped","newer_reply_ready");
            begin(job);
        }catch(Exception error){if(active!=null&&active.request.equals(request))active=null;lastState="unknown";lastReason="speech_receipt_unavailable_no_replay";}
    }
    private void begin(Job job){
        active=job;
        lastSpeech=System.nanoTime();
        try{
            refresh(job);if(job.audible.isEmpty()||api==null){finish(job,"cancelled","audience_or_entity_changed");return;}
            if(MaidCombatSpeech.lowPriority(job.kind))plugin.conversationSpoken();finishRecord(job,"preparing","");
            if(job.original!=null){play(job,job.original.samples());return;}
            short[] cached=MaidCombatSpeech.lowPriority(job.kind)?ambientCache.get(job.text):null;
            if(cached!=null){play(job,cached);return;}
            job.media=worker.submit(()->{try{short[] pcm=synthesize(job);main(()->{if(job!=active)return;if(MaidCombatSpeech.lowPriority(job.kind)){ambientCache.put(job.text,pcm);while(ambientCache.size()>16)ambientCache.remove(ambientCache.keySet().iterator().next());}play(job,pcm);});}
                catch(Exception error){main(()->{if(job==active)finish(job,"failed","media_unavailable_no_replay");});}});
        }catch(Exception error){finish(job,"failed","speech_preparation_unavailable_no_replay");}
    }
    private short[] synthesize(Job job)throws Exception{
        UUID id=UUID.nameUUIDFromBytes(job.request.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        byte[] bytes=media.wav(maidId,id,voice,job.text);
        try(var audio=AudioSystem.getAudioInputStream(new ByteArrayInputStream(bytes))){
            AudioFormat f=audio.getFormat();if(f.getSampleRate()!=48000||f.getChannels()!=1||f.getSampleSizeInBits()!=16||f.isBigEndian()||!f.getEncoding().equals(AudioFormat.Encoding.PCM_SIGNED))throw new IOException("Normalized PCM required");
            byte[] pcm=audio.readNBytes(2_880_001);if(pcm.length==0||pcm.length>2_880_000||pcm.length%2!=0)throw new IOException("Invalid audio duration");short[] result=new short[pcm.length/2];ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(result);return result;
        }
    }
    private void refresh(Job job){
        Set<UUID> ids=new HashSet<>();if(valid(job.maid)&&job.world.equals(job.maid.getBukkitEntity().getWorld().getUID()))for(var entry:job.listeners.entrySet()){
            Player p=Bukkit.getPlayer(entry.getKey());if(p==entry.getValue().player&&p.isOnline()&&p.getWorld().getUID().equals(job.world)&&p.canSee(job.maid.getBukkitEntity())&&MaidConversationRange.hears(job.maid,p))ids.add(p.getUniqueId());
        }job.audible=Set.copyOf(ids);
        if(job.spatial!=null&&api!=null&&job.world.equals(job.maid.getBukkitEntity().getWorld().getUID()))job.spatial.updateLocation(api.createPosition(job.maid.getX(),job.maid.getEyeY(),job.maid.getZ()));
    }
    private void play(Job job,short[] pcm){
        if(job!=active)return;refresh(job);
        if(job.kind.equals("combat")&&!MaidCombatSpeech.fresh(job.created,System.nanoTime())){finish(job,"skipped","combat_scene_expired");return;}
        if(job.audible.isEmpty()||api==null){finish(job,"cancelled","audience_or_entity_changed");return;}
        try{
            if(!publicTurn(job,true)){
                if(job.prepared==null)finishRecord(job,"queued","waiting_for_nearby_speaker");
                job.prepared=pcm;
                return;
            }
            job.holdingTurn=true;
            job.prepared=null;
            // Positional packets also play when the client projects or temporarily lacks the native entity UUID.
            job.channel=UUID.randomUUID();var channel=api.createLocationalAudioChannel(job.channel,api.fromServerLevel(job.maid.getBukkitEntity().getWorld()),api.createPosition(job.maid.getX(),job.maid.getEyeY(),job.maid.getZ()));job.spatial=channel;
            if(channel==null)throw new IllegalStateException("Position channel unavailable");channel.setDistance(MaidConversationRange.PARTNER);channel.setFilter(p->job.audible.contains(p.getUuid()));
            job.encoder=api.createEncoder();job.player=api.createAudioPlayer(channel,job.encoder,()->{
                if(job.cancelled||job.audible.isEmpty())return null;
                if(job.offset>=pcm.length){job.exhausted=true;return null;}short[] frame=new short[960];int n=Math.min(960,pcm.length-job.offset);volume.copy(pcm,job.offset,frame,n);job.offset+=n;return frame;
            });
            job.player.setOnStopped(()->{job.encoder.close();main(()->finish(job,job.exhausted&&!job.cancelled?"sent":"cancelled",job.exhausted&&!job.cancelled?(job.offers.get()>0?"hearing_unverified":"no_packet_receiver"):"playback_interrupted"));});
            finishRecord(job,"playing","");job.player.startPlaying();
        }catch(Exception error){if(job.encoder!=null)job.encoder.close();finish(job,"failed","playback_unavailable_no_replay");}
    }
    private boolean publicTurn(Job job,boolean start)throws ReflectiveOperationException{
        var voicePlugin=Bukkit.getPluginManager().getPlugin("QiandengVoice");
        if(voicePlugin==null||!voicePlugin.isEnabled())return true;
        try{
            var method=voicePlugin.getClass().getMethod("publicSpeechTurn",org.bukkit.entity.Entity.class,UUID.class,double.class,boolean.class);
            return Boolean.TRUE.equals(method.invoke(voicePlugin,job.maid.getBukkitEntity(),job.turn,(double)MaidConversationRange.PARTNER,start));
        }catch(NoSuchMethodException older){return true;}
    }
    private void finishRecord(Job job,String state,String reason)throws Exception{
        JsonObject result=new JsonObject();result.addProperty("voice",voice);result.addProperty("kind",job.kind);result.addProperty("reason",reason);result.addProperty("packetOffers",job.offers.get());result.addProperty("hearingVerified",false);result.addProperty("retryAllowed",false);
        result.addProperty("audioSource",job.original==null?"server_tts":"original_chinese_maid_pack");
        result.addProperty("voiceGainDb",gainDb);
        if(job.original!=null)result.addProperty("originalAudioSha256",job.original.sourceSha256());
        result.addProperty("transport","simple_voice_chat_position");result.addProperty("connectedListeners",job.listeners.size());
        JsonArray listeners=new JsonArray();job.listeners.keySet().stream().sorted().forEach(id->listeners.add(id.toString()));result.add("listenerUuids",listeners);
        receipts.finish(maidId,job.request,state,result);if(active==job||active==null){lastRequest=job.request;lastState=state;lastReason=reason;}
    }
    private void finish(Job job,String state,String reason){
        if(job.finished)return;
        job.finished=true;
        job.prepared=null;
        if(job.holdingTurn)try{publicTurn(job,false);}catch(ReflectiveOperationException unavailable){/* Short leases expire if the bridge stops. */}
        try{finishRecord(job,state,reason);}catch(Exception error){if(active==job||active==null){lastState="unknown";lastReason="speech_receipt_unavailable_no_replay";}}
        if(active==job)active=null;
    }
    private void cancel(String reason){Job job=active;if(job==null)return;job.cancelled=true;job.audible=Set.of();if(job.media!=null)job.media.cancel(true);if(job.player!=null)job.player.stopPlaying();finish(job,"cancelled",reason);}
    void combat(EntityMaid maid, Mob target, String mode, float damage) {
        if(requiredSoundPack!=null)return;
        if (!Bukkit.isPrimaryThread() || !valid(maid) || maid.level()!=target.level()) return;
        long now = System.nanoTime();
        List<Player> audience = maid.getBukkitEntity().getLocation().getNearbyPlayers(MaidConversationRange.PARTNER).stream()
            .filter(p -> p.isOnline() && !p.isDead() && p.canSee(maid.getBukkitEntity()) && MaidConversationRange.hears(maid,p)).toList();
        boolean busy = active != null || waiting.peek() != null || lastSpeech != Long.MIN_VALUE && now-lastSpeech < 10_000_000_000L;
        Player partner = audience.stream().filter(p -> ownerId.equals(p.getUniqueId())).findFirst().orElse(null);
        double partnerHealth = partner != null ? fraction(partner.getHealth(),partner.getMaxHealth()) : Double.NaN;
        var hit = new MaidCombatSpeech.Hit(maid.level().dimension().location().toString(),
            BuiltInRegistries.ENTITY_TYPE.getKey(target.getType()).toString(),mode,damage,
            fraction(target.getHealth(),target.getMaxHealth()),partnerHealth,
            fraction(maid.getHealth(),maid.getMaxHealth()),maid.distanceToSqr(target)<=9);
        String text = combatPolicy.hit(now,hit,!audience.isEmpty(),busy);
        if (text == null) return;
        text = MaidShortReply.text(text);
        lastSpeech = now;
        nextAmbient = now + MaidAmbientPolicy.GLOBAL_GAP;
        String operation = "c_" + UUID.randomUUID();
        for (Player p : audience) p.sendMessage("[附近·女仆] " + maid.getName().getString() + "：" + text);
        plugin.publishSceneSpeech(maid,operation,text,audience.size());
        plugin.conversationSpoken();
        submit(maid,operation,text,"combat",null);
    }
    private static double fraction(double health,double maxHealth) {
        return Double.isFinite(health)&&Double.isFinite(maxHealth)&&health>=0&&maxHealth>0 ? health/maxHealth : Double.NaN;
    }
    private void ambient(EntityMaid maid,String sound){
        if(!Bukkit.isPrimaryThread()||!valid(maid)||System.nanoTime()<nextAmbient||active!=null||waiting.peek()!=null)return;
        var target=maid.getTarget();boolean fighting=target!=null&&target.isAlive()&&maid.distanceToSqr(target)<=64&&maid.hasLineOfSight(target);
        var world=maid.getBukkitEntity().getWorld();
        if(!MaidAmbientPolicy.matchesScene(sound,maid.getTask().getUid().toString(),fighting,maid.hurtTime>0,maid.isSleeping()||maid.isMaidInSittingPose(),world.getTime()%24000,world.hasStorm(),maid.level().canSeeSky(maid.blockPosition())))return;
        double frequency=maid.getConfigManager().getSoundFreq()*com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig.GLOBAL_MAID_SOUND_FREQUENCY.get()/100.0;
        if(frequency<=0||frequency<1&&maid.getRandom().nextDouble()>frequency)return;
        List<Player> audience=maid.getBukkitEntity().getLocation().getNearbyPlayers(MaidConversationRange.PARTNER).stream().filter(p->p.isOnline()&&!p.isDead()&&p.getGameMode()!=org.bukkit.GameMode.SPECTATOR&&p.canSee(maid.getBukkitEntity())&&MaidConversationRange.hears(maid,p)).toList();
        MaidVoiceClips.Clip original=originalClips==null?null:originalClips.next(sound);
        if(originalClips!=null&&original==null)return; // Curated pack omissions stay quiet, never invent a fallback line.
        String text=ambientPolicy.choose(sound,System.nanoTime(),!audience.isEmpty());if(text==null)return;
        if(original!=null)text=original.text();text=MaidShortReply.text(text);
        nextAmbient=System.nanoTime()+MaidAmbientPolicy.GLOBAL_GAP;
        String operation="a_"+UUID.randomUUID();
        int delivered=0;
        for(Player p:audience){p.sendMessage("[附近·女仆] "+maid.getName().getString()+"："+text);delivered++;}
        // Ambient clips are player-facing presentation. Their text can sound
        // like a question, but it is not an NPC initiating a conversation.
        plugin.publishSceneSpeech(maid,operation,text,delivered);
        submit(maid,operation,text,"ambient",null,original);
    }
    void tick(){
        EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(maidId));
        if(maid==null||!valid(maid)){cancelWaiting("companion_unavailable");cancel("companion_unavailable");return;}
        if(active!=null){refresh(active);if(active.audible.isEmpty())cancel("audience_left");else if(active.prepared!=null)play(active,active.prepared);}
        var next=waiting.peek();
        if(next!=null&&next.expired(System.nanoTime())){waiting.take();finish(next.item(),"skipped","reply_wait_expired");}
        else if(next!=null&&active==null){waiting.take();begin(next.item());}
        if(requiredSoundPack!=null)return;
        List<LLMMessage> history=new ArrayList<>(maid.getAiChatManager().getHistory().getDeque());Collections.reverse(history);
        if(!historyInitialized){seen.addAll(history);historyInitialized=true;return;}
        seen.retainAll(history);
        for(LLMMessage row:history)if(seen.add(row)&&row.role()==Role.ASSISTANT&&(row.toolCalls()==null||row.toolCalls().isEmpty())&&!row.message().isBlank())try{
            String key="n_"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((row.gameTime()+"\n"+row.message()).getBytes(java.nio.charset.StandardCharsets.UTF_8))).substring(0,40);
            submit(maid,key,new ResponseChat(row.message()).getChatText(),"owner_reply",Set.of(ownerId));
        }catch(Exception error){lastState="unavailable";lastReason="invalid_native_reply";}
    }
    private void cancelWaiting(String reason){var next=waiting.take();if(next!=null)finish(next.item(),"cancelled",reason);}
    @Override public void close(){closed=true;cancelWaiting("service_stopped");cancel("service_stopped");try{soundHook.close();}catch(Exception ignored){}worker.shutdownNow();ambientCache.clear();seen.clear();}
}
