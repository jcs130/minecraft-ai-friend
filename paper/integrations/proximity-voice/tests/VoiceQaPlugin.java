package dev.god.godvoice;

import de.maxhenkel.voicechat.api.*;
import de.maxhenkel.voicechat.api.events.*;
import de.maxhenkel.voicechat.api.audiosender.AudioSender;
import de.maxhenkel.voicechat.api.opus.OpusEncoder;
import java.nio.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sound.sampled.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Isolated-server fixture only. This class is never packaged in QiandengVoice. */
public final class VoiceQaPlugin extends JavaPlugin {
    private volatile VoicechatServerApi api;
    private final Map<UUID,AtomicInteger> counts=new java.util.concurrent.ConcurrentHashMap<>();
    @Override public void onEnable(){
        Objects.requireNonNull(Bukkit.getServicesManager().load(BukkitVoicechatService.class)).registerPlugin(new VoicechatPlugin(){
            public String getPluginId(){return "qiandeng_voice_qa";}
            public void registerEvents(EventRegistration events){events.registerEvent(VoicechatServerStartedEvent.class,e->api=e.getVoicechat());}
        });
        Objects.requireNonNull(getCommand("voiceqa")).setExecutor(this::command);
    }
    private boolean command(CommandSender sender,Command command,String label,String[] args){
        if(sender instanceof Player){sender.sendMessage("Console fixture only");return true;}
        try{
            Player actor=Objects.requireNonNull(Bukkit.getPlayerExact(args[1]));
            switch(args[0]){
                case "listen"->{var count=new AtomicInteger();counts.put(actor.getUniqueId(),count);api.registerAudioListener(api.playerAudioListenerBuilder().setPlayer(actor.getUniqueId()).setPacketListener(packet->count.incrementAndGet()).build());sender.sendMessage("QA_LISTENER_READY "+actor.getName());}
                case "count"->sender.sendMessage("QA_AUDIO_PACKETS "+actor.getName()+" "+counts.getOrDefault(actor.getUniqueId(),new AtomicInteger()).get());
                case "emit"->{
                    AudioSender audio=api.createAudioSender(api.getConnectionOf(actor.getUniqueId()));if(!api.registerAudioSender(audio))throw new IllegalStateException("Sender unavailable");
                    byte[] data;try(var stream=AudioSystem.getAudioInputStream(new File(getDataFolder(),"speech.wav"))){data=stream.readAllBytes();}
                    short[] pcm=new short[data.length/2];ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm);
                    Bukkit.getScheduler().runTaskAsynchronously(this,()->{
                        OpusEncoder encoder=api.createEncoder();try{
                            for(int offset=0;offset<pcm.length;offset+=960){short[] frame=new short[960];System.arraycopy(pcm,offset,frame,0,Math.min(960,pcm.length-offset));audio.send(encoder.encode(frame));Thread.sleep(20);}
                            audio.reset();
                        }catch(Exception failure){getLogger().warning("QA_EMIT_FAILED "+failure.getClass().getSimpleName());}
                        finally{encoder.close();api.unregisterAudioSender(audio);}
                    });sender.sendMessage("QA_EMIT_STARTED "+actor.getName());
                }
                default->throw new IllegalArgumentException();
            }
        }catch(Exception failure){sender.sendMessage("QA_FAILED "+failure.getClass().getSimpleName());}
        return true;
    }
}
