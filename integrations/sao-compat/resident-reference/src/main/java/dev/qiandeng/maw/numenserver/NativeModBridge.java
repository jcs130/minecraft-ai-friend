package dev.qiandeng.maw.numenserver;

import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import java.lang.reflect.*;

/** Optional in-process adapter: minimal Numen installations still work. */
final class NativeModBridge {
    final Method catalog, invoke, viewer, bodySnapshot;
    NativeModBridge() throws ReflectiveOperationException {
        this("dev.qiandeng.maw.NativeModAccess");
    }
    NativeModBridge(String provider) throws ReflectiveOperationException {
        Class<?> api=Class.forName(provider);
        catalog=api.getMethod("catalog",String.class);
        invoke=api.getMethod("invoke",ServerPlayer.class,String.class,JsonObject.class,boolean.class,String.class);
        viewer=provider.equals("dev.qiandeng.maw.NativeModAccess")
            ?Class.forName("dev.qiandeng.maw.NativeViewerAccess").getMethod("snapshot",ServerPlayer.class,JsonObject.class):null;
        Method snapshot=null;
        try { snapshot=api.getMethod("bodySnapshot",ServerPlayer.class); }
        catch(NoSuchMethodException olderBridge) { /* Older installed bridges retain separate reads. */ }
        bodySnapshot=snapshot;
        catalog("");
    }
    JsonObject catalog(String id) {return call(catalog,id);}
    JsonObject invoke(ServerPlayer player,String id,JsonObject args,boolean readOnly,String requestId) {return call(invoke,player,id,args,readOnly,requestId);}
    boolean viewerAvailable(){return viewer!=null;}
    JsonObject viewer(ServerPlayer player,JsonObject args) {if(viewer==null)throw new IllegalArgumentException("native_viewer_unavailable");return call(viewer,player,args);}
    JsonObject bodySnapshot(ServerPlayer player) {return bodySnapshot==null?null:call(bodySnapshot,player);}
    private JsonObject call(Method method,Object...args) {
        try{return ((JsonObject)method.invoke(null,args)).deepCopy();}
        catch(InvocationTargetException e){if(e.getCause() instanceof RuntimeException r)throw r;throw new IllegalStateException("native_mod_execution_failed",e.getCause());}
        catch(ReflectiveOperationException e){throw new IllegalStateException("native_mod_bridge_unavailable",e);}
    }
}
