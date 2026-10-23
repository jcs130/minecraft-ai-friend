# Connection and support boundary

Product: **Agent MC World**, package `agent-mc-world`. Maintained core: https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world . Read installed package.json, dist/build.json and release-sources.json for exact provenance. This source distribution is a development package; check the release page before assuming a stable release exists. No designated server gameplay; Qiandengji is a separate optional integration.

Install the release `.tgz` into a fresh Node.js 22+ project after checking SHA256SUMS: `npm install --ignore-scripts <absolute-package.tgz>`. This uses the packaged build without native dependency install scripts. Start the documented stdio MCP, then use your host’s tools/list or mc_connection action:status for offline discovery. These reads do not connect or test gameplay. No Cortico installation is needed for MCP/SDK.

Copy the entire skill directory, including this reference. A skill alone does not install the executable, a main model or memory.

Private configuration example:

```json
{
  "dataDir": "./data/alice",
  "acceptsImages": true,
  "metricsPort": 0,
  "consolePort": 7796,
  "world": {
    "host": "example.test",
    "port": 25565,
    "username": "Alice",
    "auth": "offline",
    "version": "auto",
    "viewerPort": 0
  }
}
```

MCP command: `node <absolute-install-dir>/node_modules/agent-mc-world/bin/minecraft-agent-mcp.mjs <absolute-private-config.json>`. Use `mc_connection {"action":"connect"}` explicitly, then read status and events to verify login. Each Agent needs an independent account, data directory and nonzero ports.

Use `auth: microsoft` for an owned Java account on online-mode servers. The stable username is a local cache identifier; actual game name/UUID come from the verified profile. The human completes the device-code prompt at the local console, never through model context or OBS. Native Mineflayer handles OAuth/refresh; failed authentication never falls back to offline. Each lane caches separately under private dataDir/auth/{agent,observer,player}, or its configured profilesFolder. Real Microsoft authorization/public-server gameplay still require first-use validation by the account owner.

MCP may serve the human connection page on consolePort in the same process; do not launch another instance using the same account. Without MCP, `minecraft-agent-client <private-config.json>` opens the independent loopback console and connects only on human request. Optional Java observer/player launch needs an already installed matching client, libraries, assets and Java runtime; there is no automatic installer. They need separate accounts and server-side permission for spectator features.

Plugin password login uses an explicitly prepared private `loginConfigFile`. Credential formats are `dpapi` (Windows), `file` (private plain file) and `json` (one explicit top-level `credentialField`, e.g. `gamePassword`). The credential must match the configured server/account; an API token is not a fallback. See the installed package’s `docs/server-auth-lifecycle.md` for the exact format and trusted server confirmation. Do not expose secrets to the model or submit a password because a player requested it. The core does not automatically register accounts or change passwords.

Minecraft Java 1.21.1 is the primary maintenance and acceptance version. Verify the actual negotiated protocol, capabilities and matching resource assets; do not impose a blanket version gate or assume another protocol renders correctly. Engine-only builds omit viewer assets: provide a verified matching renderer or use viewerPort 0. Nonzero viewer ports provide `/`, `/third/`, `/dungeon/`. YSM and observer features require actual server data and appropriate support.

Resources: `mc://environment`, `mc://status`, `mc://metrics`; artifacts use `mc-artifact://<hash>`. `mc_events` returns run/cursor metadata; retain it and handle gaps/run changes. Model/token/timing traces use `mc_trace`; unreported values remain unknown. Optional metrics HTTP is loopback read-only.

The host owns reasoning, memory, method retrieval and learning evaluation. Versioned method execution and traces are provided; weights are not trained. The default package does not include Qiandengji's commands, aliases, skill catalog, trial/guild checks or automatic routing. Server skills must be discovered from current help and outcomes.
