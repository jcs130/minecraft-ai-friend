package dev.qiandeng.bedrock.blocks;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.zip.*;
import io.netty.buffer.*;
import io.netty.channel.*;
import io.netty.channel.embedded.EmbeddedChannel;
import org.geysermc.mcprotocollib.protocol.codec.MinecraftTypes;
import org.geysermc.mcprotocollib.protocol.data.game.chunk.*;
import org.geysermc.mcprotocollib.protocol.data.game.level.block.*;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.level.*;
import org.geysermc.mcprotocollib.protocol.packet.common.clientbound.ClientboundCustomPayloadPacket;
import org.geysermc.geyser.platform.viaproxy.shaded.net.kyori.adventure.key.Key;
import org.cloudburstmc.math.vector.Vector3i;

public final class NativeBlocksProtocolTest {
    static int checks;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    static byte[] frame(int kind,int seq,byte[] raw)throws Exception{
        var bytes=new ByteArrayOutputStream();var header=new DataOutputStream(bytes);header.writeInt(0x4d574231);header.writeByte(kind);header.writeInt(seq);header.writeInt(raw.length);
        var compressed=new ByteArrayOutputStream();var d=new Deflater(1,true);try(var z=new DeflaterOutputStream(compressed,d)){z.write(raw);}finally{d.end();}header.write(compressed.toByteArray());return bytes.toByteArray();
    }
    static byte[] chunkOverride()throws Exception{
        var bytes=new ByteArrayOutputStream();var out=new DataOutputStream(bytes);out.writeInt(-2);out.writeInt(3);out.writeShort(-4);out.writeShort(1);out.writeShort(0);out.writeShort(1);out.writeShort((5<<8)|(6<<4)|7);out.writeInt(165535);return bytes.toByteArray();
    }
    public static void main(String[] args)throws Exception{
        var extension=new NativeBlocksExtension();Field allowed=NativeBlocksExtension.class.getDeclaredField("allowed");allowed.setAccessible(true);((Set<Integer>)allowed.get(extension)).add(165535);
        Class<?> type=Class.forName("dev.qiandeng.bedrock.blocks.NativeBlocksExtension$Interceptor");Constructor<?> constructor=type.getDeclaredConstructor(NativeBlocksExtension.class,org.geysermc.geyser.session.GeyserSession.class);constructor.setAccessible(true);Object interceptor=constructor.newInstance(extension,null);
        Method accept=type.getDeclaredMethod("frame",byte[].class);accept.setAccessible(true);
        var channel=new EmbeddedChannel((ChannelHandler)interceptor);
        byte[] message=frame(1,1,chunkOverride());check(!channel.writeInbound(new ClientboundCustomPayloadPacket(Key.key("mawbedrock:blocks"),message)),"private sidechannel consumed before translator");
        var section=new ChunkSection(4096,0,DataPalette.createForBlockState(1,32),DataPalette.createForBiome(6,32));ByteBuf wire=Unpooled.buffer();MinecraftTypes.writeChunkSection(wire,section);byte[] original=new byte[wire.readableBytes()];wire.readBytes(original);wire.release();
        var light=new org.geysermc.mcprotocollib.protocol.data.game.level.LightUpdateData(new BitSet(),new BitSet(),new BitSet(),new BitSet(),List.of(),List.of());
        var packet=new ClientboundLevelChunkWithLightPacket(-2,3,original,Map.of(),new BlockEntityInfo[0],light);check(channel.writeInbound(packet),"real chunk forwarded");var changed=(ClientboundLevelChunkWithLightPacket)channel.readInbound();
        ByteBuf input=Unpooled.wrappedBuffer(changed.getChunkData());var result=MinecraftTypes.readChunkSection(input,32,32);check(!input.isReadable(),"pinned 26.3 chunk format fully consumed");input.release();
        check(result.getBlock(7,5,6)==165535,"native virtual state restored with correct axis indexing");check(result.getBlock(6,5,6)==1,"ordinary vanilla cell untouched");check(result.getBiomeData().get(0,0,0)==6,"biome preserved");check(result.getBlockCount()==4096&&result.getFluidCount()==0,"block/fluid counts preserved");check(Arrays.equals(original,packet.getChunkData()),"original chunk bytes immutable");
        var bytes=new ByteArrayOutputStream();var out=new DataOutputStream(bytes);out.writeInt(1);out.writeInt(-31);out.writeInt(-29);out.writeInt(48);out.writeInt(165535);
        channel.writeInbound(new ClientboundCustomPayloadPacket(Key.key("mawbedrock:blocks"),frame(2,2,bytes.toByteArray())));
        var position=Vector3i.from(-31,-29,48);channel.writeInbound(new ClientboundBlockUpdatePacket(new BlockChangeEntry(position,1)));var update=(ClientboundBlockUpdatePacket)channel.readInbound();check(update.getEntry().equals(new BlockChangeEntry(position,165535)),"single update patched by absolute position");
        channel.writeInbound(new ClientboundBlockUpdatePacket(new BlockChangeEntry(position,0)));check(((ClientboundBlockUpdatePacket)channel.readInbound()).getEntry().equals(new BlockChangeEntry(position,0)),"vanilla air removal not overwritten by stale native state");
        try{accept.invoke(interceptor,(Object)message);throw new AssertionError("replayed sequence");}catch(InvocationTargetException e){check(e.getCause() instanceof IOException,"replayed sequence rejected");}
        byte[] invalid=frame(1,3,chunkOverride());invalid[0]=0;try{accept.invoke(interceptor,(Object)invalid);throw new AssertionError("magic");}catch(InvocationTargetException e){check(e.getCause() instanceof IOException,"corrupt frame rejected");}
        channel.finishAndReleaseAll();System.out.println("NativeBlocksProtocolTest checks="+checks);
        var projection=new NativeBlockItems(Map.of(8003858,33858));
        var components=new org.geysermc.mcprotocollib.protocol.data.game.item.component.DataComponents(new HashMap<>());
        components.put(org.geysermc.mcprotocollib.protocol.data.game.item.component.DataComponentTypes.CUSTOM_MODEL_DATA,new org.geysermc.mcprotocollib.protocol.data.game.item.component.CustomModelData(List.of(8003858f),List.of(),List.of(),List.of()));
        var originalItem=new org.geysermc.mcprotocollib.protocol.data.game.item.ItemStack(1,3,components);var display=projection.forward(originalItem);
        check(display.getId()==33858&&display.getAmount()==3,"native block item receives its dedicated presentation identity");check(originalItem.getId()==1,"source item identity unchanged");check(projection.restore(display).equals(originalItem),"complete original component patch restored");
        var hashed=new org.geysermc.mcprotocollib.protocol.data.game.item.HashedStack(33858,3,Map.of(org.geysermc.mcprotocollib.protocol.data.game.item.component.DataComponentTypes.CUSTOM_NAME,123),Set.of());
        var restored=projection.restore(hashed);check(restored.id()==1&&restored.count()==3&&restored.addedComponents().equals(hashed.addedComponents()),"latest protocol inventory hashes survive inverse projection");
        check(projection.forward(new org.geysermc.mcprotocollib.protocol.data.game.item.ItemStack(2,5)).getId()==2,"ordinary vanilla item remains identical");
        try{new NativeBlockItems(Map.of(8003858,33858)).restore(hashed);throw new AssertionError("unobserved virtual item");}catch(IllegalStateException e){check(true,"client cannot inject an unobserved presentation item");}
        System.out.println("NativeBlocksAndItemsProtocolTest checks="+checks);
    }
}
