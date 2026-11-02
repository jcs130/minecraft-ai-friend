# Intel D3D12 / Iris memory lab

This is opt-in diagnostic code, outside the resident camera launcher and build.
It does not install a driver, modify a GPU preference, start a server, connect to
production, select a photo backend, or touch inference/TTS/other game processes.
Windows execution and actual GL pixels have **not** been validated by the Linux
development tests. See [the investigation](../../../docs/NATIVE_CAMERA_MEMORY_INVESTIGATION.md).

## Prepare a separate lab

Use Windows x64, Python 3.11+, and a dedicated HotSpot JDK 21. Provision a new
client using the existing `provision.py`, prepare Fabric/bridge/camera as in the
camera guide, and reuse the already reviewed **application-local** Mesa runtime
and Intel virtual-display placement. Do not install a system OpenGL DLL or copy
production authentication/model caches. Do not place a marker in the production
client. If YSM needs authentication, use the already authorized lab's own flow;
the minimal GL probes do not load YSM or Minecraft at all.

In that lab only, create `memory-lab.json`:

```json
{"schema":"qiandeng-camera-memory-lab/v1","isolated":true,"loopbackOnly":true}
```

The provisioned `launch.json` must point its game/assets paths to this instance,
use the unverified offline token `0`, and contain no autojoin, other agent, or
preexisting NMT options. Use a separate offline loopback fixture with an already
loaded, fixed scene. `--fixture-port` only supplies `127.0.0.1`; this program
does not start or change a server. Omitting it starts the menu and is **not** a
world test. Keep the same window, chunk set, camera position, FPS cap, shader ZIP,
and mod bytes across the arms. Allow no photo requests during the first matrix.

Do not launch another copy against the same lab while this runner is active.
Keep the production WebGL camera running through its existing host.

## Build and run

Run from the repository root. The placeholders below are paths chosen for the
private lab, not existing production paths or a deployment command.

```powershell
$diag = 'paper/integrations/native-camera/diagnostics'
$lab = 'E:/CameraMemoryLab/client'
$java = 'E:/CameraMemoryLab/jdk-21/bin/java.exe'
python "$diag/build_agent.py" --java $java --out E:/CameraMemoryLab/build-r1
python "$diag/run_matrix.py" --game $lab --java $java `
  --agent E:/CameraMemoryLab/build-r1/camera-memory-observer.jar `
  --out E:/CameraMemoryLab/evidence-r1 --shader '<existing-shader.zip>' `
  --fixture-port 29090 --seconds 45
```

This runs shader-off then shader-on, without changing shader versions. The
original `iris.properties` bytes are restored in `finally`, including on a
failed child or Ctrl+C. A new output directory is mandatory. A machine power
loss/forced parent kill cannot execute `finally`; preserve the original lab
configuration before the run. No executable, server process, watchdog, or
production configuration is replaced.

The runner uses a 6 GiB per-process Job Object cap by default (4–8 GiB allowed),
1536 MiB Java heap, a 250 ms process-memory poll, and at least 8 GiB host free
commit margin. Preflight requires room for the entire process cap **plus** that
margin. The hard job cap is private process memory, **not** total WDDM memory or
an iGPU VRAM reservation. Assignment failure kills only the new QA child and
aborts. At cap minus 0.5 GiB, low host commit, duration, or log guard, only the
owned child and owned collector are terminated. This is a deliberately bounded
QA stop, not a normal-game-exit or resident-stability test.

To isolate call families without Minecraft/Iris/YSM, add:

```powershell
--microprobes steady depth-copy buffer-orphan buffer-update program-churn
```

Add `--micro-only` to skip both Minecraft arms. That mode only needs the
provisioned lab libraries/native DLLs, not Fabric/bridge/camera startup or a
server connection. It still requires the lab marker and explicit input paths.

Each actual-GL microprobe requires an Intel D3D12 renderer, uses a 768-square
RGBA16F/depth FBO at a 30 FPS cap, and has identical base resources. `steady`
draws/blits fixed targets; the other arms add a depth image copy, 64 KiB UBO
replacement plus upload, same-store upload, or program compilation/deletion per
frame. The UBO is consumed by the fragment shader. Each probe has a second
120-second local deadline in addition to the parent's tighter bounds. A passing
microprobe cannot exonerate complex Iris shaders; a failing one can provide a
smaller reproducer for the driver maintainers. These are controls, not fixes.

For a separately labelled, short trace run, add `--mesa-resource-trace` and/or
`--gallium-trace`. Each adds its own shader-off/on arms. `D3D12_DEBUG=res` uses
the installed runtime's resource logging; exact detail varies by build.
`GALLIUM_TRACE` captures the driver-thread API as XML, with a resource
creation/destruction summary that tolerates an incomplete crash tail. A Mesa
build without tracing support may produce no XML; that is missing coverage.
Trace logging has significant overhead. The 64 MiB client/XML log guard is
polled and may overshoot between samples; observer samples/details separately
stop at 16/32 MiB. Do not compare traced FPS directly with untraced FPS.

## Evidence and limits

| Output | Measurement | Interpretation |
|---|---|---|
| `process.jsonl` | Fresh child PID; private commit, working set, host headroom every 250 ms | Working set and private commit are different quantities |
| `jvm-gl.jsonl` | Heap used/committed/max, nonheap, GC, Java direct/mapped buffer pools; cumulative API counts and observed name balance every second | Buffer pools exclude many LWJGL allocator and driver allocations |
| `gl-events.jsonl` | Sampled creation/deletion/storage events, object names and call stacks | Metadata only; no shaders, model contents or pixels; 128 detail records/s |
| `*-nmt.txt`, `*-heap.txt` | Time-labelled `jcmd` NMT baseline/diffs and heap snapshots | NMT covers HotSpot, not all native code; attach errors/timeouts remain in files |
| `growth-trigger-threads.txt` | Bounded thread dump once the process reaches 3 GiB, when the checkpoint worker is available | The process may crash before a dump completes |
| `gpu.jsonl` | The Java PID's WDDM memory counter instances with LUID/phys names | Unavailable is not zero; do not label every adapter Intel or query DXGI in a helper and call it camera usage |
| `client.log`, `hs_err_pid*.log` | Client/Mesa diagnostics and JVM fatal log if produced | Private evidence; not checked into Git |
| `run.json` | Byte hashes of shader, mods, input files, observer and actually loaded relevant DLLs; bounds and stop reason | No launch arguments/token dump; original paths stay private |
| `gallium.xml` | Optional Mesa pipe resource trace | Pipe resource destruction is not proof that a D3D12 heap/fence reference was reclaimed |
| `analysis.json`, `analysis.md` | Aligned slopes, API/name deltas, sampled swap FPS and gaps | Always `cause: unconfirmed`, `verified: false`; no production acceptance |

Keep both generated JARs together: `camera-memory-observer.jar` and its tiny
`camera-memory-probe.jar` bootstrap helper. The helper makes hook callbacks
visible through Fabric's class-loader isolation without disabling that isolation.
Iris shader state is queried through its observed loader or the render thread's
context loader, rather than assuming LWJGL's parent loader can see mod classes.

The observer uses HotSpot's bundled ASM and the supported native-method-prefix
facility. It wraps selected terminal `GLxxC` JNI entries as well as Java wrappers;
this includes primitive-only `glCreateProgram`, `glDeleteProgram`, and
`glFenceSync`. ARB DSA aliases delegate to these core wrappers and are not counted
twice. Direct `ngl*`/JNI calls from other native libraries, extension-only entry
points, implicit name creation, shared-context ownership and driver-internal
allocations remain outside the ledger. Transformation failures, sampling drops
and ledger/file caps are explicit. OpenGL error status is not consumed or cleared:
these are successful **Java returns and delete requests**, not assertions that GL
accepted every call or completed physical destruction.

The agent makes no extra GL allocations, waits, deletes or `glGetError` calls.
Renderer strings and Iris state are queried on the rendering thread, never the
sampler thread. Counters, sampling and native wrappers do add overhead. First
check that the observed failure resembles the existing uninstrumented failure;
performance/normal-exit/photo acceptance must later use the uninstrumented client.

`analysis.json` retains active-render growth slopes/API/name deltas for fast
failing arms and a separate 10-second-world-render-warmup window when enough
samples exist. Actual Iris/vanilla world-render callbacks identify that window;
initial menu/loading swaps do not. A title
screen, shader policy mismatch, observer error, missing GPU row, incomplete NMT
or early guard never becomes a successful world run. Swap rate is not proof of
complete scene loading, GPU completion or image correctness.

## Development checks

```bash
python3 -m unittest discover -s paper/integrations/native-camera/diagnostics -p 'test_*.py' -v
node --test paper/ops/native-photo-renderer.test.mjs
```

The tests exercise the real Java agent, branches/stack maps, IntBuffer positions,
int/long/void returns, thrown calls, separate Iris/LWJGL loaders and native-prefix
JNI resolution (with GCC on Linux). They also cover parsing, incomplete evidence
and lab restrictions. They
do **not** run Windows Job Objects, CIM, Intel rendering, encrypted models or
actual photos. Keep logs, model files, libraries, compiled JARs and lab markers
outside the repository; commit only source and the investigation.
