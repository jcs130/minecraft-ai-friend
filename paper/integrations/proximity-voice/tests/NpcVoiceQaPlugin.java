package dev.god.godvoice;
import com.google.gson.*;
import de.maxhenkel.voicechat.api.*;
import de.maxhenkel.voicechat.api.events.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import javax.sound.sampled.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only loopback fixture. Never included in a release artifact. */
public final class NpcVoiceQaPlugin extends JavaPlugin {
    private volatile VoicechatServerApi api;
    public void onEnable(){
        if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=54848||!Files.isRegularFile(Path.of(".resident-hybrid-qa")))throw new IllegalStateException("synthetic stage only");
        getDataFolder().mkdirs();
        Bukkit.getServicesManager().load(BukkitVoicechatService.class).registerPlugin(new VoicechatPlugin(){
            public String getPluginId(){return "npc_voice_qa";}
            public void registerEvents(EventRegistration r){r.registerEvent(VoicechatServerStartedEvent.class,e->api=e.getVoicechat());}
        });
        getCommand("npcvoiceqa").setExecutor((sender,command,label,args)->{
            if(sender instanceof Player)return true;
            try{
                var service=Bukkit.getPluginManager().getPlugin("QiandengVoice");
                switch(args[0]){
                    case "profiles"->sender.sendMessage((String)service.getClass().getMethod("npcVoiceProfiles").invoke(service));
                    case "group"->{var id=Bukkit.getPlayerExact(args[1]).getUniqueId();var connection=api.getConnectionOf(id);connection.setGroup(args[2].equals("on")?api.createGroup("isolated-voice-qa","private-qa"):null);sender.sendMessage("QA_GROUP "+api.getConnectionOf(id).isInGroup());}
                    case "receipt"->sender.sendMessage((String)service.getClass().getMethod("npcSpeechStatus",UUID.class,String.class).invoke(service,UUID.fromString(args[1]),args[2]));
                    case "outbox"->{var p=Bukkit.getPlayer(UUID.fromString(args[1]));Object handle=p.getClass().getMethod("getHandle").invoke(p);sender.sendMessage(handle.getClass().getClassLoader().loadClass("com.dwinovo.numen.hosted.api.brain.HostedSpeech").getMethod("read",UUID.class).invoke(null,p.getUniqueId()).toString());}
                    case "encode"->{
                        Path file=safe(args[1]);byte[] pcm;try(var in=AudioSystem.getAudioInputStream(file.toFile())){
                            if(in.getFormat().getSampleRate()!=48000||in.getFormat().getChannels()!=1||in.getFormat().getSampleSizeInBits()!=16)throw new IllegalArgumentException("48k mono PCM required");pcm=in.readAllBytes();}
                        var values=new short[pcm.length/2];ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(values);
                        var result=new JsonArray();var encoder=api.createEncoder();try{for(int i=0;i<values.length;i+=960){short[] frame=new short[960];System.arraycopy(values,i,frame,0,Math.min(960,values.length-i));result.add(Base64.getEncoder().encodeToString(encoder.encode(frame)));}}finally{encoder.close();}
                        Files.writeString(safe(args[2]),result.toString());sender.sendMessage("QA_ENCODED "+result.size());
                    }
                    case "decode"->{
                        var rows=JsonParser.parseString(Files.readString(safe(args[1]))).getAsJsonArray();var out=new ByteArrayOutputStream();var decoder=api.createDecoder();
                        try{for(var row:rows){short[] pcm=decoder.decode(Base64.getDecoder().decode(row.getAsString()));var bytes=ByteBuffer.allocate(pcm.length*2).order(ByteOrder.LITTLE_ENDIAN);bytes.asShortBuffer().put(pcm);out.write(bytes.array());}}finally{decoder.close();}
                        byte[] pcm=out.toByteArray();try(var stream=new AudioInputStream(new ByteArrayInputStream(pcm),new AudioFormat(48000,16,1,true,false),pcm.length/2)){AudioSystem.write(stream,AudioFileFormat.Type.WAVE,safe(args[2]).toFile());}sender.sendMessage("QA_DECODED "+rows.size());
                    }
                    default->throw new IllegalArgumentException("unknown QA action");
                }
            }catch(Exception e){getLogger().warning("QA failure "+e);sender.sendMessage("QA_FAILED "+e.getClass().getSimpleName());}
            return true;
        });
    }
    private Path safe(String name){if(!name.matches("[a-zA-Z0-9_.-]{1,80}"))throw new IllegalArgumentException("basename only");return getDataFolder().toPath().resolve(name);}
}
