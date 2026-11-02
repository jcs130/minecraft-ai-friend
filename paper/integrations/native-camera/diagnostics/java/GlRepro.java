package org.qiandeng.diagnostics;

import java.lang.reflect.*;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.concurrent.locks.LockSupport;

/** Small actual-GL controls using the lab's installed LWJGL and native DLLs. */
public final class GlRepro {
    private static final Map<String,Method> methods = new HashMap<>();
    private static final Class<?> GL, GLFW;
    static {
        try { GL=Class.forName("org.lwjgl.opengl.GL45C"); GLFW=Class.forName("org.lwjgl.glfw.GLFW"); }
        catch (ClassNotFoundException failure) { throw new ExceptionInInitializerError(failure); }
    }
    private static Object call(Class<?> owner, String name, Class<?>[] types, Object... values) throws Exception {
        String key=owner.getName()+name+Arrays.toString(types);
        Method method=methods.get(key);
        if(method==null) { method=owner.getMethod(name,types); methods.put(key,method); }
        try { return method.invoke(null,values); }
        catch(InvocationTargetException failure) { throw new IllegalStateException(name,failure.getCause()); }
    }
    private static int ints(String name, int... values) throws Exception {
        Class<?>[] types=new Class<?>[values.length];Arrays.fill(types,int.class);
        Object[] args=new Object[values.length];for(int i=0;i<values.length;i++)args[i]=values[i];
        Object result=call(GL,name,types,args);return result instanceof Integer n?n:0;
    }
    private static int shader(int kind,String source) throws Exception {
        int id=ints("glCreateShader",kind);
        call(GL,"glShaderSource",new Class<?>[]{int.class,CharSequence.class},id,source);ints("glCompileShader",id);
        if(ints("glGetShaderi",id,0x8B81)!=1)throw new IllegalStateException("Minimal shader compilation failed");
        return id;
    }
    private static int program() throws Exception {
        int vertex=shader(0x8B31,"#version 330 core\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}");
        int fragment=shader(0x8B30,"#version 330 core\nlayout(std140) uniform Payload {vec4 tint;};out vec4 color; void main(){color=vec4(0.2,0.4,0.6,1.)+tint;}");
        int id=ints("glCreateProgram");ints("glAttachShader",id,vertex);ints("glAttachShader",id,fragment);ints("glLinkProgram",id);
        ints("glDeleteShader",vertex);ints("glDeleteShader",fragment);
        if(ints("glGetProgrami",id,0x8B82)!=1)throw new IllegalStateException("Minimal shader link failed");
        int block=(Integer)call(GL,"glGetUniformBlockIndex",new Class<?>[]{int.class,CharSequence.class},id,"Payload");
        ints("glUniformBlockBinding",id,block,0);
        return id;
    }
    private static int texture(int internal,int width,int height) throws Exception {
        int id=ints("glGenTextures");ints("glBindTexture",0x0DE1,id);
        ints("glTexStorage2D",0x0DE1,1,internal,width,height);return id;
    }
    public static void main(String[] args) throws Exception {
        String mode=System.getProperty("qiandeng.memory.repro.mode","steady");
        if(!Set.of("steady","depth-copy","buffer-orphan","buffer-update","program-churn").contains(mode))throw new IllegalArgumentException(mode);
        int size=768, fps=30;
        if(!(Boolean)call(GLFW,"glfwInit",new Class<?>[]{}))throw new IllegalStateException("GLFW initialization failed");
        long window=0;
        try {
            for(int[] hint:new int[][]{{0x22002,4},{0x22003,5},{0x22008,0x32001},{0x20004,1},{0x2000C,0}})
                call(GLFW,"glfwWindowHint",new Class<?>[]{int.class,int.class},hint[0],hint[1]);
            Integer x=Integer.getInteger("qiandeng.camera.windowX"),y=Integer.getInteger("qiandeng.camera.windowY");
            if(x!=null&&y!=null){
                call(GLFW,"glfwWindowHint",new Class<?>[]{int.class,int.class},0x2000E,x);
                call(GLFW,"glfwWindowHint",new Class<?>[]{int.class,int.class},0x2000F,y);
            }
            window=(Long)call(GLFW,"glfwCreateWindow",new Class<?>[]{int.class,int.class,CharSequence.class,long.class,long.class},size,size,"Isolated camera GL diagnostic: "+mode,0L,0L);
            if(window==0)throw new IllegalStateException("GL context not created");
            call(GLFW,"glfwMakeContextCurrent",new Class<?>[]{long.class},window);
            Class.forName("org.lwjgl.opengl.GL").getMethod("createCapabilities").invoke(null);
            String renderer=(String)call(GL,"glGetString",new Class<?>[]{int.class},0x1F01);
            if(!renderer.toLowerCase(Locale.ROOT).contains("intel")||!renderer.toLowerCase(Locale.ROOT).contains("d3d12"))throw new IllegalStateException("Actual Intel D3D12 renderer required: "+renderer);
            call(GLFW,"glfwSwapInterval",new Class<?>[]{int.class},0);
            int vao=ints("glGenVertexArrays");ints("glBindVertexArray",vao);
            int prog=program();
            int color=texture(0x881A,size,size),depth=texture(0x8CAC,size,size),copy=texture(0x8CAC,size,size);
            int fbo=ints("glGenFramebuffers");ints("glBindFramebuffer",0x8D40,fbo);
            ints("glFramebufferTexture2D",0x8D40,0x8CE0,0x0DE1,color,0);
            ints("glFramebufferTexture2D",0x8D40,0x8D00,0x0DE1,depth,0);
            if(ints("glCheckFramebufferStatus",0x8D40)!=0x8CD5)throw new IllegalStateException("Incomplete diagnostic framebuffer");
            int ubo=ints("glGenBuffers");ints("glBindBuffer",0x8A11,ubo);
            call(GL,"glBufferData",new Class<?>[]{int.class,long.class,int.class},0x8A11,65536L,0x88E8);
            ByteBuffer upload=ByteBuffer.allocateDirect(65536);
            call(GL,"glBufferSubData",new Class<?>[]{int.class,long.class,ByteBuffer.class},0x8A11,0L,upload);
            ints("glBindBufferBase",0x8A11,0,ubo);
            System.out.println("[CameraMemoryRepro] mode="+mode+" renderer="+renderer+" size="+size+" fpsCap="+fps);
            long begin=System.nanoTime();int frames=0;
            // Parent owns timeout/memory containment. This additional local
            // deadline only bounds the standalone microprobe, never production.
            while(System.nanoTime()-begin<120_000_000_000L && !(Boolean)call(GLFW,"glfwWindowShouldClose",new Class<?>[]{long.class},window)) {
                long frame=System.nanoTime();
                ints("glBindFramebuffer",0x8D40,fbo);ints("glViewport",0,0,size,size);ints("glClear",0x4100);
                if(mode.equals("program-churn")){ints("glDeleteProgram",prog);prog=program();}
                if(mode.equals("buffer-orphan"))call(GL,"glBufferData",new Class<?>[]{int.class,long.class,int.class},0x8A11,65536L,0x88E8);
                if(mode.equals("buffer-update")||mode.equals("buffer-orphan"))call(GL,"glBufferSubData",new Class<?>[]{int.class,long.class,ByteBuffer.class},0x8A11,0L,upload);
                ints("glUseProgram",prog);ints("glDrawArrays",4,0,3);
                if(mode.equals("depth-copy"))ints("glCopyImageSubData",depth,0x0DE1,0,0,0,0,copy,0x0DE1,0,0,0,0,size,size,1);
                ints("glBindFramebuffer",0x8CA8,fbo);ints("glBindFramebuffer",0x8CA9,0);
                ints("glBlitFramebuffer",0,0,size,size,0,0,size,size,0x4000,0x2600);
                call(GLFW,"glfwSwapBuffers",new Class<?>[]{long.class},window);call(GLFW,"glfwPollEvents",new Class<?>[]{});
                frames++;LockSupport.parkNanos(Math.max(0,1_000_000_000L/fps-(System.nanoTime()-frame)));
            }
            ints("glUseProgram",0);ints("glDeleteProgram",prog);ints("glDeleteBuffers",ubo);ints("glDeleteFramebuffers",fbo);
            for(int id:new int[]{color,depth,copy})ints("glDeleteTextures",id);
            ints("glDeleteVertexArrays",vao);
            System.out.println("[CameraMemoryRepro] normal end frames="+frames);
        } finally {
            if(window!=0)call(GLFW,"glfwDestroyWindow",new Class<?>[]{long.class},window);
            call(GLFW,"glfwTerminate",new Class<?>[]{});
        }
    }
}
