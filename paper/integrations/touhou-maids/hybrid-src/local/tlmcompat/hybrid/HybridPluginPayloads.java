package local.tlmcompat.hybrid;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.events.*;
import io.netty.buffer.ByteBuf;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.plugin.Plugin;

/** Preserve Paper plugin message bytes when Youer's codec requires its own payload envelope. */
public final class HybridPluginPayloads implements AutoCloseable {
    private final PacketListener listener;
    public HybridPluginPayloads(Plugin plugin)throws ReflectiveOperationException{
        Class<?> type=Class.forName("com.mohistmc.youer.bukkit.messaging.PluginsDiscardedPayload",true,CustomPacketPayload.class.getClassLoader());
        Constructor<?> constructor=type.getConstructor(CustomPacketPayload.Type.class,byte[].class);
        Method getType=type.getMethod("getType",ResourceLocation.class);
        // A synchronous CUSTOM_PAYLOAD listener queues native asynchronous
        // transfers onto the game thread. Preserve their original transport
        // timing; this callback does not mutate player/world state or buffer indices.
        listener=new PacketAdapter(PacketAdapter.params().plugin(plugin).listenerPriority(ListenerPriority.HIGHEST)
                .types(PacketType.Play.Server.CUSTOM_PAYLOAD).optionAsync()){
            @Override public void onPacketSending(PacketEvent event){
                if(!(event.getPacket().getHandle() instanceof ClientboundCustomPayloadPacket packet))return;
                CustomPacketPayload payload=packet.payload();
                if(payload.type().id().getNamespace().equals("yes_steve_model"))return;
                if(!payload.getClass().getName().equals("net.minecraft.network.protocol.common.custom.DiscardedPayload"))return;
                // DiscardedPayload also carries native NeoForge mod transfers.
                // The Youer Bukkit envelope is only appropriate for channels
                // actually registered by Bukkit plugins. Rewrapping native YSM
                // chunks silently prevents the client from loading its models.
                if(!plugin.getServer().getMessenger().getOutgoingChannels().contains(payload.type().id().toString()))return;
                try{
                    Object data=payload.getClass().getMethod("data").invoke(payload);
                    if(!(data instanceof ByteBuf source))throw new IllegalStateException("Unsupported Paper payload byte container");
                    byte[] bytes=new byte[source.readableBytes()];source.getBytes(source.readerIndex(),bytes);
                    var converted=(CustomPacketPayload)constructor.newInstance(getType.invoke(null,payload.type().id()),bytes);
                    event.setPacket(new PacketContainer(PacketType.Play.Server.CUSTOM_PAYLOAD,new ClientboundCustomPayloadPacket(converted)));
                }catch(ReflectiveOperationException error){throw new IllegalStateException("Plugin payload envelope changed",error);}
            }
        };
        ProtocolLibrary.getProtocolManager().addPacketListener(listener);
    }
    @Override public void close(){ProtocolLibrary.getProtocolManager().removePacketListener(listener);}
}
