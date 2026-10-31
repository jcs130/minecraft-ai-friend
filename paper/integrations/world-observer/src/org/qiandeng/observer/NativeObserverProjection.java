package org.qiandeng.observer;

import java.lang.reflect.*;
import java.util.*;
import net.minecraft.network.protocol.Packet;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.CraftServer;
import org.bukkit.craftbukkit.entity.CraftPlayer;

/** Match the native adapter's vanilla view; no new connection, entity, action or terrain query. */
final class NativeObserverProjection {
    private static Constructor<?> chunkConstructor;
    static Packet<?> chunk(net.minecraft.world.level.chunk.LevelChunk chunk,net.minecraft.world.level.lighting.LevelLightEngine light){
        try{
            if(chunkConstructor==null){
                Class<?> type=net.minecraft.network.protocol.game.ClientboundLevelChunkWithLightPacket.class;
                try{chunkConstructor=type.getConstructor(net.minecraft.world.level.chunk.LevelChunk.class,net.minecraft.world.level.lighting.LevelLightEngine.class,BitSet.class,BitSet.class);}
                catch(NoSuchMethodException paper){chunkConstructor=type.getConstructor(net.minecraft.world.level.chunk.LevelChunk.class,net.minecraft.world.level.lighting.LevelLightEngine.class,BitSet.class,BitSet.class,boolean.class);}
            }
            return (Packet<?>)(chunkConstructor.getParameterCount()==4?chunkConstructor.newInstance(chunk,light,null,null):chunkConstructor.newInstance(chunk,light,null,null,false));
        }catch(ReflectiveOperationException changed){throw new IllegalStateException("OBSERVER_CHUNK_CODEC_UNAVAILABLE",changed);}
    }
    /** Same scope as the native client's actual tracking view, excluding packets
     * still pending. Youer has no Paper getSentChunkKeys API. Never loads or
     * generates a chunk; never expands the observed player's view distance. */
    static Set<Long> sentChunks(org.bukkit.entity.Player player,int radius){
        if(!(player instanceof CraftPlayer craft)||radius<0||radius>8)return Set.of();
        var handle=craft.getHandle();if(handle.connection==null)return Set.of();
        int cx=player.getLocation().getBlockX()>>4,cz=player.getLocation().getBlockZ()>>4;
        Set<Long> sent=new HashSet<>();
        for(int x=cx-radius;x<=cx+radius;x++)for(int z=cz-radius;z<=cz+radius;z++){
            long key=net.minecraft.world.level.ChunkPos.asLong(x,z);
            if(handle.getChunkTrackingView().contains(x,z)&&!handle.connection.chunkSender.isPending(key))sent.add(key);
        }
        return sent;
    }
    private static boolean checked;
    private static Method method;
    private static Method itemMethod;
    private static RuntimeException unsupported;
    private static void initialize(){
        if(!checked){
            checked=true;
            try{
                Class<?> type=Class.forName("local.tlmcompat.numen.NativeClientProjection",false,net.minecraft.world.level.Level.class.getClassLoader());
                method=type.getMethod("forObserver",Packet.class,ServerPlayer.class,MinecraftServer.class);
                itemMethod=type.getMethod("item",net.minecraft.world.item.ItemStack.class);
                if(!Modifier.isStatic(method.getModifiers())||method.getReturnType()!=Packet.class)throw new NoSuchMethodException("Observer projection signature");
            }catch(ClassNotFoundException purePaper){/* Ordinary Paper needs no mod projection. */}
            catch(ReflectiveOperationException changed){unsupported=new IllegalStateException("NATIVE_OBSERVER_PROJECTION_UNSUPPORTED",changed);}
        }
        if(unsupported!=null)throw unsupported;
    }
    static net.minecraft.world.item.ItemStack item(net.minecraft.world.item.ItemStack source){
        initialize();if(itemMethod==null)return source;
        try{return (net.minecraft.world.item.ItemStack)itemMethod.invoke(null,source);}
        catch(ReflectiveOperationException failed){throw new IllegalStateException("NATIVE_OBSERVER_ITEM_PROJECTION_FAILED",failed);}
    }
    static Packet<?> project(UUID subject,Packet<?> packet){
        initialize();
        if(method==null)return packet;
        var player=Bukkit.getPlayer(subject);if(!(player instanceof CraftPlayer craft)||!player.isOnline())return null;
        try{return (Packet<?>)method.invoke(null,packet,craft.getHandle(),((CraftServer)Bukkit.getServer()).getServer());}
        catch(ReflectiveOperationException failed){throw new IllegalStateException("NATIVE_OBSERVER_PROJECTION_FAILED",failed);}
    }
}
