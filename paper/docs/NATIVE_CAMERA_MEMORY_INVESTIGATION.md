# Intel UHD 770 / Mesa D3D12 / Iris memory investigation

2026-11-01. Source review and diagnostic candidate; **cause not established**.
The current execution host is Linux with no accessible Windows/iGPU session.
No new Windows memory curves, photo results or driver-allocation stacks were
collected here. Production remains WebGL; shared GPUs, inference, TTS, WSL and
online game services are untouched.

## Reviewed baseline and prior experiments

Review is based on [PR #26](https://github.com/jcs130/minecraft-ai-friend/pull/26)
at `6b9a25dc32958efd5eda2b8c017baab65b18e902`, including client policies,
`build.py`, `provision.py`, `launch.py`, the coordinator/renderer and
[the current manifest](../manifests/igpu-camera-candidate-20261031.json).
The following are inherited experiment records, not fresh measurements here.

| Existing evidence | Consequence for this investigation |
|---|---|
| Intel virtual display, actual D3D12 Intel strings and original YSM2.6.5 images | Context/GPU selection has already worked; do not repeat VDD installation |
| Shader-off 600.7 s, peak private commit 1.937 GiB, steady median 1.911 GiB, six same-instance shots | A useful bounded control; not multiday stability or formal album acceptance |
| Shader-on still hit 10 GiB QA cap, tail ~1.005 GiB/s, sampled shared usage ~7.934 GiB, last 4 FPS | Neither an 8 GiB VRAM ceiling nor proof that a larger cap solves the problem |
| 12 GiB attempt failed host-margin preflight | It was not a run; do not replay or raise limits |
| YSM removed, camera/core hooks removed, HUD restored: still reproduced | Do not attribute this only to encrypted models, UI hiding or screenshot hooks |
| Mesa26.1.8/26.2.4/26.2.5, newer Iris/Sodium, lighter shaders, smaller image/threads, performance mods | Broad version/size swapping already failed; prioritize measurement of the changed call path |
| DSA/buffer-storage masks and synchronous-frame controls failed | Do not reintroduce those deleted bypasses as a fix |
| Zink context initialization timed out | No successful Zink comparison exists; keep outside the rendering matrix |

## Findings from the project source

`NativeCameraClient` samples bounded metadata and updates a short-lived camera
pose. Its window/HUD/toast policies create no GL buffers, textures or FBOs.
`ClientBridge.screenshot` uses `try (class_1011 image = ...)` to close the native
image after encoding. No concrete unpaired per-frame GL allocation was found in
those inspected paths. Closing the image alone does not prove the entire native
stack leak-free; the independent hook-removal experiment is stronger evidence
that the rapid shader growth does not require that path.

`launch.py` intentionally reports `verified:false`, is resident, and has no
ten-minute timeout. It does not enable NMT or impose the private QA Job Object
limit. `provision.py` defaults to explicit shader-off and a bounded Java heap.
None of these production launch/build files is changed by this diagnostic work.
The 10 GiB process total with a 1536 MiB Java heap is evidence that the total is
not simply Java heap *used*. Raw heap/NMT samples are still required before
quantifying the non-JVM part; reserved heap, committed heap, working set and
WDDM allocations must remain separate.

## Upstream paths worth discriminating

The reviewed [Iris 1.21.1 source branch](https://github.com/IrisShaders/Iris/tree/12ea3bf16b39c0a70ec31dc9de1483c77bd3ccc3)
is pinned to `12ea3bf16b39c0a70ec31dc9de1483c77bd3ccc3`. It is a source-path
reference, **not a verified source match for the installed 1.8.8 or beta JAR**.
Use the actual mod/DLL hashes in each lab run before preparing an upstream fix.

* `IrisRenderingPipeline.beginLevelRendering` calls `RenderTargets.resizeIfNeeded`.
  Size changes rebuild color/depth storage and dependent passes; relative SSBOs
  delete and regenerate buffers. A call each frame is normal; a **true resize or
  pipeline reconstruction** each frame in a fixed window would be suspicious.
  The observer distinguishes calls from true returns and samples their stacks.
* `RenderTarget` owns main/alternate textures and has paired delete calls.
  `RenderTargets` owns FBOs and invokes their destruction. Depth copying and
  multipass rendering exercise additional Mesa paths even with constant GL names.
* `ShaderStorageBuffer` explicitly frees its LWJGL content buffer on destruction.
  Its resize path is conditional, so merely seeing that allocator in source does
  not demonstrate a per-frame leak. Buffer backing-store replacement, upload
  staging and queue/fence retention need evidence below the name ledger.
* PSO/shader-variant caches and deferred driver releases can grow while GL name
  counts remain bounded. GL API counts cannot prove or exclude these mechanisms.

[Iris issue #3021](https://github.com/IrisShaders/Iris/issues/3021) reports a
different Windows ARM/Qualcomm system using Mesa D3D12 with shader-on growth of
roughly 1.5 GB/s. This is a useful cross-vendor reproducer lead, not confirmation
of the UHD 770 cause. [PR #3431](https://github.com/IrisShaders/Iris/pull/3431)
fixes a newer RenderPearl override cache during pipeline reload/dimension change;
the changed classes/API are absent from the reviewed 1.21.1 path. It is not a
justified patch for continuous fixed-scene growth here.

## New repeatable tests

The [diagnostic suite](../integrations/native-camera/diagnostics/README.md)
adds two fresh-process Minecraft arms with identical scene/mod/library bytes:
shader-off and shader-on. These are **instrumented characterization runs**, not
another attempt to fix the problem by toggling shaders. Optional separately
labelled `D3D12_DEBUG=res` and driver-thread `GALLIUM_TRACE` arms collect resource
evidence without enabling a debug layer or GPU validator.

Five minimal GL controls remove Minecraft/Iris/YSM entirely: fixed FBO drawing,
depth copying, UBO replacement, same-store UBO updates, and shader-program churn.
They reuse the installed LWJGL/Mesa binaries and require an actual Intel D3D12
renderer. Failure of one provides a smaller candidate reproducer; success of
all five still cannot rule out complex shader/state-dependent driver behavior.

| Observed combination | Next inference to test |
|---|---|
| Heap/HotSpot committed grows with private commit | Inspect the matching JVM category/GC behavior before blaming the GPU |
| Java direct pool grows | Identify owning Java allocation/capture path; LWJGL native allocator memory may not appear in this pool |
| GL generated names exceed delete requests continuously | Locate sampled create stacks and verify scope, context and GL success before fixing ownership |
| GL names flat, but texture/buffer storage or pipe resources repeatedly created | Storage replacement / transient resources; correlate allocation and destruction per frame |
| Pipe resource creation/destruction balanced, private/PID GPU use grows | Investigate backing BOs/heaps, staging pools, PSO caches and completed-fence retention; do not declare a leak from name balance alone |
| Growth reproduced by a single minimal control | Capture that control's driver-allocation evidence and compare with Iris; narrow the upstream report |
| Only traced runs differ | Quantify observer/debugging overhead; no performance conclusion from the traced arm |

NMT, WDDM and GL data share wall-clock milliseconds and the newly created child
PID. Fast failure slopes are retained even if the ten-second render warmup is
not reached; such a run is explicitly not steady-state performance evidence.
Missing telemetry, shader mismatch, truncated trace and failed instrumentation
remain gaps. The tool never returns production success.

## What would justify a fix and a switch

There is no evidenced root-cause fix in this candidate. A minimum fix needs a
specific create/retain/release or cache key path, a reproducer that fails before
and passes after the change, and the unchanged shader-off control. Stable GL
names with unexplained native growth need same-process native allocation stacks
and/or D3D12 backing-resource/fence evidence; this suite does not fabricate that
lower-level visibility. Gallium resource events are not D3D12 heap accounting.

After a proven fix, repeat uninstrumented continuous runs, varied loaded scenes,
actual FPS/frame-time checks, original encrypted YSM first/third/top images,
cancellation/disconnect behavior, and original lease→album→reward box→site
delivery. The existing native identity/model/UI/lease guards and separate backend
selection remain mandatory. Nothing here enables native production rendering.

## Local validation

Linux / OpenJDK 17: ten diagnostic tests passed, including real Java agent/JNI
native-prefix execution, child-loaded Iris reflection, world/menu phase separation, partial XML, restoration
after a failed run and owned-child cleanup after a simulated Job Object failure.
The six existing `native-photo-renderer.test.mjs` tests passed. The observer and
all five microprobe modes compile as part of the diagnostic build. This does not
validate JDK21/Windows native loading, actual Job Objects/CIM, Intel GL rendering
or a runtime microprobe; those checks remain outstanding on the lab host.

Primary references: [NMT scope and overhead](https://docs.oracle.com/en/java/javase/21/vm/native-memory-tracking.html),
[Windows process memory counters](https://learn.microsoft.com/en-us/windows/win32/psapi/process-memory-usage-information),
[Mesa D3D12 debug flags](https://docs.mesa3d.org/drivers/d3d12.html),
[Gallium trace environment variables](https://docs.mesa3d.org/envvars.html),
[LWJGL 3.3.3 core and ARB wrappers](https://github.com/LWJGL/lwjgl3/tree/3.3.3/modules/lwjgl/opengl/src/generated/java/org/lwjgl/opengl).
