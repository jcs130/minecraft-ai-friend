package org.afuhome.agentfriend;

import com.comphenix.protocol.events.*;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundBossEventPacket;
import net.minecraft.world.BossEvent;

/** Pins the existing Paper 1.21.1 packet API, as does the native Eye mirror.
 * WorldEvents 1.8.30 ignores boss-bar.update-interval-ticks (hardcoded timer),
 * so enforce the budget on actual outgoing packets rather than a dead config. */
final class ActivityBarLimiter {
    private final ConcurrentHashMap<UUID,ConcurrentHashMap<UUID,ActivityBarBudget>> clients=new ConcurrentHashMap<>();
    void forget(UUID id){clients.remove(id);}
    void clear(){clients.clear();}
    private static BossEvent bar(UUID id,String title,float progress,BossEvent.BossBarColor color,BossEvent.BossBarOverlay overlay) {
        BossEvent b=new BossEvent(id,Component.literal(title),color,overlay){};b.setProgress(progress);return b;
    }
    void filter(PacketEvent event) {
        if(!(event.getPacket().getHandle() instanceof ClientboundBossEventPacket packet))return;
        var states=clients.computeIfAbsent(event.getPlayer().getUniqueId(),ignored->new ConcurrentHashMap<>());
        packet.dispatch(new ClientboundBossEventPacket.Handler(){
            @Override public void add(UUID id,Component name,float progress,BossEvent.BossBarColor color,BossEvent.BossBarOverlay overlay,boolean dark,boolean music,boolean fog){
                String title=name.getString(),label=ActivityBarBudget.label(title);
                if(label==null){states.remove(id);return;}
                ActivityBarBudget state=new ActivityBarBudget(label,progress,title);states.put(id,state);
                BossEvent b=bar(id,state.title(),state.progress(),color,overlay);b.setDarkenScreen(dark).setPlayBossMusic(music).setCreateWorldFog(fog);
                event.setPacket(PacketContainer.fromPacket(ClientboundBossEventPacket.createAddPacket(b)));
            }
            @Override public void remove(UUID id){states.remove(id);}
            @Override public void updateProgress(UUID id,float progress){
                ActivityBarBudget state=states.get(id);if(state==null)return;
                if(!state.updateProgress(progress)){event.setCancelled(true);return;}
                event.setPacket(PacketContainer.fromPacket(ClientboundBossEventPacket.createUpdateProgressPacket(
                        bar(id,state.title(),state.progress(),BossEvent.BossBarColor.WHITE,BossEvent.BossBarOverlay.PROGRESS))));
            }
            @Override public void updateName(UUID id,Component name){
                // Adventure first creates an empty bar, then supplies its name.
                ActivityBarBudget state=states.get(id);
                String title=name.getString(),label=ActivityBarBudget.label(title);
                if(label==null){states.remove(id);return;}
                boolean changed=state==null || !state.label.equals(label);
                if(changed){state=new ActivityBarBudget(label,1,title);states.put(id,state);}
                if(!changed && !state.updateTitle(title)){event.setCancelled(true);return;}
                event.setPacket(PacketContainer.fromPacket(ClientboundBossEventPacket.createUpdateNamePacket(
                        bar(id,state.title(),state.progress(),BossEvent.BossBarColor.WHITE,BossEvent.BossBarOverlay.PROGRESS))));
            }
        });
    }
}
