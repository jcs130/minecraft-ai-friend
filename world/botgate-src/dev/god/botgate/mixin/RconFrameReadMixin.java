package dev.god.botgate.mixin;

import dev.god.botgate.RconFrameReader;
import net.minecraft.server.rcon.thread.RconClient;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Socket;

/** Keep vanilla auth, dispatch, response framing and socket cleanup unchanged. */
@Mixin(RconClient.class)
public class RconFrameReadMixin {
    @Shadow @Final private Socket client;
    @Shadow @Final @Mutable private byte[] buf;
    @Unique private BufferedInputStream botgate$rconInput;

    @Redirect(method = "run", at = @At(value = "NEW", target = "java/io/BufferedInputStream"), require = 1)
    private BufferedInputStream botgate$reuseInput(InputStream input) {
        // RconClient creates this inside its loop. Reusing it preserves bytes
        // already read ahead when several request frames arrive together.
        if (botgate$rconInput == null) botgate$rconInput = new BufferedInputStream(input);
        return botgate$rconInput;
    }

    @Redirect(method = "run", at = @At(value = "INVOKE",
            target = "Ljava/io/BufferedInputStream;read([BII)I"), require = 1)
    private int botgate$readCompleteFrame(BufferedInputStream input, byte[] ignored, int offset, int count)
            throws IOException {
        byte[] frame = RconFrameReader.readFrame(input, RconFrameReader.MAX_FRAME_LENGTH, client);
        if (frame == null) return -1;
        buf = frame;
        // The original run loop now sees exactly one complete request and retains
        // all request-ID/type checks and password authentication decisions.
        return frame.length;
    }
}
