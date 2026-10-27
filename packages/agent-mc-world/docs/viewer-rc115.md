# rc.115 viewer input

This core candidate consumes shared `mc-visual-console` main `c0b9a7a6772c2f4de8c502a091af10f363bc427a` (PRs 9 and 10), including the previous original actors, banner and confirmed-cast updates. Its frozen archive is `mc-visual-console-java-1.21.1-c0b9a7a6-compatible.tgz`, SHA256 `3e2d3d9e79e496569eaa03675ba5f173be6871a4122700718e9af4adc9092916`.

Rebuilt Java 1.21.1, 1.20.6, 1.21.11 and 1.21.5 browser/mesher inputs retain their original client-image fingerprints, exact state registries and declared preset. Per-pack original armor paths and PNG hashes bridge legacy and modern humanoid equipment layouts, including copper where present. This does not substitute modern items into an older compatible pack or guarantee every optional sound, particle or text resource for every version.

First-person missing/empty camera sections retain received cave walls until connectivity is known. Inventory fallback normalizes legacy server skins without altering original source pixels. The private preview pose overrides matrix-authored world anchors while preserving live world matrices and native held-item grip matrices. Selected full custom actors no longer overlap classic sibling armor; their original held items and restoration flags are preserved. Shared details: `renderer-src/docs/inventory-first-person-20261028.md`.

Core remains a neutral game SDK/MCP. DSH's continuous goal windows, model-call scheduling and personality are implemented in the DSH adapter, without copying navigation, memory or rendering into that host. The core retains native memory revisions/recoverable forgetting, usable-loadout combat entry checks and chat transport dispatch receipts from rc.113, plus upstream `4e898a30` confirmed hand swaps/food consumption, explicit quantity schemas and connection-generation metadata from rc.114.

Source, package, default host installation and live deployment are distinct. This update does not restart Cortico, a game body, client or server. Procedural WebGL QA is not long-term gameplay or complete Java pixel parity. Generated viewer archives, client JARs and private captures are not source files in Git.
