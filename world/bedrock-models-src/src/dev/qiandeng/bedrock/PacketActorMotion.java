package dev.qiandeng.bedrock;

import java.util.*;
import java.util.concurrent.TimeUnit;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.geyser.entity.type.Entity;
import org.cloudburstmc.protocol.bedrock.packet.AnimateEntityPacket;
import org.cloudburstmc.protocol.bedrock.packet.MoveEntityAbsolutePacket;
import org.cloudburstmc.protocol.bedrock.data.entity.EntityDataTypes;
import org.cloudburstmc.math.vector.Vector3f;

/** Uses the already downloaded original model pack's motion controller.
 * Missing movement packets expire walking; they never leave an NPC walking
 * forever. Server UUIDs, AI, hit targets and positions are not replaced. */
final class PacketActorMotion {
    interface Models { Map<String,String> animations(int id,UUID uuid); }
    private static final class State { UUID uuid;long sequence,until;int pose;boolean swinging,scheduled; }
    private final GeyserSession session;private final Models models;
    private final Map<Integer,State> states=new HashMap<>();
    PacketActorMotion(GeyserSession session,Models models){this.session=session;this.models=models;}
    void clear(){states.clear();}
    void remove(int id){states.remove(id);}
    private Entity entity(int id,UUID uuid){Entity e=session.getEntityCache().getEntityByJavaId(id);return e!=null&&e.isValid()&&uuid.equals(e.uuid())?e:null;}
    private void animate(Entity e,String animation){
        if(animation==null)return;AnimateEntityPacket p=new AnimateEntityPacket();p.setAnimation(animation);p.setController("maw_attack");
        p.setNextState("default");p.setStopExpression("query.all_animations_finished");p.setStopExpressionVersion(0);p.setBlendOutTime(.12f);
        p.getRuntimeEntityIds().add(e.geyserId());session.sendUpstreamPacket(p);
    }
    private void expire(int id,State expected){
        if(session.isClosed()||states.get(id)!=expected)return;long left=expected.until-System.currentTimeMillis();
        if(left>0){session.scheduleInEventLoop(()->expire(id,expected),left,TimeUnit.MILLISECONDS);return;}
        expected.scheduled=false;Entity e=entity(id,expected.uuid);
        if(e!=null&&(expected.pose==1||expected.pose==2)){
            expected.pose=0;e.getMetadata().put(EntityDataTypes.VARIANT,0);e.updateBedrockMetadata();
        }
        expected.swinging=false;
    }
    void receive(ActorMotionFrame frame){
        Entity e=entity(frame.entityId(),frame.uuid());if(e==null)return;
        Map<String,String> clips=models.animations(frame.entityId(),frame.uuid());if(clips==null)return;
        State state=states.get(frame.entityId());
        if(state!=null&&!state.uuid.equals(frame.uuid())){states.remove(frame.entityId());state=null;}
        if(state==null){if(states.size()>=256)return;state=new State();state.uuid=frame.uuid();states.put(frame.entityId(),state);}
        if(frame.sequence()<=state.sequence)return;state.sequence=frame.sequence();state.until=System.currentTimeMillis()+frame.leaseMs();
        e.getMetadata().put(EntityDataTypes.VARIANT,frame.pose());e.updateBedrockMetadata();
        e.setYaw(frame.bodyYaw());e.setHeadYaw(frame.headYaw());e.setPitch(frame.pitch());
        MoveEntityAbsolutePacket move=new MoveEntityAbsolutePacket();move.setRuntimeEntityId(e.geyserId());move.setPosition(e.bedrockPosition());
        move.setRotation(Vector3f.from(frame.pitch(),frame.bodyYaw(),frame.headYaw()));
        move.setOnGround(frame.onGround()==null?e.isOnGround():frame.onGround());session.sendUpstreamPacket(move);
        if(frame.swinging()&&!state.swinging)animate(e,clips.get("attack"));
        state.pose=frame.pose();state.swinging=frame.swinging();
        if(!state.scheduled){state.scheduled=true;State expected=state;session.scheduleInEventLoop(()->expire(frame.entityId(),expected),frame.leaseMs(),TimeUnit.MILLISECONDS);}
    }
}
