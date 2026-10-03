package com.dwinovo.numen.task;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class ExternalTaskResultSinkTest {
    private static final class Fake extends TaskRecord {
        Fake(String callId) {
            super("fake", callId, 100);
        }
    }

    @Test
    void routesTerminalResultToMatchingExternalCallOnlyOnce() {
        String callId = "mcp-test-terminal";
        AtomicReference<TaskResult> received = new AtomicReference<>();
        TaskResult expected = TaskResult.ok("found", java.util.Map.of("x", 42));
        try {
            ExternalTaskResultSink.register(callId, received::set);
            Fake unrelated = new Fake("mcp-other");
            unrelated.setResult(TaskResult.fail("unrelated"));
            assertFalse(ExternalTaskResultSink.deliver(unrelated));
            assertNull(received.get());

            Fake matching = new Fake(callId);
            matching.setResult(expected);
            assertTrue(ExternalTaskResultSink.deliver(matching));
            assertSame(expected, received.get());
            assertFalse(ExternalTaskResultSink.deliver(matching));
        } finally {
            ExternalTaskResultSink.unregister(callId);
        }
    }

    @Test
    void rejectsDuplicateOrNonExternalRegistration() {
        String callId = "mcp-test-duplicate";
        try {
            ExternalTaskResultSink.register(callId, ignored -> {});
            assertThrows(IllegalStateException.class,
                    () -> ExternalTaskResultSink.register(callId, ignored -> {}));
            assertThrows(IllegalArgumentException.class,
                    () -> ExternalTaskResultSink.register("ordinary-call", ignored -> {}));
        } finally {
            ExternalTaskResultSink.unregister(callId);
        }
    }
}
