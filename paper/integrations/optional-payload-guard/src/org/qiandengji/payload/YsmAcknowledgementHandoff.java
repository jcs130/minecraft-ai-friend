package org.qiandengji.payload;

import java.util.Arrays;
import java.util.IdentityHashMap;
import java.util.Map;

/** An original acknowledgement can follow a physical client to a replacement game connection. */
final class YsmAcknowledgementHandoff {
    static final String CHANNEL = "yes_steve_model:2_6_0";
    private static final byte[] GREETING = {51, 5, '2', '.', '6', '.', '0'};
    private static final byte[] ACK = {52, 5, '2', '.', '6', '.', '0'};

    private static final class Session {
        final byte[] acknowledgement;
        Object acknowledgedBackend;
        Object pendingBackend;
        Object attemptedBackend;

        Session(Object backend, byte[] bytes) {
            acknowledgedBackend = backend;
            acknowledgement = bytes.clone();
        }
    }

    private final Map<Object, Session> sessions = new IdentityHashMap<>();

    synchronized boolean received(Object player, Object backend, byte[] bytes) {
        if (player == null || backend == null || !Arrays.equals(ACK, bytes)) return false;
        Session session = sessions.get(player);
        if (session != null) {
            session.acknowledgedBackend = backend;
            return true;
        }
        if (sessions.size() >= 512) return false;
        sessions.put(player, new Session(backend, bytes));
        return true;
    }

    synchronized boolean queueForGreeting(Object player, Object backend, byte[] bytes) {
        Session session = sessions.get(player);
        if (session == null || backend == null || !Arrays.equals(GREETING, bytes)) return false;
        if (session.acknowledgedBackend == backend || session.pendingBackend == backend || session.attemptedBackend == backend) return false;
        session.pendingBackend = backend;
        return true;
    }

    synchronized byte[] take(Object player, Object backend) {
        Session session = sessions.get(player);
        if (session == null || backend == null || session.pendingBackend != backend) return null;
        session.pendingBackend = null;
        if (session.acknowledgedBackend == backend) return null;
        session.attemptedBackend = backend;
        return session.acknowledgement.clone();
    }

    synchronized void left(Object player) { sessions.remove(player); }

    synchronized void clear() { sessions.clear(); }
}
