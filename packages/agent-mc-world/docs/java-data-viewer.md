# Native client data viewer

For `provider: "java-client"`, `javaClient.viewerMode: "data"` selects the shared WebGL data viewer. It is the default for new native viewer configurations. Set `viewerPort` and a matching Minecraft 1.20.6 `viewerAssetsDir`. This requires the companion Java bridge advertising `visualData: "agent-mc-visual/v1"`.

The Java bridge reads the action player's already loaded ClientWorld and ClientPlayer. Shared `mc-visual-console` source translates the registry, real chunk sections/light and own movement into the old viewer's data messages. It does not simulate Mineflayer, log in a second observer, control the body or call models. The browser retains its own cameras. Actual `mc_visual` / photography capture can still use a screenshot separately.

`javaClient.viewerMode: "framebuffer"` with an explicit `viewerPageFile` retains the diagnostic native screenshot page. There is no silent fallback between modes.

Current data viewer is a partial vanilla 1.20.6 preview: terrain/block updates, own skin/movement/turning/vitals, time and weather. Other entities, container/inventory UI, mod resources/YSM and Java shaders are not yet renderer parity. Unknown native states are refused; the page and health endpoint disclose missing coverage. Keep production on its current configuration until the desired modules and deployment are explicitly validated.

Source of `core/java-data-viewer.mjs` is `jcs130/mc-visual-console` renderer-src/host. Rebuild via its `tools/build-java-data-host.mjs`; keep the emitted provenance alongside the bundle. Java native exporter source is `../agent-mc-java-bridge`, compiled against explicitly provided installed Fabric 1.20.6 / JDK 21 inputs. Build/installing source is separate from loading a running game. Preserve user goals/memory and existing restart authorization boundaries.
