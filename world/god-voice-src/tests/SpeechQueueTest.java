package dev.god.godvoice;

/** No world, model, network, microphone or audio output. */
public class SpeechQueueTest {
    static int n;
    static void check(boolean value, String label) { n++; if (!value) throw new AssertionError(label); }
    record Job(String id, long createdAt) implements SpeechLane.Item {}
    public static void main(String[] args) {
        var lane = new SpeechLane<Job>();
        var first = new Job("a", 10);
        check(lane.offer(first).equals("queued") && lane.begin() == first, "first reserves one playback slot");
        check(lane.offer(new Job("z", 30)).equals("queued"), "waiting z");
        check(lane.offer(new Job("c", 20)).equals("queued"), "waiting c");
        check(lane.offer(new Job("b", 20)).equals("queued"), "waiting b");
        check(lane.offer(new Job("d", 40)).equals("queued"), "four waiting plus current");
        check(lane.offer(new Job("overflow", 50)).equals("queue_full"), "fifth waiting rejected");
        check(lane.offer(first).equals("duplicate"), "current duplicate cannot play twice");
        check(lane.offer(new Job("b", 20)).equals("duplicate"), "waiting duplicate rejected");
        check(lane.begin() == first, "decode and interrupt drain keep lane occupied");
        check(!lane.finish(new Job("a", 10)), "identity guards against stale callback");
        check(lane.finish(first), "only original current can release its lane");
        Job second = lane.begin();
        check(second.id().equals("b"), "createdAt then id ordering");
        check(!lane.finish(first) && lane.current() == second, "late old decoder callback cannot finish successor");
        check(lane.removeWaiting(j -> j.createdAt() >= 30).size() == 2, "fence removes waiting work without stopping current implicitly");
        check(lane.waitingCount() == 1, "one same-generation pending item remains");
        var other = new SpeechLane<Job>();
        other.offer(new Job("other", 10));
        check(other.begin().id().equals("other") && lane.current() == second, "independent entities have independent lanes");
        var frames = new SpeechFrames(new short[961]);
        check(frames.get().length == 960 && !frames.completed(), "first native 20ms frame is not completion");
        check(frames.get().length == 960 && !frames.completed(), "last frame padded to exactly 960");
        check(frames.get() == null && frames.completed(), "natural exhaustion is distinguishable");
        var interrupted = new SpeechFrames(new short[2000]);
        interrupted.get(); interrupted.cancel();
        check(interrupted.get() == null && !interrupted.completed(), "interruption is never natural completion");
        frames.cancel();
        check(!frames.completed(), "explicit generation cancellation wins a racing natural-end callback");
        System.out.println("{\"ok\":true,\"assertions\":" + n + "}");
    }
}
