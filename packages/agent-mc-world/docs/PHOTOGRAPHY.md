# Photographs and optional artwork

`mc_photo` is part of the independent Minecraft core and is exposed identically by SDK, MCP and the extension port. It has no host-framework or VTuber dependency. No provider is enabled by default. Normal photography uses the modern web renderer and needs no image model. It needs a connected game and matching modern viewer assets; it does not start a browser/game server or discover model endpoints by scanning ports.

## Flow

SDK hosts may save character references with `client.journal.saveBlobs(...)`. MCP clients can use `mc_artifact` with `{"action":"put","mime":"image/png","base64":"<encoded-image-bytes>"}` and pass the returned handle to `reference_handles`. JPEG/WebP are also accepted. This stores explicit caller-provided image bytes and performs no download or model call. Images can be retrieved through the ordinary artifact resource URI.

1. `{"action":"capabilities"}` reads configured image capabilities without calling a model.
2. `{"action":"capture","mode":"third","request_id":"photo-001"}` saves the original 3D canvas (no HUD) and fresh game readings. The capture ID correlates readings within five seconds; this is not atomic sampling. Connection/dimension changes invalidate the capture. Moving during capture is recorded.
3. The host Agent interprets the picture and game readings, chooses what matters, and writes a composition/prompt. It can use its own VLM or ordinary model; the core does not run one. `preparePhotoContext` is an optional pure helper: stable system prefix, dynamic evidence at the tail, input budget including tool descriptions, image allowance and reserved output. The raw original is not replaced by a summary. Style and personality are host choices, not fixed Cormy assumptions.
4. `{"action":"enhance","source_id":"<capture-id>","prompt":"...","reference_handles":["mem:front","mem:back"],"request_id":"art-001"}` starts one explicit image request. Image 1 is the screenshot. Character references follow in the given order. The original screenshot counts toward the model's reference limit. Reference artifacts must be PNG/JPEG/WebP, at most 10 MiB each. The host uploads/owns the artifacts; there are no built-in character images or local machine paths.
5. A returned `execution.phase=accepted` means pending work only. Read `minecraft.photo` completion/cancellation events, or `status` with the job `id`. `read` returns the archived JSON and image blob; `list` lists the latest 30 archive entries. Completion never sets `goalCompleted=true` and never ends a decision turn. Normal tool barriers and explicit round acknowledgements remain in effect.
6. `{"action":"create","prompt":"An imagined ...","request_id":"art-002"}` makes original art. With character references, this uses the provider's image-reference capability. Without any configured image provider, creation fails explicitly. Enhancement with no edit capability returns the original with `fallback=original, enhanced=false`; it never labels a screenshot as AI enhanced.

`cancel` with the job `id` closes local HTTP waiting and marks cancellation immediately. `stop()` aborts all active jobs, and late results cannot revive them or deliver events into a later run. Cancellation cannot guarantee a cloud service stops computing or charging. Only one generation may be in flight/draining. Stable request IDs deduplicate calls; differing arguments under the same ID are rejected. A process interrupted while generating restores the job as blocked/unknown. No automatic generation retry, including a failed result download.

The private `minecraft-photos/` directory holds raw readings, prompt, source/result IDs, reference handles, usage and output bytes. Provider request IDs are retained when available. These are historical observations/artifacts, not current game facts, verified learning or personal memory. The usual SDK/MCP journal additionally archives tool/event evidence. Preserve this directory and the host artifact store when migrating data. With no data directory, the service is memory-only. Separate Agents should use separate private data directories.

## Native cloud configuration

Inside the ordinary client configuration `world` object, add `photography`. Keys are **environment variable names**, never key values. Set them in the process that launches the SDK/MCP engine. Starting/configuring a provider sends no requests; only explicit enhance/create does.

Alibaba Bailian / Qwen-Image (native DashScope synchronous multimodal API):

```json
{
  "photography": {
    "provider": "bailian",
    "endpoint": "https://YOUR_WORKSPACE.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    "model": "qwen-image-2.1-pro",
    "apiKeyEnv": "DASHSCOPE_API_KEY",
    "generate": true,
    "edit": true,
    "maxReferences": 10,
    "timeoutMs": 600000,
    "resultHosts": "dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com"
  }
}
```

Endpoint, key and model must be from the same region. Qwen 2.1 supports up to ten references; Qwen 3.0 currently supports up to three, so change `maxReferences` with the model. Model names are caller configuration, not a permanently pinned recommendation. The native adapter uses ordered `input.messages[].content`, a single text prompt, `n=1`, and disables provider prompt rewriting. Public tool sizes use `1536x1024`; the adapter converts to DashScope's `1536*1024`.

Bailian returns a temporary result URL. `resultHosts` must contain the exact output storage hostname(s) for your region/account, separated by commas; the example host is not universal. An unconfigured result host blocks download and reports only the returned hostname and provider request ID for investigation, never the signed URL. A successful provider response can use an account-specific OSS acceleration hostname. Verify that exact hostname before changing configuration; do not allow all OSS domains. The blocked job does not automatically resume or regenerate after a configuration change, and a provider request ID is not an asynchronous task ID. Preserve a response at the integration boundary if manual download recovery is needed. Output download is an explicit part of the generation operation, carries **no API key**, does not follow redirects and saves bytes to the private archive. No arbitrary reference URL fetch is performed by this client.

ByteDance Volcengine Ark / Seedream (native images API):

```json
{
  "photography": {
    "provider": "volcengine",
    "endpoint": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    "model": "doubao-seedream-5-0-lite-260128",
    "apiKeyEnv": "ARK_API_KEY",
    "generate": true,
    "edit": true,
    "maxReferences": 10,
    "timeoutMs": 600000
  }
}
```

Use a model ID or your own endpoint ID, with the capability/reference limit appropriate to that model. Ark receives `prompt`, ordered inline `image` references (omitted for text-only), `stream=false` and `response_format=b64_json`; no result download is normally needed. For recognizable 4.0/4.5/5.0-lite model IDs the adapter explicitly disables group generation. Pro/flash models use single-image defaults and do not receive that unsupported field. The adapter rejects responses that are not exactly one successful image. No web-search, tools or secondary model requests are enabled. Size may be omitted, pixel dimensions or the model-supported `2K`/`3K` setting; the provider still validates model-specific ranges.

## Other services and local models

The public `ImageGenerationPort` accepts an explicit prompt plus ordered byte images and returns image bytes, measured usage and provider request ID. Hosts can implement it for other native cloud APIs or a local backend and pass it to the public `PhotographyService` through `provider()`. ComfyUI is not required by the contracts, build or native cloud adapters. The bundled World exposes the two cloud adapters above and the opt-in FLUX 3 profile below; a custom port is an SDK integration, not a claim that arbitrary APIs are wire-compatible.

The service and pure context helper are exported by `agent-mc-world`, `agent-mc-world/client` and the extension surface; contracts are exported by `agent-mc-world/contracts`. Image generation remains opt-in, with an explicit request and host-selected prompt. No extra autonomous reasoning loop is introduced.

## Optional local FLUX 3 and voxel photography

These are **Agent capabilities**, not a server-wide photo filter. Ordinary `capture` never calls an image model or renders a voxel proxy. `enhance` is a separate explicit action; `scene_input` defaults to `screenshot`. Merely configuring a model does not activate automatic enhancement. Server camera commands keep their own normal capture behavior.

```json
{
  "photography": {
    "provider": "comfyui-flux3",
    "endpoint": "http://127.0.0.1:8191",
    "model": "FLUX.3-Image-Klein-bf16",
    "apiKeyEnv": "",
    "generate": true, "edit": true, "maxReferences": 3,
    "timeoutMs": 900000,
    "flux3": {
      "unet": "flux3-image-klein-bf16.safetensors",
      "clip": "qwen3vl_4b_bf16.safetensors",
      "vae": "flux2-vae.safetensors",
      "steps": 16, "width": 1280, "height": 704, "seed": 8
    }
  }
}
```

The configured ComfyUI must already support `CLIPLoader type=flux3` and `ReferenceMultiLatent` and contain the exact licensed weights. This adapter downloads nothing, discovers no other endpoint, enables no custom nodes and calls no prompt upsampler. The host supplies the finished prompt verbatim. The distilled sixteen-step, CFG=1 schedule follows the official workflow. The node named `EmptyFlux2LatentImage` and VAE filename `flux2-vae` are also used by the official FLUX 3 workflow; they do not select a FLUX.2 diffusion model. Explicit pixel sizes must be multiples of sixteen, 256..2048. Text-only `create` needs no reference; references use ordered multi-image conditioning without batching/cropping mismatched reference-sheet shapes.

Only explicit generation preflights exact configured node/model capabilities, uploads ordered references, submits **one** prompt, waits on its prompt ID and downloads its single final output node. Acceptance is not completion. Transport uncertainty never triggers a second POST. The private photo archive retains the caller's prompt, reference handles and the provider prompt ID on completion/failure/cancellation. Cancel/stop abort local waiting, and late images cannot resurrect a job. The adapter never issues global `/interrupt` or `/free`; a remotely accepted job may continue computing. Reconcile the original provider ID before any new request. Use loopback HTTP or an explicitly protected HTTPS endpoint; API keys, when needed, remain in an operator-selected environment variable.

### Explicit voxel capture

On the Mineflayer backend, configure optional `photography.voxel` with explicit absolute `rendererSource` (the shared `mc-visual-console` renderer source), `assetPack` (matching original Java 1.21.1 pack including its integrity manifest), `threeModule`, `radius`, `below`, `above`, and a virtual third-person `cameraOffset`. Optional `surfaceStyle=material-hints` / `geometryStyle=organic-hints` enable the documented artistic abstractions; defaults retain original geometry/material cues. `allowDocumentedApproximations=true` explicitly accepts the recorded fluid, banner, tint and seed limitations. No renderer/model directory is scanned.

1. `capture` saves an ordinary screenshot and game readings.
2. **Only when requested**, `capture` with `scene:"voxel"` also freezes bounded loaded block states and renders a separate artistic proxy. It does not move the player. `camera_offset:[x,y,z]` may override the virtual framing for this capture; inspect the returned occlusion warning and `sceneRender.self.placementFacing`. A neutral marker is not observed limb animation. Unknown cells remain unknown, and collision boxes are not substituted for the original visual models.
3. `scene` with the capture `id` returns the raw versioned JSON and proxy image as artifacts. Original screenshot, source scene, proxy hashes, known/unknown coverage, source identity, camera and rendering approximations remain archived separately. Large raw cell arrays are retrieved on demand instead of inserted in every prompt.
4. The host interprets the original image, proxy and semantic readings, chooses a composition and matching front/back/side character reference, and writes the final prompt. It may use its own VLM. No extra planner loop runs inside the core.
5. `enhance` with `source_id`, `scene_input:"voxel"`, `prompt`, optional `reference_handles` and stable `request_id` explicitly generates from that proxy. Without `scene_input:"voxel"`, enhancement uses the original screenshot even if the capture has voxel evidence. Original `create` remains an imagined composition and does not fabricate voxel evidence.

No model: normal capture still works, enhancement returns the **original screenshot** with `fallback=original`, and original drawing is unavailable. No voxel renderer: normal screenshot capture remains available and explicit voxel capture fails clearly. The Java-client framebuffer backend currently rejects voxel capture rather than ignoring the option. Hosts may supply a separate scene port through the public `PhotographyService` / `PhotoCapture` contract.

Official workflow: [FLUX 3 distilled multi-reference editing](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_flux3_klein_distilled_image_edit.json), [official weights and license](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy). Operator-only Windows troubleshooting: the upstream [HostBuffer/pinned-memory issue](https://github.com/Comfy-Org/ComfyUI/issues/15255) documents a workaround; core does not alter someone else's ComfyUI flags or restart a service.

## Official API references and verification

- [Alibaba Qwen generation/editing API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- [Volcengine Ark image generation API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)

Checked against official documentation on 2026-10-14. Tests use offline native-response fixtures and fake game captures: request shapes, reference order, result download without credentials, zero default network, errors without leaked provider bodies, deduplication, interrupted-process recovery, cancellation, late-result suppression, public SDK/MCP evidence and decision boundaries. Passing these tests does not establish real provider quality, billing, latency or live screenshot appearance. Those require separately configured credentials and actual play/visual review.
