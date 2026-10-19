# Complete viewer resources on first setup

The public `build:release` profile ships the modern viewer, both versioned resource
catalogs, textures/models and public original BGM. The original Minecraft `.ogg`
files are described by `audio-downloads.json` and obtained directly from Mojang's
content-addressed resource service when an operator starts setup. No private model,
account, skin, reference art, world save or live deployment is a build input.

The regular `build:viewer` profile is still a complete offline bundle. The release
profile has a network prerequisite on its first run; it must not be described as
an offline-ready bundle or as having already downloaded audio.

```js
import { MINECRAFT_CLIENT_DEFAULTS, prepareMinecraftViewerAssets,
  parseMinecraftServerAddress } from 'agent-mc-world/client';

const server = parseMinecraftServerAddress('mc.example.com:25565');
const viewer = await prepareMinecraftViewerAssets({
  templateDir: MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir,
  cacheDir: '/private/agent-data/viewer-cache',
  signal: controller.signal,
  onProgress: ({ phase, completed, total }) => console.log(phase, completed, total),
});
// Pass viewer.directory as viewerAssetsDir when explicitly connecting your client.
```

`parseMinecraftServerAddress` accepts a host, host:port, plain IPv6 or [IPv6]:port,
returns a separate host/port pair, and performs no DNS lookup or network request.
The default port is 25565. URLs, embedded credentials, paths and invalid ports fail.

Preparation returns only after every indexed audio file verifies. Files are cached
by hash; repeated logical paths across Minecraft versions share a downloaded object.
HTTP errors, timeouts, cancellation, excess bytes or mismatched checksums reject the
operation. Retrying verifies and reuses completed objects. No model calls or game
actions occur. Hosts should present progress and keep failure visible rather than
calling acceptance a successful connection. Full templates without the deferred
catalog are returned unchanged and cause no download.

The Cortico adapter invokes this port on explicit World startup, persists the cache
path in that deployment and then connects the game. Other SDK/MCP hosts may choose
their own setup UI and call the same public port before connecting. A custom viewer
directory remains an explicit operator choice. Back up the deployment's configuration
and data together; cache directories can be recreated by selecting the bundled
resource template and running preparation again.

Resources keep their original provenance and applicable rights. MIT covers this
project's code; it does not relicense Mojang content or third-party assets. Public
original BGM retains its accompanying provenance manifest.
