package dev.qiandeng.bedrock.blocks;

import io.netty.buffer.*;
import io.netty.channel.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.InflaterInputStream;
import java.util.zip.Inflater;
import org.geysermc.event.subscribe.Subscribe;
import org.geysermc.geyser.api.extension.Extension;
import org.geysermc.geyser.api.block.custom.*;
import org.geysermc.geyser.api.block.custom.component.*;
import org.geysermc.geyser.api.block.custom.nonvanilla.*;
import org.geysermc.geyser.api.event.lifecycle.*;
import org.geysermc.geyser.api.event.bedrock.SessionJoinEvent;
import org.geysermc.geyser.api.item.custom.v2.NonVanillaCustomItemDefinition;
import org.geysermc.geyser.api.item.custom.v2.component.geyser.*;
import org.geysermc.geyser.api.item.custom.v2.component.java.JavaItemDataComponents;
import org.geysermc.geyser.api.util.Identifier;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.mcprotocollib.network.session.NetworkSession;
import org.geysermc.mcprotocollib.protocol.codec.MinecraftTypes;
import org.geysermc.mcprotocollib.protocol.data.game.level.block.BlockChangeEntry;
import org.geysermc.mcprotocollib.protocol.packet.common.clientbound.ClientboundCustomPayloadPacket;
import org.geysermc.mcprotocollib.protocol.packet.common.serverbound.ServerboundCustomPayloadPacket;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.level.*;
import org.geysermc.geyser.platform.viaproxy.shaded.net.kyori.adventure.key.Key;
import org.cloudburstmc.math.vector.Vector3i;
import org.jose4j.json.internal.json_simple.parser.JSONParser;

/** Pinned, connection-local presentation boundary. Native IDs cross the version
 * translator on a separate framed channel, then become registered virtual Java
 * states before Geyser translates the real chunk. No vanilla block is reserved,
 * no entity overlays and no gameplay/OP action are used by this extension. */
public final class NativeBlocksExtension implements Extension {
    private Map<String,Object> catalog;
    private final Set<Integer> allowed=new HashSet<>();
    private final Map<String,CustomBlockData> blocks=new HashMap<>();
    private final Map<String,Map<String,Object>> definitions=new HashMap<>();
    private final Map<Integer,CustomBlockState> virtualStates=new HashMap<>();
    private boolean packs,ready;
    private List<?> itemRows=List.of();
    private final Map<Integer,Integer> itemMarkers=new HashMap<>();
    private final Map<Integer,CustomBlockState> itemBlocks=new HashMap<>();
    @SuppressWarnings("unchecked") static Map<String,Object> map(Object v){if(!(v instanceof Map<?,?>))throw new IllegalArgumentException("object");return (Map<String,Object>)v;}
    static String text(Map<String,Object> r,String k){if(!(r.get(k) instanceof String s)||s.length()>512)throw new IllegalArgumentException(k);return s;}
    static int integer(Map<String,Object> r,String k){if(!(r.get(k) instanceof Number n)||n.doubleValue()!=n.intValue())throw new IllegalArgumentException(k);return n.intValue();}
    static float number(Map<String,Object> r,String k){if(!(r.get(k) instanceof Number n)||!Float.isFinite(n.floatValue()))throw new IllegalArgumentException(k);return n.floatValue();}
    static List<BoxComponent> boxes(Object raw){
        List<BoxComponent> out=new ArrayList<>();
        for(Object value:(List<?>)raw){var a=(List<?>)value;if(a.size()!=6)throw new IllegalArgumentException("shape");float[] f=new float[6];for(int i=0;i<6;i++)f[i]=((Number)a.get(i)).floatValue();
            out.add(new BoxComponent(f[0]*16-8,f[1]*16,f[2]*16-8,(f[3]-f[0])*16,(f[4]-f[1])*16,(f[5]-f[2])*16));}
        return out.isEmpty()?List.of(BoxComponent.emptyBox()):out;
    }
    static BoxComponent selection(Object raw){
        var rows=(List<?>)raw;if(rows.isEmpty())return BoxComponent.emptyBox();float[] b={Float.POSITIVE_INFINITY,Float.POSITIVE_INFINITY,Float.POSITIVE_INFINITY,Float.NEGATIVE_INFINITY,Float.NEGATIVE_INFINITY,Float.NEGATIVE_INFINITY};
        for(Object row:rows){var v=(List<?>)row;for(int i=0;i<3;i++){b[i]=Math.min(b[i],((Number)v.get(i)).floatValue());b[i+3]=Math.max(b[i+3],((Number)v.get(i+3)).floatValue());}}
        return new BoxComponent(b[0]*16-8,b[1]*16,b[2]*16-8,(b[3]-b[0])*16,(b[4]-b[1])*16,(b[5]-b[2])*16);
    }
    private void load(){if(catalog!=null)return;try{
        Path file=dataFolder().getParent().getParent().resolve("native-block-catalog.json");if(Files.size(file)>64*1024*1024)throw new IllegalArgumentException("catalog_budget");
        catalog=map(new JSONParser().parse(Files.readString(file,StandardCharsets.UTF_8)));if(integer(catalog,"schemaVersion")!=1)throw new IllegalArgumentException("schema");
        if(catalog.get("blockItems") instanceof List<?> rows)itemRows=rows;
    }catch(Exception e){throw new IllegalStateException("Native block catalog rejected",e);}}
    private CustomBlockComponents components(Map<String,Object> row){
        return CustomBlockComponents.builder().displayName(text(row,"displayName"))
            .geometry(GeometryComponent.builder().identifier(text(row,"geometry")).build())
            .materialInstance("*",MaterialInstance.builder().texture(text(row,"texture")).renderMethod(text(row,"renderMethod")).faceDimming(true).ambientOcclusion(true).build())
            .collisionBoxes(boxes(row.get("collisionBoxes"))).selectionBox(selection(row.get("selectionBoxes")))
            .lightEmission(integer(row,"lightEmission")).lightDampening(integer(row,"lightDampening")).friction(number(row,"friction")).build();
    }
    @Subscribe public void define(GeyserDefineCustomBlocksEvent event){
        load();for(Object raw:(List<?>)catalog.get("blocks")){
            var row=map(raw);var variants=(List<?>)row.get("variants");List<Integer> values=new ArrayList<>();List<CustomBlockPermutation> permutations=new ArrayList<>();
            for(Object v:variants){var variant=map(v);int n=integer(variant,"index");values.add(n);permutations.add(new CustomBlockPermutation(components(variant),"q.block_state('maw:variant') == "+n));}
            String identifier=text(row,"identifier");String[] key=identifier.split(":",2);
            var block=NonVanillaCustomBlockData.builder().namespace(key[0]).name(key[1]).includedInCreativeInventory(false)
                .intProperty("maw:variant",values).components(components(map(variants.get(0)))).permutations(permutations).build();
            event.register(block);definitions.put(identifier,row);if(blocks.put(identifier,block)!=null)throw new IllegalArgumentException("duplicate_block");
        }
        for(Object raw:(List<?>)catalog.get("states")){
            var r=map(raw);int javaId=integer(r,"javaId");if(javaId<65536||javaId>1048575||!allowed.add(javaId))throw new IllegalArgumentException("virtual_state");
            var definition=definitions.get(text(r,"block"));var variant=map(((List<?>)definition.get("variants")).get(integer(r,"variant")));
            JavaBoundingBox[] collision=((List<?>)variant.get("collisionBoxes")).stream().map(v->{var a=(List<?>)v;double[] p=new double[6];for(int i=0;i<6;i++)p[i]=((Number)a.get(i)).doubleValue();return new JavaBoundingBox((p[0]+p[3])/2,(p[1]+p[4])/2,(p[2]+p[5])/2,p[3]-p[0],p[4]-p[1],p[5]-p[2]);}).toArray(JavaBoundingBox[]::new);
            var state=JavaBlockState.builder().identifier(text(r,"nativeState")).javaId(javaId).stateGroupId(integer(definition,"stateGroupId"))
                .blockHardness(number(variant,"hardness")).waterlogged(Boolean.TRUE.equals(variant.get("waterlogged"))).collision(collision)
                .canBreakWithHand(Boolean.TRUE.equals(variant.get("canBreakWithHand"))).pickItem(text(definition,"name")).pistonBehavior("NORMAL").build();
            var target=blocks.get(text(r,"block")).blockStateBuilder().intProperty("maw:variant",integer(r,"variant")).build();
            virtualStates.put(javaId,target);event.registerOverride(state,target);
        }
        definitions.clear();catalog=Map.of("schemaVersion",1,"packUuid",text(catalog,"packUuid"));
        ready=true;logger().info("MAW_NATIVE_BLOCKS definitions="+blocks.size()+" states="+allowed.size()+" interceptor=true");
    }
    @Subscribe public void packs(GeyserDefineResourcePacksEvent event){load();UUID uuid=UUID.fromString(text(catalog,"packUuid"));packs=event.resourcePacks().stream().anyMatch(p->p.uuid().equals(uuid));if(!packs)throw new IllegalStateException("Native block pack missing");logger().info("MAW_NATIVE_BLOCKS packLoaded=true");}
    @Subscribe public void items(GeyserDefineCustomItemsEvent event){
        load();for(Object raw:itemRows){var row=map(raw);int marker=integer(row,"customModelData"),javaId=30000+integer(row,"nativeId");
            var item=NonVanillaCustomItemDefinition.builder(Identifier.of(text(row,"bedrockIdentifier")),javaId)
                .displayName(text(row,"displayName")).component(JavaItemDataComponents.MAX_STACK_SIZE,64)
                .component(GeyserItemDataComponents.BLOCK_PLACER,GeyserBlockPlacer.of(Identifier.of(text(row,"block")),true)).build();
            event.register(item);if(itemMarkers.put(marker,javaId)!=null)throw new IllegalArgumentException("duplicate_item_marker");
            itemBlocks.put(javaId,blocks.get(text(row,"block")).blockStateBuilder().intProperty("maw:variant",0).build());
        }
        logger().info("MAW_NATIVE_BLOCK_ITEMS registered="+itemRows.size()+" sourceGeometry=true");itemRows=List.of();
    }
    @Subscribe public void linkItems(GeyserPostInitializeEvent event){
        // The pinned non-vanilla item API emits the block_placer component but
        // leaves ItemMapping.bedrockBlockDefinition null. Complete that link
        // before any login so inventory, prediction and dropped items carry
        // the actual custom block runtime, not an unbound zero block ID.
        int versions=0;
        for(var entry:org.geysermc.geyser.registry.Registries.ITEMS.get().int2ObjectEntrySet()){
            var mappings=entry.getValue();var palette=org.geysermc.geyser.registry.BlockRegistries.BLOCKS.forVersion(entry.getIntKey());
            for(var item:itemBlocks.entrySet()){
                var definition=palette.getCustomBlockStateDefinitions().get(item.getValue());var old=mappings.getItems()[item.getKey()];
                if(definition==null||old==null)throw new IllegalStateException("native_block_item_link_missing");
                var linked=org.geysermc.geyser.registry.type.ItemMapping.builder().bedrockIdentifier(old.getBedrockIdentifier())
                    .bedrockDefinition(old.getBedrockDefinition()).bedrockData(old.getBedrockData()).bedrockBlockDefinition(definition)
                    .translationString(old.getTranslationString()).customItemDefinitions(old.getCustomItemDefinitions())
                    .containsV1Mappings(old.isContainsV1Mappings()).javaItem(old.getJavaItem()).build();
                mappings.getItems()[item.getKey()]=linked;
            }versions++;
        }
        logger().info("MAW_NATIVE_BLOCK_ITEMS linked="+itemBlocks.size()+" protocolVersions="+versions);
    }
    @Subscribe public void join(SessionJoinEvent event){
        if(!packs||!ready||!(event.connection() instanceof GeyserSession session)||session.getDownstream()==null)return;
        var downstream=session.getDownstream().getSession();var channel=downstream.getChannel();
        channel.eventLoop().execute(()->{
            var context=channel.pipeline().context(NetworkSession.class);if(context==null)throw new IllegalStateException("Pinned downstream pipeline unavailable");
            channel.pipeline().addBefore(context.name(),"maw-native-blocks",new Interceptor(session));
            session.sendDownstreamGamePacket(new ServerboundCustomPayloadPacket(Key.key("mawbedrock:blocks_ready"),new byte[]{1}));
        });
    }
    private record Section(int at,int[] positions,int[] states){}
    private record Chunk(int minY,List<Section> sections){}
    private final class Interceptor extends ChannelDuplexHandler {
        private final GeyserSession session;
        private final NativeBlockItems items=new NativeBlockItems(itemMarkers);
        private int traces;
        Interceptor(GeyserSession session){this.session=session;}
        private void trace(String kind,int x,int y,int z,int id){
            if(session==null||traces>=128||!Boolean.getBoolean("maw.nativeBlocks.trace"))return;
            var definition=session.getBlockMappings().getCustomBlockStateDefinitions().get(virtualStates.get(id));
            if(definition==null)throw new IllegalStateException("native_block_runtime_missing");
            traces++;logger().info("MAW_NATIVE_BLOCK_TRACE kind="+kind+" x="+x+" y="+y+" z="+z+" javaId="+id+" runtimeId="+definition.getRuntimeId());
        }
        private long sequence;
        private final Map<Long,Chunk> chunks=new HashMap<>();
        private final Map<Vector3i,Integer> updates=new HashMap<>();
        private long key(int x,int z){return ((long)x<<32)^(z&0xffffffffL);}
        private void frame(byte[] data)throws Exception{
            if(data.length<13||data.length>1024*1024)throw new IOException("frame_size");DataInputStream header=new DataInputStream(new ByteArrayInputStream(data));
            if(header.readInt()!=0x4d574231)throw new IOException("magic");int kind=header.readUnsignedByte();long seq=Integer.toUnsignedLong(header.readInt());int length=header.readInt();
            if(seq<=sequence||length<0||length>2*1024*1024)throw new IOException("frame_order");sequence=seq;
            byte[] raw;Inflater inflater=new Inflater(true);try(var stream=new InflaterInputStream(new ByteArrayInputStream(data,13,data.length-13),inflater)){raw=stream.readNBytes(length+1);}finally{inflater.end();}
            if(raw.length!=length)throw new IOException("frame_length");var input=new DataInputStream(new ByteArrayInputStream(raw));
            if(kind==1){int x=input.readInt(),z=input.readInt(),minY=input.readShort(),count=input.readUnsignedShort();if(count>64||chunks.size()>=512)throw new IOException("chunk_budget");List<Section> sections=new ArrayList<>();
                for(int i=0;i<count;i++){int at=input.readShort(),size=input.readUnsignedShort();if(at<0||at>=64||size>4096)throw new IOException("section_budget");int[] positions=new int[size],states=new int[size];boolean[] seen=new boolean[4096];
                    for(int j=0;j<size;j++){int pos=input.readUnsignedShort(),id=input.readInt();if(pos>=4096||seen[pos]||!allowed.contains(id))throw new IOException("cell");seen[pos]=true;positions[j]=pos;states[j]=id;}sections.add(new Section(at,positions,states));}
                chunks.put(key(x,z),new Chunk(minY,sections));
            }else if(kind==2){int count=input.readInt();if(count<0||count>65536||updates.size()+count>65536)throw new IOException("update_budget");for(int i=0;i<count;i++){var pos=Vector3i.from(input.readInt(),input.readInt(),input.readInt());int id=input.readInt();if(!allowed.contains(id))throw new IOException("update_state");updates.put(pos,id);}}
            else throw new IOException("frame_kind");if(input.available()!=0)throw new IOException("frame_trailing");
        }
        private BlockChangeEntry entry(BlockChangeEntry e){Integer id=updates.remove(e.getPosition());if(id==null)return e;trace("update",e.getPosition().getX(),e.getPosition().getY(),e.getPosition().getZ(),id);return new BlockChangeEntry(e.getPosition(),id);}
        @Override public void channelRead(ChannelHandlerContext context,Object packet)throws Exception{
            try{
                if(packet instanceof ClientboundCustomPayloadPacket p&&p.getChannel().asString().equals("mawbedrock:blocks")){frame(p.getData());return;}
                if(packet instanceof ClientboundLevelChunkWithLightPacket p){var override=chunks.remove(key(p.getX(),p.getZ()));if(override!=null&&!override.sections().isEmpty()){
                    ByteBuf in=Unpooled.wrappedBuffer(p.getChunkData()),out=Unpooled.buffer();try{
                        Map<Integer,Section> byIndex=new HashMap<>();for(var s:override.sections())byIndex.put(s.at(),s);int index=0;
                        while(in.isReadable()){if(index>=64)throw new IOException("sections");var section=MinecraftTypes.readChunkSection(in,32,32);var s=byIndex.get(index++);if(s!=null)for(int i=0;i<s.positions().length;i++){int pos=s.positions()[i];section.getBlockData().set(pos&15,(pos>>8)&15,(pos>>4)&15,s.states()[i]);trace("chunk",p.getX()*16+(pos&15),(override.minY()+s.at())*16+((pos>>8)&15),p.getZ()*16+((pos>>4)&15),s.states()[i]);}MinecraftTypes.writeChunkSection(out,section);}
                        for(int n:byIndex.keySet())if(n<0||n>=index)throw new IOException("section_count");byte[] bytes=new byte[out.readableBytes()];out.readBytes(bytes);packet=p.withChunkData(bytes);
                    }finally{in.release();out.release();}
                }}else if(packet instanceof ClientboundBlockUpdatePacket p)packet=p.withEntry(entry(p.getEntry()));
                else if(packet instanceof ClientboundSectionBlocksUpdatePacket p){var old=p.getEntries();var next=new BlockChangeEntry[old.length];for(int i=0;i<old.length;i++)next[i]=entry(old[i]);packet=p.withEntries(next);}
                else if(packet instanceof org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.ClientboundRespawnPacket){chunks.clear();updates.clear();}
                context.fireChannelRead(items.incoming(packet));
            }catch(Exception error){logger().warning("Native blocks rejected: "+error.getClass().getSimpleName()+"/"+error.getMessage());chunks.clear();updates.clear();context.close();}
        }
        @Override public void write(ChannelHandlerContext context,Object packet,ChannelPromise promise)throws Exception{
            try{context.write(items.outgoing(packet),promise);}catch(Exception error){promise.tryFailure(error);context.close();}
        }
    }
}
