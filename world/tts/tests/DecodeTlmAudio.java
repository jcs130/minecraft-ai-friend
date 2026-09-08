import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.UnsupportedAudioFileException;
import com.github.tartaricacid.touhoulittlemaid.libs.javazoom.spi.mpeg.sampled.file.MpegAudioFileReader;

/** Decoder-equivalent to installed TLM 1.5.3 Mp3AudioStream's constructor/read.
 * Uses its exact bundled MPEG reader + AudioSystem conversion provider; avoids
 * Minecraft/LWJGL/audio-device dependencies. Only reads explicitly supplied QA
 * products. Never starts a game, opens a speaker or calls a synthesis service.
 */
public class DecodeTlmAudio {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("mp3-path pcm-wav-path");
        byte[] mp3 = Files.readAllBytes(Path.of(args[0]));
        long count = 0;
        try (var original = new MpegAudioFileReader().getAudioInputStream(new ByteArrayInputStream(mp3))) {
            var source = original.getFormat();
            var target = new AudioFormat(AudioFormat.Encoding.PCM_SIGNED,
                    source.getSampleRate(), 16, source.getChannels(), source.getChannels() * 2,
                    source.getSampleRate(), false);
            try (var decoded = AudioSystem.getAudioInputStream(target, original)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = decoded.read(buffer)) >= 0) count += read;
                if (count <= 0) throw new AssertionError("Decoder produced no PCM");
                System.out.println("TLM_MP3_DECODED_PCM_BYTES=" + count);
                System.out.println("TLM_MP3_DECODED_RATE=" + decoded.getFormat().getSampleRate());
            }
        }
        byte[] wav = Files.readAllBytes(Path.of(args[1]));
        try (var rejected = new MpegAudioFileReader().getAudioInputStream(new ByteArrayInputStream(wav))) {
            throw new AssertionError("PCM WAV unexpectedly accepted");
        } catch (UnsupportedAudioFileException expected) {
            if (!"WAV PCM stream found".equals(expected.getMessage())) throw expected;
            System.out.println("TLM_PCM_WAV_REJECTED=true");
        }
    }
}
