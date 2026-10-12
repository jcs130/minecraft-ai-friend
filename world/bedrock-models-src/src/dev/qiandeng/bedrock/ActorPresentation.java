package dev.qiandeng.bedrock;

import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.geyser.entity.type.Entity;
import org.cloudburstmc.protocol.bedrock.packet.*;
import org.cloudburstmc.protocol.bedrock.data.entity.*;
import org.cloudburstmc.math.vector.*;

/** Finite connection-local presentation. No surrogate gameplay entity, commands
 * or model calls. Existing server entity IDs/UUIDs must match before rendering. */
final class ActorPresentation {
    interface Models {
        Map<String,String> animations(int id,UUID uuid,Map<String,Object> actor);
    }
    private static final AtomicLong IDS=new AtomicLong(1L<<51);
    private static final List<String> POSES=List.of("idle","walk","run","jump","sit","sleep","swim","sneak","fly");
    private record Bubble(long id,String text){}
    private static final class Actor {UUID uuid;int pose=-1;boolean swinging;float bodyYaw=Float.NaN,headYaw=Float.NaN,pitch=Float.NaN;String model="",label="";Bubble bubble;long until;Vector3f position;}
    private final GeyserSession session;private final Models models;
    private final Map<Integer,Actor> actors=new HashMap<>();
    private String dimension="";private long tick=-1,lastFrame;
    ActorPresentation(GeyserSession session,Models models){this.session=session;this.models=models;expireLater();}
    private void expireLater(){session.scheduleInEventLoop(()->{
        if(session.isClosed())return;long now=System.currentTimeMillis();
        if(lastFrame>0&&now-lastFrame>2000)clear();
        else for(Actor a:actors.values())if(a.bubble!=null&&a.until<=now)removeBubble(a);
        expireLater();
    },500,TimeUnit.MILLISECONDS);}
    @SuppressWarnings("unchecked") private static Map<String,Object> map(Object v){if(!(v instanceof Map<?,?>))throw new IllegalArgumentException("actor_object");return (Map<String,Object>)v;}
    private static String text(Map<String,Object> m,String k){Object v=m.get(k);if(!(v instanceof String s)||s.length()>1024)throw new IllegalArgumentException("actor_text");return s;}
    private static double number(Map<String,Object> m,String k){Object v=m.get(k);if(!(v instanceof Number n)||!Double.isFinite(n.doubleValue()))throw new IllegalArgumentException("actor_number");return n.doubleValue();}
    private Entity entity(int id,UUID uuid){Entity e=session.getEntityCache().getEntityByJavaId(id);
        if(e==null&&id==session.getPlayerEntity().getEntityId())e=session.getPlayerEntity();
        return e!=null&&e.isValid()&&uuid.equals(e.uuid())?e:null;}
    private void removeBubble(Actor a){if(a.bubble!=null){RemoveEntityPacket p=new RemoveEntityPacket();p.setUniqueEntityId(a.bubble.id);session.sendUpstreamPacket(p);a.bubble=null;}}
    void remove(int id){Actor a=actors.remove(id);if(a!=null){removeBubble(a);Entity e=entity(id,a.uuid);if(e!=null){
        e.getMetadata().put(EntityDataTypes.NAME,e.getNametag());e.getMetadata().put(EntityDataTypes.VARIANT,0);e.updateBedrockMetadata();
        var animations=models.animations(id,a.uuid,Map.of());if(animations!=null)animate(e,animations.get("idle"),"maw_body","0");
    }}}
    void clear(){for(int id:new ArrayList<>(actors.keySet()))remove(id);tick=-1;lastFrame=0;}
    private void animate(Entity e,String animation,String controller,String stop){
        if(animation==null)return;AnimateEntityPacket p=new AnimateEntityPacket();p.setAnimation(animation);p.setController(controller);p.setNextState("default");
        p.setStopExpression(stop);p.setStopExpressionVersion(0);p.setBlendOutTime(.12f);p.getRuntimeEntityIds().add(e.geyserId());session.sendUpstreamPacket(p);
    }
    static String wrap(String input){
        String text=input.replaceAll("§.","").replaceAll("[\\p{Cntrl}\\p{Cf}]"," ").strip();StringBuilder out=new StringBuilder("§f「");
        int width=1,lines=1,count=0;
        for(int cp:text.codePoints().toArray()){
            if(++count>160){out.append('…');break;}int w=cp>255?2:1;
            if(width+w>32){if(lines++>=5){out.append('…');break;}out.append('\n');width=0;}
            out.appendCodePoint(cp);width+=w;
        }return out.append("」\n§7▾").toString();
    }
    private void bubble(Actor a,Vector3f position,String text,long remaining){
        if(a.bubble==null){long id=IDS.incrementAndGet();a.bubble=new Bubble(id,text);
            AddEntityPacket p=new AddEntityPacket();p.setUniqueEntityId(id);p.setRuntimeEntityId(id);p.setIdentifier("minecraft:armor_stand");
            p.setPosition(position);p.setMotion(Vector3f.ZERO);p.setRotation(Vector2f.ZERO);var meta=p.getMetadata();
            meta.put(EntityDataTypes.NAME,text);meta.put(EntityDataTypes.NAMETAG_ALWAYS_SHOW,(byte)1);meta.put(EntityDataTypes.SCALE,.01f);meta.put(EntityDataTypes.WIDTH,0f);meta.put(EntityDataTypes.HEIGHT,0f);
            meta.setFlag(EntityFlag.INVISIBLE,true);meta.setFlag(EntityFlag.CAN_SHOW_NAME,true);meta.setFlag(EntityFlag.ALWAYS_SHOW_NAME,true);
            meta.setFlag(EntityFlag.HAS_COLLISION,false);meta.setFlag(EntityFlag.HAS_GRAVITY,false);meta.setFlag(EntityFlag.SILENT,true);session.sendUpstreamPacket(p);
        }else{
            if(!text.equals(a.bubble.text)){SetEntityDataPacket p=new SetEntityDataPacket();p.setRuntimeEntityId(a.bubble.id);p.getMetadata().put(EntityDataTypes.NAME,text);session.sendUpstreamPacket(p);a.bubble=new Bubble(a.bubble.id,text);}
            if(a.position==null||position.distanceSquared(a.position)>.0001f){MoveEntityAbsolutePacket p=new MoveEntityAbsolutePacket();p.setRuntimeEntityId(a.bubble.id);p.setPosition(position);p.setRotation(Vector3f.ZERO);p.setOnGround(false);session.sendUpstreamPacket(p);}
        }a.position=position;a.until=System.currentTimeMillis()+remaining;
    }
    void frame(Map<String,Object> scene){
        if(!Long.valueOf(1).equals(scene.get("actorVisualVersion")))return;
        String dim=text(scene,"dimension");long current=((Number)scene.get("serverTick")).longValue();
        if(!dimension.equals(dim)){clear();dimension=dim;}if(current<tick)return;tick=current;
        if(!(scene.get("actors") instanceof List<?> list)||list.size()>24)throw new IllegalArgumentException("actor_budget");
        lastFrame=System.currentTimeMillis();Set<Integer> seen=new HashSet<>();var camera=session.playerEntity().position();
        for(Object raw:list){
            var row=map(raw);int id=((Number)row.get("entityId")).intValue();UUID uuid=UUID.fromString(text(row,"uuid"));Entity e=entity(id,uuid);if(e==null)continue;
            var pos=map(row.get("position"));Vector3f at=Vector3f.from(number(pos,"x"),number(pos,"y"),number(pos,"z"));if(at.distanceSquared(camera)>1600)continue;
            int pose=((Number)row.get("pose")).intValue();if(pose<0||pose>=POSES.size())throw new IllegalArgumentException("actor_pose");
            Actor a=actors.get(id);if(a!=null&&!a.uuid.equals(uuid)){remove(id);a=null;}if(a==null){a=new Actor();a.uuid=uuid;actors.put(id,a);}seen.add(id);
            Map<String,String> animations=models.animations(id,uuid,row);String model=animations==null?"":animations.getOrDefault("idle","");
            boolean changed=pose!=a.pose||!model.equals(a.model);if(changed)e.getMetadata().put(EntityDataTypes.VARIANT,pose);
            if("touhou_little_maid:maid".equals(row.get("type"))){
                float body=(float)number(row,"bodyYaw"),head=(float)number(row,"headYaw"),pitch=(float)number(row,"pitch");
                if(Float.isNaN(a.bodyYaw)||Math.abs(body-a.bodyYaw)>.5f||Math.abs(head-a.headYaw)>.5f||Math.abs(pitch-a.pitch)>.5f){
                    e.setYaw(body);e.setHeadYaw(head);e.setPitch(pitch);
                    MoveEntityAbsolutePacket move=new MoveEntityAbsolutePacket();move.setRuntimeEntityId(e.geyserId());
                    move.setPosition(e.bedrockPosition());move.setRotation(Vector3f.from(pitch,body,head));move.setOnGround(pose!=3&&pose!=8);session.sendUpstreamPacket(move);
                    a.bodyYaw=body;a.headYaw=head;a.pitch=pitch;
                }
            }
            String label="§f"+text(row,"name");if(row.get("role") instanceof String role&&!role.equals(row.get("name")))label+=" §7· "+role;
            if(!label.equals(a.label)){e.getMetadata().put(EntityDataTypes.NAME,label);e.getMetadata().put(EntityDataTypes.NAMETAG_ALWAYS_SHOW,(byte)1);e.setFlag(EntityFlag.CAN_SHOW_NAME,true);a.label=label;}
            e.updateBedrockMetadata();
            // Custom maid entities run their pack controller. Real player skins
            // need explicit global clip playback because vanilla player.entity
            // has no knowledge of the YSM bone names.
            if(animations!=null&&"minecraft:player".equals(row.get("type"))&&changed){
                animate(e,animations.get(POSES.get(pose)),"maw_body","query.variant != "+pose);
                if(!model.equals(a.model)){animate(e,animations.get("look"),"maw_look","0");animate(e,animations.get("blink"),"maw_blink","0");}
            }
            boolean swinging=Boolean.TRUE.equals(row.get("swinging"));if(animations!=null&&swinging&&!a.swinging)animate(e,animations.get("attack"),"maw_attack","query.all_animations_finished");
            a.pose=pose;a.model=model;a.swinging=swinging;
            Map<String,Object> chosen=null;
            if(row.get("bubbles") instanceof List<?> bubbles&&bubbles.size()<=3)for(Object b:bubbles){var item=map(b);if(number(item,"remainingMs")<=0)continue;
                if(chosen==null||number(item,"priority")>=number(chosen,"priority"))chosen=item;}
            if(chosen==null)removeBubble(a);else bubble(a,at.add(0,(float)Math.max(.5,Math.min(5,number(row,"height")))+.55f,0),wrap(text(chosen,"text")),(long)Math.min(30000,number(chosen,"remainingMs")));
        }
        for(int id:new ArrayList<>(actors.keySet()))if(!seen.contains(id))remove(id);
    }
}
