# Screenshot browser GPU and idle rendering

The Mineflayer viewer renders the action connection's streamed world state in
WebGL. The core's automatic still camera owns a separate headless Chromium
process. A Java observer's GPU setting does not select this browser's GPU.
Neither this camera nor the ordinary viewer invokes an image generation model.

## Deployment settings

These settings affect only the core's owned screenshot browser:

| Setting | Default | Meaning |
| --- | --- | --- |
| `AGENT_MC_CAPTURE_GPU` | `low-power` | `default`, `low-power`, or `high-performance` |
| `AGENT_MC_CAPTURE_EXPECT_RENDERER` | unset | Optional case-insensitive substring required in the actual WebGL renderer |
| `AGENT_MC_CAPTURE_IDLE_MS` | `30000` | Idle browser release, integer 1000–300000 milliseconds |
| `AGENT_MC_BROWSER_EXECUTABLE` | installed Edge/Chromium | Existing executable selection |

Low-power requests the integrated adapter on a multi-GPU system. Chromium and
the driver make the final choice. The screenshot result reports `renderer`
with the requested preference, actual WebGL renderer/vendor, and software-renderer
classification (null when unavailable). A preference alone is not evidence of
which GPU rendered the scene. Use the optional renderer assertion when a
deployment must reject selection of an unintended adapter. Windows uses ANGLE
D3D11; no global Windows GPU preferences or user browser settings are changed.

The same policy is available through the public `agent-mc-world/client` export:

```js
import { MinecraftViewCaptureManager } from 'agent-mc-world/client';
const camera = new MinecraftViewCaptureManager({}, {
  gpuPreference: 'low-power', idleTimeoutMs: 30000,
  // Optional deployment assertion, e.g. expectedRenderer: 'AMD Radeon'.
});
try {
  const frame = await camera.capture({ viewerUrl: 'http://127.0.0.1:7793' });
  // frame.png, frame.renderer, frame.idleRendering, frame.timings
} finally { await camera.stop(); }
```

## Capture-only renderer protocol

Matching shared viewer assets expose `globalThis.__mcCaptureControl` only on
`?photo=1&capture=1` pages. Protocol `mc-viewer-capture/v1` provides
`setActive(boolean)` returning the acknowledged boolean. It calls the renderer's
existing `setRendering` port: drawing stops, while socket events and world state
remain connected. It does not freeze the browser process or suspend network
delivery. A resume waits for two animation frames before scene readiness and
PNG acquisition. Captures retain their requested dimensions, FOV, textures,
models and viewpoint; this policy does not replace game content with proxies.

The core pauses drawing after PNG acquisition and reports `idleRendering:
'paused'`. Without this protocol it closes the capture page immediately and
reports `'page-closed'`. Both paths close the browser after the idle timeout,
release the keyed capture lease, cancel renewals, and clear idle timers on stop.
An old viewer therefore remains usable without an always-rendering cached page.
Warm-up and cancellation use the same lifecycle. A stopped in-flight capture
cannot create a replacement browser or schedule a new warm-up.

Normal viewer, OBS and manually opened photo pages keep their existing rendering
lifecycle. Build the shared renderer, prepare a pinned archive, and update the
core's release input explicitly to deploy the pause protocol. A source change
alone does not modify a running host or copied viewer assets.

## Evidence and limits (2026-10-20)

An isolated Edge/WebGL2 probe on a Windows machine selected NVIDIA RTX 5090 D
with default preference and AMD Radeon Graphics with low-power. Both produced
the same test-pixel RGBA. This verifies that this driver/browser combination
honors the switch; it does not guarantee adapter selection on every computer.
Production host reload and production screenshot performance require separate
acceptance. GPU contexts from other browsers, motion services or image/video
models are outside this camera's lifecycle.

A second isolated test used the rebuilt shared Java 1.21.1 viewer with nine
synthetic, explicitly labeled offline chunks and the original locked assets.
Both NVIDIA and AMD rendered the 1280×720 scene. During a 700 ms idle window the
main renderer's frame counter advanced zero frames. A position/yaw event arrived
while idle; the next image showed the new yaw (0 to π/5), reused the page and
resumed rendering. AMD's warm capture took about 155 ms (health, resume/readiness
and PNG), excluding model calls because none were used. A 1000 ms test idle
timeout closed both browsers. A separate ordinary photo page installed no
capture control and drew 22 frames during a 350 ms sample. These are small
offline fixture measurements, not complex production-scene benchmarks.

Validation: engine build, complete locked-viewer build and emitted public
declarations verified. The core suite passed 1758 checks; the two optional
viewer checks were then rerun with the prepared full archive and both passed.
An engine package was installed with offline pnpm in a separate consumer without
Cortico; runtime integrity and public types passed in NodeNext and Bundler modes.
The shared viewer's full suite passed (1289 assertions, 32 existing optional
checks skipped); its current recipe-reference count was updated for the
upstream-admitted TridentItem default, without broadening asset admission.
The shared source implementation is commit `8a3ff890` in `mc-visual-console`.
This core change leaves the existing `release-sources.json` artifact pin intact:
its old viewer uses the immediate page-close fallback. The pause/reuse and warm
capture measurements above used the separately rebuilt new shared viewer. Its
new archive must be prepared and pinned before a combined production deployment;
the tested engine-only archive is not a complete viewer release. Neither a new
npm release nor a production migration is part of this record.

Chromium implementation reference:
https://chromium.googlesource.com/chromium/src/+/f35df3e3e2276c4ec658d66961789ceb4fc4e278
