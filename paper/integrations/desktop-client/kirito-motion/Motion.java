package qd.kirito;

import com.elfmcys.yesstevemodel.O0OOo0OoOoo0o0o0oO000o00;
import com.elfmcys.yesstevemodel.OOOOo0o0oOooO0oO0O00oOoO;
import com.elfmcys.yesstevemodel.Oo00OOooo0Ooo000ooooOOOo;
import com.elfmcys.yesstevemodel.OoO0O00OoOOo00OoOoO0o0O0;
import com.elfmcys.yesstevemodel.O0o00O0oO000O0oOOO0OoOoo;
import com.elfmcys.yesstevemodel.O000oOo0o0OOo0000oooo0O0;
import com.elfmcys.yesstevemodel.O0o0o00O00oOOoOo0OOo0O0o;
import com.elfmcys.yesstevemodel.oOOo0ooOOoo0ooOo0o0O0o00;
import com.elfmcys.yesstevemodel.o00oo0OoooOoO00oOO00oOOO;
import com.elfmcys.yesstevemodel.Ooo0oOoO0oooOoo0O0OO0O0O;
import com.elfmcys.yesstevemodel.ooOoOOooOoooOoooo0oO0Oo0;
import com.google.gson.*;
import com.mojang.logging.LogUtils;
import net.neoforged.fml.loading.FMLPaths;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

/** Adapts our numeric Bedrock keyframes to the 2.6.5 client animation objects. */
public final class Motion {
    private Motion() {}
    private record Clip(float ticks, Map<String, Oo00OOooo0Ooo000ooooOOOo> bones) {}
    private static final Map<String,Clip> clips=load();
    public static Set<String> keys() { return clips.keySet(); }
    public static boolean fits(O0OOo0OoOoo0o0o0oO000o00 rig) {
        var required=new HashSet<>(List.of("Chest","DownBody","RightLowerArm","LeftLowerArm","RightFoot","LeftFoot"));
        for(var b:rig.oOo0OO0O0o000OO0O000oo0o()) required.remove(b.oOo0OO0O0o000OO0O000oo0o());
        return required.isEmpty();
    }
    private static Map<String,Clip> load() {
        var input=Motion.class.getResourceAsStream("/assets/qd_kirito_motion/animations/kirito.animation.json");
        Map<String,Clip> bundled;
        try(var reader=new InputStreamReader(Objects.requireNonNull(input),StandardCharsets.UTF_8)) {
            bundled=readClips(reader,null);
        } catch(IOException error) { throw new UncheckedIOException(error); }
        var edited=FMLPaths.CONFIGDIR.get().resolve("qd_kirito_motion/kirito.animation.json");
        if(Files.isRegularFile(edited)) {
            try(var reader=Files.newBufferedReader(edited,StandardCharsets.UTF_8)) {
                var overrides=readClips(reader,bundled.keySet());
                bundled.putAll(overrides);
                LogUtils.getLogger().info("Loaded {} edited Kirito motion clips",overrides.size());
            } catch(IOException|RuntimeException error) {
                LogUtils.getLogger().warn("Could not read {}. Using the bundled Kirito motions.",edited,error);
            }
        }
        return Map.copyOf(bundled);
    }
    private static Map<String,Clip> readClips(Reader reader,Set<String> allowed) {
        var clips=new LinkedHashMap<String,Clip>();
        var animations=JsonParser.parseReader(reader).getAsJsonObject().getAsJsonObject("animations");
        for(var entry:animations.entrySet()) {
            if(allowed!=null && !allowed.contains(entry.getKey())) continue;
            var a=entry.getValue().getAsJsonObject();
            float ticks=20*a.get("animation_length").getAsFloat();
            if(!Float.isFinite(ticks)||ticks<=0) throw new IllegalArgumentException("Invalid length for "+entry.getKey());
            var bones=new LinkedHashMap<String,Oo00OOooo0Ooo000ooooOOOo>();
            for(var e:a.getAsJsonObject("bones").entrySet()){
                var b=e.getValue().getAsJsonObject();
                bones.put(e.getKey(),new Oo00OOooo0Ooo000ooooOOOo(e.getKey(),curve(b.get("rotation"),true),
                          curve(b.get("position"),false),List.of()));
            }
            clips.put(entry.getKey(),new Clip(ticks,bones));
        }
        return clips;
    }

    private record Key(float tick,O0o00O0oO000O0oOOO0OoOoo value,boolean smooth) {}
    private static O0o00O0oO000O0oOOO0OoOoo vector(JsonArray a,boolean rotation) {
        float x=a.get(0).getAsFloat(),y=a.get(1).getAsFloat(),z=a.get(2).getAsFloat();
        if(!Float.isFinite(x)||!Float.isFinite(y)||!Float.isFinite(z)) throw new IllegalArgumentException("Invalid pose");
        float deg=(float)(Math.PI/180);
        float vx=rotation?-x*deg:-x, vy=rotation?-y*deg:y, vz=rotation?z*deg:z;
        return new O0o00O0oO000O0oOOO0OoOoo(context->vx,context->vy,context->vz);
    }
    private static List<OoO0O00OoOOo00OoOoO0o0O0> curve(JsonElement channel,boolean rotation) {
        if(channel==null) return List.of();
        var keys=new ArrayList<Key>();
        if (channel.isJsonArray()) keys.add(new Key(0,vector(channel.getAsJsonArray(),rotation),false));
        else for(var e:channel.getAsJsonObject().entrySet()){
            var value=e.getValue();
            boolean smooth=value.isJsonObject() && value.getAsJsonObject().has("lerp_mode")
                    && "catmullrom".equals(value.getAsJsonObject().get("lerp_mode").getAsString());
            if(value.isJsonObject()) {
                var key=value.getAsJsonObject();
                value=key.has("post")?key.get("post"):key.get("vector");
            }
            float tick=20*Float.parseFloat(e.getKey());
            if(!Float.isFinite(tick)||tick<0) throw new IllegalArgumentException("Invalid keyframe time");
            keys.add(new Key(tick,vector(value.getAsJsonArray(),rotation),smooth));
        }
        if(keys.isEmpty()) return List.of();
        keys.sort(Comparator.comparing(Key::tick));
        var first=keys.getFirst();
        if(keys.size()==1) return List.of(new O0o0o00O00oOOoOo0OOo0O0o(0,first.value,first.value));
        var frames=new ArrayList<OoO0O00OoOOo00OoOoO0o0O0>();
        frames.add(new O0o0o00O00oOOoOo0OOo0O0o(first.tick,first.value,first.value));
        int last=keys.size()-1;
        for(int i=0;i<last;i++){
            var a=keys.get(i);var b=keys.get(i+1);
            float span=b.tick-a.tick;
            if(a.smooth||b.smooth){
                var before=keys.get(i>0?i-1:Math.max(0,last-1)).value;
                var after=keys.get(i+2<=last?i+2:Math.min(1,last)).value;
                frames.add(new O000oOo0o0OOo0000oooo0O0(a.tick,span,before,a.value,b.value,after,b.value));
            }else{
                frames.add(new oOOo0ooOOoo0ooOo0o0O0o00(a.tick,span,a.value,b.value,b.value));
            }
        }
        return frames;
    }
    @SuppressWarnings({"rawtypes","unchecked"})
    public static OOOOo0o0oOooO0oO0O00oOoO attach(String key,OOOOo0o0oOooO0oO0O00oOoO original) {
        var data=clips.get(key);
        var remaining=new LinkedHashMap<>(data.bones);
        var tracks=new ArrayList<Oo00OOooo0Ooo000ooooOOOo>();
        for(var old:original.oOOO00ooO0oOOoOOo0OoOOOo) {
            var add=remaining.remove(old.oOo0OO0O0o000OO0O000oo0o);
            if(add==null) tracks.add(old);
            else tracks.add(new Oo00OOooo0Ooo000ooooOOOo(old.oOo0OO0O0o000OO0O000oo0o,
                    add.OO000o0ooOooooOOOOO0Ooo0.isEmpty()?old.OO000o0ooOooooOOOOO0Ooo0:add.OO000o0ooOooooOOOOO0Ooo0,
                    add.OOo0o0000Ooo0o00OO0oOOoO.isEmpty()?old.OOo0o0000Ooo0o00OO0oOOoO:add.OOo0o0000Ooo0o00OO0oOOoO,
                    old.Oo0O0OoOo0O0oOoo0000O0oO));
        }
        tracks.addAll(remaining.values());
        return new OOOOo0o0oOooO0oO0O00oOoO(original.oOo0OO0O0o000OO0O000oo0o,data.ticks,
                ooOoOOooOoooOoooo0oO0Oo0.oOo0OO0O0o000OO0O000oo0o,
                original.OOo0o0000Ooo0o00OO0oOOoO,original.Oo0O0OoOo0O0oOoo0000O0oO,original.O0o0OoOOooOo0O0OOoo0Oo00,
                original.OoooO0OO0000O00oo0Oo00OO,tracks.toArray(Oo00OOooo0Ooo000ooooOOOo[]::new),
                original.ooOooOO0oO00o00o0o0oOOoO.toArray(new o00oo0OoooOoO00oOO00oOOO[0]),
                original.OOo0O00Ooo00O0Ooo0OoOo0o.toArray(Ooo0oOoO0oooOoo0O0OO0O0O[]::new),
                original.OO0Oo0O00OOOo0oOo0oooooO.toArray(new o00oo0OoooOoO00oOO00oOOO[0]));
    }
}
