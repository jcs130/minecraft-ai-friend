# Optional native client appearances

An explicit local display profile for Fabric 1.21.1 with the original YSM 2.4.1 mod. Other clients and the server are unchanged. This is separate from the vanilla PNG skin uploader and from the web viewer's appearance selection.

Build with `node scripts/build-client-appearances.mjs <matching-gameDir> --java-home <JDK21>`. Add `--install` only when the selected native client is stopped. No Agent or World restart is needed.

Create the private `config/agentmc-client-appearances.json`:

```json
{
  "enabled": true,
  "server": "example.test:25565",
  "observer": "camera_account",
  "followCameraInHud": true,
  "bindings": [
    {"uuid": "12345678-1234-1234-1234-1234567890ab", "model": "installed-model", "texture": "installed-texture.png"}
  ]
}
```

Both server and signed-in observer name must match. Only the configured player UUIDs are overridden locally. The model and exact texture key must already be provided by the server's model catalogue; this module does not download, grant, install or publish models, change server selections or send YSM commands. Missing model bytes can still produce a renderer fallback; the logged selection is not render verification.

The profile is authoritative for this client's display while connected; a later server selection for the same UUID is overridden. Remove a binding or disable the profile and reconnect **only this client** to return to server-controlled appearances. Players with no binding retain the server's appearance. Credentials, personal model files and role-specific names belong in the private deployment, never this package.

`followCameraInHud` is opt-in. YSM's extra-player HUD uses the current camera player as its draw subject, including that player's existing animation state, pose and equipment. It does not copy the observer's flight/teleport state, force a GUI/idle animation, rotate player state, or hide the tail. Without a camera player or a matching profile, the original HUD subject remains unchanged. This redirects only the YSM HUD render call and its orientation basis; normal world rendering is unchanged.

This adapter deliberately declares the verified YSM version. YSM's Java model interface is obfuscated and must be checked and recompiled for a different mod version; no broad compatibility claim is made.
