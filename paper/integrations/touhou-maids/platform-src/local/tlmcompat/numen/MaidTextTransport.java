package local.tlmcompat.numen;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.*;
import net.minecraft.ChatFormatting;
import net.minecraft.network.ConnectionProtocol;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.neoforge.network.registration.NetworkRegistry;

/** Forward an actually displayed public bubble, never a prompt, thinking text or owner-only LLM response. */
public final class MaidTextTransport {
    private record Seen(String text,long at){}
    private static final LinkedHashMap<UUID,Seen> RECENT=new LinkedHashMap<>();
    private static final ResourceLocation MODEL=ResourceLocation.fromNamespaceAndPath("touhou_little_maid","maid_model");
    public static void visible(EntityMaid maid,String key){
        var server=maid.getServer();if(server==null||key==null||key.isBlank())return;
        server.execute(()->{
            if(!maid.isAlive()||maid.isRemoved())return;
            String text=VanillaMaidView.plain(Component.translatable(key)).replaceAll("[\\p{Cntrl}]"," ").strip();
            if(text.isBlank())return;if(text.length()>512)text=text.substring(0,512);
            long now=System.nanoTime();var previous=RECENT.get(maid.getUUID());
            if(previous!=null&&previous.text().equals(text)&&now-previous.at()<1_000_000_000L)return;
            RECENT.remove(maid.getUUID());RECENT.put(maid.getUUID(),new Seen(text,now));
            while(RECENT.size()>256)RECENT.remove(RECENT.keySet().iterator().next());
            var label=VanillaMaidView.name(maid);
            var message=Component.literal("[附近] ").withStyle(ChatFormatting.GRAY).append(label).append("：").append(Component.literal(text).withStyle(ChatFormatting.WHITE));
            for(var player:server.getPlayerList().getPlayers()){
                if(player.level()!=maid.level()||player.distanceToSqr(maid)>144)continue;
                if(NetworkRegistry.hasChannel(player.connection.getConnection(),ConnectionProtocol.PLAY,MODEL))continue;
                player.sendSystemMessage(message);
            }
        });
    }
}
