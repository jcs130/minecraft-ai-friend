package dev.god.godvoice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** 统一日志出口。 */
public final class GodVoiceLog {
    public static final Logger LOG = LoggerFactory.getLogger("godvoice");

    private GodVoiceLog() {
    }

    public static void info(String msg) {
        LOG.info("[godvoice] {}", msg);
    }

    public static void warn(String msg, Throwable t) {
        LOG.warn("[godvoice] {}", msg, t);
    }

    public static void warn(String msg) {
        LOG.warn("[godvoice] {}", msg);
    }
}
