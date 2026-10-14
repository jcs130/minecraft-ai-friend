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

The public `ImageGenerationPort` accepts an explicit prompt plus ordered byte images and returns image bytes, measured usage and provider request ID. Hosts can implement it for other native cloud APIs or a local backend and pass it to the public `PhotographyService` through `provider()`. ComfyUI is not required by the contracts, build or native cloud adapters. The bundled World currently exposes the two native adapters above; a custom port is an SDK integration, not a claim that arbitrary APIs are wire-compatible.

The service and pure context helper are exported by `agent-mc-world`, `agent-mc-world/client` and the extension surface; contracts are exported by `agent-mc-world/contracts`. Image generation remains opt-in, with an explicit request and host-selected prompt. No extra autonomous reasoning loop is introduced.

## Official API references and verification

- [Alibaba Qwen generation/editing API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- [Volcengine Ark image generation API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)

Checked against official documentation on 2026-10-14. Tests use offline native-response fixtures and fake game captures: request shapes, reference order, result download without credentials, zero default network, errors without leaked provider bodies, deduplication, interrupted-process recovery, cancellation, late-result suppression, public SDK/MCP evidence and decision boundaries. Passing these tests does not establish real provider quality, billing, latency or live screenshot appearance. Those require separately configured credentials and actual play/visual review.
