package dev.qiandeng.chanting;

import java.util.ArrayDeque;
import java.util.List;

/** Client-bound plain-data mailbox. No client classes are loaded on dedicated servers. */
public final class StaffAudioMailbox {
    private static final ArrayDeque<StaffAudioStatePayload> QUEUE = new ArrayDeque<>();
    public static synchronized void accept(StaffAudioStatePayload p) { if (QUEUE.size() == 16) QUEUE.removeFirst(); QUEUE.addLast(p); }
    public static synchronized List<StaffAudioStatePayload> drain() { var result = List.copyOf(QUEUE); QUEUE.clear(); return result; }
    public static synchronized void clear() { QUEUE.clear(); }
    private StaffAudioMailbox() { }
}
