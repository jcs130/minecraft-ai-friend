package org.qiandeng.diagnostics;

import java.io.*;
import java.lang.management.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public final class Probe {
    private static final ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();
    private static final Map<String, Set<Long>> names = new TreeMap<>();
    private static final Map<String, Object> coverage = new TreeMap<>();
    private static final ThreadLocal<Long> context = ThreadLocal.withInitial(() -> 0L);
    private static final ArrayBlockingQueue<String> details = new ArrayBlockingQueue<>(2048);
    private static final AtomicLong dropped = new AtomicLong(), errors = new AtomicLong();
    private static final AtomicInteger detailAllowance = new AtomicInteger(128);
    private static final long PID = ProcessHandle.current().pid();
    private static volatile String renderer, vendor, version, irisError;
    private static volatile Boolean shaders;
    private static volatile ClassLoader irisLoader;
    private static volatile boolean detailBudgetReached, sampleBudgetReached, ledgerOverflow;
    private static volatile long frames, lastSwap, maxFrameNanos, lastRendererQuery;
    private static long written, sampleWritten;
    private static final long DETAIL_LIMIT = 32L * 1024 * 1024, SAMPLE_LIMIT = 16L * 1024 * 1024;
    private static int tracked;
    private Probe() { }

    public static void start(String directory) throws IOException {
        Path root = Path.of(directory).toAbsolutePath();
        if (!Files.isDirectory(root)) throw new IOException("Observer output directory must already exist");
        BufferedWriter events = Files.newBufferedWriter(root.resolve("gl-events.jsonl"), StandardOpenOption.CREATE_NEW);
        BufferedWriter samples = Files.newBufferedWriter(root.resolve("jvm-gl.jsonl"), StandardOpenOption.CREATE_NEW);
        Thread writer = new Thread(() -> {
            long next = 0;
            try {
                while (true) {
                    String line = details.poll(100, TimeUnit.MILLISECONDS);
                    if (line != null && !detailBudgetReached) {
                        if (written + line.length() > DETAIL_LIMIT) detailBudgetReached = true;
                        else { events.write(line); events.newLine(); written += line.length() + 1; }
                    }
                    if (System.nanoTime() >= next) {
                        String sample = json(snapshot());
                        if (sampleWritten + sample.length() > SAMPLE_LIMIT) sampleBudgetReached = true;
                        if (!sampleBudgetReached) { samples.write(sample); samples.newLine(); samples.flush(); sampleWritten += sample.length() + 1; }
                        events.flush(); detailAllowance.set(128);
                        next = System.nanoTime() + 1_000_000_000L;
                    }
                }
            } catch (Exception failure) {
                errors.incrementAndGet();
                System.err.println("[CameraMemoryObserver] writer failed: " + failure.getClass().getName());
            }
        }, "camera-memory-observer");
        writer.setDaemon(true); writer.start();
        System.err.println("[CameraMemoryObserver] enabled; diagnostic API counts are not GPU allocation accounting");
    }

    public static void count(String key) {
        try { counts.computeIfAbsent(key, ignored -> new LongAdder()).increment(); }
        catch (Throwable ignored) { errors.incrementAndGet(); }
    }

    public static synchronized void coverage(String owner, int methods, String error) {
        coverage.put(owner, error == null ? methods : error);
    }

    public static void returned(Object result, String key, Object[] args, Class<?> source) {
        try {
            count(key);
            String method = key.substring(key.lastIndexOf('.') + 1);
            if(key.startsWith("net.irisshaders.iris."))irisLoader=source.getClassLoader();
            if (key.contains("org.lwjgl.glfw.")) {
                if (method.equals("glfwMakeContextCurrent")) context.set(((Number)args[0]).longValue());
                else {
                    long now = System.nanoTime();
                    if (lastSwap != 0) maxFrameNanos = Math.max(maxFrameNanos, now - lastSwap);
                    lastSwap = now; frames++;
                    // These read-only calls happen on a thread with a current GL
                    // context. No GL API is ever invoked by the sampler thread.
                    if (frames == 1 || now-lastRendererQuery >= 1_000_000_000L) {
                        lastRendererQuery=now; renderer(source.getClassLoader());
                    }
                }
                return;
            }
            if (result instanceof Boolean b && b) count(key + ":true");
            boolean create = method.matches("gl(Gen|Create)(Textures|Buffers|Framebuffers|Renderbuffers|VertexArrays|Queries|Samplers|Program|Shader).*" ) || method.equals("glFenceSync");
            boolean delete = method.startsWith("glDelete");
            String kind = kind(method);
            List<Long> observedIds=List.of();
            if ((create || delete) && kind != null) {
                Object ids = create && result instanceof Number ? result : args.length == 0 ? null : args[args.length - 1];
                observedIds=ids(ids);
                for (long id : observedIds) {
                    if (id == 0) continue;
                    synchronized (Probe.class) {
                        Set<Long> set = names.computeIfAbsent(context.get() + ":" + kind, ignored -> new HashSet<>());
                        if (create) {
                            if (tracked < 100_000) { if (set.add(id)) tracked++; }
                            else ledgerOverflow = true;
                        } else if (set.remove(id)) tracked--;
                    }
                    count(kind + (create ? ":namesGenerated" : ":deleteRequests"));
                }
            }
            long bytes = bufferBytes(method, args);
            if (bytes > 0) counts.computeIfAbsent(key + ":requestedBytes", ignored -> new LongAdder()).add(bytes);
            // Bounded, sampled details with call sites; counts above are unsampled.
            if (detailBudgetReached || detailAllowance.getAndDecrement() <= 0) { dropped.incrementAndGet(); return; }
            Map<String,Object> event = base();
            event.put("api", key); event.put("context", context.get());
            event.put("args", Arrays.stream(args).map(Probe::shape).toList());
            event.put("result", shape(result));
            if(!observedIds.isEmpty())event.put("objectNames",observedIds.subList(0,Math.min(16,observedIds.size())));
            event.put("stack", StackWalker.getInstance().walk(stream -> stream
                .filter(frame -> !frame.getClassName().startsWith("org.qiandeng.diagnostics."))
                .limit(7).map(frame -> frame.getClassName() + "." + frame.getMethodName() + ":" + frame.getLineNumber()).toList()));
            if (!details.offer(json(event))) dropped.incrementAndGet();
        } catch (Throwable ignored) { errors.incrementAndGet(); }
    }

    private static String kind(String name) {
        if (name.endsWith("Sync")) return "sync";
        for (String kind : List.of("Textures", "Buffers", "Framebuffers", "Renderbuffers", "VertexArrays", "Queries", "Samplers", "Program", "Shader")) {
            if (name.matches("gl(Gen|Create|Delete)" + kind)) return kind.toLowerCase(Locale.ROOT);
        }
        return null;
    }
    private static List<Long> ids(Object value) {
        if (value instanceof Number n) return List.of(n.longValue());
        List<Long> result = new ArrayList<>();
        if (value instanceof IntBuffer b) for (int i = b.position(); i < b.limit() && result.size() < 4096; i++) result.add((long)b.get(i));
        if (value instanceof int[] array) for (int id : array) { if (result.size() >= 4096) break; result.add((long)id); }
        return result;
    }
    private static Object shape(Object arg) {
        if (arg == null || arg instanceof Number || arg instanceof Boolean) return arg;
        if (arg instanceof Buffer b) return Map.of("type", arg.getClass().getSimpleName(), "remaining", b.remaining());
        if (arg.getClass().isArray()) return Map.of("type", arg.getClass().getSimpleName(), "length", java.lang.reflect.Array.getLength(arg));
        return arg.getClass().getName(); // never shader source, tokens or pixel bytes
    }
    private static long bufferBytes(String method, Object[] args) {
        if (!method.matches("gl(Named)?Buffer(Data|Storage|SubData)")) return 0;
        for (Object arg : args) {
            if (arg instanceof Buffer b) return (long)b.remaining() * (arg instanceof ByteBuffer ? 1 : arg instanceof ShortBuffer ? 2 : arg instanceof IntBuffer || arg instanceof FloatBuffer ? 4 : 8);
            if (arg instanceof byte[] a) return a.length;
            if (arg instanceof short[] a) return (long)a.length * 2;
            if (arg instanceof int[] a) return (long)a.length * 4;
            if (arg instanceof float[] a) return (long)a.length * 4;
            if (arg instanceof long[] a) return (long)a.length * 8;
            if (arg instanceof double[] a) return (long)a.length * 8;
        }
        // For scalar storage/data overloads, args[1] is size. SubData has
        // offset in args[1], size in args[2] and may expose a raw pointer.
        int index = method.endsWith("SubData") ? 2 : 1;
        return args.length > index && args[index] instanceof Long n ? Math.max(0, n) : 0;
    }
    private static void renderer(ClassLoader loader) {
        try {
            Class<?> gl = Class.forName("org.lwjgl.opengl.GL11C", false, loader);
            var get = gl.getMethod("glGetString", int.class);
            renderer = String.valueOf(get.invoke(null, 0x1F01));
            vendor = String.valueOf(get.invoke(null, 0x1F00));
            version = String.valueOf(get.invoke(null, 0x1F02));
        } catch (Throwable failure) { errors.incrementAndGet(); }
        shaders=null;
        // LWJGL may be parent-loaded while Iris lives in Fabric's Knot loader.
        // Never infer shader-off from a parent-loader ClassNotFoundException.
        for(ClassLoader candidate:new ClassLoader[]{irisLoader,Thread.currentThread().getContextClassLoader(),loader}) {
            if(candidate==null)continue;
            try {
                Class<?> iris=Class.forName("net.irisshaders.iris.api.v0.IrisApi",false,candidate);
                Object api=iris.getMethod("getInstance").invoke(null);
                shaders=(Boolean)iris.getMethod("isShaderPackInUse").invoke(api);irisError=null;break;
            } catch(Throwable failure) { irisError=failure.getClass().getName(); }
        }
    }
    private static Map<String,Object> base() {
        Map<String,Object> data = new LinkedHashMap<>();
        data.put("atMs", System.currentTimeMillis()); data.put("pid", PID);
        return data;
    }
    private static synchronized Map<String,Object> snapshot() {
        Map<String,Object> data = base(); data.put("schema", "camera-memory-observer/v1");
        MemoryMXBean memory = ManagementFactory.getMemoryMXBean();
        data.put("heapUsed", memory.getHeapMemoryUsage().getUsed()); data.put("heapCommitted", memory.getHeapMemoryUsage().getCommitted());
        data.put("heapMax", memory.getHeapMemoryUsage().getMax()); data.put("nonHeapUsed", memory.getNonHeapMemoryUsage().getUsed());
        Map<String,Object> pools = new TreeMap<>();
        for (BufferPoolMXBean pool : ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)) pools.put(pool.getName(), Map.of("count",pool.getCount(),"used",pool.getMemoryUsed(),"capacity",pool.getTotalCapacity()));
        data.put("bufferPools", pools);
        data.put("gc", ManagementFactory.getGarbageCollectorMXBeans().stream().map(gc -> Map.of("name", gc.getName(), "count", gc.getCollectionCount(), "millis", gc.getCollectionTime())).toList());
        Map<String,Object> api = new TreeMap<>(); counts.forEach((key, value) -> api.put(key,value.sum())); data.put("api",api);
        data.put("worldFrames",counts.entrySet().stream().filter(entry->entry.getKey().endsWith("RenderingPipeline.beginLevelRendering")).mapToLong(entry->entry.getValue().sum()).sum());
        Map<String,Object> outstanding = new TreeMap<>(); names.forEach((key, value) -> outstanding.put(key,value.size())); data.put("trackedNames",outstanding);
        data.put("coverage", new TreeMap<>(coverage)); data.put("frames",frames); data.put("maxFrameNanos",maxFrameNanos);
        data.put("renderer",renderer); data.put("vendor",vendor); data.put("opengl",version); data.put("shadersEnabled",shaders); data.put("irisQueryError",irisError);
        data.put("microprobe",System.getProperty("qiandeng.memory.repro.mode"));
        data.put("droppedDetails",dropped.get()); data.put("observerErrors",errors.get()); data.put("ledgerOverflow",ledgerOverflow);
        data.put("detailBudgetReached",detailBudgetReached); data.put("sampleBudgetReached",sampleBudgetReached);
        return data;
    }
    // Small JSON encoder keeps this observer independent of MC's class loaders.
    static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map<?,?> map) return "{" + String.join(",", map.entrySet().stream().map(e -> json(e.getKey().toString()) + ":" + json(e.getValue())).toList()) + "}";
        if (value instanceof Collection<?> list) return "[" + String.join(",", list.stream().map(Probe::json).toList()) + "]";
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toString().toCharArray()) {
            if (c == '\\' || c == '"') out.append('\\').append(c);
            else if (c < 32) out.append(String.format("\\u%04x", (int)c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
}
