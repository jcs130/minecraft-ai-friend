package dev.qiandeng.maw.numenserver;

import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import java.lang.reflect.*;

/** Optional in-process adapter: minimal Numen installations still work. */
final class NativeModBridge {
    final Method catalog, invoke;
    NativeModBridge() throws ReflectiveOperationException {
        Class<?> api=Class.forName("dev.qiandeng.maw.NativeModAccess");
        catalog=api.getMethod("catalog",String.class);
        invoke=api.getMethod("invoke",ServerPlayer.class,String.class,JsonObject.class,boolean.class,String.class);
        catalog("");
    }
    JsonObject catalog(String id) {return call(catalog,id);}
    JsonObject invoke(ServerPlayer player,String id,JsonObject args,boolean readOnly,String requestId) {return call(invoke,player,id,args,readOnly,requestId);}
    private JsonObject call(Method method,Object...args) {
        try{return ((JsonObject)method.invoke(null,args)).deepCopy();}
        catch(InvocationTargetException e){if(e.getCause() instanceof RuntimeException r)throw r;throw new IllegalStateException("native_mod_execution_failed",e.getCause());}
        catch(ReflectiveOperationException e){throw new IllegalStateException("native_mod_bridge_unavailable",e);}
    }
}
