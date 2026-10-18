package org.agentmc.graphics;

import java.nio.file.Files;
import java.nio.file.Path;
import com.sun.jna.platform.win32.Kernel32;
import net.fabricmc.loader.api.entrypoint.PreLaunchEntrypoint;

/** Configure only this process, before Mesa or the Vulkan loader can cache their environment. */
public final class GraphicsEnvironment implements PreLaunchEntrypoint {
    @Override public void onPreLaunch() {
        if (System.getProperty("agentmc.graphics.openglLibrary", "").isBlank()) return;
        String driver = System.getProperty("agentmc.graphics.mesaDriver", "").strip();
        String icd = System.getProperty("agentmc.graphics.vulkanDriverFile", "").strip();
        if (driver.isEmpty() && icd.isEmpty()) return;
        if (!System.getProperty("os.name", "").startsWith("Windows"))
            throw new IllegalStateException("This graphics environment requires Windows");
        if (!driver.equals("zink") && !driver.equals("d3d12"))
            throw new IllegalArgumentException("The verified Mesa drivers are zink and d3d12");
        if (!icd.isEmpty()) {
            if (!driver.equals("zink")) throw new IllegalArgumentException("A Vulkan ICD requires zink");
            try {
                Path file = Path.of(icd).toRealPath();
                if (!Files.isRegularFile(file)) throw new IllegalArgumentException("Vulkan ICD must be a regular file");
                set("VK_DRIVER_FILES", file.toString());
            } catch (java.io.IOException error) {
                throw new IllegalArgumentException("Vulkan ICD is unavailable", error);
            }
        }
        set("GALLIUM_DRIVER", driver);
        System.out.println("[AgentMCClientGraphics] Process-local Mesa driver configured: " + driver);
    }
    private static void set(String key, String value) {
        if (!Kernel32.INSTANCE.SetEnvironmentVariable(key, value))
            throw new IllegalStateException("Could not set process-local graphics environment: " + key);
    }
}
