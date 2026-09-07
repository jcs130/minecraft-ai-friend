package dev.qiandeng.chanting.client.mixin;

import dev.qiandeng.chanting.client.ChantingClient;
import dev.qiandeng.chanting.client.StaffAudioDrain;
import de.maxhenkel.voicechat.voice.client.MicrophoneProcessor;
import de.maxhenkel.voicechat.voice.client.ClientVoicechatConnection;
import de.maxhenkel.voicechat.voice.client.microphone.Microphone;
import java.util.concurrent.atomic.AtomicLong;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** SVC 2.6.22 audio-thread barrier. It flushes its real native stop packet and
 * drops already captured PCM; original PTT keys and microphone lock stay intact. */
@Mixin(targets = "de.maxhenkel.voicechat.voice.client.MicThread", remap = false)
public abstract class StaffAudioMixin {
    @Shadow @Final private AtomicLong sequenceNumber;
    @Shadow @Final private ClientVoicechatConnection connection;
    @Shadow private MicrophoneProcessor microphoneProcessor;
    @Shadow private Microphone mic;
    @Shadow private void flush() { throw new AssertionError(); }
    @Unique private long qiandeng$epoch = -1;
    @Unique private int qiandeng$frameSamples;
    @Unique private final StaffAudioDrain qiandeng$drain = new StaffAudioDrain();
    @Inject(method = "pollProcessedAudio(Z)[S", at = @At("RETURN"), remap = false)
    private void qiandeng$frameSize(boolean activation, CallbackInfoReturnable<short[]> ci) {
        short[] pcm = ci.getReturnValue();
        qiandeng$frameSamples = pcm == null ? 0 : pcm.length;
    }
    @Inject(method = "sendAudio([SZ)V", at = @At("HEAD"), cancellable = true, remap = false)
    private void qiandeng$boundary(short[] pcm, boolean whispering, CallbackInfo ci) {
        long epoch = ChantingClient.audioGate().pendingFlush();
        if (epoch < 0) return;
        try {
            if (connection == null || !connection.isInitialized() || mic == null) return;
            if (qiandeng$epoch != epoch) {
                qiandeng$epoch = epoch;
                // available() is SAMPLES, not frames. Leave partial frames to SVC's
                // ordinary non-blocking poll, discarding enough subsequent PCM to
                // remove everything captured before this exact boundary.
                flush();
            }
            var state = qiandeng$drain.update(epoch, qiandeng$frameSamples, mic.available());
            microphoneProcessor.reset();
            if (state == StaffAudioDrain.State.FAILED) ChantingClient.audioGate().fail(epoch);
            else if (state == StaffAudioDrain.State.READY) ChantingClient.audioGate().flushed(epoch, sequenceNumber.get() - 1);
        } catch (RuntimeException error) { ChantingClient.audioGate().fail(epoch); }
        finally { ci.cancel(); }
    }
}
