# Agent MC World

Independent Minecraft execution core, maintained in `jcs130/minecraft-ai-friend`.
Package name: `agent-mc-world`. Protocol: `agent-mc/v1`.

## Responsibilities

This package owns the Mineflayer connection, inventory synchronization, navigation,
validated actions, executable methods, evidence receipts, current facts/archive,
deduplication, goal revisions, cancellation, SDK/MCP and the viewer integration.
The host owns personality, goals, model calls, decisions and long-term memory.
The core starts no model loop. Connecting to a game server is explicit.

Consumers depend on the package, never on another host's checkout:

- `cortico-world-qiandengji`: Cortico API 5 adapter, public name 联机版我的世界.
- `agent-mc-qiandengji`: explicitly selected server protocols and reference guides.
- `dsh-minecraft-agent`: native DeepSeek Harness adapter.
- Other hosts: use `agent-mc-world`, `/client`, `/contracts` or `/mcp`.

The modern visualization remains maintained in `jcs130/mc-visual-console`.
Server packs and performance services require explicit configuration.

## Build and verification

Run commands in this package directory. Node >=22 is required.

```sh
pnpm install --frozen-lockfile
node scripts/prepare-viewer.mjs /path/to/mc-visual-console-java-1.20.6.tgz
pnpm build
pnpm typecheck
pnpm test
pnpm pack
```

The viewer archive is a release input from the shared visual project, locked by
`release-sources.json`. It is intentionally excluded from this repository's Git
source. The prepare command checks its exact SHA256 before copying it; it never
downloads or scans for a service. With dependencies and this archive prepared,
build/test work offline, without Cortico, DSH, a server checkout or live services.
Missing inputs fail explicitly. The built npm package includes the viewer and
does not need either source repository at runtime.

See [client setup](docs/minecraft-client.md), [accounts](docs/online-accounts.md),
[protocol](docs/protocol-v1.md) and [host integration](docs/harness.md).
Historical import licenses and hashes remain in `provenance/` and
`vendor/native-types/`. The repository move is recorded separately; no identities,
goals, memories, credentials or game ledgers are moved by installing this package.

Version 0.4.0 is a locally verified release candidate, not a promise that it has
been published to npm or deployed to running agents.
