package dev.god.botgate;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.concurrent.TimeUnit;

/** One bounded RCON request frame, independent of TCP read/write boundaries. */
public final class RconFrameReader {
    /** Length field includes request ID, type and two NULs, but excludes itself. */
    public static final int MAX_FRAME_LENGTH = 65_536;
    private static final long FRAME_TIMEOUT_NANOS = TimeUnit.SECONDS.toNanos(10);

    private RconFrameReader() { }

    public static byte[] readFrame(InputStream input, int maximumLength) throws IOException {
        return readFrame(input, maximumLength, null);
    }

    public static byte[] readFrame(InputStream input, int maximumLength, Socket socket) throws IOException {
        if (maximumLength < 10 || maximumLength > MAX_FRAME_LENGTH) {
            throw new IllegalArgumentException("RCON frame bound must be 10..65536");
        }
        // Preserve vanilla's unlimited idle wait. Once a frame begins, partial
        // header/body reads share a deadline instead of waiting forever.
        if (socket != null) socket.setSoTimeout(0);
        int first = input.read();
        if (first == -1) return null;
        long deadline = System.nanoTime() + FRAME_TIMEOUT_NANOS;
        try {
            byte[] header = new byte[4];
            header[0] = (byte) first;
            readExactly(input, header, 1, 3, socket, deadline);
            int length = (header[0] & 255) | ((header[1] & 255) << 8)
                    | ((header[2] & 255) << 16) | ((header[3] & 255) << 24);
            // Validate before allocation and before adding the header's four bytes.
            if (length < 10 || length > maximumLength) {
                throw new IOException("Invalid RCON frame length: " + length);
            }
            byte[] frame = new byte[length + 4];
            System.arraycopy(header, 0, frame, 0, 4);
            readExactly(input, frame, 4, length, socket, deadline);
            if (frame[frame.length - 2] != 0 || frame[frame.length - 1] != 0) {
                throw new IOException("RCON frame is missing its two NUL terminators");
            }
            return frame;
        } finally {
            if (socket != null && !socket.isClosed()) socket.setSoTimeout(0);
        }
    }

    private static void readExactly(InputStream input, byte[] bytes, int offset, int count,
                                    Socket socket, long deadline) throws IOException {
        int end = offset + count;
        while (offset < end) {
            if (socket != null) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) throw new SocketTimeoutException("Incomplete RCON frame timed out");
                socket.setSoTimeout((int) Math.max(1, TimeUnit.NANOSECONDS.toMillis(remaining)));
            }
            int read = input.read(bytes, offset, end - offset);
            if (read == -1) throw new EOFException("Truncated RCON frame");
            if (read == 0) {
                // InputStream implementations should progress, but never spin if a
                // wrapper returns zero for a nonempty request.
                int value = input.read();
                if (value == -1) throw new EOFException("Truncated RCON frame");
                bytes[offset++] = (byte) value;
            } else {
                offset += read;
            }
        }
    }
}
