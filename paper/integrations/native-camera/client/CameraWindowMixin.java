package org.qiandeng.camera.mixin;
import net.minecraft.class_1041;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(class_1041.class)
public abstract class CameraWindowMixin {
    @Inject(method="<init>",at=@At(value="INVOKE",target="Lorg/lwjgl/glfw/GLFW;glfwCreateWindow(IILjava/lang/CharSequence;JJ)J"),remap=false)
    private void qiandengBackgroundWindow(CallbackInfo callback){
        if(!Boolean.getBoolean("qiandeng.camera.enabled"))return;
        GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE,GLFW.GLFW_FALSE);
        GLFW.glfwWindowHint(GLFW.GLFW_FOCUSED,GLFW.GLFW_FALSE);
        GLFW.glfwWindowHint(GLFW.GLFW_FOCUS_ON_SHOW,GLFW.GLFW_FALSE);
        // Select the camera's own monitor before WGL creates its context.
        // Visibility and focus stay disabled; the actual Intel renderer is still checked at startup.
        Integer x=Integer.getInteger("qiandeng.camera.windowX");
        Integer y=Integer.getInteger("qiandeng.camera.windowY");
        if(x!=null&&y!=null){
            GLFW.glfwWindowHint(GLFW.GLFW_POSITION_X,x);
            GLFW.glfwWindowHint(GLFW.GLFW_POSITION_Y,y);
        }
    }
}
