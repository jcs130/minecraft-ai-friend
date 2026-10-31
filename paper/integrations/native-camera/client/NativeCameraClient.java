package org.qiandeng.camera;

import com.google.gson.Gson;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL11;

/** Camera-only render policy. Control/screenshots remain in the existing MC bridge. */
public final class NativeCameraClient implements ClientModInitializer {
    record ModelSelection(String model,String texture) { }
    private int ticks;
    private final String instance=UUID.randomUUID().toString();
    private static UUID renderedJob;private static int renderedFrames;
    public static void frameApplied(UUID job){if(!job.equals(renderedJob)){renderedJob=job;renderedFrames=0;}renderedFrames++;}
    @Override public void onInitializeClient() {
        if(!Boolean.getBoolean("qiandeng.camera.enabled"))return;
        ClientLifecycleEvents.CLIENT_STARTED.register(client->{
            String renderer=String.valueOf(GL11.glGetString(GL11.GL_RENDERER));
            if(!renderer.toLowerCase(Locale.ROOT).contains("intel"))throw new IllegalStateException("CAMERA_INTEL_GPU_REQUIRED: "+renderer);
            // Iris uses the options perspective, not Camera's render-lease flag,
            // when deciding whether to draw the local first-person hands. This
            // dedicated photographer must never render its own hands over a
            // requested view. The lease still sets first/third/top eye geometry.
            client.field_1690.method_31043(net.minecraft.class_5498.field_26665);
            long window=client.method_22683().method_4490();
            Integer x=Integer.getInteger("qiandeng.camera.windowX"),y=Integer.getInteger("qiandeng.camera.windowY");
            if(x!=null&&y!=null)GLFW.glfwSetWindowPos(window,x,y);
            if(!System.getProperty("qiandeng.camera.hidden","true").equals("false"))GLFW.glfwHideWindow(window);
            else GLFW.glfwShowWindow(window);
            System.out.println("[QiandengCamera] Verified Intel renderer: "+renderer);
            sample(client);
        });
        ClientTickEvents.END_CLIENT_TICK.register(client->{CameraPose.refresh(client,instance);if(++ticks%5==0)sample(client);});
    }
    private void sample(net.minecraft.class_310 client) {
        try {
            Map<String,Object> data=new LinkedHashMap<>();
            data.put("schema","qiandeng-native-camera/v1");data.put("instanceId",instance);
            data.put("at",Instant.now().toString());data.put("pid",ProcessHandle.current().pid());
            data.put("renderer",GL11.glGetString(GL11.GL_RENDERER));data.put("vendor",GL11.glGetString(GL11.GL_VENDOR));
            data.put("opengl",GL11.glGetString(GL11.GL_VERSION));data.put("cleanHud",true);data.put("cleanToasts",true);data.put("fps",client.method_47599());
            data.put("perspective",client.field_1690.method_31044().name());
            long window=client.method_22683().method_4490();
            data.put("windowVisible",GLFW.glfwGetWindowAttrib(window,GLFW.GLFW_VISIBLE)==GLFW.GLFW_TRUE);
            data.put("windowIconified",GLFW.glfwGetWindowAttrib(window,GLFW.GLFW_ICONIFIED)==GLFW.GLFW_TRUE);
            int[] wx=new int[1],wy=new int[1];GLFW.glfwGetWindowPos(window,wx,wy);data.put("windowPosition",List.of(wx[0],wy[0]));
            Integer expectedX=Integer.getInteger("qiandeng.camera.windowX"),expectedY=Integer.getInteger("qiandeng.camera.windowY");
            data.put("expectedWindowPosition",expectedX==null||expectedY==null?null:List.of(expectedX,expectedY));
            data.put("screenOpen",client.field_1755!=null);
            data.put("connected",client.field_1724!=null&&client.field_1687!=null);
            data.put("playerUuid",client.field_1724==null?null:client.field_1724.method_5667().toString());
            data.put("server",client.method_1558()==null?"":client.method_1558().field_3761);
            data.put("renderedJob",renderedJob==null?null:renderedJob.toString());data.put("renderedFrames",renderedFrames);
            var pose=CameraPose.applicable(client);data.put("job",pose==null?null:pose.job().toString());
            data.put("nonce",pose==null?null:pose.nonce().toString());data.put("poseOwner",pose==null?null:pose.owner().toString());
            boolean shaders=false;
            try {Class<?> type=Class.forName("net.irisshaders.iris.api.v0.IrisApi");Object api=type.getMethod("getInstance").invoke(null);shaders=(boolean)type.getMethod("isShaderPackInUse").invoke(api);}catch(ReflectiveOperationException ignored){}
            data.put("shadersEnabled",shaders);data.put("modelCatalogueSize",YsmAccess.catalogueSize());
            var camera=client.method_1560();data.put("cameraUuid",camera==null?null:camera.method_5667().toString());
            if(client.field_1687!=null){
                data.put("dimension",client.field_1687.method_27983().method_29177().toString());
                var pos=client.field_1773.method_19418().method_19326();data.put("cameraPosition",List.of(pos.field_1352,pos.field_1351,pos.field_1350));
                List<Map<String,Object>> players=new ArrayList<>();
                for(var player:client.field_1687.method_18456()){
                    if(players.size()>=64)break;
                    Map<String,Object> row=new LinkedHashMap<>();var selection=YsmAccess.selection(player);
                    row.put("uuid",player.method_5667().toString());row.put("model",selection==null?null:selection.model());
                    row.put("modelLoaded",selection!=null&&YsmAccess.hasModel(selection.model()));players.add(row);
                }
                data.put("players",players);
            }
            Path target=FabricLoader.getInstance().getGameDir().resolve("diagnostics/qiandeng-native-camera.json");
            Files.createDirectories(target.getParent());Path temporary=target.resolveSibling(target.getFileName()+".writing");
            Files.writeString(temporary,new Gson().toJson(data));Files.move(temporary,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        }catch(Exception failure){System.out.println("[QiandengCamera] Telemetry unavailable: "+failure.getClass().getSimpleName());}
    }
}
