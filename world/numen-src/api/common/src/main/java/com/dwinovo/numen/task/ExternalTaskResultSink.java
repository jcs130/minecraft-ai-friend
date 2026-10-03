package com.dwinovo.numen.task;

import com.dwinovo.numen.platform.ServerLifecycle;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;

/** Server-thread result route for an external caller without an online owner client. */
public final class ExternalTaskResultSink {
    private static final Map<String, Consumer<TaskResult>> SINKS = new HashMap<>();

    static {
        ServerLifecycle.onStopped(SINKS::clear);
    }

    private ExternalTaskResultSink() {}

    public static void register(String callId, Consumer<TaskResult> sink) {
        if (callId == null || !callId.startsWith(TaskRecord.EXTERNAL_CALL_PREFIX) || sink == null) {
            throw new IllegalArgumentException("An external call ID and result sink are required");
        }
        if (SINKS.putIfAbsent(callId, sink) != null) {
            throw new IllegalStateException("Duplicate external call ID: " + callId);
        }
    }

    public static void unregister(String callId) {
        SINKS.remove(callId);
    }

    /** True only when a caller registered to receive this record's terminal result. */
    static boolean deliver(TaskRecord record) {
        Consumer<TaskResult> sink = SINKS.remove(record.getToolCallId());
        if (sink == null) return false;
        TaskResult result = record.getResult();
        sink.accept(result == null ? TaskResult.fail("no result produced") : result);
        return true;
    }
}
