package dev.qiandeng.bedrock;

import java.util.Map;
import java.util.UUID;

/** Packet-derived, connection-local presentation only. No AI or game action. */
record ActorMotionFrame(int entityId, UUID uuid, long sequence, int pose, boolean moving,
        boolean swinging, float bodyYaw, float headYaw, float pitch, Boolean onGround, int leaseMs) {
    private static double number(Map<String,Object> value,String key) {
        if(!(value.get(key) instanceof Number n)||!Double.isFinite(n.doubleValue()))throw new IllegalArgumentException("actor_motion_number");
        return n.doubleValue();
    }
    private static long integer(Map<String,Object> value,String key,long min,long max) {
        double n=number(value,key);if(n!=Math.rint(n)||n<min||n>max)throw new IllegalArgumentException("actor_motion_integer");return (long)n;
    }
    private static boolean flag(Map<String,Object> value,String key) {
        if(!(value.get(key) instanceof Boolean b))throw new IllegalArgumentException("actor_motion_flag");return b;
    }
    static ActorMotionFrame decode(Map<String,Object> value) {
        if(integer(value,"schemaVersion",1,1)!=1||!"same_connection_native_entity_packets".equals(value.get("source")))throw new IllegalArgumentException("actor_motion_source");
        if(!(value.get("uuid") instanceof String text)||!text.matches("(?i)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))throw new IllegalArgumentException("actor_motion_uuid");
        UUID uuid=UUID.fromString(text);
        float body=(float)number(value,"bodyYaw"),head=(float)number(value,"headYaw"),pitch=(float)number(value,"pitch");
        if(Math.abs(body)>180||Math.abs(head)>180||Math.abs(pitch)>180)throw new IllegalArgumentException("actor_motion_rotation");
        if(value.get("onGround")!=null&&!(value.get("onGround") instanceof Boolean))throw new IllegalArgumentException("actor_motion_ground");
        return new ActorMotionFrame((int)integer(value,"entityId",0,Integer.MAX_VALUE),uuid,
            integer(value,"sequence",1,9007199254740991L),(int)integer(value,"pose",0,8),
            flag(value,"moving"),flag(value,"swinging"),body,head,pitch,(Boolean)value.get("onGround"),(int)integer(value,"leaseMs",100,1000));
    }
}
