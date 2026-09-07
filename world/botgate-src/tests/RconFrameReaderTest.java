import dev.god.botgate.RconFrameReader;
import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public class RconFrameReaderTest {
    private static int assertions;
    private static final int MAX = RconFrameReader.MAX_FRAME_LENGTH;

    public static void main(String[] args) throws Exception {
        byte[] unicode = frame(71, 2, "tellraw @a [\"" + "中文灯火".repeat(800) + "\"]");
        byte[] auth = frame(70, 3, "local-test-value");
        check(unicode.length > 1460, "fixture exceeds old limit");
        check(Arrays.equals(read(new ByteArrayInputStream(unicode)), unicode), "large UTF-8 exact bytes");
        check(Arrays.equals(read(fragmented(unicode, 1)), unicode), "one-byte header and body fragments");
        check(Arrays.equals(read(fragmented(unicode, 7)), unicode), "uneven body fragments");

        ByteArrayOutputStream joined = new ByteArrayOutputStream();
        joined.write(auth); joined.write(unicode); joined.write(frame(72, 2, "list"));
        BufferedInputStream stream = new BufferedInputStream(new ByteArrayInputStream(joined.toByteArray()), 32768);
        check(Arrays.equals(read(stream), auth), "coalesced auth first frame");
        check(Arrays.equals(read(stream), unicode), "buffered next frame retained");
        check(Arrays.equals(read(stream), frame(72, 2, "list")), "third frame kept in order");
        check(read(stream) == null, "clean EOF after frames");
        check(read(new ByteArrayInputStream(new byte[0])) == null, "clean initial EOF");
        byte[] empty = frame(1, 2, "");
        check(Arrays.equals(read(new ByteArrayInputStream(empty)), empty), "minimum legal length 10");
        byte[] boundary = frame(2, 2, "x".repeat(MAX - 10));
        check(Arrays.equals(read(new ByteArrayInputStream(boundary)), boundary), "exact maximum length");
        fails(new byte[]{1}, EOFException.class, "truncated header");
        fails(Arrays.copyOf(unicode, unicode.length - 1), EOFException.class, "truncated body");
        fails(header(-1), IOException.class, "negative length rejected before allocation");
        fails(header(9), IOException.class, "short length rejected");
        fails(header(MAX + 1), IOException.class, "over-bound length rejected before body");
        fails(header(Integer.MAX_VALUE), IOException.class, "overflow-sized length rejected");
        byte[] bad = empty.clone(); bad[bad.length - 1] = 1;
        fails(bad, IOException.class, "missing final NUL");
        bad = empty.clone(); bad[bad.length - 2] = 1;
        fails(bad, IOException.class, "missing string NUL");
        ByteArrayOutputStream partial = new ByteArrayOutputStream();
        partial.write(auth); partial.write(Arrays.copyOf(unicode, 20));
        BufferedInputStream tail = new BufferedInputStream(new ByteArrayInputStream(partial.toByteArray()));
        check(Arrays.equals(read(tail), auth), "complete frame before truncated successor retained");
        try { read(tail); throw new AssertionError("truncated successor accepted"); }
        catch (EOFException expected) { assertions++; }
        System.out.println("RconFrameReader: " + assertions + " assertions passed");
    }

    private static byte[] read(InputStream input) throws IOException {
        return RconFrameReader.readFrame(input, MAX);
    }
    private static byte[] header(int length) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(length).array();
    }
    private static byte[] frame(int id, int type, String text) {
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(payload.length + 14).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(payload.length + 10).putInt(id).putInt(type).put(payload).put((byte) 0).put((byte) 0).array();
    }
    private static InputStream fragmented(byte[] bytes, int chunk) {
        return new ByteArrayInputStream(bytes) {
            @Override public synchronized int read(byte[] target, int offset, int length) {
                return super.read(target, offset, Math.min(chunk, length));
            }
        };
    }
    private static void fails(byte[] bytes, Class<? extends IOException> type, String label) throws Exception {
        try { read(new ByteArrayInputStream(bytes)); throw new AssertionError(label); }
        catch (IOException expected) { check(type.isInstance(expected), label); }
    }
    private static void check(boolean value, String label) {
        assertions++;
        if (!value) throw new AssertionError(label);
    }
}
