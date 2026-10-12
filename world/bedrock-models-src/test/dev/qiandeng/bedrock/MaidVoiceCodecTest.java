package dev.qiandeng.bedrock;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Standalone codec checks against the pinned extension + Geyser classpath. */
public final class MaidVoiceCodecTest {
    static final String ENTITY = "touhou_little_maid:play_maid_sound";
    static final String POSITION = ENTITY+"_at_pos";
    static int checks;
    static void require(boolean value) { if (!value) throw new AssertionError(); checks++; }
    static void varint(ByteArrayOutputStream out, int value) {
        do { int b=value & 127; value >>>= 7; out.write(b | (value==0?0:128)); } while (value!=0);
    }
    static ByteArrayOutputStream header(String event, String pack) throws Exception {
        var out=new ByteArrayOutputStream();
        for(String s: new String[]{event,pack}){byte[] bytes=s.getBytes(StandardCharsets.UTF_8);varint(out,bytes.length);out.write(bytes);}
        return out;
    }
    static byte[] entity(String event, String pack, int id) throws Exception {
        var out=header(event,pack);varint(out,id);return out.toByteArray();
    }
    static byte[] position(double x, float volume, float pitch) throws Exception {
        var bytes=header("touhou_little_maid:maid.ai.tamed","littlemaid_peco");
        var out=new DataOutputStream(bytes);out.writeDouble(x);out.writeDouble(-60);out.writeDouble(3.5);out.writeFloat(volume);out.writeFloat(pitch);
        return bytes.toByteArray();
    }
    static void rejected(String channel, byte[] bytes) throws Exception {
        try { MaidVoicePresentation.decode(channel,bytes); } catch (Exception expected) { checks++; return; }
        throw new AssertionError("Malformed voice packet accepted");
    }
    public static void main(String[] args) throws Exception {
        byte[] valid=entity("touhou_little_maid:maid.ai.hurt","touhou_little_maid",300);
        var cue=MaidVoicePresentation.decode(ENTITY,valid);
        require(cue.entityId()==300 && cue.pack().equals("touhou_little_maid") && cue.volume()==1 && cue.pitch()==1);
        var at=MaidVoicePresentation.decode(POSITION,position(-10.25,.5f,1.2f));
        require(at.entityId()==null && at.position().getX()==-10.25f && at.position().getY()==-60 && at.volume()==.5f && at.pitch()==1.2f);
        rejected(ENTITY,Arrays.copyOf(valid,valid.length-1));
        rejected(ENTITY,Arrays.copyOf(valid,valid.length+1));
        rejected(ENTITY,new byte[1025]);
        rejected(ENTITY,new byte[]{(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0x7f});
        rejected(ENTITY,new byte[]{1,(byte)0xff});
        rejected(ENTITY,entity("minecraft:entity.pig.ambient","touhou_little_maid",1));
        rejected(ENTITY,entity("touhou_little_maid:maid.ai.hurt","touhou_little_maid",-1));
        rejected(POSITION,position(Double.NaN,1,1));
        rejected(POSITION,position(1,-1,1));
        rejected(POSITION,position(1,1,Float.NaN));
        rejected("unregistered:channel",valid);
        System.out.println("{\"ok\":true,\"codecChecks\":"+checks+"}");
    }
}
