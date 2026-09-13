package dev.god.godvoice;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.PriorityQueue;
import java.util.function.Predicate;

/** Main-thread owned FIFO: one decoding/playing/draining item and four waiting items. */
final class SpeechLane<T extends SpeechLane.Item> {
    interface Item { String id(); long createdAt(); }
    private final PriorityQueue<T> waiting = new PriorityQueue<>(
            Comparator.comparingLong((T job) -> job.createdAt()).thenComparing(Item::id));
    private T current;

    String offer(T job) {
        if ((current != null && current.id().equals(job.id()))
                || waiting.stream().anyMatch(row -> row.id().equals(job.id()))) return "duplicate";
        if (waiting.size() >= 4) return "queue_full";
        waiting.add(job);
        return "queued";
    }

    T begin() {
        if (current == null) current = waiting.poll();
        return current;
    }
    T current() { return current; }
    int waitingCount() { return waiting.size(); }
    boolean finish(T job) {
        if (current != job) return false; // Late decoder/audio callbacks cannot complete a successor.
        current = null;
        return true;
    }
    List<T> removeWaiting(Predicate<T> invalid) {
        var removed = new ArrayList<T>();
        waiting.removeIf(job -> { if (!invalid.test(job)) return false; removed.add(job); return true; });
        return removed;
    }
}
