package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.plugin.messaging.PluginMessageListener;

/** Uses the authenticated player's connection and the existing owner-checked command parser. */
public final class NativeMaidTransport implements PluginMessageListener, Listener, AutoCloseable {
    public static final String REQUEST="qiandengji:maid_request";
    private static final Set<String> ACTIONS=Set.of("chat","talk","list","context","follow","stay","speak","receipt","inbox","ack","tasks","inventory","sit","task","schedule","pickup","transfer","equip","skins","skin","voices","voice","voice-test","mute","resources","resource-pack","rename");
    private final HybridMaidPlugin plugin;
    private final Map<UUID,ArrayDeque<Long>> requests=new HashMap<>();
    public NativeMaidTransport(HybridMaidPlugin plugin){
        this.plugin=plugin;
        plugin.getServer().getMessenger().registerIncomingPluginChannel(plugin,REQUEST,this);
        plugin.getServer().getPluginManager().registerEvents(this,plugin);
    }
    @EventHandler public void registered(PlayerRegisterChannelEvent event){
        if(!event.getChannel().equals(REQUEST)&&!event.getChannel().equals(HybridMaidPlugin.CHANNEL))return;
        Player actor=event.getPlayer();
        if(!actor.getListeningPluginChannels().contains(REQUEST)||!actor.getListeningPluginChannels().contains(HybridMaidPlugin.CHANNEL))return;
        JsonObject data=new JsonObject();data.addProperty("requestChannel",REQUEST);data.addProperty("maximumBytes",2048);data.addProperty("requestsPerSecond",16);
        plugin.reply(actor,"transport","transport",data,null);
    }
    @EventHandler public void quit(PlayerQuitEvent event){requests.remove(event.getPlayer().getUniqueId());}
    @Override public void onPluginMessageReceived(String channel,Player actor,byte[] bytes){
        if(!REQUEST.equals(channel)||bytes.length==0||bytes.length>2048)return;
        if(!Bukkit.isPrimaryThread()){byte[] copy=bytes.clone();Bukkit.getScheduler().runTask(plugin,()->handle(actor,copy));return;}
        handle(actor,bytes);
    }
    private void handle(Player actor,byte[] bytes){
        if(!actor.isOnline()||!actor.getListeningPluginChannels().contains(HybridMaidPlugin.CHANNEL))return;
        try{
            String decoded=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            JsonObject input=JsonParser.parseString(decoded).getAsJsonObject();
            if(!input.keySet().equals(Set.of("schema","protocol","command"))||!input.get("schema").isJsonPrimitive()||!input.getAsJsonPrimitive("schema").isNumber()||input.get("schema").getAsInt()!=1||!input.get("protocol").isJsonPrimitive()||!input.getAsJsonPrimitive("protocol").isString()||!input.get("protocol").getAsString().equals("qiandengji-maids/v1")||!input.get("command").isJsonPrimitive()||!input.getAsJsonPrimitive("command").isString())return;
            String command=input.get("command").getAsString();
            if(command.length()>256||!command.startsWith("/qdmaid ")||command.codePoints().anyMatch(Character::isISOControl))return;
            String[] args=command.substring(8).split(" +");if(args.length==0||!ACTIONS.contains(args[0]))return;
            long now=System.nanoTime();var window=requests.computeIfAbsent(actor.getUniqueId(),ignored->new ArrayDeque<>());
            while(!window.isEmpty()&&now-window.peekFirst()>=1_000_000_000L)window.removeFirst();
            if(window.size()>=16){
                int correlation=args[0].equals("list")?1:args[0].equals("receipt")?3:2;
                if(args.length>correlation&&args[correlation].matches("[A-Za-z0-9_-]{1,48}"))plugin.reply(actor,args[0],args[correlation],null,"rate_limited");return;
            }
            window.addLast(now);
            plugin.onCommand(actor,plugin.getCommand("qdmaid"),"qdmaid",args);
        }catch(RuntimeException|CharacterCodingException ignored){/* Invalid input is never dispatched. */}
    }
    @Override public void close(){plugin.getServer().getMessenger().unregisterIncomingPluginChannel(plugin,REQUEST,this);HandlerList.unregisterAll(this);requests.clear();}
}
