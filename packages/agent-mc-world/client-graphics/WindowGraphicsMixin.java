package org.agentmc.graphics.mixin;

import java.nio.file.Files;
import java.nio.file.Path;
import org.lwjgl.opengl.GL;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Select the explicit graphics library after client mod initialization, before the first window. */
@Mixin(targets="net.minecraft.class_3682", remap=false)
public abstract class WindowGraphicsMixin {
    @Unique private static boolean selected;
    @Inject(method="method_16038", at=@At("HEAD"), require=1, remap=false)
    private void selectGraphicsLibrary(CallbackInfoReturnable<net.minecraft.class_1041> result) throws Exception {
        String configured = System.getProperty("agentmc.graphics.openglLibrary", "");
        if (configured.isBlank() || selected) return;
        if (!System.getProperty("os.name", "").startsWith("Windows"))
            throw new IllegalStateException("This graphics library bridge requires Windows");
        Path library = Path.of(configured).toRealPath();
        if (!Files.isRegularFile(library)) throw new IllegalArgumentException("OpenGL library is not a regular file");
        boolean contextActive;
        try { contextActive = GL.getCapabilities() != null; }
        catch (IllegalStateException unavailable) { contextActive = false; }
        if (contextActive) throw new IllegalStateException("Cannot replace a library after an OpenGL context is active");
        GL.destroy();
        GL.create(library.toString());
        selected = true;
        System.out.println("[AgentMCClientGraphics] Explicit OpenGL library selected before window creation");
    }
}
