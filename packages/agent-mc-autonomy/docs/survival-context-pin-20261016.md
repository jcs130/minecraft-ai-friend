# Optional survival references (0.1.76)

This package consumes engine-only `agent-mc-world` 0.5.7-dev.20261016.39,
source `3ee62ca25b60693132f7b7b8ae6bac3df7ad452f` at
`packages/agent-mc-world` in the canonical repository. Its local companion
archive has SHA-256
`44c161edb81aad330aef57933716b31d329eb11506d6ba8e0b6c322f57285b56`.
The archive, source revision, package, build, declarations and executable receipts
are pinned in `core_distribution/source.json`; this is not an upstream npm release.
The npm dependency graph is unchanged. Installation still validates every source,
runtime and public declaration member against those receipts.

Version 0.1.76 fixes the .75 pin's public-build mismatch. The documented builder
extracts exact Git bytes before hashing source inputs. The earlier .75 archive
used eight CRLF working-copy inputs; the new archive contains all 297 source
inputs exactly as committed, with a matching build receipt. All 284 runtime files
and 284 public declarations are byte-identical to the previously tested .39 build.
The exact Git package also omits an inactive, untracked vendor viewer archive.
Core version/source, the dependency graph and the separate default viewer receipt
are unchanged. Neither source hashing nor installation verification is normalized
or relaxed; the previous archive remains a distinct historical artifact.

Through the existing read-only `mc_knowledge` help/search/get API, verified Java
1.21.1 now has `guide/bed`, `guide/night_shelter`, `guide/equipment`, `guide/base`,
`guide/storage` and `guide/farming`. Chinese and English discovery returns bounded
summaries; full advice is retrieved only when requested. Existing food/health/
cooking guides and item/block/recipe references remain available. These optional
cards depend on current conditions and actual outcomes. They do not choose tasks,
add stable prompt content or write personal experience. Other and unknown versions
cannot retrieve these semantic cards.

The inherited core changes since .32 include shared method capability discovery,
trusted decision-source diagnostics, normal server-authorization reconnect,
named-item repair, boat placement through `use`, and bounded method waits. Native
Java latency/readback behavior applies only to an explicitly attached Java client
and its advertised capabilities. Mineflayer remains the default body; neither
shared method names nor the guides imply Java feature parity or current live use.
Native task identities, unknown-dispatch blocking and explicit stop remain owned
by the core and existing coordinator.

The separately supplied default viewer remains source
`c799ae1a71fd7a03f3404f67e33f2985eed8a7aa`, with its existing complete receipt.
Private configured viewer overrides and newer shared viewer source are separate
inputs; this package does not select or deploy them. The engine contains no viewer
bundle. Autonomy .74's public recent-context API is retained in .75.
The core's inherited .38 `release-sources.json` updates original YSM/browser-skin
build provenance; it does not replace this separate external viewer receipt.

Offline installation and disconnected SDK/MCP retrieval establish package
compatibility. They do not establish live adoption, overnight survival, usable
equipment/base/storage/farming, voice quality or server-specific behavior. A new
installation remains disabled and disconnected until explicitly configured and
started. Deployment and live acceptance require their own evidence.
