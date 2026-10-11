package dev.qiandeng.bedrock.visuals;

import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.TimeUnit;
import org.geysermc.event.subscribe.Subscribe;
import org.geysermc.geyser.api.extension.Extension;
import org.geysermc.geyser.api.entity.custom.CustomEntityDefinition;
import org.geysermc.geyser.api.block.custom.*;
import org.geysermc.geyser.api.block.custom.component.*;
import org.geysermc.geyser.api.event.lifecycle.*;
import org.geysermc.geyser.api.event.bedrock.*;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.mcprotocollib.network.Session;
import org.geysermc.mcprotocollib.network.event.session.SessionAdapter;
import org.geysermc.mcprotocollib.network.packet.Packet;
import org.geysermc.mcprotocollib.protocol.packet.common.clientbound.ClientboundCustomPayloadPacket;
import org.geysermc.mcprotocollib.protocol.packet.common.serverbound.ServerboundCustomPayloadPacket;
import org.geysermc.geyser.platform.viaproxy.shaded.net.kyori.adventure.key.Key;
import org.cloudburstmc.protocol.bedrock.packet.*;
import org.cloudburstmc.protocol.bedrock.data.entity.*;
import org.cloudburstmc.math.vector.*;
import org.jose4j.json.internal.json_simple.parser.JSONParser;

/** Connection-local rendering only, pinned to Geyser 2.11.3 b1249. Helpers have
 * no collision or gameplay identity. Interaction always targets the original
 * Java block; original item components remain in the Gate's existing cache. */
public final class MawVisualsExtension implements Extension {
    private static final AtomicLong IDS=new AtomicLong(1L<<50);
    private record BlockModel(String entity,CustomBlockState state,Map<String,Object> row){}
    private record Helper(long id,String identifier){}
    private static final class View {
        final Map<Vector3i,Integer> blocks=new HashMap<>();
        final Map<String,Helper> helpers=new HashMap<>();
        boolean subscribed;String dimension="";long tick=-1,lastFrame=0;
    }
    private Map<String,Object> catalog;
    private final Map<Integer,BlockModel> blocks=new HashMap<>();
    private final Map<String,String> foods=new HashMap<>();
    private final Map<GeyserSession,View> views=Collections.synchronizedMap(new WeakHashMap<>());
    private boolean packLoaded,entitiesReady,blocksReady,logged;
    @SuppressWarnings("unchecked") static Map<String,Object> map(Object v){if(!(v instanceof Map<?,?>))throw new IllegalArgumentException("object_required");return (Map<String,Object>)v;}
    static Map<String,Object> json(byte[] v)throws Exception{return map(new JSONParser().parse(new String(v,StandardCharsets.UTF_8)));}
    static String text(Map<String,Object> v,String k){Object x=v.get(k);if(!(x instanceof String s)||s.length()>1024)throw new IllegalArgumentException("invalid_"+k);return s;}
    static double number(Map<String,Object> v,String k){Object x=v.get(k);if(!(x instanceof Number n)||!Double.isFinite(n.doubleValue()))throw new IllegalArgumentException("invalid_"+k);return n.doubleValue();}
    static int integer(Map<String,Object> v,String k){double n=number(v,k);if(n!=(int)n)throw new IllegalArgumentException("integer_"+k);return (int)n;}
    private void load(){if(catalog!=null)return;try{catalog=json(Files.readAllBytes(dataFolder().getParent().getParent().resolve("visual-catalog.json")));if(!Long.valueOf(1).equals(catalog.get("schemaVersion")))throw new IllegalArgumentException("schema");}catch(Exception e){throw new IllegalStateException("Native visual catalog rejected",e);}}
    @Subscribe public void packs(GeyserDefineResourcePacksEvent event){
        load();UUID id=UUID.fromString(text(catalog,"packUuid"));packLoaded=event.resourcePacks().stream().anyMatch(p->p.uuid().equals(id));
        if(!packLoaded)throw new IllegalStateException("Native scene resource pack missing");ready();
    }
    @Subscribe public void entities(GeyserDefineEntitiesEvent event){
        load();for(Object id:(List<?>)catalog.get("entities"))event.register(CustomEntityDefinition.of((String)id));
        map(catalog.get("foods")).forEach((id,value)->foods.put(id,text(map(value),"identifier")));entitiesReady=true;ready();
    }
    @Subscribe public void blocks(GeyserDefineCustomBlocksEvent event){
        load();for(Object raw:(List<?>)catalog.get("blocks")){
            var row=map(raw);int stateId=integer(row,"stateId");List<BoxComponent> collisions=new ArrayList<>();
            float[] bounds={16,16,16,0,0,0};
            for(Object item:(List<?>)row.get("collisionBoxes")){
                List<?> b=(List<?>)item;if(b.size()!=6)throw new IllegalArgumentException("shape_size");
                float[] f=new float[6];for(int i=0;i<6;i++)f[i]=((Number)b.get(i)).floatValue()*16;
                if(f[0]<0||f[1]<0||f[2]<0||f[3]>16||f[4]>16||f[5]>16)throw new IllegalArgumentException("shape_outside_block");
                collisions.add(new BoxComponent(f[0]-8,f[1],f[2]-8,f[3]-f[0],f[4]-f[1],f[5]-f[2]));
                for(int i=0;i<3;i++){bounds[i]=Math.min(bounds[i],f[i]);bounds[i+3]=Math.max(bounds[i+3],f[i+3]);}
            }
            var components=CustomBlockComponents.builder().displayName(text(row,"name"))
                .geometry(GeometryComponent.builder().identifier("geometry.maw_scene.empty").build())
                .materialInstance("*",MaterialInstance.builder().texture(text(row,"texture")).renderMethod("alpha_test").build())
                .selectionBox(collisions.isEmpty()?BoxComponent.emptyBox():new BoxComponent(bounds[0]-8,bounds[1],bounds[2]-8,bounds[3]-bounds[0],bounds[4]-bounds[1],bounds[5]-bounds[2]))
                .collisionBoxes(collisions.isEmpty()?List.of(BoxComponent.emptyBox()):collisions)
                .lightDampening(0).build();
            var block=CustomBlockData.builder().name("maw_scene_b"+stateId).includedInCreativeInventory(false).components(components).build();
            event.register(block);if(blocks.put(stateId,new BlockModel(text(row,"identifier"),block.defaultBlockState(),row))!=null)throw new IllegalArgumentException("duplicate_state");
        }blocksReady=true;ready();
    }
    private void ready(){if(!logged&&packLoaded&&entitiesReady&&blocksReady){logged=true;logger().info("MAW_VISUALS blocks="+blocks.size()+" entities="+((List<?>)catalog.get("entities")).size()+" packLoaded=true sceneHz=4 private=true");}}
    @Subscribe public void join(SessionJoinEvent event){
        if(!(event.connection() instanceof GeyserSession session)||session.getDownstream()==null)return;
        View view=new View();views.put(session,view);
        session.scheduleInEventLoop(()->expire(session,view),1,TimeUnit.SECONDS);
        session.getDownstream().getSession().addListener(new SessionAdapter(){@Override public void packetReceived(Session downstream,Packet packet){
            if(!(packet instanceof ClientboundCustomPayloadPacket p)||p.getData().length>65536)return;
            try{
                String channel=p.getChannel().asString();
                if(channel.equals("maw_agent:menu_state")&&!view.subscribed){
                    var body=json(p.getData());if(!session.playerEntity().uuid().toString().equals(body.get("playerUuid")))return;
                    view.subscribed=true;session.sendDownstreamGamePacket(new ServerboundCustomPayloadPacket(Key.key("maw_agent:scene_subscribe"),new byte[]{1}));
                }else if(channel.equals("maw_agent:scene_state")){
                    var body=json(p.getData());if(!Long.valueOf(1).equals(body.get("schemaVersion"))||!session.playerEntity().uuid().toString().equals(body.get("playerUuid")))return;
                    session.executeInEventLoop(()->{try{apply(session,view,body);}catch(RuntimeException e){logger().warning("Native scene rejected: "+e.getClass().getSimpleName());clear(session,view,true);}});
                }
            }catch(Exception e){logger().warning("Native scene payload rejected: "+e.getClass().getSimpleName());}
        }});
    }
    static int angle(double degrees){return (int)Math.round(((degrees%360+360)%360)*1000);}
    private void expire(GeyserSession session,View view){
        if(session.isClosed()||views.get(session)!=view)return;
        if(view.lastFrame>0&&System.currentTimeMillis()-view.lastFrame>1500){clear(session,view,true);view.lastFrame=0;}
        session.scheduleInEventLoop(()->expire(session,view),1,TimeUnit.SECONDS);
    }
    static double[] rotated(String axis,double degrees,double x,double y,double z){
        double r=Math.toRadians(degrees),s=Math.sin(r),c=Math.cos(r);
        return switch(axis){case "x"->new double[]{x,y*c-z*s,y*s+z*c};case "y"->new double[]{x*c+z*s,y,-x*s+z*c};case "z"->new double[]{x*c-y*s,x*s+y*c,z};default->throw new IllegalArgumentException("rotation_axis");};
    }
    private void update(GeyserSession session,Vector3i pos,org.cloudburstmc.protocol.bedrock.data.definitions.BlockDefinition definition){
        if(definition==null)throw new IllegalArgumentException("block_definition_missing");
        UpdateBlockPacket p=new UpdateBlockPacket();p.setBlockPosition(pos);p.setDataLayer(0);p.setDefinition(definition);p.getFlags().addAll(UpdateBlockPacket.FLAG_ALL_PRIORITY);session.sendUpstreamPacket(p);
    }
    private void restore(GeyserSession session,Vector3i pos){
        int state=session.getChunkCache().getBlockAt(pos.getX(),pos.getY(),pos.getZ());update(session,pos,session.getBlockMappings().getBedrockBlock(state));
    }
    private void remove(GeyserSession session,Helper h){RemoveEntityPacket p=new RemoveEntityPacket();p.setUniqueEntityId(h.id());session.sendUpstreamPacket(p);}
    private void clear(GeyserSession session,View view,boolean restore){
        for(Helper h:view.helpers.values())remove(session,h);view.helpers.clear();
        if(restore)for(Vector3i pos:view.blocks.keySet())restore(session,pos);view.blocks.clear();view.tick=-1;
    }
    private void helper(GeyserSession session,View view,Set<String> used,String key,String identifier,Vector3f position,int phase){
        if(used.size()>=128)return;used.add(key);Helper h=view.helpers.get(key);
        if(h!=null&&!h.identifier().equals(identifier)){remove(session,h);view.helpers.remove(key);h=null;}
        if(h==null){
            long id=IDS.incrementAndGet();h=new Helper(id,identifier);view.helpers.put(key,h);
            AddEntityPacket p=new AddEntityPacket();p.setUniqueEntityId(id);p.setRuntimeEntityId(id);p.setIdentifier(identifier);p.setPosition(position);p.setMotion(Vector3f.ZERO);p.setRotation(Vector2f.ZERO);
            var m=p.getMetadata();m.put(EntityDataTypes.SCALE,1f);m.put(EntityDataTypes.WIDTH,0f);m.put(EntityDataTypes.HEIGHT,0f);m.put(EntityDataTypes.MARK_VARIANT,phase);
            m.setFlag(EntityFlag.HAS_COLLISION,false);m.setFlag(EntityFlag.HAS_GRAVITY,false);m.setFlag(EntityFlag.SILENT,true);m.setFlag(EntityFlag.FIRE_IMMUNE,true);
            session.sendUpstreamPacket(p);
        }else{
            MoveEntityAbsolutePacket move=new MoveEntityAbsolutePacket();move.setRuntimeEntityId(h.id());move.setPosition(position);move.setRotation(Vector3f.ZERO);move.setOnGround(true);session.sendUpstreamPacket(move);
            SetEntityDataPacket data=new SetEntityDataPacket();data.setRuntimeEntityId(h.id());data.getMetadata().put(EntityDataTypes.MARK_VARIANT,phase);session.sendUpstreamPacket(data);
        }
    }
    private void apply(GeyserSession session,View view,Map<String,Object> scene){
        if(session.isClosed())return;String dimension=text(scene,"dimension");long tick=((Number)scene.get("serverTick")).longValue();
        if(!dimension.equals(view.dimension)){clear(session,view,false);view.dimension=dimension;}
        if(tick<view.tick)return;view.tick=tick;view.lastFrame=System.currentTimeMillis();
        Object rawBlocks=scene.get("blocks");if(!(rawBlocks instanceof List<?> list)||list.size()>24)throw new IllegalArgumentException("scene_block_budget");
        Set<Vector3i> seen=new HashSet<>();Set<String> used=new HashSet<>();var camera=session.playerEntity().position();
        for(Object raw:list){
            var row=map(raw);Vector3i pos=Vector3i.from(integer(row,"x"),integer(row,"y"),integer(row,"z"));
            if(Math.abs(pos.getX()-camera.getX())>18||Math.abs(pos.getY()-camera.getY())>18||Math.abs(pos.getZ()-camera.getZ())>18)continue;
            int stateId=integer(row,"stateId");BlockModel model=blocks.get(stateId);
            if(model==null||!text(row,"id").equals(model.row().get("name"))||!map(row.get("properties")).equals(map(model.row().get("properties"))))continue;
            seen.add(pos);view.blocks.put(pos,stateId);update(session,pos,session.getBlockMappings().getCustomBlockStateDefinitions().get(model.state()));
            String key=pos.toString();int phase=0;if(row.get("kinetic") instanceof Map<?,?> motion&&model.row().get("axis")!=null)phase=angle(number(map(motion),"angleDegrees"));
            helper(session,view,used,"block:"+key,model.entity(),Vector3f.from(pos.getX()+.5,pos.getY(),pos.getZ()+.5),phase);
            if(text(row,"id").equals("create:millstone")&&row.get("kinetic") instanceof Map<?,?> motion)
                helper(session,view,used,"inner:"+key,text(catalog,"millstoneInner"),Vector3f.from(pos.getX()+.5,pos.getY(),pos.getZ()+.5),angle(number(map(motion),"angleDegrees")));
            if(row.get("foods") instanceof List<?> items&&items.size()<=6)for(Object f:items){
                var food=map(f);int slot=integer(food,"slot");String id=foods.get(text(food,"id"));if(id==null||slot<0||slot>=6||number(food,"count")<1)continue;
                boolean board=text(row,"id").equals("farmersdelight:cutting_board");double x=board?0:(slot%3-1)*.29,z=board?0:(slot/3-.5)*.44;
                // A turn advances only with the real stove's cooking counter;
                // extinguishing the stove or removing the food stops it.
                int turn=board?0:angle(food.get("cookingTime") instanceof Number n?n.doubleValue()*3:0);
                helper(session,view,used,"food:"+key+":"+slot,id,Vector3f.from(pos.getX()+.5+x,pos.getY()+(board?.07:1.015),pos.getZ()+.5+z),turn);
            }
        }
        if(scene.get("contraptions") instanceof List<?> moving&&moving.size()<=4)for(Object raw:moving){
            var rotor=map(raw);if(!Boolean.TRUE.equals(rotor.get("available"))||!session.playerEntity().uuid().toString().equals(rotor.get("playerUuid"))||!dimension.equals(rotor.get("dimension")))continue;
            String uuid=text(rotor,"uuid");UUID.fromString(uuid);String axis=text(rotor,"rotationAxis");double degrees=number(rotor,"angleDegrees");
            var anchor=map(rotor.get("anchor"));double ax=number(anchor,"x"),ay=number(anchor,"y"),az=number(anchor,"z");
            if(Math.abs(ax-camera.getX())>34||Math.abs(ay-camera.getY())>34||Math.abs(az-camera.getZ())>34)continue;
            if(!(rotor.get("blocks") instanceof List<?> parts)||parts.size()<1||parts.size()>96||parts.size()!=integer(rotor,"blockCount")||used.size()+parts.size()>128)continue;
            var definitions=map(catalog.get("parts"));boolean supported=true;
            for(Object part:parts){var p=map(part);Object match=definitions.get(Integer.toString(integer(p,"stateId")));
                if(!(match instanceof Map<?,?>)||!Boolean.FALSE.equals(p.get("hasBlockEntity"))||!text(p,"id").equals(map(match).get("id"))||!map(p.get("properties")).equals(map(map(match).get("properties")))){supported=false;break;}
                if(Math.abs(integer(p,"x"))>32||Math.abs(integer(p,"y"))>32||Math.abs(integer(p,"z"))>32){supported=false;break;}
            }
            if(!supported)continue;
            for(Object part:parts){var p=map(part);int x=integer(p,"x"),y=integer(p,"y"),z=integer(p,"z");
                var model=map(definitions.get(Integer.toString(integer(p,"stateId"))));String id=text(map(model.get("entities")),axis);
                double[] at=rotated(axis,degrees,x,y,z);
                helper(session,view,used,"rotor:"+uuid+":"+x+":"+y+":"+z,id,Vector3f.from(ax+.5+at[0],ay+at[1],az+.5+at[2]),angle(degrees));
            }
        }
        for(var pos:new ArrayList<>(view.blocks.keySet()))if(!seen.contains(pos)){restore(session,pos);view.blocks.remove(pos);}
        for(var entry:new ArrayList<>(view.helpers.entrySet()))if(!used.contains(entry.getKey())){remove(session,entry.getValue());view.helpers.remove(entry.getKey());}
    }
    @Subscribe public void leave(SessionDisconnectEvent event){if(event.connection() instanceof GeyserSession s)views.remove(s);}
}
