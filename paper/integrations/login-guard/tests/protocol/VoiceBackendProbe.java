package org.afuhome.auth;

import com.google.gson.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** NEVER ship: emits synthetic voice receipts/captions; does not perform TTS/ASR/playback. */
public final class VoiceBackendProbe extends JavaPlugin {
    static final String CHANNEL="mcagent:voice";
    final Map<UUID,String> states=new HashMap<>();
    int received;
    @Override public void onEnable(){
        if(!Boolean.getBoolean("voice.transport.qa") || !Files.isRegularFile(Path.of("voice-transport-qa.marker"))
                || !Bukkit.getIp().equals("127.0.0.1"))throw new IllegalStateException("Isolated loopback QA only");
        getServer().getMessenger().registerOutgoingPluginChannel(this,CHANNEL);
        getServer().getMessenger().registerIncomingPluginChannel(this,CHANNEL,(channel,p,bytes)->{
            if(bytes.length<2||bytes[0]!=1)return;
            received++;var row=JsonParser.parseString(new String(bytes,1,bytes.length-1,StandardCharsets.UTF_8)).getAsJsonObject();
            UUID id=UUID.fromString(row.get("requestId").getAsString());String op=row.get("op").getAsString();
            getLogger().info("VOICE_QA_REQUEST player="+p.getName()+" op="+op+" count="+received);
            if(op.equals("subscribe")){reply(p,id,"subscribed");return;}
            if(op.equals("status")){reply(p,id,states.getOrDefault(id,"not_found"));return;}
            if(!op.equals("say")){reply(p,id,"failed");return;}
            String terminal=row.get("text").getAsString();
            if(!Set.of("sent","failed","cancelled","unknown","lost").contains(terminal))terminal="sent";
            states.put(id,terminal.equals("lost")?"sent":terminal);reply(p,id,"queued");
            Bukkit.getScheduler().runTaskLater(this,()->reply(p,id,"playing"),2);
            if(!terminal.equals("lost")){String result=terminal;Bukkit.getScheduler().runTaskLater(this,()->reply(p,id,result),4);}
        });
        // Unsolicited backend messages also exercise denial in the S2C direction.
        Bukkit.getScheduler().runTaskTimer(this,()->{
            for(Player p:Bukkit.getOnlinePlayers())if(p.getListeningPluginChannels().contains(CHANNEL)){
                var row=new JsonObject();row.addProperty("type","nearby_voice");row.addProperty("utteranceId",UUID.randomUUID().toString());
                row.addProperty("speaker","qa_other");row.addProperty("text","一起去公会");send(p,row);
            }
        },20,20);
        getLogger().info("VOICE_QA_READY synthetic receipts; no speech engine");
    }
    void reply(Player p,UUID id,String state){
        var row=new JsonObject();row.addProperty("type","voice_result");row.addProperty("requestId",id.toString());
        row.addProperty("state",state);row.addProperty("reason","");send(p,row);
    }
    void send(Player p,JsonObject row){p.sendPluginMessage(this,CHANNEL,("\u0001"+row).getBytes(StandardCharsets.UTF_8));}
}
