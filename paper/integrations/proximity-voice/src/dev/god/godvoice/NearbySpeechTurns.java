package dev.god.godvoice;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Coordinate nearby audible speech. Microphone activity always takes precedence over a new playback. */
final class NearbySpeechTurns {
    static final long GAP_MS = 450, LOST_STOP_MS = 900;
    private static final long MAX_PLAYBACK_MS = 35_000; // Normalized audio is at most 30 s.
    record Place(UUID world, double x, double y, double z, double range) {
        boolean hears(Place other) {
            if (!world.equals(other.world)) return false;
            double dx=x-other.x, dy=y-other.y, dz=z-other.z;
            return dx*dx+dy*dy+dz*dz <= range*range;
        }
    }
    private record Turn(UUID id, Place place, long until) {}
    private final Map<UUID,Turn> microphones = new HashMap<>(), playback = new HashMap<>();

    synchronized void microphone(UUID speaker, UUID session, Place place, boolean ended, long now) {
        var old = microphones.get(speaker);
        if (ended && (old == null || !old.id().equals(session))) return;
        microphones.put(speaker, new Turn(session, place, now + (ended ? GAP_MS : LOST_STOP_MS)));
    }

    synchronized boolean begin(UUID speaker, UUID request, Place place, long now) {
        microphones.values().removeIf(v -> v.until() <= now);
        playback.values().removeIf(v -> v.until() <= now);
        var own = playback.get(speaker);
        for (var other : microphones.values()) {
            if (other.place().hears(place)) {
                if (own != null && request.equals(own.id())) playback.remove(speaker);
                return false;
            }
        }
        if (own != null && request.equals(own.id())) return true;
        for (var other : playback.values()) if (other.place().hears(place) || place.hears(other.place())) return false;
        playback.put(speaker, new Turn(request, place, now+MAX_PLAYBACK_MS));
        return true;
    }

    synchronized void end(UUID speaker, UUID request, long now) {
        var old = playback.get(speaker);
        if (old != null && request.equals(old.id())) playback.put(speaker, new Turn(null,old.place(),now+GAP_MS));
    }

    synchronized void update(VoiceAudience.Snapshot scene, long now) {
        microphones.values().removeIf(v -> v.until() <= now);
        playback.values().removeIf(v -> v.until() <= now);
        playback.replaceAll((id, turn) -> {
            var at = scene.actors().get(id);
            if (turn.id()==null || at==null || !at.world().equals(turn.place().world())) return turn;
            if (at.x()==turn.place().x() && at.y()==turn.place().y() && at.z()==turn.place().z()) return turn;
            return new Turn(turn.id(), new Place(at.world(),at.x(),at.y(),at.z(),turn.place().range()),turn.until());
        });
    }

    synchronized void forget(UUID speaker) { microphones.remove(speaker); playback.remove(speaker); }
    synchronized void clear() { microphones.clear(); playback.clear(); }
}
