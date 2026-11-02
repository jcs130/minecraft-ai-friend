import org.qiandeng.camera.MesaIntelAdapter;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL;
import org.lwjgl.opengl.GL11;
import java.nio.ByteBuffer;
public class CameraAdapterProbe {
 public static void main(String[] args){
  if(args.length>0&&args[0].equals("missing-library")){
   ClassLoader.getSystemResource("java/lang/Object.class");
   if(com.sun.jna.Native.POINTER_SIZE!=8)throw new AssertionError("Expected x64 test machine");
   java.nio.file.Files.exists(java.nio.file.Path.of(args[1]));
   System.setProperty("java.home",args[1]);
   try{MesaIntelAdapter.installIfRequested();throw new AssertionError("Missing runtime must be rejected");}
   catch(IllegalStateException expected){System.out.println("MISSING_RUNTIME_REJECTED");return;}
  }
  MesaIntelAdapter.installIfRequested();
  if(!GLFW.glfwInit())throw new AssertionError("GLFW failed");
  long window=0;
  try{
   GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE,GLFW.GLFW_FALSE);
   GLFW.glfwWindowHint(GLFW.GLFW_FOCUSED,GLFW.GLFW_FALSE);
   GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR,3);
   GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR,3);
   GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE,GLFW.GLFW_OPENGL_CORE_PROFILE);
   window=GLFW.glfwCreateWindow(128,128,"Camera isolated Intel validation",0,0);
   if(window==0)throw new AssertionError("No graphics context");
   GLFW.glfwMakeContextCurrent(window);GL.createCapabilities();
   String renderer=GL11.glGetString(GL11.GL_RENDERER);
   if(!renderer.contains("Intel(R) UHD Graphics 770"))throw new AssertionError(renderer);
   GL11.glClearColor(.125f,.5f,.875f,1f);GL11.glClear(GL11.GL_COLOR_BUFFER_BIT);GL11.glFinish();
   ByteBuffer pixel=ByteBuffer.allocateDirect(4);GL11.glReadPixels(0,0,1,1,GL11.GL_RGBA,GL11.GL_UNSIGNED_BYTE,pixel);
   int r=Byte.toUnsignedInt(pixel.get(0)),g=Byte.toUnsignedInt(pixel.get(1)),b=Byte.toUnsignedInt(pixel.get(2));
   if(Math.abs(r-32)>1||Math.abs(g-128)>1||Math.abs(b-223)>1)throw new AssertionError("Pixel mismatch");
   System.out.println("PASS renderer="+renderer+" pixel="+r+","+g+","+b);
   MesaIntelAdapter.installIfRequested();
  }finally{if(window!=0)GLFW.glfwDestroyWindow(window);GLFW.glfwTerminate();}
 }
}
