package local.tlmcompat.hybrid;

/** Only one fresh, not-yet-started reply; no replay or unbounded speech backlog. */
final class MaidSpeechQueue<T> {
    static final long MAX_WAIT=10_000_000_000L;
    record Entry<T>(T item,long deadline){boolean expired(long now){return now>=deadline;}}
    private Entry<T> waiting;
    T offer(T item,long now){var old=waiting;waiting=new Entry<>(item,now+MAX_WAIT);return old==null?null:old.item();}
    Entry<T> peek(){return waiting;}
    Entry<T> take(){var result=waiting;waiting=null;return result;}
}
