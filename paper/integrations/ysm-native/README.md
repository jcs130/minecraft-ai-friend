# Optional native YSM adapter — isolated candidate

`AgentAppearanceNative 0.4.0` runs on Youer 1.21.1 with the original NeoForge YSM **2.6.5**. It reads the actual player's native attachment, invokes the original ordinary-player selection handler, and publishes appearance metadata through the existing `mcagent:appearance` and `mcagent:ysm_asset` channels. It creates no player, model worker, HTTP listener, native handshake, OP permission, or model ownership grant.

This is an isolated integration candidate, **not a deployed model-chain migration**. The production model proxy, viewer consumers, client downloads and separately maintained camera must be migrated and verified together. Do not install it beside the old appearance publisher: two publishers would compete for the same channels.

## Native dependency and selection

The adapter checks the loaded original artifact, its mod version, and the attachment class before observing or selecting anything:

- `ysm-2.6.5-neoforge+mc1.21.1-release.jar`: SHA256 `b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb`.
- Reported source `ysm_native_backend`, YSM version `2.6.5`, protocol `2.6.0`.
- The ordinary native handler retains model authorization and `mandatory=false`. A console `ysm model set ... false` was independently observed to produce `mandatory=true`; it is not the ordinary initial-selection path.
- Catalog entries are read from the running native registry and filtered against the player's existing ownership attachment. Observation does not create an attachment. A different artifact or reflection signature fails closed for appearance only.

Players keep `/appearance status`, `/appearance list [page]`, and `/appearance set <model> [texture]`. These commands operate on the caller's actual body. Console/RCON may request `/appearance admin set <name-or-UUID> <model> <texture>` for one uniquely identified loaded body, using the same ordinary handler and authorization. A request is not a success receipt; verify actual model state afterward.

Public folder/ZIP assets retain the converter's existing hash, permission, path, and byte checks. Native 2.6.5 registry IDs preserve ZIP/`.ysm` extensions. Encrypted `.ysm` files remain native-only and return `YSM_ENCRYPTED_SOURCE_REQUIRED`; no decryption or approximate replacement is supplied.

## Configuration and migration

The first start creates `plugins/AgentAppearanceNative/models.json` with automatic selection disabled. `publicModelRoot` points to the native `config/yes_steve_model/custom` directory. The optional private `bedrockStateFile` uses the new native source profile; its consumers must explicitly support that profile first.

Automatic selection reuses the shared policy and private UUID ledger described in [automatic appearance](../../docs/AUTOMATIC_APPEARANCE_20261031.md). It prefers unused compatible models, reserves a choice before dispatch, preserves personal choices, and avoids observers. Spectators without a trusted prior selection stay outside the ordinary pool.

A stopped, verified migration may seed a private ledger entry with `phase: "restore_pending"` to restore an exact old model/texture to the same UUID. This is also how an excluded observer can retain its explicit drone selection. Missing old models are reported rather than randomly replaced. A new personal native selection wins over a pending restoration. Once issued, an unknown request is not automatically replayed. Never copy example UUIDs into production or restore stale player/world data.

## Build and verification

`build.py --output <new-external-directory> --jdk <JDK-21> --classpath <Paper-API> <Gson-containing-library> ...` compiles the adapter and four shared policy/catalog classes. The current script uses the Windows JDK executables. It downloads and installs nothing, and records source/dependency hashes outside the repository. Third-party JARs and original model assets are not redistributed here.

The marked loopback Youer fixture passed 12 integration checks plus three checks after a normal cold restart: distinct initial choices, original public assets and hash, personal selection isolation, exact prior-model restoration, spectator drone restoration, observer exclusion, the original encrypted fish/white model, preserved UUID/body/inventory, saved choices and no setup replay. Shared regression checks: 8 identity + 31 self-selection + 45 automatic-selection; catalog checks: 14 including both version profiles. Earlier failed probes are retained privately, including a localized Chinese RCON receipt initially tested with an English-only assertion.

These checks do not establish modded-client pixels, live camera compatibility, a complete modpack/proxy migration, or browser/Bedrock scene parity. See the [migration checklist](../../docs/YSM_265_MIGRATION_20261031.md).
