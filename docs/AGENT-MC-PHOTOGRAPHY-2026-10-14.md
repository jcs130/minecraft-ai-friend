# Independent Minecraft photography and cloud artwork

## Source delivery

The `packages/agent-mc-world` core now owns a versioned photography contract, raw screenshot/game-state pairing, a private photo/art archive, optional native cloud image adapters and one public `mc_photo` tool. SDK, MCP, engine IPC and the extension surface carry the same image artifacts and lifecycle receipts. No Cortico, DSH, N.E.K.O or VTuber source is imported. The Minecraft example in Cortico is unchanged.

The host owns personality, interpretation, VLM/planning calls, prompts, goals and personal memory. The core performs only explicitly requested capture/enhance/create operations. Native providers are Alibaba Bailian's synchronous multimodal API and ByteDance Volcengine Ark's image generation API. Other providers/local backends can implement the public `ImageGenerationPort`; the bundled World currently configures the two native cloud adapters. It does not require ComfyUI.

No provider is configured by default. Capture still works with a connected modern viewer. Enhancement without an edit provider explicitly archives/returns an original-image fallback. Original artwork requires a configured generation capability. Originals, prompts, paired readings and generated outputs remain separate historical evidence. They do not replace current facts or imply verified goals/learning.

Long image requests return accepted jobs and deliver actual terminal events later. Call IDs deduplicate operations, including original-image fallback when provider configuration later changes. Cancellation closes local HTTP waiting; late results cannot revive stopped work. An interrupted unknown remote outcome is blocked for investigation, never silently resubmitted. SDK execution state cannot regress from a completed background event to a late admission receipt. Returning from a tool does not end a host decision turn.

MCP can upload PNG/JPEG/WebP reference artifacts explicitly, avoiding private machine paths or reference URL downloads. Scene image 1 and subsequent character references stay ordered through real child IPC. Native request IDs and measured provider usage are archived without API keys or echoed remote response bodies.

Configuration, tool examples, input budgets, reference limits and official API links: [Photography guide](../packages/agent-mc-world/docs/PHOTOGRAPHY.md).

## Verification on 2026-10-14

| Gate | Result | Scope |
| --- | --- | --- |
| Complete package suite | 86 files / 686 tests passed | Includes 20 new photo/provider tests, public types, SDK/MCP, real engine child IPC and denied-network fixtures |
| Working package build | Passed | Owned runtime, public declarations, locked local modern viewer inputs and manifest verification |
| Clean independent source build | Passed | Fresh directory, no host checkout/package, offline dependency installation; engine/SDK/declarations built from source |
| Clean/source equality | Passed | Clean and working build manifests contain identical owned-source hashes |
| Packed consumer declarations | Passed | Actual tarball installed in a separate project; strict NodeNext and Bundler, library checks enabled |
| Packed runtime | Passed | Default tool discovery, durable capture and original fallback with all outbound network and framework imports denied |
| Real native cloud generation | Not performed | Request/response behavior verified with offline fixtures; no paid provider request issued |
| Deployment / npm publication | Not performed | No running Agent, game, TTS or image service restarted or migrated |
| Live play / artistic quality | Not verified in this change | Needs separately configured cloud credentials, real captures and visual review |

The clean source build deliberately had no optional viewer archive and built the engine/SDK without downloading it. The ordinary working build and tested tarball included the existing locked modern viewer assets. This is an explicit release input, not a framework-source extraction or hidden build download.

The local artifact is `agent-mc-world@0.4.0`, still a release candidate. Registry lookup did not find a published `agent-mc-world` package during this change. Source synchronization, tarball creation, npm publication and loading into a running host are separate stages.

For reproduction, run `pnpm build`, `pnpm test`, package with `pnpm pack`, then install that tarball into an isolated consumer. Type-check the public exports in both NodeNext and Bundler modes and run offline runtime checks using the test fixtures that deny network/framework resolution. Do not infer provider quality, actual billing or live gameplay success from fixture tests.
