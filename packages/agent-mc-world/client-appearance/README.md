# Optional native client appearances

An explicit local display profile for Fabric 1.21.1 with the original YSM 2.4.1 or `2.6.5-fabric+mc1.21.1` mod. Other clients and the server are unchanged. This is separate from the vanilla PNG skin uploader and from the web viewer's appearance selection.

Build with `node scripts/build-client-appearances.mjs <matching-gameDir> --java-home <JDK21>`. Add `--install` only when the selected native client is stopped. No Agent or World restart is needed.

The builder reads the installed mod's metadata, selects one verified Java adapter and pins the output's dependency to that exact mod version. Unknown versions and duplicate YSM jars are rejected. The real dependency's draw and yaw hooks are checked with ASM before packaging; 2.6.5 requires both yaw samples used for interpolation. The adjacent `.provenance.json` records the original mod and output SHA-256 hashes. Runtime mod jars and model assets are not included in this package.

Create the private `config/agentmc-client-appearances.json`:

```json
{
  "enabled": true,
  "server": "example.test:25565",
  "observer": "camera_account",
  "followCameraInHud": true,
  "writeDiagnostics": false,
  "bindings": [
    {"uuid": "12345678-1234-1234-1234-1234567890ab", "model": "installed-model", "texture": "installed-texture.png"}
  ]
}
```

Both server and signed-in observer name must match. Only the configured player UUIDs are overridden locally. The model and exact texture key must already be provided by the server's model catalogue; this module does not download, grant, install or publish models, change server selections or send YSM commands. Missing model bytes can still produce a renderer fallback; the logged selection is not render verification.

The profile is authoritative for this client's display while connected; a later server selection for the same UUID is overridden. Remove a binding or disable the profile and reconnect **only this client** to return to server-controlled appearances. Players with no binding retain the server's appearance. Credentials, personal model files and role-specific names belong in the private deployment, never this package.

`followCameraInHud` is opt-in. YSM's extra-player HUD uses the current camera player as its draw subject, including that player's existing animation state, pose and equipment. It does not copy the observer's flight/teleport state, force a GUI/idle animation, rotate player state, or hide the tail. Without a camera player or a matching profile, the original HUD subject remains unchanged. This redirects only the YSM HUD render call and its orientation basis; normal world rendering is unchanged.

This adapter deliberately declares the verified YSM version. YSM's Java model interface is obfuscated and must be checked and recompiled for a different mod version; no broad compatibility claim is made.

The Java adapter does not translate the server's model transport or cache format. Check the actual catalogue and model rendering against the chosen server profile before switching an accepted client.

`writeDiagnostics` is opt-in. When a matching profile is active, `diagnostics/agentmc-client-appearances.json` is updated every 100 client ticks, with schema `agent-mc-client-appearance/v1`. It records `recordedAt`, `connected`, the client's reported `fps`, OpenGL `renderer` / `openglVersion`, `catalogueSize`, camera / HUD UUIDs, `hudFrames`, and the current local selection for visible configured bindings. Missing capabilities remain null. A disconnect writes `connected: false`; readers must check the timestamp and process state. Model selection is not proof that model geometry was rendered, and the frame rate is not a stream encoder metric. No screenshots, credentials, model bytes or server commands are recorded.

On Windows, a caller can isolate the game in a separate Java runtime with per-application GPU settings. An optional [Mesa D3D12](https://docs.mesa3d.org/drivers/d3d12.html) runtime can render on an integrated adapter while the desktop stays on another GPU. Verify the actual renderer and game frame rate; a power-saving preference alone does not prove which adapter a native OpenGL client used. Graphics libraries, display routing and stream encoder settings remain deployment choices, separate from this appearance adapter.
