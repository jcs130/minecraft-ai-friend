package dev.qiandeng.chanting;

import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/** Versioned, optional synchronous boundary. Recorder listens through the base event;
 * neither mod needs the other's classes on its compile/runtime classpath. */
public final class StaffAudioBoundaryEvent extends PlayerEvent {
    private final String phase;
    private final long floor;
    private String result = "recorder_unavailable";
    public StaffAudioBoundaryEvent(ServerPlayer actor, String phase, long floor) { super(actor); this.phase = phase; this.floor = floor; }
    public int protocol() { return 1; }
    public String phase() { return phase; }
    public long floor() { return floor; }
    public void respond(String code) { this.result = code; }
    public String result() { return result; }
}
