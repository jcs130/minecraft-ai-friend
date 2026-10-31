package org.afuhome.appearance;

import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import org.bukkit.entity.Player;

/** Pinned, optional native adapter. Observation never creates an attachment. */
final class NativeYsm {
    static final String VERSION="2.6.5", PROTOCOL="2.6.0", SOURCE="ysm_native_backend";
    static final String JAR_SHA="b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb";
    private static final String DATA_CLASS="com.elfmcys.yesstevemodel.O0o0OoOOooOo0O0OOoo0Oo00";
    private static final String DATA_SHA="77bc096ba6bf15738420d2d148c037b7b4a6f213c5af35230acd849b7484578d";
    record State(Object body,String model,String texture,boolean disabled,boolean mandatory) {}
    record Pick(String model,List<String> textures) {}
    private Context context;
    private boolean attempted;
    private String reason="YSM_NATIVE_NOT_OBSERVED";
    private String diagnostic="not_observed";
    private record Context(ClassLoader loader,Class<?> attachment,Object modelType,Object ownedType,
                           Class<?> data,Method model,Method texture,Method disabled,Method mandatory,
                           Class<?> packet,Constructor<?> request,Method select,Class<?> registry) {}

    private static Object invoke(Object value,String name) throws ReflectiveOperationException {
        return value.getClass().getMethod(name).invoke(value);
    }
    private static String hash(InputStream input) throws Exception {
        if(input==null)throw new IOException("Missing native class resource");
        try(input){return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.readAllBytes()));}
    }
    private static Object attachment(Object registry,Class<?> idType,String name) throws Exception {
        Object id=idType.getMethod("fromNamespaceAndPath",String.class,String.class).invoke(null,"yes_steve_model",name);
        return ((Optional<?>)registry.getClass().getMethod("getOptional",idType).invoke(registry,id)).orElse(null);
    }
    private Context bind(Object body) throws Exception {
        ClassLoader loader=body.getClass().getClassLoader();
        Class<?> modsType=Class.forName("net.neoforged.fml.ModList",false,loader);
        Object mods=modsType.getMethod("get").invoke(null);
        Object container=((Optional<?>)modsType.getMethod("getModContainerById",String.class).invoke(mods,"yes_steve_model")).orElseThrow();
        String version=invoke(invoke(container,"getModInfo"),"getVersion").toString();
        if(!"2.6.5-neoforge+mc1.21.1".equals(version))throw new IOException("Native version mismatch");
        Object file=invoke(modsType.getMethod("getModFileById",String.class).invoke(mods,"yes_steve_model"),"getFile");
        Path path=(Path)invoke(file,"getFilePath");
        if(!Files.isRegularFile(path)||Files.size(path)!=63_463_229||!JAR_SHA.equals(hash(Files.newInputStream(path))))throw new IOException("Native artifact mismatch");
        Class<?> data=Class.forName(DATA_CLASS,false,loader);
        if(!DATA_SHA.equals(hash(data.getResourceAsStream("/"+DATA_CLASS.replace('.','/')+".class"))))throw new IOException("Native attachment mismatch");
        Class<?> id=Class.forName("net.minecraft.resources.ResourceLocation",false,loader);
        Object registry=Class.forName("net.neoforged.neoforge.registries.NeoForgeRegistries",false,loader).getField("ATTACHMENT_TYPES").get(null);
        Class<?> packet=Class.forName("com.elfmcys.yesstevemodel.o00o000O0Ooooo0o0OOoo0oO",false,loader);
        var methods=Arrays.stream(packet.getMethods()).filter(method->method.getName().equals("oOo0OO0O0o000OO0O000oo0o")
            &&Modifier.isStatic(method.getModifiers())&&method.getReturnType()==void.class&&method.getParameterCount()==3
            &&method.getParameterTypes()[0]==packet&&method.getParameterTypes()[1].isInstance(body)).toList();
        if(methods.size()!=1)throw new IOException("Native selection signature mismatch");
        Object modelType=attachment(registry,id,"model_id");if(modelType==null)throw new IOException("Native model attachment missing");
        return new Context(loader,Class.forName("net.neoforged.neoforge.attachment.AttachmentType",false,loader),
            modelType,attachment(registry,id,"own_models"),data,
            data.getMethod("oOoo00O0o0oO0o0oO00OO0O0"),data.getMethod("OO000o0ooOooooOOOOO0Ooo0"),
            data.getMethod("O0o0OoOOooOo0O0OOoo0Oo00"),data.getMethod("OOo0O00Ooo00O0Ooo0OoOo0o"),
            packet,packet.getConstructor(String.class,String.class),methods.getFirst(),
            Class.forName("com.elfmcys.yesstevemodel.O0Ooo000O0ooO00Oooo00oOO",false,loader));
    }
    private Optional<?> existing(Object body,Object type) throws Exception {
        return (Optional<?>)body.getClass().getMethod("getExistingData",context.attachment).invoke(body,type);
    }
    State read(Player player) {
        try {
            Object body=invoke(player,"getHandle");
            if(context==null&&!attempted){attempted=true;context=bind(body);}
            if(context==null){reason="YSM_NATIVE_VERIFICATION_FAILED";return null;}
            if(!context.select.getParameterTypes()[1].isInstance(body))throw new IOException("Native body type changed");
            Object value=existing(body,context.modelType).orElse(null);
            if(value==null){reason="YSM_NATIVE_ATTACHMENT_UNINITIALIZED";return null;}
            if(value.getClass()!=context.data)throw new IOException("Native data class changed");
            String model=(String)context.model.invoke(value),texture=(String)context.texture.invoke(value);
            if(!ModelCatalog.validId(model)||texture==null||!texture.matches("[\\p{L}\\p{N}_.-]{1,96}")){reason="YSM_NATIVE_STATE_UNSUPPORTED";return null;}
            reason=null;return new State(body,model,texture,(boolean)context.disabled.invoke(value),(boolean)context.mandatory.invoke(value));
        }catch(Exception|LinkageError invalid){reason="YSM_NATIVE_VERIFICATION_FAILED";diagnostic=invalid.getClass().getSimpleName()+":"+String.valueOf(invalid.getMessage());return null;}
    }
    String reason(){return reason==null?"YSM_NATIVE_STATE_UNAVAILABLE":reason;}
    String diagnostic(){return diagnostic.length()>200?diagnostic.substring(0,200):diagnostic;}
    Map<String,List<String>> catalog(Player player) throws Exception {
        State current=read(player);if(current==null)throw new IOException("Native state unavailable");
        Map<?,?> registry=(Map<?,?>)context.registry.getMethod("oOo0OO0O0o000OO0O000oo0o").invoke(null);
        Collection<?> licensed=(Collection<?>)context.registry.getMethod("oOoo00O0o0oO0o0oO00OO0O0").invoke(null);
        if(registry.size()>4096)throw new IOException("Native catalog budget");
        Object owned=context.ownedType==null?null:existing(current.body,context.ownedType).orElse(null);
        Map<String,List<String>> choices=new TreeMap<>();
        for(var entry:registry.entrySet()){
            if(!(entry.getKey() instanceof String id)||!ModelCatalog.validId(id))continue;
            if(licensed.contains(id)&&(owned==null||!Boolean.TRUE.equals(owned.getClass().getMethod("OO000o0ooOooooOOOOO0Ooo0",String.class).invoke(owned,id))))continue;
            Object definition=invoke(entry.getValue(),"oOoo00O0o0oO0o0oO00OO0O0");
            Object list=invoke(definition,"oOoo00O0o0oO0o0oO00OO0O0");
            if(!(list instanceof Collection<?> textures)||textures.isEmpty()||textures.size()>24)continue;
            List<String> valid=new ArrayList<>();
            for(Object item:textures)if(item instanceof String texture&&texture.matches("[\\p{L}\\p{N}_.-]{1,96}"))valid.add(texture);
            if(valid.size()==textures.size())choices.put(id,List.copyOf(valid));
        }
        return choices;
    }
    /** Invoke the original ordinary-player handler on this exact body. No console target or auth grant. */
    void select(Player player,State expected,String model,String texture) throws Exception {
        State before=read(player);
        if(before==null||before.body!=expected.body||!before.model.equals(expected.model)||!before.texture.equals(expected.texture)
                ||before.disabled!=expected.disabled||before.mandatory!=expected.mandatory)throw new IOException("Native appearance changed");
        if(!catalog(player).getOrDefault(model,List.of()).contains(texture))throw new IOException("Native choice unavailable");
        Object listener=before.body.getClass().getField("connection").get(before.body);
        Object connection=invoke(listener,"getConnection");
        if(!context.select.getParameterTypes()[2].isInstance(connection))throw new IOException("Native body connection unavailable");
        context.select.invoke(null,context.request.newInstance(model,texture),before.body,connection);
    }
}
