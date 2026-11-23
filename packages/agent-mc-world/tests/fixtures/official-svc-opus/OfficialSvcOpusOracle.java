import de.maxhenkel.voicechat.concentus.OpusApplication;
import de.maxhenkel.voicechat.concentus.OpusDecoder;
import de.maxhenkel.voicechat.concentus.OpusEncoder;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Test-only official Concentus codec from a Simple Voice Chat jar.
 * Matches OpusManager fallback: 48 kHz, 960 samples, VOIP, in-band FEC, 5% PLC, 1275-byte buffer.
 * Avoids JavaOpus*Impl because those classes initialize the Minecraft Log4J Voicechat logger.
 */
public final class OfficialSvcOpusOracle {
    public static void main(String[] args) throws Exception {
        OpusEncoder encoder = new OpusEncoder(48000, 1, OpusApplication.OPUS_APPLICATION_VOIP);
        encoder.setUseInbandFEC(true);
        encoder.setPacketLossPercent(5);
        OpusDecoder decoder = new OpusDecoder(48000, 1);
        byte[] encodeBuf = new byte[1275];
        DataInputStream in = new DataInputStream(new BufferedInputStream(System.in));
        DataOutputStream out = new DataOutputStream(new BufferedOutputStream(System.out));
        for (;;) {
            int cmd;
            try { cmd = in.readUnsignedByte(); }
            catch (EOFException end) { break; }
            if (cmd == 3) break;
            if (cmd == 1) {
                int samples = in.readUnsignedShort();
                if (samples == 0 || samples > 5760) throw new IllegalArgumentException("bad frame");
                byte[] raw = in.readNBytes(samples * 2);
                short[] pcm = new short[samples];
                ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm);
                int len = encoder.encode(pcm, 0, samples, encodeBuf, 0, encodeBuf.length);
                if (len < 0) throw new IllegalStateException("encode failed");
                out.writeShort(len);
                out.write(encodeBuf, 0, len);
                out.flush();
            } else if (cmd == 2) {
                int length = in.readUnsignedShort();
                byte[] opus = in.readNBytes(length);
                short[] pcm = new short[5760];
                int samples = decoder.decode(opus, 0, length, pcm, 0, 960, false);
                if (samples < 0) throw new IllegalStateException("decode failed");
                ByteBuffer buf = ByteBuffer.allocate(samples * 2).order(ByteOrder.LITTLE_ENDIAN);
                buf.asShortBuffer().put(pcm, 0, samples);
                out.writeShort(buf.array().length);
                out.write(buf.array());
                out.flush();
            } else {
                throw new IllegalArgumentException("bad cmd");
            }
        }
    }
}
