package org.qiandeng.diagnostics;

import java.lang.instrument.*;
import java.security.ProtectionDomain;
import java.util.*;
import jdk.internal.org.objectweb.asm.*;
import jdk.internal.org.objectweb.asm.commons.AdviceAdapter;
import jdk.internal.org.objectweb.asm.commons.Method;

/** Observes Java entry points, never changes GL parameters, waits or return values. */
public final class Agent {
    public static void premain(String directory, Instrumentation instrumentation) throws Exception {
        Module ours = Agent.class.getModule();
        instrumentation.redefineModule(Object.class.getModule(), Set.of(), Map.of(
            "jdk.internal.org.objectweb.asm", Set.of(ours),
            "jdk.internal.org.objectweb.asm.commons", Set.of(ours)), Map.of(), Set.of(), Map.of());
        if (!instrumentation.isNativeMethodPrefixSupported()) throw new IllegalStateException("Native wrapper observation unsupported by this JVM");
        Probe.start(directory);
        Observer observer = new Observer();
        instrumentation.addTransformer(observer);
        instrumentation.setNativeMethodPrefix(observer, Observer.NATIVE_PREFIX);
    }

    static final class Observer implements ClassFileTransformer {
        static final String NATIVE_PREFIX = "qiandeng_observed_";
        private static final Type PROBE = Type.getType(Probe.class);
        private static boolean glfw(String owner, String name) {
            return owner.equals("org/lwjgl/glfw/GLFW") && Set.of("glfwMakeContextCurrent", "glfwSwapBuffers").contains(name);
        }
        private static boolean iris(String owner, String name) {
            return owner.startsWith("net/irisshaders/iris/") && (
                (owner.endsWith("/PipelineManager") && Set.of("preparePipeline", "destroyPipeline").contains(name)) ||
                (owner.endsWith("/IrisApi") && name.equals("getInstance")) ||
                ((owner.endsWith("/IrisRenderingPipeline") || owner.endsWith("/VanillaRenderingPipeline")) && Set.of("<init>", "destroy", "beginLevelRendering").contains(name)) ||
                (owner.endsWith("/RenderTargets") && name.equals("resizeIfNeeded")) ||
                (owner.endsWith("/ShaderStorageBuffer") && Set.of("resizeIfRelative", "createStatic", "destroy").contains(name)));
        }
        private static boolean gl(String owner, String name) {
            if (!owner.startsWith("org/lwjgl/opengl/") || !name.startsWith("gl")) return false;
            // C classes are the terminal Java wrappers. Do not also instrument
            // ARB aliases: their delegation would double-count the same call.
            // Extension-only and direct ngl/JNI entry points are outside coverage.
            if (!owner.matches("org/lwjgl/opengl/GL[0-9]+C")) return false;
            return name.matches("gl(Gen|Create|Delete|TexImage|TexStorage|TextureStorage|TextureImage|RenderbufferStorage|NamedRenderbufferStorage|BufferData|BufferStorage|NamedBufferData|NamedBufferStorage|BufferSubData|NamedBufferSubData|MapBuffer|UnmapBuffer|FlushMapped|FenceSync|ClientWaitSync|WaitSync|CompileShader|LinkProgram|Copy|Blit|Draw|MultiDraw|DispatchCompute|BeginQuery|EndQuery|GetQueryObject|Finish|Flush).*" );
        }
        @Override public byte[] transform(ClassLoader loader, String owner, Class<?> redef, ProtectionDomain domain, byte[] bytes) {
            if (!(owner.startsWith("org/lwjgl/") || owner.startsWith("net/irisshaders/iris/"))) return null;
            try {
                ClassReader reader = new ClassReader(bytes);
                ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
                final int[] observed = {0};
                reader.accept(new ClassVisitor(Opcodes.ASM8, writer) {
                    @Override public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                        boolean selected = (access & Opcodes.ACC_ABSTRACT) == 0 && (gl(owner, name) || glfw(owner, name) || iris(owner, name));
                        boolean nativeMethod = selected && (access & Opcodes.ACC_NATIVE) != 0;
                        MethodVisitor base = super.visitMethod(access, nativeMethod ? NATIVE_PREFIX + name : name, descriptor, signature, exceptions);
                        if (!selected) return base;
                        observed[0]++;
                        String key = owner.replace('/', '.') + "." + name;
                        boolean fast = name.equals("beginLevelRendering") || (name.matches("gl(Draw|MultiDraw|DispatchCompute|Copy|Blit|ClientWaitSync|WaitSync|BeginQuery|EndQuery|GetQueryObject|Finish|Flush).*" ) && !name.startsWith("glCopyTexImage"));
                        // No extra locals/handlers: preserve the original stack map.
                        // Resource records use only terminal core C wrappers.
                        MethodVisitor observed = nativeMethod ? super.visitMethod(access & ~Opcodes.ACC_NATIVE, name, descriptor, signature, exceptions) : base;
                        AdviceAdapter advice = new AdviceAdapter(Opcodes.ASM8, observed, access & ~Opcodes.ACC_NATIVE, name, descriptor) {
                            @Override protected void onMethodExit(int opcode) {
                                if (opcode == ATHROW) return; // no successful return, no generated name
                                if (fast) {
                                    push(key); invokeStatic(PROBE, new Method("count", "(Ljava/lang/String;)V"));
                                    return;
                                }
                                // Keep the original return value below the hook's arguments.
                                Type result = Type.getReturnType(descriptor);
                                if (result.getSort() == Type.VOID) visitInsn(ACONST_NULL);
                                else { if (result.getSize() == 2) dup2(); else dup(); box(result); }
                                push(key); loadArgArray(); visitLdcInsn(Type.getObjectType(owner));
                                invokeStatic(PROBE, new Method("returned", "(Ljava/lang/Object;Ljava/lang/String;[Ljava/lang/Object;Ljava/lang/Class;)V"));
                            }
                        };
                        if (nativeMethod) {
                            // LWJGL includes primitive-only native entry points
                            // (glCreateProgram/glDeleteProgram/glFenceSync). A
                            // JVMTI native-prefix wrapper also observes these;
                            // just skipping ACC_NATIVE would miss their lifetime.
                            advice.visitCode(); advice.loadArgs();
                            advice.visitMethodInsn(Opcodes.INVOKESTATIC, owner, NATIVE_PREFIX + name, descriptor, false);
                            advice.visitInsn(Type.getReturnType(descriptor).getOpcode(Opcodes.IRETURN));
                            advice.visitMaxs(0, 0); advice.visitEnd();
                            return base;
                        }
                        return advice;
                    }
                }, ClassReader.EXPAND_FRAMES);
                if (observed[0] == 0) return null;
                Probe.coverage(owner, observed[0], null);
                return writer.toByteArray();
            } catch (Throwable failure) {
                Probe.coverage(owner, 0, failure.getClass().getName());
                System.err.println("[CameraMemoryObserver] transform failed: " + owner + " " + failure);
                // Diagnostic coverage failures stay visible; they never patch the
                // renderer or silently become evidence of stable resource counts.
                return null;
            }
        }
    }
}
