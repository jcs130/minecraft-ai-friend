package dev.god.godvoice;

/** Packet arrival bounds, used under MicCapture's existing monitor. */
final class CaptureInterval {
    record Snapshot(long startedAt, long endedAt) {}
    private final long silenceMs;
    private long firstPacketAt, lastPacketAt;

    CaptureInterval(long silenceMs) {
        if (silenceMs < 0) throw new IllegalArgumentException("invalid_silence");
        this.silenceMs = silenceMs;
    }

    boolean shouldSplit(long packetAt) {
        return firstPacketAt > 0 && packetAt - lastPacketAt > silenceMs;
    }

    void recordPacket(long packetAt) {
        if (packetAt <= 0 || (firstPacketAt > 0 && packetAt < lastPacketAt))
            throw new IllegalArgumentException("invalid_packet_time");
        if (firstPacketAt == 0) firstPacketAt = packetAt;
        lastPacketAt = packetAt;
    }

    Snapshot snapshot() {
        if (firstPacketAt == 0) throw new IllegalStateException("empty_interval");
        Snapshot result = new Snapshot(firstPacketAt, lastPacketAt);
        clear();
        return result;
    }

    void clear() { firstPacketAt = 0; lastPacketAt = 0; }
}
