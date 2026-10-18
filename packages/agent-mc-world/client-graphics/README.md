# Optional Windows client graphics bridge

Fabric 1.21.1 / Java 21. The opt-in property `agentmc.graphics.openglLibrary` selects an explicit OpenGL library after client mod initialization and before the first window. With no property this module does nothing. Replacing a library after an OpenGL context is active is rejected.

This supports a dedicated integrated-GPU game process while another GPU remains the main display and compute adapter. Tested deployments use Mesa 26.2.4 with D3D12 or Zink/Vulkan, the original YSM 2.4.1 mod and a separate Java runtime. Initializing Mesa before the old model mod fails; deferred loading retains its original model/cache protocol. This module does not replace YSM, its assets or the server.

Build from a previously launched matching game directory:

```text
node scripts/build-client-graphics.mjs <gameDir> --java-home <JDK21> --mesa-dir <Mesa x64 directory> --install
```

Use an isolated game profile. The builder copies the original GLFW native and changes only its two WGL library-name strings from `opengl32.dll` to the equal-length `mesaGL32.dll` alias. The original native and all system libraries remain unchanged. Only the verified Minecraft 1.21.1 / LWJGL 3.3.3 GLFW SHA-256 is accepted; a changed native requires new verification. The generated `agentmc-graphics/launch.json` (`agent-mc-client-graphics/v1`) contains the required library arguments, optional driver arguments and input/output hashes. Pass its `jvmArgs` with that profile's existing memory arguments. The script installs only the optional client mod when `--install` is supplied.

If a launcher replaces its extracted natives on startup, `--glfw-native <verified glfw.dll>` selects a separately preserved input. The same SHA-256 and two-string checks still apply; the generated private library is independent of future native extraction.

Provide a separately trusted [Mesa Windows build](https://github.com/pal1000/mesa-dist-win) and retain its notices. Depending on the DLL loader, Mesa's `libgallium_wgl.dll` and `dxil.dll` may need to be placed beside this profile's dedicated Java executable. GPU preference is per executable. For explicit Vulkan GPU selection, pass `--mesa-driver zink --vulkan-driver-file <trusted vendor ICD json>`. The optional pre-launch entrypoint sets `GALLIUM_DRIVER` and `VK_DRIVER_FILES` in this process before Mesa/Vulkan initialize. It does not alter the parent, registry or global environment. D3D12 can instead be selected with `--mesa-driver d3d12`, but its adapter selection still depends on the Windows launch/display context. Quote each complete JVM argument when the launcher's configuration is a command string. Verify the actual OpenGL renderer, GPU engine counters, frame rate and model rendering before switching an accepted client. Desktop composition and stream encoding may still use another GPU.

This package distributes source and build tools, not Mesa, GLFW binaries or game/model assets. GLFW's original [zlib/libpng license](https://github.com/glfw/glfw/blob/3.4/LICENSE.md) applies to the generated private derivative; its library-name alias modification must be identified when redistributing it. Mesa notices remain applicable to its unmodified DLLs.
