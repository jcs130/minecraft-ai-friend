# Repair a connected body's web picture

Use `mc_connection {"action":"viewer-status"}`. Read the actual version, resource directory and guide. Missing visual assets do not mean the game protocol is unsupported. Keep useful game work running; do not reconnect, start another account or replay pending actions to repair presentation.

Follow the shared renderer's [version-neutral preparation guide](https://github.com/jcs130/mc-visual-console/blob/main/docs/vanilla-viewer-resources.md). The maintained helper downloads the requested official client, verifies its metadata/hash, exports the exact original assets, builds against that version's registry and validates world models before installation. Use the returned viewer directory as `--output`; dependencies are installed in a separate renderer checkout, not by editing a globally installed plugin. No model call, game login or server password is involved.

After successful preparation, call `mc_connection {"action":"viewer-retry"}` and poll `viewer-status` for `phase:"ready"`. This retries the failed presentation server on the existing body. A preparation exit code alone is not proof of a rendered scene; verify the viewer's health and visible terrain. Missing optional item icons or display fonts are local feature gaps; report them and keep the working world view. Never relabel another version's numeric state registry as the requested version.

For DSH, choose an existing capability preset with filesystem/terminal tools if resource preparation needs them; the Minecraft tools intentionally do not install programs or execute arbitrary shell commands. If tools or write access are absent, give the user the exact preparation command and missing prerequisite. Preserve the host's original goals, memory, model and identity.
